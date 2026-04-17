const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
  getSources: () => ipcRenderer.invoke('get-sources'),
  sendInputEvent: (event) => ipcRenderer.invoke('send-input-event', event),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_, msg) => callback(msg)),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  writeClipboard: (text) => ipcRenderer.invoke('write-clipboard', text)
});


