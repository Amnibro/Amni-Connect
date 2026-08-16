const { app, BrowserWindow, ipcMain, desktopCapturer, clipboard } = require('electron');
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
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}
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
const RUST_PORT = 7878;
const RUST_BIN = path.join(__dirname, 'rust', 'target', 'release', process.platform === 'win32' ? 'amni-control.exe' : 'amni-control');
const RUST_LOG = path.join(USER_DATA, 'amni-control.log');
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function ensureRustExecutable() {
  if (process.platform === 'win32') return;
  try { fs.chmodSync(RUST_BIN, 0o755); } catch (_) {}
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
function killStrayRust() {
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
function trySpawnRust() {
  if (rustProcess && rustProcess.exitCode === null) return;
  const now = Date.now();
  if (now - lastSpawnAttempt < SPAWN_COOLDOWN_MS) return;
  lastSpawnAttempt = now;
  ensureRustExecutable();
  try {
    const rustLogFd = fs.openSync(RUST_LOG, 'a');
    rustProcess = spawn(RUST_BIN, [], { stdio: ['ignore', rustLogFd, rustLogFd], detached: false });
    rustProcess.on('error', () => {});
  } catch (_) {}
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

function connectRustClient() {
  rustClient?.removeAllListeners();
  rustClient?.destroy();
  rustClient = new net.Socket();
  rustClient.on('connect', () => { lastPong = Date.now(); startPing(); hostStatus('Rust input backend connected'); });
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
      enableRemoteModule: false
    }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  spawnRust();
  createWindow();
  signalingServer = require('./server');
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  rustClient?.destroy();
  rustProcess?.kill();
  signalingServer?.close?.();
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

ipcMain.handle('send-input-event', (_, event) => {
  if (!rustClient || rustClient.destroyed) return { status: 'no-backend' };
  rustClient.write(JSON.stringify(event) + '\n');
  return { status: 'sent' };
});

ipcMain.handle('read-clipboard', () => clipboard.readText());
ipcMain.handle('write-clipboard', (_, text) => clipboard.writeText(text));


