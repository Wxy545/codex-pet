'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('startupScene', {
  get: () => ipcRenderer.invoke('codex-startup:scene'),
  target: () => ipcRenderer.invoke('codex-startup:target'),
  ready: () => ipcRenderer.invoke('codex-startup:ready'),
  finish: () => ipcRenderer.invoke('codex-startup:finish'),
});
