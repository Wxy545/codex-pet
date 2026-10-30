import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodexActivityGate} from '../src/codex-tasks.mjs';
let createQQBridge;
let projectQQState;
try { ({createQQBridge,projectQQState}=await import('../src/qq-remote.mjs')); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND')throw e; }

async function fixture(t,{delayRemote=false,replyText,approvalCount=1,activityGate,onPrompt,canStart}={}) {
  assert.equal(typeof createQQBridge,'function','QQ task bridge is missing');
  const root=await mkdtemp(join(tmpdir(),'pet-qq-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const sent=[],prompts=[],states=[],approvals=[];let options,failSend=false,approval,resolveTurn,releaseRemote;
  const factoryOptions={dataRoot:root,codexPath:'synthetic-codex',locale:'zh-CN',activityGate,canStart,
    seal:async s=>Buffer.from(s).toString('base64'),unseal:async s=>Buffer.from(s,'base64').toString(),
    onState:s=>states.push(s),
    createTransport:o=>{options=o;return{start(){o.onStatus({state:'connected'});},stop(){},async send(body){if(failSend)throw Object.assign(Error('offline'),{code:'offline'});sent.push(body.text);}};},
    createRemote:async o=>{if(delayRemote)await new Promise(r=>{releaseRemote=r;});return{async prompt(p){prompts.push(p);await o.onThread('synthetic-thread');if(onPrompt)return onPrompt(p,o,root);if(p.text==='wait'){for(let index=0;index<approvalCount;index++)o.onEvent({type:'approval',id:approvalCount===1?'synthetic-approval':'synthetic-approval-'+index,kind:'command',summary:'Read README.md '+index});return new Promise(r=>{resolveTurn=r;});}return{threadId:'synthetic-thread',text:replyText??'reply:'+p.text,status:'completed'};},async approve(p){approval=p;approvals.push({...p});},async cancel(){resolveTurn?.({threadId:'synthetic-thread',text:'',status:'interrupted'});},async close(){},answer(){}};}};
  const bridge=await createQQBridge(factoryOptions);
  await bridge.configure({action:'save',appId:'123456',appSecret:'synthetic-secret',cwd:root,permission:'read-only',enabled:true});
  await new Promise(r=>setTimeout(r,0));
  const receive=(text,id,userId='owner')=>bridge.receive({text,id,userId});
  const pair=async()=>{const p=await bridge.configure({action:'pair'});await receive('/配对 '+p.pairing.code,'pair-message');};
  return{bridge,root,sent,prompts,states,approvals,receive,pair,factoryOptions,get approval(){return approval;},set fail(v){failSend=v;},releaseRemote(){releaseRemote?.();},finish(){resolveTurn?.({threadId:'synthetic-thread',text:'done',status:'completed'});}};
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

test('follow-up messages resume the saved Codex thread and a new conversation clears only its own binding',async t=>{
  const f=await fixture(t);t.after(()=>f.bridge.dispose());await f.pair();
  await f.receive('first','one');await f.bridge.idle();await f.receive('continue','two');await f.bridge.idle();
  assert.equal(f.prompts[1].threadId,'synthetic-thread');assert.equal(f.bridge.ownsThread('synthetic-thread'),true);
  await f.receive('/新会话','new');assert.equal(f.bridge.ownsThread('synthetic-thread'),true,'old QQ terminal events must remain excluded after starting a new conversation');await f.receive('fresh','three');await f.bridge.idle();assert.equal(f.prompts[2].threadId,undefined);
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
  const root=await mkdtemp(join(tmpdir(),'pet-qq-connect-'));t.after(()=>rm(root,{recursive:true,force:true}));
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
