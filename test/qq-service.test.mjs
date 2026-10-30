import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQQService} from '../src/qq-service.mjs';

async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'pet-qq-service-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const sent=[],calls=[],states=[];let count=0,failTarget=null,hold;
 const native={state:()=>({state:'ready',endpoint:'ws://127.0.0.1:17630/',canLogin:false}),prepare(){calls.push('prepare');},start(){calls.push('start-runtime');},async connection(){return{url:'ws://127.0.0.1:17630/',accessToken:'synthetic-onebot-secret'};},async getLoginUrl(){return'http://127.0.0.1:17631/webui?token=synthetic-local-login-token';},async dispose(){calls.push('dispose-runtime');}};
 const options={dataRoot:root,projectRoot:root,codexPath:'synthetic-codex',locale:'zh-CN',onState:s=>states.push(s),createRuntimeImpl:async()=>native,
  resolveTargetImpl:async(application,input)=>{calls.push({resolve:application,...input});if(failTarget===application)throw Object.assign(Error('host_not_installed'),{code:'host_not_installed'});return{application};},
  bridgeOptions:{seal:async s=>Buffer.from(s).toString('base64'),unseal:async s=>Buffer.from(s,'base64').toString(),createTransport:o=>({async start(){await o.onStatus({state:'connected',selfId:'12345678'});},stop(){},async send(packet){sent.push(packet.text);}})},
  createRemoteImpl:async(application,o)=>({async listModels(){return[{id:'sol',model:'gpt-6.1-sol',displayName:'Sol',isDefault:true,supportedReasoningEfforts:['low','high'],defaultReasoningEffort:'low'}];},async createThread({title}={}){const id=application+'-new-'+(++count);await o.onThread?.(id,{created:true,title});return{id,title,cwd:o.cwd,status:'idle',updatedAt:Date.now()};},async readThread({threadId}){const saved=o.managedThreads.find(s=>s.id===threadId);return saved?{...saved,status:'idle'}:null;},async listThreads(){return{items:[],nextCursor:null};},async prompt(p){calls.push({application,prompt:p,permission:o.permission});const id=p.threadId||application+'-thread-'+(++count);await o.onThread(id,{created:!p.threadId});await o.onTurn(id,application+'-turn-'+count);if(p.text==='hold')return new Promise(r=>{hold=()=>r({status:'completed',text:'done'});});return{status:'completed',threadId:id,text:application+':'+p.text};},async close(){},async cancel(){hold?.();},async approve(){}})};
 const service=await createQQService(options);t.after(()=>service.dispose());
 const save=(application='codex',provider='official')=>service.configure({action:'save',application,provider,cwd:root,permission:'read-only',enabled:true,...(provider==='official'?{appId:'123456',appSecret:'synthetic-official-secret'}:{})});
 async function pair(id){const s=await service.configure({action:'pair'});await service.receive({userId:'owner',id:'pair-'+id,text:'/配对 '+s.pairing.code});}
 const message=(text,id)=>service.receive({userId:'owner',id,text});
 return{service,root,sent,calls,states,save,pair,message,options,setFail(value){failTarget=value;},async waitHeld(){for(let i=0;i<200&&!hold;i++)await new Promise(r=>setTimeout(r,5));assert.ok(hold,'native prompt must be running');},finish(){hold?.();}};
}

