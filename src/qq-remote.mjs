import {mkdir,readFile,writeFile,rename,lstat,realpath,stat} from 'node:fs/promises';
import {randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {isAbsolute,join,resolve,parse} from 'node:path';
import {homedir} from 'node:os';
import {protectQQSecret,unprotectQQSecret} from './qq-secrets.mjs';
import {createQQCatalog,cleanTitle} from './qq-catalog.mjs';
import {createQQThreadGuard} from './qq-thread-guard.mjs';
import {normalizeQQExecution,chooseQQExecution,chooseQQExecutionKind} from './qq-execution.mjs';

const STATES=new Set(['idle','thinking','working','waiting','result','success','error']);
const fail=code=>{throw Object.assign(Error(code),{code});};
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value);
const code=()=>String(randomInt(100000,1000000));
const same=(a,b)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));

export function projectQQState(base,remote,locale='zh-CN'){
  if(!remote||remote.state==='idle')return base;
  const priority={waiting:4,working:3,result:2,thinking:1};
  const active=Number(remote.activeCount)||0,local=Number(base.activeCount)||0;
  if(!active&&local)return base;
  if(active&&(priority[base.state]||0)>(priority[remote.state]||0))return{...base,activeCount:local+active};
  const app={codex:'Codex',workbuddy:'WorkBuddy',harness:'DeepSeek Harness'}[remote.application];
  return{...base,state:remote.state,activeCount:local+active,task:locale.startsWith('zh')?'正在处理 '+(app?app+' ':'')+'QQ 任务':'Processing '+(app?app+' ':'a ')+'QQ task'};
}

