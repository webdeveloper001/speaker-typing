const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appApi', {
  onStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('status-update', listener);
    return () => ipcRenderer.removeListener('status-update', listener);
  },
  start: () => ipcRenderer.invoke('transcription:start'),
  stop: () => ipcRenderer.invoke('transcription:stop'),
  onCaptureStart: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('capture:start', listener);
    return () => ipcRenderer.removeListener('capture:start', listener);
  },
  onCaptureStop: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('capture:stop', listener);
    return () => ipcRenderer.removeListener('capture:stop', listener);
  },
  sendAudioChunk: (arrayBuffer) => ipcRenderer.send('audio:chunk', arrayBuffer),
  sendCaptureError: (message) => ipcRenderer.send('capture:error', message),
  sendCaptureState: (state) => ipcRenderer.send('capture:state', state),
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  testTyping: () => ipcRenderer.invoke('typing:test')
});
