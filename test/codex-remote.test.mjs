import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let createCodexRemote;
try { ({createCodexRemote}=await import('../src/codex-remote.mjs')); }
catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }

const pause=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check) { for(let n=0;n<100;n++){if(check())return;await pause();}assert.fail('protocol step did not arrive'); }
function rig(t,options={}) {
  assert.equal(typeof createCodexRemote,'function','missing Codex app-server adapter');
  const cwd=mkdtempSync(join(tmpdir(),'codex-pet-remote-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  const events=[],calls=[],spawns=[];let child;
  const send=value=>child.stdout.write(JSON.stringify(value)+'\n');
  const reply=(message,result)=>send({id:message.id,result});
  const notify=(method,params)=>send({method,params});
  const fakeSpawn=(file,args,opts)=>{
    child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;
    let buffer='';child.stdin=new Writable({write(bytes,_encoding,done){buffer+=bytes.toString();let cut;while((cut=buffer.indexOf('\n'))>=0){const m=JSON.parse(buffer.slice(0,cut));buffer=buffer.slice(cut+1);calls.push(m);queueMicrotask(()=>{
      if(options.dispatch?.(m,{send,reply,notify,cwd})===false)return;
      if(m.method==='initialize')reply(m,{userAgent:'synthetic-codex/1'});
      if(m.method==='thread/start'||m.method==='thread/resume')reply(m,{thread:{id:m.params.threadId??'synthetic-thread',cwd,status:{type:'idle'},turns:[]}});
      if(m.method==='turn/start')reply(m,{turn:{id:'synthetic-turn',status:'inProgress',items:[]}});
      if(m.method==='turn/interrupt'){reply(m,{});notify('turn/completed',{threadId:'synthetic-thread',turn:{id:'synthetic-turn',status:'interrupted',items:[]}});}
    });}done();}});
    child.kill=()=>{child.killed=true;child.exitCode=1;queueMicrotask(()=>child.emit('close',1));return true;};
    child.stdin.on('finish',()=>{child.exitCode=0;queueMicrotask(()=>child.emit('close',0));});
    spawns.push({file,args,options:opts,child});return child;
  };
  const remote=createCodexRemote({cwd,codexPath:'C:/synthetic/codex.exe',permission:'workspace-write',onEvent:event=>events.push(event),spawnImpl:fakeSpawn,...options});
  t.after(()=>remote.close());
  const start=async(body={})=>{const promise=remote.prompt({text:'检查项目并给出结果',...body});await until(()=>calls.some(m=>m.method==='turn/start'));return{promise};};
  const complete=(text='已完成项目检查',status='completed')=>notify('turn/completed',{threadId:'synthetic-thread',turn:{id:'synthetic-turn',status,items:[{id:'final',type:'agentMessage',phase:'final_answer',text}]}});
  const request=(id,method,params={})=>send({id,method,params:{threadId:'synthetic-thread',turnId:'synthetic-turn',itemId:'synthetic-item',startedAtMs:1000,...params}});
  return{remote,cwd,events,calls,spawns,start,send,reply,notify,complete,request,get child(){return child;}};
}

test('异步显示回调拒绝不成为未捕获拒绝，也不改变任务执行结果',async t=>{
  const r=rig(t,{async onEvent(){throw Error('synthetic async view failure');}});
  const {promise}=await r.start();r.complete();
  assert.equal((await promise).status,'completed');
  // 等到下一事件循环，确保回调的Promise拒绝已被处理，而非仅在本轮尚未报告。
  await pause();
});

test('ready只握手不创建任务，stdio隔离父执行环境且不开放权限扩张',async t=>{
  const r=rig(t);const ready=await r.remote.ready();
  assert.equal(ready.supported,true);assert.equal(ready.transport,'stdio');
  assert.deepEqual(r.calls.map(m=>m.method),['initialize','initialized']);
  const spawn=r.spawns[0];assert.equal(spawn.options.shell,false);assert.equal(spawn.options.windowsHide,true);
  assert.ok(spawn.args.includes('stdio://'));assert.ok(!spawn.args.some(x=>x.includes('danger-full-access')));
  assert.equal(spawn.options.env.CODEX_THREAD_ID,undefined);assert.equal(spawn.options.env.CODEX_PET_HOST,undefined);
  assert.equal((await r.remote.probe()).supported,true);assert.equal(r.spawns.length,1);
});

test('持久thread逐轮限定权限，只返回最终答复并等待真实完成通知',async t=>{
  const r=rig(t),{promise}=await r.start();
  const thread=r.calls.find(m=>m.method==='thread/start'),turn=r.calls.find(m=>m.method==='turn/start');
  assert.equal(thread.params.ephemeral,false);assert.equal(thread.params.cwd,r.cwd);
  assert.equal(turn.params.sandboxPolicy.type,'workspaceWrite');assert.deepEqual(turn.params.sandboxPolicy.writableRoots,[r.cwd]);
  assert.equal(turn.params.sandboxPolicy.networkAccess,false);assert.equal(turn.params.sandboxPolicy.excludeTmpdirEnvVar,true);
  assert.equal(turn.params.approvalPolicy.granular.sandbox_approval,false);
  r.notify('item/started',{threadId:'synthetic-thread',turnId:'synthetic-turn',item:{id:'progress',type:'agentMessage',phase:'commentary',text:''}});
  r.notify('item/agentMessage/delta',{threadId:'synthetic-thread',turnId:'synthetic-turn',itemId:'progress',delta:'内部进度不充当答复'});
  r.notify('item/completed',{threadId:'synthetic-thread',turnId:'synthetic-turn',item:{id:'progress',type:'agentMessage',phase:'commentary',text:'内部进度不充当答复'}});
  r.notify('item/started',{threadId:'synthetic-thread',turnId:'synthetic-turn',item:{id:'final',type:'agentMessage',phase:'final_answer',text:''}});
  r.notify('item/agentMessage/delta',{threadId:'synthetic-thread',turnId:'synthetic-turn',itemId:'final',delta:'已完成'});
  let done=false;promise.then(()=>{done=true;});await pause();assert.equal(done,false);
  r.complete();assert.deepEqual(await promise,{threadId:'synthetic-thread',text:'已完成项目检查',status:'completed'});
  assert.ok(r.events.some(x=>x.type==='state'&&x.state==='result'));assert.equal(r.events.at(-1).state,'idle');
});

test('重启适配器后按保存threadId恢复，不把历史答复或活动会话当作本轮结果',async t=>{
  const r=rig(t),{promise}=await r.start({threadId:'synthetic-thread'});
  assert.equal(r.calls.some(m=>m.method==='thread/start'),false);
  assert.equal(r.calls.find(m=>m.method==='thread/resume').params.excludeTurns,true);
  r.notify('turn/completed',{threadId:'another-thread',turn:{id:'synthetic-turn',status:'completed',items:[]}});
  r.complete();assert.equal((await promise).status,'completed');
  const busy=rig(t,{dispatch(m,{reply,cwd}){if(m.method==='thread/resume'){reply(m,{thread:{id:'synthetic-thread',cwd,status:{type:'active',activeFlags:[]},turns:[]}});return false;}}});
  await assert.rejects(busy.remote.prompt({text:'不能注入活动会话',threadId:'synthetic-thread'}),e=>e.code==='thread_busy');
  assert.equal(busy.calls.some(m=>m.method==='turn/start'),false);
  const wrong=rig(t,{dispatch(m,{reply,cwd}){if(m.method==='thread/resume'){reply(m,{thread:{id:'different-thread',cwd,status:{type:'idle'}}});return false;}}});
  await assert.rejects(wrong.remote.prompt({text:'恢复不能换成另一会话',threadId:'synthetic-thread'}),e=>e.code==='thread_scope_mismatch');
  assert.equal(wrong.calls.some(m=>m.method==='turn/start'),false);
});

test('thread创建后必须等映射持久化成功才提交turn',async t=>{
  let release;const persisted=new Promise(resolve=>{release=resolve;});
  const r=rig(t,{onThread:async id=>{assert.equal(id,'synthetic-thread');await persisted;}});
  const promise=r.remote.prompt({text:'先保存映射'});await until(()=>r.calls.some(m=>m.method==='thread/start'));
  await pause();assert.equal(r.calls.some(m=>m.method==='turn/start'),false);
  release();await until(()=>r.calls.some(m=>m.method==='turn/start'));r.complete();await promise;
});

test('命令审批携带实际有界内容，未回答挂起，单次同意不可重放',async t=>{
  const r=rig(t),{promise}=await r.start();
  r.request(44,'item/commandExecution/requestApproval',{command:'npm test',cwd:r.cwd,reason:'运行项目检查'});
  await until(()=>r.events.some(x=>x.type==='approval'));
  const approval=r.events.find(x=>x.type==='approval');assert.equal(approval.kind,'command');assert.match(approval.summary,/npm test/);
  r.request(44,'item/commandExecution/requestApproval',{command:'npm test',cwd:r.cwd});await pause();
  assert.equal(r.events.filter(x=>x.type==='approval').length,1);
  assert.equal(r.calls.some(m=>m.id===44&&Object.hasOwn(m,'result')),false);assert.equal(r.events.at(-1).type,'approval');
  await r.remote.approve({approvalId:approval.id,decision:'accept'});
  assert.deepEqual(r.calls.find(m=>m.id===44).result,{decision:'accept'});
  await assert.rejects(r.remote.approve({approvalId:approval.id,decision:'accept'}),e=>e.code==='stale_approval');
  r.complete();await promise;
});

test('文件审批需完整路径且在cwd内，只读不能通过审批升成写权限',async t=>{
  const r=rig(t),{promise}=await r.start();
  const diff='@@ -1 +1 @@\n-before\n+after';
  r.notify('item/started',{threadId:'synthetic-thread',turnId:'synthetic-turn',item:{id:'synthetic-item',type:'fileChange',changes:[{path:join(r.cwd,'note.txt'),kind:{type:'update'},diff}]}});
  r.request(45,'item/fileChange/requestApproval',{reason:'更新项目说明'});await until(()=>r.events.some(x=>x.type==='approval'));
  const approval=r.events.find(x=>x.type==='approval');assert.match(approval.summary,/note\.txt/);
  assert.match(approval.summary,/update/);assert.ok(approval.summary.includes(diff));
  await r.remote.approve({approvalId:approval.id,decision:'decline'});assert.deepEqual(r.calls.find(m=>m.id===45).result,{decision:'decline'});
  r.complete();await promise;
  const readOnly=rig(t,{permission:'read-only'}),running=await readOnly.start();
  readOnly.request(46,'item/fileChange/requestApproval',{grantRoot:readOnly.cwd});await until(()=>readOnly.calls.some(m=>m.id===46));
  assert.deepEqual(readOnly.calls.find(m=>m.id===46).result,{decision:'decline'});assert.equal(readOnly.events.some(x=>x.type==='approval'),false);
  readOnly.complete();await running.promise;
});

test('文件审批缺差异、差异过长或含疑似秘密时只拒绝，不截断为可同意摘要',async t=>{
  const r=rig(t),{promise}=await r.start();
  const variants=[undefined,'x'.repeat(4000),'+TOKEN=syntheticSecretPrivateValue'];
  for(const [index,diff]of variants.entries()){
    const itemId='blocked-diff-'+index;
    r.notify('item/started',{threadId:'synthetic-thread',turnId:'synthetic-turn',item:{id:itemId,type:'fileChange',changes:[{path:join(r.cwd,'note.txt'),kind:{type:'update'},diff}]}});
    r.request(301+index,'item/fileChange/requestApproval',{itemId});
  }
  await until(()=>r.calls.filter(m=>m.id>=301&&m.id<=303).length===3);
  assert.equal(r.events.some(x=>x.type==='approval'),false);
  for(const frame of r.calls.filter(m=>m.id>=301&&m.id<=303))assert.deepEqual(frame.result,{decision:'decline'});
  assert.equal(r.events.filter(x=>x.type==='blocked'&&x.reason==='local_review_required').length,3);
  assert.doesNotMatch(JSON.stringify(r.events),/syntheticSecretPrivateValue/);
  r.complete();await promise;
});

test('扩张权限、越根、凭据和无法完整展示的请求直接拒绝，不泄漏其内容',async t=>{
  const r=rig(t),{promise}=await r.start();
  for(const [n,params]of [
    {command:'npm test',cwd:r.cwd,networkApprovalContext:{host:'example.com',protocol:'https'}},
    {command:'npm test',cwd:r.cwd,additionalPermissions:{network:{enabled:true}}},
    {command:'npm test',cwd:tmpdir()},
    {command:'echo '+'sk-'+'x'.repeat(40),cwd:r.cwd},
    {command:'x'.repeat(2001),cwd:r.cwd},
    {command:'set TOKEN=syntheticSecretPrivateValue',cwd:r.cwd},
    {command:'echo eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJleGFtcGxlIn0.signature',cwd:r.cwd},
    {command:'cat ".env"',cwd:r.cwd},
    {command:'curl https://user:syntheticSecret@example.com',cwd:r.cwd},
  ].entries())r.request(60+n,'item/commandExecution/requestApproval',params);
  r.request(70,'item/permissions/requestApproval',{permissions:{network:{enabled:true}},cwd:r.cwd});
  await until(()=>r.calls.filter(m=>m.id>=60&&Object.hasOwn(m,'result')).length===10);
  for(const reply of r.calls.filter(m=>m.id>=60&&m.id<70))assert.equal(reply.result.decision,'decline');
  assert.deepEqual(r.calls.find(m=>m.id===70).result,{permissions:{},scope:'turn'});
  assert.equal(r.events.some(x=>x.type==='approval'),false);assert.doesNotMatch(JSON.stringify(r.events),/syntheticSecret/);
  r.complete();await promise;
});

test('非secret问题逐项作答，secret请求不向外发布，取消后旧审批永久失效',async t=>{
  const r=rig(t),{promise}=await r.start();
  r.request(80,'item/tool/requestUserInput',{isBlocking:true,questions:[{id:'choice',header:'选择',question:'选择检查范围',options:[{label:'当前项目',description:'只检查当前目录'}]}]});
  await until(()=>r.events.some(x=>x.type==='input'));const input=r.events.find(x=>x.type==='input');
  await r.remote.answer({inputId:input.id,answers:{choice:['当前项目']}});
  assert.deepEqual(r.calls.find(m=>m.id===80).result,{answers:{choice:{answers:['当前项目']}}});
  r.request(81,'item/tool/requestUserInput',{isBlocking:true,questions:[{id:'secret',header:'密钥',question:'输入秘密',isSecret:true}]});
  await until(()=>r.calls.some(m=>m.id===81));assert.deepEqual(r.calls.find(m=>m.id===81).result,{answers:{}});
  assert.equal(r.events.filter(x=>x.type==='input').length,1);
  r.request(82,'item/commandExecution/requestApproval',{command:'npm test',cwd:r.cwd});await until(()=>r.events.some(x=>x.type==='approval'));
  const approval=r.events.find(x=>x.type==='approval');await r.remote.cancel();
  assert.equal((await promise).status,'cancelled');assert.equal(r.calls.find(m=>m.id===82).result.decision,'decline');
  assert.ok(r.calls.some(m=>m.method==='turn/interrupt'));
  await assert.rejects(r.remote.approve({approvalId:approval.id,decision:'accept'}),e=>e.code==='stale_approval');
});

test('请求超时和进程退出清理在途promise，固定错误不包含服务端正文',async t=>{
  const timeout=rig(t,{requestTimeoutMs:20,dispatch(m){if(m.method==='initialize')return false;}});
  await assert.rejects(timeout.remote.ready(),e=>e.code==='request_timeout');assert.equal(timeout.child.killed,true);
  const r=rig(t),{promise}=await r.start();r.child.stderr.write('private diagnostic must not escape');r.child.emit('close',7);
  await assert.rejects(promise,e=>e.code==='process_exited'&&!/private diagnostic/.test(e.message));
  assert.equal(r.events.at(-1).state,'idle');
});

test('同一适配器串行执行，失败及取消都不会误判完成',async t=>{
  const r=rig(t),{promise}=await r.start();
  await assert.rejects(r.remote.prompt({text:'第二个任务'}),e=>e.code==='busy');
  r.complete('', 'failed');assert.equal((await promise).status,'failed');
  assert.ok(r.events.some(x=>x.type==='state'&&x.state==='error'));assert.equal(r.events.some(x=>x.type==='state'&&x.state==='success'),false);
  await r.remote.close();await assert.rejects(r.remote.prompt({text:'关闭后的任务'}),e=>e.code==='closed');
});

test('turn或审批到期时中断无终态也按超时报错，未完成不能写成用户取消',async t=>{
  for(const approval of [false,true]){
    const r=rig(t,{requestTimeoutMs:30,turnTimeoutMs:approval?1000:20,approvalTimeoutMs:20,dispatch(m,{reply}){if(m.method==='turn/interrupt'){reply(m,{});return false;}}});
    const {promise}=await r.start();
    if(approval)r.request(90,'item/commandExecution/requestApproval',{command:'npm test',cwd:r.cwd});
    await assert.rejects(promise,e=>e.code===(approval?'approval_timeout':'turn_timeout'));assert.equal(r.child.killed,true);
  }
});

test('超时后再次cancel与close保留最先的超时错误，不能降格为用户取消',async t=>{
  for(const approval of [false,true]){
    const r=rig(t,{requestTimeoutMs:200,turnTimeoutMs:approval?1000:20,approvalTimeoutMs:20,dispatch(m,{reply}){if(m.method==='turn/interrupt'){reply(m,{});return false;}}});
    const {promise}=await r.start();
    if(approval)r.request(304,'item/commandExecution/requestApproval',{command:'npm test',cwd:r.cwd});
    await new Promise(resolve=>setTimeout(resolve,35));assert.ok(r.calls.some(m=>m.method==='turn/interrupt'));
    await r.remote.cancel();await r.remote.close();
    await assert.rejects(promise,e=>e.code===(approval?'approval_timeout':'turn_timeout'));
  }
});

test('持久化映射挂起时取消仍立即收尾，不在回调晚到后偷偷启动turn',async t=>{
  let release;const hold=new Promise(resolve=>{release=resolve;});
  const r=rig(t,{onThread:()=>hold});const promise=r.remote.prompt({text:'保存映射阶段取消'});
  await until(()=>r.calls.some(m=>m.method==='thread/start'));await pause();await r.remote.cancel();
  const result=await Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('cancel stayed behind onThread')),100))]);
  assert.equal(result.status,'cancelled');release();await pause();assert.equal(r.calls.some(m=>m.method==='turn/start'),false);
});

