const { app, BrowserWindow, ipcMain, desktopCapturer, clipboard, Tray, Menu, nativeImage, screen } = require('electron');
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
// The NSIS one-click installer moves the previous install to %TEMP%\...\old-install and
// launches THAT copy. It then takes the single-instance lock, so every later click on the
// taskbar/Start shortcut just re-shows the stale window and you keep running the old build.
// Bounce out of any copy that is not the installed one before the lock is taken.
function installedExe() {
  const base = process.env['ProgramFiles'] || 'C:\\Program Files';
  return path.join(base, 'Amni-Connect', 'amni-connect.exe');
}
if (process.platform === 'win32' && app.isPackaged && /\\Temp\\|\\old-install\\/i.test(process.execPath)) {
  const real = installedExe();
  if (fs.existsSync(real) && real.toLowerCase() !== process.execPath.toLowerCase()) {
    try { spawn(real, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); } catch (_) {}
    app.quit();
    process.exit(0);
  }
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
let trayOccupancy = 0;
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
const HOST_LOG = path.join(USER_DATA, 'host.log');
function hostLog(msg) {
  try { fs.appendFileSync(HOST_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch (_) {}
}
app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; hostLog('before-quit'); stopTunnel(); });
app.on('child-process-gone', (_e, d) => hostLog(`child-process-gone type=${d && d.type} reason=${d && d.reason} exit=${d && d.exitCode}`));
app.on('render-process-gone', (_e, _wc, d) => hostLog(`render-process-gone reason=${d && d.reason} exit=${d && d.exitCode}`));
process.on('uncaughtException', (e) => hostLog('uncaughtException ' + ((e && e.stack) || e)));

function trayIcon() {
  const p = path.join(__dirname, 'assets', 'icon.png');
  try { if (fs.existsSync(p)) return nativeImage.createFromPath(p); } catch (_) {}
  return nativeImage.createEmpty();
}
function rebuildTrayMenu(label) {
  if (!tray) return;
  tray.setToolTip(label || 'Amni-Connect');
  const items = [
    { label: label || 'Amni-Connect', enabled: false },
    { type: 'separator' },
    { label: 'Show', click: () => showWindow() }
  ];
  if (trayOccupancy > 0) {
    items.push({ label: trayOccupancy === 1 ? 'Boot viewer' : 'Boot ' + trayOccupancy + ' viewers', click: () => mainWindow?.webContents.send('tray-boot-viewer') });
  }
  if (trayHost) items.push({ label: 'End session', click: () => mainWindow?.webContents.send('tray-end-session') });
  items.push({ type: 'separator' }, { label: 'Quit', click: () => { quitting = true; trayHost = false; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
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
  const wc = mainWindow.webContents;
  const url = (wc && wc.getURL()) || '';
  if (wc.isCrashed() || !/index\.html/i.test(url)) {
    hostLog('window reload url=' + url + ' crashed=' + wc.isCrashed());
    wc.loadFile('index.html');
  } else {
    try { wc.invalidate(); } catch (_) {}
  }
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
  stopTunnel();
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
let mediumReplaced = false;
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
    if (msg.elevated === false && elevatedTask && !mediumReplaced) { mediumReplaced = true; hostLog('adopted daemon is medium integrity - restarting through the elevated task'); return restartRust('medium-integrity daemon'); }
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
    rustProcess = spawn(rustBinPath(), [], {
      stdio: ['ignore', rustLogFd, rustLogFd],
      detached: process.platform === 'win32',
      windowsHide: true
    });
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
  rustClient.on('connect', () => { lastPong = Date.now(); startPing(); rustWrite({ type: 'ping' }); hostStatus('Rust input backend connected'); connectVideoClient(); });
  rustClient.on('data', onRustData);
  rustClient.on('error', () => {});
  rustClient.on('close', scheduleReconnect);
  rustClient.connect(RUST_PORT, '127.0.0.1');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0A0B0E',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      backgroundThrottling: false
    }
  });
  mainWindow.once('ready-to-show', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); });
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    hostLog('did-fail-load ' + code + ' ' + desc + ' ' + url);
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile('index.html'); }, 400);
  });
  mainWindow.webContents.on('unresponsive', () => {
    hostLog('webContents unresponsive — reloading');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile('index.html');
  });
  mainWindow.webContents.on('render-process-gone', (_e, d) => {
    hostLog(`webContents render-process-gone reason=${d && d.reason} exit=${d && d.exitCode}`);
    if (d && d.reason !== 'clean-exit') {
      setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile('index.html'); }, 300);
    }
  });
  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    ensureTray('Amni-Connect');
    hideWindow();
    hostLog('window hidden — signaling still listening');
  });
  mainWindow.on('minimize', () => {
    ensureTray('Amni-Connect');
    if (mainWindow.isMinimized()) mainWindow.restore();
    hideWindow();
    hostLog('window hidden — minimize, session stays up');
  });
}

