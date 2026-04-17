const { app, BrowserWindow, ipcMain, desktopCapturer, clipboard } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const os = require('os');

let mainWindow, rustProcess, rustClient;
const RUST_PORT = 7878;
const RUST_BIN = path.join(__dirname, 'rust', 'target', 'release', process.platform === 'win32' ? 'amni-control.exe' : 'amni-control');

function spawnRust() {
  const probe = new net.Socket();
  probe.once('connect', () => { probe.destroy(); connectRustClient(); });
  probe.once('error', () => {
    probe.destroy();
    try {
      rustProcess = spawn(RUST_BIN, [], { stdio: 'ignore', detached: false });
      rustProcess.on('error', () => {});
    } catch (_) {}
    setTimeout(connectRustClient, 800);
  });
  probe.connect(RUST_PORT, '127.0.0.1');
}

function connectRustClient() {
  rustClient = new net.Socket();
  rustClient.connect(RUST_PORT, '127.0.0.1', () => {
    mainWindow?.webContents.send('status-update', 'Rust input backend connected');
  });
  rustClient.on('error', () => setTimeout(connectRustClient, 2000));
  rustClient.on('close', () => setTimeout(connectRustClient, 2000));
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
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  rustClient?.destroy();
  rustProcess?.kill();
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
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  return sources.map(s => ({ id: s.id, name: s.name }));
});

ipcMain.handle('send-input-event', (_, event) => {
  if (!rustClient || rustClient.destroyed) return { status: 'no-backend' };
  rustClient.write(JSON.stringify(event) + '\n');
  return { status: 'sent' };
});

ipcMain.handle('read-clipboard', () => clipboard.readText());
ipcMain.handle('write-clipboard', (_, text) => clipboard.writeText(text));


