'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petTelemetry',Object.freeze({getState:()=>ipcRenderer.invoke('pet-telemetry:get'),setEnabled:value=>ipcRenderer.invoke('pet-telemetry:set',value),onState:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('pet-telemetry:changed',listener);return()=>ipcRenderer.removeListener('pet-telemetry:changed',listener);}}));
// 每个操作固定对应一条主进程通道；渲染器不能提交路由、令牌或任意文件路径。
contextBridge.exposeInMainWorld('controlCenter',Object.freeze({
 get:section=>ipcRenderer.invoke('codex-control:state',section),
 selectCharacter:character=>ipcRenderer.invoke('codex-control:character',character),
 saveInteraction:value=>ipcRenderer.invoke('codex-control:interaction',value),
 saveChatter:value=>ipcRenderer.invoke('codex-control:chatter',value),
 setStartup:mode=>ipcRenderer.invoke('codex-control:startup',mode),
 previewStartup:()=>ipcRenderer.invoke('codex-control:preview'),
 selectHost:host=>ipcRenderer.invoke('codex-control:host',host),
 reload:()=>ipcRenderer.invoke('codex-control:reload'),
}));
contextBridge.exposeInMainWorld('petPanels',Object.freeze({host:process.env.CODEX_PET_HOST==='workbuddy'?'workbuddy':'codex',getState:()=>ipcRenderer.invoke('codex-panels:state'),onChanged:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('codex-panels:changed',listener);return()=>ipcRenderer.removeListener('codex-panels:changed',listener);},navigate:name=>ipcRenderer.invoke('codex-panels:navigate',name)}));
contextBridge.exposeInMainWorld('petVisibility',Object.freeze({
 getState:()=>ipcRenderer.invoke('pet-visibility:get'),
 setManualHidden:value=>ipcRenderer.invoke('pet-visibility:manual',value),
 setAutoHide:value=>ipcRenderer.invoke('pet-visibility:auto',value),
 onChanged:callback=>{const handler=(_event,value)=>callback(value);ipcRenderer.on('pet-visibility:changed',handler);return()=>ipcRenderer.removeListener('pet-visibility:changed',handler);},
}));
contextBridge.exposeInMainWorld('startupMedia',Object.freeze({
 getState:()=>ipcRenderer.invoke('startup-media:get'),
 importVideo:()=>ipcRenderer.invoke('startup-media:import'),
 preferences:value=>ipcRenderer.invoke('startup-media:preferences',value),
 remove:id=>ipcRenderer.invoke('startup-media:remove',id),
 preview:()=>ipcRenderer.invoke('startup-media:preview'),
 onChanged:callback=>{const handler=(_event,value)=>callback(value);ipcRenderer.on('startup-media:changed',handler);return()=>ipcRenderer.removeListener('startup-media:changed',handler);},
}));