function elevatedTaskXml(bin) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Amni-Connect elevated input daemon</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>${esc(bin)}</Command><WorkingDirectory>${esc(path.dirname(bin))}</WorkingDirectory></Exec></Actions>
</Task>`;
}
function createElevatedTask(bin) {
  const xmlPath = path.join(USER_DATA, 'amni-control-task.xml');
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(xmlPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(elevatedTaskXml(bin), 'utf16le')]));
  } catch (_) { return hostStatus('Elevated input task missing - remote typing into admin windows may fail'); }
  const args = ['/create', '/tn', ELEVATED_TASK, '/xml', xmlPath, '/f'];
  const elevate = path.join(process.resourcesPath || '', 'elevate.exe');
  const done = (ok, via) => {
    elevatedTask = ok === 0;
    hostLog(`elevated task create via ${via} exit=${ok}`);
    hostStatus(ok === 0 ? `Created elevated input task (${via})` : 'Elevated input task missing - remote typing into admin windows may fail');
    ok === 0 && via === 'uac' && restartRust('elevated task registered');
  };
  const viaUac = () => {
    if (!fs.existsSync(elevate)) return done(1, 'none');
    hostStatus('Approve the UAC prompt once so remote input works over admin windows');
    const u = spawn(elevate, ['-wait', 'schtasks', ...args], { stdio: 'ignore', windowsHide: true });
    u.on('error', () => done(1, 'uac'));
    u.on('exit', (ok) => done(ok, 'uac'));
  };
  const c = spawn('schtasks', args, { stdio: 'ignore' });
  c.on('error', viaUac);
  c.on('exit', (ok) => ok === 0 ? done(0, 'schtasks') : viaUac());
}
function ensureElevatedTask() {
  if (process.platform !== 'win32') return;
  const bin = rustBinPath();
  const chunks = [];
  const q = spawn('schtasks', ['/query', '/tn', ELEVATED_TASK, '/xml'], { stdio: ['ignore', 'pipe', 'ignore'] });
  q.stdout.on('data', (d) => chunks.push(d));
  q.on('error', () => createElevatedTask(bin));
  q.on('exit', (code) => {
    const buf = Buffer.concat(chunks);
    const out = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
    const cmd = (out.match(/<Command>([^<]*)<\/Command>/) || [])[1] || '';
    if (code === 0 && cmd.trim().toLowerCase() === bin.toLowerCase()) return;
    createElevatedTask(bin);
  });
}

let tunnelProc = null, tunnelRetry = 0;
const TUNNEL_LOG = path.join(USER_DATA, 'tunnel.log');
function cloudflaredPath() {
  const c = [path.join(process.resourcesPath || '', 'cloudflared.exe'), 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe', path.join(app.getPath('home'), '.cloudflared', 'cloudflared.exe'), '/usr/local/bin/cloudflared', '/usr/bin/cloudflared'];
  return c.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } }) || 'cloudflared';
}
function startTunnel() {
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'tunnel.json'), 'utf8')); } catch (_) { return; }
  if (!cfg.token || !cfg.hostname || quitting) return;
  if (tunnelProc && tunnelProc.exitCode === null) return;
  const fd = fs.openSync(TUNNEL_LOG, 'a');
  try {
    tunnelProc = spawn(cloudflaredPath(), ['tunnel', '--no-autoupdate', 'run', '--token', cfg.token], { stdio: ['ignore', fd, fd], windowsHide: true });
  } catch (e) { hostLog('tunnel spawn failed ' + e.message); return hostStatus('Tunnel not started: cloudflared missing'); }
  hostLog('tunnel spawn pid=' + tunnelProc.pid + ' host=' + cfg.hostname);
  hostStatus(`Tunnel starting for https://${cfg.hostname}`);
  tunnelProc.on('error', (e) => { hostLog('tunnel error ' + e.message); hostStatus('Tunnel failed: ' + e.message); });
  tunnelProc.on('exit', (code) => {
    hostLog('tunnel exit code=' + code);
    if (quitting) return;
    tunnelRetry = Math.min(tunnelRetry + 1, 6);
    setTimeout(startTunnel, 2000 * tunnelRetry);
  });
  setTimeout(() => { try { const tail = fs.readFileSync(TUNNEL_LOG, 'utf8').slice(-4000); /Registered tunnel connection/.test(tail) && (tunnelRetry = 0, hostStatus(`Tunnel up: https://${cfg.hostname}`)); } catch (_) {} }, 8000);
}
function stopTunnel() {
  try { tunnelProc?.kill(); } catch (_) {}
  process.platform === 'win32' && tunnelProc?.pid && spawn('taskkill', ['/F', '/PID', String(tunnelProc.pid)], { stdio: 'ignore' }).on('error', () => {});
  tunnelProc = null;
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
  ensureTray('Amni-Connect');
  ensureElevatedTask();
  spawnRust();
  createWindow();
  try {
    signalingServer = require('./server');
    if (signalingServer && typeof signalingServer.setRelayedInput === 'function') {
      signalingServer.setRelayedInput((data) => writeInput(data, 'relay'));
    }
    hostLog('signaling listening on ' + (process.env.PORT || 3389));
    startTunnel();
  } catch (e) {
    console.error('[amni-connect] signaling failed', e);
    hostLog('signaling failed ' + (e && e.message));
    hostStatus('Signaling failed to start: ' + (e && e.message));
  }
  startAutoUpdate();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (!quitting) return;
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

// Thumbnails are what let the host UI show a live preview of each screen instead of
// making you guess whether the monitor you want is 1, 2 or 3. Capture cost scales with
// this size, so keep it small: it is a picker tile, not the stream.
const THUMB_SIZE = { width: 480, height: 270 };

ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: THUMB_SIZE });
    let displays = [], primaryId = null;
    try {
      displays = screen.getAllDisplays();
      primaryId = String(screen.getPrimaryDisplay().id);
    } catch (_) {}
    return sources.map((s, i) => {
      const d = displays.find(x => String(x.id) === String(s.display_id));
      const empty = !s.thumbnail || s.thumbnail.isEmpty();
      return {
        id: s.id,
        name: s.name,
        display_id: s.display_id,
        index: i + 1,
        primary: !!d && String(d.id) === primaryId,
        width: d ? Math.round(d.bounds.width * d.scaleFactor) : null,
        height: d ? Math.round(d.bounds.height * d.scaleFactor) : null,
        left: d ? Math.round(d.bounds.x * d.scaleFactor) : null,
        top: d ? Math.round(d.bounds.y * d.scaleFactor) : null,
        thumbnail: empty ? null : 'data:image/jpeg;base64,' + s.thumbnail.toJPEG(70).toString('base64')
      };
    });
  } catch (e) {
    console.error('[amni-connect] desktopCapturer failed:', e && e.message ? e.message : e);
    return [];
  }
});

