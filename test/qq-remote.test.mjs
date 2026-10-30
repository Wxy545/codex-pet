import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir,rename,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodexActivityGate} from '../src/codex-tasks.mjs';
let createQQBridge;
let projectQQState;
try { ({createQQBridge,projectQQState}=await import('../src/qq-remote.mjs')); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND')throw e; }

async function fixture(t,{delayRemote=false,replyText,approvalCount=1,activityGate,onPrompt,canStart,now,threads=[],onRead,mode='task',availableModels}={}) {
  assert.equal(typeof createQQBridge,'function','QQ task bridge is missing');
  // Windows 的临时目录可能带 8.3 别名，合成元数据与本机登记同样使用规范路径。
  const root=await realpath(await mkdtemp(join(tmpdir(),'pet-qq-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const sent=[],packets=[],prompts=[],states=[],approvals=[],catalogCalls=[],factories=[];let options,failSend=false,approval,resolveTurn,releaseRemote,newThreads=0;
  const factoryOptions={dataRoot:root,codexPath:'synthetic-codex',codexHome:join(root,'synthetic-codex-home'),locale:'zh-CN',activityGate,canStart,now,
    seal:async s=>Buffer.from(s).toString('base64'),unseal:async s=>Buffer.from(s,'base64').toString(),
    onState:s=>states.push(s),
    createTransport:o=>{options=o;return{start(){o.onStatus({state:'connected'});},stop(){},async send(body){if(failSend)throw Object.assign(Error('offline'),{code:'offline'});packets.push({...body});sent.push(body.text);}};},
    createRemote:async o=>{factories.push(o);if(delayRemote&&o.onEvent)await new Promise(r=>{releaseRemote=r;});let cancelled=false;return{
      async listModels(){return availableModels??[{id:'gpt-6.1-sol',model:'gpt-6.1-sol',displayName:'Sol',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:['low','high']},{id:'gpt-6-luna',model:'gpt-6-luna',displayName:'Luna',isDefault:false,defaultReasoningEffort:'low',supportedReasoningEfforts:['low','high']}];},
      async listThreads(p){catalogCalls.push({method:'list',input:p,cwd:o.cwd});assert.notEqual(p.search,'');return{items:threads.filter(v=>v.cwd===o.cwd),nextCursor:null};},
      async readThread(p){catalogCalls.push({method:'read',input:p,cwd:o.cwd});return onRead?onRead(p,o):threads.find(v=>v.id===p.threadId);},
      async createThread(){const item={id:'synthetic-new-'+(++newThreads),title:'',cwd:o.cwd,status:'idle',updatedAt:1000};threads.push(item);await o.onThread?.(item.id,{created:true});return item;},
      async prompt(p){prompts.push(p);const id=p.threadId||'synthetic-thread';await o.onThread(id,{created:!p.threadId});if(cancelled)return{status:'interrupted'};await o.onTurn?.(id,'synthetic-turn-'+prompts.length);if(cancelled)return{status:'interrupted'};if(onPrompt)return onPrompt(p,o,root);if(p.text==='wait'){for(let index=0;index<approvalCount;index++)o.onEvent({type:'approval',id:approvalCount===1?'synthetic-approval':'synthetic-approval-'+index,kind:'command',summary:'Read README.md '+index});return new Promise(r=>{resolveTurn=r;});}return{threadId:id,text:replyText??'reply:'+p.text,status:'completed'};},async approve(p){approval=p;approvals.push({...p});},async cancel(){cancelled=true;resolveTurn?.({threadId:'synthetic-thread',text:'',status:'interrupted'});},async close(){},answer(){}};}};
  const bridge=await createQQBridge(factoryOptions);
  await bridge.configure({action:'save',appId:'123456',appSecret:'synthetic-secret',cwd:root,permission:'read-only',enabled:true});
  await new Promise(r=>setTimeout(r,0));
  const receive=async(text,id,userId='owner')=>{const before=sent.length;await bridge.receive({text,id,userId});if(text==='wait'&&!delayRemote&&userId==='owner'&&bridge.state().task.state==='thinking'){for(let n=0;n<200&&!sent.slice(before).some(s=>s.includes('/同意 '));n++)await new Promise(r=>setTimeout(r,5));}};
  const pair=async()=>{const p=await bridge.configure({action:'pair'});await receive('/配对 '+p.pairing.code,'pair-message');if(mode!=='auto')await receive('/mode '+mode,'fixture-mode');};
  return{bridge,root,sent,packets,prompts,states,approvals,catalogCalls,factories,threads,receive,pair,factoryOptions,get approval(){return approval;},set fail(v){failSend=v;},releaseRemote(){releaseRemote?.();},finish(){resolveTurn?.({threadId:'synthetic-thread',text:'done',status:'completed'});}};
}

test('native Harness admission blocks only new QQ tasks and conversations, keeping the paired owner and existing approval, cancel and result commands',async t=>{
  let allowed=true;const f=await fixture(t,{canStart:()=>allowed});t.after(()=>f.bridge.dispose());await f.pair();
  await f.receive('wait','existing-job');await new Promise(resolve=>setTimeout(resolve,5));
  const approvalCode=f.sent.find(value=>value.includes('/同意 ')).match(/\/同意 (\d{6})/)[1];
  allowed=false;await f.receive('/同意 '+approvalCode,'existing-approval');assert.equal(f.approvals.length,1);
  await f.receive('/取消','existing-cancel');await f.bridge.idle();assert.equal(f.bridge.state().paired,true);assert.equal(f.bridge.state().connection.state,'connected');
  const states=f.states.length;await f.receive('blocked task','blocked-job');await f.bridge.idle();await f.receive('/新会话','blocked-new');
  assert.equal(f.prompts.length,1);assert.equal(f.states.length,states);assert.ok(f.sent.at(-1).includes('Codex'));
  allowed=true;f.fail=true;await f.receive('retained result','retained-job');await f.bridge.idle();allowed=false;f.fail=false;await f.receive('/结果','existing-result');
  assert.equal(f.bridge.state().pendingReplies,0);assert.equal(f.prompts[1].threadId,'synthetic-thread');
  allowed=true;await f.receive('after restore','restored-job');await f.bridge.idle();assert.equal(f.prompts[2].threadId,'synthetic-thread');
});

test('a native handoff during remote startup prevents a new prompt without disconnecting or removing the QQ pairing',async t=>{
  let allowed=true;const f=await fixture(t,{canStart:()=>allowed,delayRemote:true});t.after(()=>f.bridge.dispose());await f.pair();
  await f.receive('late startup','late-job');await new Promise(resolve=>setTimeout(resolve,5));allowed=false;f.releaseRemote();await f.bridge.idle();
  assert.equal(f.prompts.length,0);assert.equal(f.bridge.state().paired,true);assert.equal(f.bridge.state().connection.state,'connected');assert.equal(f.states.at(-1).state,'idle');
});

test('only the locally paired QQ identity can run tasks and replayed messages never run twice',async t=>{
  const f=await fixture(t);t.after(()=>f.bridge.dispose());
  await f.receive('read files','unknown');assert.equal(f.prompts.length,0);
  await f.pair();await f.receive('hello','first');await f.bridge.idle();
  await f.receive('hello','first');await f.receive('intruder','other','stranger');
  assert.deepEqual(f.prompts.map(p=>p.text),['hello']);assert.ok(f.sent.includes('reply:hello'));
  const config=await readFile(join(f.root,'qq-remote/settings.json'),'utf8');assert.ok(!config.includes('synthetic-secret'));
  assert.ok(!JSON.stringify(f.bridge.state()).includes('synthetic-secret'));
});

test('普通消息只回复最终答案，不再发送机械确认；结果和审批保留原任务消息归属',async t=>{
  const f=await fixture(t);t.after(()=>f.bridge.dispose());await f.pair();const start=f.sent.length;
  await f.receive('测试1','plain-message');await f.bridge.idle();assert.deepEqual(f.sent.slice(start),['reply:测试1']);assert.equal(f.packets.at(-1).msgId,'plain-message');
  await f.receive('wait','origin-job');await new Promise(r=>setTimeout(r,5));await f.receive('/状态','status-command');assert.equal(f.packets.at(-1).msgId,'status-command');
  f.finish();await f.bridge.idle();assert.equal(f.packets.at(-1).msgId,'origin-job');assert.equal(f.sent.at(-1),'done');assert.ok(!f.sent.some(text=>text.includes('已交给')));
});

test('自动模式日常消息用可用Luna低强度，明确任务在同一会话切换默认强模型高强度',async t=>{
  const f=await fixture(t,{mode:'auto'});t.after(()=>f.bridge.dispose());await f.pair();await f.receive('你好','chat');await f.bridge.idle();
  assert.equal(f.prompts[0].model,'gpt-6-luna');assert.equal(f.prompts[0].effort,'low');
  await f.receive('/任务 检查 README.md','task');await f.bridge.idle();assert.equal(f.prompts[1].model,'gpt-6.1-sol');assert.equal(f.prompts[1].effort,'high');assert.equal(f.prompts[1].threadId,'synthetic-thread');assert.equal(f.bridge.state().project.permission,'read-only');
  await f.receive('/状态','status');assert.match(f.sent.at(-1),/gpt-6.1-sol · high/);
});

test('用户可手选模式、账号目录中的模型和受支持思考档位，设置持久且不改变文件权限',async t=>{
  const f=await fixture(t,{mode:'auto'});t.after(()=>f.bridge.dispose());await f.pair();await f.receive('/模型','models');assert.match(f.sent.at(-1),/Luna/);
  await f.receive('/模型 聊天 1','pick-sol');await f.receive('/思考 聊天 high','effort');await f.receive('/模式 聊天','mode');await f.receive('检查代码','manual-profile');await f.bridge.idle();
  assert.equal(f.prompts[0].model,'gpt-6.1-sol');assert.equal(f.prompts[0].effort,'high');assert.equal(f.bridge.state().project.permission,'read-only');
  await f.receive('/思考 聊天 unlimited','bad-effort');assert.match(f.sent.at(-1),/不支持/);const saved=JSON.parse(await readFile(join(f.root,'qq-remote/settings.json'),'utf8'));assert.equal(saved.execution.chatEffort,'high');assert.equal(saved.execution.chatModel,'gpt-6.1-sol');assert.equal(saved.execution.mode,'chat');
  await f.receive('/模型 聊天 not-a-model','invalid-model');assert.match(f.sent.at(-1),/不可用/);assert.equal(f.prompts.length,1);
});

test('无上下文模糊消息先等用户选择，确认一次才启动原文任务，不额外调用分类模型',async t=>{
  const f=await fixture(t,{mode:'auto'});t.after(()=>f.bridge.dispose());await f.pair();await f.receive('搞一下','unclear');assert.equal(f.prompts.length,0);assert.match(f.sent.at(-1),/按聊天/);
  await f.receive('/按任务','decide');await f.bridge.idle();assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].text,'搞一下');assert.equal(f.prompts[0].model,'gpt-6.1-sol');assert.equal(f.prompts[0].effort,'high');
  await f.receive('/按任务','stale-choice');await f.bridge.idle();assert.equal(f.prompts.length,1);assert.match(f.sent.at(-1),/过期/);
});

test('没有Luna则用账号默认低强度，手选模型下线后不自动换更贵模型或提交任务',async t=>{
  let clock=1000;const availableModels=[{id:'sol',model:'gpt-6.1-sol',displayName:'Sol',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:['low','high']}];
  const f=await fixture(t,{mode:'auto',now:()=>clock,availableModels});t.after(()=>f.bridge.dispose());await f.pair();await f.receive('测试1','fallback');await f.bridge.idle();assert.equal(f.prompts[0].model,'gpt-6.1-sol');assert.equal(f.prompts[0].effort,'low');
  availableModels.push({id:'luna',model:'gpt-6-luna',displayName:'Luna',isDefault:false,defaultReasoningEffort:'low',supportedReasoningEfforts:['low','high']});await f.receive('/模型','fresh-list');await f.receive('/模型 聊天 2','pick-luna');availableModels.pop();clock+=301000;await f.receive('测试2','removed');await f.bridge.idle();assert.equal(f.prompts.length,1);assert.match(f.sent.at(-1),/不可用/);
});

test('已授权项目在QQ按列表选择，各自保存会话与权限，不能用远端命令提升本机上限',async t=>{
  const f=await fixture(t);t.after(()=>f.bridge.dispose());await f.pair();await f.receive('first','first');await f.bridge.idle();
  const other=join(f.root,'second-project');await mkdir(other);
  await f.bridge.configure({action:'save',appId:'123456',cwd:other,permission:'workspace-write',enabled:true});assert.equal(f.bridge.state().projects.length,2);assert.equal(f.bridge.state().paired,true);
  await f.receive('/项目','projects');await f.receive('/项目 1','first-project');assert.equal(f.bridge.state().project.cwd,f.root);
  await f.receive('/权限 编辑','no-elevation');assert.equal(f.bridge.state().project.permission,'read-only');assert.match(f.sent.at(-1),/只读/);
  await f.receive('/项目','projects-again');await f.receive('/项目 2','second-project');await f.receive('/权限 只读','downgrade');assert.equal(f.bridge.state().project.permission,'read-only');
  await f.receive('/权限 编辑','restore-within-cap');assert.equal(f.bridge.state().project.permission,'workspace-write');
  await f.receive('/新建 新项目会话','new-project-thread');assert.equal(f.prompts.length,1,'metadata creation must not ask a model');
  await f.receive('/项目','projects-return');await f.receive('/项目 1','return-first');await f.receive('continue first','followup');await f.bridge.idle();assert.equal(f.prompts.at(-1).threadId,'synthetic-thread');
});

test('会话列表包含已有会话，按序号接着同一ID执行，目录查询不发送任务或创建副本',async t=>{
  const f=await fixture(t);t.after(()=>f.bridge.dispose());await f.pair();f.threads.push({id:'existing-desktop',title:'已有桌面会话',cwd:f.root,status:'idle',updatedAt:1000});
  await f.receive('/会话','list');assert.deepEqual(f.catalogCalls[0].input,{});assert.match(f.sent.at(-1),/已有桌面会话/);assert.doesNotMatch(f.sent.at(-1),/existing-desktop/);assert.equal(f.prompts.length,0);
  await f.receive('/会话 1','choose');await f.receive('继续这段会话','task');await f.bridge.idle();assert.equal(f.prompts[0].threadId,'existing-desktop');assert.equal(f.bridge.ownsThread('existing-desktop'),false);
  assert.equal(f.bridge.ownsTurn('existing-desktop','synthetic-turn-1'),true);assert.equal(f.bridge.ownsTurn('existing-desktop','desktop-next-turn'),false);
  const options=f.factories.at(-1),folder=join(f.root,'synthetic-codex-home','sessions');await mkdir(folder,{recursive:true});const file=join(folder,'synthetic-session.jsonl');
  const header=JSON.stringify({type:'session_meta',payload:{id:'existing-desktop',cwd:f.root}})+'\n';
  await writeFile(file,header+JSON.stringify({type:'event_msg',payload:{type:'task_started',turn_id:'desktop-busy'}})+'\n');assert.equal(await options.beforeResume('existing-desktop',{logPath:file,status:'notLoaded'}),false);
  await writeFile(file,header+JSON.stringify({type:'event_msg',payload:{type:'task_complete',turn_id:'desktop-done'}})+'\n');assert.equal(await options.beforeResume('existing-desktop',{logPath:file,status:'notLoaded'}),true);
  await f.bridge.dispose();const reopened=await createQQBridge(f.factoryOptions);t.after(()=>reopened.dispose());assert.equal(reopened.ownsTurn('existing-desktop','synthetic-turn-1'),true);assert.equal(reopened.ownsThread('existing-desktop'),false);
});

test('过期列表和繁忙会话不能切换，执行中也不能修改项目或权限',async t=>{
  let clock=1000;const f=await fixture(t,{now:()=>clock});t.after(()=>f.bridge.dispose());await f.pair();f.threads.push({id:'busy-desktop',title:'Busy',cwd:f.root,status:'active',updatedAt:1000});
  await f.receive('/会话','list');await f.receive('/会话 1','busy-select');assert.match(f.sent.at(-1),/执行任务/);assert.equal(f.prompts.length,0);
  clock+=301000;await f.receive('/会话 1','expired-select');assert.match(f.sent.at(-1),/过期/);
  await f.receive('wait','job');await new Promise(r=>setTimeout(r,5));const before=f.bridge.state().project;
  for(const [index,text]of ['/项目 1','/会话','/新建 名称','/权限 编辑'].entries())await f.receive(text,'busy-command-'+index);
  assert.deepEqual(f.bridge.state().project,before);assert.equal(f.catalogCalls.length,2);await f.receive('/取消','cancel');await f.bridge.idle();
});

test('指定会话任务命令沿用列表绑定；切换同项目会话后取回旧结果带来源',async t=>{
  const f=await fixture(t);t.after(()=>f.bridge.dispose());await f.pair();f.threads.push({id:'desktop-a',title:'会话A',cwd:f.root,status:'idle',updatedAt:1000},{id:'desktop-b',title:'会话B',cwd:f.root,status:'idle',updatedAt:1000});
  await f.receive('/会话','list');f.fail=true;await f.receive('/任务 1 检查README','targeted');await f.bridge.idle();assert.equal(f.prompts[0].threadId,'desktop-a');assert.equal(f.prompts[0].text,'检查README');assert.equal(f.bridge.state().pendingReplies,1);
  f.fail=false;await f.receive('/会话 2','choose-b');await f.receive('/结果','retrieve');assert.match(f.sent.at(-1),/会话A/);assert.match(f.sent.at(-1),/reply:检查README/);assert.equal(f.packets.at(-1).msgId,'retrieve');assert.equal(f.prompts.length,1);
});

test('会话选择保存失败回滚当前绑定，不会将下一个任务投向未保存的会话',async t=>{
  let breakFile=true;const f=await fixture(t,{onRead:async(p,o)=>{if(breakFile){breakFile=false;const file=join(o.cwd,'qq-remote/settings.json');await rename(file,file+'.saved');await mkdir(file);}return{id:p.threadId,title:'Existing',cwd:o.cwd,status:'idle',updatedAt:1000};}});t.after(()=>f.bridge.dispose());await f.pair();f.threads.push({id:'uncommitted-thread',title:'Existing',cwd:f.root,status:'idle',updatedAt:1000});
  await f.receive('/会话','list');await f.receive('/会话 1','failed-selection');await assert.rejects(f.bridge.idle());const file=join(f.root,'qq-remote/settings.json');await rm(file,{recursive:true});await rename(file+'.saved',file);
  await f.receive('after repair','recovered');await f.bridge.idle();assert.equal(f.prompts[0].threadId,undefined);assert.equal(f.bridge.ownsThread('uncommitted-thread'),false);
});

test('移除最后项目保留已保存密钥，重新授权项目不要求重新输入AppSecret',async t=>{
  const f=await fixture(t);t.after(()=>f.bridge.dispose());await f.pair();const projectId=f.bridge.state().project.id;
  await f.bridge.configure({action:'project-remove',projectId});assert.equal(f.bridge.state().configured,false);assert.equal(f.bridge.state().hasSecret,true);
  await f.bridge.configure({action:'save',appId:'123456',cwd:f.root,permission:'read-only',enabled:true});assert.equal(f.bridge.state().configured,true);assert.equal(f.bridge.state().paired,true);
});

test('follow-up messages resume the saved Codex thread and a new conversation clears only its own binding',async t=>{
  const f=await fixture(t);t.after(()=>f.bridge.dispose());await f.pair();
  await f.receive('first','one');await f.bridge.idle();await f.receive('continue','two');await f.bridge.idle();
  assert.equal(f.prompts[1].threadId,'synthetic-thread');assert.equal(f.bridge.ownsThread('synthetic-thread'),true);
  await f.receive('/新会话','new');assert.equal(f.bridge.ownsThread('synthetic-thread'),true);await f.receive('fresh','three');await f.bridge.idle();assert.equal(f.prompts[2].threadId,'synthetic-new-1');
});

test('approval requires the owner and current one-time code; cancelling invalidates it and never celebrates',async t=>{
  const f=await fixture(t);t.after(()=>f.bridge.dispose());await f.pair();
  await f.receive('wait','wait');await new Promise(r=>setTimeout(r,5));
  const approvalMessage=f.sent.find(s=>s.includes('/同意 '));assert.ok(approvalMessage);
  const code=approvalMessage.match(/\/同意 (\d+)/)[1];
  await f.receive('/同意 '+code,'fake','stranger');assert.equal(f.approval,undefined);
  await f.receive('/同意 '+code,'yes');assert.equal(f.approval.decision,'accept');
  await f.receive('/同意 '+code,'duplicate');await f.receive('/取消','cancel');await f.bridge.idle();
  assert.equal(f.states.at(-1).state,'idle');assert.ok(!f.states.some(s=>s.state==='success'));
});

test('failed result delivery remains available for an explicit result request without rerunning Codex',async t=>{
  const f=await fixture(t);t.after(()=>f.bridge.dispose());await f.pair();f.fail=true;
  await f.receive('offline job','job');await f.bridge.idle();assert.equal(f.bridge.state().pendingReplies,1);
  f.fail=false;await f.receive('/结果','result');assert.equal(f.bridge.state().pendingReplies,0);assert.equal(f.prompts.length,1);
  assert.ok(f.sent.some(s=>s.includes('reply:offline job')));
});

test('an immediate cancellation before Codex starts prevents the pending task from running',async t=>{
  const f=await fixture(t,{delayRemote:true});t.after(()=>f.bridge.dispose());await f.pair();
  await f.receive('wait','early-job');await new Promise(r=>setTimeout(r,5));
  await f.receive('/取消','early-cancel');f.releaseRemote();await f.bridge.idle();
  assert.equal(f.prompts.length,0);
});

test('QQ waiting takes display priority, while a remote completion never hides a local active task',()=>{
  assert.equal(typeof projectQQState,'function');
  assert.equal(projectQQState({state:'working',activeCount:1},{state:'waiting',activeCount:1}).state,'waiting');
  assert.equal(projectQQState({state:'working',activeCount:1},{state:'success',activeCount:0}).state,'working');
  assert.equal(projectQQState({state:'idle',activeCount:0},{state:'success',activeCount:0}).state,'success');
});

test('disconnect during secret decryption prevents a late connection from reviving the bot',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'pet-qq-connect-')));t.after(()=>rm(root,{recursive:true,force:true}));
  let release,starts=0;
  const bridge=await createQQBridge({dataRoot:root,codexPath:'synthetic',seal:async s=>s,unseal:()=>new Promise(r=>{release=r;}),createTransport:()=>({start(){starts++;},stop(){}})});t.after(()=>bridge.dispose());
  await bridge.configure({action:'save',appId:'123456',appSecret:'synthetic-secret',cwd:root,permission:'read-only',enabled:true});
  await bridge.configure({action:'disable'});release('synthetic-secret');await new Promise(r=>setTimeout(r,0));
  assert.equal(starts,0);assert.equal(bridge.state().connection.state,'stopped');
});

