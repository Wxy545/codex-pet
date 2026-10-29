import test from 'node:test';
import assert from 'node:assert/strict';

let Bridge = {}, Hook = {};
try { Bridge = await import('../src/workbuddy-events.mjs'); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
try { Hook = await import('../workbuddy/plugin/hook-event.mjs'); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
const fixture = () => {
  assert.equal(typeof Bridge.createWorkBuddyBridge, 'function', 'WorkBuddy事件桥尚未实现');
  let clock = 100000, seq = 0;
  const calls = [], timers = new Map();
  const bridge = Bridge.createWorkBuddyBridge({ locale: 'en', now: () => clock, onChange: (s,e) => calls.push({s,e}),
    timers: { setTimeout(fn) { const id=++seq; timers.set(id,fn); return id; }, clearTimeout(id) {timers.delete(id);} } });
  const event = (type, extra={}) => ({schemaVersion:1,source:'workbuddy',eventId:`event-${++seq}`,event:type,sessionId:'synthetic-session-a',requestId:'synthetic-request-1',at:++clock,subagent:false,...extra});
  return {bridge,calls,timers,event,advance(ms){clock+=ms;for(const [id,fn] of [...timers]){timers.delete(id);fn();}}};
};

test('Hook只投递生命周期元数据，完全丢弃prompt/工具输入输出/路径/错误正文',()=>{
  assert.equal(typeof Hook.normalizeHookInput,'function','Hook输入白名单尚未实现');
  const raw={hook_event_name:'PreToolUse',session_id:'synthetic-session-a',call_id:'call-a',tool_name:'Bash',
    prompt:'PRIVATE PROMPT',tool_input:{command:'PRIVATE COMMAND'},tool_response:'PRIVATE OUTPUT',transcript_path:'PRIVATE PATH',cwd:'PRIVATE DIR',error:'PRIVATE ERROR'};
  const value=Hook.normalizeHookInput(raw,{env:{CODEBUDDY_SESSION_ID:'synthetic-session-a',CODEBUDDY_CONVERSATION_REQUEST_ID:'synthetic-request-1'},at:123,eventId:'event-a'});
  assert.deepEqual(value,{schemaVersion:1,source:'workbuddy',eventId:'event-a',event:'PreToolUse',sessionId:'synthetic-session-a',requestId:'synthetic-request-1',at:123,subagent:false,callId:'call-a',interaction:'tool'});
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE/);
});
test('子代理真实ID与Hook父ID不同，不把子代理事件当主会话完成',()=>{
  assert.equal(typeof Hook.normalizeHookInput,'function');
  const value=Hook.normalizeHookInput({hook_event_name:'FinalStop',session_id:'parent-a',final_stop_reason:'completed'},
    {env:{CODEBUDDY_SESSION_ID:'child-a',CODEBUDDY_CONVERSATION_REQUEST_ID:'request-a'},at:123,eventId:'event-a'});
  assert.equal(value.subagent,true);
  const f=fixture();assert.equal(f.bridge.accept({...value,at:100001}),false);assert.equal(f.bridge.snapshot().activeCount,0);
});
test('只有FinalStop completed才能完成，Stop只是整理结果且不发完成通知',()=>{
  const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));f.bridge.accept(f.event('Stop'));
  assert.equal(f.bridge.snapshot().state,'result');assert.equal(f.bridge.snapshot().activeCount,1);assert.equal(f.calls.filter(x=>x.e).length,0);
  f.bridge.accept(f.event('FinalStop',{reason:'completed'}));assert.equal(f.bridge.snapshot().state,'success');
  const notice=f.calls.at(-1).e;assert.equal(notice.source,'workbuddy');assert.equal(notice.sessionId,'synthetic-session-a');assert.equal(notice.kind,'complete');
  f.advance(11000);assert.equal(f.bridge.snapshot().state,'idle');
});
test('新回合运行后迟到的旧FinalStop/StopFailure不能覆盖或产生通知',()=>{
  const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));f.bridge.accept(f.event('UserPromptSubmit',{requestId:'synthetic-request-2'}));
  for(const type of ['FinalStop','StopFailure'])assert.equal(f.bridge.accept(f.event(type,{reason:'completed'})),false);
  assert.equal(f.bridge.snapshot().state,'thinking');assert.equal(f.bridge.snapshot().activeCount,1);assert.equal(f.calls.filter(x=>x.e).length,0);
});
test('并行会话分别收尾，一条完成不清除另一条工作；通知仍指向完成来源',()=>{
  const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));f.bridge.accept(f.event('UserPromptSubmit',{sessionId:'synthetic-session-b'}));
  f.bridge.accept(f.event('PreToolUse',{sessionId:'synthetic-session-b',callId:'call-b',interaction:'tool'}));
  f.bridge.accept(f.event('FinalStop',{reason:'completed'}));assert.equal(f.bridge.snapshot().state,'working');assert.equal(f.bridge.snapshot().activeCount,1);
  assert.equal(f.calls.at(-1).e.sessionId,'synthetic-session-a');
});
test('并行工具各自退出，工具失败可继续重试；不会误报整项失败',()=>{
  const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));
  for(const callId of ['call-a','call-b'])f.bridge.accept(f.event('PreToolUse',{callId,interaction:'tool'}));
  f.bridge.accept(f.event('PostToolUseFailure',{callId:'call-a'}));assert.equal(f.bridge.snapshot().state,'working');
  f.bridge.accept(f.event('PostToolUse',{callId:'call-b'}));assert.equal(f.bridge.snapshot().state,'thinking');assert.equal(f.calls.filter(x=>x.e).length,0);
});
test('取消/中断归待机且无成功，失败才发固定错误，未知收尾不冒充成功',()=>{
  for(const reason of ['cancelled','interrupted','unknown']){const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));f.bridge.accept(f.event('FinalStop',{reason}));assert.equal(f.bridge.snapshot().state,'idle');assert.equal(f.calls.filter(x=>x.e).length,0);}
  const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));f.bridge.accept(f.event('FinalStop',{reason:'failed'}));assert.equal(f.bridge.snapshot().state,'error');assert.equal(f.calls.at(-1).e.kind,'error');
});
test('权限/提问进入等待，普通工具恢复；拒绝权限不更改审批也不当整项失败',()=>{
  const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));f.bridge.accept(f.event('PermissionRequest'));
  assert.equal(f.bridge.snapshot().state,'waiting');assert.equal(f.calls.at(-1).e.kind,'approval');
  f.bridge.accept(f.event('PermissionDenied'));assert.equal(f.bridge.snapshot().state,'thinking');
  f.bridge.accept(f.event('PreToolUse',{callId:'ask-a',interaction:'question'}));assert.equal(f.bridge.snapshot().state,'waiting');
  f.bridge.accept(f.event('PostToolUse',{callId:'ask-a'}));assert.equal(f.bridge.snapshot().state,'thinking');
});
test('无回合标识的结束、过期事件、重复事件及混入正文均不破坏当前状态',()=>{
  const f=fixture(),start=f.event('UserPromptSubmit');assert.equal(f.bridge.accept(start),true);assert.equal(f.bridge.accept(start),false);
  for(const change of [{requestId:undefined},{at:1},{body:'PRIVATE'}, {sessionId:'../private'}])assert.equal(f.bridge.accept(f.event('FinalStop',{reason:'completed',...change})),false);
  assert.equal(f.bridge.snapshot().state,'thinking');assert.equal(f.calls.filter(x=>x.e).length,0);
});
test('截断恢复的FinalStop不能庆祝，SessionEnd只清对应回合；dispose清资源',()=>{
  const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));f.bridge.accept(f.event('FinalStop',{reason:'completed',recovering:true}));
  assert.notEqual(f.bridge.snapshot().state,'success');assert.equal(f.calls.filter(x=>x.e).length,0);
  f.bridge.accept(f.event('SessionEnd'));assert.equal(f.bridge.snapshot().activeCount,0);f.bridge.dispose();
  assert.equal(f.timers.size,0);assert.equal(f.bridge.accept(f.event('UserPromptSubmit')),false);
});
test('并行提问仍在等待时另一工具开始或结束都不能抢走waiting',()=>{
 const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));f.bridge.accept(f.event('PreToolUse',{callId:'ask-a',interaction:'question'}));
 f.bridge.accept(f.event('PreToolUse',{callId:'tool-b',interaction:'tool'}));assert.equal(f.bridge.snapshot().state,'waiting');
 f.bridge.accept(f.event('PostToolUse',{callId:'tool-b'}));assert.equal(f.bridge.snapshot().state,'waiting');
});
test('确认宿主全部退出时清场不发假结果，下一次启动仍可接收；长任务不会被短TTL清除',()=>{
 const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));f.advance(3600000);assert.equal(f.bridge.snapshot().state,'thinking');
 assert.equal(typeof f.bridge.hostClosed,'function');const notices=f.calls.filter(x=>x.e).length;f.bridge.hostClosed();
 assert.equal(f.bridge.snapshot().state,'idle');assert.equal(f.bridge.snapshot().activeCount,0);assert.equal(f.calls.filter(x=>x.e).length,notices);
 f.bridge.accept(f.event('UserPromptSubmit',{requestId:'next-request'}));assert.equal(f.bridge.snapshot().state,'thinking');
});
test('宿主确认退出前排队的开始事件迟到时不能重开工作状态',()=>{
 const f=fixture(),old=f.event('UserPromptSubmit');f.advance(1000);f.bridge.hostClosed();assert.equal(f.bridge.accept(old),false);assert.equal(f.bridge.snapshot().activeCount,0);
});
test('SessionEnd缺少requestID时按明确会话关闭，旧时间戳仍不能清新回合或其它会话',()=>{
 const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));const oldClose=f.event('SessionEnd',{requestId:undefined});
 f.bridge.accept(f.event('UserPromptSubmit',{requestId:'next-request'}));assert.equal(f.bridge.accept(oldClose),false);
 f.bridge.accept(f.event('UserPromptSubmit',{sessionId:'synthetic-session-b'}));
 assert.equal(f.bridge.accept(f.event('SessionEnd',{requestId:undefined})),true);assert.equal(f.bridge.snapshot().activeCount,1);
});
test('提问工具首次进入等待发确认通知，另一个权限拒绝不覆盖尚未回答的问题',()=>{
 const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));f.bridge.accept(f.event('PreToolUse',{callId:'ask-a',interaction:'question'}));
 assert.equal(f.calls.at(-1).e?.kind,'approval');f.bridge.accept(f.event('PermissionDenied',{callId:'other-call'}));assert.equal(f.bridge.snapshot().state,'waiting');
});
test('未解决审批按callId保留waiting，只有同call批准重新执行才清理',()=>{
 const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));
 f.bridge.accept(f.event('PreToolUse',{callId:'permission-a',interaction:'tool'}));f.bridge.accept(f.event('PermissionRequest',{callId:'permission-a'}));
 f.bridge.accept(f.event('PreToolUse',{callId:'parallel-b',interaction:'tool'}));assert.equal(f.bridge.snapshot().state,'waiting');
 f.bridge.accept(f.event('PostToolUse',{callId:'parallel-b'}));assert.equal(f.bridge.snapshot().state,'waiting');
 f.bridge.accept(f.event('PreToolUse',{callId:'permission-a',interaction:'tool'}));assert.equal(f.bridge.snapshot().state,'working');
 f.bridge.accept(f.event('PostToolUse',{callId:'permission-a'}));assert.equal(f.bridge.snapshot().state,'thinking');
});
test('拒绝和工具结果只清对应审批，不丢另一call的等待',()=>{
 const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));
 for(const callId of ['approval-a','approval-b']){f.bridge.accept(f.event('PreToolUse',{callId,interaction:'tool'}));f.bridge.accept(f.event('PermissionRequest',{callId}));}
 f.bridge.accept(f.event('PermissionDenied',{callId:'approval-a'}));assert.equal(f.bridge.snapshot().state,'waiting');
 f.bridge.accept(f.event('PostToolUseFailure',{callId:'approval-b'}));assert.equal(f.bridge.snapshot().state,'thinking');
});
test('多个elicitation分别等待对应结果，取消终态清空，不把旧结果套进下一回合',()=>{
 const f=fixture();f.bridge.accept(f.event('UserPromptSubmit'));
 for(const callId of ['elicitation-a','elicitation-b'])f.bridge.accept(f.event('Elicitation',{callId}));
 f.bridge.accept(f.event('ElicitationResult',{callId:'elicitation-a'}));assert.equal(f.bridge.snapshot().state,'waiting');
 f.bridge.accept(f.event('ElicitationResult',{callId:'elicitation-b'}));assert.equal(f.bridge.snapshot().state,'thinking');
 f.bridge.accept(f.event('Elicitation',{callId:'pending-c'}));f.bridge.accept(f.event('FinalStop',{reason:'cancelled'}));assert.equal(f.bridge.snapshot().state,'idle');
 f.bridge.accept(f.event('UserPromptSubmit',{requestId:'next-request'}));assert.equal(f.bridge.accept(f.event('ElicitationResult',{callId:'pending-c'})),false);assert.equal(f.bridge.snapshot().state,'thinking');
});
test('实际elicitation_id映射到现有callId，不传URL或用户填写内容',()=>{
 const env={CODEBUDDY_SESSION_ID:'synthetic-session',CODEBUDDY_CONVERSATION_REQUEST_ID:'synthetic-request'};
 for(const hook_event_name of ['Elicitation','ElicitationResult']){
 const event=Hook.normalizeHookInput({hook_event_name,session_id:'synthetic-session',elicitation_id:'elicitation-a',url:'PRIVATE URL',response:{content:'PRIVATE ANSWER'}},{env,at:123,eventId:'event-a'});
 assert.equal(event.callId,'elicitation-a');assert.doesNotMatch(JSON.stringify(event),/PRIVATE/);
 }
});
