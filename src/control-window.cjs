'use strict';
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const L=require('./codex-locale.cjs');
const CHANNELS=Object.freeze({open:'codex-control:open',state:'codex-control:state',character:'codex-control:character',interaction:'codex-control:interaction',chatter:'codex-control:chatter',startup:'codex-control:startup',preview:'codex-control:preview',host:'codex-control:host',reload:'codex-control:reload',play:'codex-control:play'});
const SECTIONS=['character','actions','interaction','chatter','startup'];
const CHARACTER_IDS=['white-dragon','bluefish','curly-sheep'];
const own=(value,key)=>Object.hasOwn(value??{},key);
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>own(value,key)).map(key=>[key,value[key]]));
const TEXT={unauthorized:['此窗口不能修改设置。','This window cannot change settings.'],invalid_input:['请检查填写的内容。','Check the entered values.'],unavailable:['设置暂时无法读取，请重试。','Settings are unavailable. Try again.'],save_failed:['设置未能保存，请重试。','Settings could not be saved. Try again.'],config_conflict:['配置文件无法解析，未保存更改。','The configuration file could not be parsed. No changes were saved.'],host_unavailable:['当前联动应用不支持这项功能。','This feature is unavailable for the selected app.'],busy:['正在保存，请稍后再试。','A change is being saved. Try again shortly.'],task_busy:['请等当前任务结束后再保存或重载设置。','Wait for the current task to finish before saving or reloading settings.']};
const failure=code=>({ok:false,code,message:(TEXT[code]||TEXT.unavailable)[L.getLocale()==='zh-CN'?0:1]});
TEXT.play_failed=['暂时无法点播，请刷新动作列表后再试。','Could not play that action. Refresh the list and try again.'];
const fault=code=>Object.assign(new Error(code),{code});
const PET_FIELDS=['id','name','size','display','balanceEnabled','whisperEnabled','workStatusEnabled','fixedEnabled','position'];
const BOOLEAN_FIELDS=['fixedEnabled','workStatusEnabled','balanceEnabled','whisperEnabled'];
const PHYSICS_FIELDS=['gravity','restitution','groundFriction','ceilingBounce','throwPower','petCollision'];

/** 只投影当前分区要显示的状态；连接参数、人设正文和任意本机路径不进入管理页。 */
function characterCards(model,fileRoot) {
 return (Array.isArray(model?.characters)?model.characters:[]).filter(value=>CHARACTER_IDS.includes(value.id)).map(value=>{
  const profile=value.manifest?.profiles?.idle,asset=profile?.file?value.assets?.[profile.file]:null;
  const preview=asset?.available&&asset.type==='video'&&typeof asset.url==='string'&&asset.url.startsWith('file:')?{type:'video',url:asset.url}:value.id==='bluefish'&&value.originalVideo?{type:'video',url:pathToFileURL(path.resolve(fileRoot,'../../assets/webm/待机呼吸休闲.webm')).href}:null;
  return{id:value.id,name:String(value.copy?.name||value.label||value.id).slice(0,80),available:value.available?.q===true,originalVideo:value.originalVideo===true,preview};
 });
}
function interactionView(merged) {
 if(!record(merged)||!Array.isArray(merged.pets)||!merged.pets.length)throw fault('unavailable');
 return{pets:merged.pets.map(p=>pick(p,PET_FIELDS)),confineToScreen:merged.confineToScreen===true,physics:pick(merged.physics,PHYSICS_FIELDS)};
}
function chatterView(value){return pick(value,['enabled','automaticWhispers','whisperIntervalSec','maxTokens','timeoutMs']);}
function validInteraction(value) {
 if(!record(value)||typeof value.petId!=='string'||!value.petId||Object.keys(value).some(key=>!['petId','size',...BOOLEAN_FIELDS,'confineToScreen','position','physics'].includes(key)))return false;
 if(own(value,'size')&&(!Number.isFinite(value.size)||value.size<=0||value.size>4096))return false;
 for(const key of [...BOOLEAN_FIELDS,'confineToScreen'])if(own(value,key)&&typeof value[key]!=='boolean')return false;
 if(own(value,'position')){
  const p=value.position;if(!record(p)||Object.keys(p).some(key=>!['corner','marginX','marginY'].includes(key))||!['top-left','top-right','bottom-left','bottom-right'].includes(p.corner)||!Number.isFinite(p.marginX)||!Number.isFinite(p.marginY)||Math.abs(p.marginX)>100000||Math.abs(p.marginY)>100000)return false;
 }
 if(own(value,'physics')){
  const p=value.physics;if(!record(p)||Object.keys(p).length!==PHYSICS_FIELDS.length||PHYSICS_FIELDS.some(key=>!own(p,key))||Object.keys(p).some(key=>!PHYSICS_FIELDS.includes(key))||!Number.isFinite(p.gravity)||p.gravity<0||!Number.isFinite(p.restitution)||p.restitution<0||p.restitution>1||!Number.isFinite(p.groundFriction)||p.groundFriction<0||!Number.isFinite(p.throwPower)||p.throwPower<=0||typeof p.ceilingBounce!=='boolean'||typeof p.petCollision!=='boolean')return false;
 }
 return Object.keys(value).length>1;
}
function validChatter(value){return record(value)&&Object.keys(value).length>0&&Object.keys(value).every(key=>['enabled','automaticWhispers','whisperIntervalSec','maxTokens','timeoutMs'].includes(key))&&['enabled','automaticWhispers'].every(key=>!own(value,key)||typeof value[key]==='boolean')&&[['whisperIntervalSec',60,86400],['maxTokens',128,4096],['timeoutMs',1000,60000]].every(([key,min,max])=>!own(value,key)||Number.isInteger(value[key])&&value[key]>=min&&value[key]<=max);}

