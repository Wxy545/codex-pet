'use strict';
const{contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petPanels',Object.freeze({host:process.env.CODEX_PET_HOST==='workbuddy'?'workbuddy':'codex',getState:()=>ipcRenderer.invoke('codex-panels:state'),onChanged:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('codex-panels:changed',listener);return()=>ipcRenderer.removeListener('codex-panels:changed',listener);},navigate:name=>ipcRenderer.invoke('codex-panels:navigate',name)}));
// 只暴露固定设置操作，不允许渲染器传入路由、凭据读取器或任意主进程指令。
contextBridge.exposeInMainWorld('qqRemote',Object.freeze({
 getState:()=>ipcRenderer.invoke('codex-qq:state'),
 chooseDirectory:()=>ipcRenderer.invoke('codex-qq:directory'),
 save:body=>ipcRenderer.invoke('codex-qq:save',body),
 pair:()=>ipcRenderer.invoke('codex-qq:action','pair'),
 unpair:()=>ipcRenderer.invoke('codex-qq:action','unlink'),
 disable:()=>ipcRenderer.invoke('codex-qq:action','disable'),
 openPlatform:()=>ipcRenderer.invoke('codex-qq:platform'),
 copyPairing:()=>ipcRenderer.invoke('codex-qq:copy-pairing'),
}));