test('a long result survives its first delivery failure and every retained page is retrieved without rerunning Codex',async t=>{
  const result='BEGIN:'+('0123456789'.repeat(1300))+':END';
  const f=await fixture(t,{replyText:result});t.after(()=>f.bridge.dispose());await f.pair();f.fail=true;
  await f.receive('long result','long-job');await f.bridge.idle();
  const persisted=JSON.parse(await readFile(join(f.root,'qq-remote/settings.json'),'utf8'));
  assert.equal(persisted.outbox.length,1);assert.equal(persisted.outbox[0].text,result);
  f.fail=false;const start=f.sent.length;
  for(let page=0;page<4&&f.bridge.state().pendingReplies;page++)await f.receive('/结果','result-page-'+page);
  assert.equal(f.bridge.state().pendingReplies,0);assert.equal(f.prompts.length,1);
  assert.equal(f.sent.slice(start).map(value=>value.replace(/\n发送 \/结果 查看剩余内容。$/,'')).join(''),result);
});

test('recreating the bridge keeps message deduplication and resumes the saved thread only for a new message',async t=>{
  const f=await fixture(t);await f.pair();await f.receive('first task','persisted-message');await f.bridge.idle();await f.bridge.dispose();
  const reopened=await createQQBridge(f.factoryOptions);t.after(()=>reopened.dispose());await reopened.start();
  assert.equal(reopened.state().paired,true);assert.equal(reopened.ownsThread('synthetic-thread'),true);
  await reopened.receive({userId:'owner',id:'persisted-message',text:'first task'});await reopened.idle();assert.equal(f.prompts.length,1);
  await reopened.receive({userId:'owner',id:'fresh-message',text:'continue after restart'});await reopened.idle();
  assert.equal(f.prompts.length,2);assert.equal(f.prompts[1].text,'continue after restart');assert.equal(f.prompts[1].threadId,'synthetic-thread');
});

