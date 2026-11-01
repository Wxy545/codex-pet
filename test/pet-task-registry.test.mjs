import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const M=await import('../src/pet-task-registry.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
async function setup(t,options={}){assert.equal(typeof M.createPetTaskRegistry,'function');const root=await mkdtemp(join(tmpdir(),'pet-task-register-'));t.after(()=>rm(root,{recursive:true,force:true}));return{root,registry:await M.createPetTaskRegistry({dataRoot:root,...options})};}
test('并行宿主和回合分开，默认只投影事实元数据且未知模型不补默认',async t=>{
 const {registry:r}=await setup(t);
 const a=await r.observe({key:'codex:desktop:a:t1',host:'codex',source:'desktop',state:'working',active:true,title:'检查项目',project:'sample',model:'test-sol',effort:'high',provenance:'host-record',at:100,prompt:'private',command:'secret command',progressPercent:71});
 await r.observe({key:'workbuddy:desktop:b:t2',host:'workbuddy',source:'desktop',state:'waiting',active:true,at:110});
 const rows=r.list().items;assert.equal(rows.length,2);assert.equal(rows.find(x=>x.id===a.id).model,'test-sol');
 const wb=rows.find(x=>x.host==='workbuddy');assert.equal(wb.model,null);assert.equal(wb.effort,null);
 assert.doesNotMatch(JSON.stringify(rows),/private|secret command|progressPercent/);
});
test('迟到活动不能复活终态；旧时间不能覆盖新状态',async t=>{
 const {registry:r}=await setup(t);
 const input={key:'source:task',host:'codex',source:'qq'};
 const row=await r.observe({...input,state:'working',active:true,at:200});
 await r.observe({...input,state:'success',active:false,at:300});
 await r.observe({...input,state:'working',active:true,at:400});
 await r.observe({...input,state:'error',active:false,at:250});
 assert.equal(r.list().items.find(x=>x.id===row.id).state,'success');
});
test('待处理可稍后、已读并重启恢复，关闭时写完不消失',async t=>{
 const {registry:r,root}=await setup(t,{now:()=>1000});
 const row=await r.observe({key:'task:wait',host:'codex',source:'desktop',state:'waiting',active:true,at:1000});
 await r.attend({id:row.id,action:'snooze',until:2000});
 assert.equal(r.list({attention:true}).items.length,0);await r.flush();
 const reopened=await M.createPetTaskRegistry({dataRoot:root,now:()=>2100});
 const pending=reopened.list({attention:true}).items;assert.equal(pending.length,1);assert.equal(pending[0].lastKnown,true);
 await reopened.attend({id:row.id,action:'read'});await reopened.flush();
 const again=await M.createPetTaskRegistry({dataRoot:root,now:()=>2200});assert.equal(again.list({attention:true}).items.length,0);
});
test('只有本进程注册的操作可取消，按opaque id执行且错误不会错取消另一项',async t=>{
 const {registry:r}=await setup(t);let a=0,b=0;
 const first=await r.observe({key:'task:a',host:'codex',source:'pet',state:'working',active:true,at:100},{cancel:()=>{a++;return{ok:true};}});
 await r.observe({key:'task:b',host:'codex',source:'pet',state:'working',active:true,at:100},{cancel:()=>{b++;return{ok:true};}});
 await assert.rejects(r.perform({id:'arbitrary',action:'cancel'}),e=>e.code==='task_unavailable');
 await r.perform({id:first.id,action:'cancel'});assert.equal(a,1);assert.equal(b,0);
 const ext=await r.observe({key:'desktop:c',host:'codex',source:'desktop',state:'working',active:true,at:100});
 await assert.rejects(r.perform({id:ext.id,action:'cancel'}),e=>e.code==='action_unavailable');
});