test('每轮恢复都检查真实活动状态，不使用缓存伪造空闲',async t=>{
  const r=rig(t,{dispatch(m,{reply,cwd}){if(m.method==='thread/resume'){reply(m,{thread:{id:'synthetic-thread',cwd,status:{type:'active',activeFlags:[]}}});return false;}}});
  const {promise}=await r.start();r.complete();await promise;
  await assert.rejects(r.remote.prompt({text:'活动会话不应被注入',threadId:'synthetic-thread'}),e=>e.code==='thread_busy');
  assert.equal(r.calls.filter(m=>m.method==='turn/start').length,1);
});

test('非法协议形状或初始化RPC错误均关闭本实例，不抛进宿主事件循环',async t=>{
  const badInit=rig(t,{dispatch(m,{send}){if(m.method==='initialize'){send({id:m.id,error:{code:-32600,message:'private server detail'}});return false;}}});
  await assert.rejects(badInit.remote.ready(),e=>e.code==='rpc_failed');assert.equal(badInit.child.killed,true);
  const r=rig(t),{promise}=await r.start();
  r.notify('turn/completed',{threadId:'synthetic-thread',turn:{id:'synthetic-turn',status:'completed',items:{invalid:true}}});
  await assert.rejects(promise,e=>e.code==='invalid_protocol');assert.equal(r.child.killed,true);
});

