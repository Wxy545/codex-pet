import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodexWatcher} from '../src/codex-events.mjs';

const record=(type,payload,time=Date.now())=>JSON.stringify({timestamp:new Date(time).toISOString(),type,payload})+'\n';
const event=(type,fields={},time)=>record('event_msg',{type,...fields},time);
const ids={thread:'synthetic-shared-thread',qq:'synthetic-qq-turn',desktop:'synthetic-desktop-turn'};
const quota=(used,time,extra={})=>event('token_count',{...extra,rate_limits:{primary:{used_percent:used,window_minutes:300}}},time);

async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'codex-qq-turns-')),dir=join(home,'sessions','2026','01','01'),notifications=[],changes=[],seen=[];
 await mkdir(dir,{recursive:true});const file=join(dir,'synthetic.jsonl');await writeFile(file,record('session_meta',{id:ids.thread,source:'user'}));
 const watcher=createCodexWatcher({codexHome:home,pollMs:10,terminalHoldMs:10000,excludeThread:(threadId,turnId)=>{seen.push({threadId,turnId});return threadId===ids.thread&&turnId===ids.qq;},onChange:(state,notice)=>{changes.push(state);if(notice)notifications.push(notice);}});
 t.after(async()=>{await watcher.stop();await rm(home,{recursive:true,force:true});});await watcher.start();
 return{file,watcher,notifications,changes,seen};
}
async function until(predicate){
 const limit=performance.now()+3000;
 while(performance.now()<limit){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,15));}
 assert.fail('synthetic rollout was not consumed');
}
async function append(f,text,used,time){
 await appendFile(f.file,text+quota(used,time));await until(()=>f.watcher.snapshot().usage?.usedPercent===used);
}

for(const [field,turn]of Object.entries({snake:id=>({turn_id:id}),camel:id=>({turnId:id}),nested:id=>({turn:{id}}),root:id=>({root_turn_id:id})})){
 test(`共享桌面会话仅抑制QQ回合，${field}新回合恢复状态与通知`,async t=>{
  const f=await fixture(t),time=Date.now()+10;
  await append(f,event('task_started',turn(ids.qq),time),11,time+1);
  assert.equal(f.watcher.snapshot().activeCount,0);assert.equal(f.watcher.snapshot().state,'idle');
  await append(f,event('request_user_input',{...turn(ids.qq),id:'synthetic-approval'},time+2)+event('task_complete',turn(ids.qq),time+3),12,time+4);
  assert.equal(f.watcher.snapshot().activeCount,0);assert.equal(f.notifications.length,0);
  await append(f,event('task_started',turn(ids.desktop),time+5),13,time+6);
  assert.equal(f.watcher.snapshot().threadId,ids.thread);assert.equal(f.watcher.snapshot().state,'thinking');assert.equal(f.watcher.snapshot().activeCount,1);
  await append(f,record('response_item',{type:'function_call',name:'exec_command',arguments:'SYNTHETIC_PRIVATE_COMMAND'},time+7),14,time+8);
  assert.equal(f.watcher.snapshot().state,'working');assert.equal(f.watcher.snapshot().activeCount,1);
  await append(f,event('task_complete',turn(ids.desktop),time+9),15,time+10);
  assert.equal(f.watcher.snapshot().state,'success');assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].threadId,ids.thread);assert.equal(f.notifications[0].kind,'complete');
  if(field==='camel'||field==='nested'){
   await append(f,event('task_complete',turn(ids.desktop),time+11),16,time+12);
   assert.equal(f.notifications.length,1,'同一回合的不同时间戳完成帧只提醒一次');
  }
  assert.equal(f.seen.some(value=>value.threadId===ids.thread&&value.turnId===ids.qq),true);
  assert.equal(f.seen.some(value=>value.threadId===ids.thread&&value.turnId===ids.desktop),true);
  assert.doesNotMatch(JSON.stringify({changes:f.changes,notices:f.notifications}),/SYNTHETIC_PRIVATE_COMMAND|synthetic-qq-turn|synthetic-desktop-turn/);
 });
}

test('迟到QQ终态不能覆盖已经启动的新桌面回合或补发完成通知',async t=>{
 const f=await fixture(t),time=Date.now()+10;
 await append(f,event('task_started',{turn_id:ids.qq},time)+event('task_complete',{turn_id:ids.qq},time+1)+event('task_started',{turn_id:ids.desktop},time+2),21,time+3);
 assert.equal(f.watcher.snapshot().activeCount,1);
 await append(f,event('task_complete',{turn_id:ids.qq},time+4),22,time+5);
 assert.equal(f.watcher.snapshot().state,'thinking');assert.equal(f.watcher.snapshot().activeCount,1);assert.equal(f.notifications.length,0);
 await append(f,record('response_item',{type:'function_call',name:'exec_command'},time+6),23,time+7);
 assert.equal(f.watcher.snapshot().state,'working');assert.equal(f.watcher.snapshot().activeCount,1);
 await append(f,event('task_complete',{turn_id:ids.desktop},time+8),24,time+9);
 assert.equal(f.watcher.snapshot().activeCount,0);assert.equal(f.notifications.length,1);
});

test('旧QQ额度帧的回合ID不污染新桌面游标，无ID工具与完成仍归当前回合',async t=>{
 const f=await fixture(t),time=Date.now()+10;
 await append(f,event('task_started',{turn_id:ids.qq},time)+event('task_complete',{turn_id:ids.qq},time+1)+record('turn_context',{turn_id:ids.desktop},time+2),31,time+3);
 await append(f,quota(38,time+1,{turn_id:ids.qq}),32,time+4);
 await append(f,record('response_item',{type:'function_call',name:'exec_command'},time+4),33,time+5);
 assert.equal(f.watcher.snapshot().state,'working');assert.equal(f.watcher.snapshot().activeCount,1);assert.equal(f.notifications.length,0);
 await append(f,event('task_complete',{},time+6),34,time+7);
 assert.equal(f.watcher.snapshot().state,'success');assert.equal(f.watcher.snapshot().activeCount,0);assert.equal(f.notifications.length,1);
});