test('旧Codex官方连接保留，六种配置独立保存配对、会话、权限与结果',async t=>{
 const f=await fixture(t);await f.save();await f.pair('codex-official');await f.message('你好','c1');await f.service.idle();const first=f.calls.find(c=>c.prompt);assert.equal(first.application,'codex');assert.equal(first.prompt.effort,'low');
 await f.save('workbuddy','onebot');assert.equal(f.service.state().paired,false);await f.pair('wb-onebot');await f.message('你好','w1');await f.service.idle();const wb=f.calls.filter(c=>c.prompt).at(-1);assert.equal(wb.application,'workbuddy');assert.equal(wb.prompt.model,undefined);assert.equal(wb.prompt.threadId,undefined);assert.equal(wb.permission,'read-only');
 await f.save('harness','official');assert.equal(f.service.state().paired,false);await f.pair('harness-official');await f.message('你好','h1');await f.service.idle();assert.equal(f.calls.filter(c=>c.prompt).at(-1).application,'harness');
 await f.save('codex','official');assert.equal(f.service.state().paired,true);await f.message('你好','c2');await f.service.idle();assert.equal(f.calls.filter(c=>c.prompt).at(-1).prompt.threadId,first.prompt.threadId||'codex-thread-1');
 const state=f.service.state();assert.equal(state.profiles.length,6);assert.equal(state.application,'codex');assert.equal(state.provider,'official');assert.doesNotMatch(JSON.stringify(state),/synthetic-onebot-secret|synthetic-official-secret|synthetic-local-login-token|owner/);
 assert.equal(JSON.parse(await readFile(join(f.root,'qq-service.json'),'utf8')).application,'codex');
});

test('运行中拒绝切应用和通道，未安装目标失败不打断原连接或配对',async t=>{
 const f=await fixture(t);await f.save();await f.pair('owner');await f.message('hold','running');await f.waitHeld();
 await assert.rejects(f.save('workbuddy','onebot'),{code:'busy'});assert.equal(f.service.state().application,'codex');assert.equal(f.service.state().paired,true);f.finish();await f.service.idle();
 f.setFail('workbuddy');await assert.rejects(f.save('workbuddy','onebot'),{code:'host_not_installed'});assert.equal(f.service.state().application,'codex');assert.equal(f.service.state().paired,true);
});

test('NapCat准备与登录不切换活动配置，登录链接不属于公开状态',async t=>{
 const f=await fixture(t);await f.save();await f.pair('owner');await f.service.configure({action:'napcat-prepare'});assert.equal(f.service.state().provider,'official');assert.equal(f.service.state().paired,true);
 const login=await f.service.configure({action:'napcat-login'});assert.match(login.localLoginUrl,/^http:\/\/127\.0\.0\.1:17631\/webui\?token=/);assert.equal(f.service.state().localLoginUrl,undefined);assert.equal(f.service.state().provider,'official');
 await assert.rejects(f.service.configure({action:'napcat-prepare',url:'http://bad.invalid'}),{code:'invalid_input'});
});

test('活动配置文件无法提交时目标资料完整回滚，旧机器人配对与连接保留',async t=>{
 const f=await fixture(t);await f.save();await f.pair('old-owner');
 const before=f.service.state().profiles.find(p=>p.application==='workbuddy'&&p.provider==='onebot');
 await mkdir(join(f.root,'qq-service.json'));
 await assert.rejects(f.save('workbuddy','onebot'));
 const after=f.service.state();assert.equal(after.application,'codex');assert.equal(after.paired,true);
 assert.deepEqual(after.profiles.find(p=>p.application==='workbuddy'&&p.provider==='onebot'),before);
 await f.message('你好','after-failure');await f.service.idle();assert.equal(f.calls.filter(c=>c.prompt).at(-1).application,'codex');
});

test('原生应用变更权限后不复用旧权限会话，模型命令不借Codex目录',async t=>{
 const f=await fixture(t);await f.service.configure({action:'save',application:'workbuddy',provider:'official',cwd:f.root,permission:'workspace-write',enabled:true,appId:'123456',appSecret:'synthetic-official-secret'});await f.pair('wb');await f.message('/模式 任务','mode');await f.message('你好','write');await f.service.idle();
 await f.message('/权限 只读','lower');await f.message('你好','read');await f.service.idle();const prompts=f.calls.filter(c=>c.prompt);assert.equal(prompts.length,2);assert.equal(prompts[1].prompt.threadId,undefined);assert.equal(prompts[1].permission,'read-only');
 await f.message('/模型','models');assert.match(f.sent.at(-1),/WorkBuddy 自己的设置/);assert.equal(f.calls.filter(c=>c.prompt).length,2);
});