test('新回合响应前的迟到旧审批不能绑定当前turn，先等权威turnId再处理',async t=>{
  let starts=0;
  const r=rig(t,{dispatch(m,{send,cwd}){
    if(m.method==='turn/start'&&++starts===2){
      for(const [id,turnId]of [[222,'synthetic-turn'],[223,'synthetic-turn-2']])send({id,method:'item/commandExecution/requestApproval',params:{threadId:'synthetic-thread',turnId,itemId:'approval-item',startedAtMs:1,command:'npm test',cwd}});
      return false;
    }
  }});
  const first=await r.start();await r.remote.cancel();assert.equal((await first.promise).status,'cancelled');
  r.events.length=0;
  const second=r.remote.prompt({text:'这是新回合',threadId:'synthetic-thread'});
  await until(()=>r.calls.filter(m=>m.method==='turn/start').length===2);await pause();
  assert.equal(r.events.some(x=>x.type==='approval'),false);
  r.reply(r.calls.filter(m=>m.method==='turn/start')[1],{turn:{id:'synthetic-turn-2',status:'inProgress',items:[]}});
  await until(()=>r.events.some(x=>x.type==='approval'));
  assert.deepEqual(r.calls.find(m=>m.id===222).result,{decision:'decline'});
  await r.remote.approve({approvalId:r.events.find(x=>x.type==='approval').id,decision:'accept'});
  assert.deepEqual(r.calls.find(m=>m.id===223).result,{decision:'accept'});
  r.notify('turn/completed',{threadId:'synthetic-thread',turn:{id:'synthetic-turn-2',status:'completed',items:[{id:'new-final',type:'agentMessage',text:'新回合完成',phase:'final_answer'}]}});
  assert.equal((await second).text,'新回合完成');
});