/** 本人QQ只能选择本机授权项目、会话与工具范围；消息正文不作为桥接命令执行。 */
export async function createQQBridge({dataRoot,codexPath,codexHome=process.env.CODEX_HOME||join(homedir(),'.codex'),createTransport,createRemote,activityGate,onState=()=>{},seal=protectQQSecret,unseal=unprotectQQSecret,locale='zh-CN',now=Date.now,canStart=()=>true,application='codex',provider='official',modelSelection=true,managedSessionsOnly=false}={}) {
  if(!isAbsolute(dataRoot||''))fail('invalid_directory');
  if(!['codex','workbuddy','harness'].includes(application)||!['official','onebot'].includes(provider))fail('invalid_input');
  if(application!=='codex'&&typeof createRemote!=='function')fail('host_unavailable');
  const label={codex:'Codex',workbuddy:'WorkBuddy',harness:'DeepSeek Harness'}[application];
  const zh=locale.startsWith('zh'),T=(cn,en)=>(zh?cn:en).replaceAll('Codex',label);
  const dir=join(dataRoot,'qq-remote'),file=join(dir,'settings.json');
  let config={schemaVersion:1,enabled:false,appId:'',secret:'',cwd:'',permission:'read-only',ownerId:null,threadId:null,threads:[],seen:[],outbox:[],job:null};
  let writes=Promise.resolve(),requests=Promise.resolve(),transport,remote,running,releaseGate,pairing,approval,input,expiry,disposed=false,generation=0,cancelRequested=false;
  const decisionQueue=[];
  const serial=action=>{const next=requests.then(action);requests=next.catch(()=>{});return next;};
  let connection={state:'stopped'},task={state:'idle'},lastMsgId,connectionEpoch=0;
  const attempts=new Map();
  const acceptsNew=()=>{try{return !disposed&&canStart()===true;}catch{return false;}};
  const unavailable=()=>send(T('所选任务应用 Codex 暂不可用，请检查安装、登录和 QQ 连接设置。','The selected task app, Codex, is unavailable. Check its installation, sign-in, and QQ connection settings.'));
  async function safeFiles(){
    await mkdir(dir,{recursive:true,mode:0o700});
    for(const path of [dataRoot,dir,file])try{if((await lstat(path)).isSymbolicLink())fail('linked_settings');}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  await safeFiles();
  try{
    const info=await stat(file);if(info.size>1024*1024)fail('invalid_settings');
    const value=JSON.parse(await readFile(file,'utf8'));
    if(value.schemaVersion!==1||typeof value.enabled!=='boolean'||typeof value.appId!=='string'||value.appId&&!/^\d{3,32}$/.test(value.appId)||typeof value.secret!=='string'||value.secret.length>32768||typeof value.cwd!=='string'||value.cwd&&!isAbsolute(value.cwd)||!Array.isArray(value.seen)||value.seen.some(id=>typeof id!=='string'||id.length>512)||!Array.isArray(value.outbox)||value.outbox.some(e=>!e||typeof e.text!=='string'||e.text.length>100000||typeof e.uncertain!=='boolean')||!['read-only','workspace-write'].includes(value.permission)||value.ownerId&&!identity(value.ownerId)||value.threadId&&!identity(value.threadId))fail('invalid_settings');
    config={...config,...value,seen:value.seen.slice(-512),outbox:value.outbox.slice(-12)};
    if(config.job){config.outbox.push({text:T('上次连接在任务结束前中断；没有自动重做，请先检查执行结果。','The previous connection ended during a task. It was not run again; check its outcome before retrying.'),uncertain:false});config.job=null;}
  }catch(e){if(e.code!=='ENOENT')throw e;}
  if(provider==='onebot'&&(config.endpoint!==undefined&&config.endpoint!=='ws://127.0.0.1:17630/'||config.selfId!==undefined&&config.selfId!==null&&!/^\d{5,16}$/.test(config.selfId)))fail('invalid_settings');
  if(!Array.isArray(config.threads)||config.threads.some(id=>!identity(id)))fail('invalid_settings');
  let catalog=createQQCatalog(config);const threadGuard=createQQThreadGuard({codexHome});
  const knownThreads=new Set(config.threads.slice(-256));
  if(config.turns!==undefined&&(!Array.isArray(config.turns)||config.turns.length>512||config.turns.some(t=>!t||!identity(t.threadId)||!identity(t.turnId))))fail('invalid_settings');
  config.turns??=[];const knownTurns=new Set(config.turns.map(t=>t.threadId+':'+t.turnId));
  config.execution=normalizeQQExecution(config.execution);
  if(config.lastExecution&&(!['chat','task'].includes(config.lastExecution.kind)||config.lastExecution.model!==null&&(typeof config.lastExecution.model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(config.lastExecution.model))||config.lastExecution.effort!==null&&!['none','minimal','low','medium','high','xhigh','max','ultra'].includes(config.lastExecution.effort)))fail('invalid_settings');
  let modelCache=null,modelListing=null,pendingExecution=null;
  let projectListing=null,sessionListing=null;
  function persist(){const bytes=JSON.stringify(config,null,2)+'\n';writes=writes.catch(()=>{}).then(async()=>{await safeFiles();const temp=join(dir,randomUUID()+'.tmp');await writeFile(temp,bytes,{flag:'wx',mode:0o600});await rename(temp,file);});return writes;}
  async function commitChange(change){
    const before=structuredClone(config),beforePairing=pairing;
    try{const result=await change();await persist();return result;}
    catch(error){config=before;catalog=createQQCatalog(config);pairing=beforePairing;knownThreads.clear();for(const id of config.threads)knownThreads.add(id);knownTurns.clear();for(const turn of config.turns)knownTurns.add(turn.threadId+':'+turn.turnId);throw error;}
  }
  function state(){return {application,provider,capabilities:{models:modelSelection,desktopSessions:!scopedSessionsOnly()},enabled:config.enabled,configured:!!((provider==='official'?config.appId:config.endpoint)&&config.secret&&config.cwd),appId:provider==='official'?config.appId:'',hasSecret:!!config.secret,connection:{...connection},paired:!!config.ownerId,project:catalog.view()||{cwd:'',permission:'read-only',maxPermission:'read-only'},projects:catalog.list(),pairing:pairing&&pairing.expiresAt>now()?{code:pairing.code,expiresAt:new Date(pairing.expiresAt).toISOString()}:null,task:{...task},pendingReplies:config.outbox.length};}
  function emit(value){task={state:STATES.has(value)?value:'error'};try{onState({...task,activeCount:['thinking','working','waiting','result'].includes(task.state)?1:0,threadId:config.threadId||undefined});}catch{}}
  function clearPending(clearQueue=true){clearTimeout(expiry);expiry=null;approval=null;input=null;if(clearQueue)decisionQueue.length=0;}
  async function deliver(entry,{replyTo=lastMsgId}={}){
    const text=entry.text,chunk=Array.from(text).slice(0,6000).join(''),rest=Array.from(text).slice(6000).join('');
    const context=entry.context&&(entry.context.projectId!==catalog.current()?.id||entry.context.threadId&&entry.context.threadId!==config.threadId)?cleanTitle(entry.context.projectLabel)+' · '+cleanTitle(entry.context.title)+'\n':'';
    try{if(!transport)fail('offline');await transport.send({userId:config.ownerId,text:context+(entry.uncertain?T('上次投递未确认，保留结果：\n','Previous delivery was unconfirmed. Saved result:\n'):'')+chunk+(rest?T('\n发送 /结果 查看剩余内容。','\nSend /result for the rest.'):''),...(replyTo?{msgId:replyTo}:{})});}
    catch(e){entry.text=(typeof e.unsentText==='string'&&e.unsentText?e.unsentText:chunk)+rest;entry.uncertain=!!e.deliveryUnknown;await persist();return false;}
    const previous=config.outbox.map(e=>({...e}));
    if(rest){entry.text=rest;entry.uncertain=false;}else config.outbox=config.outbox.filter(e=>e!==entry);
    try{await persist();}catch(e){config.outbox=previous;throw e;}return true;
  }
  async function send(text,{durable=false,replyTo=lastMsgId,context}={}){
    if(durable){const entry={text:Array.from(text).slice(0,90000).join(''),uncertain:false,...(context?{context}:{})};config.outbox.push(entry);await persist();return deliver(entry,{replyTo});}
    const chunk=Array.from(text).slice(0,6000).join(''),rest=Array.from(text).slice(6000).join('');
    try{if(!transport)fail('offline');await transport.send({userId:config.ownerId,text:chunk+(rest?T('\n发送 /结果 查看剩余内容。','\nSend /result for the rest.'):''),...(replyTo?{msgId:replyTo}:{})});}
    catch{return false;}return true;
  }
  const sendTask=(text,options={})=>send(text,{...options,replyTo:config.job?.replyTo||config.job?.messageId,context:config.job?.context});
  const permissionText=value=>value==='workspace-write'?T('可修改项目','Can edit project'):T('只读','Read only');
  const selectedTitle=()=>catalog.selected()?.title||T('未命名会话','Untitled conversation');
  const modeText=value=>({auto:T('自动','Auto'),chat:T('聊天','Chat'),task:T('任务','Task')})[value];
  const toolsText=()=>{const p=catalog.current()?.toolPolicy;return'Shell: '+(p?.shell?T('开启 · 逐次确认','On · approve each call'):T('关闭','Off'))+'\nMCP: '+(p?.mcp?p.mcpServerIds.length+T(' 项 · 逐次确认',' selected · approve each call'):T('关闭','Off'));};
  const legacyText=()=>application==='codex'&&config.threadId&&catalog.selected()?.fileTools!==true?T('\n此会话仅文字续聊；文件任务请用 /新建 创建 QQ 会话。','\nThis conversation supports text continuation. Use /new for file tasks.'):'';
  const contextText=()=>T('应用：','App: ')+label+'\n'+T('项目：','Project: ')+(catalog.current()?.label||T('未选择','None'))+'\n'+T('会话：','Conversation: ')+(config.threadId?selectedTitle():T('下一条消息新建','New on next message'))+'\n'+T('权限：','Permission: ')+permissionText(config.permission)+'\n'+toolsText()+'\n'+T('模式：','Mode: ')+modeText(config.execution.mode)+(config.lastExecution?'\n'+T('最近模型：','Last model: ')+(config.lastExecution.model||T('由应用决定','App default'))+(config.lastExecution.effort?' · '+config.lastExecution.effort:''):'')+legacyText();
  function toolFailure(error){
    const aliases={mcp_source_changed:'mcp_config_changed',mcp_catalog_unavailable:'mcp_unavailable',mcp_server_unavailable:'mcp_unavailable',shell_approval_unavailable:'shell_unavailable',tool_scope_mismatch:'thread_tool_scope_mismatch',thread_not_managed:'thread_tool_scope_mismatch'};
    return({mcp_config_changed:T('MCP 配置已变化，请在电脑的 QQ 设置中重新选择并保存。','MCP configuration changed. Review and save it in QQ settings on your computer.'),mcp_unavailable:T('所选 MCP 服务不可用，请在电脑端检查连接。','A selected MCP server is unavailable. Check its connection on your computer.'),shell_unavailable:T('命令执行环境不可用，请在电脑端检查当前应用。','The command environment is unavailable. Check the app on your computer.'),thread_tool_scope_mismatch:T('这个会话的工具权限与当前设置不同，请新建会话。','This conversation has different tool permissions. Create a new conversation.')})[aliases[error?.code]||error?.code];
  }
  const isBusy=async()=>{if(!running)return false;await send(T('当前任务仍在执行；发送 /状态 或 /取消。','A task is running. Send /status or /cancel.'));return true;};
  function invalidateLists(){projectListing=null;sessionListing=null;modelCache=null;modelListing=null;pendingExecution=null;}
  function toolOptions(){const p=catalog.current();return{toolPolicy:p?.toolPolicy,toolScope:p?.toolScope||'files',mcpSourcePath:p?.mcpSourcePath||undefined,mcpRevision:p?.mcpRevision||undefined};}
  function scopedSessionsOnly(){return managedSessionsOnly||(catalog.current()?.toolScope||'files')!=='files';}
  function sameToolSession(session){return(session.toolScope||'files')===(catalog.current()?.toolScope||'files')&&(!scopedSessionsOnly()||session.permission===config.permission);}
  async function withCatalog(action){
    if(!acceptsNew())fail('host_unavailable');await catalog.check();
    const factory=createRemote||(await import('./codex-remote.mjs')).createCodexRemote;
    const client=await factory({codexPath,cwd:config.cwd,permission:config.permission,managedThreads:managedMetadata(),...toolOptions()});
    try{return await action(client);}finally{await client.close().catch(()=>{});}
  }
  function managedMetadata(){return config.sessions.filter(s=>s.projectId===catalog.current()?.id&&s.source==='qq'&&sameToolSession(s)).map(s=>({id:s.id,title:s.title,cwd:config.cwd,permission:s.permission,toolScope:s.toolScope||'files',fileTools:s.fileTools===true,updatedAt:Number.isSafeInteger(s.updatedAt)?s.updatedAt:0}));}
  function trimThreads(){while(knownThreads.size>256)knownThreads.delete(knownThreads.values().next().value);config.threads=[...knownThreads];}
  async function models(force=false){
    if(!force&&modelCache&&modelCache.projectId===catalog.current()?.id&&now()-modelCache.at<5*60_000)return modelCache.items;
    let items;try{items=await withCatalog(client=>client.listModels());}catch(error){if(error.code==='host_unavailable')throw error;fail('catalog_unavailable');}if(!Array.isArray(items)||!items.length||items.length>200)fail('catalog_unavailable');modelCache={projectId:catalog.current().id,at:now(),items};return items;
  }
  async function connect(){
    const epoch=++connectionEpoch,settings={appId:config.appId,secret:config.secret,endpoint:config.endpoint,selfId:config.selfId};
    transport?.stop();transport=null;if(!config.enabled||!config.secret||disposed)return;
    connection={state:'connecting'};
    try{
      const secret=await unseal(settings.secret),factory=createTransport||(provider==='onebot'?(await import('./onebot-transport.mjs')).createOneBotTransport:(await import('./qq-transport.mjs')).createQQTransport);
      if(epoch!==connectionEpoch||!config.enabled||disposed)return;
      let candidateReady=provider!=='onebot';
      const candidate=factory({...provider==='onebot'?{url:settings.endpoint,accessToken:secret,selfId:settings.selfId||undefined}:{appId:settings.appId,appSecret:secret},onMessage:m=>{if(transport===candidate&&epoch===connectionEpoch&&!disposed&&candidateReady&&(!config.ownerId||m?.userId===config.ownerId))return receive(m).catch(()=>{connection={state:'error',code:'storage_failed'};});},onStatus:s=>serial(async()=>{
        if(transport!==candidate||epoch!==connectionEpoch||disposed)return;
        if(provider==='onebot'&&s.state==='connected'){
          if(typeof s.selfId!=='string'||!/^\d{5,16}$/.test(s.selfId)||config.selfId&&config.selfId!==s.selfId){candidateReady=false;connectionEpoch++;transport=null;candidate.stop();connection={state:'error',code:'onebot_account_changed'};fail('onebot_account_changed');}
          if(!config.selfId)await commitChange(()=>{config.selfId=s.selfId;});
          if(transport!==candidate||epoch!==connectionEpoch||disposed)return;
          candidateReady=true;
        }
        else if(provider==='onebot')candidateReady=false;
        connection={state:s.state,...(s.code?{code:s.code}:{})};
      })});
      transport=candidate;await candidate.start();
    }catch{if(epoch===connectionEpoch&&!disposed)connection={state:'error',code:'connection_failed'};}
  }
  async function applyConfig(body,beforeSave){
    if(disposed)fail('unavailable');
    if(!body||typeof body!=='object'||Array.isArray(body))fail('invalid_input');
    if(body.action==='disable'){config.enabled=false;cancelRequested=true;connectionEpoch++;await persist();transport?.stop();transport=null;await remote?.cancel();await remote?.close();connection={state:'stopped'};return state();}
    if(running)fail('busy');
    if(body.action==='pair'){
      if(!config.enabled||!config.secret)fail('not_configured');
      if(config.ownerId)fail('already_paired');
      pairing={code:code(),expiresAt:now()+5*60_000};attempts.clear();return state();
    }
    if(body.action==='unlink'){await commitChange(()=>{clearPending();pairing=null;config.ownerId=null;catalog.clearSelections();config.outbox=[];config.seen=[];invalidateLists();});return state();}
    if(['project-select','project-remove'].includes(body.action)){
      if(Object.keys(body).some(k=>!['action','projectId'].includes(k))||!identity(body.projectId))fail('invalid_input');
      await commitChange(async()=>{if(body.action==='project-select')await catalog.select(body.projectId);else catalog.remove(body.projectId);invalidateLists();});emit('idle');return state();
    }
    const allowed=[...(provider==='onebot'?['action','endpoint','accessToken','cwd','permission','enabled']:['action','appId','appSecret','cwd','permission','enabled']),'toolPolicy','mcpSourcePath','mcpRevision'];
    if(body.action!=='save'||Object.keys(body).some(k=>!allowed.includes(k)))fail('invalid_input');
    if((provider==='official'?!/^\d{3,32}$/.test(body.appId||''):body.endpoint!=='ws://127.0.0.1:17630/')||typeof body.enabled!=='boolean'||!['read-only','workspace-write'].includes(body.permission)||!isAbsolute(body.cwd||''))fail('invalid_input');
    const cwd=await realpath(body.cwd).catch(()=>fail('invalid_directory'));
    if(!(await stat(cwd)).isDirectory()||parse(cwd).root===cwd)fail('invalid_directory');
    const supplied=provider==='onebot'?body.accessToken:body.appSecret;
    if(supplied!==undefined&&typeof supplied!=='string')fail('invalid_input');
    const changedApp=provider==='official'?body.appId!==config.appId:config.endpoint&&body.endpoint!==config.endpoint;
    if((changedApp||!config.secret)&&!supplied)fail('secret_required');
    if(supplied&&!/^[A-Za-z0-9_-]{6,256}$/.test(supplied))fail('invalid_input');
    const secret=supplied?await seal(supplied):config.secret;
    await commitChange(async()=>{await catalog.register(cwd,body.permission);if(body.toolPolicy!==undefined)catalog.setTools(body.toolPolicy,{sourcePath:body.mcpSourcePath,revision:body.mcpRevision});if(scopedSessionsOnly()&&catalog.selected()&&!sameToolSession(catalog.selected()))catalog.newSelection();if(changedApp){config.ownerId=null;config.seen=[];config.outbox=[];pairing=null;catalog.clearSelections();}Object.assign(config,{...(provider==='official'?{appId:body.appId}:{endpoint:body.endpoint}),secret,enabled:body.enabled});invalidateLists();if(beforeSave)await beforeSave();});
    void connect();return state();
  }
  async function handleEvent(event,token){
    if(token!==generation||disposed||cancelRequested)return;
    if(event.type==='state'){emit(event.state);return;}
    if(event.type==='blocked'){await sendTask(T('该操作未获远程执行权限，已拒绝。请在电脑上核对任务。','That operation was denied. Review the task on your computer.'));return;}
    if(event.type==='approval'){
      if(typeof event.summary!=='string'||event.summary.length>4000){await remote?.approve({approvalId:event.id,decision:'decline'});await sendTask(T('操作内容无法完整展示，已拒绝远程确认。请在电脑上处理。','The full operation cannot be displayed. Remote approval was denied; review it on your computer.'));return;}
      if(approval||input){decisionQueue.push(event);return;}
      clearPending(false);approval={id:event.id,code:code(),expiresAt:now()+120_000};emit('waiting');
      expiry=setTimeout(()=>{if(token===generation&&approval){void remote?.approve({approvalId:approval.id,decision:'decline'}).catch(()=>{});clearPending();cancelRequested=true;void remote?.cancel();}},120_000);expiry.unref?.();
      await sendTask(T('Codex 请求确认：\n','Codex requests approval:\n')+event.summary+T('\n仅批准这一次：/同意 ','\nApprove once: /approve ')+approval.code+T('\n拒绝：/拒绝 ','\nDeny: /deny ')+approval.code);return;
    }
    if(event.type==='input'){
      if(approval||input){decisionQueue.push(event);return;}
      clearPending(false);if(!Array.isArray(event.questions)||!event.questions.length||event.questions.some(q=>q.isSecret||q.secret)){await remote?.cancel();return;}
      input={id:event.id,questions:event.questions,index:0,answers:{},code:code()};emit('waiting');await askQuestion();
      expiry=setTimeout(()=>{if(token===generation&&input){clearPending();cancelRequested=true;void remote?.cancel();}},120_000);expiry.unref?.();
    }
  }
  async function askQuestion(){const q=input?.questions[input.index];if(!q)return;await sendTask(String(q.question||q.header||'').slice(0,1000)+(q.options?.length?'\n'+q.options.map((o,i)=>`${i+1}. ${o.label}`).join('\n'):'')+T('\n回复：/回答 ','\nReply: /answer ')+input.code+T(' 您的回答',' your answer'));}
  async function run(text,id,{taskCommand=false,kind}={}){
    if(!acceptsNew()){await unavailable();return;}
    if(config.outbox.length>=10){await send(T('请先发送 /结果 取回之前的结果。','Send /result to retrieve previous results first.'));return;}
    await catalog.check();
    const policy={...config.execution,...(kind?{mode:kind}:{})},purpose={text,taskCommand,lastKind:catalog.selected()?.lastKind};
    const nativeKind=modelSelection?null:chooseQQExecutionKind(policy,purpose);
    const execution=modelSelection?chooseQQExecution(policy,await models(),purpose):nativeKind?{kind:nativeKind,model:null,effort:null}:{needsChoice:true};
    if(execution.needsChoice){pendingExecution={text,id,projectId:catalog.current().id,threadId:config.threadId,permission:config.permission,at:now()};await send(T('这条按聊天处理，还是执行任务？\n/按聊天  或  /按任务','Chat or task?\n/as-chat  or  /as-task'));return;}
    releaseGate=activityGate?.acquire('qq-task');if(activityGate&&!releaseGate){await send(T('桌宠正在处理其它任务，请稍后再试。','Another pet task is running. Try again shortly.'));return;}
    const token=++generation;cancelRequested=false;config.job={messageId:id,state:'running',context:{projectId:catalog.current().id,projectLabel:catalog.current().label,title:selectedTitle()}};
    try{await persist();}catch(e){config.job=null;releaseGate?.();releaseGate=null;throw e;}
    running=Promise.resolve().then(async()=>{
      if(!acceptsNew()){await unavailable();return;}
      emit('thinking');
      if(cancelRequested){emit('idle');await sendTask(T('任务已取消。','Task cancelled.'),{durable:true});return;}
      const factory=createRemote||(await import('./codex-remote.mjs')).createCodexRemote;
      remote=await factory({codexPath,cwd:config.cwd,permission:config.permission,managedThreads:managedMetadata(),...toolOptions(),
        beforeResume:async(threadId,metadata)=>{const saved=catalog.session(threadId);if(!saved||!sameToolSession(saved))return undefined;await catalog.check();return application==='codex'?threadGuard({threadId,...metadata,cwd:config.cwd}):true;},
        onThread:async(threadId,metadata)=>{if(token!==generation||!identity(threadId))fail('invalid_thread');const previous=catalog.session(threadId);const saved=catalog.remember(threadId,{source:previous?.source||'qq',title:metadata?.title||'',...(typeof metadata?.fileTools==='boolean'?{fileTools:metadata.fileTools}:{})});saved.lastKind=execution.kind;saved.updatedAt=now();if(config.job)Object.assign(config.job.context,{threadId,title:selectedTitle()});if(metadata?.created!==false&&!previous){knownThreads.add(threadId);trimThreads();}await persist();},
        onTurn:async(threadId,turnId)=>{if(token!==generation||cancelRequested||!identity(threadId)||!identity(turnId))fail('invalid_thread');config.lastExecution={kind:execution.kind,model:execution.model,effort:execution.effort};const key=threadId+':'+turnId;knownTurns.add(key);config.turns.push({threadId,turnId});while(config.turns.length>512){const removed=config.turns.shift();knownTurns.delete(removed.threadId+':'+removed.turnId);}await persist();},
        onEvent:event=>handleEvent(event,token)});
      if(cancelRequested){emit('idle');await sendTask(T('任务已取消。','Task cancelled.'),{durable:true});return;}
      if(!acceptsNew()){emit('idle');await unavailable();return;}
      const result=await remote.prompt({text,...(config.threadId?{threadId:config.threadId}:{}),...(execution.model?{model:execution.model}:{}),...(execution.effort?{effort:execution.effort}:{})});
      clearPending();
      if(token!==generation)return;
      if(result.status==='completed'){emit('result');await sendTask(result.text||T('任务完成。','Task completed.'),{durable:true});emit('success');}
      else if(result.status==='interrupted'||result.status==='cancelled'){await sendTask(T('任务已取消。','Task cancelled.'),{durable:true});emit('idle');}
      else{await sendTask(T('任务未完成，请检查 Codex 后重试。','Task did not finish. Check Codex before retrying.'),{durable:true});emit('error');}
    }).catch(async error=>{clearPending();emit('error');const text=toolFailure(error)||(error.code==='thread_busy'?T('这个会话正在执行任务，请等电脑端结束后再发。','This conversation is busy. Wait for its task to finish.'):error.code==='thread_state_unknown'?T('暂时无法确认这个会话是否空闲，本次没有发送任务。','Could not confirm that this conversation is idle. No task was sent.'):T('Codex 未能完成本次任务，没有自动重试。','Codex could not finish the task. It was not retried.'));await sendTask(text,{durable:true});}).finally(async()=>{
      try{await remote?.close().catch(()=>{});config.job=null;await persist();}catch{connection={state:'error',code:'storage_failed'};}finally{remote=null;releaseGate?.();releaseGate=null;running=null;}
    });
    pendingExecution=null;return true;
  }
  async function executionCommand(text,messageId){
    const command=text.match(/^\/(模式|mode|模型|models|model|思考|effort|按聊天|按任务|as-chat|as-task)(?:\s+([\s\S]*))?$/i);if(!command)return false;
    if(!acceptsNew()){await unavailable();return true;}if(await isBusy())return true;
    const name=command[1].toLowerCase(),arg=(command[2]||'').trim();
    try{
      if(['按聊天','按任务','as-chat','as-task'].includes(name)){
        const pending=pendingExecution;
        if(arg)fail('invalid_choice');
        if(!pending||now()-pending.at>=5*60_000||pending.projectId!==catalog.current()?.id||pending.threadId!==config.threadId||pending.permission!==config.permission){pendingExecution=null;fail('stale_choice');}
        await run(pending.text,messageId,{kind:['按聊天','as-chat'].includes(name)?'chat':'task'});return true;
      }
      if(['模式','mode'].includes(name)){
        if(arg){const mode=({自动:'auto',auto:'auto',聊天:'chat',chat:'chat',任务:'task',task:'task'})[arg.toLowerCase()];if(!mode)fail('invalid_mode');await commitChange(()=>{config.execution=normalizeQQExecution({...config.execution,mode});});}
        await send(T('模式：','Mode: ')+modeText(config.execution.mode)+T('\n/模式 自动 · /模式 聊天 · /模式 任务','\n/mode auto · /mode chat · /mode task'));return true;
      }
      if(!modelSelection){await send(T('模型和思考强度由 '+label+' 自己的设置决定。','Model and reasoning effort follow your '+label+' settings.'));return true;}
      const available=await models(!arg);
      if(['模型','models','model'].includes(name)){
        if(!arg||/^(?:下一页|next)$/i.test(arg)){
          if(!arg)modelListing={at:now(),projectId:catalog.current().id,items:available,offset:0};
          else{if(!modelListing||modelListing.projectId!==catalog.current().id||now()-modelListing.at>=5*60_000)fail('stale_list');if(modelListing.offset+10>=modelListing.items.length){await send(T('模型目录已到最后一页。','That is the last page of models.'));return true;}modelListing.offset+=10;}
          const offset=modelListing.offset,items=modelListing.items;await send(items.slice(offset,offset+10).map((m,index)=>`${offset+index+1}. ${m.displayName} (${m.model})`).join('\n')+T('\n/模型 聊天 2  或  /模型 任务 1','\n/model chat 2  or  /model task 1')+(offset+10<items.length?T('\n/模型 下一页','\n/models next'):''));return true;
        }
        const match=arg.match(/^(聊天|任务|chat|task)\s+(\S+)$/i);if(!match)fail('invalid_model');const role=/^(?:聊天|chat)$/i.test(match[1])?'chat':'task',value=match[2];let selected;
        if(/^\d+$/.test(value)){if(!modelListing||modelListing.projectId!==catalog.current().id||now()-modelListing.at>=5*60_000)fail('stale_list');selected=modelListing.items[Number(value)-1];}
        else selected=available.find(m=>m.model===value||m.id===value);
        if(!selected||!available.some(m=>m.model===selected.model))fail('model_unavailable');
        await commitChange(()=>{config.execution=normalizeQQExecution({...config.execution,[role+'Model']:selected.model});});await send(modeText(role)+T('模型：',' model: ')+selected.model);return true;
      }
      if(!arg){await send(T('聊天思考：','Chat effort: ')+config.execution.chatEffort+'\n'+T('任务思考：','Task effort: ')+config.execution.taskEffort+T('\n/思考 聊天 low · /思考 任务 high','\n/effort chat low · /effort task high'));return true;}
      const match=arg.match(/^(聊天|任务|chat|task)\s+(\S+)$/i);if(!match)fail('invalid_effort');const role=/^(?:聊天|chat)$/i.test(match[1])?'chat':'task';const effort=({低:'low',中:'medium',高:'high'})[match[2]]||match[2].toLowerCase();
      const selected=chooseQQExecution({...config.execution,mode:role},available,{text:''}),model=available.find(m=>m.model===selected.model||m.id===selected.model);
      if(!model?.supportedReasoningEfforts.includes(effort))fail('unsupported_effort');
      await commitChange(()=>{config.execution=normalizeQQExecution({...config.execution,[role+'Effort']:effort});});await send(modeText(role)+T('思考：',' effort: ')+effort);
    }catch(error){await commandFailure(error);}return true;
  }
  const help=()=>T([
    '直接发消息，接着当前会话聊。',
    '/项目 · 查看授权项目；/项目 2 · 切换项目',
    '/会话 · 查看会话；/会话 2 · 切换会话',
    '/会话 搜索 名称 · 搜索；/会话 下一页',
    '/新建 名称 · 创建会话',
    '/任务 2 要做的事 · 发给列表中的会话',
    '/权限 · 查看；/权限 只读 或 /权限 编辑',
    '/模式 自动|聊天|任务 · /模型 · /思考',
    '/当前 · 当前项目、会话和权限',
    '/状态 · 进度；/取消 · 停止；/结果 · 取回结果',
  ].join('\n'),[
    'Send a message to continue the selected conversation.',
    '/projects · List projects; /project 2 · Switch',
    '/sessions · List; /session 2 · Switch',
    '/sessions search name · Search; /sessions next',
    '/new name · Create a conversation',
    '/task 2 your request · Send to a listed conversation',
    '/permissions · Show; /permissions read-only or edit',
    '/mode auto|chat|task · /models · /effort',
    '/current · Selected project, conversation and permissions',
    '/status · Progress; /cancel · Stop; /result · Saved result',
  ].join('\n'));
  const listFresh=list=>list&&list.projectId===catalog.current()?.id&&now()-list.at<5*60_000;
  async function listSessions({search='',next=false}={}){
    if(next&&(!listFresh(sessionListing)||!sessionListing.nextCursor))return send(T('没有下一页，请发送 /会话 重新查看。','No next page. Send /sessions to refresh.'));
    const project=catalog.current(),previous=sessionListing,searchTerm=next?previous.search:search,needle=searchTerm.toLocaleLowerCase();
    // 新空会话尚未进入官方列表；本机受管记录只提供ID线索，展示前仍逐条读取真实元数据。
    const listing=next?{...previous,items:[],localQueue:[...previous.localQueue],remaining:[...previous.remaining],seen:new Set(previous.seen),serverCursors:new Set(previous.serverCursors)}:{projectId:project.id,at:now(),items:[],search:searchTerm,localQueue:config.sessions.filter(item=>item.projectId===project.id&&item.source==='qq'&&sameToolSession(item)).slice(-256).reverse().map(item=>({id:item.id,title:item.title})),remaining:[],serverCursor:null,serverExhausted:false,serverCursors:new Set(),seen:new Set(),limited:false};
    const titleOf=item=>catalog.session(item.id)?.title||cleanTitle(item.title)||T('未命名会话','Untitled conversation');
    async function validated(item,expectedId){
      if(!item||!identity(item.id)||expectedId&&item.id!==expectedId||!isAbsolute(item.cwd||'')||!['idle','notLoaded','active','systemError'].includes(item.status)||!Number.isSafeInteger(item.updatedAt)||item.updatedAt<0)return null;
      const known=catalog.session(item.id);if(known&&!sameToolSession(known))return null;
      const declared=resolve(item.cwd),expected=resolve(project.cwd);if(process.platform==='win32'?declared.toLowerCase()!==expected.toLowerCase():declared!==expected)return null;
      const canonical=await realpath(item.cwd).catch(()=>null);if(!canonical||(process.platform==='win32'?canonical.toLowerCase()!==project.cwd.toLowerCase():canonical!==project.cwd))return null;
      return{id:item.id,title:cleanTitle(item.title),cwd:project.cwd,status:item.status,updatedAt:item.updatedAt};
    }
    function retain(item){
      if(!item||listing.seen.has(item.id)||needle&&!titleOf(item).toLocaleLowerCase().includes(needle))return;
      if(listing.seen.size>=2048){listing.limited=true;return;}
      listing.seen.add(item.id);listing.remaining.push(item);
    }
    await withCatalog(async client=>{
      while(listing.localQueue.length&&listing.items.length<10){
        const saved=listing.localQueue.shift();if(needle&&saved.title&&!saved.title.toLocaleLowerCase().includes(needle))continue;
        let item;try{item=await client.readThread({threadId:saved.id});}catch(error){if(['rpc_failed','thread_scope_mismatch','thread_source_unavailable'].includes(error?.code))continue;throw error;}
        retain(await validated(item,saved.id));while(listing.remaining.length&&listing.items.length<10)listing.items.push(listing.remaining.shift());
      }
      if(listing.localQueue.length)return;
      while(listing.remaining.length&&listing.items.length<10)listing.items.push(listing.remaining.shift());
      let reads=0;
      // 官方首屏被本地条目挤出的部分留在remaining，下页先消费，不能直接跳到官方下一游标。
      while(!listing.serverExhausted&&!listing.limited&&(listing.items.length<10||listing.remaining.length===0)&&reads++<32){
        const cursor=listing.serverCursor,key=cursor??'<first>';if(listing.serverCursors.has(key))fail('invalid_thread');if(listing.serverCursors.size>=2048){listing.limited=true;break;}listing.serverCursors.add(key);
        const result=scopedSessionsOnly()?{items:[],nextCursor:null}:await client.listThreads({...(cursor?{cursor}:{}),...(searchTerm?{search:searchTerm}:{})});
        if(!result||!Array.isArray(result.items)||result.items.length>10||result.nextCursor!=null&&(typeof result.nextCursor!=='string'||!result.nextCursor||result.nextCursor.length>2048||/[\u0000-\u001f\u007f]/.test(result.nextCursor)))fail('invalid_thread');
        listing.serverCursor=result.nextCursor??null;listing.serverExhausted=!listing.serverCursor;
        for(const item of result.items)retain(await validated(item));
        while(listing.remaining.length&&listing.items.length<10)listing.items.push(listing.remaining.shift());
      }
    });
    listing.at=now();listing.nextCursor=!listing.limited&&(listing.localQueue.length>0||listing.remaining.length>0||!listing.serverExhausted);sessionListing=listing;
    const rows=listing.items.map((item,index)=>{const busy=item.status==='active'?T(' · 执行中',' · Busy'):'',legacy=application==='codex'&&catalog.session(item.id)?.fileTools!==true?T(' · 文字续聊',' · Text continuation'):'';return `${index+1}. ${item.id===config.threadId?'● ':''}${titleOf(item)}${busy}${legacy}`;});
    const empty=listing.nextCursor?T('本页暂无新会话，可继续下一页。','No new conversations on this page. Continue to the next page.'):T('暂无会话，可用 /新建 名称 创建。','No conversations. Use /new name.');
    await send(T('项目：','Project: ')+project.label+'\n'+(rows.length?rows.join('\n'):empty)+(listing.nextCursor?T('\n/会话 下一页','\n/sessions next'):'')+(listing.limited?T('\n会话较多，请用 /会话 搜索 名称 缩小范围。','\nMany conversations match. Use /sessions search name to narrow the list.'):''));
  }
  async function selectSession(number,{announce=true}={}){
    if(!listFresh(sessionListing)||!Number.isInteger(number)||number<1||number>sessionListing.items.length)fail('stale_list');
    const listed=sessionListing.items[number-1];
    const saved=catalog.session(listed.id);if(saved&&!sameToolSession(saved)||scopedSessionsOnly()&&!saved)fail('thread_tool_scope_mismatch');
    const latest=await withCatalog(client=>client.readThread({threadId:listed.id}));
    if(!latest||latest.id!==listed.id||resolve(latest.cwd)!==resolve(config.cwd))fail('thread_scope_mismatch');
    if(latest.status==='active')fail('thread_busy');
    const old=catalog.session(latest.id);
    await commitChange(()=>catalog.remember(latest.id,{title:old?.title||cleanTitle(latest.title),source:old?.source||'existing'}));emit('idle');
    if(announce)await send(contextText()+T('\n下一条消息会接着这个会话执行。','\nYour next message continues this conversation.'));
  }
  async function navigation(text,messageId){
    const match=text.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);if(!match)return false;
    const command=match[1].toLowerCase(),arg=(match[2]||'').trim();
    const projects=['项目','projects','project'].includes(command),sessions=['会话','sessions','session'].includes(command),fresh=['新建','新会话','new'].includes(command),permissions=['权限','permissions','permission'].includes(command),current=['当前','current'].includes(command),taskCommand=['任务','发送','task','send'].includes(command);
    if(!projects&&!sessions&&!fresh&&!permissions&&!current&&!taskCommand)return false;
    if(current){await send(contextText());return true;}
    if(!acceptsNew()){await unavailable();return true;}
    if(await isBusy())return true;
    try{
      if(projects){
        if(!arg){const items=catalog.list();projectListing={at:now(),ids:items.map(p=>p.id)};await send(items.length?items.map((p,index)=>`${index+1}. ${p.id===catalog.current()?.id?'● ':''}${p.label} · ${permissionText(p.permission)}`).join('\n'):T('暂无授权项目，请先在电脑的 QQ 设置中添加。','No authorized projects. Add one in QQ settings on your computer.'));}
        else{const index=Number(arg)-1;if(!/^\d+$/.test(arg)||!projectListing||now()-projectListing.at>=5*60_000||!projectListing.ids[index])fail('stale_list');await commitChange(async()=>{await catalog.select(projectListing.ids[index]);invalidateLists();});emit('idle');await send(contextText());}return true;
      }
      if(permissions){
        if(arg){const value=/^(?:只读|read-only|readonly)$/i.test(arg)?'read-only':/^(?:编辑|修改|edit|workspace-write)$/i.test(arg)?'workspace-write':null;if(!value)fail('invalid_permission');await catalog.check();await commitChange(()=>{catalog.setPermission(value);if(scopedSessionsOnly()&&catalog.selected()?.permission!==value){catalog.newSelection();invalidateLists();}});}
        await send(T('当前权限：','Current permission: ')+permissionText(config.permission)+'\n'+T('电脑授权上限：','Computer-authorized limit: ')+permissionText(catalog.current()?.maxPermission)+'\n'+toolsText());return true;
      }
      if(sessions){
        if(/^\d+$/.test(arg))await selectSession(Number(arg));
        else if(/^(?:下一页|next)$/i.test(arg))await listSessions({next:true});
        else if(!arg)await listSessions();
        else{const search=arg.replace(/^(?:搜索|search)\s+/i,'');if(search.length>80)fail('invalid_input');await listSessions({search});}return true;
      }
      if(fresh){
        if(arg.length>80)fail('invalid_input');await commitChange(async()=>{const title=cleanTitle(arg),thread=await withCatalog(client=>client.createThread(title?{title}:{}));if(!thread||!identity(thread.id))fail('invalid_thread');catalog.remember(thread.id,{title:title||cleanTitle(thread.title),source:'qq',...(typeof thread.fileTools==='boolean'?{fileTools:thread.fileTools}:{})});knownThreads.add(thread.id);trimThreads();sessionListing=null;});emit('idle');await send(T('已创建会话：','Created: ')+selectedTitle()+'\n'+T('项目：','Project: ')+catalog.current().label);return true;
      }
      if(taskCommand){
        const target=arg.match(/^(\d+)\s+([\s\S]+)$/);if(target){await selectSession(Number(target[1]),{announce:false});await run(target[2],messageId,{taskCommand:true});}
        else if(arg)await run(arg,messageId,{taskCommand:true});else await send(T('用法：/任务 2 要做的事，或 /任务 要做的事。','Use /task 2 your request, or /task your request.'));return true;
      }
    }catch(error){await commandFailure(error);}return true;
  }
  async function commandFailure(error){
    const messages={stale_list:T('列表已过期或序号无效，请先重新查看 /项目 或 /会话。','The list expired or that number is invalid. Refresh /projects or /sessions.'),permission_limit:T('电脑只授权了只读访问。需要修改时，请先在电脑的 QQ 设置中允许。','Your computer permits read-only access. Allow edits in its QQ settings first.'),invalid_permission:T('可选权限：只读、编辑。','Available permissions: read-only, edit.'),invalid_directory:T('项目文件夹不可用，请在电脑的 QQ 设置中重新选择。','The project folder is unavailable. Choose it again in QQ settings.'),thread_busy:T('这个会话正在执行任务，请等电脑端结束后再选。','This conversation is busy. Wait for its task to finish.'),host_unavailable:T('所选任务应用 Codex 暂不可用，请检查安装、登录和 QQ 连接设置。','The selected task app, Codex, is unavailable. Check its installation, sign-in, and QQ connection settings.')};
    Object.assign(messages,{catalog_unavailable:T('模型目录暂不可用，请发送 /模型 重试。','The model catalog is unavailable. Send /models to retry.'),model_unavailable:T('这个模型当前不可用，请发送 /模型 重新选择。','That model is unavailable. Send /models to choose again.'),unsupported_effort:T('当前模型不支持这个思考档位，请重新选择。','This model does not support that reasoning effort.'),stale_choice:T('待选择的消息已过期或项目会话已变化，请重新发送。','That choice expired or its project or conversation changed. Send the message again.'),invalid_mode:T('可选模式：自动、聊天、任务。','Available modes: auto, chat, task.'),invalid_model:T('用法：/模型 聊天 2，或 /模型 任务 1。','Use /model chat 2 or /model task 1.'),invalid_effort:T('用法：/思考 聊天 low，或 /思考 任务 high。','Use /effort chat low or /effort task high.')});
    await send(messages[error?.code]||toolFailure(error)||T('操作未完成，请重试或发送 /帮助。','That operation did not finish. Try again or send /help.'));
  }
  // 收信先持久去重，控制命令在正在执行的任务之外处理，以便随时取消或审批。
  async function acceptMessage(message){
    if(disposed||!config.enabled||!message||!identity(message.userId)||typeof message.id!=='string'||!message.id||message.id.length>512||typeof message.text!=='string'||message.text.length>12000)return;
    const text=message.text.trim();if(!text)return;
    if(!config.ownerId){
      const match=text.match(/^\/(?:配对|pair) (\d{6})$/);
      if(!match||!pairing||pairing.expiresAt<=now())return;
      if(!attempts.has(message.userId)&&attempts.size>=32)return;
      const attempt=attempts.get(message.userId)||{count:0,at:now()};if(now()-attempt.at>60_000){attempt.count=0;attempt.at=now();}attempt.count++;attempts.set(message.userId,attempt);
      if(attempt.count>5||attempts.size>32||!same(match[1],pairing.code))return;
      config.ownerId=message.userId;pairing=null;lastMsgId=message.id;await persist();await send(T('已绑定。直接发消息即可继续同一个 Codex 会话。发送 /帮助 查看命令。','Paired. Send a message to continue your Codex conversation. Use /help for commands.'));return;
    }
    if(message.userId!==config.ownerId||config.seen.includes(message.id))return;
    config.seen.push(message.id);config.seen=config.seen.slice(-512);lastMsgId=message.id;await persist();
    if(/^\/(?:帮助|菜单|help|commands)$/.test(text)){await send(help());return;}
    if(/^\/(?:状态|status)$/.test(text)){
      const status=pendingExecution&&now()-pendingExecution.at<5*60_000?T('等待选择：/按聊天 或 /按任务','Waiting for /as-chat or /as-task'):T(({idle:'空闲',thinking:'思考',working:'工作',waiting:'等待确认',result:'整理结果',success:'完成',error:'出错'})[task.state],task.state);
      await send(T('当前状态：','Current state: ')+status+'\n'+contextText()+(approval?T('\n待确认：/同意 ','\nPending: /approve ')+approval.code:'')+(config.outbox.length?T('\n有保留结果，发送 /结果。','\nResults are waiting. Send /result.') :''));return;
    }
    if(/^\/(?:结果|result)$/.test(text)){
      const saved=config.outbox[0];if(!saved){await send(T('没有待取回的结果。','No saved results.'));return;}return deliver(saved);
    }
    if(/^\/(?:取消|cancel)$/.test(text)){if(config.job){config.job.replyTo=message.id;cancelRequested=true;clearPending();await remote?.cancel();}else if(pendingExecution){pendingExecution=null;await send(T('已取消待选择的消息。','Cancelled the pending message.'));}else await send(T('当前没有正在执行的任务。','No task is running.'));return;}
    const decision=text.match(/^\/(同意|拒绝|approve|deny) (\d{6})$/);
    if(decision){if(!approval||approval.expiresAt<=now()||!same(decision[2],approval.code)){await send(T('确认码已失效，请查询 /状态。','That approval code is no longer valid. Send /status.'));return;}const pending=approval;if(config.job)config.job.replyTo=message.id;clearPending(false);await remote.approve({approvalId:pending.id,decision:['同意','approve'].includes(decision[1])?'accept':'decline'});emit('working');const next=decisionQueue.shift();if(next)await handleEvent(next,generation);return;}
    const answer=text.match(/^\/(?:回答|answer) (\d{6}) ([\s\S]+)$/);
    if(answer){if(!input||!same(answer[1],input.code))return;const q=input.questions[input.index];let value=answer[2];if(q.options?.length&&/^\d+$/.test(value)){value=q.options[Number(value)-1]?.label;if(!value)return;}if(config.job)config.job.replyTo=message.id;input.answers[q.id]=[value.slice(0,2000)];input.index++;if(input.index<input.questions.length){await askQuestion();return;}const pending=input;clearPending(false);await remote.answer({inputId:pending.id,answers:pending.answers});emit('working');const next=decisionQueue.shift();if(next)await handleEvent(next,generation);return;}
    if(await executionCommand(text,message.id))return;
    if(await navigation(text,message.id))return;
    if(text.startsWith('/')){await send(T('命令未识别，发送 /帮助。','Unknown command. Send /help.'));return;}
    if(running){await send(T('当前任务仍在执行；发送 /状态 或 /取消。','A task is running. Send /status or /cancel.'));return;}
    try{await run(text,message.id);}catch(error){await commandFailure(error);}
  }
  const receive=message=>serial(()=>acceptMessage(message));
  async function dispose(){disposed=true;cancelRequested=true;connectionEpoch++;clearPending();pairing=null;transport?.stop();transport=null;await remote?.cancel().catch(()=>{});await remote?.close().catch(()=>{});await running?.catch(()=>{});await writes.catch(()=>{});}
  const pause=()=>serial(async()=>{if(running)fail('busy');connectionEpoch++;transport?.stop();transport=null;connection={state:'stopped'};});
  const projectTools=cwd=>{const p=config.projects.find(p=>(process.platform==='win32'?p.cwd.toLowerCase()===cwd.toLowerCase():p.cwd===cwd));return p?{toolPolicy:p.toolPolicy,toolScope:p.toolScope||'files',mcpSourcePath:p.mcpSourcePath||undefined,mcpRevision:p.mcpRevision||undefined}:{};};
  return {state,projectTools,configure:body=>serial(()=>applyConfig(body)),configureWithCommit:(body,commit)=>serial(()=>applyConfig(body,commit)),receive,start:connect,pause,dispose,isOwner:id=>Boolean(config.ownerId&&config.ownerId===id),ownsThread:id=>knownThreads.has(id),ownsTurn:(threadId,turnId)=>identity(turnId)&&knownTurns.has(threadId+':'+turnId),idle:async()=>{await requests;await running;await writes;}};
}
