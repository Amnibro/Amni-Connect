const { app, BrowserWindow, ipcMain, desktopCapturer, clipboard, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const USER_DATA = path.join(app.getPath('appData'), 'amni-connect');
const CACHE_DIR = path.join(USER_DATA, 'Cache');
const GPU_CACHE_DIR = path.join(USER_DATA, 'GPUCache');
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}
try { fs.mkdirSync(GPU_CACHE_DIR, { recursive: true }); } catch (_) {}
app.setPath('userData', USER_DATA);
app.setPath('cache', CACHE_DIR);
app.commandLine.appendSwitch('disk-cache-dir', CACHE_DIR);
app.commandLine.appendSwitch('gpu-disk-cache-dir', GPU_CACHE_DIR);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-features', process.platform === 'win32' ? 'CalculateNativeWinOcclusion,WebRtcHideLocalIpsWithMdns' : 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('force-fieldtrials', 'WebRTC-HideLocalIpsWithMdns/Disabled/');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,UseOzonePlatform');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}
const gotSingleLock = app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
  process.exit(0);
}
let mainWindow, rustProcess, rustClient;
let signalingServer;
let reconnectTimer = null;
let videoClient = null;
let videoBuf = Buffer.alloc(0);
let helloWait = null;
let hwPending = false;
let tray = null;
let trayHost = false;
let quitting = false;
const RUST_PORT = 7878;
const VIDEO_PORT = 7879;
const HW_MAGIC = 0x31434E41;
const RUST_NAME = process.platform === 'win32' ? 'amni-control.exe' : 'amni-control';
function rustBinPath() {
  const packed = path.join(process.resourcesPath || '', RUST_NAME);
  if (packed && fs.existsSync(packed)) return packed;
  return path.join(__dirname, 'rust', 'target', 'release', RUST_NAME);
}
const RUST_LOG = path.join(USER_DATA, 'amni-control.log');
app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; });

