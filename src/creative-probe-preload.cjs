'use strict';
const{contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('creativeProbe',Object.freeze({get:()=>ipcRenderer.invoke('creative-probe:get'),report:value=>ipcRenderer.invoke('creative-probe:result',value)}));
