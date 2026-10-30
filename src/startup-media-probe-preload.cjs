'use strict';
const{contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('mediaProbe',Object.freeze({get:()=>ipcRenderer.invoke('startup-media-probe:get'),report:value=>ipcRenderer.invoke('startup-media-probe:result',value)}));
