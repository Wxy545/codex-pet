'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url'),L=require('./codex-locale.cjs');
const CHANNELS={open:'pet-workbench:open',request:'pet-workbench:request',counts:'pet-workbench:counts',pin:'pet-workbench:pin'};
const BASE='/dsh-pet-7340',hosts=['codex','workbuddy','harness'],purposes=['chat','whisper','qq-chat','translation','summary','image','task','memory'];
const record=v=>v&&typeof v==='object'&&!Array.isArray(v),only=(v,keys)=>record(v)&&Object.keys(v).every(k=>keys.includes(k));
function validRequest(v){
 if(!record(v))return false;
 if(v.kind==='tasks'){
  if(!only(v,['kind','action','id','until','filter']))return false;
  if(v.action==='list')return v.filter===undefined||only(v.filter,['host','source','state','attention']);
  return['open','cancel','result','artifact','read','pending','snooze'].includes(v.action)&&/^[a-f0-9]{64}$/.test(v.id)&&(v.until===undefined||Number.isFinite(v.until));
 }
 if(v.kind==='models')return only(v,['kind','action','host','purpose','model','effort'])&&['state','catalog','save'].includes(v.action)&&(v.host===undefined||hosts.includes(v.host))&&(v.action!=='save'||purposes.includes(v.purpose)&&(v.model===null||typeof v.model==='string'&&v.model.length<=100)&&(v.effort===null||['none','minimal','low','medium','high','xhigh','max','ultra'].includes(v.effort)));
 return false;
}
/** 所有列表来源和动作都经固定私有路由；前端不能提供路径、协议或执行参数。 */
function createController({electron,hostRequest,fileRoot=__dirname,host=()=> 'codex',canUse=()=>true}){
 const{app,BrowserWindow,ipcMain,shell,screen,dialog}=electron;let win,opening,disposed=false,pinned=false;
 const file=path.join(fileRoot,'workbench-window.html'),url=pathToFileURL(file).href,petUrl=pathToFileURL(path.join(fileRoot,'index.html')).href;
 const owned=e=>!disposed&&win&&!win.isDestroyed()&&e.sender===win.webContents&&e.senderFrame===e.sender.mainFrame&&e.sender.getURL()===url;
 const pet=e=>{try{const u=new URL(e.sender.getURL());u.hash='';u.search='';return!disposed&&e.senderFrame===e.sender.mainFrame&&u.href===petUrl&&Boolean(BrowserWindow.fromWebContents(e.sender));}catch{return false;}};
 const fail=code=>({ok:false,code,message:L.getLocale()==='zh-CN'?'操作未完成，请刷新后重试。':'Could not complete this action. Refresh and try again.'});
 async function request(method,route,body){const r=await hostRequest(method,BASE+route,body===undefined?undefined:JSON.stringify(body));let value;try{value=JSON.parse(r.body);}catch{throw Error('unavailable');}if(r.status!==200)throw Object.assign(Error('unavailable'),{code:value?.error?.code});return value;}
 async function open({compact=false,anchor}={}){
  if(disposed||!canUse())throw Error('unavailable');await app.whenReady();if(opening)return opening;
  if(win&&!win.isDestroyed()){if(compact&&win.isVisible?.()&&!pinned){win.hide();return;}win.show();if(!compact)win.focus();return;}
  opening=(async()=>{const w=new BrowserWindow({width:compact?520:1080,height:compact?570:780,minWidth:500,minHeight:480,show:false,alwaysOnTop:compact,autoHideMenuBar:true,title:L.getLocale()==='zh-CN'?'Codex Pet · 任务列表':'Codex Pet · Task list',webPreferences:{preload:path.join(fileRoot,'workbench-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});win=w;
   w.setMenu?.(null);w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());w.webContents.on('will-attach-webview',e=>e.preventDefault());w.webContents.session?.setPermissionRequestHandler?.((_s,_p,cb)=>cb(false));
   w.on('blur',()=>{if(compact&&!pinned&&!w.isDestroyed())w.hide();});w.once('closed',()=>{if(win===w)win=null;pinned=false;});
   try{await w.loadFile(file);}catch(error){
    // 加载失败的隐藏窗口不能留在单例里，否则重开会显示空窗口而不再加载。
    if(win===w)win=null;if(!w.isDestroyed())w.destroy();throw error;
   }if(disposed||w.isDestroyed())return;
   if(compact&&anchor&&screen?.getDisplayMatching){const area=screen.getDisplayMatching(anchor).workArea;w.setBounds({width:520,height:570,x:Math.max(area.x,Math.min(area.x+area.width-520,anchor.x+anchor.width-520)),y:Math.max(area.y,Math.min(area.y+area.height-570,anchor.y-570))});}
   w.showInactive?.();if(!compact){w.show();w.focus();}
  })();try{await opening;}finally{opening=null;}
 }
 const handlers={
  [CHANNELS.request]:async(e,v)=>{if(!owned(e))return fail('unauthorized');if(!validRequest(v))return fail('invalid_input');try{
   if(v.kind==='models'){
    if(v.action==='state')return{ok:true,locale:L.getLocale(),host:host(),policy:await request('GET','/pet-model-policy')};
    const{kind,...body}=v;return{ok:true,value:await request('POST','/pet-model-policy',body)};
   }
   const{kind,...body}=v;
   if(v.action==='cancel'){const confirm=await dialog.showMessageBox(win,{type:'question',buttons:L.getLocale()==='zh-CN'?['返回','取消任务']:['Back','Cancel task'],defaultId:0,cancelId:0,message:L.getLocale()==='zh-CN'?'停止这条任务？':'Stop this task?'});if(confirm.response!==1||!owned(e))return{ok:true,cancelled:true};}
   const result=await request('POST','/pet-workspace/tasks',body);
   if(v.action==='open'){
    if(result?.open?.host==='codex'&&/^[A-Za-z0-9_-]{1,160}$/.test(result.open.threadId))await shell.openExternal('codex://threads/'+encodeURIComponent(result.open.threadId));
    else if(result?.open?.host==='workbuddy')await require('./codex-startup.cjs').createTargetRequest({host:'workbuddy',fileRoot})('focus');
    else return fail('action_unavailable');
   }
   return{ok:true,value:result};
  }catch(error){return fail(error.code||'unavailable');}},
  [CHANNELS.counts]:async e=>{if(!pet(e)&&!owned(e))return fail('unauthorized');try{const data=await request('GET','/pet-workspace/tasks');return{ok:true,activeCount:data.activeCount,pendingCount:data.pendingCount,locale:L.getLocale()};}catch{return fail('unavailable');}},
  [CHANNELS.pin]:(e,v)=>{if(!owned(e)||typeof v!=='boolean')return fail('unauthorized');pinned=v;win.setAlwaysOnTop?.(v);return{ok:true,pinned};},
 };
 for(const[k,v]of Object.entries(handlers))ipcMain.handle(k,v);
 const listener=e=>{if(pet(e)){const source=BrowserWindow.fromWebContents(e.sender);void open({compact:true,anchor:source?.getBounds?.()}).catch(()=>{});}};ipcMain.on(CHANNELS.open,listener);
 function dispose(){if(disposed)return;disposed=true;for(const key of Object.keys(handlers))ipcMain.removeHandler(key);ipcMain.removeListener(CHANNELS.open,listener);app.removeListener('before-quit',dispose);if(win&&!win.isDestroyed())win.destroy();}
 app.once('before-quit',dispose);return{open,dispose,hide:()=>win?.hide()};
}
function install(options){return createController({...options,electron:options.electron||require('electron')});}
function installPreload(electron=require('electron')){const{contextBridge,ipcRenderer}=electron;contextBridge.exposeInMainWorld('petWorkbench',Object.freeze({open:()=>ipcRenderer.send(CHANNELS.open),counts:()=>ipcRenderer.invoke(CHANNELS.counts)}));}
module.exports={install,installPreload,createController,validRequest,CHANNELS};