function createController({electron,hostRequest,apiRequest,skins,startup,petHost,actions,fileRoot=__dirname}) {
 if(typeof hostRequest!=='function'||typeof apiRequest!=='function'||!skins?.readModel||!skins?.select||!startup?.state||!startup?.setMode||!petHost?.get||!petHost?.select)throw new TypeError('control dependencies required');
 const {app,BrowserWindow,ipcMain}=electron,panelFile=path.join(fileRoot,'control-window.html'),panelUrl=pathToFileURL(panelFile).href,petUrl=pathToFileURL(path.join(fileRoot,'index.html')).href;
 let win=null,disposed=false,opening=null,busy=false;
 const owned=event=>!disposed&&win&&!win.isDestroyed()&&event?.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&Boolean(event.senderFrame)&&win.webContents.getURL()===panelUrl;
 const petSender=event=>{try{const url=new URL(event.sender.getURL());url.search='';url.hash='';return !disposed&&url.href===petUrl&&event.senderFrame===event.sender.mainFrame&&Boolean(BrowserWindow.fromWebContents(event.sender));}catch{return false;}};
 const hostState=()=>petHost.get();
 const codex=()=>hostState().host==='codex';
 const nativeHarness=()=>hostState().external===true;
 async function request(bridge,method,route,body){
  const response=await bridge(method,route,body===undefined?undefined:JSON.stringify(body));
  let data;try{data=typeof response.body==='string'?JSON.parse(response.body):response.body;}catch{throw fault('unavailable');}
  if(response?.status===409)throw fault(data?.error==='host_busy'||data?.error?.code==='host_busy'?'task_busy':'config_conflict');
  if(!response||response.status<200||response.status>=300)throw fault(method==='GET'?'unavailable':'save_failed');
  if(!record(data))throw fault('unavailable');return data;
 }
 async function editable(){
  const data=await request(apiRequest,'GET','/dsh-pet-7340/config/editable');
  if(!record(data.merged)||!Array.isArray(data.merged.pets)||!data.merged.pets.length||data.user!=null&&!record(data.user))throw fault('unavailable');
  return data;
 }
 async function state(section){
  if(!SECTIONS.includes(section))throw fault('invalid_input');
  const common={section,locale:L.getLocale(),host:hostState()};
  if(nativeHarness())return{...common,section:'startup',external:true,startup:startup.state()};
  if(section==='character'){const model=await skins.readModel();return{...common,selection:model.selection,characters:characterCards(model,fileRoot)};}
  if(section==='actions'){if(!actions?.state)throw fault('unavailable');return{...common,...actions.state()};}
  if(section==='interaction'){const data=await editable();return{...common,...interactionView(data.merged)};}
  if(section==='chatter'){if(!codex())throw fault('host_unavailable');return{...common,chatter:chatterView(await request(apiRequest,'GET','/standalone-ai/settings'))};}
  return{...common,startup:startup.state()};
 }
 async function saveInteraction(value){
  if(nativeHarness())throw fault('host_unavailable');
  if(!validInteraction(value))throw fault('invalid_input');
  // WorkBuddy没有AI碎念入口，也不能借互动保存改动Codex的碎念偏好。
  if(!codex()&&own(value,'whisperEnabled'))throw fault('host_unavailable');
  const {merged,user}=await editable();
  if(!merged.pets.some(p=>p.id===value.petId))throw fault('invalid_input');
  // 用户层是保存基底，必需值由未经过角色投影的成品补全；不固化生成的人设。
  const original=Array.isArray(user?.pets)?user.pets:merged.pets;
  const pets=original.map(raw=>{
   const defaults=merged.pets.find(p=>p.id===raw.id);if(!defaults)throw fault('invalid_input');
   const next={...pick(defaults,PET_FIELDS),...pick(raw,PET_FIELDS)};
   if(typeof raw.whisperPrompt==='string')next.whisperPrompt=raw.whisperPrompt;
   if(next.id===value.petId)Object.assign(next,pick(value,['size',...BOOLEAN_FIELDS,'position']));
   return next;
  });
  if(!pets.some(p=>p.id===value.petId))throw fault('invalid_input');
  const body={pets,...pick(value,['confineToScreen','physics'])};
  await request(apiRequest,'PUT','/dsh-pet-7340/config',body);
  // 上游保存会重建桌面Helper，此处只确认已受理，不再追加一次重载或恢复旧表单。
  return{ok:true,reloading:true};
 }
 async function mutate(event,fn){
  if(!owned(event))return failure('unauthorized');if(busy)return failure('busy');busy=true;
  try{return await fn();}catch(error){return failure(own(TEXT,error?.code)?error.code:'save_failed');}finally{busy=false;}
 }
 async function open(){
  if(disposed)throw new Error('unavailable');await app.whenReady();if(disposed)throw new Error('unavailable');if(opening)return opening;
  if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();return;}
  opening=(async()=>{
   const current=new BrowserWindow({width:1080,height:780,minWidth:760,minHeight:580,title:L.getLocale()==='zh-CN'?'Codex Pet · 设置':'Codex Pet · Settings',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(fileRoot,'control-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});
   win=current;current.setMenu?.(null);current.webContents.setWindowOpenHandler(()=>({action:'deny'}));current.webContents.on('will-navigate',event=>event.preventDefault());current.webContents.on('will-attach-webview',event=>event.preventDefault());current.webContents.session?.setPermissionRequestHandler?.((_contents,_permission,callback)=>callback(false));
   current.once('ready-to-show',()=>{if(!disposed&&!current.isDestroyed())current.show();});current.once('closed',()=>{if(win===current)win=null;});
   try{await current.loadFile(panelFile);if(disposed||current.isDestroyed())throw new Error('unavailable');}catch{if(!current.isDestroyed())current.destroy();throw new Error('unavailable');}
  })();try{await opening;}finally{opening=null;}
 }
 const handlers={
  [CHANNELS.state]:async(event,section)=>{if(!owned(event))return failure('unauthorized');try{return{ok:true,state:await state(section)};}catch(error){return failure(own(TEXT,error?.code)?error.code:'unavailable');}},
  [CHANNELS.character]:(event,character)=>mutate(event,async()=>{if(nativeHarness())throw fault('host_unavailable');if(!CHARACTER_IDS.includes(character))throw fault('invalid_input');await skins.select({character,mode:'q'});return{ok:true,state:await state('character')};}),
  [CHANNELS.play]:(event,value)=>mutate(event,async()=>{if(nativeHarness())throw fault('host_unavailable');if(!actions?.play)throw fault('play_failed');try{await actions.play(value);return{ok:true,playing:true};}catch(error){throw fault(error?.code==='invalid_input'?'invalid_input':'play_failed');}}),
  [CHANNELS.interaction]:(event,value)=>mutate(event,()=>saveInteraction(value)),
  [CHANNELS.chatter]:(event,value)=>mutate(event,async()=>{if(!codex())throw fault('host_unavailable');if(!validChatter(value))throw fault('invalid_input');return{ok:true,chatter:chatterView(await request(apiRequest,'POST','/standalone-ai/settings',value))};}),
  [CHANNELS.startup]:(event,mode)=>mutate(event,async()=>{if(nativeHarness())throw fault('host_unavailable');if(!['pet','startup','both'].includes(mode))throw fault('invalid_input');return{ok:true,startup:await startup.setMode(mode)};}),
  [CHANNELS.preview]:(event)=>mutate(event,async()=>{if(nativeHarness())throw fault('host_unavailable');return{ok:await startup.open('preview')===true};}),
  [CHANNELS.host]:(event,host)=>mutate(event,async()=>{if(!['codex','workbuddy','harness'].includes(host))throw fault('invalid_input');const result=await petHost.select(host);return{ok:true,host:result,...(result.cancelled?{cancelled:true}:{})};}),
  [CHANNELS.reload]:(event)=>mutate(event,async()=>{if(nativeHarness())throw fault('host_unavailable');await request(apiRequest,'POST','/dsh-pet-7340/reload');return{ok:true,reloading:true};}),
 };
 for(const[channel,handler]of Object.entries(handlers))ipcMain.handle(channel,handler);
 const openListener=event=>{if(petSender(event))void open().catch(()=>{});};ipcMain.on(CHANNELS.open,openListener);
 function dispose(){if(disposed)return;disposed=true;for(const channel of Object.keys(handlers))ipcMain.removeHandler(channel);ipcMain.removeListener(CHANNELS.open,openListener);app.removeListener('before-quit',dispose);if(win&&!win.isDestroyed())win.destroy();win=null;}
 app.once('before-quit',dispose);
 return{open,dispose,trayItems:()=>[{label:L.getLocale()==='zh-CN'?'控制中心':'Control center',click:()=>{void open().catch(()=>{});}}]};
}
function install(options){return createController({...options,electron:options.electron||require('electron')});}
function installPreload(electron=require('electron')){electron.contextBridge.exposeInMainWorld('codexControl',Object.freeze({open:()=>electron.ipcRenderer.send(CHANNELS.open)}));}
module.exports={createController,install,installPreload,CHANNELS};
