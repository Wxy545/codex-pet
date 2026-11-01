import {mkdir,lstat,readFile,writeFile,rename,unlink,realpath} from 'node:fs/promises';
import {isAbsolute,join,basename} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {readCodexMcpCatalog,createCodexMcpProxy} from './codex-mcp.mjs';
import {readNativeMcpCatalog,selectNativeMcp} from './native-mcp.mjs';
import {locateCodex} from './codex-path.mjs';
import {createContentMcpClient,createContentStdioMcpClient} from './platform-mcp.mjs';
import {contentError} from './platform-catalog.mjs';

const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const revision=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value);
const host=value=>['codex','workbuddy','harness'].includes(value);
const failure=code=>{throw contentError(code);};

/** 本人选源的短期票据与持久绑定分开；刷新离线目录不会启动MCP或模型。 */
export async function createContentSources({dataRoot,projectRoot,codexPath,codexHome=process.env.CODEX_HOME||join(homedir(),'.codex'),resolveTarget,readCatalog,createCodexProxy=createCodexMcpProxy,createNativeClient,now=Date.now}={}){
 if(!isAbsolute(dataRoot??'')||!isAbsolute(projectRoot??''))failure('content_directory_invalid');
 const root=await realpath(projectRoot),directory=join(dataRoot,'content-activities'),file=join(directory,'sources.json');
 for(const path of [dataRoot,directory]){await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())failure('content_store_invalid');}
 let bindings=[];try{const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>1024*1024)failure('content_store_invalid');const stored=JSON.parse(await readFile(file,'utf8'));if(stored.schemaVersion!==1||!Array.isArray(stored.bindings)||stored.bindings.length>64)failure('content_store_invalid');bindings=stored.bindings;for(const entry of bindings)if(!id(entry.id)||!host(entry.host)||!id(entry.serverId)||!revision(entry.revision)||entry.sourcePath!==null&&!isAbsolute(entry.sourcePath??''))failure('content_store_invalid');}catch(error){if(error.code!=='ENOENT')throw error;}
 let disposed=false,saving=Promise.resolve();const tickets=new Map(),active=new Set();
 async function target(application){if(resolveTarget)return resolveTarget(application);if(application==='codex'){const command=codexPath||locateCodex();if(!command)failure('host_not_installed');return{codexPath:command};}const module=await import(application==='workbuddy'?'./workbuddy-remote.mjs':'./harness-remote.mjs');return(application==='workbuddy'?module.resolveWorkBuddyNative:module.resolveHarnessNative)({dataRoot,projectRoot:root});}
 async function rawCatalog(application,sourcePath){const native=await target(application);const catalog=readCatalog?await readCatalog(application,{sourcePath,native,cwd:root}):application==='codex'?await readCodexMcpCatalog({sourcePath,codexHome}):readNativeMcpCatalog({host:application,native,sourcePath,cwd:root});return{catalog,native};}
 async function persist(){const bytes=JSON.stringify({schemaVersion:1,bindings},null,2)+'\n',tmp=file+'.tmp-'+randomUUID();try{const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)failure('content_store_invalid');}catch(error){if(error.code!=='ENOENT')throw error;}try{await writeFile(tmp,bytes,{flag:'wx',mode:0o600});await rename(tmp,file);}finally{await unlink(tmp).catch(()=>{});}}
 async function catalog({host:application,sourcePath}={}){
  if(disposed||!host(application)||sourcePath!==undefined&&!isAbsolute(sourcePath??''))failure('content_source_invalid');
  for(const[key,value]of tickets)if(value.host===application||now()-value.at>300000)tickets.delete(key);
  let raw;try{raw=await rawCatalog(application,sourcePath);}catch(error){return{state:['not_installed','host_not_installed'].includes(error.code)?'not-installed':'unknown',items:[]};}
  const value=raw.catalog;if(value?.state!=='ready'||!revision(value.revision)||!Array.isArray(value.servers)||value.servers.length>256)return{state:value?.state==='not-installed'?'not-installed':'unknown',items:[]};
  const items=value.servers.map(server=>{if(!id(server.id)||typeof server.label!=='string'||server.label.length>120||/[\u0000-\u001f\u007f]/.test(server.label))failure('content_source_invalid');return{id:server.id,label:server.label,transport:['stdio','http','sse'].includes(server.transport)?server.transport:'unknown'};});
  const sourceId=randomUUID();tickets.set(sourceId,{host:application,sourcePath:value.sourcePath??sourcePath??null,revision:value.revision,serverIds:new Set(items.map(item=>item.id)),at:now()});while(tickets.size>64)tickets.delete(tickets.keys().next().value);
  return{state:'ready',sourceId,revision:value.revision,sourceName:basename(value.sourcePath??sourcePath??''),items};
 }
 async function bind(selection){const task=saving.then(async()=>{
  if(disposed||!record(selection)||Object.keys(selection).some(key=>!['sourceId','revision','serverId','host'].includes(key))||!host(selection.host)||!id(selection.sourceId)||!id(selection.serverId)||!revision(selection.revision))failure('content_source_invalid');
  const ticket=tickets.get(selection.sourceId);if(!ticket||ticket.host!==selection.host||ticket.revision!==selection.revision||!ticket.serverIds.has(selection.serverId)||now()-ticket.at>=300000)failure('content_source_stale');
  const fresh=await rawCatalog(ticket.host,ticket.sourcePath);if(fresh.catalog.state!=='ready'||fresh.catalog.revision!==ticket.revision||!fresh.catalog.servers.some(server=>server.id===selection.serverId))failure('content_scope_changed');
  let entry=bindings.find(value=>value.host===ticket.host&&value.sourcePath===ticket.sourcePath&&value.serverId===selection.serverId&&value.revision===ticket.revision);if(!entry){if(bindings.length>=64)failure('content_source_limit');entry={id:'content-source-'+randomUUID(),host:ticket.host,sourcePath:ticket.sourcePath,serverId:selection.serverId,revision:ticket.revision};const prior=bindings;bindings=[...bindings,entry];try{await persist();}catch(error){bindings=prior;throw error;}}
  return{serverId:entry.id,revision:entry.revision};
 });saving=task.catch(()=>{});return task;}
 async function callPlatformTool(request){
  if(disposed||!record(request)||!host(request.host)||!id(request.serverId)||!revision(request.revision))failure('content_tool_unconfigured');
  const entry=bindings.find(value=>value.id===request.serverId&&value.host===request.host&&value.revision===request.revision);if(!entry)failure('content_tool_unconfigured');
  const fresh=await rawCatalog(entry.host,entry.sourcePath);if(fresh.catalog.state!=='ready'||fresh.catalog.revision!==entry.revision||!fresh.catalog.servers.some(server=>server.id===entry.serverId))failure('content_scope_changed');
  let client;try{
   if(entry.host==='codex'){
    client=await createCodexProxy({catalog:fresh.catalog,selectedIds:[entry.serverId],cwd:root,codexPath:fresh.native.codexPath,codexHome,signal:request.signal});active.add(client);
    const name=client.specs.find(spec=>client.describe(spec.name)?.tool===request.tool)?.name;if(!name)failure('content_tool_unconfigured');const result=await client.call(name,request.arguments);if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024)failure('content_response_too_large');return result;
   }
   const descriptor=selectNativeMcp({host:entry.host,native:fresh.native,cwd:root,sourcePath:entry.sourcePath,revision:entry.revision,serverIds:[entry.serverId]})[0];
   client=createNativeClient?await createNativeClient({descriptor,cwd:root,host:entry.host,signal:request.signal}):descriptor.type==='http'?createContentMcpClient({endpoint:descriptor.url,headers:Object.fromEntries(descriptor.headers.map(pair=>[pair.name,pair.value]))}):createContentStdioMcpClient({descriptor,cwd:root});active.add(client);
   const available=await client.listTools({signal:request.signal});if(!available.some(tool=>tool.name===request.tool))failure('content_tool_unconfigured');return await client.call(request.tool,request.arguments,{signal:request.signal});
  }finally{if(client){active.delete(client);await client.close().catch(()=>{});}}
 }
 return{catalog,bind,callPlatformTool,async dispose(){disposed=true;tickets.clear();for(const client of active)await client.close().catch(()=>{});active.clear();await saving;}};
}