test('parallel approval requests remain associated with their original operation and are answered one at a time',async t=>{
  const f=await fixture(t,{approvalCount:2});t.after(()=>f.bridge.dispose());await f.pair();await f.receive('wait','parallel-job');
  for(let i=0;i<40&&!f.sent.some(value=>value.includes('/同意 '));i++)await new Promise(resolve=>setTimeout(resolve,2));
  let requests=f.sent.filter(value=>value.includes('/同意 '));assert.equal(requests.length,1);
  await f.receive('/同意 '+requests[0].match(/\/同意 (\d{6})/)[1],'approve-first');
  requests=f.sent.filter(value=>value.includes('/同意 '));assert.equal(requests.length,2);
  assert.deepEqual(f.approvals,[{approvalId:'synthetic-approval-0',decision:'accept'}]);
  await f.receive('/拒绝 '+requests[1].match(/\/拒绝 (\d{6})/)[1],'deny-second');
  assert.deepEqual(f.approvals,[{approvalId:'synthetic-approval-0',decision:'accept'},{approvalId:'synthetic-approval-1',decision:'decline'}]);
  f.finish();await f.bridge.idle();
});

test('concurrent configuration and unpair requests cannot replace the owner or project while a task is running',async t=>{
  const f=await fixture(t);t.after(()=>f.bridge.dispose());await f.pair();
  const results=await Promise.allSettled([
    f.receive('wait','busy-job'),
    f.bridge.configure({action:'unlink'}),
    f.bridge.configure({action:'save',appId:'654321',appSecret:'different-secret',cwd:f.root,permission:'workspace-write',enabled:true}),
  ]);
  assert.equal(results[0].status,'fulfilled');
  for(const result of results.slice(1)){assert.equal(result.status,'rejected');assert.equal(result.reason.code,'busy');}
  assert.equal(f.bridge.state().appId,'123456');assert.equal(f.bridge.state().paired,true);assert.equal(f.bridge.state().project.permission,'read-only');
  await f.receive('/取消','busy-cancel');await f.bridge.idle();
});

