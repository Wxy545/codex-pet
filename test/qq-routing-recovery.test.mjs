import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {createQQBridge} from '../src/qq-remote.mjs';

const available=[
 {id:'synthetic-sol',model:'synthetic-sol',displayName:'Synthetic Sol',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:['low','high']},
 {id:'synthetic-luna',model:'synthetic-luna',displayName:'Synthetic Luna',isDefault:false,defaultReasoningEffort:'low',supportedReasoningEfforts:['low','high']},
];
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'qq-routing-recovery-')),cwd=join(root,'project');await mkdir(cwd);
 let clock=1000,catalogOffline=false,busy=false,sequence=0,catalogCalls=0,releases=0;const sent=[],prompts=[];
 const bridge=await createQQBridge({dataRoot:root,codexPath:join(root,'synthetic-codex.exe'),codexHome:join(root,'synthetic-home'),now:()=>clock,seal:async()=> 'synthetic-sealed',unseal:async()=> 'synthetic-secret',
  activityGate:{acquire(){return busy?null:()=>{releases++;};}},
  createTransport:()=>({async start(){},stop(){},async send(value){sent.push(value.text);}}),
  createRemote:async options=>({
   async listModels(){catalogCalls++;if(catalogOffline)throw Error('synthetic-directory-offline');return structuredClone(available);},
   async prompt(value){prompts.push({...value,permission:options.permission});await options.onThread?.('synthetic-conversation',{created:true});await options.onTurn?.('synthetic-conversation','synthetic-turn');return{status:'completed',text:'Synthetic result'};},
   async cancel(){},async close(){},
  }),
 });
 t.after(async()=>{await bridge.dispose();const rel=relative(tmpdir(),root);assert.ok(rel&&!isAbsolute(rel)&&!rel.startsWith('..'));await rm(root,{recursive:true,force:true});});
 await bridge.configure({action:'save',appId:'123456',appSecret:'synthetic-secret',enabled:true,cwd,permission:'read-only'});
 const state=await bridge.configure({action:'pair'});
 const receive=text=>bridge.receive({userId:'synthetic-owner',id:'synthetic-message-'+(++sequence),text});
 await receive('/配对 '+state.pairing.code);
 return{bridge,sent,prompts,receive,setClock:value=>{clock=value;},setCatalogOffline:value=>{catalogOffline=value;},setBusy:value=>{busy=value;},catalogCalls:()=>catalogCalls,releases:()=>releases};
}

test('待选择期间模型缓存过期且目录失败，恢复目录后仍执行保存原文一次',async t=>{
 const f=await fixture(t);await f.receive('/模型');assert.equal(f.catalogCalls(),1);
 // 首次目录仍有效时保存原文，随后只让目录缓存过期，待选择消息本身未过期。
 f.setClock(300000);await f.receive('这件事情');assert.match(f.sent.at(-1),/按聊天/);assert.equal(f.prompts.length,0);
 f.setClock(301010);f.setCatalogOffline(true);await f.receive('/按任务');assert.match(f.sent.at(-1),/模型目录暂不可用/);assert.equal(f.prompts.length,0);
 f.setCatalogOffline(false);await f.receive('/按任务');await f.bridge.idle();
 assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].text,'这件事情');assert.equal(f.prompts[0].model,'synthetic-sol');assert.equal(f.prompts[0].effort,'high');assert.equal(f.prompts[0].permission,'read-only');
 await f.receive('/按任务');assert.equal(f.prompts.length,1);assert.equal(f.releases(),1);
});

test('选择指令带错误参数不丢弃待选择原文，随后正确选择可正常执行',async t=>{
 const f=await fixture(t);await f.receive('这件事情');assert.match(f.sent.at(-1),/按聊天/);
 await f.receive('/按聊天 extra');assert.equal(f.prompts.length,0);
 await f.receive('/按聊天');await f.bridge.idle();assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].text,'这件事情');assert.equal(f.prompts[0].model,'synthetic-luna');assert.equal(f.prompts[0].effort,'low');
 await f.receive('/按聊天');assert.equal(f.prompts.length,1);assert.equal(f.bridge.state().project.permission,'read-only');
});

test('其它任务占用执行门控时保留原文，释放门控后只提交一次',async t=>{
 const f=await fixture(t);await f.receive('这件事情');f.setBusy(true);
 await f.receive('/按任务');assert.match(f.sent.at(-1),/其它任务/);assert.equal(f.prompts.length,0);assert.equal(f.releases(),0);
 f.setBusy(false);await f.receive('/按任务');await f.bridge.idle();assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].text,'这件事情');assert.equal(f.prompts[0].permission,'read-only');
 await f.receive('/按任务');assert.equal(f.prompts.length,1);assert.equal(f.releases(),1);
});
