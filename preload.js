const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
  logLine: (msg) => ipcRenderer.send('renderer-log', String(msg)),
  getSources: () => ipcRenderer.invoke('get-sources'),
  captureMode: () => ipcRenderer.invoke('capture-mode'),
  sendInputEvent: (event) => { ipcRenderer.send('send-input-event', event); },
  setInputGate: (g) => { ipcRenderer.send('input-gate', g); },
  ackHwFrame: () => ipcRenderer.send('hw-frame-ack'),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_, msg) => callback(msg)),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  writeClipboard: (text) => ipcRenderer.invoke('write-clipboard', text),
  startHwCapture: (opts) => ipcRenderer.invoke('start-hw-capture', opts),
  updateHwCapture: (opts) => ipcRenderer.invoke('update-hw-capture', opts),
  stopHwCapture: () => ipcRenderer.invoke('stop-hw-capture'),
  requestHwIdr: () => ipcRenderer.invoke('hw-idr'),
  onHwVideo: (callback) => ipcRenderer.on('hw-video', (_, msg) => callback(msg)),
  onHwDead: (callback) => ipcRenderer.on('hw-dead', (_, msg) => callback(msg)),
  hideToTray: (label) => ipcRenderer.invoke('hide-to-tray', label),
  setTrayHost: (on, label) => ipcRenderer.invoke('set-tray-host', on, label),
  setSessionOccupancy: (n, label) => ipcRenderer.invoke('set-session-occupancy', n, label),
  showWindow: () => ipcRenderer.invoke('show-window'),
  onTrayEndSession: (callback) => ipcRenderer.on('tray-end-session', () => callback()),
  onTrayBootViewer: (callback) => ipcRenderer.on('tray-boot-viewer', () => callback())
});
