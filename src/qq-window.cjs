'use strict';
const path=require('node:path');
const fs=require('node:fs/promises');
const {pathToFileURL}=require('node:url');
const L=require('./codex-locale.cjs');
const API='/dsh-pet-7340/qq-remote';
const CHANNELS=Object.freeze({open:'codex-qq:open',state:'codex-qq:state',directory:'codex-qq:directory',save:'codex-qq:save',action:'codex-qq:action',project:'codex-qq:project',platform:'codex-qq:platform',copyPairing:'codex-qq:copy-pairing'});
const text=(zh,en)=>L.getLocale()==='zh-CN'?zh:en;
const ERRORS={
 unauthorized:['此窗口不能执行这项操作。','This window cannot perform that action.'],
 invalid_input:['请填写机器人信息并选择项目权限。','Enter your bot details and choose project permissions.'],
 invalid_secret:['AppSecret 不正确，请重新填写。','The AppSecret is invalid. Enter it again.'],
 invalid_cwd:['项目文件夹已变化或不可用，请重新选择。','The project folder changed or is unavailable. Choose it again.'],
 invalid_directory:['项目文件夹已变化或不可用，请重新选择。','The project folder changed or is unavailable. Choose it again.'],
 busy:['请等当前任务或设置操作结束后重试。','Wait for the current task or settings change to finish.'],
 task_busy:['请先等待当前 QQ 任务结束，或在 QQ 中取消任务。','Wait for the QQ task to finish, or cancel it in QQ.'],
 invalid_project:['这个项目已不可用，请刷新后重新选择。','This project is unavailable. Refresh and choose it again.'],
 not_configured:['请先保存机器人和项目设置。','Save the bot and project settings first.'],
 already_paired:['当前 QQ 已绑定，请先解绑再更换账号。','A QQ account is already paired. Unpair it before choosing another account.'],
 secret_required:['请填写这个机器人的 AppSecret。','Enter the AppSecret for this bot.'],
 secret_store_unavailable:['无法安全保存密钥，请重试。','The secret could not be saved securely. Try again.'],
 connection_failed:['连接失败，请检查机器人信息和网络。','Connection failed. Check your bot details and network.'],
 storage_failed:['设置未能保存，请检查本机文件访问权限。','Settings could not be saved. Check local file access permissions.'],
 host_unavailable:['暂时无法连接桌宠，请重试。','The pet is unavailable. Try again.'],
 host_unavailable_for_qq:['请先将桌宠联动应用切换为 Codex。','Select Codex as the companion app first.'],
 cancelled:['已取消。','Cancelled.'],
};
const connectionCodes=new Set(['invalid_credentials','invalid_secret','qq_auth_failed','token_failed','gateway_failed','gateway_unavailable','network_error','disconnected','reconnect_failed','not_configured','host_unavailable','connection_failed','storage_failed']);
const connectionStates=new Set(['connecting','connected','error','stopped','disconnected','reconnecting']);
const taskStates=new Set(['idle','thinking','working','waiting','result','success','error','running','cancelling','completed','cancelled','failed','interrupted']);
const samePath=(a,b)=>process.platform==='win32'?String(a).toLowerCase()===String(b).toLowerCase():a===b;
const projectId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value);
const failure=code=>{const known=Object.hasOwn(ERRORS,code)?code:'host_unavailable';return{ok:false,code:known,message:text(...ERRORS[known]),locale:L.getLocale()};};

function publicProject(value){
 const cwd=typeof value?.cwd==='string'&&path.isAbsolute(value.cwd)&&value.cwd.length<=32768?value.cwd:'';
 const permission=value?.permission==='workspace-write'?'workspace-write':'read-only';
 return{id:projectId(value?.id)?value.id:'',label:typeof value?.label==='string'?value.label.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,100):path.basename(cwd),cwd,permission,maxPermission:(value?.maxPermission??permission)==='workspace-write'?'workspace-write':'read-only'};
}