function trayIcon() {
  const p = path.join(__dirname, 'assets', 'icon.png');
  try { if (fs.existsSync(p)) return nativeImage.createFromPath(p); } catch (_) {}
  return nativeImage.createEmpty();
}
function rebuildTrayMenu(label) {
  if (!tray) return;
  tray.setToolTip(label || 'Amni-Connect');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: label || 'Amni-Connect', enabled: false },
    { type: 'separator' },
    { label: 'Show', click: () => showWindow() },
    { label: 'End session', click: () => mainWindow?.webContents.send('tray-end-session') },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; trayHost = false; app.quit(); } }
  ]));
}
function ensureTray(label) {
  if (!tray) {
    try {
      const icon = trayIcon();
      if (!icon || icon.isEmpty()) return false;
      tray = new Tray(icon);
      tray.on('click', () => showWindow());
    } catch (e) {
      console.error('[amni-connect] tray failed', e);
      trayHost = false;
      return false;
    }
  }
  rebuildTrayMenu(label);
  return true;
}
function showWindow() {
  if (!mainWindow) createWindow();
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function hideWindow() {
  if (!mainWindow) return;
  mainWindow.setSkipTaskbar(true);
  mainWindow.hide();
}
function teardownSession() {
  rustWrite({ type: 'capture-stop' });
  rustClient?.destroy();
  videoClient?.destroy();
  rustProcess?.kill();
  killStrayRust();
  signalingServer?.close?.();
}

function ensureRustExecutable() {
  if (process.platform === 'win32') return;
  try { fs.chmodSync(rustBinPath(), 0o755); } catch (_) {}
}

let lastSpawnAttempt = 0;
let lastRestart = 0;
let lastPong = 0;
let pingTimer = null;
const SPAWN_COOLDOWN_MS = 5000;
const RESTART_COOLDOWN_MS = 20000;
const PING_MS = 5000;
const PONG_DEADLINE_MS = 15000;
function hostStatus(msg) {
  mainWindow?.webContents.send('status-update', msg);
}
const ELEVATED_TASK = 'AmniControlElevated';
let elevatedTask = process.platform === 'win32';
function killStrayRust() {
  if (elevatedTask) { try { spawn('schtasks', ['/end', '/tn', ELEVATED_TASK], { stdio: 'ignore' }).on('error', () => {}); } catch (_) {} }
  const [bin, args] = process.platform === 'win32' ? ['taskkill', ['/F', '/IM', 'amni-control.exe']] : ['pkill', ['-f', 'amni-control']];
  try { spawn(bin, args, { stdio: 'ignore' }).on('error', () => {}); } catch (_) {}
}
function restartRust(reason) {
  const now = Date.now();
  if (now - lastRestart < RESTART_COOLDOWN_MS) return;
  lastRestart = now;
  lastPong = now;
  hostStatus(`Input backend unresponsive (${reason}) - restarting amni-control`);
  try { rustProcess?.kill(); } catch (_) {}
  killStrayRust();
  rustProcess = null;
  lastSpawnAttempt = 0;
  setTimeout(() => { trySpawnRust(); connectRustClient(); }, 800);
}
function onRustData(buf) {
  lastPong = Date.now();
  String(buf).split('\n').filter(Boolean).forEach(line => {
    let msg = null;
    try { msg = JSON.parse(line); } catch (_) { return; }
    if (msg.type !== 'pong') return;
    (msg.direct || msg.errs > 0 || msg.misses > 0) && hostStatus(`Input backend degraded: errs=${msg.errs} misses=${msg.misses} direct=${msg.direct} ${msg.last || ''}`);
  });
}
function startPing() {
  if (pingTimer) return;
  pingTimer = setInterval(() => {
    if (!rustClient || rustClient.destroyed) return;
    try { rustClient.write(JSON.stringify({ type: 'ping' }) + '\n'); } catch (_) {}
    lastPong && Date.now() - lastPong > PONG_DEADLINE_MS && restartRust('no pong');
  }, PING_MS);
}
function spawnRustDirect() {
  try {
    const rustLogFd = fs.openSync(RUST_LOG, 'a');
    rustProcess = spawn(rustBinPath(), [], { stdio: ['ignore', rustLogFd, rustLogFd], detached: false });
    rustProcess.on('error', () => {});
  } catch (_) {}
}
function trySpawnRust() {
  if (rustProcess && rustProcess.exitCode === null) return;
  const now = Date.now();
  if (now - lastSpawnAttempt < SPAWN_COOLDOWN_MS) return;
  lastSpawnAttempt = now;
  ensureRustExecutable();
  if (!elevatedTask) return spawnRustDirect();
  try {
    const t = spawn('schtasks', ['/run', '/tn', ELEVATED_TASK], { stdio: 'ignore' });
    t.on('error', () => { elevatedTask = false; spawnRustDirect(); });
    t.on('exit', (code) => {
      if (code === 0) return hostStatus('Input backend started elevated (UIPI-proof)');
      elevatedTask = false;
      hostStatus('Elevated input task missing - falling back to medium integrity (elevated windows will swallow input)');
      spawnRustDirect();
    });
  } catch (_) { elevatedTask = false; spawnRustDirect(); }
}

function spawnRust() {
  const probe = new net.Socket();
  probe.once('connect', () => { probe.destroy(); connectRustClient(); });
  probe.once('error', () => {
    probe.destroy();
    trySpawnRust();
    setTimeout(connectRustClient, 800);
  });
  probe.connect(RUST_PORT, '127.0.0.1');
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; trySpawnRust(); connectRustClient(); }, 2000);
}

function rustWrite(obj) {
  if (!rustClient || rustClient.destroyed) return false;
  try { rustClient.write(JSON.stringify(obj) + '\n'); return true; } catch (_) { return false; }
}

function onVideoData(chunk) {
  videoBuf = Buffer.concat([videoBuf, chunk]);
  while (videoBuf.length >= 16) {
    if (videoBuf.readUInt32LE(0) !== HW_MAGIC) { videoBuf = videoBuf.subarray(1); continue; }
    const len = videoBuf.readUInt32LE(4);
    if (len > 8000000) { videoBuf = videoBuf.subarray(4); continue; }
    if (videoBuf.length < 16 + len) break;
    const kind = videoBuf.readUInt16LE(8);
    const flags = videoBuf.readUInt16LE(10);
    const ts = videoBuf.readUInt32LE(12);
    const payload = Buffer.from(videoBuf.subarray(16, 16 + len));
    videoBuf = videoBuf.subarray(16 + len);
    if (kind === 1 && helloWait) {
      let msg = {};
      try { msg = JSON.parse(payload.toString('utf8')); } catch (_) {}
      const fn = helloWait; helloWait = null; fn({ ok: true, ...msg });
    }
    if (kind === 2 && !(flags & 1) && hwPending) continue;
    hwPending = kind === 2;
    mainWindow?.webContents.send('hw-video', { kind, flags, ts, payload });
  }
}

function connectVideoClient() {
  if (videoClient && !videoClient.destroyed) return;
  videoClient = new net.Socket();
  videoBuf = Buffer.alloc(0);
  videoClient.on('data', onVideoData);
  videoClient.on('error', () => {});
  videoClient.on('close', () => { videoClient = null; });
  videoClient.connect(VIDEO_PORT, '127.0.0.1');
}

