import {contentError} from './platform-catalog.mjs';
import {spawn} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {stopCodexProxyProcess} from './codex-mcp.mjs';

const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
function localEndpoint(value){
 try{const url=new URL(value);if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.hash||url.search||!url.port)throw Error();return url.href;}catch{throw contentError('content_endpoint_invalid');}
}
async function responseBody(response,maxBytes,signal){
 if(Number(response.headers.get('content-length')||0)>maxBytes)throw contentError('content_response_too_large');
 const reader=response.body?.getReader();if(!reader)return'';const chunks=[];let bytes=0;
 try{for(;;){if(signal.aborted)throw contentError('content_cancelled');const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>maxBytes)throw contentError('content_response_too_large');chunks.push(next.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(chunks).toString('utf8');
}
function frameFrom(body,id){
 let frames=[];try{frames=[JSON.parse(body)];}catch{for(const event of body.split(/\r?\n\r?\n/)){const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');if(data)try{frames.push(JSON.parse(data));}catch{throw contentError('content_mcp_protocol');}}}
 const frame=frames.find(value=>value?.jsonrpc==='2.0'&&value.id===id);if(!frame||frame.error||!Object.hasOwn(frame,'result'))throw contentError('content_mcp_failed');return frame.result;
}

/** 供本机已选MCP执行器使用；URL与header仅留主进程，函数返回值不携带配置。 */
export function createContentMcpClient({endpoint,headers={},fetchImpl=globalThis.fetch,timeoutMs=60000,maxBytes=2*1024*1024}={}){
 const url=localEndpoint(endpoint);
 if(!record(headers)||Object.keys(headers).length>16||Object.entries(headers).some(([key,value])=>!/^[A-Za-z0-9-]{1,80}$/.test(key)||typeof value!=='string'||value.length>8192||/[\r\n]/.test(value))||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>180000||!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>8*1024*1024)throw contentError('content_mcp_config_invalid');
 let sequence=0,session=null,initialized=false,closed=false;
 const own=new AbortController();
 async function cancelRequest(id){if(!initialized||closed)return;try{const response=await fetchImpl(url,{method:'POST',redirect:'error',credentials:'omit',headers:{...headers,'content-type':'application/json','accept':'application/json, text/event-stream',...(session?{'Mcp-Session-Id':session,'MCP-Protocol-Version':'2025-03-26'}:{})},body:JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id,reason:'Content activity cancelled'}}),signal:AbortSignal.timeout(500)});await response.body?.cancel().catch(()=>{});}catch{}}
 async function rpc(method,params,{signal,notify=false}={}){
  if(closed)throw contentError('content_client_closed');const joined=AbortSignal.any([own.signal,AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]),id=++sequence;
  let response;try{response=await fetchImpl(url,{method:'POST',redirect:'error',credentials:'omit',headers:{...headers,'content-type':'application/json','accept':'application/json, text/event-stream',...(session?{'Mcp-Session-Id':session,'MCP-Protocol-Version':'2025-03-26'}:{})},body:JSON.stringify({jsonrpc:'2.0',...(notify?{}:{id}),method,params}),signal:joined});}catch(error){if(joined.aborted){if(method==='tools/call')await cancelRequest(id);throw contentError(signal?.aborted||own.signal.aborted?'content_cancelled':'content_timeout');}throw contentError('content_mcp_unavailable');}
  if(!response.ok)throw contentError('content_mcp_unavailable');
  const incoming=response.headers.get('mcp-session-id');if(incoming){if(incoming.length>512||/[\u0000-\u0020\u007f]/.test(incoming))throw contentError('content_mcp_protocol');session=incoming;}
  if(notify){await response.body?.cancel().catch(()=>{});return null;}
  if(response.status===202||response.status===204)throw contentError('content_mcp_protocol');
  try{return frameFrom(await responseBody(response,maxBytes,joined),id);}catch(error){if(joined.aborted){if(method==='tools/call')await cancelRequest(id);throw contentError(signal?.aborted||own.signal.aborted?'content_cancelled':'content_timeout');}throw error;}
 }
 async function ready(signal){if(initialized)return;const result=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'codex-pet-content',version:'1.0.0'}},{signal});if(!record(result)||!record(result.serverInfo)||!record(result.capabilities))throw contentError('content_mcp_protocol');await rpc('notifications/initialized',{}, {signal,notify:true});initialized=true;}
 return{
  async listTools({signal}={}){await ready(signal);const items=[];let cursor;for(let page=0;page<4;page++){const response=await rpc('tools/list',{...(cursor?{cursor}:{})},{signal});if(!Array.isArray(response?.tools)||response.tools.length>256)throw contentError('content_mcp_protocol');items.push(...response.tools);cursor=response.nextCursor;if(!cursor)return items.map(tool=>({name:tool.name,inputSchema:tool.inputSchema}));}throw contentError('content_mcp_catalog_limit');},
  async call(tool,args,{signal}={}){if(typeof tool!=='string'||!/^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(tool)||!record(args))throw contentError('content_binding_invalid');await ready(signal);return rpc('tools/call',{name:tool,arguments:args},{signal});},
  async close(){if(closed)return;closed=true;own.abort();if(session)try{await fetchImpl(url,{method:'DELETE',redirect:'error',credentials:'omit',headers:{...headers,'Mcp-Session-Id':session,'MCP-Protocol-Version':'2025-03-26'},signal:AbortSignal.timeout(1500)});}catch{}session=null;},
 };
}