/** 密钥、QQ身份和任务正文不属于设置页状态，始终按字段白名单投影。 */
function sanitizeState(value){
 if(!value||typeof value!=='object')return null;
 const state={enabled:value.enabled===true,configured:value.configured===true,hasSecret:value.hasSecret===true||value.configured===true,appId:typeof value.appId==='string'&&/^\d{3,32}$/.test(value.appId)?value.appId:'',paired:value.paired===true,
  connection:{state:connectionStates.has(value.connection?.state)?value.connection.state:'error'},
  project:publicProject(value.project),
  projects:Array.isArray(value.projects)?value.projects.slice(0,64).map(publicProject).filter(item=>item.id&&item.cwd):[],
  pairing:null,task:taskStates.has(value.task?.state)?{state:value.task.state}:null,
  pendingReplies:Number.isInteger(value.pendingReplies)&&value.pendingReplies>=0?Math.min(value.pendingReplies,10000):0,locale:L.getLocale()};
 if(connectionCodes.has(value.connection?.code))state.connection.code=value.connection.code;
 if(typeof value.pairing?.code==='string'&&/^\d{6}$/.test(value.pairing.code)&&typeof value.pairing.expiresAt==='string'&&value.pairing.expiresAt.length<=40&&Number.isFinite(Date.parse(value.pairing.expiresAt)))state.pairing={code:value.pairing.code,expiresAt:value.pairing.expiresAt};
 return state;
}

