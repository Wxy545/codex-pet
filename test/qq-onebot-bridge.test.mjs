import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,rename,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQQBridge} from '../src/qq-remote.mjs';
import {createQQService} from '../src/qq-service.mjs';

const seal=async value=>Buffer.from(value).toString('base64');
const unseal=async value=>Buffer.from(value,'base64').toString();
const until=async predicate=>{for(let attempt=0;attempt<200&&!predicate();attempt++)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(predicate(),'synthetic callback must become ready');};
async function directory(t){const root=await realpath(await mkdtemp(join(tmpdir(),'pet-onebot-bridge-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
function fakeTransport(options,packets){
  return{options,stopped:false,start(){},stop(){this.stopped=true;},async send(packet){packets.push(packet);}};
}
function syntheticRemote(prompts){
  let count=0;
  return async(application,options)=>({
    async listModels(){return[{id:'synthetic-model',model:'synthetic-model',isDefault:true,supportedReasoningEfforts:['low','high'],defaultReasoningEffort:'low'}];},
    async prompt(input){const threadId=input.threadId||application+'-thread-'+(++count),turnId=application+'-turn-'+count;prompts.push({application,...input,threadId});await options.onThread(threadId,{created:!input.threadId});await options.onTurn(threadId,turnId);return{threadId,status:'completed',text:application+':'+input.text};},
    async cancel(){},async close(){}
  });
}
async function bridgeFixture(t){
  const root=await directory(t),packets=[],connections=[],prompts=[],createRemote=syntheticRemote(prompts);
  const bridge=await createQQBridge({dataRoot:root,application:'workbuddy',provider:'onebot',modelSelection:false,managedSessionsOnly:true,seal,unseal,
    createTransport:options=>{const connection=fakeTransport(options,packets);connections.push(connection);return connection;},
    createRemote:options=>createRemote('workbuddy',options)});
  t.after(()=>bridge.dispose());await bridge.configure({action:'save',endpoint:'ws://127.0.0.1:17630/',accessToken:'synthetic-onebot-secret',cwd:root,permission:'read-only',enabled:true});await until(()=>connections.length>0);
  async function pair(connection,userId='synthetic-owner'){
    const state=await bridge.configure({action:'pair'});await connection.options.onMessage({userId,id:'pair-'+userId,text:'/配对 '+state.pairing.code});await bridge.idle();
  }
  return{root,bridge,packets,connections,prompts,pair};
}

test('OneBot首次账号落盘失败不显示connected，同实例再次连接必须重试持久化',async t=>{
  const f=await bridgeFixture(t),connection=f.connections[0],file=join(f.root,'qq-remote/settings.json'),saved=file+'.saved';
  await rename(file,saved);await mkdir(file);
  await assert.rejects(connection.options.onStatus({state:'connected',selfId:'12345678'}));
  assert.notEqual(f.bridge.state().connection.state,'connected');assert.equal(JSON.parse(await readFile(saved,'utf8')).selfId,undefined);
  await rm(file,{recursive:true});await rename(saved,file);
  await connection.options.onStatus({state:'connected',selfId:'12345678'});await f.bridge.idle();
  assert.equal(f.connections.length,1,'pin retry must work without replacing the bridge or transport');assert.equal(f.bridge.state().connection.state,'connected');assert.equal(JSON.parse(await readFile(file,'utf8')).selfId,'12345678');
  await f.pair(connection);await connection.options.onMessage({userId:'synthetic-owner',id:'valid-after-retry',text:'你好'});await f.bridge.idle();assert.equal(f.prompts.length,1);
});

test('OneBot已固定账号变更会停止候选连接，其迟到消息不能进入任务桥',async t=>{
  const f=await bridgeFixture(t),connection=f.connections[0];await connection.options.onStatus({state:'connected',selfId:'12345678'});await f.pair(connection);
  await assert.rejects(connection.options.onStatus({state:'connected',selfId:'87654321'}),{code:'onebot_account_changed'});
  assert.equal(connection.stopped,true);assert.equal(f.bridge.state().connection.code,'onebot_account_changed');
  await connection.options.onMessage({userId:'synthetic-owner',id:'after-account-change',text:'你好'});
  await f.bridge.idle().catch(()=>{});assert.equal(f.prompts.length,0,'a stopped mismatched-account candidate must not forward its paired owner');
  assert.equal(JSON.parse(await readFile(join(f.root,'qq-remote/settings.json'),'utf8')).selfId,'12345678');
});

test('OneBot账号尚未持久化时不能通过候选连接完成本人配对',async t=>{
  const f=await bridgeFixture(t),connection=f.connections[0],file=join(f.root,'qq-remote/settings.json'),saved=file+'.saved';
  const pairing=await f.bridge.configure({action:'pair'});await rename(file,saved);await mkdir(file);
  await assert.rejects(connection.options.onStatus({state:'connected',selfId:'12345678'}));
  await connection.options.onMessage({userId:'synthetic-owner',id:'pair-before-pin',text:'/配对 '+pairing.pairing.code});
  assert.equal(f.bridge.state().paired,false,'an unpinned candidate must not mutate the paired owner');assert.notEqual(f.bridge.state().connection.state,'connected');
  await rm(file,{recursive:true});await rename(saved,file);await connection.options.onStatus({state:'connected',selfId:'12345678'});
  await connection.options.onMessage({userId:'synthetic-owner',id:'pair-after-pin',text:'/配对 '+pairing.pairing.code});await f.bridge.idle();assert.equal(f.bridge.state().paired,true);
});

test('三应用的官方与OneBot资料分别保留本人和会话，停用通道的迟到消息不能串入当前应用',async t=>{
  const root=await directory(t),packets=[],prompts=[],connections=new Map(),bridges=new Map(),remote=syntheticRemote(prompts);
  const runtime={state:()=>({state:'ready',canLogin:false}),start(){},prepare(){},async connection(){return{url:'ws://127.0.0.1:17630/',accessToken:'synthetic-onebot-secret'};},async dispose(){}};
  const service=await createQQService({dataRoot:root,projectRoot:root,createRuntimeImpl:async()=>runtime,resolveTargetImpl:async application=>({application}),
    createRemoteImpl:remote,bridgeOptions:{seal,unseal},createBridgeImpl:async options=>{
      const key=options.application+':'+options.provider;
      const bridge=await createQQBridge({...options,createTransport:settings=>{const connection=fakeTransport(settings,packets);const list=connections.get(key)||[];list.push(connection);connections.set(key,list);return connection;}});bridges.set(key,bridge);return bridge;
    }});
  t.after(()=>service.dispose());
  async function activate(application,provider){
    await service.configure({action:'save',application,provider,cwd:root,permission:'read-only',enabled:true,...(provider==='official'?{appId:'123456',appSecret:'synthetic-official-secret'}:{})});
    const key=application+':'+provider,list=connections.get(key),connection=list.at(-1);await connection.options.onStatus({state:'connected',...(provider==='onebot'?{selfId:'12345678'}:{})});return connection;
  }
  async function pair(application,provider,connection){const owner=application+'-'+provider+'-owner',state=await service.configure({action:'pair'});await connection.options.onMessage({userId:owner,id:'pair-'+owner,text:'/配对 '+state.pairing.code});await service.idle();return owner;}
  const first=await activate('codex','official'),firstOwner=await pair('codex','official',first);await first.options.onMessage({userId:firstOwner,id:'codex-first',text:'你好'});await service.idle();const firstThread=prompts.at(-1).threadId;
  const second=await activate('workbuddy','onebot'),secondOwner=await pair('workbuddy','onebot',second);await second.options.onMessage({userId:secondOwner,id:'workbuddy-first',text:'你好'});await service.idle();const secondThread=prompts.at(-1).threadId;
  assert.equal(bridges.get('codex:official').isOwner(firstOwner),true);assert.equal(bridges.get('codex:official').isOwner(secondOwner),false);assert.equal(bridges.get('workbuddy:onebot').ownsThread(firstThread),false);assert.equal(bridges.get('workbuddy:onebot').ownsThread(secondThread),true);
  const before=prompts.length;await first.options.onMessage({userId:firstOwner,id:'inactive-official',text:'你好'});await second.options.onMessage({userId:firstOwner,id:'wrong-provider-owner',text:'你好'});await service.idle();assert.equal(prompts.length,before);
  const third=await activate('harness','official'),thirdOwner=await pair('harness','official',third);await third.options.onMessage({userId:thirdOwner,id:'harness-first',text:'你好'});await service.idle();const thirdThread=prompts.at(-1).threadId;
  assert.notEqual(thirdThread,secondThread);assert.equal(bridges.get('harness:official').isOwner(secondOwner),false);assert.equal(bridges.get('harness:official').ownsThread(secondThread),false);
  const back=await activate('workbuddy','onebot');assert.equal(service.state().paired,true);await back.options.onMessage({userId:secondOwner,id:'workbuddy-continue',text:'你好'});await service.idle();assert.equal(prompts.at(-1).threadId,secondThread);
  assert.deepEqual(prompts.map(item=>item.application),['codex','workbuddy','harness','workbuddy']);assert.doesNotMatch(JSON.stringify(service.state()),/synthetic-onebot-secret|synthetic-official-secret|owner/);
});
