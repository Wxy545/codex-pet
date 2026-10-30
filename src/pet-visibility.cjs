'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const L=require('./codex-locale.cjs');
const CHANNELS=Object.freeze({get:'pet-visibility:get',manual:'pet-visibility:manual',auto:'pet-visibility:auto'});
const REASONS={fullscreen:['d3d-fullscreen','borderless-fullscreen'],windowed:['not-fullscreen','desktop'],unknown:['session-unavailable','probe-unavailable','compile-only']};
const unknown=()=>({state:'unknown',reason:'probe-unavailable'});
function normalized(value){return value&&REASONS[value.state]?.includes(value.reason)?{state:value.state,reason:value.reason}:unknown();}

/** 一个隐藏只读进程持续探测，避免每两秒重新启动PowerShell并编译P/Invoke。 */
function createFullscreenWatcher({onState,platform=process.platform,spawnImpl=spawn,timers=globalThis,fileRoot=__dirname}={}) {
 if(typeof onState!=='function')throw new TypeError('fullscreen callback required');
 let running=false,child=null,retry=null,watchdog=null;
 const emit=value=>{try{onState(value);}catch{/* 显示层错误不扩大原生探测能力。 */}};
 const cancel=id=>{if(id!==null)timers.clearTimeout(id);};
 const kill=owned=>{try{owned?.kill();}catch{/* 只清理本模块创建的探测器。 */}};
 function launch(){
  retry=null;if(!running)return;if(platform!=='win32'){emit(unknown());return;}
  const env=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','PATH','PATHEXT'].filter(key=>typeof process.env[key]==='string').map(key=>[key,process.env[key]]));
  let owned;
  const fail=()=>{if(child!==owned)return;child=null;cancel(watchdog);watchdog=null;kill(owned);emit(unknown());if(running){retry=timers.setTimeout(launch,30000);retry?.unref?.();}};
  try{owned=spawnImpl(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(fileRoot,'foreground-fullscreen.ps1'),'-Watch','-IntervalMs','2000'],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env});}
  catch{emit(unknown());if(running){retry=timers.setTimeout(launch,30000);retry?.unref?.();}return;}
  child=owned;let buffer='';const decoder=new StringDecoder('utf8');
  const arm=()=>{cancel(watchdog);watchdog=timers.setTimeout(fail,10000);watchdog?.unref?.();};arm();
  owned.stdout.on('data',chunk=>{
   if(child!==owned||!running)return;buffer+=typeof chunk==='string'?chunk:decoder.write(chunk);if(buffer.length>4096){fail();return;}
   let cut;while(child===owned&&(cut=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,cut).replace(/^\uFEFF/,'').trim();buffer=buffer.slice(cut+1);if(!line)continue;let parsed;try{parsed=JSON.parse(line);}catch{fail();return;}const value=normalized(parsed);if(value.state==='unknown'&&value.reason==='probe-unavailable'&&(parsed?.state!=='unknown'||parsed?.reason!=='probe-unavailable')){fail();return;}arm();emit(value);}
  });
  owned.stderr?.on('data',()=>{});owned.once('error',fail);owned.once('close',fail);
 }
 return{start(){if(running)return;running=true;launch();},stop(){if(!running)return;running=false;cancel(retry);cancel(watchdog);retry=null;watchdog=null;const owned=child;child=null;kill(owned);}};
}

function loadPreferences(file){
 try{if(fs.lstatSync(file).isSymbolicLink())throw new Error();const info=fs.statSync(file);if(!info.isFile()||info.size>4096)throw new Error();const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));if(value.schemaVersion!==1||typeof value.manualHidden!=='boolean'||typeof value.autoHide!=='boolean')throw new Error();return{manualHidden:value.manualHidden,autoHide:value.autoHide};}
 catch{return{manualHidden:false,autoHide:true};}
}

