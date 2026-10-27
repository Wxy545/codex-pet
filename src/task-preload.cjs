'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 这个独立窗口没有 Node 权限；每种能力对应一个固定、受主进程校验的 IPC。
contextBridge.exposeInMainWorld('taskPanel', Object.freeze({
  getState: () => ipcRenderer.invoke('dragon-task:state'),
  chooseDirectory: () => ipcRenderer.invoke('dragon-task:directory'),
  submitTask: body => ipcRenderer.invoke('dragon-task:submit', body),
  cancelTask: id => ipcRenderer.invoke('dragon-task:cancel', id),
  copyResult: () => ipcRenderer.invoke('dragon-task:copy'),
}));
