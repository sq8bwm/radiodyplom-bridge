// Most między procesem głównym a interfejsem.
// Renderer nie ma dostępu do Node ani do rdzenia — wyłącznie te metody.
// CommonJS (.cjs), bo preload działa w piaskownicy i nie przyjmuje ESM.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  status: () => ipcRenderer.invoke('status'),
  log: (n) => ipcRenderer.invoke('log', n),
  pause: () => ipcRenderer.invoke('pause'),
  resume: () => ipcRenderer.invoke('resume'),
  requeue: () => ipcRenderer.invoke('requeue'),
  quit: () => ipcRenderer.invoke('quit'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
});
