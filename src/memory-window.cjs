'use strict';
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const L=require('./codex-locale.cjs');
const ROUTE='/dsh-pet-7340/pet-memory';
const ROLE_ROUTE='/dsh-pet-7340/pet-role/settings';
const CHANNELS=Object.freeze({open:'codex-memory:open',scopes:'codex-memory:scopes',request:'codex-memory:request',export:'codex-memory:export',settings:'codex-memory:settings'});
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const only=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
const scopeId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const id=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const bounded=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const ticket=value=>only(value,['scope','revision'])&&/^[a-f0-9]{64}$/.test(value.scope)&&Number.isSafeInteger(value.revision)&&value.revision>=0;
const COPY={unauthorized:['此窗口不能管理记忆。','This window cannot manage memories.'],invalid_input:['记忆操作参数无效。','The memory request is invalid.'],scope_unavailable:['此记忆范围已不可用，请刷新。','This memory scope is no longer available. Refresh the list.'],memory_stale:['记忆已变化，请刷新后重试。','Memories changed. Refresh before trying again.'],busy:['正在处理上一项操作。','Another operation is still in progress.'],unavailable:['暂时无法读取记忆，请重试。','Memories could not be loaded. Try again.'],save_failed:['未能保存记忆导出文件。','The memory export could not be saved.']};
const phrase=(zh,en)=>L.getLocale()==='zh-CN'?zh:en;
function failure(code){const key=Object.hasOwn(COPY,code)?code:'unavailable';return{ok:false,code:key,locale:L.getLocale(),message:COPY[key][L.getLocale()==='zh-CN'?0:1]};}
function validBody(body){
 if(!record(body)||!scopeId(body.scopeId))return false;
 const common=['action','scopeId'];
 if(body.action==='summarize')return only(body,[...common,'id','ticket'])&&id(body.id)&&ticket(body.ticket);
 if(body.action==='query')return only(body,[...common,'query','limit','offset','id','includeText','includeSuperseded','maxChars'])&&(body.query===undefined||typeof body.query==='string'&&body.query.length<=2048)&&(body.limit===undefined||bounded(body.limit,1,32))&&(body.offset===undefined||bounded(body.offset,0,2000))&&(body.id===undefined||id(body.id))&&(body.includeText===undefined||typeof body.includeText==='boolean')&&(body.includeSuperseded===undefined||typeof body.includeSuperseded==='boolean')&&(body.maxChars===undefined||bounded(body.maxChars,128,32768));
 if(body.action==='context')return only(body,[...common,'query','mode'])&&(body.query===undefined||typeof body.query==='string'&&body.query.length<=2048)&&(body.mode===undefined||['last-used','preview'].includes(body.mode));
 if(body.action==='correct')return only(body,[...common,'id','text','ticket'])&&id(body.id)&&typeof body.text==='string'&&body.text.trim().length>0&&body.text.length<=16384&&ticket(body.ticket);
 if(body.action==='remove')return only(body,[...common,'ids','ticket'])&&Array.isArray(body.ids)&&body.ids.length>0&&body.ids.length<=32&&body.ids.every(id)&&ticket(body.ticket);
 if(body.action==='clear')return only(body,[...common,'ticket'])&&ticket(body.ticket);
 if(body.action==='retention')return only(body,[...common,'days','ticket'])&&(body.days===null||bounded(body.days,1,3650))&&ticket(body.ticket);
 return false;
}
function entry(value){
 if(!record(value)||!id(value.id)||!['user','assistant','event'].includes(value.role)||!['active','superseded'].includes(value.status))return null;
 const view={id:value.id,role:value.role,status:value.status,createdAt:typeof value.createdAt==='string'?value.createdAt.slice(0,64):'',text:typeof value.text==='string'?value.text.slice(0,16384):'',truncated:value.truncated===true};
 if(record(value.summary))view.summary={text:typeof value.summary.text==='string'?value.summary.text.slice(0,512):'',method:['extractive','injected','invalidated'].includes(value.summary.method)?value.summary.method:'unknown'};
 if(record(value.source)){const source={};for(const key of ['kind','id','conversation','message','speaker','label','url','materials','confirmation','at'])if(typeof value.source[key]==='string')source[key]=value.source[key].slice(0,key==='url'?2048:200);view.source=source;}
 for(const key of ['corrects','replacedBy'])if(id(value[key]))view[key]=value[key];
 return view;
}
function resultOf(payload){
 if(!record(payload))throw Error('unavailable');const result={ok:true,locale:L.getLocale()};
 if(payload.ticket!==undefined){if(!ticket(payload.ticket))throw Error('unavailable');result.ticket={scope:payload.ticket.scope,revision:payload.ticket.revision};}
 if(Array.isArray(payload.items)){if(payload.items.length>32)throw Error('unavailable');result.items=payload.items.map(entry);if(result.items.some(item=>!item))throw Error('unavailable');result.total=bounded(payload.total,0,2000)?payload.total:result.items.length;}
 if(payload.record!==undefined){result.record=entry(payload.record);if(!result.record)throw Error('unavailable');}
 if(payload.retentionDays===null||bounded(payload.retentionDays,1,3650))result.retentionDays=payload.retentionDays;
 if(payload.days===null||bounded(payload.days,1,3650))result.retentionDays=payload.days;
 if(typeof payload.context==='string'&&payload.context.length<=32768){result.context=payload.context;result.used=payload.used===true;result.selectedIds=Array.isArray(payload.selectedIds)?payload.selectedIds.filter(id).slice(0,32):[];}
 if(Number.isInteger(payload.removed)&&payload.removed>=0)result.removed=payload.removed;
 return result;
}
/** 导出仍只投影记忆格式；宿主附加的设置、凭据和运行信息不进入用户文件。 */
function exportOf(payload){
 if(payload?.schemaVersion!==1||!Array.isArray(payload.records)||payload.records.length>2000)throw Error('unavailable');
 const records=payload.records.map(raw=>{const view=entry(raw);if(!view||typeof raw.text!=='string'||raw.text.length>16384)throw Error('unavailable');view.relatedIds=Array.isArray(raw.relatedIds)?raw.relatedIds.filter(id).slice(0,12):[];view.derivedFrom=Array.isArray(raw.derivedFrom)?raw.derivedFrom.filter(id).slice(0,32):[];if(record(raw.summary))view.summary={...view.summary,keywords:Array.isArray(raw.summary.keywords)?raw.summary.keywords.filter(x=>typeof x==='string'&&x.length<=64).slice(0,24):[],sourceIds:Array.isArray(raw.summary.sourceIds)?raw.summary.sourceIds.filter(id).slice(0,16):[]};return view;});
 const result={schemaVersion:1,records};if(record(payload.scope)){result.scope={};for(const key of ['host','profile','channel','account','audience','actor','character','project'])if(scopeId(payload.scope[key])||payload.scope[key]===null)result.scope[key]=payload.scope[key];}if(typeof payload.createdAt==='string')result.createdAt=payload.createdAt.slice(0,64);if(payload.retentionDays===null||bounded(payload.retentionDays,1,3650))result.retentionDays=payload.retentionDays;return result;
}
function roleSettings(payload){
 if(payload?.schemaVersion!==1||!Number.isSafeInteger(payload.revision)||payload.revision<0||!record(payload.hosts))throw Error('unavailable');
 const hosts={};for(const host of ['codex','workbuddy','harness']){const value=payload.hosts[host];if(!record(value)||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.shareOwnerMemory!=='boolean'||!['task','role'].includes(value.qqMode))throw Error('unavailable');hosts[host]={revision:value.revision,shareOwnerMemory:value.shareOwnerMemory,qqMode:value.qqMode};}
 return{schemaVersion:1,revision:payload.revision,hosts};
}