test('a real settings write failure releases the shared activity gate and the write queue recovers after the file is restored',async t=>{
  const gate=createCodexActivityGate();let breakOnce=true;
  const f=await fixture(t,{activityGate:gate,onPrompt:async(p,_remote,root)=>{
    if(breakOnce){breakOnce=false;const settings=join(root,'qq-remote/settings.json');await rename(settings,settings+'.saved');await mkdir(settings);}
    return{threadId:'synthetic-thread',text:'reply:'+p.text,status:'completed'};
  }});t.after(()=>f.bridge.dispose());await f.pair();
  await f.receive('write fails after task','write-failure-job');await assert.rejects(f.bridge.idle());
  const release=gate.acquire('local-recovery-check');assert.equal(typeof release,'function','a failed save must not keep all later tasks busy');release();
  const settings=join(f.root,'qq-remote/settings.json');await rm(settings,{recursive:true,force:true});await rename(settings+'.saved',settings);
  await f.receive('write restored','after-storage-recovery');await f.bridge.idle();
  assert.equal(f.prompts.length,2);assert.ok(f.sent.some(value=>value==='reply:write restored'));
  const recorded=JSON.parse(await readFile(settings,'utf8'));assert.equal(recorded.job,null);assert.ok(recorded.seen.includes('after-storage-recovery'));
});

