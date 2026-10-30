import {mkdir,readFile,writeFile,rename,lstat,realpath,stat} from 'node:fs/promises';
import {randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {isAbsolute,join,resolve,parse} from 'node:path';
import {protectQQSecret,unprotectQQSecret} from './qq-secrets.mjs';

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
  return{...base,state:remote.state,activeCount:local+active,task:locale.startsWith('zh')?'正在处理 QQ 任务':'Processing a QQ task'};
}

/** 一个本机配对拥有一个持久Codex会话；QQ输入只能成为任务正文，不拼接shell。 */
export async function createQQBridge({dataRoot,codexPath,createTransport,createRemote,activityGate,onState=()=>{},seal=protectQQSecret,unseal=unprotectQQSecret,locale='zh-CN',now=Date.now}={}) {
  if(!isAbsolute(dataRoot||''))fail('invalid_directory');
  const zh=locale.startsWith('zh'),T=(cn,en)=>zh?cn:en;
  const dir=join(dataRoot,'qq-remote'),file=join(dir,'settings.json');
  let config={schemaVersion:1,enabled:false,appId:'',secret:'',cwd:'',permission:'read-only',ownerId:null,threadId:null,threads:[],seen:[],outbox:[],job:null};
  let writes=Promise.resolve(),requests=Promise.resolve(),transport,remote,running,releaseGate,pairing,approval,input,expiry,disposed=false,generation=0,cancelRequested=false;
  const decisionQueue=[];
  const serial=action=>{const next=requests.then(action);requests=next.catch(()=>{});return next;};
  let connection={state:'stopped'},task={state:'idle'},lastMsgId,connectionEpoch=0;
  const attempts=new Map();
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
  if(!Array.isArray(config.threads)||config.threads.some(id=>!identity(id)))fail('invalid_settings');
  const knownThreads=new Set([...config.threads.slice(-256),...(config.threadId?[config.threadId]:[])]);
  function persist(){const bytes=JSON.stringify(config,null,2)+'\n';writes=writes.catch(()=>{}).then(async()=>{await safeFiles();const temp=join(dir,randomUUID()+'.tmp');await writeFile(temp,bytes,{flag:'wx',mode:0o600});await rename(temp,file);});return writes;}
  function state(){return {enabled:config.enabled,configured:!!(config.appId&&config.secret&&config.cwd),appId:config.appId,connection:{...connection},paired:!!config.ownerId,project:{cwd:config.cwd,permission:config.permission},pairing:pairing&&pairing.expiresAt>now()?{code:pairing.code,expiresAt:new Date(pairing.expiresAt).toISOString()}:null,task:{...task},pendingReplies:config.outbox.length};}
  function emit(value){task={state:STATES.has(value)?value:'error'};try{onState({...task,activeCount:['thinking','working','waiting','result'].includes(task.state)?1:0,threadId:config.threadId||undefined});}catch{}}
  function clearPending(clearQueue=true){clearTimeout(expiry);expiry=null;approval=null;input=null;if(clearQueue)decisionQueue.length=0;}
  async function deliver(entry){
    const text=entry.text,chunk=Array.from(text).slice(0,6000).join(''),rest=Array.from(text).slice(6000).join('');
    try{if(!transport)fail('offline');await transport.send({userId:config.ownerId,text:(entry.uncertain?T('上次投递未确认，保留结果：\n','Previous delivery was unconfirmed. Saved result:\n'):'')+chunk+(rest?T('\n发送 /结果 查看剩余内容。','\nSend /result for the rest.'):''),...(lastMsgId?{msgId:lastMsgId}:{})});}
    catch(e){entry.text=(typeof e.unsentText==='string'&&e.unsentText?e.unsentText:chunk)+rest;entry.uncertain=!!e.deliveryUnknown;await persist();return false;}
    const previous=config.outbox.map(e=>({...e}));
    if(rest){entry.text=rest;entry.uncertain=false;}else config.outbox=config.outbox.filter(e=>e!==entry);
    try{await persist();}catch(e){config.outbox=previous;throw e;}return true;
  }
  async function send(text,{durable=false}={}){
    if(durable){const entry={text:Array.from(text).slice(0,90000).join(''),uncertain:false};config.outbox.push(entry);await persist();return deliver(entry);}
    const chunk=Array.from(text).slice(0,6000).join(''),rest=Array.from(text).slice(6000).join('');
    try{if(!transport)fail('offline');await transport.send({userId:config.ownerId,text:chunk+(rest?T('\n发送 /结果 查看剩余内容。','\nSend /result for the rest.'):''),...(lastMsgId?{msgId:lastMsgId}:{})});}
    catch{return false;}return true;
  }
  async function connect(){
    const epoch=++connectionEpoch,settings={appId:config.appId,secret:config.secret};
    transport?.stop();transport=null;if(!config.enabled||!config.secret||disposed)return;
    connection={state:'connecting'};
    try{
      const secret=await unseal(settings.secret),factory=createTransport||(await import('./qq-transport.mjs')).createQQTransport;
      if(epoch!==connectionEpoch||!config.enabled||disposed)return;
      const candidate=factory({appId:settings.appId,appSecret:secret,onMessage:m=>{if(transport===candidate&&epoch===connectionEpoch&&!disposed)void receive(m).catch(()=>{connection={state:'error',code:'storage_failed'};});},onStatus:s=>{if(transport===candidate&&epoch===connectionEpoch&&!disposed)connection={state:s.state, ...(s.code?{code:s.code}:{})};}});
      transport=candidate;await candidate.start();
    }catch{if(epoch===connectionEpoch&&!disposed)connection={state:'error',code:'connection_failed'};}
  }
  async function applyConfig(body){
    if(disposed)fail('unavailable');
    if(!body||typeof body!=='object'||Array.isArray(body))fail('invalid_input');
    if(body.action==='disable'){config.enabled=false;cancelRequested=true;connectionEpoch++;await persist();transport?.stop();transport=null;await remote?.cancel();await remote?.close();connection={state:'stopped'};return state();}
    if(running)fail('busy');
    if(body.action==='pair'){
      if(!config.enabled||!config.secret)fail('not_configured');
      if(config.ownerId)fail('already_paired');
      pairing={code:code(),expiresAt:now()+5*60_000};attempts.clear();return state();
    }
    if(body.action==='unlink'){clearPending();pairing=null;config.ownerId=null;config.threadId=null;config.outbox=[];config.seen=[];await persist();return state();}
    if(body.action!=='save'||Object.keys(body).some(k=>!['action','appId','appSecret','cwd','permission','enabled'].includes(k)))fail('invalid_input');
    if(!/^\d{3,32}$/.test(body.appId||'')||typeof body.enabled!=='boolean'||!['read-only','workspace-write'].includes(body.permission)||!isAbsolute(body.cwd||''))fail('invalid_input');
    const cwd=await realpath(body.cwd).catch(()=>fail('invalid_directory'));
    if(!(await stat(cwd)).isDirectory()||parse(cwd).root===cwd)fail('invalid_directory');
    if(body.appSecret!==undefined&&typeof body.appSecret!=='string')fail('invalid_input');
    const changedApp=body.appId!==config.appId;
    if((changedApp||!config.secret)&&!body.appSecret)fail('secret_required');
    if(body.appSecret&&!/^[A-Za-z0-9_-]{6,256}$/.test(body.appSecret))fail('invalid_input');
    const secret=body.appSecret?await seal(body.appSecret):config.secret;
    if(changedApp){config.ownerId=null;config.seen=[];config.outbox=[];pairing=null;}
    if(changedApp||resolve(cwd)!==resolve(config.cwd||dataRoot)||body.permission!==config.permission)config.threadId=null;
    Object.assign(config,{appId:body.appId,secret,cwd,permission:body.permission,enabled:body.enabled});await persist();
    void connect();return state();
  }
  async function handleEvent(event,token){
    if(token!==generation||disposed||cancelRequested)return;
    if(event.type==='state'){emit(event.state);return;}
    if(event.type==='blocked'){await send(T('该操作未获远程执行权限，已拒绝。请在电脑上核对任务。','That operation was denied. Review the task on your computer.'));return;}
    if(event.type==='approval'){
      if(typeof event.summary!=='string'||event.summary.length>4000){await remote?.approve({approvalId:event.id,decision:'decline'});await send(T('操作内容无法完整展示，已拒绝远程确认。请在电脑上处理。','The full operation cannot be displayed. Remote approval was denied; review it on your computer.'));return;}
      if(approval||input){decisionQueue.push(event);return;}
      clearPending(false);approval={id:event.id,code:code(),expiresAt:now()+120_000};emit('waiting');
      expiry=setTimeout(()=>{if(token===generation&&approval){void remote?.approve({approvalId:approval.id,decision:'decline'}).catch(()=>{});clearPending();cancelRequested=true;void remote?.cancel();}},120_000);expiry.unref?.();
      await send(T('Codex 请求确认：\n','Codex requests approval:\n')+event.summary+T('\n仅批准这一次：/同意 ','\nApprove once: /approve ')+approval.code+T('\n拒绝：/拒绝 ','\nDeny: /deny ')+approval.code);return;
    }
    if(event.type==='input'){
      if(approval||input){decisionQueue.push(event);return;}
      clearPending(false);if(!Array.isArray(event.questions)||!event.questions.length||event.questions.some(q=>q.isSecret||q.secret)){await remote?.cancel();return;}
      input={id:event.id,questions:event.questions,index:0,answers:{},code:code()};emit('waiting');await askQuestion();
      expiry=setTimeout(()=>{if(token===generation&&input){clearPending();cancelRequested=true;void remote?.cancel();}},120_000);expiry.unref?.();
    }
  }
  async function askQuestion(){const q=input?.questions[input.index];if(!q)return;await send(String(q.question||q.header||'').slice(0,1000)+(q.options?.length?'\n'+q.options.map((o,i)=>`${i+1}. ${o.label}`).join('\n'):'')+T('\n回复：/回答 ','\nReply: /answer ')+input.code+T(' 您的回答',' your answer'));}
  async function run(text,id){
    if(config.outbox.length>=10){await send(T('请先发送 /结果 取回之前的结果。','Send /result to retrieve previous results first.'));return;}
    releaseGate=activityGate?.acquire('qq-task');if(activityGate&&!releaseGate){await send(T('桌宠正在处理其它任务，请稍后再试。','Another pet task is running. Try again shortly.'));return;}
    const token=++generation;cancelRequested=false;config.job={messageId:id,state:'running'};
    try{await persist();}catch(e){config.job=null;releaseGate?.();releaseGate=null;throw e;}
    running=Promise.resolve().then(async()=>{
      emit('thinking');await send(T('已交给 Codex。可发送 /状态 或 /取消。','Sent to Codex. Use /status or /cancel.'));
      if(cancelRequested){emit('idle');await send(T('任务已取消。','Task cancelled.'),{durable:true});return;}
      const factory=createRemote||(await import('./codex-remote.mjs')).createCodexRemote;
      remote=await factory({codexPath,cwd:config.cwd,permission:config.permission,onThread:async threadId=>{if(token!==generation||!identity(threadId))fail('invalid_thread');config.threadId=threadId;knownThreads.add(threadId);while(knownThreads.size>256)knownThreads.delete(knownThreads.values().next().value);config.threads=[...knownThreads];await persist();},onEvent:event=>handleEvent(event,token)});
      if(cancelRequested){emit('idle');await send(T('任务已取消。','Task cancelled.'),{durable:true});return;}
      const result=await remote.prompt({text,...(config.threadId?{threadId:config.threadId}:{})});
      clearPending();
      if(token!==generation)return;
      if(result.status==='completed'){emit('result');await send(result.text||T('任务完成。','Task completed.'),{durable:true});emit('success');}
      else if(result.status==='interrupted'||result.status==='cancelled'){await send(T('任务已取消。','Task cancelled.'),{durable:true});emit('idle');}
      else{await send(T('任务未完成，请检查 Codex 后重试。','Task did not finish. Check Codex before retrying.'),{durable:true});emit('error');}
    }).catch(async()=>{clearPending();emit('error');await send(T('Codex 未能完成本次任务，没有自动重试。','Codex could not finish the task. It was not retried.'),{durable:true});}).finally(async()=>{
      try{await remote?.close().catch(()=>{});config.job=null;await persist();}catch{connection={state:'error',code:'storage_failed'};}finally{remote=null;releaseGate?.();releaseGate=null;running=null;}
    });
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
    if(/^\/(?:帮助|help)$/.test(text)){await send(T('直接发送任务；/状态、/取消、/结果、/新会话。审批请用本次收到的确认码。','Send a task, or use /status, /cancel, /result, /new. Use the current code for approvals.'));return;}
    if(/^\/(?:状态|status)$/.test(text)){await send(T('当前状态：','Current state: ')+T(({idle:'空闲',thinking:'思考',working:'工作',waiting:'等待确认',result:'整理结果',success:'完成',error:'出错'})[task.state],task.state)+(approval?T('\n待确认：/同意 ','\nPending: /approve ')+approval.code:'')+(config.outbox.length?T('\n有保留结果，发送 /结果。','\nResults are waiting. Send /result.') :''));return;}
    if(/^\/(?:结果|result)$/.test(text)){
      const saved=config.outbox[0];if(!saved){await send(T('没有待取回的结果。','No saved results.'));return;}return deliver(saved);
    }
    if(/^\/(?:取消|cancel)$/.test(text)){if(config.job){cancelRequested=true;clearPending();await remote?.cancel();}else await send(T('当前没有正在执行的任务。','No task is running.'));return;}
    if(/^\/(?:新会话|new)$/.test(text)){if(running){await send(T('请先等待任务结束，或发送 /取消。','Wait for the task to finish or send /cancel.'));return;}config.threadId=null;await persist();emit('idle');await send(T('已开始新的 Codex 会话。','A new Codex conversation is ready.'));return;}
    const decision=text.match(/^\/(同意|拒绝|approve|deny) (\d{6})$/);
    if(decision){if(!approval||approval.expiresAt<=now()||!same(decision[2],approval.code)){await send(T('确认码已失效，请查询 /状态。','That approval code is no longer valid. Send /status.'));return;}const pending=approval;clearPending(false);await remote.approve({approvalId:pending.id,decision:['同意','approve'].includes(decision[1])?'accept':'decline'});emit('working');const next=decisionQueue.shift();if(next)await handleEvent(next,generation);return;}
    const answer=text.match(/^\/(?:回答|answer) (\d{6}) ([\s\S]+)$/);
    if(answer){if(!input||!same(answer[1],input.code))return;const q=input.questions[input.index];let value=answer[2];if(q.options?.length&&/^\d+$/.test(value)){value=q.options[Number(value)-1]?.label;if(!value)return;}input.answers[q.id]=[value.slice(0,2000)];input.index++;if(input.index<input.questions.length){await askQuestion();return;}const pending=input;clearPending(false);await remote.answer({inputId:pending.id,answers:pending.answers});emit('working');const next=decisionQueue.shift();if(next)await handleEvent(next,generation);return;}
    if(text.startsWith('/')){await send(T('命令未识别，发送 /帮助。','Unknown command. Send /help.'));return;}
    if(running){await send(T('当前任务仍在执行；发送 /状态 或 /取消。','A task is running. Send /status or /cancel.'));return;}
    await run(text,message.id);
  }
  const receive=message=>serial(()=>acceptMessage(message));
  async function dispose(){disposed=true;cancelRequested=true;connectionEpoch++;clearPending();pairing=null;transport?.stop();transport=null;await remote?.cancel().catch(()=>{});await remote?.close().catch(()=>{});await running?.catch(()=>{});await writes.catch(()=>{});}
  return {state,configure:body=>serial(()=>applyConfig(body)),receive,start:connect,dispose,ownsThread:id=>knownThreads.has(id),idle:async()=>{await requests;await running;await writes;}};
}