let inputGate = { locked: false, viewOnly: false };
let lastP2pAt = 0;
const recentKeys = [];
function writeInput(event, src) {
  if (!event || inputGate.locked || inputGate.viewOnly) return false;
  const now = Date.now();
  if (src === 'p2p') lastP2pAt = now;
  else if (src === 'relay' && now - lastP2pAt < 80) return true;
  if (event.type === 'key-down' || event.type === 'key-up') {
    const sig = event.type + ':' + (event.key || '') + ':' + (event.code || '');
    for (let i = recentKeys.length - 1; i >= 0; i--) {
      if (now - recentKeys[i].t > 40) recentKeys.splice(i, 1);
      else if (recentKeys[i].sig === sig) return true;
    }
    recentKeys.push({ t: now, sig });
  }
  if (!rustClient || rustClient.destroyed) return false;
  try { rustClient.write(JSON.stringify(event) + '\n'); return true; } catch (_) { return false; }
}
ipcMain.on('send-input-event', (_, event) => { writeInput(event, 'p2p'); });
ipcMain.handle('send-input-event', (_, event) => ({ status: writeInput(event, 'p2p') ? 'sent' : 'no-backend' }));
ipcMain.on('input-gate', (_, g) => { inputGate = { locked: !!(g && g.locked), viewOnly: !!(g && g.viewOnly) }; });
ipcMain.on('hw-frame-ack', () => { hwPending = false; });
ipcMain.on('renderer-log', (_, msg) => hostLog('ui ' + String(msg).slice(0, 400)));

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
  if (!on) trayOccupancy = 0;
  if (on) ensureTray(label || 'Amni-Connect · hosting');
  else if (tray) rebuildTrayMenu('Amni-Connect');
  return { status: trayHost ? 'tray' : 'window' };
});
ipcMain.handle('set-session-occupancy', (_, n, label) => {
  trayOccupancy = Number(n) || 0;
  if (trayHost || tray) rebuildTrayMenu(label || (trayOccupancy ? 'Amni-Connect · in session' : 'Amni-Connect'));
  return { status: 'ok', n: trayOccupancy };
});
ipcMain.handle('show-window', () => { showWindow(); return { status: 'shown' }; });


