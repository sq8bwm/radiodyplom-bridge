// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

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
  ackProblems: () => ipcRenderer.invoke('ackProblems'),
  discardFailed: () => ipcRenderer.invoke('discardFailed'),
  quit: () => ipcRenderer.invoke('quit'),
  openLog: () => ipcRenderer.invoke('openLog'),
  openUrl: (url) => ipcRenderer.invoke('openUrl', url),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  checkConfig: (patch) => ipcRenderer.invoke('config:check', patch),
  stats: (from, to) => ipcRenderer.invoke('stats', from, to),
});