/** 只管理原宠物Map内的index窗口；不改配置display、不创建窗口、不影响面板或后台任务。 */
function createController({electron,getPetWindows,dataRoot=process.env.DSH_HOME,fileRoot=__dirname,probeFullscreen,timers=globalThis,watcherFactory=createFullscreenWatcher,onChange=()=>{}}={}) {
 if(typeof getPetWindows!=='function'||!dataRoot||!path.isAbsolute(dataRoot))throw new TypeError('visibility dependencies required');
 const {app,ipcMain,BrowserWindow}=electron,preferenceFile=path.join(dataRoot,'visibility.json');
 const petUrl=pathToFileURL(path.join(fileRoot,'index.html')).href,controlUrl=pathToFileURL(path.join(fileRoot,'control-window.html')).href;
 let preferences=loadPreferences(preferenceFile),report=unknown(),lastFullscreen=false,overrideFullscreen=false,disposed=false,started=false,polling=false,interval=null,watcher=null;
 const tracked=new Map();
 const urlOf=win=>{try{const url=new URL(win.webContents.getURL());url.search='';url.hash='';return url.href;}catch{return'';}};
 const isPet=win=>!win.isDestroyed()&&urlOf(win)===petUrl;
 let externalHidden=false;
 const hidden=()=>externalHidden||preferences.manualHidden||(preferences.autoHide&&lastFullscreen&&!overrideFullscreen);
 const state=()=>({schemaVersion:1,manualHidden:preferences.manualHidden,autoHide:preferences.autoHide,fullscreen:report.state,reason:report.reason,automaticHidden:preferences.autoHide&&lastFullscreen&&!overrideFullscreen,hidden:hidden()});
 function publish(){try{Promise.resolve(onChange(state())).catch(()=>{});}catch{}for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&&[petUrl,controlUrl].includes(urlOf(win)))try{win.webContents.send('pet-visibility:changed',state());}catch{/* 退出中的窗口丢弃状态。 */}}
 function currentWindows(){try{return new Set([...getPetWindows()].filter(win=>win&&!win.isDestroyed()));}catch{return new Set();}}
 function restoreMethods(win,item){if(win.show===item.showGuard)win.show=item.show;if(win.showInactive===item.inactiveGuard)win.showInactive=item.showInactive;if(win.hide===item.hideGuard)win.hide=item.hide;}
 function attach(win){
  if(tracked.has(win)||urlOf(win)&&urlOf(win)!==petUrl||typeof win.show!=='function'||typeof win.showInactive!=='function'||typeof win.hide!=='function')return;
  const item={show:win.show,showInactive:win.showInactive,hide:win.hide,restore:false};
  const showGuard=method=>function(...args){
   if(!disposed&&isPet(win)&&currentWindows().has(win)&&hidden()){
    // 上游首次显示/400ms兜底代表真实显示意图；只暂存这类窗，不创建新宠物。
    item.restore=true;if(win.isVisible())item.hide.call(win);return;
   }
   item.restore=false;return method.apply(this,args);
  };
  item.showGuard=showGuard(item.show);item.inactiveGuard=showGuard(item.showInactive);
  item.hideGuard=function(...args){item.restore=false;return item.hide.apply(this,args);};
  win.show=item.showGuard;win.showInactive=item.inactiveGuard;win.hide=item.hideGuard;tracked.set(win,item);
 }
 function sync(){
  if(disposed)return;const windows=currentWindows();
  for(const[win,item]of tracked)if(!windows.has(win)||win.isDestroyed()){restoreMethods(win,item);tracked.delete(win);}
  for(const win of windows){attach(win);const item=tracked.get(win);if(!item||!isPet(win))continue;
   if(hidden()){if(win.isVisible()){item.restore=true;item.hide.call(win);}}
   else if(item.restore){item.restore=false;item.showInactive.call(win);}
  }
 }
 function accept(value){
  if(disposed)return;report=normalized(value);
  // 探测失败只显示unknown，不能据此把游戏中已隐藏的宠物突然恢复。
  if(report.state==='fullscreen')lastFullscreen=true;
  if(report.state==='windowed'){lastFullscreen=false;overrideFullscreen=false;}
  sync();publish();
 }
 async function poll(){if(disposed||polling||!preferences.autoHide)return;polling=true;try{accept(await probeFullscreen());}catch{accept(unknown());}finally{polling=false;}}
 function detector(){
  if(!started||disposed)return;
  if(!preferences.autoHide){if(interval!==null)timers.clearInterval(interval);interval=null;watcher?.stop();return;}
  if(typeof probeFullscreen==='function'){if(interval===null){interval=timers.setInterval(poll,2000);interval?.unref?.();}return poll();}
  watcher??=watcherFactory({onState:accept,fileRoot,timers});watcher.start();
 }
 function persist(next){
  const temporary=preferenceFile+'.tmp-'+randomUUID();
  try{
   for(const target of[dataRoot,preferenceFile])try{if(fs.lstatSync(target).isSymbolicLink())throw new Error('linked');}catch(error){if(error.code!=='ENOENT')throw error;}
   fs.mkdirSync(dataRoot,{recursive:true});fs.writeFileSync(temporary,JSON.stringify({schemaVersion:1,...next},null,2)+'\n',{flag:'wx'});fs.renameSync(temporary,preferenceFile);
  }catch{try{fs.unlinkSync(temporary);}catch{}throw new Error('visibility-save-failed');}
 }
 async function setManualHidden(value){
  if(disposed)throw new Error('visibility-closed');if(typeof value!=='boolean')throw new Error('invalid-visibility');const next={...preferences,manualHidden:value};persist(next);preferences=next;
  overrideFullscreen=!value&&lastFullscreen;sync();publish();return state();
 }
 async function setAutoHide(value){
  if(disposed)throw new Error('visibility-closed');if(typeof value!=='boolean')throw new Error('invalid-visibility');const next={...preferences,autoHide:value};persist(next);preferences=next;overrideFullscreen=false;if(!value){lastFullscreen=false;report=unknown();}sync();publish();await detector();return state();
 }
 async function start(){if(started||disposed)return;started=true;sync();await detector();}
 const trusted=event=>{try{if(disposed||event.senderFrame!==event.sender.mainFrame||!event.senderFrame)return false;const win=BrowserWindow.fromWebContents(event.sender);return win&&!win.isDestroyed()&&[petUrl,controlUrl].includes(urlOf(win));}catch{return false;}};
 const denied=()=>({ok:false,code:'unauthorized',message:L.getLocale()==='zh-CN'?'此窗口不能修改显示状态。':'This window cannot change pet visibility.'});
 const modify=async(event,value,fn)=>{if(!trusted(event))return denied();if(typeof value!=='boolean')return{ok:false,code:'invalid_input'};try{return{ok:true,state:await fn(value)};}catch{return{ok:false,code:'save_failed',message:L.getLocale()==='zh-CN'?'显示偏好未能保存，请重试。':'Visibility preferences could not be saved. Try again.'};}};
 ipcMain.handle(CHANNELS.get,event=>trusted(event)?{ok:true,state:state()}:denied());ipcMain.handle(CHANNELS.manual,(event,value)=>modify(event,value,setManualHidden));ipcMain.handle(CHANNELS.auto,(event,value)=>modify(event,value,setAutoHide));
 const created=()=>{queueMicrotask(sync);};app.on('browser-window-created',created);
 function dispose(){if(disposed)return;disposed=true;if(interval!==null)timers.clearInterval(interval);interval=null;watcher?.stop();app.removeListener('browser-window-created',created);app.removeListener('before-quit',dispose);for(const channel of Object.values(CHANNELS))ipcMain.removeHandler(channel);for(const[win,item]of tracked)restoreMethods(win,item);tracked.clear();}
 app.once('before-quit',dispose);
 return{state,setManualHidden,setAutoHide,setExternalHidden(value){if(disposed||typeof value!=='boolean')throw new Error('invalid-visibility');externalHidden=value;sync();publish();return state();},start,dispose,trayItems:()=>[
  {label:L.getLocale()==='zh-CN'?'显示桌宠':'Show pet',click:()=>{void setManualHidden(false).catch(()=>{});}},
  {label:L.getLocale()==='zh-CN'?'隐藏桌宠':'Hide pet',click:()=>{void setManualHidden(true).catch(()=>{});}},
 ]};
}
function install({disabled=false,...options}){const electron=options.electron||require('electron');const controller=createController({...options,electron});if(!disabled)void electron.app.whenReady().then(()=>controller.start()).catch(()=>{});return controller;}
function installPreload(electron=require('electron')){
 const{contextBridge,ipcRenderer}=electron;contextBridge.exposeInMainWorld('petVisibility',Object.freeze({getState:()=>ipcRenderer.invoke(CHANNELS.get),setManualHidden:value=>ipcRenderer.invoke(CHANNELS.manual,value),setAutoHide:value=>ipcRenderer.invoke(CHANNELS.auto,value),onChanged:callback=>{const handler=(_event,value)=>callback(value);ipcRenderer.on('pet-visibility:changed',handler);return()=>ipcRenderer.removeListener('pet-visibility:changed',handler);}}));
}
module.exports={createController,createFullscreenWatcher,install,installPreload,CHANNELS};
