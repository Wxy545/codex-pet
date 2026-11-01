import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const M=await import('../src/model-policy.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
const catalog={state:'ready',items:[
 {id:'tiny',model:'test-luna',displayName:'Small',isDefault:false,supportedReasoningEfforts:['low','medium'],defaultReasoningEffort:'low',inputModalities:['text']},
 {id:'main',model:'test-sol',displayName:'Main',isDefault:true,supportedReasoningEfforts:['low','high'],defaultReasoningEffort:'high',inputModalities:['text','image']},
 {id:'plain',model:'test-plain',displayName:'Plain',isDefault:false,supportedReasoningEfforts:[],defaultReasoningEffort:null,inputModalities:['text']},
]};
async function setup(t){assert.equal(typeof M.createModelPolicy,'function');const root=await mkdtemp(join(tmpdir(),'pet-model-policy-'));t.after(()=>rm(root,{recursive:true,force:true}));return{root,service:await M.createModelPolicy({dataRoot:root})};}
test('轻量闲聊与文件任务按实际目录分流，结果标请求设置而非已生效',async t=>{
 const {service}=await setup(t);
 const chat=service.resolve({host:'codex',purpose:'chat',catalog});
 assert.equal(chat.model,'test-luna');assert.equal(chat.effort,'low');assert.equal(chat.provenance,'requested');
 const task=service.resolve({host:'codex',purpose:'task',catalog});
 assert.equal(task.model,'test-sol');assert.equal(task.effort,'high');
 assert.deepEqual(service.resolve({host:'workbuddy',purpose:'task'}),{host:'workbuddy',purpose:'task',model:null,effort:null,provenance:'host-default',configurable:false});
});
test('本次覆盖优先且不改变已解析请求；用途默认保存重开仍在',async t=>{
 const {service,root}=await setup(t);await service.save({host:'codex',purpose:'chat',model:'test-sol',effort:'high'});
 const running=service.resolve({host:'codex',purpose:'chat',catalog});
 assert.equal(service.resolve({host:'codex',purpose:'chat',override:{model:'test-luna',effort:'low'},catalog}).model,'test-luna');
 await service.save({host:'codex',purpose:'chat',model:'test-luna',effort:'medium'});
 assert.equal(running.model,'test-sol');assert.equal(running.effort,'high');
 const reopened=await M.createModelPolicy({dataRoot:root});assert.equal(reopened.resolve({host:'codex',purpose:'chat',catalog}).effort,'medium');
});
test('模型失效、目录未知、视觉能力未知和不支持强度不静默换用',async t=>{
 const {service}=await setup(t);
 await service.save({host:'codex',purpose:'chat',model:'removed',effort:'low'});
 assert.throws(()=>service.resolve({host:'codex',purpose:'chat',catalog}),e=>e.code==='model_unavailable');
 assert.throws(()=>service.resolve({host:'codex',purpose:'task',catalog:{state:'unknown'}}),e=>e.code==='catalog_unavailable');
 assert.throws(()=>service.resolve({host:'codex',purpose:'image',override:{model:'test-luna',effort:'low'},catalog}),e=>e.code==='modality_unavailable');
 assert.throws(()=>service.resolve({host:'codex',purpose:'chat',override:{model:'test-luna',effort:'high'},catalog}),e=>e.code==='unsupported_effort');
 const plain=service.resolve({host:'codex',purpose:'chat',override:{model:'test-plain',effort:null},catalog});assert.equal(plain.effort,null);
});
test('本地动作不需要模型目录；非支持宿主不能保存假模型或夹带权限',async t=>{
 const {service}=await setup(t);
 assert.equal(service.resolve({host:'codex',purpose:'local'}).provenance,'local');
 await assert.rejects(service.save({host:'workbuddy',purpose:'chat',model:'test-sol',effort:'high'}),e=>e.code==='model_selection_unavailable');
 await assert.rejects(service.save({host:'codex',purpose:'chat',model:null,effort:null,permission:'workspace-write'}),e=>e.code==='invalid_policy');
 assert.throws(()=>service.resolve({host:'codex',purpose:'image',catalog:{state:'ready',items:catalog.items.map(x=>({...x,inputModalities:undefined}))}}),e=>e.code==='modality_unavailable');
});
