import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createCodexChildEnv } from './codex-child-env.mjs';
import { locateCodex } from './codex-path.mjs';
import { normalizeRemoteToolPolicy, remoteToolScope } from './remote-tool-policy.mjs';
import { createCodexRemoteTools, dynamicFailure } from './codex-remote-tools.mjs';

const APPROVAL_POLICY={granular:{sandbox_approval:false,rules:true,mcp_elicitations:false,request_permissions:false,skill_approval:false}};
const DISABLED=['shell_tool','unified_exec','code_mode','code_mode_host','apps','plugins','hooks','browser_use','in_app_browser','computer_use','image_generation','multi_agent','multi_agent_v2','memories','workspace_dependencies','shell_snapshot','skill_search','sleep_tool','goals'];
const RULES='This is a paired remote task. File operations must stay within the selected workspace and its explicit read-only or workspace-write permission. Do not read or modify credentials, secrets, or login data. Do not disable the sandbox or request additional permissions. Remote approvals apply once to the displayed operation only. Return a concise final result and describe actual changes.';
const failure=code=>Object.assign(new Error('Codex remote: '+code),{code});
const has=(object,key)=>Object.hasOwn(object??{},key);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=160&&/^[A-Za-z0-9_-]+$/.test(value);
const secret=/\b(?:sk-(?:proj-)?[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{16,}|github_pat_[a-z0-9_]{16,}|bearer\s+\S+|(?:[a-z0-9_]*(?:token|password|passwd|secret)|(?:[a-z0-9_]*_)?api[_-]?key|authorization)\s*[=:]\s*\S+|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)|--(?:token|password|secret|api-key)\s+\S+|https?:\/\/[^\s/]+:[^\s/]+@|-----BEGIN [A-Z ]*PRIVATE KEY|(?:^|[\\/'"`\s])(?:auth\.json|\.credentials\.ya?ml|\.env(?:\.[\w-]+)?)(?:\b|$)/i;
const reviewable=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)&&!secret.test(value);
const escaped=value=>value.replaceAll('[','［').replaceAll(']','］');
const within=(root,file)=>{const path=relative(root,file);return !isAbsolute(path)&&path!=='..'&&!path.startsWith('..'+sep);};

/** 只结束本实例spawn出来的app-server及其子进程，不按名称触碰桌面Codex。 */
function terminate(child) {
  if(process.platform==='win32'&&Number.isInteger(child.pid)&&child.pid>0&&child.exitCode==null){
    const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{env:createCodexChildEnv(),shell:false,windowsHide:true,stdio:'ignore'});
    killer.once('error',()=>{try{child.kill();}catch{}});killer.once('close',code=>{if(code!==0)try{child.kill();}catch{}});
  }else try{child.kill();}catch{}
}

/** V2 stdio适配；正文只走协议管道，诊断不透传服务端stderr、工具输出或鉴权信息。 */
export function createCodexRemote({cwd,codexPath,codexHome,permission='read-only',onEvent=()=>{},onThread=async()=>{},onTurn=async()=>{},beforeResume=async()=>true,spawnImpl=spawn,requestTimeoutMs=15000,turnTimeoutMs=600000,approvalTimeoutMs=120000,toolPolicy,toolScope,mcpSourcePath,mcpRevision,managedThreads=[],createToolsImpl=createCodexRemoteTools}={}) {
  if(typeof cwd!=='string'||!isAbsolute(cwd))throw failure('invalid_cwd');
  if(!['read-only','workspace-write'].includes(permission))throw failure('invalid_permission');
  if(typeof onEvent!=='function'||typeof onThread!=='function'||typeof onTurn!=='function'||typeof beforeResume!=='function'||typeof spawnImpl!=='function')throw failure('invalid_callback');
  for(const timeout of [requestTimeoutMs,turnTimeoutMs,approvalTimeoutMs])if(!Number.isFinite(timeout)||timeout<=0)throw failure('invalid_timeout');
  let root;try{root=realpathSync(cwd);if(!statSync(root).isDirectory())throw failure('invalid_cwd');}catch{throw failure('invalid_cwd');}
  if(codexPath!==undefined&&(typeof codexPath!=='string'||!isAbsolute(codexPath)))throw failure('invalid_codex_path');
  const policy=normalizeRemoteToolPolicy(toolPolicy),scope=remoteToolScope(policy,mcpRevision);
  const instructions=()=>RULES+(policy.mcp?' Selected MCP proxies are a separate local grant for external service operations, independent of the file permission. Use them only after a fresh one-time QQ approval; do not access other applications or network tools.':' Do not use external applications or network tools.')+(policy.shell?' Use Shell only through qq_shell with a fresh one-time QQ approval and the original file/network sandbox.':' Shell execution is disabled.');
  if(toolScope!==undefined&&toolScope!==scope||!Array.isArray(managedThreads)||typeof createToolsImpl!=='function')throw failure('invalid_tool_policy');
  const toolThreads=new Set(managedThreads.filter(item=>item?.toolScope===scope&&item.permission===permission&&item.cwd===root&&identifier(item.id)).map(item=>item.id));
  const fileThreads=new Set(managedThreads.filter(item=>item?.fileTools===true&&item.cwd===root&&identifier(item.id)).map(item=>item.id));
  let tools,toolsPromise,toolsController;
  const ensureTools=async()=>{
    if(!toolsPromise){const controller=new AbortController();toolsController=controller;toolsPromise=Promise.resolve().then(()=>createToolsImpl({cwd:root,codexPath,codexHome,permission,toolPolicy:policy,mcpSourcePath,mcpRevision,spawnImpl,signal:controller.signal})).then(value=>{if(closed||controller.signal.aborted){void value.close();throw failure('closed');}tools=value;return value;});}
    return(await toolsPromise).specs;
  };
  let child,readyPromise,closed=false,active,catalogBusy=false,state='idle',sequence=0;
  const pending=new Map(),decisions=new Map(),seenRequests=new Set();
  const emit=event=>{try{Promise.resolve(onEvent(event)).catch(()=>{});}catch{/* 同步或异步显示失败均不改变执行与权限。 */}};
  const setState=next=>{if(state!==next){state=next;emit({type:'state',state:next});}};
  const write=value=>{if(!child||child.exitCode!=null||child.stdin.destroyed)throw failure('process_exited');child.stdin.write(JSON.stringify(value)+'\n');};
  const reply=(id,result)=>{try{write({id,result});}catch{/* 收尾仍需清除本地待确认项。 */}};

  function drainDecisions(run) {
    for(const [id,item]of decisions){if(run&&item.run!==run)continue;clearTimeout(item.timer);decisions.delete(id);reply(item.rpcId,item.kind==='input'?{answers:{}}:item.kind==='proxy'?dynamicFailure('Tool call cancelled.'):{decision:'decline'});}
  }
  function finish(run,{status,text='',error}={}) {
    if(active!==run||run.done)return;run.done=true;clearTimeout(run.timer);clearTimeout(run.cancelTimer);drainDecisions(run);
    if(run.proxyReplies?.size){for(const id of run.proxyReplies)reply(id,dynamicFailure('Tool call cancelled.'));run.proxyReplies.clear();void tools?.cancel(run).catch(()=>{});toolsPromise=null;tools=null;}
    active=undefined;
    setState(error||status==='failed'?'error':status==='completed'?'success':'idle');setState('idle');
    if(error)run.reject(failure(error));else run.resolve({threadId:run.threadId,text,status});
  }
  function disconnect(code,owned=child) {
    if(owned!==child)return;
    drainDecisions();child=undefined;readyPromise=undefined;
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(failure(code));}pending.clear();
    if(active)finish(active,active.cancelError?{error:active.cancelError}:active.cancelRequested?{status:'cancelled'}:{error:code});
    if(owned&&owned.exitCode==null)terminate(owned);
  }
  function request(method,params,timeout=requestTimeoutMs) {
    return new Promise((accept,reject)=>{
      const id=++sequence,timer=setTimeout(()=>disconnect('request_timeout'),timeout);
      pending.set(id,{resolve:accept,reject,timer});
      try{write({id,method,params});}catch{disconnect('process_exited');}
    });
  }
  function boundedPath(file,{directory=false}={}) {
    if(typeof file!=='string'||!isAbsolute(file)||!within(root,resolve(file)))return false;
    let ancestor=resolve(file);
    for(;;){try{const physical=realpathSync(ancestor);return within(root,physical)&&(!directory||statSync(physical).isDirectory());}catch(error){if(directory||!['ENOENT','ENOTDIR'].includes(error.code))return false;const parent=dirname(ancestor);if(parent===ancestor)return false;ancestor=parent;}}
  }
  function blocked(id,kind,reason) {
    reply(id,kind==='input'?{answers:{}}:{decision:'decline'});emit({type:'blocked',kind,reason});
  }
  function waiting() {if(active)setState(decisions.size?'waiting':'thinking');}
  function addDecision(message,kind,fields) {
    if(decisions.size>=8){blocked(message.id,kind,'too_many_pending');return;}
    const id=randomUUID(),run=active;
    const timer=setTimeout(()=>{
      const item=decisions.get(id);if(!item)return;decisions.delete(id);reply(item.rpcId,kind==='input'?{answers:{}}:kind==='proxy'?dynamicFailure('Approval expired.'):{decision:'decline'});
      emit({type:'blocked',kind,reason:'approval_timeout'});void stopRun(run,'approval_timeout');
    },approvalTimeoutMs);
    decisions.set(id,{rpcId:message.id,kind,run,timer,...fields});setState('waiting');emit({type:kind==='input'?'input':'approval',id,...fields.public});
  }
  function serverRequest(message) {
    const p=message.params??{},run=active;
    const key=typeof message.id+':'+String(message.id);
    if(seenRequests.has(key))return;seenRequests.add(key);if(seenRequests.size>4096){disconnect('output_limit');return;}
    const matches=run&&!run.done&&!run.cancelRequested&&p.threadId===run.threadId&&p.turnId===run.turnId;
    if(message.method==='item/tool/call'){
      if(!matches||!tools||!identifier(p.callId)||!identifier(p.tool)||p.namespace!=null||run.dynamicCalls.has(p.callId)){reply(message.id,dynamicFailure('Tool call unavailable.'));return;}
      run.dynamicCalls.add(p.callId);let call;
      try{call=tools.prepare(p.tool,p.arguments);}catch{reply(message.id,dynamicFailure('Tool call not authorized or requires local review.'));emit({type:'blocked',kind:'tool',reason:'local_review_required'});return;}
      if(call.kind==='read'){
        if(!run.fileTools){reply(message.id,dynamicFailure('File tools were not registered on this older conversation. Use a new QQ conversation for project file tasks.'));return;}
        setState(decisions.size?'waiting':'working');
        void Promise.resolve().then(()=>tools.execute(call,request,run)).then(result=>{if(active===run&&!run.done&&!run.cancelRequested){reply(message.id,result);waiting();}},()=>{if(active===run&&!run.done&&!run.cancelRequested){reply(message.id,dynamicFailure('Project file could not be read.'));waiting();}});
        return;
      }
      if(decisions.size>=8){reply(message.id,dynamicFailure('Too many pending approvals.'));return;}
      addDecision(message,'proxy',{call,public:{kind:call.kind,summary:escaped(call.summary)}});return;
    }
    // 内置Shell始终不向模型注册，异常原生审批帧也不能借此绕过代理开关。
    if(message.method==='item/commandExecution/requestApproval'){blocked(message.id,'command','native_shell_disabled');return;}
    if(message.method==='item/permissions/requestApproval'){reply(message.id,{permissions:{},scope:'turn'});emit({type:'blocked',kind:'permissions',reason:'permission_expansion'});return;}
    const command=message.method==='item/commandExecution/requestApproval',file=message.method==='item/fileChange/requestApproval',input=message.method==='item/tool/requestUserInput';
    if(!command&&!file&&!input){try{write({id:message.id,error:{code:-32601,message:'Unsupported remote request'}});}catch{}return;}
    const kind=command?'command':file?'file':'input';
    if(!matches){blocked(message.id,kind,'inactive_turn');return;}
    if(input){
      const questions=p.questions;
      if(!Array.isArray(questions)||!questions.length||questions.length>3||questions.some(q=>!object(q)||!identifier(q.id)||q.isSecret||!reviewable(q.question,1200)||!reviewable(q.header??'',100)||q.options!=null&&(!Array.isArray(q.options)||q.options.length>12||q.options.some(o=>!object(o)||!reviewable(o.label,200)||!reviewable(o.description,400))))||new Set(questions.map(q=>q.id)).size!==questions.length){blocked(message.id,kind,'local_input_required');return;}
      addDecision(message,kind,{questions,public:{questions:questions.map(q=>({id:q.id,header:escaped(q.header??''),question:escaped(q.question),options:q.options?.map(o=>({label:escaped(o.label),description:escaped(o.description)}))??null}))}});return;
    }
    if(p.networkApprovalContext||p.additionalPermissions||p.additional_permissions||p.proposedNetworkPolicyAmendments?.length||p.environmentId||p.sandboxPermissions||p.sandbox_permissions||p.sandboxPolicy||p.sandbox_policy){blocked(message.id,kind,'permission_expansion');return;}
    if(p.reason!=null&&!reviewable(p.reason,500)){blocked(message.id,kind,'local_review_required');return;}
    let summary;
    if(command){
      if(!reviewable(p.command,1500)||!p.command.trim()||!boundedPath(p.cwd,{directory:true})||p.kind&&p.kind!=='command'||p.commandActions?.some(a=>a.path&&!boundedPath(isAbsolute(a.path)?a.path:resolve(p.cwd,a.path)))){blocked(message.id,kind,'local_review_required');return;}
      summary='Command / 命令：\n'+p.command+'\nDirectory / 目录：'+p.cwd;
    }else{
      const changes=run.items.get(p.itemId)?.changes;
      if(permission==='read-only'||p.grantRoot&&!boundedPath(p.grantRoot)||!Array.isArray(changes)||!changes.length||changes.length>20||changes.some(change=>!object(change)||!reviewable(change.path,500)||!boundedPath(change.path)||!object(change.kind)||!['add','delete','update'].includes(change.kind.type)||Object.keys(change.kind).some(key=>!['type',...(change.kind.type==='update'?['move_path']:[])].includes(key))||!reviewable(change.diff,2500)||change.kind.move_path&&!boundedPath(change.kind.move_path))){blocked(message.id,kind,'local_review_required');return;}
      // 审批必须看到完整操作与差异；不以只有路径或截断的补丁代替知情确认。
      summary='Files / 文件：\n'+changes.map(change=>change.kind.type+' '+change.path+(change.kind.move_path?' → '+change.kind.move_path:'')+'\nDiff / 差异：\n'+change.diff).join('\n\n');
    }
    if(p.reason)summary+='\nReason / 原因：'+p.reason;
    if(!reviewable(summary,3500)){blocked(message.id,kind,'local_review_required');return;}
    addDecision(message,kind,{public:{kind,summary:escaped(summary)}});
  }
  function notification(message) {
    const p=message.params??{},run=active;if(!run||run.done||p.threadId!==run.threadId)return;
    const turnId=p.turnId??p.turn?.id;if(!run.turnId||turnId!==run.turnId)return;
    if(message.method==='error'){if(!p.willRetry)void stopRun(run,'turn_failed');return;}
    if(message.method==='item/started'||message.method==='item/completed'){
      const item=p.item;if(!object(item)||!identifier(item.id))return;run.items.set(item.id,item);
      if(['commandExecution','fileChange','mcpToolCall','dynamicToolCall'].includes(item.type))setState(decisions.size?'waiting':'working');
      if(item.type==='reasoning')setState(decisions.size?'waiting':'thinking');
      if(item.type==='agentMessage'&&message.method==='item/completed'&&typeof item.text==='string'&&item.phase!=='commentary'&&item.phase!=='partial_answer'){
        if(item.text.length>32000){disconnect('output_limit');return;}run.answer=item.text;setState(decisions.size?'waiting':'result');
      }
    }else if(message.method==='item/agentMessage/delta'){
      if(typeof p.delta!=='string'||!identifier(p.itemId))return;
      const previous=run.deltas.get(p.itemId)??'';if(previous.length+p.delta.length>32000){disconnect('output_limit');return;}run.deltas.set(p.itemId,previous+p.delta);
      if(run.items.get(p.itemId)?.phase==='final_answer'){setState(decisions.size?'waiting':'result');emit({type:'delta',text:p.delta});}
    }else if(message.method==='turn/completed'){
      const status=p.turn.status;if(!['completed','interrupted','failed'].includes(status))return;
      const final=(p.turn.items??[]).filter(item=>item.type==='agentMessage'&&item.phase!=='commentary'&&item.phase!=='partial_answer'&&typeof item.text==='string').at(-1);
      let text=final?.text??run.answer;
      if(!text)for(const [id,value]of run.deltas)if(run.items.get(id)?.phase==='final_answer')text=value;
      if(text.length>32000){disconnect('output_limit');return;}
      if(run.cancelError){finish(run,{error:run.cancelError});return;}
      if(run.cancelRequested||status==='interrupted'){finish(run,{status:'cancelled'});return;}
      if(status==='failed'){finish(run,{status:'failed'});return;}
      if(!text.trim()){finish(run,{error:'empty_reply'});return;}setState('result');finish(run,{status:'completed',text});
    }
  }
  function acceptLine(line) {
    if(!line.trim())return;let message;try{message=JSON.parse(line);}catch{disconnect('invalid_protocol');return;}
    if(!object(message)){disconnect('invalid_protocol');return;}
    if(typeof message.method==='string'){
      // 权威turn/start响应及回合存储完成前，早到审批/通知先有界暂存，不能被上一轮迟到帧抢占。
      if(active?.turnStarting&&!active.cancelRequested&&message.params?.threadId===active.threadId){
        if(active.beforeStart.length>=128){disconnect('output_limit');return;}active.beforeStart.push(message);return;
      }
      try{if(has(message,'id'))serverRequest(message);else notification(message);}catch{disconnect('invalid_protocol');}return;
    }
    const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);
    if(has(message,'error'))item.reject(failure('rpc_failed'));else if(has(message,'result'))item.resolve(message.result);else item.reject(failure('invalid_protocol'));
  }
  async function ready() {
    if(closed)throw failure('closed');if(readyPromise)return readyPromise;
    readyPromise=(async()=>{
      const profile=permission==='workspace-write'?':workspace':':read-only';
      const args=['app-server','--listen','stdio://','-c','default_permissions='+JSON.stringify(profile),'-c','web_search="disabled"','-c','mcp_servers={}','-c','analytics.enabled=false',...(process.platform==='win32'?['-c','windows.sandbox="unelevated"']:[]),...DISABLED.flatMap(feature=>['--disable',feature])];
      const env=createCodexChildEnv();if(codexHome)env.CODEX_HOME=codexHome;
      let owned;try{owned=spawnImpl(codexPath??locateCodex(),args,{cwd:root,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});}catch{throw failure('spawn_failed');}
      child=owned;seenRequests.clear();let buffer='';const decoder=new StringDecoder('utf8');
      owned.stdout.on('data',chunk=>{if(child!==owned)return;if(active){active.bytes=(active.bytes??0)+Buffer.byteLength(chunk);if(active.bytes>4*1024*1024){disconnect('output_limit',owned);return;}}buffer+=typeof chunk==='string'?chunk:decoder.write(chunk);if(buffer.length>1024*1024){disconnect('output_limit',owned);return;}let cut;while(child===owned&&(cut=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);acceptLine(line);}});
      owned.stderr.on('data',()=>{});owned.stdin.on('error',()=>disconnect('process_exited',owned));owned.once('error',()=>disconnect('spawn_failed',owned));owned.once('close',()=>disconnect('process_exited',owned));
      await request('initialize',{clientInfo:{name:'codex-pet-remote',version:'1.0.0'},capabilities:{experimentalApi:true,requestAttestation:false}});
      write({method:'initialized'});return{supported:true,transport:'stdio',protocol:'v2'};
    })();
    try{return await readyPromise;}catch(error){if(child)disconnect(error.code??'remote_failed');readyPromise=undefined;throw error;}
  }
  async function stopRun(run,error) {
    if(!run||active!==run||run.done)return false;
    run.cancelRequested=true;if(error&&!run.cancelError)run.cancelError=error;drainDecisions(run);
    toolsController?.abort();toolsController=null;toolsPromise=null;
    for(const id of run.proxyReplies??[])reply(id,dynamicFailure('Tool call cancelled.'));run.proxyReplies?.clear();
    if(tools){void tools.cancel(run).catch(()=>{});toolsPromise=null;tools=null;}
    if(!run.turnId){disconnect(error??'cancelled');return true;}
    if(!run.interrupting){run.interrupting=true;run.cancelTimer=setTimeout(()=>disconnect(error??'cancel_timeout'),requestTimeoutMs);try{await request('turn/interrupt',{threadId:run.threadId,turnId:run.turnId});}catch{disconnect(error??'cancel_timeout');}}
    return true;
  }
  const interactiveSources=new Set(['cli','vscode','appServer','exec']);
  const threadStates=new Set(['notLoaded','idle','active','systemError']);
  const opaque=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\u0000-\u001f\u007f]/.test(value);
  function threadMetadata(thread,expectedId) {
    if(!object(thread)||!identifier(thread.id)||expectedId&&thread.id!==expectedId||!boundedPath(thread.cwd,{directory:true})||realpathSync(thread.cwd)!==root)throw failure('thread_scope_mismatch');
    if(!interactiveSources.has(thread.source)||thread.parentThreadId)throw failure('thread_source_unavailable');
    if(!threadStates.has(thread.status?.type)||!Number.isSafeInteger(thread.updatedAt)||thread.updatedAt<0)throw failure('invalid_protocol');
    // name是会话标题；preview可能是首条用户正文，不能拿它补标题或对外返回。
    const title=typeof thread.name==='string'&&reviewable(thread.name,512)?Array.from(thread.name.trim().replace(/\s+/g,' ')).slice(0,120).join(''):'';
    return{id:thread.id,title,cwd:root,status:thread.status.type,updatedAt:thread.updatedAt};
  }
  async function catalog(action) {
    if(closed)throw failure('closed');if(active||catalogBusy)throw failure('busy');catalogBusy=true;
    try{await ready();if(closed)throw failure('closed');return await action();}finally{catalogBusy=false;}
  }
  async function readThreadRecord(threadId) {
    const response=await request('thread/read',{threadId,includeTurns:false});
    const metadata=threadMetadata(response?.thread,threadId);
    return{thread:response.thread,metadata};
  }
  async function listThreads(input={}) {
    if(!object(input)||Object.keys(input).some(key=>!['cursor','search'].includes(key))||input.cursor!==undefined&&!opaque(input.cursor)||input.search!==undefined&&(!reviewable(input.search,120)||!input.search.trim()))throw failure('invalid_input');
    return catalog(async()=>{
      const response=await request('thread/list',{cwd:root,limit:10,...(input.cursor===undefined?{}:{cursor:input.cursor}),...(input.search===undefined?{}:{searchTerm:input.search.trim()}),sortKey:'updated_at',sortDirection:'desc',sourceKinds:[...interactiveSources],archived:false,useStateDbOnly:true});
      if(!object(response)||!Array.isArray(response.data)||response.data.length>10||response.nextCursor!=null&&!opaque(response.nextCursor))throw failure('invalid_protocol');
      const items=[];
      for(const thread of response.data){
        // 服务端过滤之外再挡子代理；其他目录或坏元数据必须明确失败，不能混入列表。
        if(object(thread)&&(object(thread.source)||thread.source==='unknown'||thread.parentThreadId))continue;
        items.push(threadMetadata(thread));
      }
      return{items,nextCursor:response.nextCursor??null};
    });
  }
  async function readThread(input={}) {
    if(!object(input)||Object.keys(input).length!==1||!identifier(input.threadId))throw failure('invalid_input');
    return catalog(async()=> (await readThreadRecord(input.threadId)).metadata);
  }
  async function listModels(){
    return catalog(async()=>{
      const items=[],seen=new Set();let cursor;
      const efforts=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
      for(let page=0;page<4;page++){
        const response=await request('model/list',{limit:50,includeHidden:false,...(cursor?{cursor}:{})});
        if(!object(response)||!Array.isArray(response.data)||response.data.length>50)throw failure('invalid_protocol');
        for(const value of response.data){
          const name=value?.model;
          if(!object(value)||typeof value.id!=='string'||!reviewable(value.id,100)||typeof name!=='string'||!modelName(name)||typeof value.displayName!=='string'||!reviewable(value.displayName,100)||!Array.isArray(value.supportedReasoningEfforts)||value.supportedReasoningEfforts.length>16||!efforts.has(value.defaultReasoningEffort))throw failure('invalid_protocol');
          const supported=value.supportedReasoningEfforts.map(e=>e?.reasoningEffort);if(supported.some(e=>!efforts.has(e)))throw failure('invalid_protocol');
          if(value.hidden===true||seen.has(name))continue;seen.add(name);items.push({id:value.id,model:name,displayName:value.displayName,isDefault:value.isDefault===true,supportedReasoningEfforts:[...new Set(supported)],defaultReasoningEffort:value.defaultReasoningEffort});
        }
        if(response.nextCursor==null)return items;if(!opaque(response.nextCursor)||response.nextCursor===cursor)throw failure('invalid_protocol');cursor=response.nextCursor;
      }
      throw failure('model_catalog_limit');
    });
  }
  async function createThread(input={}) {
    if(!object(input)||Object.keys(input).some(key=>key!=='title')||input.title!==undefined&&(!reviewable(input.title,80)||!input.title.trim()))throw failure('invalid_input');
    return catalog(async()=>{
      const config={default_permissions:permission==='workspace-write'?':workspace':':read-only','web_search':'disabled'};
      const dynamicTools=await ensureTools();
      const response=await request('thread/start',{ephemeral:false,cwd:root,approvalPolicy:APPROVAL_POLICY,approvalsReviewer:'user',developerInstructions:instructions(),config,...(dynamicTools.length?{dynamicTools}:{})});
      const metadata=threadMetadata(response?.thread);if(metadata.status==='active')throw failure('thread_busy');if(metadata.status==='systemError')throw failure('thread_failed');
      if(input.title){await request('thread/name/set',{threadId:metadata.id,name:input.title.trim()});metadata.title=input.title.trim();}
      try{await onThread(metadata.id,{created:true,fileTools:true});}catch{throw failure('thread_storage_failed');}if(closed)throw failure('closed');fileThreads.add(metadata.id);if(scope!=='files')toolThreads.add(metadata.id);return{...metadata,fileTools:true};
    });
  }
  async function checkResume(threadId,thread,fallbackPath) {
    let allowed;try{allowed=await beforeResume(threadId,{logPath:typeof thread.path==='string'&&thread.path?thread.path:fallbackPath??null,cwd:root,status:threadStates.has(thread.status?.type)?thread.status.type:'unknown'});}catch{throw failure('thread_state_unknown');}
    if(allowed!==true)throw failure(allowed===false?'thread_busy':'thread_state_unknown');
  }
  const modelName=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(value);
  async function prompt({text,threadId,model,effort}={}) {
    if(closed)throw failure('closed');if(active||catalogBusy)throw failure('busy');
    if(typeof text!=='string'||!text.trim()||text.length>12000||threadId!==undefined&&!identifier(threadId)||model!==undefined&&!modelName(model)||effort!==undefined&&!['none','minimal','low','medium','high','xhigh','max','ultra'].includes(effort))throw failure('invalid_input');
    if(scope!=='files'&&threadId&&!toolThreads.has(threadId))throw failure('thread_tool_scope_mismatch');
    let resolveRun,rejectRun;const result=new Promise((accept,reject)=>{resolveRun=accept;rejectRun=reject;});
    const run={resolve:resolveRun,reject:rejectRun,items:new Map(),deltas:new Map(),beforeStart:[],dynamicCalls:new Set(),proxyReplies:new Set(),fileTools:!threadId||fileThreads.has(threadId),answer:'',threadId:null,turnId:null,done:false,cancelRequested:false};active=run;setState('thinking');
    run.timer=setTimeout(()=>{void stopRun(run,'turn_timeout');},turnTimeoutMs);
    // 立即挂接拒绝处理，避免初始化阶段出错时结果promise先成为未处理拒绝。
    result.catch(()=>{});
    try{
      await ready();if(active!==run)return await result;
      // 初始化中的服务也可取消；外部服务晚到不能挡住当前回合的取消返回。
      const dynamicTools=await Promise.race([ensureTools(),result.then(()=>null,()=>null)]);if(active!==run)return await result;
      let previousThread;
      if(threadId){
        const read=await readThreadRecord(threadId);previousThread=read.thread;if(active!==run)return await result;
        await Promise.race([checkResume(threadId,previousThread),result.then(()=>{},()=>{})]);if(active!==run)return await result;
      }
      const config={default_permissions:permission==='workspace-write'?':workspace':':read-only','web_search':'disabled'};
      const response=await request(threadId?'thread/resume':'thread/start',{...(threadId?{threadId,excludeTurns:true}:{ephemeral:false,...(dynamicTools.length?{dynamicTools}:{})}),cwd:root,approvalPolicy:APPROVAL_POLICY,approvalsReviewer:'user',developerInstructions:instructions(),config});
      const thread=response?.thread;
      if(active!==run)return await result;
      if(!identifier(thread?.id)||threadId&&thread.id!==threadId||!boundedPath(thread.cwd,{directory:true})||realpathSync(thread.cwd)!==root)throw failure('thread_scope_mismatch');
      if(thread.status?.type==='active')throw failure('thread_busy');if(thread.status?.type==='systemError')throw failure('thread_failed');
      run.threadId=thread.id;
      if(scope!=='files')toolThreads.add(thread.id);
      // 取消或超时不等待外部存储回调；回调晚到也不能重新提交已终止的任务。
      await Promise.race([Promise.resolve().then(()=>onThread(thread.id,{created:!threadId,fileTools:run.fileTools})),result.then(()=>{},()=>{})]);if(active!==run)return await result;
      if(run.fileTools)fileThreads.add(thread.id);
      if(threadId){await Promise.race([checkResume(threadId,thread,previousThread?.path),result.then(()=>{},()=>{})]);if(active!==run)return await result;}
      const sandboxPolicy=permission==='read-only'?{type:'readOnly',networkAccess:false}:{type:'workspaceWrite',writableRoots:[root],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true};
      run.turnStarting=true;
      const started=await request('turn/start',{threadId:thread.id,input:[{type:'text',text}],cwd:root,approvalPolicy:APPROVAL_POLICY,approvalsReviewer:'user',sandboxPolicy,...(model?{model}:{}),...(effort?{effort}:{})});
      if(active===run){
        if(!identifier(started?.turn?.id))throw failure('invalid_protocol');run.turnId=started.turn.id;
        // 回合身份落盘后才交付早到审批和结果；失败时中断已经启动的自有回合。
        try{await Promise.race([Promise.resolve().then(()=>onTurn(thread.id,run.turnId)),result.then(()=>{},()=>{})]);}
        catch{await stopRun(run,'thread_storage_failed');}
        if(active!==run)return await result;run.turnStarting=false;
        for(const frame of run.beforeStart.splice(0)){try{if(has(frame,'id'))serverRequest(frame);else notification(frame);}catch{disconnect('invalid_protocol');break;}}
      }
    }catch(error){if(active===run){if(error.code==='invalid_protocol')disconnect('invalid_protocol');else finish(run,{error:error.code??'remote_failed'});}}
    return result;
  }
  async function approve({approvalId,decision}={}) {
    const item=decisions.get(approvalId);if(!item||item.kind==='input'||item.run!==active||active?.cancelRequested)throw failure('stale_approval');
    if(!['accept','decline'].includes(decision))throw failure('invalid_decision');
    if(item.kind==='proxy'){
      clearTimeout(item.timer);decisions.delete(approvalId);
      if(decision==='decline'){reply(item.rpcId,dynamicFailure('User declined this tool call.'));waiting();return true;}
      const run=item.run,executor=tools;run.proxyReplies.add(item.rpcId);setState(decisions.size?'waiting':'working');
      void Promise.resolve().then(()=>executor.execute(item.call,request,run)).then(result=>{if(active===run&&!run.done&&!run.cancelRequested&&run.proxyReplies.delete(item.rpcId)){reply(item.rpcId,result);waiting();}},()=>{if(active===run&&!run.done&&run.proxyReplies.delete(item.rpcId)){reply(item.rpcId,dynamicFailure('Tool execution failed. No automatic retry.'));waiting();}});
      return true;
    }
    clearTimeout(item.timer);decisions.delete(approvalId);try{write({id:item.rpcId,result:{decision}});}catch{disconnect('process_exited');throw failure('process_exited');}waiting();return true;
  }
  async function answer({inputId,answers}={}) {
    const item=decisions.get(inputId);if(!item||item.kind!=='input'||item.run!==active||active?.cancelRequested)throw failure('stale_input');
    if(!object(answers)||Object.keys(answers).length!==item.questions.length)throw failure('invalid_answer');
    const response=Object.create(null);for(const question of item.questions){const values=has(answers,question.id)?answers[question.id]:undefined;if(!Array.isArray(values)||!values.length||values.length>12||values.some(value=>!reviewable(value,2000)))throw failure('invalid_answer');response[question.id]={answers:values};}
    clearTimeout(item.timer);decisions.delete(inputId);try{write({id:item.rpcId,result:{answers:response}});}catch{disconnect('process_exited');throw failure('process_exited');}waiting();return true;
  }
  async function close() {
    if(closed)return;closed=true;if(active)await stopRun(active);drainDecisions();
    toolsController?.abort();toolsController=null;
    const ownedTools=tools;tools=null;toolsPromise=null;await ownedTools?.close().catch(()=>{});
    const owned=child;if(owned)await new Promise(accept=>{
      // EOF给持久thread留出正常刷盘机会，只有超出上限才终止本次进程树。
      const timer=setTimeout(()=>{disconnect('closed',owned);accept();},1000);
      owned.once('close',()=>{clearTimeout(timer);accept();});try{owned.stdin.end();}catch{clearTimeout(timer);disconnect('closed',owned);accept();}
    });
  }
  return{ready,probe:async()=>{try{return await ready();}catch(error){return{supported:false,reason:error.code??'remote_failed'};}},listModels,listThreads,readThread,createThread,prompt,approve,answer,cancel:()=>stopRun(active),close};
}