function createController({hostRequest,electron,fileRoot=__dirname,fsImpl={}}){
 if(typeof hostRequest!=='function')throw TypeError('hostRequest is required');
 const{app,BrowserWindow,ipcMain,dialog}=electron,io={...fs,...fsImpl},file=path.join(fileRoot,'memory-window.html'),url=pathToFileURL(file).href,petUrl=pathToFileURL(path.join(fileRoot,'index.html')).href;
 let win=null,opening=null,disposed=false,busy=false;
 const owned=event=>!disposed&&win&&!win.isDestroyed()&&event?.sender===win.webContents&&(!win.webContents.mainFrame||event.senderFrame===win.webContents.mainFrame)&&win.webContents.getURL()===url;
 const petSender=event=>{try{return!disposed&&event?.sender&&!event.sender.isDestroyed?.()&&(!event.sender.mainFrame||event.senderFrame===event.sender.mainFrame)&&new URL(event.sender.getURL()).pathname===new URL(petUrl).pathname&&new URL(event.sender.getURL()).protocol==='file:'&&Boolean(BrowserWindow.fromWebContents(event.sender));}catch{return false;}};
 async function request(method,route,body){const response=await hostRequest(method,route,body===undefined?undefined:JSON.stringify(body));let payload;try{payload=typeof response?.body==='string'?JSON.parse(response.body):response?.body;}catch{throw Error('unavailable');}if(!response||response.status<200||response.status>=300){const code=payload?.error?.code;throw Object.assign(Error(Object.hasOwn(COPY,code)?code:'unavailable'),{code:Object.hasOwn(COPY,code)?code:'unavailable'});}return payload;}
 async function scopes(){const payload=await request('GET',ROUTE+'/scopes');if(!Array.isArray(payload?.scopes)||payload.scopes.length>512)throw Error('unavailable');const seen=new Set(),items=payload.scopes.map(item=>{if(!scopeId(item?.scopeId)||seen.has(item.scopeId)||typeof item.label!=='string'||item.label.length>200)throw Error('unavailable');seen.add(item.scopeId);return{scopeId:item.scopeId,label:item.label};});return{ok:true,locale:L.getLocale(),scopes:items};}
 async function allowed(event,value){if(!owned(event))return false;const current=await scopes();return owned(event)&&current.scopes.some(item=>item.scopeId===value);}
 async function confirm(event,action){if(!owned(event))return false;const cleared=action==='clear',exported=action==='export';const answer=await dialog.showMessageBox(win,{type:exported?'question':'warning',buttons:[phrase('取消','Cancel'),exported?phrase('导出','Export'):phrase('删除','Delete')],defaultId:0,cancelId:0,noLink:true,message:exported?phrase('导出此范围的聊天原文和来源到 JSON 文件？','Export this scope’s original messages and sources to a JSON file?'):cleared?phrase('删除此范围的全部记忆？原文与索引都会删除。','Delete every memory in this scope? Original messages and their index will be deleted.'):phrase('删除选中的记忆及由其生成的回复？原文与相关索引都会删除。','Delete the selected memories, replies derived from them, and their index entries?')});return owned(event)&&answer.response===1;}
 async function mutation(event,body,action){if(!owned(event))return failure('unauthorized');if(busy)return failure('busy');busy=true;try{return await action();}catch(error){return failure(error.code??error.message);}finally{busy=false;}}
 async function open(){
  if(disposed)throw Error('unavailable');await app.whenReady();if(disposed)throw Error('unavailable');if(opening)return opening;if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();return;}
  opening=(async()=>{const current=new BrowserWindow({width:1080,height:780,minWidth:560,minHeight:560,title:phrase('Codex Pet · 记忆','Codex Pet · Memory'),show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(fileRoot,'memory-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});win=current;current.setMenu?.(null);current.webContents.setWindowOpenHandler(()=>({action:'deny'}));current.webContents.on('will-navigate',event=>event.preventDefault());current.webContents.on('will-attach-webview',event=>event.preventDefault());current.webContents.session?.setPermissionRequestHandler?.((_sender,_permission,callback)=>callback(false));current.once('ready-to-show',()=>{if(!disposed&&!current.isDestroyed())current.show();});current.once('closed',()=>{if(win===current)win=null;});try{await current.loadFile(file);if(disposed||current.isDestroyed())throw Error('unavailable');}catch(error){if(!current.isDestroyed())current.destroy();throw error;}})();try{await opening;}finally{opening=null;}
 }
 const handlers={
  [CHANNELS.settings]:async(event,body)=>{if(!owned(event))return failure('unauthorized');const get=only(body,['action'])&&body.action==='get',save=only(body,['action','host','revision','shareOwnerMemory','qqMode'])&&body.action==='save'&&['codex','workbuddy','harness'].includes(body.host)&&Number.isSafeInteger(body.revision)&&body.revision>=0&&typeof body.shareOwnerMemory==='boolean'&&['task','role'].includes(body.qqMode);if(!get&&!save)return failure('invalid_input');return mutation(event,body,async()=>{const payload=get?await request('GET',ROLE_ROUTE):await request('POST',ROLE_ROUTE,{host:body.host,revision:body.revision,shareOwnerMemory:body.shareOwnerMemory,qqMode:body.qqMode});return owned(event)?{ok:true,settings:roleSettings(payload),locale:L.getLocale()}:failure('unauthorized');});},
  [CHANNELS.scopes]:async event=>{if(!owned(event))return failure('unauthorized');try{const value=await scopes();return owned(event)?value:failure('unauthorized');}catch(error){return failure(error.code??error.message);}},
  [CHANNELS.request]:async(event,body)=>{if(!owned(event))return failure('unauthorized');if(!validBody(body))return failure('invalid_input');return mutation(event,body,async()=>{if(!await allowed(event,body.scopeId))return failure('scope_unavailable');if(['remove','clear'].includes(body.action)&&!await confirm(event,body.action))return{ok:true,cancelled:true};if(!await allowed(event,body.scopeId))return failure('scope_unavailable');const payload=await request('POST',ROUTE,body);return owned(event)?resultOf(payload):failure('unauthorized');});},
  [CHANNELS.export]:async(event,body)=>{if(!owned(event))return failure('unauthorized');if(!only(body,['scopeId'])||!scopeId(body.scopeId))return failure('invalid_input');return mutation(event,body,async()=>{
   if(!await allowed(event,body.scopeId))return failure('scope_unavailable');if(!await confirm(event,'export'))return{ok:true,cancelled:true};const selected=await dialog.showSaveDialog(win,{title:phrase('导出记忆','Export memories'),defaultPath:'Codex-Pet-memory.json',filters:[{name:'JSON',extensions:['json']}],properties:['showOverwriteConfirmation','dontAddToRecent']});if(!owned(event))return failure('unauthorized');if(selected.canceled||!selected.filePath)return{ok:true,cancelled:true};if(!path.isAbsolute(selected.filePath))return failure('invalid_input');if(!await allowed(event,body.scopeId))return failure('scope_unavailable');
   const payload=await request('POST',ROUTE+'/export',{scopeId:body.scopeId});const serialized=JSON.stringify(exportOf(payload),null,2)+'\n';if(Buffer.byteLength(serialized)>25*1024*1024)return failure('save_failed');if(!await allowed(event,body.scopeId))return failure('scope_unavailable');
   try{const existing=await io.lstat(selected.filePath);if(!existing.isFile()||existing.isSymbolicLink()||existing.nlink!==1)return failure('save_failed');}catch(error){if(error.code!=='ENOENT')return failure('save_failed');}
   const temporary=selected.filePath+'.tmp-'+randomUUID();try{await io.writeFile(temporary,serialized,{flag:'wx',mode:0o600});if(!owned(event))return failure('unauthorized');await io.rename(temporary,selected.filePath);}catch{return failure('save_failed');}finally{await io.unlink(temporary).catch(()=>{});}return{ok:true,fileName:path.basename(selected.filePath)};
  });},
 };
 for(const[channel,handler]of Object.entries(handlers))ipcMain.handle(channel,handler);
 const openListener=event=>{if(petSender(event))void open().catch(()=>{});};ipcMain.on(CHANNELS.open,openListener);
 function dispose(){if(disposed)return;disposed=true;for(const channel of Object.keys(handlers))ipcMain.removeHandler(channel);ipcMain.removeListener(CHANNELS.open,openListener);app.removeListener('before-quit',dispose);if(win&&!win.isDestroyed())win.destroy();win=null;}
 app.once('before-quit',dispose);return{open,hide:()=>win?.hide?.(),dispose};
}
function install(options){return createController({...options,electron:options.electron??require('electron')});}
function installPreload(electron=require('electron')){electron.contextBridge.exposeInMainWorld('codexMemory',Object.freeze({open:()=>electron.ipcRenderer.send(CHANNELS.open)}));}
module.exports={createController,install,installPreload,CHANNELS,validBody};
