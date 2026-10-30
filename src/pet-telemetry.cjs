'use strict';
const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');const {pathToFileURL}=require('node:url');
const {createSystemMonitor}=require('./system-monitor.cjs');
const CHANNELS={get:'pet-telemetry:get',set:'pet-telemetry:set',changed:'pet-telemetry:changed'};
function createController({electron,dataRoot=process.env.DSH_HOME,fileRoot=__dirname,monitor=createSystemMonitor(),disabled=false}){
 const {app,ipcMain,BrowserWindow}=electron;if(!path.isAbsolute(dataRoot||''))throw Error('invalid-monitor-root');
 const file=path.join(dataRoot,'monitor.json');let enabled=true,disposed=false,suspended=false;
 try{const info=fs.lstatSync(file);if(info.isSymbolicLink()||info.size>2048)throw Error();const v=JSON.parse(fs.readFileSync(file,'utf8'));if(v.schemaVersion===1&&typeof v.enabled==='boolean')enabled=v.enabled;}catch{}
 const allowed=new Set(['index.html','control-window.html'].map(name=>pathToFileURL(path.join(fileRoot,name)).href));
 const trusted=event=>{try{const url=new URL(event.sender.getURL());url.search='';url.hash='';return!disposed&&event.senderFrame===event.sender.mainFrame&&allowed.has(url.href)&&!!BrowserWindow.fromWebContents(event.sender);}catch{return false;}};
 const state=()=>({enabled,metrics:enabled&&!suspended?monitor.snapshot():null});
 function publish(){if(disposed)return;for(const win of BrowserWindow.getAllWindows())try{const url=new URL(win.webContents.getURL());url.search='';url.hash='';if(!win.isDestroyed()&&allowed.has(url.href))win.webContents.send(CHANNELS.changed,state());}catch{}}
 const unsubscribe=monitor.subscribe(publish);
 const get=event=>trusted(event)?{ok:true,...state()}:{ok:false,code:'unauthorized'};
 const set=(event,value)=>{if(!trusted(event))return{ok:false,code:'unauthorized'};if(typeof value!=='boolean')return{ok:false,code:'invalid_input'};
  try{if(fs.existsSync(dataRoot)&&fs.lstatSync(dataRoot).isSymbolicLink()||fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error();fs.mkdirSync(dataRoot,{recursive:true});const temp=file+'.tmp-'+randomUUID();try{fs.writeFileSync(temp,JSON.stringify({schemaVersion:1,enabled:value})+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);}catch(error){try{fs.unlinkSync(temp);}catch{}throw error;}enabled=value;if(enabled&&!disabled&&!suspended)monitor.start();else monitor.stop();publish();return{ok:true,...state()};}catch{return{ok:false,code:'save_failed'};}
 };
 ipcMain.handle(CHANNELS.get,get);ipcMain.handle(CHANNELS.set,set);
 if(enabled&&!disabled)monitor.start();
 function dispose(){if(disposed)return;disposed=true;monitor.stop();unsubscribe();ipcMain.removeHandler(CHANNELS.get);ipcMain.removeHandler(CHANNELS.set);app.removeListener('before-quit',dispose);}
 app.once('before-quit',dispose);return{state,dispose,setSuspended(value){if(disposed||typeof value!=='boolean'||suspended===value)return;suspended=value;if(enabled&&!disabled&&!suspended)monitor.start();else monitor.stop();publish();}};
}
function install(options){return createController({...options,electron:options.electron||require('electron')});}
function installPreload(electron=require('electron')){const{contextBridge,ipcRenderer}=electron;contextBridge.exposeInMainWorld('petTelemetry',Object.freeze({getState:()=>ipcRenderer.invoke(CHANNELS.get),setEnabled:value=>ipcRenderer.invoke(CHANNELS.set,value),onState:callback=>{if(typeof callback!=='function')return()=>{};const listen=(_event,value)=>callback(value);ipcRenderer.on(CHANNELS.changed,listen);return()=>ipcRenderer.removeListener(CHANNELS.changed,listen);}}));}
module.exports={install,createController,installPreload,CHANNELS};