function createController({electron,hostRequest,fileRoot=__dirname,fsImpl={},canUse=()=>true}){
 if(typeof hostRequest!=='function')throw new TypeError('hostRequest is required');
 const {app,BrowserWindow,ipcMain,dialog,shell,clipboard}=electron;
 const io={realpath:fs.realpath,stat:fs.stat,...fsImpl};
 const panelFile=path.join(fileRoot,'qq-window.html'),panelUrl=pathToFileURL(panelFile).href,petUrl=pathToFileURL(path.join(fileRoot,'index.html')).href;
 let win=null,selectedDirectory='',selectedProjectId='',directoryDraft=false,pending=false,disposed=false,opening=null;
 const available=()=>{try{return !disposed&&canUse()===true;}catch{return false;}};
 const owned=event=>Boolean(available()&&win&&!win.isDestroyed()&&event?.sender===win.webContents&&(!win.webContents.mainFrame||event.senderFrame===win.webContents.mainFrame)&&win.webContents.getURL()===panelUrl);
 const petSender=event=>{try{return Boolean(event?.sender&&!event.sender.isDestroyed?.()&&(!event.sender.mainFrame||event.senderFrame===event.sender.mainFrame)&&new URL(event.sender.getURL()).protocol==='file:'&&new URL(event.sender.getURL()).pathname===new URL(petUrl).pathname&&BrowserWindow.fromWebContents(event.sender));}catch{return false;}};
 async function request(method,body){
  if(!available())return failure('unauthorized');
  try{
   const response=await hostRequest(method,API,body===undefined?undefined:JSON.stringify(body));
   if(!available())return failure('unauthorized');
   const payload=typeof response?.body==='string'?JSON.parse(response.body):response?.body;
   if(!response||response.status<200||response.status>=300)return failure(payload?.error?.code);
   const snapshot=sanitizeState(payload);if(!snapshot)return failure('host_unavailable');
   if(!directoryDraft&&(!selectedDirectory||selectedProjectId!==snapshot.project.id))selectedDirectory=snapshot.project.cwd;
   selectedProjectId=snapshot.project.id;
   return{ok:true,snapshot,selectedDirectory};
  }catch{return failure('host_unavailable');}
 }
 async function open(){
  if(!available())throw new Error('unavailable');await app.whenReady();if(!available())throw new Error('unavailable');
  if(opening)return opening;
  if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();return;}
  // 复用在途加载；页面没有成功打开时，导航不能把来源窗口隐藏。
  opening=(async()=>{
  const current=new BrowserWindow({width:940,height:820,minWidth:540,minHeight:600,title:text('Codex Pet · QQ 远程任务','Codex Pet · QQ remote tasks'),backgroundColor:'#15171c',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(fileRoot,'qq-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});win=current;
  current.setMenu?.(null);current.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  current.webContents.on('will-navigate',(event,url)=>{if(url!==panelUrl)event.preventDefault();});current.webContents.on('will-attach-webview',event=>event.preventDefault());
  current.once('ready-to-show',()=>{if(available()&&!current.isDestroyed())current.show();});
  current.once('closed',()=>{if(win===current)win=null;});
  try{await current.loadFile(panelFile);if(!available()||current.isDestroyed())throw new Error('unavailable');}catch{if(!current.isDestroyed())current.destroy();throw new Error('unavailable');}
  })();try{await opening;}finally{opening=null;}
 }
 const handlers={
  [CHANNELS.state]:async event=>owned(event)?request('GET'):failure('unauthorized'),
  [CHANNELS.platform]:async event=>{if(!owned(event))return failure('unauthorized');try{await shell.openExternal('https://q.qq.com/');return{ok:true};}catch{return failure('host_unavailable');}},
  [CHANNELS.copyPairing]:async event=>{
   if(!owned(event))return failure('unauthorized');const current=await request('GET');if(!current.ok)return current;
   const pairing=current.snapshot.pairing;if(!pairing||Date.parse(pairing.expiresAt)<=Date.now())return failure('not_configured');
   try{clipboard.writeText(text('/配对 ','/pair ')+pairing.code);return{ok:true};}catch{return failure('host_unavailable');}
  },
  [CHANNELS.directory]:async event=>{
   if(!owned(event))return failure('unauthorized');if(pending)return failure('busy');
   try{
    const chosen=await dialog.showOpenDialog(win,{title:text('选择 QQ 任务使用的项目','Choose a project for QQ tasks'),buttonLabel:text('使用这个文件夹','Use this folder'),properties:['openDirectory','dontAddToRecent'],...(selectedDirectory?{defaultPath:selectedDirectory}:{})});
    if(chosen.canceled||chosen.filePaths.length!==1)return{ok:true,cancelled:true,directory:selectedDirectory};
    const directory=await io.realpath(chosen.filePaths[0]);if(!path.isAbsolute(directory)||!(await io.stat(directory)).isDirectory())return failure('invalid_cwd');
    if(!owned(event))return failure('unauthorized');if(pending)return failure('busy');selectedDirectory=directory;directoryDraft=true;return{ok:true,directory};
   }catch{return failure('invalid_cwd');}
  },
  [CHANNELS.save]:async(event,body)=>{
   if(!owned(event))return failure('unauthorized');if(pending)return failure('busy');
   if(!body||typeof body!=='object'||Object.keys(body).some(key=>!['appId','appSecret','cwd','permission','enabled'].includes(key))||typeof body.appId!=='string'||!/^\d{3,32}$/.test(body.appId)||!['read-only','workspace-write'].includes(body.permission)||typeof body.enabled!=='boolean'||(body.appSecret!==undefined&&(typeof body.appSecret!=='string'||body.appSecret.length>4096||/[\u0000-\u001f]/.test(body.appSecret))))return failure('invalid_input');
   if(!selectedDirectory||!samePath(body.cwd,selectedDirectory))return failure('invalid_cwd');
   const directory=selectedDirectory;pending=true;
   try{
    const canonical=await io.realpath(directory);if(!samePath(canonical,directory)||!(await io.stat(canonical)).isDirectory())return failure('invalid_cwd');
    const result=await request('POST',{action:'save',appId:body.appId,...(body.appSecret?{appSecret:body.appSecret}:{}),cwd:directory,permission:body.permission,enabled:body.enabled});
    if(result.ok){directoryDraft=false;selectedDirectory=result.snapshot.project.cwd;selectedProjectId=result.snapshot.project.id;}
    return result;
   }catch{return failure('invalid_cwd');}finally{pending=false;}
  },
  [CHANNELS.project]:async(event,body)=>{
   if(!owned(event))return failure('unauthorized');if(pending)return failure('busy');
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||!['select','remove'].includes(body.action)||!projectId(body.projectId))return failure('invalid_input');
   pending=true;
   try{
    // 项目由本机文件选择器登记；页面只能引用本次服务状态中的项目，不能提交任意路径。
    const current=await request('GET');if(!current.ok)return current;
    const project=current.snapshot.projects.find(item=>item.id===body.projectId);if(!project)return failure('invalid_project');
    if(body.action==='remove'){
     const answer=await dialog.showMessageBox(win,{type:'question',buttons:[text('取消','Cancel'),text('移除授权','Remove access')],defaultId:0,cancelId:0,message:text('移除这个授权项目？','Remove access to this project?'),detail:project.label+'\n'+text('项目文件保留，QQ 将不能再选择这个项目。','Project files are kept. This project will no longer be available in QQ.')});
     if(answer.response!==1)return{ok:true,cancelled:true};
    }else{
     const canonical=await io.realpath(project.cwd);if(!samePath(canonical,project.cwd)||!(await io.stat(canonical)).isDirectory())return failure('invalid_cwd');
    }
    if(!owned(event))return failure('unauthorized');
    const result=await request('POST',{action:body.action==='select'?'project-select':'project-remove',projectId:project.id});
    if(result.ok){directoryDraft=false;selectedDirectory=result.snapshot.project.cwd;selectedProjectId=result.snapshot.project.id;}
    return{...result,...(result.ok?{selectedDirectory}: {})};
   }catch{return failure('invalid_cwd');}finally{pending=false;}
  },
  [CHANNELS.action]:async(event,action)=>{
   if(!owned(event))return failure('unauthorized');if(pending)return failure('busy');if(!['pair','unlink','disable'].includes(action))return failure('invalid_input');
   pending=true;
   try{
    if(action==='unlink'){
     const answer=await dialog.showMessageBox(win,{type:'question',buttons:[text('取消','Cancel'),text('解绑','Unpair')],defaultId:0,cancelId:0,message:text('解绑当前 QQ 账号？','Unpair this QQ account?'),detail:text('解绑后，该账号不能继续发送任务。重新生成配对码即可再次绑定。','This account will no longer be able to send tasks. Generate a new pairing code to pair it again.')});
     if(answer.response!==1)return{ok:true,cancelled:true};
    }
    return await request('POST',{action});
   }finally{pending=false;}
  },
 };
 const openListener=event=>{if(petSender(event))void open().catch(()=>{});};
 for(const [channel,handler]of Object.entries(handlers))ipcMain.handle(channel,handler);ipcMain.on(CHANNELS.open,openListener);
 function dispose(){if(disposed)return;disposed=true;for(const channel of Object.keys(handlers))ipcMain.removeHandler(channel);ipcMain.removeListener(CHANNELS.open,openListener);app.removeListener('before-quit',dispose);if(win&&!win.isDestroyed())win.destroy();win=null;}
 app.once('before-quit',dispose);
 const hide=()=>{if(win&&!win.isDestroyed())win.hide();};
 return{open,hide,dispose,trayItems:()=>available()?[{label:text('QQ 远程任务','QQ remote tasks'),click:()=>{void open().catch(()=>{});}}]:[]};
}
function install(options){return createController({...options,electron:options.electron||require('electron')});}
/** 宠物窗口只获得打开设置的能力，配置操作只属于独立设置窗口。 */
function installPreload(electron=require('electron')){electron.contextBridge.exposeInMainWorld('qqRemoteSettings',Object.freeze({open:()=>electron.ipcRenderer.send(CHANNELS.open)}));}
module.exports={createController,install,installPreload,sanitizeState,CHANNELS};
