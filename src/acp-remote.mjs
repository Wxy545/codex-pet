import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {realpathSync,statSync,lstatSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {normalizeRemoteToolPolicy,remoteToolScope} from './remote-tool-policy.mjs';

export const remoteError=code=>Object.assign(new Error('Native remote: '+code),{code});
export const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const remoteId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const secret=/\b(?:sk-(?:proj-)?[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{16,}|github_pat_[a-z0-9_]{16,}|bearer\s+\S+|(?:[a-z0-9_]*(?:token|password|passwd|secret)|api[_-]?key|authorization)["']?\s*[=:]\s*["']?\S+)|-----BEGIN [A-Z ]*PRIVATE KEY/i;
const privatePath=/(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|auth\.json|\.credentials(?:\.ya?ml|\.json)?|credentials(?:\.json)?|\.git|\.ssh|\.aws|\.codex|\.workbuddy|\.dsh)(?:[\\/]|$)/i;
export const safeRemoteText=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)&&!secret.test(value);
const escaped=value=>value.replaceAll('[','［').replaceAll(']','］');
const within=(root,file)=>{const r=relative(root,file);return !isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);};
// NTFS 的备用数据流可把 .env::$DATA 映射回敏感文件；盘符以外不接受冒号。
const streamPath=value=>/:/.test(value.replace(/^[A-Za-z]:[\\/]/,''));

/** 每次审批和执行前重新检查真实祖先，目录随后变成 junction 也不能越界。 */
export function remoteFile(root,value,{mustExist=false}={}){
  if(typeof value!=='string'||!value||value.length>4096||/[\u0000-\u001f\u007f*?]/.test(value)||streamPath(value)||privatePath.test(value)||secret.test(value))return false;
  const file=resolve(root,value);if(!within(root,file))return false;let ancestor=file;
  for(;;){try{
    const physical=realpathSync(ancestor);if(!within(root,physical)||privatePath.test(relative(root,physical))||mustExist&&ancestor!==file)return false;
    // 硬链接不会改变 realpath；拒绝多链接文件，避免授权目录里的别名修改目录外文件。
    if(ancestor===file){const target=lstatSync(file);return target.isFile()&&!target.isSymbolicLink()&&target.nlink===1;}
    return statSync(ancestor).isDirectory();
  }catch(error){if(mustExist||!['ENOENT','ENOTDIR'].includes(error.code))return false;const parent=dirname(ancestor);if(parent===ancestor)return false;ancestor=parent;}}
}

export function remoteDirectory(root,value){
  if(typeof value!=='string'||!value||streamPath(value)||privatePath.test(value)||!safeRemoteText(value,4096))return false;
  const directory=resolve(root,value);try{return within(root,directory)&&within(root,realpathSync(directory))&&statSync(directory).isDirectory();}catch{return false;}
}

/** Shell 与外部服务单独授权；完整操作无法展示时拒绝，不把本机开启当成永久批准。 */
export function reviewRemoteTool(root,permission,tool,{toolPolicy,host}={}){
  if(!isRecord(tool)||!isRecord(tool.rawInput))return null;
  const name=tool._meta?.['codebuddy.ai/toolName']??tool.title;
  const policy=normalizeRemoteToolPolicy(toolPolicy),input=tool.rawInput;
  if(['Bash','bash','PowerShell','pwsh'].includes(name)){
    const allowed=['command','description','timeout','timeoutMs','cwd','workdir','run_in_background','sandbox_permissions','justification','dangerouslyDisableSandbox'];
    if(!policy.shell||Object.keys(input).some(key=>!allowed.includes(key))||!safeRemoteText(input.command,2600)||!input.command.trim()||input.run_in_background===true||input.dangerouslyDisableSandbox===true||input.sandbox_permissions!==undefined&&input.sandbox_permissions!=='use_default')return null;
    const cwd=resolve(root,input.workdir??input.cwd??root);if(!remoteDirectory(root,cwd)||host==='workbuddy'&&cwd!==root||input.cwd!==undefined&&input.workdir!==undefined&&resolve(root,input.cwd)!==cwd)return null;
    if(input.description!==undefined&&!safeRemoteText(input.description,300)||input.justification!==undefined&&!safeRemoteText(input.justification,300)||['timeout','timeoutMs'].some(key=>input[key]!==undefined&&(!Number.isSafeInteger(input[key])||input[key]<1||input[key]>120000)))return null;
    const parameters={...input};delete parameters.command;
    const summary='Shell / 命令：'+name+'\nCWD / 工作目录：'+cwd+'\n'+input.command+'\nParameters / 参数：'+JSON.stringify(parameters);
    return safeRemoteText(summary,3800)?{kind:'command',summary:escaped(summary),path:cwd}:null;
  }
  if(typeof name==='string'&&name.startsWith('mcp__')){
    const selected=policy.mcp&&policy.mcpServerIds.some(id=>name.startsWith('mcp__'+id+'__'));
    if(!selected||name.length>256)return null;let parameters;try{parameters=JSON.stringify(input);}catch{return null;}
    const summary='MCP / 外部服务：'+name+'\nProject / 项目目录：'+root+'\nArguments / 参数：\n'+parameters;
    return safeRemoteText(summary,3800)?{kind:'mcp',summary:escaped(summary),toolName:name}:null;
  }
  const kind=({Read:'read',read:'read',read_image:'read',Write:'write',write:'write',Edit:'edit',edit:'edit'})[name];
  if(!kind||!remoteFile(root,input.file_path,{mustExist:kind!=='write'}))return null;
  if(input.sandbox_permissions!==undefined&&input.sandbox_permissions!=='use_default')return null;
  if(kind==='read'){
    if(Object.keys(input).some(key=>!['file_path','offset','limit','sandbox_permissions','justification'].includes(key)))return null;
    return{kind:'read',path:resolve(root,input.file_path)};
  }
  if(permission!=='workspace-write')return null;
  const fields=kind==='write'?['content']:['old_string','new_string'];
  const allowed=['file_path',...fields,...(kind==='edit'?['replace_all']:[]),'sandbox_permissions','justification'];
  if(Object.keys(input).some(key=>!allowed.includes(key))||fields.some(key=>!safeRemoteText(input[key],2500))||fields.reduce((sum,key)=>sum+input[key].length,0)>3000)return null;
  if(input.justification!==undefined&&!safeRemoteText(input.justification,300))return null;
  const summary=(kind==='write'?'Write / 写入：':'Edit / 修改：')+resolve(root,input.file_path)+'\n'+fields.map(key=>key+':\n'+input[key]).join('\n');
  return{kind:'file',summary:escaped(summary),path:resolve(root,input.file_path)};
}

export function terminateRemoteChild(child){
  if(process.platform==='win32'&&Number.isInteger(child.pid)&&child.pid>0&&child.exitCode==null){
    const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});
    killer.once('error',()=>{try{child.kill();}catch{}});
  }else try{child.kill();}catch{}
}