test('closing during a failed result save still disposes the remote task without rejecting application shutdown',async t=>{
  let broken;const failedFile=new Promise(resolve=>{broken=resolve;});
  const f=await fixture(t,{onPrompt:async(_p,_remote,root)=>{
    const settings=join(root,'qq-remote/settings.json');await rename(settings,settings+'.saved');await mkdir(settings);broken();
    return{threadId:'synthetic-thread',text:'result while disk is unavailable',status:'completed'};
  }});
  await f.pair();await f.receive('job','closing-job');await failedFile;
  await assert.doesNotReject(f.bridge.dispose());
});

// 目录合并用独立协议替身：新空会话可read，但刻意不加入官方list，复现真实CLI行为。
async function mergedSessionFixture(t){
  const root=await realpath(await mkdtemp(join(tmpdir(),'pet-qq-merged-sessions-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const sent=[],reads=[],lists=[],records=new Map();let pages=[],bridge,created=0,sequence=0,modelTurns=0;
  const options={dataRoot:root,codexPath:'synthetic-codex',codexHome:join(root,'synthetic-home'),locale:'zh-CN',seal:async value=>Buffer.from(value).toString('base64'),unseal:async value=>Buffer.from(value,'base64').toString(),
    createTransport:o=>({start(){o.onStatus({state:'connected'});},stop(){},async send(value){sent.push(value.text);}}),
    createRemote:async o=>({async listThreads(input){lists.push({...input});const index=input.cursor?Number(input.cursor.slice(5)):0,page=pages[index]||[];return{items:page.map(item=>({...item})),nextCursor:index+1<pages.length?'page-'+(index+1):null};},async readThread({threadId}){reads.push(threadId);return records.get(threadId);},async createThread({title}={}){const item={id:'empty-qq-'+(++created),title:title||'未命名会话',cwd:o.cwd,status:'notLoaded',updatedAt:1000+created};records.set(item.id,item);return{...item};},async prompt(){modelTurns++;throw Error('metadata commands must never start a model');},async close(){}})};
  bridge=await createQQBridge(options);await bridge.configure({action:'save',appId:'123456',appSecret:'synthetic-secret',cwd:root,permission:'read-only',enabled:true});await new Promise(resolve=>setTimeout(resolve,0));
  const pairing=await bridge.configure({action:'pair'});await bridge.receive({userId:'owner',id:'merge-pair',text:'/配对 '+pairing.pairing.code});
  const post=async text=>{await bridge.receive({userId:'owner',id:'merge-command-'+(++sequence),text});return sent.at(-1);};
  t.after(async()=>{await bridge.dispose();});
  return{root,sent,reads,lists,records,post,get modelTurns(){return modelTurns;},setPages(value){pages=value;for(const page of pages)for(const item of page)records.set(item.id,{...item});},async reopen(){await bridge.dispose();bridge=await createQQBridge(options);await bridge.start();},get bridge(){return bridge;}};
}

test('官方空列表仍显示两个已创建QQ会话，状态逐条读取且重启后可按序号选择',async t=>{
  const f=await mergedSessionFixture(t);await f.post('/新建 First empty');await f.post('/新建 Second empty');f.records.get('empty-qq-2').status='active';
  const first=await f.post('/会话');assert.match(first,/1\. ● Second empty · 执行中/);assert.match(first,/2\. First empty/);assert.deepEqual(f.reads,['empty-qq-2','empty-qq-1']);assert.deepEqual(f.lists,[{}]);assert.doesNotMatch(first,/empty-qq-/);
  await f.post('/会话 2');assert.match(await f.post('/当前'),/会话：First empty/);await f.reopen();f.records.get('empty-qq-2').status='notLoaded';
  const restarted=await f.post('/会话');assert.match(restarted,/Second empty/);assert.match(restarted,/First empty/);await f.post('/会话 1');assert.match(await f.post('/当前'),/会话：Second empty/);assert.equal(f.modelTurns,0);
});

test('QQ记录合并挤出的官方首屏保留到下一页，官方跨页重复条目只显示一次',async t=>{
  const f=await mergedSessionFixture(t);await f.post('/新建 Local first');await f.post('/新建 Local second');
  const desktop=Array.from({length:17},(_,i)=>({id:'desktop-'+(i+1),title:'Desktop '+String(i+1).padStart(2,'0'),cwd:f.root,status:'idle',updatedAt:2000+i}));
  f.setPages([[{...f.records.get('empty-qq-1')},...desktop.slice(0,9)],[desktop[8],...desktop.slice(9)]]);
  const first=await f.post('/会话');assert.equal((first.match(/^\d+\./gm)||[]).length,10);assert.match(first,/Desktop 08/);assert.doesNotMatch(first,/Desktop 09/);assert.match(first,/下一页/);
  const second=await f.post('/会话 下一页');assert.match(second,/1\. Desktop 09/);assert.match(second,/Desktop 17/);assert.equal((second.match(/^\d+\./gm)||[]).length,9);assert.doesNotMatch(second,/下一页/);
  const all=(first+'\n'+second).match(/Desktop \d{2}|Local first|Local second/g);assert.equal(all.length,19);assert.equal(new Set(all).size,19);assert.deepEqual(f.lists,[{},{cursor:'page-1'}]);await f.post('/会话 1');assert.match(await f.post('/当前'),/Desktop 09/);assert.equal(f.modelTurns,0);
});

test('搜索同时过滤QQ标题和官方目录，并剔除重新核验后越出授权项目的受管记录',async t=>{
  const f=await mergedSessionFixture(t);await f.post('/新建 Alpha QQ');await f.post('/新建 Beta QQ');
  f.setPages([[{id:'desktop-alpha',title:'Alpha desktop',cwd:f.root,status:'idle',updatedAt:2000},{id:'desktop-beta',title:'Beta desktop',cwd:f.root,status:'idle',updatedAt:2001}]]);
  const alpha=await f.post('/会话 搜索 alpha');assert.match(alpha,/Alpha QQ/);assert.match(alpha,/Alpha desktop/);assert.doesNotMatch(alpha,/Beta/);assert.deepEqual(f.reads,['empty-qq-1']);assert.deepEqual(f.lists,[{search:'alpha'}]);
  f.records.get('empty-qq-1').cwd=tmpdir();const outside=await f.post('/会话 搜索 Alpha QQ');assert.doesNotMatch(outside,/\d+\./);assert.doesNotMatch(outside,/Alpha QQ/);assert.equal(f.modelTurns,0);
});
