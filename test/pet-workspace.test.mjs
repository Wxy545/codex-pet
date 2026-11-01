import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtemp,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
const M=await import('../src/pet-workspace.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
async function setup(t){assert.equal(typeof M.createPetWorkspace,'function');const root=await mkdtemp(join(tmpdir(),'pet-workspace-'));t.after(()=>rm(root,{recursive:true,force:true}));const service=await M.createPetWorkspace({dataRoot:root,host:()=> 'codex',getCharacter:()=>({id:'white-dragon',name:'白龙娘'})});return{root,service};}
test('记忆API只接受后端登记的不透明范围，禁止自由scope和任意路径',async t=>{
 const {service:s}=await setup(t);const view=await s.memoryScopes();assert.equal(view.scopes.length,1);
 await assert.rejects(s.memoryAction({action:'query',scopeId:'fake-scope'}),e=>e.code==='memory_scope_unavailable');
 await assert.rejects(s.memoryAction({action:'query',scopeId:view.scopes[0].scopeId,scope:{actor:'someone'}}),e=>e.code==='invalid_input');
 const found=await s.memoryAction({action:'query',scopeId:view.scopes[0].scopeId,query:'你好'});assert.equal(found.items.length,0);
});
test('查看上次实际使用的记忆与临时预览分开，删除令已用上下文失效',async t=>{
 const{service:s}=await setup(t);const scope=await s.ownerScope();await s.memory.append(scope,{role:'user',text:'我的测试偏好是蓝色',source:{kind:'chat',speaker:'owner'}});
 const id=(await s.memoryScopes()).scopes[0].scopeId;
 const preview=await s.memoryAction({action:'context',scopeId:id,mode:'preview',query:'蓝色'});assert.equal(preview.used,false);
 s.markMemoryUsed(scope,preview,{model:'synthetic-model'});
 assert.equal((await s.memoryAction({action:'context',scopeId:id,mode:'last-used'})).used,true);
 await s.memory.clear(scope);const after=await s.memoryAction({action:'context',scopeId:id,mode:'last-used'});assert.equal(after.used,false);assert.equal(after.context,'');
});
test('桌宠目录任务的取消与结果精确绑定，默认列表不泄露任务原文',async t=>{
 const{service:s}=await setup(t);let cancelled;
 await s.observeManual({id:'task-one',state:'running',cwd:'C:/synthetic/sample',task:'private text',summary:'',progress:[]},{cancel:id=>{cancelled=id;return true;}});
 const list=s.tasks.list();assert.equal(list.items[0].source,'pet');assert.doesNotMatch(JSON.stringify(list),/private text/);
 await s.tasks.perform({id:list.items[0].id,action:'cancel'});assert.equal(cancelled,'task-one');
 await s.observeManual({id:'task-one',state:'completed',cwd:'C:/synthetic/sample',summary:'任务返回摘要',progress:[]});
 assert.equal((await s.tasks.perform({id:list.items[0].id,action:'result'})).summary,'任务返回摘要');
});
test('本人QQ显式共用时按QQ目标宿主与角色选范围，不取当前桌面另一宿主记忆',async t=>{
 const{service:s}=await setup(t);
 const native=await s.ownerScope({host:'workbuddy'},{id:'curly-sheep',name:'卷卷'});
 assert.equal(native.host,'workbuddy');assert.equal(native.character,'curly-sheep');
 const desktop=await s.ownerScope();assert.equal(desktop.host,'codex');assert.equal(desktop.character,'white-dragon');
 assert.notDeepEqual(native,desktop);
});
test('手动整理仅提交选定原文与正确宿主，旧票据不能再次触发模型',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pet-workspace-index-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0,received;
 const s=await M.createPetWorkspace({dataRoot:root,host:()=> 'workbuddy',getCharacter:()=>({id:'curly-sheep'}),summarizeMemory:async batch=>{calls++;received=batch;return batch.records.map(x=>({id:x.id,text:'只索引这一条的摘要',keywords:['选择']}));}});
 const scope=await s.ownerScope();const one=await s.memory.append(scope,{role:'user',text:'选定原文',source:{kind:'chat'}});await s.memory.append(scope,{role:'user',text:'另一条不应提交',source:{kind:'chat'}});
 const {scopeId}=(await s.memoryScopes()).scopes[0],ticket=await s.memory.revision(scope);
 const result=await s.memoryAction({action:'summarize',scopeId,id:one.record.id,ticket});assert.equal(result.updated,1);assert.equal(calls,1);assert.equal(received.scope.host,'workbuddy');assert.deepEqual(received.records.map(x=>x.text),['选定原文']);
 await assert.rejects(s.memoryAction({action:'summarize',scopeId,id:one.record.id,ticket}),{code:'memory_stale'});assert.equal(calls,1);
 const found=await s.memory.get(scope,{id:one.record.id});assert.equal(found.record.text,'选定原文');assert.equal(found.record.summary.text,'只索引这一条的摘要');
});
