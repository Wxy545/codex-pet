import {mkdir,lstat,stat,realpath,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join,isAbsolute,parse,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {locateCodex} from './codex-path.mjs';
import {createQQBridge} from './qq-remote.mjs';
import {createNapCatRuntime} from './napcat-runtime.mjs';
import {normalizeRemoteToolPolicy,remoteToolScope} from './remote-tool-policy.mjs';

const APPLICATIONS=['codex','workbuddy','harness'],PROVIDERS=['official','onebot'];
const busy=state=>['thinking','working','waiting','result','running','cancelling'].includes(state?.task?.state);
const fail=code=>{throw Object.assign(Error(code),{code});};
const keyOf=(application,provider)=>application+':'+provider;

/** 连接方式与目标应用分别保存；旧 Codex 官方机器人保留原文件及配对。 */
export async function createQQService({dataRoot,projectRoot,codexPath,codexHome,activityGate,locale='zh-CN',initialApplication='codex',canStart=()=>true,onState=()=>{},
 createBridgeImpl=createQQBridge,createRuntimeImpl=createNapCatRuntime,resolveTargetImpl,createRemoteImpl,readMcpCatalogImpl,now=Date.now,runtimeOptions={},bridgeOptions={}}={}){
 if(!isAbsolute(dataRoot||'')||!isAbsolute(projectRoot||''))fail('invalid_directory');
 const file=join(dataRoot,'qq-service.json');
 await mkdir(dataRoot,{recursive:true});
 for(const path of [dataRoot,file])try{if((await lstat(path)).isSymbolicLink())fail('linked_settings');}catch(error){if(error.code!=='ENOENT')throw error;}
 let selection={application:APPLICATIONS.includes(initialApplication)?initialApplication:'codex',provider:'official'};
 try{const info=await lstat(file);if(!info.isFile()||info.size>2048)fail('invalid_settings');const saved=JSON.parse(await readFile(file,'utf8'));if(saved.schemaVersion!==1||!APPLICATIONS.includes(saved.application)||!PROVIDERS.includes(saved.provider))fail('invalid_settings');selection={application:saved.application,provider:saved.provider};}catch(error){if(error.code!=='ENOENT')throw error;}
 let disposed=false,switching=false,queue=Promise.resolve(),currentActivity=null,pendingActivity=null,activityWrite=null,terminalTimer;
 const preparation=new AbortController(),activityFile=join(dataRoot,'qq-activity.json');
 function publishActivity(view){
  const record={schemaVersion:1,application:view.application,state:view.state,activeCount:view.activeCount??0,at:Date.now()};
  currentActivity=record;pendingActivity=record;
  if(activityWrite)return;
  activityWrite=Promise.resolve().then(async()=>{
   while(pendingActivity){const value=pendingActivity;pendingActivity=null;
    try{const info=await lstat(activityFile);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw Error('unsafe_activity_file');}catch(error){if(error.code!=='ENOENT')throw error;}
    const temp=activityFile+'.tmp-'+randomUUID();
    try{await writeFile(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});await rename(temp,activityFile);}finally{await unlink(temp).catch(()=>{});}
   }
  }).catch(()=>{pendingActivity=null;}).finally(()=>{activityWrite=null;});
 }
 const heartbeat=setInterval(()=>{if(!disposed&&currentActivity?.activeCount>0)publishActivity(currentActivity);},10000);heartbeat.unref?.();
 const bridges=new Map(),nativeTargets=new Map(),mcpSources=new Map(),draftSources=new Map();
 const runtime=await createRuntimeImpl({dataRoot,...runtimeOptions});
 const active=()=>bridges.get(keyOf(selection.application,selection.provider));
 const serial=action=>{const next=queue.then(action);queue=next.catch(()=>{});return next;};
 async function persist(value){const temp=file+'.tmp-'+randomUUID();await writeFile(temp,JSON.stringify({schemaVersion:1,...value})+'\n',{flag:'wx',mode:0o600});await rename(temp,file);}
 async function resolveTarget(application,{cwd,permission,prepare=false,toolPolicy,mcpSourcePath,mcpRevision,toolScope}={}){
  if(resolveTargetImpl)return resolveTargetImpl(application,{cwd,permission,prepare,toolPolicy,mcpSourcePath,mcpRevision,toolScope});
  if(application==='codex'){const command=codexPath||locateCodex();if(!command)fail('host_not_installed');return{codexPath:command};}
  const module=application==='workbuddy'?await import('./workbuddy-remote.mjs'):await import('./harness-remote.mjs');
  const resolver=application==='workbuddy'?module.resolveWorkBuddyNative:module.resolveHarnessNative;
  let native;try{native=await resolver({dataRoot,projectRoot});}catch(error){if(error.code==='not_installed')fail('host_not_installed');throw error;}
  if(prepare&&application==='harness'){
   const prepared=await module.prepareHarnessRemoteProfile({native,cwd,permission,toolPolicy,mcpSourcePath,mcpRevision,toolScope,signal:preparation.signal});
   if(prepared?.ready===false)fail('remote_profile_unavailable');
   if(permission==='workspace-write')await module.prepareHarnessRemoteProfile({native,cwd,permission:'read-only',toolPolicy,mcpSourcePath,mcpRevision,toolScope,signal:preparation.signal});
  }
  return native;
 }
 const sourceKey=(application,provider,cwd)=>keyOf(application,provider)+'\0'+(process.platform==='win32'?cwd.toLowerCase():cwd);
 async function readCatalog(application,{cwd,sourcePath,native}={}){
  if(readMcpCatalogImpl)return readMcpCatalogImpl(application,{cwd,sourcePath,native});
  const target=native||nativeTargets.get(application)||await resolveTarget(application,{cwd});
  if(application==='codex'){const {readCodexMcpCatalog}=await import('./codex-mcp.mjs');return readCodexMcpCatalog({codexPath:target.codexPath,codexHome:codexHome||(process.env.CODEX_HOME||join(homedir(),'.codex')),cwd,sourcePath});}
  const {readNativeMcpCatalog}=await import('./native-mcp.mjs');return readNativeMcpCatalog({host:application,native:target,cwd,sourcePath});
 }
 function publicCatalog(catalog){
  if(!catalog||catalog.state!=='ready')return{state:catalog?.state==='not-installed'?'not-installed':'unknown',items:[]};
  const servers=catalog.servers,revision=catalog.revision;
  if(typeof revision!=='string'||!/^[A-Za-z0-9_.:-]{1,256}$/.test(revision)||!Array.isArray(servers)||servers.length>256)fail('invalid_mcp_catalog');
  const ids=new Set(),items=servers.map(server=>{if(!server||typeof server.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(server.id)||ids.has(server.id)||typeof server.label!=='string'||/[\u0000-\u001f\u007f]/.test(server.label)||server.label.length>120)fail('invalid_mcp_catalog');ids.add(server.id);return{id:server.id,label:server.label,transport:['stdio','http','sse'].includes(server.transport)?server.transport:'unknown'};});
  return{state:'ready',revision,items};
 }
 async function mcpCatalog(body){
  if(Object.keys(body).some(key=>!['action','application','provider','cwd','sourcePath'].includes(key))||!APPLICATIONS.includes(body.application)||!PROVIDERS.includes(body.provider)||!isAbsolute(body.cwd||'')||body.sourcePath!==undefined&&!isAbsolute(body.sourcePath))fail('invalid_input');
  const cwd=await realpath(body.cwd).catch(()=>fail('invalid_directory'));if(!(await stat(cwd)).isDirectory()||parse(cwd).root===cwd)fail('invalid_directory');
  const key=sourceKey(body.application,body.provider,cwd),bridge=bridges.get(keyOf(body.application,body.provider));
  const draft=draftSources.get(key),saved=bridge.projectTools?.(cwd);
  const sourcePath=body.sourcePath??draft?.sourcePath??saved?.mcpSourcePath;
  // 新的读取或选源使同一草稿的旧票据失效，不能用旧页面重新开启先前来源。
  for(const [id,entry]of mcpSources)if(entry.key===key)mcpSources.delete(id);
  let raw;try{raw=await readCatalog(body.application,{cwd,sourcePath});}catch(error){return{...state(),mcpCatalog:{state:['not_installed','host_not_installed'].includes(error.code)?'not-installed':'unknown',items:[]}};}
  const view=publicCatalog(raw);if(view.state!=='ready')return{...state(),mcpCatalog:view};
  if(raw.sourcePath!==undefined&&raw.sourcePath!==null&&!isAbsolute(raw.sourcePath))fail('invalid_mcp_catalog');
  const chosen=raw.sourcePath??sourcePath,sourceId=randomUUID(),entry={key,application:body.application,provider:body.provider,cwd,sourcePath:chosen,revision:view.revision,at:now()};
  for(const [id,old]of mcpSources)if(now()-old.at>=300000)mcpSources.delete(id);
  while(mcpSources.size>=128)mcpSources.delete(mcpSources.keys().next().value);
  mcpSources.set(sourceId,entry);draftSources.delete(key);draftSources.set(key,entry);while(draftSources.size>64)draftSources.delete(draftSources.keys().next().value);
  return{...state(),mcpCatalog:{...view,sourceId,sourceName:chosen?basename(chosen):''}};
 }
 async function remoteFor(application,options){
  if(createRemoteImpl)return createRemoteImpl(application,options);
  const native=nativeTargets.get(application)||await resolveTarget(application,options);
  if(application==='codex'){const {createCodexRemote}=await import('./codex-remote.mjs');return createCodexRemote({...options,codexPath:native.codexPath});}
  if(application==='workbuddy'){const {createWorkBuddyRemote}=await import('./workbuddy-remote.mjs');return createWorkBuddyRemote({...options,native});}
  const {createHarnessRemote}=await import('./harness-remote.mjs');return createHarnessRemote({...options,native});
 }
 for(const application of APPLICATIONS)for(const provider of PROVIDERS){
  const key=keyOf(application,provider),root=key==='codex:official'?dataRoot:join(dataRoot,'qq-profiles',application,provider);
  if(root!==dataRoot)for(const directory of [join(dataRoot,'qq-profiles'),join(dataRoot,'qq-profiles',application),root]){await mkdir(directory,{recursive:true,mode:0o700});if((await lstat(directory)).isSymbolicLink())fail('linked_settings');}
  const bridge=await createBridgeImpl({...bridgeOptions,dataRoot:root,codexPath,codexHome:codexHome||(process.env.CODEX_HOME||join(homedir(),'.codex')),application,provider,modelSelection:application==='codex',managedSessionsOnly:application!=='codex',activityGate,locale,
   createRemote:options=>remoteFor(application,options),canStart:()=>!disposed&&!switching&&keyOf(selection.application,selection.provider)===key&&canStart(application)===true,
   onState:view=>{if(!disposed&&keyOf(selection.application,selection.provider)===key){const activity={...view,application};publishActivity(activity);clearTimeout(terminalTimer);if(['success','error'].includes(view.state)){terminalTimer=setTimeout(()=>{if(!disposed)publishActivity({state:'idle',activeCount:0,application});},5000);terminalTimer.unref?.();}onState(activity);}}});
  bridges.set(key,bridge);
 }
 function state(){return{...active().state(),application:selection.application,provider:selection.provider,profiles:[...bridges.values()].map(bridge=>bridge.state()),napcat:runtime.state()};}
 async function configure(body){
  if(disposed)fail('unavailable');
  if(!body||typeof body!=='object'||Array.isArray(body))fail('invalid_input');
  if(body.action==='mcp-catalog')return mcpCatalog(body);
  if(body.action==='napcat-prepare'){if(Object.keys(body).length!==1)fail('invalid_input');runtime.prepare();return state();}
  if(body.action==='napcat-login'){
   if(Object.keys(body).length!==1)fail('invalid_input');runtime.start();const localLoginUrl=await runtime.getLoginUrl();
   return{...state(),...(localLoginUrl?{localLoginUrl}:{})};
  }
  if(body.action!=='save')return active().configure(body).then(()=>state());
  if(Object.keys(body).some(k=>!['action','application','provider','appId','appSecret','cwd','permission','enabled','toolPolicy','mcpSourceId','mcpRevision'].includes(k)))fail('invalid_input');
  const application=body.application??selection.application,provider=body.provider??selection.provider;
  if(!APPLICATIONS.includes(application)||!PROVIDERS.includes(provider)||typeof body.enabled!=='boolean'||!isAbsolute(body.cwd||'')||!['read-only','workspace-write'].includes(body.permission))fail('invalid_input');
  if(provider==='official'&&(!/^\d{3,32}$/.test(body.appId||'')||body.appSecret!==undefined&&(typeof body.appSecret!=='string'||body.appSecret&&!/^[A-Za-z0-9_-]{6,256}$/.test(body.appSecret))))fail('invalid_input');
  const cwd=await realpath(body.cwd).catch(()=>fail('invalid_directory'));if(!(await stat(cwd)).isDirectory()||parse(cwd).root===cwd)fail('invalid_directory');
  if(busy(active().state()))fail('busy');
  const target=bridges.get(keyOf(application,provider)),prior=target.projectTools?.(cwd),toolPolicy=normalizeRemoteToolPolicy(body.toolPolicy??prior?.toolPolicy);
  let mcpSourcePath,mcpRevision;
  if(toolPolicy.mcp){
   const source=mcpSources.get(body.mcpSourceId);
   if(!source||source.key!==sourceKey(application,provider,cwd)||now()-source.at>=300000||source.revision!==body.mcpRevision)fail('stale_mcp_catalog');
   const raw=await readCatalog(application,{cwd,sourcePath:source.sourcePath}),fresh=publicCatalog(raw);
   if(fresh.state!=='ready'||fresh.revision!==source.revision||toolPolicy.mcpServerIds.some(id=>!fresh.items.some(item=>item.id===id)))fail('mcp_config_changed');
   mcpSourcePath=raw.sourcePath??source.sourcePath;mcpRevision=fresh.revision;
  }
  const toolScope=remoteToolScope(toolPolicy,mcpRevision);
  const native=await resolveTarget(application,{cwd,permission:body.permission,prepare:true,toolPolicy,mcpSourcePath,mcpRevision,toolScope});
  let connection;
  if(provider==='onebot')connection=await runtime.connection();
  const old=active(),next={application,provider},changed=keyOf(selection.application,selection.provider)!==keyOf(application,provider);
  const config={action:'save',cwd,permission:body.permission,enabled:body.enabled,toolPolicy,...(toolPolicy.mcp?{mcpSourcePath,mcpRevision}:{}),...(provider==='official'?{appId:body.appId,...(body.appSecret?{appSecret:body.appSecret}:{})}:{endpoint:connection.url,accessToken:connection.accessToken})};
  // 先排空当前收信队列并停止旧传输，任务一旦已启动则拒绝切换，结果不会丢到别的账号。
  switching=true;
  let selectionWritten=false;
  try{
   await old.pause();
   try{
    nativeTargets.set(application,native);
    await target.configureWithCommit(config,async()=>{if(changed){await persist(next);selectionWritten=true;}});
    selection=next;
   }catch(error){await target.pause().catch(()=>{});throw error;}
  }catch(error){if(selectionWritten)await persist(selection);switching=false;await old.start();throw error;}
  finally{switching=false;}
  if(provider==='onebot'&&body.enabled)runtime.start();
  await target.start();publishActivity({state:'idle',activeCount:0,application});onState({state:'idle',activeCount:0,application});return state();
 }
 async function start(){if(disposed)return;publishActivity({state:'idle',activeCount:0,application:selection.application});if(selection.provider==='onebot'&&active().state().enabled)runtime.start();await active().start();}
 async function dispose(){if(disposed)return;disposed=true;preparation.abort();clearInterval(heartbeat);clearTimeout(terminalTimer);await queue.catch(()=>{});publishActivity({state:'idle',activeCount:0,application:selection.application});await Promise.allSettled([...bridges.values()].map(b=>b.dispose()));await runtime.dispose();await activityWrite;}
 return{state,configure:body=>serial(()=>configure(body)),receive:message=>active().receive(message),start,dispose,ownsTurn:(threadId,turnId)=>[...bridges].some(([key,b])=>key.startsWith('codex:')&&b.ownsTurn(threadId,turnId)),idle:async()=>{await queue;await active().idle();}};
}