/** ACP 只连接本实例启动的管道；不调用 authenticate、接管写锁或读取宿主历史正文。 */
export function createAcpRemote({host,cwd,permission='read-only',launch,managedThreads=[],onThread=async()=>{},onTurn=async()=>{},onEvent=()=>{},beforeResume=async()=>true,spawnImpl=spawn,requestTimeoutMs=15000,turnTimeoutMs=600000,approvalTimeoutMs=120000,resumeMethod='session/resume',checkSession=()=>{},promptMeta=()=>undefined,closeSession=true,allowStartupPreamble=false,toolPolicy,mcpRevision,toolScope,sessionConfig=()=>({mcpServers:[]}),checkToolContext=()=>{}}={}){
  if(!['workbuddy','harness'].includes(host)||typeof launch!=='function'||typeof cwd!=='string'||!isAbsolute(cwd))throw remoteError('invalid_native_options');
  if(!['read-only','workspace-write'].includes(permission))throw remoteError('invalid_permission');
  const policy=normalizeRemoteToolPolicy(toolPolicy),scope=remoteToolScope(policy,mcpRevision);if(toolScope!==undefined&&toolScope!==scope)throw remoteError('tool_scope_mismatch');
  for(const callback of [onThread,onTurn,onEvent,beforeResume,spawnImpl,checkSession,promptMeta,sessionConfig,checkToolContext])if(typeof callback!=='function')throw remoteError('invalid_callback');
  for(const timeout of [requestTimeoutMs,turnTimeoutMs,approvalTimeoutMs])if(!Number.isFinite(timeout)||timeout<=0)throw remoteError('invalid_timeout');
  let root;try{root=realpathSync(cwd);if(!statSync(root).isDirectory())throw Error();}catch{throw remoteError('invalid_cwd');}
  if(!Array.isArray(managedThreads)||managedThreads.length>1000)throw remoteError('invalid_managed_threads');
  const threads=new Map();
  for(const entry of managedThreads){
    if(!isRecord(entry)||!remoteId(entry.id)||entry.permission!==permission||(entry.toolScope??'files')!==scope||entry.host!==undefined&&entry.host!==host||typeof entry.cwd!=='string'||!isAbsolute(entry.cwd))continue;
    let same=false;try{same=realpathSync(entry.cwd)===root;}catch{}if(!same)continue;
    threads.set(entry.id,{id:entry.id,title:safeRemoteText(entry.title,80)?entry.title:'',cwd:root,status:'notLoaded',updatedAt:Number.isSafeInteger(entry.updatedAt)&&entry.updatedAt>=0?entry.updatedAt:0});
  }
  let child,readyPromise,closed=false,catalogBusy=false,active,sequence=0,state='idle',protocolStarted=false,preambleBytes=0;
  const pending=new Map(),decisions=new Map(),loaded=new Set(),seenRequests=new Set();
  const capabilities=Object.freeze({managedSessions:true,desktopSessions:false,models:false,input:false,files:true,shell:policy.shell,mcp:policy.mcp,approval:true,cancel:true});
  const emit=event=>{try{Promise.resolve(onEvent(event)).catch(()=>{});}catch{}};
  const setState=next=>{if(state!==next){state=next;emit({type:'state',state:next});}};
  const write=frame=>{if(!child||child.exitCode!=null||child.stdin.destroyed)throw remoteError('process_exited');child.stdin.write(JSON.stringify({jsonrpc:'2.0',...frame})+'\n');};
  const reply=(id,result)=>{try{write({id,result});}catch{}};
  function drain(run){for(const [id,item]of decisions){if(run&&item.run!==run)continue;clearTimeout(item.timer);decisions.delete(id);reply(item.rpcId,{outcome:{outcome:'cancelled'}});}}
  function finish(run,{status='completed',text='',error}={}){
    if(active!==run||run.done)return;run.done=true;clearTimeout(run.timer);clearTimeout(run.cancelTimer);drain(run);active=undefined;
    const thread=threads.get(run.threadId);if(thread){thread.status='idle';thread.updatedAt=Date.now();}
    setState(error?'error':status==='completed'?'success':'idle');setState('idle');
    if(error)run.reject(remoteError(error));else run.resolve({threadId:run.threadId,status,text});
  }
  function disconnect(code,owned=child){
    if(owned!==child)return;drain();child=undefined;readyPromise=undefined;loaded.clear();
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(remoteError(code));}pending.clear();
    if(active)finish(active,active.cancelError?{error:active.cancelError}:active.cancelRequested?{status:'cancelled'}:{error:code});
    if(owned&&owned.exitCode==null)terminateRemoteChild(owned);
  }
  function request(method,params,{long=false}={}){
    return new Promise((accept,reject)=>{const id=++sequence,timer=long?undefined:setTimeout(()=>disconnect('request_timeout'),requestTimeoutMs);pending.set(id,{resolve:accept,reject,timer});try{write({id,method,params});}catch{disconnect('process_exited');}});
  }
  function serverRequest(frame){
    const key=typeof frame.id+':'+frame.id;if(seenRequests.has(key))return;seenRequests.add(key);if(seenRequests.size>4096){disconnect('output_limit');return;}
    const p=frame.params,run=active;
    if(frame.method!=='session/request_permission'){try{write({id:frame.id,error:{code:-32601,message:'Unsupported remote request'}});}catch{}return;}
    const deny=reason=>{reply(frame.id,{outcome:{outcome:'cancelled'}});emit({type:'blocked',kind:'file',reason});};
    if(!run||run.done||run.cancelRequested||!run.submitted||p?.sessionId!==run.threadId){deny('inactive_turn');return;}
    const toolId=p?.toolCall?.toolCallId;if(!remoteId(toolId)){deny('local_review_required');return;}
    const previous=run.tools.get(toolId),tool={...previous,...p.toolCall,rawInput:p.toolCall.rawInput??previous?.rawInput};
    const reviewed=reviewRemoteTool(root,permission,tool,{toolPolicy:policy,host}),options=p.options;
    if(!reviewed||!Array.isArray(options)||options.length>12){deny('outside_remote_scope');return;}
    if(reviewed.kind==='mcp')try{checkToolContext();}catch(error){deny(error.code??'mcp_config_changed');return;}
    const once=options.find(option=>isRecord(option)&&option.kind==='allow_once'&&remoteId(option.optionId));
    if(!once){deny('one_time_approval_unavailable');return;}
    // 已获本机目录读取授权的请求，仍逐次检查路径；写入只接受这一次的明确确认。
    if(reviewed.kind==='read'){reply(frame.id,{outcome:{outcome:'selected',optionId:once.optionId}});return;}
    if(decisions.size>=8){deny('too_many_pending');return;}
    const id=randomUUID(),timer=setTimeout(()=>{if(!decisions.has(id))return;decisions.delete(id);reply(frame.id,{outcome:{outcome:'cancelled'}});void stopRun(run,'approval_timeout');},approvalTimeoutMs);
    decisions.set(id,{run,rpcId:frame.id,optionId:once.optionId,tool,timer});setState('waiting');emit({type:'approval',id,kind:reviewed.kind,summary:reviewed.summary});
  }
  function notification(frame){
    const p=frame.params,run=active;if(frame.method!=='session/update'||!run||!run.submitted||run.done||p?.sessionId!==run.threadId||!isRecord(p.update))return;
    const update=p.update,requestId=update._meta?.['codebuddy.ai/requestId']??p._meta?.['codebuddy.ai/requestId'];if(requestId!==undefined&&requestId!==run.turnId)return;
    if(update.sessionUpdate==='agent_message_chunk'){
      if(update.content?.type!=='text'||typeof update.content.text!=='string')return;
      if(run.answer.length+update.content.text.length>32000){disconnect('output_limit');return;}
      run.answer+=update.content.text;setState(decisions.size?'waiting':'result');emit({type:'delta',text:update.content.text});
    }else if(update.sessionUpdate==='agent_thought_chunk')setState(decisions.size?'waiting':'thinking');
    else if(['tool_call','tool_call_update'].includes(update.sessionUpdate)&&remoteId(update.toolCallId)){
      if(run.tools.size>=256&&!run.tools.has(update.toolCallId)){disconnect('output_limit');return;}
      run.tools.set(update.toolCallId,{...run.tools.get(update.toolCallId),...update});setState(decisions.size?'waiting':'working');
    }
  }
  function acceptLine(line){
    if(!line.trim())return;let frame;try{frame=JSON.parse(line);}catch{
      if(allowStartupPreamble&&!protocolStarted){preambleBytes+=Buffer.byteLength(line);if(preambleBytes<=16384)return;}
      disconnect('invalid_protocol');return;
    }
    if(!isRecord(frame)){disconnect('invalid_protocol');return;}
    protocolStarted=true;
    if(typeof frame.method==='string'){try{Object.hasOwn(frame,'id')?serverRequest(frame):notification(frame);}catch{disconnect('invalid_protocol');}return;}
    const item=pending.get(frame.id);if(!item)return;pending.delete(frame.id);clearTimeout(item.timer);
    if(Object.hasOwn(frame,'error'))item.reject(remoteError(frame.error?.code===-32000?'auth_or_session_unavailable':'rpc_failed'));
    else if(Object.hasOwn(frame,'result'))item.resolve(frame.result);else item.reject(remoteError('invalid_protocol'));
  }
  async function ready(){
    if(closed)throw remoteError('closed');if(readyPromise)return readyPromise;
    readyPromise=(async()=>{
      const spec=await launch();if(closed)throw remoteError('closed');let owned;try{owned=spawnImpl(spec.command,spec.args,{cwd:root,env:spec.env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});}catch{throw remoteError('spawn_failed');}
      child=owned;let buffer='';const decoder=new StringDecoder('utf8');seenRequests.clear();protocolStarted=false;preambleBytes=0;
      owned.stdout.on('data',chunk=>{if(child!==owned)return;if(active){active.bytes+=Buffer.byteLength(chunk);if(active.bytes>4*1024*1024){disconnect('output_limit',owned);return;}}buffer+=typeof chunk==='string'?chunk:decoder.write(chunk);if(buffer.length>1048576){disconnect('output_limit',owned);return;}let cut;while(child===owned&&(cut=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);acceptLine(line);}});
      owned.stderr.on('data',()=>{});owned.stdin.on('error',()=>disconnect('process_exited',owned));owned.once('error',()=>disconnect('spawn_failed',owned));owned.once('close',()=>disconnect('process_exited',owned));
      const response=await request('initialize',{protocolVersion:1,clientInfo:{name:'codex-pet-remote',version:'1.0.0'},clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}});
      if(!isRecord(response)||response.protocolVersion!==1||!isRecord(response.agentCapabilities))throw remoteError('unsupported_protocol');
      return{supported:true,transport:'stdio',protocol:'acp-v1',capabilities};
    })();try{return await readyPromise;}catch(error){if(child)disconnect(error.code??'remote_failed');readyPromise=undefined;throw error;}
  }
  async function stored(metadata,created){try{await onThread(metadata.id,{created,host,permission,toolScope:scope,...metadata});}catch{throw remoteError('thread_storage_failed');}}
  async function newThread(title=''){
    const config=await sessionConfig(),result=await request('session/new',{cwd:root,...config});checkSession(result,permission);
    if(!remoteId(result?.sessionId)||threads.has(result.sessionId))throw remoteError('invalid_protocol');
    const metadata={id:result.sessionId,title,cwd:root,status:'idle',updatedAt:Date.now()};await stored(metadata,true);threads.set(metadata.id,metadata);loaded.add(metadata.id);return metadata;
  }
  async function ensureThread(id){
    const metadata=threads.get(id);if(!metadata)throw remoteError('thread_not_managed');
    let allowed;try{allowed=await beforeResume(id,{cwd:root,host,permission,status:metadata.status,managed:true});}catch{throw remoteError('thread_state_unknown');}
    if(allowed!==true)throw remoteError(allowed===false?'thread_busy':'thread_state_unknown');
    const config=await sessionConfig();if(!loaded.has(id)){const response=await request(resumeMethod,{sessionId:id,cwd:root,...config});checkSession(response,permission);if(response?.sessionId!==undefined&&response.sessionId!==id)throw remoteError('invalid_protocol');loaded.add(id);}
    return metadata;
  }
  async function catalog(action){if(closed)throw remoteError('closed');if(active||catalogBusy)throw remoteError('busy');catalogBusy=true;try{await ready();return await action();}finally{catalogBusy=false;}}
  async function createThread(input={}){
    if(!isRecord(input)||Object.keys(input).some(key=>key!=='title')||input.title!==undefined&&(!safeRemoteText(input.title,80)||!input.title.trim()))throw remoteError('invalid_input');
    return catalog(async()=>({...await newThread(input.title?.trim()??'')}));
  }
  async function listThreads(input={}){
    if(!isRecord(input)||Object.keys(input).some(key=>!['cursor','search'].includes(key))||input.cursor!==undefined&&!/^\d{1,5}$/.test(input.cursor)||input.search!==undefined&&!safeRemoteText(input.search,120))throw remoteError('invalid_input');
    const offset=Number(input.cursor??0),search=input.search?.trim().toLocaleLowerCase();const items=[...threads.values()].filter(item=>!search||item.title.toLocaleLowerCase().includes(search)).sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
    return{items:items.slice(offset,offset+10).map(item=>({...item,status:active?.threadId===item.id?'active':item.status})),nextCursor:offset+10<items.length?String(offset+10):null};
  }
  async function readThread({threadId}={}){if(!remoteId(threadId)||!threads.has(threadId))throw remoteError('thread_not_managed');return{...threads.get(threadId),status:active?.threadId===threadId?'active':threads.get(threadId).status};}
  async function prompt({text,threadId,model,effort}={}){
    if(closed)throw remoteError('closed');if(active||catalogBusy)throw remoteError('busy');
    if(typeof text!=='string'||!text.trim()||text.length>12000||threadId!==undefined&&!remoteId(threadId))throw remoteError('invalid_input');
    if(model!==undefined||effort!==undefined)throw remoteError('model_selection_unavailable');
    let accept,reject;const result=new Promise((resolveRun,rejectRun)=>{accept=resolveRun;reject=rejectRun;});result.catch(()=>{});
    const run={resolve:accept,reject,threadId:null,turnId:randomUUID(),answer:'',tools:new Map(),bytes:0,submitted:false,done:false,cancelRequested:false};active=run;setState('thinking');run.timer=setTimeout(()=>void stopRun(run,'turn_timeout'),turnTimeoutMs);
    try{
      await ready();if(active!==run)return result;
      const metadata=threadId?await ensureThread(threadId):await newThread();if(active!==run)return result;run.threadId=metadata.id;
      if(threadId)await stored(metadata,false);if(active!==run)return result;
      await onTurn(metadata.id,run.turnId);if(active!==run)return result;
      metadata.status='active';run.submitted=true;const meta=promptMeta(run.turnId);
      const response=await request('session/prompt',{sessionId:metadata.id,prompt:[{type:'text',text}],...(meta?{_meta:meta}:{})},{long:true});
      if(active!==run)return result;
      if(run.cancelError)finish(run,{error:run.cancelError});else if(run.cancelRequested||response?.stopReason==='cancelled')finish(run,{status:'cancelled'});
      else if(response?.stopReason!=='end_turn')finish(run,{error:'turn_incomplete'});
      else if(!run.answer.trim())finish(run,{error:'empty_reply'});else finish(run,{text:run.answer});
    }catch(error){if(active===run)finish(run,{error:error.code??'remote_failed'});}return result;
  }
  async function stopRun(run,error){
    if(!run||active!==run||run.done)return false;run.cancelRequested=true;if(error)run.cancelError=error;drain(run);
    if(!run.submitted){disconnect(error??'cancelled');return true;}
    if(!run.cancelTimer){run.cancelTimer=setTimeout(()=>disconnect(error??'cancel_timeout'),requestTimeoutMs);try{write({method:'session/cancel',params:{sessionId:run.threadId}});}catch{disconnect(error??'process_exited');}}
    return true;
  }
  async function approve({approvalId,decision}={}){
    const item=decisions.get(approvalId);if(!item||item.run!==active||active?.cancelRequested)throw remoteError('stale_approval');if(!['accept','decline'].includes(decision))throw remoteError('invalid_decision');
    clearTimeout(item.timer);decisions.delete(approvalId);
    const reviewed=reviewRemoteTool(root,permission,item.tool,{toolPolicy:policy,host});let allowed=decision==='accept'&&reviewed&&reviewed.kind!=='read';
    if(allowed&&reviewed.kind==='mcp')try{checkToolContext();}catch(error){reply(item.rpcId,{outcome:{outcome:'cancelled'}});setState(decisions.size?'waiting':'working');throw remoteError(error.code??'mcp_config_changed');}
    reply(item.rpcId,allowed?{outcome:{outcome:'selected',optionId:item.optionId}}:{outcome:{outcome:'cancelled'}});setState(decisions.size?'waiting':'working');return true;
  }
  async function close(){
    if(closed)return;closed=true;if(active)await stopRun(active);drain();const owned=child;if(!owned)return;
    if(closeSession)for(const id of loaded){try{await request('session/close',{sessionId:id});}catch{break;}}
    await new Promise(accept=>{const timer=setTimeout(()=>{disconnect('closed',owned);accept();},1000);owned.once('close',()=>{clearTimeout(timer);accept();});try{owned.stdin.end();}catch{clearTimeout(timer);disconnect('closed',owned);accept();}});
  }
  return{capabilities,toolScope:scope,ready,probe:async()=>{try{return await ready();}catch(error){return{supported:false,reason:error.code??'remote_failed',capabilities};}},createThread,listThreads,readThread,prompt,approve,answer:async()=>{throw remoteError('input_unavailable');},listModels:async()=>{throw remoteError('model_selection_unavailable');},cancel:()=>stopRun(active),close};
}
