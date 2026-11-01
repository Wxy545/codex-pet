import {mkdir,lstat,realpath,stat,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {isAbsolute,join,parse} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createQQBridge} from './qq-remote.mjs';
import {protectQQSecret,unprotectQQSecret} from './qq-secrets.mjs';
import {normalizeRemoteToolPolicy} from './remote-tool-policy.mjs';
import {createTelegramBotTransport} from './telegram-transport.mjs';
import {createTelegramUserTransport} from './telegram-user-transport.mjs';
import {createDiscordBotTransport} from './discord-transport.mjs';
import {createLineBotTransport,createWhatsAppBotTransport} from './official-webhook-transport.mjs';
import {locateCodex} from './codex-path.mjs';

const APPS=['codex','workbuddy','harness'],MODES={telegram:['bot','user'],discord:['bot'],line:['bot'],whatsapp:['bot']};
const LABELS={telegram:'Telegram',discord:'Discord',line:'LINE',whatsapp:'WhatsApp'};
const DEFAULTS={'telegram:bot':createTelegramBotTransport,'telegram:user':createTelegramUserTransport,'discord:bot':createDiscordBotTransport,'line:bot':createLineBotTransport,'whatsapp:bot':createWhatsAppBotTransport};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value),only=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const fail=code=>{throw Object.assign(Error(code),{code});};
const digest=value=>createHash('sha256').update(value).digest('hex');
const busy=bridge=>['thinking','working','waiting','result','running','cancelling'].includes(bridge?.state()?.task?.state);
const safe=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\x00-\x1f\x7f]/.test(value);
function credentialsOf(platform,mode,value){
 if(platform==='telegram'&&mode==='bot'){if(!only(value,['botToken'])||!/^\d{3,22}:[A-Za-z0-9_-]{6,256}$/.test(value.botToken??''))fail('international_credentials_invalid');return{botToken:value.botToken};}
 if(platform==='telegram'&&mode==='user'){if(!only(value,['apiId','apiHash','session'])||!Number.isSafeInteger(value.apiId)||value.apiId<1||value.apiId>2147483647||!/^[a-fA-F0-9]{32}$/.test(value.apiHash??'')||value.session!==undefined&&(typeof value.session!=='string'||value.session.length>8192))fail('international_credentials_invalid');return{apiId:value.apiId,apiHash:value.apiHash,...(value.session?{session:value.session}:{})};}
 if(platform==='discord'&&mode==='bot'){if(!only(value,['botToken'])||!safe(value.botToken)||/\s/.test(value.botToken))fail('international_credentials_invalid');return{botToken:value.botToken};}
 if(platform==='line'&&mode==='bot'){if(!only(value,['channelAccessToken','channelSecret'])||![value.channelAccessToken,value.channelSecret].every(safe))fail('international_credentials_invalid');return{channelAccessToken:value.channelAccessToken,channelSecret:value.channelSecret};}
 if(platform==='whatsapp'&&mode==='bot'){if(!only(value,['phoneNumberId','apiVersion','accessToken','appSecret','verifyToken'])||!/^\d{1,22}$/.test(value.phoneNumberId??'')||!/^v[1-9][0-9]?\.0$/.test(value.apiVersion??'')||![value.accessToken,value.appSecret,value.verifyToken].every(safe))fail('international_credentials_invalid');return{phoneNumberId:value.phoneNumberId,apiVersion:value.apiVersion,accessToken:value.accessToken,appSecret:value.appSecret,verifyToken:value.verifyToken};}
 fail('international_mode_unsupported');
}

