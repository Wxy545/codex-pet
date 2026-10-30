'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petPanels',Object.freeze({host:process.env.CODEX_PET_HOST==='workbuddy'?'workbuddy':'codex',getState:()=>ipcRenderer.invoke('codex-panels:state'),onChanged:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('codex-panels:changed',listener);return()=>ipcRenderer.removeListener('codex-panels:changed',listener);},navigate:name=>ipcRenderer.invoke('codex-panels:navigate',name)}));

contextBridge.exposeInMainWorld('chatPanel', Object.freeze({
  getState: () => ipcRenderer.invoke('dragon-chat:state'),
  chooseImages: () => ipcRenderer.invoke('dragon-chat:choose'),
  pasteImage: () => ipcRenderer.invoke('dragon-chat:paste'),
  removeImage: id => ipcRenderer.invoke('dragon-chat:remove', id),
  sendMessage: body => ipcRenderer.invoke('dragon-chat:send', body),
  newConversation: () => ipcRenderer.invoke('dragon-chat:reset'),
  openTaskPanel: () => ipcRenderer.invoke('dragon-chat:task'),
  onState: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('dragon-chat:changed', listener);
    return () => ipcRenderer.removeListener('dragon-chat:changed', listener);
  },
}));
