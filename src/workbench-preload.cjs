'use strict';
const{contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('workbench',Object.freeze({request:value=>ipcRenderer.invoke('pet-workbench:request',value),pin:value=>ipcRenderer.invoke('pet-workbench:pin',value)}));
contextBridge.exposeInMainWorld('petPanels',Object.freeze({host:process.env.CODEX_PET_HOST==='workbuddy'?'workbuddy':'codex',getState:()=>ipcRenderer.invoke('codex-panels:state'),onChanged:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('codex-panels:changed',listener);return()=>ipcRenderer.removeListener('codex-panels:changed',listener);},navigate:name=>ipcRenderer.invoke('codex-panels:navigate',name)}));