function connectRustClient() {
  rustClient?.removeAllListeners();
  rustClient?.destroy();
  rustClient = new net.Socket();
  rustClient.on('connect', () => { lastPong = Date.now(); startPing(); hostStatus('Rust input backend connected'); connectVideoClient(); });
  rustClient.on('data', onRustData);
  rustClient.on('error', () => {});
  rustClient.on('close', scheduleReconnect);
  rustClient.connect(RUST_PORT, '127.0.0.1');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      backgroundThrottling: false
    }
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('close', (e) => {
    if (trayHost && !quitting) {
      e.preventDefault();
      hideWindow();
    }
  });
}

function ensureElevatedTask() {
  if (process.platform !== 'win32') return;
  const bin = rustBinPath();
  const q = spawn('schtasks', ['/query', '/tn', ELEVATED_TASK], { stdio: 'ignore' });
  q.on('exit', (code) => {
    if (code === 0) return;
    const tr = `"${bin}"`;
    const args = ['/create', '/tn', ELEVATED_TASK, '/tr', tr, '/sc', 'onlogon', '/rl', 'HIGHEST', '/f', '/it'];
    const c = spawn('schtasks', args, { stdio: 'ignore' });
    c.on('exit', (ok) => {
      if (ok === 0) return hostStatus('Created elevated input task');
      hostStatus('Elevated input task missing - remote typing into admin windows may fail');
    });
  });
}

function startAutoUpdate() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (e) => console.error('[amni-connect] update', e && e.message));
  autoUpdater.on('update-downloaded', (info) => hostStatus('Update ' + (info.version || '') + ' ready — restart to apply'));
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 8000);
}

app.whenReady().then(() => {
  ensureElevatedTask();
  spawnRust();
  createWindow();
  try { signalingServer = require('./server'); }
  catch (e) { console.error('[amni-connect] signaling failed', e); hostStatus('Signaling failed to start: ' + (e && e.message)); }
  startAutoUpdate();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (trayHost && !quitting) return;
  teardownSession();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-local-ip', () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
});

ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    return sources.map(s => ({ id: s.id, name: s.name }));
  } catch (e) {
    console.error('[amni-connect] desktopCapturer failed:', e && e.message ? e.message : e);
    return [];
  }
});

function writeInput(event) {
  if (!rustClient || rustClient.destroyed) return false;
  try { rustClient.write(JSON.stringify(event) + '\n'); return true; } catch (_) { return false; }
}
ipcMain.on('send-input-event', (_, event) => { writeInput(event); });
ipcMain.handle('send-input-event', (_, event) => ({ status: writeInput(event) ? 'sent' : 'no-backend' }));
ipcMain.on('hw-frame-ack', () => { hwPending = false; });

ipcMain.handle('read-clipboard', () => clipboard.readText());
ipcMain.handle('write-clipboard', (_, text) => clipboard.writeText(text));
ipcMain.handle('start-hw-capture', (_, opts) => new Promise((resolve) => {
  const t = setTimeout(() => { if (helloWait) { helloWait = null; rustWrite({ type: 'capture-stop' }); resolve({ ok: false, reason: 'timeout' }); } }, 2800);
  helloWait = (msg) => { clearTimeout(t); resolve(msg); };
  connectVideoClient();
  if (!rustWrite({ type: 'capture-start', fps: opts?.fps, kbps: opts?.kbps, output: opts?.output || 0 })) {
    clearTimeout(t); helloWait = null; resolve({ ok: false, reason: 'no-backend' });
  }
}));
ipcMain.handle('update-hw-capture', (_, opts) => { rustWrite({ type: 'capture-update', fps: opts?.fps, kbps: opts?.kbps }); return { status: 'sent' }; });
ipcMain.handle('stop-hw-capture', () => { rustWrite({ type: 'capture-stop' }); return { status: 'sent' }; });
ipcMain.handle('hw-idr', () => { rustWrite({ type: 'capture-idr' }); return { status: 'sent' }; });
ipcMain.handle('hide-to-tray', (_, label) => {
  if (!ensureTray(label || 'Amni-Connect · hosting')) return { status: 'no-tray' };
  trayHost = true;
  hideWindow();
  return { status: 'hidden' };
});
ipcMain.handle('set-tray-host', (_, on, label) => {
  trayHost = !!on;
  if (on) ensureTray(label || 'Amni-Connect · hosting');
  else if (tray) rebuildTrayMenu('Amni-Connect');
  return { status: trayHost ? 'tray' : 'window' };
});
ipcMain.handle('show-window', () => { showWindow(); return { status: 'shown' }; });


