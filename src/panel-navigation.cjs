'use strict';
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const CHANNEL='codex-panels:navigate';
const STATE='codex-panels:state';
const PAGES={settings:'control-window.html',chat:'chat-window.html',tasks:'task-window.html',qq:'qq-window.html'};

/** 面板仅能打开固定的本机功能，不把URL、路由或命令传给渲染器。 */
function createController({electron,openPanel,fileRoot=__dirname,host=process.env.CODEX_PET_HOST||'codex'}){
  const {ipcMain,BrowserWindow,app}=electron;
  const urls=new Map(['index.html',...Object.values(PAGES)].map(file=>[pathToFileURL(path.join(fileRoot,file)).href,file]));
  let disposed=false;
  const currentHost=()=>{const value=typeof host==='function'?host():host;return['codex','workbuddy','harness'].includes(value)?value:'codex';};
  const source=event=>{try{
    if(disposed||event.senderFrame!==event.sender.mainFrame)return null;
    const url=new URL(event.sender.getURL());url.search='';url.hash='';
    const file=urls.get(url.href),win=BrowserWindow.fromWebContents(event.sender);
    return file&&win&&!win.isDestroyed()?{file,win}:null;
  }catch{return null;}};
  async function navigate(event,name){
    const from=source(event);
    if(!from)return{ok:false,code:'unauthorized'};
    if(!Object.hasOwn(PAGES,name)||currentHost()!=='codex'&&name!=='settings')return{ok:false,code:'unavailable'};
    try{
      await openPanel(name);
      if(from.file!=='index.html'&&from.file!==PAGES[name]&&!from.win.isDestroyed())from.win.hide();
      return{ok:true};
    }catch{return{ok:false,code:'unavailable'};}
  }
  ipcMain.handle(CHANNEL,navigate);
  ipcMain.handle(STATE,event=>source(event)?{ok:true,host:currentHost()}:{ok:false,code:'unauthorized'});
  let previous=currentHost();
  const timer=setInterval(()=>{if(disposed)return;const next=currentHost();if(next===previous)return;previous=next;for(const win of BrowserWindow.getAllWindows?.()||[])try{const url=new URL(win.webContents.getURL());url.search='';url.hash='';if(!win.isDestroyed()&&urls.has(url.href))win.webContents.send('codex-panels:changed',{host:next});}catch{}},1500);timer.unref?.();
  function dispose(){if(disposed)return;disposed=true;clearInterval(timer);ipcMain.removeHandler(CHANNEL);ipcMain.removeHandler(STATE);app.removeListener('before-quit',dispose);}
  app.once('before-quit',dispose);
  return{dispose};
}
function install(options){return createController({...options,electron:options.electron||require('electron')});}
function installPreload(electron=require('electron')){
  electron.contextBridge.exposeInMainWorld('petPanels',Object.freeze({host:process.env.CODEX_PET_HOST==='workbuddy'?'workbuddy':'codex',getState:()=>electron.ipcRenderer.invoke(STATE),onChanged:callback=>{const listener=(_event,value)=>callback(value);electron.ipcRenderer.on('codex-panels:changed',listener);return()=>electron.ipcRenderer.removeListener('codex-panels:changed',listener);},navigate:name=>electron.ipcRenderer.invoke(CHANNEL,name)}));
}
module.exports={createController,install,installPreload,CHANNEL};