/** 默认实际HTTP路径；原生宿主可在活动服务中注入自己的精准MCP控制器。 */
export function createContentToolCaller({fetchImpl=globalThis.fetch}={}){
 return async({profile,tool,arguments:args,signal})=>{
  if(profile.connection?.type!=='mcp-http'||!profile.connection.endpoint)throw contentError('content_tool_unconfigured');
  const client=createContentMcpClient({endpoint:profile.connection.endpoint,fetchImpl});
  try{return await client.call(tool,args,{signal});}finally{await client.close();}
 };
}

/** 只接主进程已经从本人选定配置中解析的描述；不向页面提供任意程序执行入口。 */
export function createContentStdioMcpClient({descriptor,cwd,spawnImpl=spawn,timeoutMs=60000,maxBytes=2*1024*1024}={}){
 if(!record(descriptor)||!isAbsolute(descriptor.command??'')||!isAbsolute(cwd??'')||!Array.isArray(descriptor.args)||descriptor.args.length>128||descriptor.args.some(value=>typeof value!=='string'||value.length>8192||/[\r\n\0]/.test(value))||!Array.isArray(descriptor.env??[])||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>180000)throw contentError('content_mcp_config_invalid');
 let child=null,childEnded=false,closed=false,initialized=false,sequence=0,buffer='',bytes=0;const pending=new Map();
 const env={...process.env};for(const key of Object.keys(env))if(/^(?:OPENAI_|CODEX_|DSH_|WORKBUDDY_|CODEBUDDY_|QQ_|NAPCAT_|AWS_|AZURE_|ANTHROPIC_|GOOGLE_API|GITHUB_TOKEN|GH_TOKEN)/i.test(key))delete env[key];
 for(const pair of descriptor.env??[]){if(!record(pair)||!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(pair.name)||typeof pair.value!=='string'||pair.value.length>8192)throw contentError('content_mcp_config_invalid');env[pair.name]=pair.value;}
 const send=body=>{if(closed||!child||child.stdin.destroyed)throw contentError('content_mcp_unavailable');child.stdin.write(JSON.stringify(body)+'\n');};
 const lost=code=>{for(const item of [...pending.values()])item.fail(contentError(code));};
 function stop(){if(closed)return;closed=true;lost('content_cancelled');stopCodexProxyProcess(child);try{child?.stdin.destroy();}catch{}}
 function launch(){if(child)return;let command=descriptor.command,args=[...descriptor.args];
  if(process.platform==='win32'&&/\.(cmd|bat)$/i.test(command)){
   if([command,...args].some(value=>/["&|<>^%!]/.test(value)))throw contentError('content_mcp_command_unsupported');
   const quoted=[command,...args].map(value=>'"'+value+'"').join(' ');command=process.env.ComSpec||'C:\\Windows\\System32\\cmd.exe';args=['/d','/s','/c','"'+quoted+'"'];
  }
  child=spawnImpl(command,args,{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stdout.on('data',part=>{bytes+=part.length;if(bytes>maxBytes*4){lost('content_response_too_large');stop();return;}buffer+=part.toString('utf8');if(Buffer.byteLength(buffer)>maxBytes){lost('content_response_too_large');stop();return;}
   let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line)continue;let frame;try{frame=JSON.parse(line);}catch{lost('content_mcp_protocol');stop();return;}
    if(frame?.jsonrpc!=='2.0')continue;if(frame.method&&Object.hasOwn(frame,'id')){try{send({jsonrpc:'2.0',id:frame.id,error:{code:-32601,message:'Client requests are not supported'}});}catch{}continue;}
    const item=pending.get(frame.id);if(!item)continue;if(frame.error||!Object.hasOwn(frame,'result'))item.fail(contentError('content_mcp_failed'));else item.done(frame.result);
   }
  });child.stderr.on('data',()=>{});child.once('error',()=>{lost('content_mcp_unavailable');stop();});child.once('close',()=>{childEnded=true;lost('content_mcp_unavailable');stop();});
 }
 function rpc(method,params,{signal,notify=false}={}){if(closed||signal?.aborted)return Promise.reject(contentError('content_cancelled'));launch();const id=++sequence;if(notify){send({jsonrpc:'2.0',method,params});return Promise.resolve(null);}
  return new Promise((resolve,reject)=>{let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);pending.delete(id);error?reject(error):resolve(value);};
   const cancel=()=>{try{send({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id,reason:'Content activity cancelled'}});}catch{}finish(contentError(signal?.aborted?'content_cancelled':'content_timeout'));stop();};
   const timer=setTimeout(cancel,timeoutMs);pending.set(id,{done:value=>finish(null,value),fail:error=>finish(error)});signal?.addEventListener('abort',cancel,{once:true});try{send({jsonrpc:'2.0',id,method,params});}catch(error){finish(error);}if(signal?.aborted)cancel();
  });
 }
 async function ready(signal){if(initialized)return;const result=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'codex-pet-content',version:'1.0.0'}},{signal});if(!record(result?.serverInfo)||!record(result?.capabilities))throw contentError('content_mcp_protocol');await rpc('notifications/initialized',{}, {signal,notify:true});initialized=true;}
 return{async listTools({signal}={}){await ready(signal);const tools=[];let cursor;for(let page=0;page<4;page++){const value=await rpc('tools/list',{...(cursor?{cursor}:{})},{signal});if(!Array.isArray(value?.tools)||value.tools.length>256)throw contentError('content_mcp_protocol');tools.push(...value.tools);cursor=value.nextCursor;if(!cursor)return tools;}throw contentError('content_mcp_catalog_limit');},async call(tool,args,{signal}={}){await ready(signal);return rpc('tools/call',{name:tool,arguments:args},{signal});},async close(){if(!child||childEnded||child.exitCode!==null){stop();return;}await new Promise(resolve=>{const timer=setTimeout(resolve,2000);child.once('close',()=>{clearTimeout(timer);resolve();});stop();});}};
}
