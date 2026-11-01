import test from 'node:test';import assert from 'node:assert/strict';
import {createWorkspaceEventSink} from '../src/workspace-events.mjs';
import {createPetTaskRegistry} from '../src/pet-task-registry.mjs';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
test('同会话逐轮登记，未变元数据不落盘；打开绑定原来源，未观测模型保持未知',async()=>{
 const rows=[],sink=createWorkspaceEventSink({workspace:{tasks:{observe:async(a,b)=>rows.push([a,b])}},host:'codex'});
 const first={threadId:'synthetic-thread',turnId:'turn-one',state:'working',active:true,at:100,project:'demo',phase:'files'};
 await sink.sync([first]);await sink.sync([first]);assert.equal(rows.length,1);assert.equal(rows[0][0].model,null);
 assert.deepEqual(await rows[0][1].open(),{open:{host:'codex',threadId:'synthetic-thread'}});
 await sink.sync([{...first,turnId:'turn-two',at:200,model:'observed',effort:'high',provenance:'host-record'}]);assert.equal(rows.length,2);assert.notEqual(rows[0][0].key,rows[1][0].key);
});
test('LINE与WhatsApp任务保留本回合定向取消和结果，互不挪用来源回调',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'workspace-chat-controls-'));t.after(()=>rm(folder,{recursive:true,force:true}));const tasks=await createPetTaskRegistry({dataRoot:folder,now:()=>200}),calls=[],sink=createWorkspaceEventSink({workspace:{tasks},host:'codex'});
 for(const[source,application]of [['line','workbuddy'],['whatsapp','harness']])await sink.messaging({channel:source+'-bot',application,jobId:'synthetic-'+source,state:'working',active:true,at:100,startedAt:90,controls:{cancel:async()=>{calls.push(source+':cancel');return{cancelled:true,source};},result:async()=>({text:source+' synthetic result'})}});
 const rows=tasks.list().items;assert.equal(rows.length,2);
 for(const source of ['line','whatsapp']){const row=rows.find(value=>value.source===source);assert.deepEqual(row.actions.sort(),['cancel','result']);assert.equal((await tasks.perform({id:row.id,action:'cancel'})).source,source);assert.equal((await tasks.perform({id:row.id,action:'result'})).text,source+' synthetic result');}
 assert.deepEqual(calls,['line:cancel','whatsapp:cancel']);
});
test('QQ只接受当前回合事实，不把空闲或旧最近模型套给下一条任务',async()=>{
 const rows=[],sink=createWorkspaceEventSink({workspace:{tasks:{observe:async a=>rows.push(a)}},host:'codex'});
 await sink.qq({state:'idle',application:'workbuddy'});assert.equal(rows.length,0);
 await sink.qq({state:'thinking',activeCount:1,application:'workbuddy',jobId:'job-one',at:100,startedAt:100,project:'demo'});
 assert.equal(rows[0].host,'workbuddy');assert.equal(rows[0].model,null);assert.equal(rows[0].source,'qq');
});
