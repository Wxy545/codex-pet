import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCodexWatcher} from '../src/codex-events.mjs';

test('任务目录按会话保留模型与强度，工具阶段不投影命令和推理正文',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pet-task-metadata-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const folder=join(root,'sessions','2026','11','02');await mkdir(folder,{recursive:true});
 const now=Date.now(),records=[
  {type:'session_meta',payload:{id:'synthetic-meta-a',cwd:'C:/synthetic/project-one',source:'vscode'}},
  {type:'turn_context',payload:{turn_id:'turn-a',model:'test-sol',effort:'high'}},
  {type:'event_msg',payload:{type:'task_started',turn_id:'turn-a'}},
  {type:'event_msg',payload:{type:'item_started',turn_id:'turn-a',item:{type:'CommandExecution',command:'private command',reasoning:'private reasoning'}}},
 ];
 await writeFile(join(folder,'rollout-a.jsonl'),records.map((x,i)=>JSON.stringify({timestamp:new Date(now+i).toISOString(),...x})).join('\n')+'\n');
 const watcher=createCodexWatcher({codexHome:root,pollMs:100000});t.after(()=>watcher.stop());await watcher.start();
 assert.equal(typeof watcher.tasks,'function');const rows=watcher.tasks();assert.equal(rows.length,1);
 assert.equal(rows[0].model,'test-sol');assert.equal(rows[0].effort,'high');assert.equal(rows[0].phase,'command');assert.equal(rows[0].project,'project-one');
 assert.doesNotMatch(JSON.stringify(rows),/private command|private reasoning/);
});
test('一次日志增量中快速结束并开始下一轮时，每轮终态都能进入任务目录',async t=>{
 const root=await mkdtemp(join(tmpdir(),'pet-fast-metadata-'));t.after(()=>rm(root,{recursive:true,force:true}));const folder=join(root,'sessions','2026','11','02');await mkdir(folder,{recursive:true});const file=join(folder,'rollout-synthetic.jsonl');
 await writeFile(file,JSON.stringify({type:'session_meta',payload:{id:'synthetic-fast-thread',source:'vscode',cwd:'C:/synthetic/demo'}})+'\n');const rows=[];
 const watcher=createCodexWatcher({codexHome:root,pollMs:20,onTask:row=>rows.push(row)});t.after(()=>watcher.stop());await watcher.start();const stamp=Date.now();
 await appendFile(file,[{type:'turn_context',payload:{turn_id:'fast-one',model:'test-one',effort:'low'}},{type:'event_msg',payload:{type:'task_started',turn_id:'fast-one'}},{type:'event_msg',payload:{type:'task_complete',turn_id:'fast-one'}},{type:'turn_context',payload:{turn_id:'fast-two',model:'test-two',effort:'high'}},{type:'event_msg',payload:{type:'task_started',turn_id:'fast-two'}},{type:'event_msg',payload:{type:'task_complete',turn_id:'fast-two'}}].map((row,i)=>JSON.stringify({...row,timestamp:new Date(stamp+i).toISOString()})).join('\n')+'\n');
 const deadline=Date.now()+2000;while(!rows.some(r=>r.turnId==='fast-two'&&r.state==='success')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
 assert.ok(rows.some(r=>r.turnId==='fast-one'&&r.state==='success'));assert.ok(rows.some(r=>r.turnId==='fast-two'&&r.state==='success'));assert.equal(rows.find(r=>r.turnId==='fast-two').model,'test-two');
});