/** 海外连接使用各自认证与独立资料；任务、审批、取消和保留结果复用同一个已受限引擎。 */
export async function createInternationalChat({dataRoot,projectRoot,codexPath,codexHome,activityGate,roleChat,getRoleSettings,localAction,locale='zh-CN',onState=()=>{},canStart=()=>true,seal=protectQQSecret,unseal=unprotectQQSecret,transportFactories={},createBridge=createQQBridge,createRemote,readMcpCatalog,now=Date.now}={}){
 if(!isAbsolute(dataRoot??'')||!isAbsolute(projectRoot??''))fail('international_storage_invalid');
 const root=join(dataRoot,'international');await mkdir(root,{recursive:true,mode:0o700});for(const path of [dataRoot,root])if((await lstat(path)).isSymbolicLink())fail('international_storage_unsafe');
 const file=join(root,'connections.json');let records=new Map(),writes=Promise.resolve(),queue=Promise.resolve(),disposed=false;const runtimes=new Map(),sources=new Map(),launches=new Set(),factories={...DEFAULTS,...transportFactories};
 async function safeFile(){try{const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>1048576)fail('international_storage_unsafe');return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
 if(await safeFile()){
  let saved;try{saved=JSON.parse(await readFile(file,'utf8'));}catch{fail('international_storage_invalid');}
  if(saved?.schemaVersion!==1||!Array.isArray(saved.connections)||saved.connections.length>16)fail('international_storage_invalid');
  for(const value of saved.connections){if(!only(value,['id','platform','mode','label','application','enabled','secret','account','cursor','settings'])||!uuid(value.id)||records.has(value.id)||!MODES[value.platform]?.includes(value.mode)||!APPS.includes(value.application)||typeof value.enabled!=='boolean'||!safe(value.label)||value.label.length>80||typeof value.secret!=='string'||!value.secret||value.secret.length>32768||value.account!==null&&!/^[A-Za-z0-9_-]{1,128}$/.test(value.account)||!only(value.settings,APPS))fail('international_storage_invalid');for(const settings of Object.values(value.settings)){if(!only(settings,['cwd','permission','toolPolicy','mcpSourcePath','mcpRevision','defaultMode'])||!isAbsolute(settings.cwd??'')||!['read-only','workspace-write'].includes(settings.permission)||settings.defaultMode!==undefined&&!['task','role'].includes(settings.defaultMode))fail('international_storage_invalid');normalizeRemoteToolPolicy(settings.toolPolicy);}records.set(value.id,value);}
 }
 async function persist(){const content=JSON.stringify({schemaVersion:1,connections:[...records.values()]})+'\n';const action=async()=>{await safeFile();const temporary=file+'.tmp-'+randomUUID();try{await writeFile(temporary,content,{flag:'wx',mode:0o600});await rename(temporary,file);}finally{await unlink(temporary).catch(()=>{});}};const pending=writes.then(action);writes=pending.catch(()=>{});return pending;}
 const serial=action=>{const pending=queue.then(action);queue=pending.catch(()=>{});return pending;};
 function get(id){if(!uuid(id)||!records.has(id))fail('international_connection_missing');return records.get(id);}
 function publish(record,activity){const runtime=runtimes.get(record.id);if(activity&&runtime)runtime.activity=activity;try{onState({connectionId:record.id,channel:record.platform+'-'+record.mode,application:record.application,...(activity||runtime?.activity||runtime?.bridge?.state().task||{state:'idle'}),validation:'unverified'});}catch{}}
 function state(){return{locale,platforms:Object.entries(MODES).map(([platform,modes])=>({platform,modes,implementation:factories[platform+':'+modes[0]]?'implemented':'not-implemented',validation:'unverified',...(platform==='discord'?{personalAccount:'unsupported'}:{}),...(['line','whatsapp'].includes(platform)?{requiresPublicWebhook:true}:{})})),connections:[...records.values()].map(record=>{const runtime=runtimes.get(record.id),view=runtime?.bridge?.state(),connection=runtime?.connection||{state:'stopped'},hostProjects=Object.fromEntries(Object.entries(record.settings).map(([host,settings])=>[host,{cwd:settings.cwd,permission:settings.permission,defaultMode:settings.defaultMode||'task',toolPolicy:structuredClone(settings.toolPolicy)}]));return{id:record.id,platform:record.platform,mode:record.mode,label:record.label,application:record.application,enabled:record.enabled,configured:!!record.secret,hasAccount:!!record.account,validation:'unverified',connection:{state:connection.state,...(connection.code?{code:connection.code}:{})},paired:view?.paired===true,pairing:view?.pairing||null,task:view?.task||{state:'idle'},project:view?.project||hostProjects[record.application]||null,hostProjects,projects:view?.projects||[],pendingReplies:view?.pendingReplies||0,...(runtime?.challenge?{login:{id:runtime.challenge.id,kind:runtime.challenge.kind,expiresAt:new Date(runtime.challenge.expiresAt).toISOString()}}:{})};})};}
 async function remoteFor(application,options){
  if(createRemote)return createRemote(application,options);
  if(application==='codex'){const{createCodexRemote}=await import('./codex-remote.mjs');return createCodexRemote({...options,codexPath:codexPath||locateCodex(),codexHome});}
  const module=application==='workbuddy'?await import('./workbuddy-remote.mjs'):await import('./harness-remote.mjs'),resolveNative=application==='workbuddy'?module.resolveWorkBuddyNative:module.resolveHarnessNative,native=resolveNative({dataRoot,projectRoot});
  if(application==='harness')await module.prepareHarnessRemoteProfile({...options,native});return application==='workbuddy'?module.createWorkBuddyRemote({...options,native}):module.createHarnessRemote({...options,native});
 }
 function cancelChallenge(runtime){if(runtime?.challenge){clearTimeout(runtime.challenge.timer);runtime.challenge.reject(Object.assign(Error('cancelled'),{code:'international_login_cancelled'}));runtime.challenge=null;}}
 async function stopRecord(record,{disposeBridge=true}={}){const runtime=runtimes.get(record.id);if(!runtime)return;runtime.stopped=true;cancelChallenge(runtime);runtime.transport?.stop();runtime.receiver=null;runtime.statusReceiver=null;await runtime.binding;if(disposeBridge)await runtime.bridge?.dispose();runtimes.delete(record.id);}
 async function bind(record,runtime){
  if(disposed||runtime.stopped||records.get(record.id)!==record||runtimes.get(record.id)!==runtime||!record.enabled)return;
  if(runtime.binding)return runtime.binding;
  runtime.binding=(async()=>{
   const selfId=runtime.transport.state().selfId||runtime.selfId;if(typeof selfId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(selfId))fail('chat_account_invalid');
   if(record.account&&record.account!==selfId){runtime.transport.stop();runtime.connection={state:'error',code:'chat_account_changed'};fail('chat_account_changed');}
   if(!record.account){record.account=selfId;await persist();}if(disposed||runtime.stopped||records.get(record.id)!==record)return;runtime.verified=true;
   if(runtime.bound){runtime.connection={state:'connected'};runtime.statusReceiver?.({state:'connected'});return;}
   const selected=record.settings[record.application];if(!selected)return;
   if(!runtime.bridge){
    const bridgeRoot=join(root,record.id,record.application);await mkdir(bridgeRoot,{recursive:true,mode:0o700});for(const path of [join(root,record.id),bridgeRoot])if((await lstat(path)).isSymbolicLink())fail('international_storage_unsafe');
    if(disposed||runtime.stopped||records.get(record.id)!==record)return;
    runtime.bridge=await createBridge({dataRoot:bridgeRoot,codexPath,codexHome,application:record.application,provider:'official',modelSelection:record.application==='codex',managedSessionsOnly:record.application!=='codex',activityGate,roleChat,getRoleSettings:()=>({qqMode:selected.defaultMode||'task'}),localAction,locale,
     canStart:()=>!disposed&&!runtime.stopped&&records.get(record.id)===record&&record.enabled&&runtime.verified&&runtime.transport.state().state==='connected'&&canStart(record.application)===true,
     createRemote:options=>remoteFor(record.application,options),managedConnection:{channel:record.platform+'-'+record.mode,profile:record.id+'-'+record.application,account:digest(record.platform+':'+record.mode+':'+record.account),label:LABELS[record.platform],ready:()=>runtime.verified&&!runtime.stopped&&runtime.transport.state().state==='connected'},
     createTransport:callbacks=>({start(){runtime.receiver=callbacks.onMessage;runtime.statusReceiver=callbacks.onStatus;callbacks.onStatus({state:runtime.transport.state().state});},stop(){if(runtime.receiver===callbacks.onMessage){runtime.receiver=null;runtime.statusReceiver=null;}},send:body=>runtime.transport.send(body)}),onState:activity=>publish(record,activity)});
   }
   if(disposed||runtime.stopped||records.get(record.id)!==record){await runtime.bridge?.dispose();return;}const{defaultMode,...authorization}=selected;await runtime.bridge.configure({action:'save',...authorization,enabled:true});runtime.bound=true;runtime.connection={state:'connected'};publish(record);
  })().catch(error=>{runtime.connection={state:'error',code:/^[a-z_]+$/.test(error?.code||'')?error.code:'international_binding_failed'};}).finally(()=>runtime.binding=null);return runtime.binding;
 }
 function launch(record){const pending=connect(record);launches.add(pending);pending.finally(()=>launches.delete(pending)).catch(()=>{});return pending;}
 async function connect(record){
  if(disposed||!record.enabled)return;await stopRecord(record);if(disposed||!record.enabled||records.get(record.id)!==record)return;const runtime={connection:{state:'connecting'},stopped:false,verified:false,receiver:null,statusReceiver:null,bridge:null,challenge:null};runtimes.set(record.id,runtime);
  try{const raw=await unseal(record.secret);if(disposed||runtime.stopped||records.get(record.id)!==record)return;let credentials;try{credentials=credentialsOf(record.platform,record.mode,JSON.parse(raw));}catch{fail('international_credentials_invalid');}
   const factory=factories[record.platform+':'+record.mode];if(!factory)fail('international_mode_unsupported');
   runtime.transport=factory({...credentials,...(record.account?{expectedSelfId:record.account}:{}),...(record.cursor===undefined?{}:{cursor:record.cursor}),
    onCursor:async cursor=>{if(!runtime.stopped&&records.get(record.id)===record){record.cursor=cursor;await persist();}},
    onSession:async session=>{if(runtime.stopped||records.get(record.id)!==record)fail('international_login_stale');credentials={...credentials,session};record.secret=await seal(JSON.stringify(credentials));await persist();},
    onChallenge:({kind})=>{if(runtime.stopped)fail('international_login_stale');cancelChallenge(runtime);if(!['phone','code','password','email','email-code'].includes(kind))fail('international_login_unsupported');return new Promise((resolve,reject)=>{const pending={id:randomUUID(),kind,expiresAt:now()+300000,resolve,reject};pending.timer=setTimeout(()=>{if(runtime.challenge===pending){runtime.challenge=null;reject(Object.assign(Error('expired'),{code:'international_login_stale'}));}},300000);pending.timer.unref?.();runtime.challenge=pending;runtime.connection={state:'login-required'};});},
    onMessage:async message=>{if(disposed||runtime.stopped||records.get(record.id)!==record||message?.private!==true||message.self!==false)return;await runtime.binding;if(!disposed&&!runtime.stopped&&runtime.verified&&record.enabled&&records.get(record.id)===record&&runtimes.get(record.id)===runtime)return runtime.receiver?.(message);},
    onStatus:value=>{if(disposed||runtime.stopped||records.get(record.id)!==record)return;runtime.connection={state:value.state==='connected'?'connecting':['connecting','waiting-webhook','login-required','error','stopped'].includes(value.state)?value.state:'error',...(typeof value.code==='string'&&/^[a-z_]+$/.test(value.code)?{code:value.code}:{})};runtime.selfId=value.selfId;if(value.state==='connected')void bind(record,runtime);else{runtime.verified=false;runtime.statusReceiver?.(runtime.connection);}publish(record);}});
   await runtime.transport.start();if(!runtime.stopped&&runtime.transport.state().state==='connected')await bind(record,runtime);
  }catch(error){if(!runtime.stopped){runtime.connection={state:'error',code:/^[a-z_]+$/.test(error?.code||'')?error.code:'international_connection_failed'};runtime.verified=false;runtime.transport?.stop();}}
 }
 async function catalog(record,application,{cwd,sourcePath}={}){
  const rootPath=await realpath(cwd).catch(()=>fail('international_project_invalid'));if(!(await stat(rootPath)).isDirectory()||parse(rootPath).root===rootPath)fail('international_project_invalid');let raw;
  if(readMcpCatalog)raw=await readMcpCatalog(application,{cwd:rootPath,sourcePath});
  else if(application==='codex'){const{readCodexMcpCatalog}=await import('./codex-mcp.mjs');raw=await readCodexMcpCatalog({codexPath:codexPath||locateCodex(),codexHome,cwd:rootPath,sourcePath});}
  else{const module=application==='workbuddy'?await import('./workbuddy-remote.mjs'):await import('./harness-remote.mjs'),native=(application==='workbuddy'?module.resolveWorkBuddyNative:module.resolveHarnessNative)({dataRoot,projectRoot});const{readNativeMcpCatalog}=await import('./native-mcp.mjs');raw=readNativeMcpCatalog({host:application,native,cwd:rootPath,sourcePath});}
  if(raw?.state!=='ready'||!Array.isArray(raw.servers)||raw.servers.length>256)return{state:'unknown',items:[]};const id=randomUUID(),items=raw.servers.map(server=>{if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(server.id)||!safe(server.label)||server.label.length>120)fail('international_mcp_invalid');return{id:server.id,label:server.label,transport:server.transport};});
  sources.set(id,{connectionId:record.id,application,cwd:rootPath,sourcePath:raw.sourcePath??sourcePath,revision:raw.revision,at:now()});while(sources.size>128)sources.delete(sources.keys().next().value);return{state:'ready',sourceId:id,revision:raw.revision,items};
 }
 async function configure(body){
  if(disposed)fail('international_disposed');if(!object(body))fail('international_input_invalid');
  if(body.action==='login-input'){
   if(!only(body,['action','connectionId','challengeId','value'])||!uuid(body.challengeId)||typeof body.value!=='string'||!body.value||body.value.length>512||/[\x00-\x1f\x7f]/.test(body.value))fail('international_input_invalid');const record=get(body.connectionId),runtime=runtimes.get(record.id),pending=runtime?.challenge;if(!pending||pending.id!==body.challengeId||pending.expiresAt<=now())fail('international_login_stale');runtime.challenge=null;clearTimeout(pending.timer);pending.resolve(body.value);return state();
  }
  if(body.action==='save'){
   if(!only(body,['action','connectionId','platform','mode','label','application','enabled','credentials','cwd','permission','toolPolicy','mcpSourceId','mcpRevision','defaultMode'])||!MODES[body.platform]?.includes(body.mode)||!factories[body.platform+':'+body.mode])fail('international_mode_unsupported');if(!APPS.includes(body.application)||typeof body.enabled!=='boolean'||!safe(body.label)||body.label.length>80||!isAbsolute(body.cwd??'')||!['read-only','workspace-write'].includes(body.permission)||body.defaultMode!==undefined&&!['task','role'].includes(body.defaultMode))fail('international_input_invalid');
   const previous=body.connectionId?get(body.connectionId):null;if(previous&&(previous.platform!==body.platform||previous.mode!==body.mode))fail('international_mode_unsupported');if(previous&&busy(runtimes.get(previous.id)?.bridge))fail('busy');if(!previous&&records.size>=16)fail('international_connection_limit');const cwd=await realpath(body.cwd).catch(()=>fail('international_project_invalid'));if(!(await stat(cwd)).isDirectory()||parse(cwd).root===cwd)fail('international_project_invalid');
   const prior=previous?.settings[body.application]?.cwd===cwd?previous.settings[body.application]:null,toolPolicy=normalizeRemoteToolPolicy(body.toolPolicy??prior?.toolPolicy),selected={cwd,permission:body.permission,toolPolicy,defaultMode:body.defaultMode??prior?.defaultMode??'task'};
   if(toolPolicy.mcp){let source=sources.get(body.mcpSourceId);
    if(!source&&body.mcpSourceId===undefined&&prior?.toolPolicy?.mcp&&toolPolicy.mcpServerIds.every(id=>prior.toolPolicy.mcpServerIds.includes(id)))source={connectionId:previous.id,application:body.application,cwd,sourcePath:prior.mcpSourcePath,revision:prior.mcpRevision,at:now()};
    if(!previous||!source||source.connectionId!==previous.id||source.application!==body.application||source.cwd!==cwd||body.mcpRevision!==undefined&&source.revision!==body.mcpRevision||now()-source.at>300000)fail('international_mcp_stale');const fresh=await catalog(previous,body.application,{cwd,sourcePath:source.sourcePath});if(fresh.state!=='ready'||fresh.revision!==source.revision||toolPolicy.mcpServerIds.some(id=>!fresh.items.some(item=>item.id===id)))fail('international_mcp_stale');selected.mcpSourcePath=source.sourcePath;selected.mcpRevision=source.revision;
   }
   const secret=body.credentials?await seal(JSON.stringify(credentialsOf(body.platform,body.mode,body.credentials))):previous?.secret;if(!secret)fail('international_credentials_invalid');const record={id:previous?.id||randomUUID(),platform:body.platform,mode:body.mode,label:body.label,application:body.application,enabled:body.enabled,secret,account:previous?.account??null,...(previous?.cursor===undefined?{}:{cursor:previous.cursor}),settings:{...previous?.settings,[body.application]:selected}};
   const priorRuntime=previous&&runtimes.get(previous.id);if(priorRuntime?.bridge)await priorRuntime.bridge.pause();
   records.set(record.id,record);try{await persist();}catch(error){if(previous){records.set(previous.id,previous);await priorRuntime?.bridge?.start();}else records.delete(record.id);throw error;}
   if(previous)await stopRecord(previous);if(record.enabled)void launch(record);return state();
  }
  const record=get(body.connectionId);
  if(body.action==='mcp-catalog'){if(!only(body,['action','connectionId','application','cwd','sourcePath'])||!APPS.includes(body.application)||!isAbsolute(body.cwd??'')||body.sourcePath!==undefined&&!isAbsolute(body.sourcePath))fail('international_input_invalid');return{...state(),mcpCatalog:await catalog(record,body.application,body)};}
  if(!only(body,['action','connectionId','projectId']))fail('international_input_invalid');const runtime=runtimes.get(record.id);
  if(body.action==='connect'){if(busy(runtime?.bridge))fail('busy');void launch(record);return state();}
  if(body.action==='disable'){record.enabled=false;await persist();await stopRecord(record);return state();}
  if(body.action==='remove'){if(busy(runtime?.bridge))fail('busy');await stopRecord(record);records.delete(record.id);await persist();return state();}
  if(['pair','unlink','project-select','project-remove'].includes(body.action)){if(!runtime?.bridge)fail('international_not_connected');await runtime.bridge.configure({action:body.action,...(body.projectId?{projectId:body.projectId}:{})});return state();}
  fail('international_input_invalid');
 }
 return{state,configure:body=>body?.action==='login-input'?configure(body):serial(()=>configure(body)),ownsTurn:(threadId,turnId)=>[...runtimes].some(([id,runtime])=>records.get(id)?.application==='codex'&&runtime.bridge?.ownsTurn(threadId,turnId)===true),handleWebhook:async(connectionId,request)=>{const record=get(connectionId),runtime=runtimes.get(record.id);if(disposed||!record.enabled||runtime?.stopped||typeof runtime?.transport?.handleWebhook!=='function')fail('international_not_connected');const result=await runtime.transport.handleWebhook(request);await runtime.binding;return result;},start:async()=>{for(const record of records.values())if(record.enabled)void launch(record);},idle:async()=>{await queue;for(const runtime of runtimes.values()){await runtime.binding;await runtime.bridge?.idle();}await writes;},dispose:async()=>{if(disposed)return;disposed=true;await queue;await Promise.allSettled([...records.values()].map(record=>stopRecord(record)));await Promise.allSettled([...launches]);await writes;}};
}
