const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
  getSources: () => ipcRenderer.invoke('get-sources'),
  sendInputEvent: (event) => { ipcRenderer.send('send-input-event', event); },
  ackHwFrame: () => ipcRenderer.send('hw-frame-ack'),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_, msg) => callback(msg)),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  writeClipboard: (text) => ipcRenderer.invoke('write-clipboard', text),
  startHwCapture: (opts) => ipcRenderer.invoke('start-hw-capture', opts),
  updateHwCapture: (opts) => ipcRenderer.invoke('update-hw-capture', opts),
  stopHwCapture: () => ipcRenderer.invoke('stop-hw-capture'),
  requestHwIdr: () => ipcRenderer.invoke('hw-idr'),
  onHwVideo: (callback) => ipcRenderer.on('hw-video', (_, msg) => callback(msg)),
  hideToTray: (label) => ipcRenderer.invoke('hide-to-tray', label),
  setTrayHost: (on, label) => ipcRenderer.invoke('set-tray-host', on, label),
  showWindow: () => ipcRenderer.invoke('show-window'),
  onTrayEndSession: (callback) => ipcRenderer.on('tray-end-session', () => callback())
});
