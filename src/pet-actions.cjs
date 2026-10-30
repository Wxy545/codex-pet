'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto');
const CHANNELS=Object.freeze({publish:'codex-actions:publish',play:'codex-actions:play',result:'codex-actions:result'});
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=160)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const id=value=>text(value)&&!/[\\/:]/.test(value);
const fault=code=>Object.assign(new Error(code),{code});
function validCatalog(value){
 if(!record(value)||Object.keys(value).some(key=>!['petId','name','groups'].includes(key))||!id(value.petId)||!text(value.name,80)||!Array.isArray(value.groups)||value.groups.length>64)return false;
 let count=0;return value.groups.every(group=>record(group)&&Object.keys(group).every(key=>['label','items'].includes(key))&&text(group.label)&&Array.isArray(group.items)&&group.items.length>0&&group.items.every(item=>++count<=512&&record(item)&&Object.keys(item).every(key=>['anim','label','hint'].includes(key))&&id(item.anim)&&text(item.label)&&(item.hint===undefined||typeof item.hint==='string'&&item.hint.length<=160)));
}

/** 清单由原宠物窗口产生；管理页只能点播该窗当前清单内的动画ID。 */
function createController({electron,fileRoot=__dirname,host=()=>process.env.CODEX_PET_HOST||'codex',setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout}={}){
 const{app,ipcMain,BrowserWindow}=electron,petUrl=pathToFileURL(path.join(fileRoot,'index.html')).href,entries=new Map(),pending=new Map();let disposed=false;
 const trusted=event=>{try{const url=new URL(event.sender.getURL());url.search='';url.hash='';return!disposed&&event.senderFrame===event.sender.mainFrame&&Boolean(event.senderFrame)&&url.href===petUrl&&!!BrowserWindow.fromWebContents(event.sender);}catch{return false;}};
 function finish(request,ok){if(!pending.delete(request.id))return;clearTimeoutImpl(request.timer);ok?request.resolve(true):request.reject(fault('unavailable'));}
 function remove(contents){const entry=entries.get(contents);if(!entry)return;entries.delete(contents);for(const[name,fn]of entry.listeners)contents.removeListener?.(name,fn);for(const request of pending.values())if(request.entry===entry)finish(request,false);}
 function publish(event,value){
  if(!trusted(event))return{ok:false,code:'unauthorized'};if(!validCatalog(value))return{ok:false,code:'invalid_input'};
  const contents=event.sender;remove(contents);if(!value.groups.length)return{ok:true};if(entries.size>=16)return{ok:false,code:'unavailable'};
  const entry={contents,revision:randomUUID(),...structuredClone(value),listeners:[]};
  for(const name of ['destroyed','render-process-gone','will-navigate']){const fn=()=>remove(contents);contents.once?.(name,fn);entry.listeners.push([name,fn]);}
  entries.set(contents,entry);return{ok:true,revision:entry.revision};
 }
 function state(){return{pets:[...entries.values()].filter(entry=>{const win=BrowserWindow.fromWebContents(entry.contents);return win&&!win.isDestroyed();}).map(({petId,name,groups,revision})=>({petId,name,groups:structuredClone(groups),revision}))};}
 async function play(value){
  if(disposed||host()==='harness')throw fault('unavailable');
  if(!record(value)||Object.keys(value).length!==3||!id(value.petId)||!id(value.anim)||typeof value.revision!=='string')throw fault('invalid_input');
  const entry=[...entries.values()].find(item=>item.petId===value.petId);if(!entry||entry.revision!==value.revision)throw fault('unavailable');
  if(!entry.groups.some(group=>group.items.some(item=>item.anim===value.anim)))throw fault('invalid_input');
  const win=BrowserWindow.fromWebContents(entry.contents);if(!win||win.isDestroyed())throw fault('unavailable');
  if([...pending.values()].some(request=>request.entry===entry))throw fault('busy');
  return new Promise((resolve,reject)=>{const request={id:randomUUID(),entry,resolve,reject,timer:null};pending.set(request.id,request);request.timer=setTimeoutImpl(()=>finish(request,false),3000);request.timer?.unref?.();try{entry.contents.send(CHANNELS.play,{requestId:request.id,petId:entry.petId,anim:value.anim,revision:entry.revision});}catch{finish(request,false);}});
 }
 const result=(event,value)=>{if(!trusted(event)||!record(value)||typeof value.requestId!=='string'||typeof value.ok!=='boolean')return;const request=pending.get(value.requestId);if(request&&request.entry.contents===event.sender&&entries.get(event.sender)===request.entry)finish(request,value.ok);};
 ipcMain.handle(CHANNELS.publish,publish);ipcMain.on(CHANNELS.result,result);
 function dispose(){if(disposed)return;disposed=true;for(const contents of [...entries.keys()])remove(contents);ipcMain.removeHandler(CHANNELS.publish);ipcMain.removeListener(CHANNELS.result,result);app.removeListener('before-quit',dispose);}
 app.once('before-quit',dispose);return{state,play,dispose};
}
function install(options){return createController({...options,electron:options.electron||require('electron')});}
function installPreload(electron=require('electron')){const{contextBridge,ipcRenderer}=electron;contextBridge.exposeInMainWorld('petActions',Object.freeze({publish:value=>ipcRenderer.invoke(CHANNELS.publish,value),onPlay:callback=>{if(typeof callback!=='function')return()=>{};const listener=async(_event,value)=>{let ok=false;try{ok=await callback(value)===true;}catch{}ipcRenderer.send(CHANNELS.result,{requestId:value?.requestId,ok});};ipcRenderer.on(CHANNELS.play,listener);return()=>ipcRenderer.removeListener(CHANNELS.play,listener);}}));}
module.exports={createController,install,installPreload,CHANNELS,validCatalog};
