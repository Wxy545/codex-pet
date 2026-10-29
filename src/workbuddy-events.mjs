import {validateHookEvent} from '../workbuddy/plugin/hook-event.mjs';

const priority={waiting:4,working:3,result:2,thinking:1};
const COPY={
  en:{idle:'Waiting for WorkBuddy',thinking:'WorkBuddy is thinking',working:'WorkBuddy is working',result:'WorkBuddy is wrapping up',waiting:'WorkBuddy is waiting for you',success:'WorkBuddy finished',error:'WorkBuddy ran into an error',
    complete:['WorkBuddy task finished','Open WorkBuddy to review the result.'],failure:['WorkBuddy task failed','Open WorkBuddy to review the error.'],approval:['WorkBuddy needs you','Open WorkBuddy to respond.']},
  'zh-CN':{idle:'等待 WorkBuddy 任务',thinking:'WorkBuddy 正在思考',working:'WorkBuddy 正在工作',result:'WorkBuddy 正在整理结果',waiting:'WorkBuddy 等待您的确认',success:'WorkBuddy 本次任务已完成',error:'WorkBuddy 任务出现错误',
    complete:['WorkBuddy 任务完成','打开 WorkBuddy 查看结果。'],failure:['WorkBuddy 任务出现错误','打开 WorkBuddy 查看错误。'],approval:['WorkBuddy 等待确认','打开 WorkBuddy 确认或补充信息。']},
};

/** Hook事件只在内存归约；不同会话、不同requestId的结束事件不能互相清除。 */
export function createWorkBuddyBridge({onChange=()=>{},locale='zh-CN',now=Date.now,timers=globalThis,terminalHoldMs=10000}={}) {
  if (typeof onChange!=='function' || typeof now!=='function' || !Number.isFinite(terminalHoldMs) || terminalHoldMs<0) throw new TypeError('invalid-workbuddy-bridge');
  const sessions=new Map(),seen=new Set(),copy=COPY[locale]??COPY.en;
  let disposed=false,timer=null,published='',closedAt=0;
  function snapshot() {
    const values=[...sessions.values()],active=values.filter(s=>s.active);
    const selected=(active.length?active.sort((a,b)=>(priority[b.state]??0)-(priority[a.state]??0)||b.at-a.at):values.sort((a,b)=>b.at-a.at))[0];
    const state=selected && (selected.active || now()-selected.observedAt<terminalHoldMs) ? selected.state : 'idle';
    return {state,task:copy[state],activeCount:active.length,source:'workbuddy'};
  }
  function publish(event) {
    if(disposed)return;
    const view=snapshot(),key=JSON.stringify(view);
    if(event||key!==published){published=key;try{onChange(view,event);}catch{/* 展示回调失败不改变已确认的事件状态。 */}}
    if(timer!==null)timers.clearTimeout(timer);timer=null;
    const deadlines=[...sessions.values()].filter(s=>!s.active&&s.state!=='idle').map(s=>s.observedAt+terminalHoldMs-now()).filter(x=>x>0);
    if(deadlines.length){timer=timers.setTimeout(()=>{timer=null;publish();},Math.min(...deadlines)+1);timer?.unref?.();}
  }
  function accept(input) {
    if(disposed||!validateHookEvent(input)||input.subagent||['SubagentStart','SubagentStop'].includes(input.event)
      ||input.at<=closedAt||Math.abs(now()-input.at)>300000||seen.has(input.eventId))return false;
    const e=input,old=sessions.get(e.sessionId),start=e.event==='UserPromptSubmit',sessionEnd=e.event==='SessionEnd'&&!e.requestId;
    if(e.event==='SessionStart')return false;
    // SessionEnd明确关闭整条会话，客户端可能已清掉requestId；仍受会话来源和事件时间顺序保护。
    if(!e.requestId&&!sessionEnd)return false;
    if(!old&&!start)return false;
    if(old&&(e.at<old.at||(!start&&!sessionEnd&&e.requestId!==old.requestId)))return false;
    if(start&&e.internal && (!old || e.requestId!==old.requestId))return false;
    if(start&&old&&e.requestId!==old.requestId&&old.requests.includes(e.requestId))return false;
    if(!old&&sessions.size>=128){const candidate=[...sessions.entries()].find(([,s])=>!s.active);if(candidate)sessions.delete(candidate[0]);else return false;}
    const s=start&&e.requestId!==old?.requestId?{requestId:e.requestId,requests:[...(old?.requests??[]),e.requestId].slice(-32),tools:new Map(),pending:new Set(),notified:new Set(),state:'thinking',active:true}:old;
    if(!s)return false;
    // 收尾后的工具回调可能迟到；同一回合不能因此重新变成工作中。
    if(!start&&!s.active)return false;
    if(start&&s===old&&!s.active)return false;
    seen.add(e.eventId);if(seen.size>1024)seen.delete(seen.values().next().value);
    let notice;
    const notify=kind=>{if(s.notified.has(kind))return;s.notified.add(kind);const pair=copy[kind==='error'?'failure':kind];notice={kind,title:pair[0],body:pair[1],source:'workbuddy',sessionId:e.sessionId};};
    const waitKey=kind=>kind+':'+(e.callId??'@unknown');
    const waiting=()=>s.pending.size>0||[...s.tools.values()].some(Boolean);
    const refresh=()=>{s.state=waiting()?'waiting':s.tools.size?'working':'thinking';};
    if(start)refresh();
    else if(e.event==='PreToolUse'){
      // 审批通过后同call会继续执行；其它并行call不能清掉仍未决定的审批。
      s.pending.delete(waitKey('permission'));s.pending.delete('notification');
      if(e.callId)s.tools.set(e.callId,e.interaction==='question');
      s.state=e.interaction==='question'||waiting()?'waiting':'working';if(e.interaction==='question')notify('approval');
    }
    else if(['PostToolUse','PostToolUseFailure'].includes(e.event)){
      if(e.callId)s.tools.delete(e.callId);s.pending.delete(waitKey('permission'));s.pending.delete('notification');refresh();
    }
    else if(e.event==='PermissionRequest'||e.event==='Elicitation'){
      s.pending.add(waitKey(e.event==='PermissionRequest'?'permission':'elicitation'));s.state='waiting';notify('approval');
    }
    else if(e.event==='Notification'&&e.interaction==='waiting'){s.pending.add('notification');s.state='waiting';notify('approval');}
    else if(e.event==='PermissionDenied'){
      s.pending.delete(waitKey('permission'));s.pending.delete('notification');if(e.callId)s.tools.delete(e.callId);refresh();
    }
    else if(e.event==='ElicitationResult'){s.pending.delete(waitKey('elicitation'));s.pending.delete('notification');refresh();}
    else if(e.event==='Stop')s.state=waiting()?'waiting':'result';
    else if(e.event==='StopFailure'){s.state='error';s.active=false;s.tools.clear();s.pending.clear();notify('error');}
    else if(e.event==='FinalStop'){
      s.tools.clear();s.pending.clear();
      if(e.recovering){s.state='thinking';}
      else{s.active=false;s.state=e.reason==='completed'?'success':e.reason==='failed'?'error':'idle';if(s.state==='success')notify('complete');if(s.state==='error')notify('error');}
    }else if(e.event==='SessionEnd'){s.state='idle';s.active=false;s.tools.clear();s.pending.clear();}
    else return false;
    s.at=e.at;s.observedAt=now();sessions.set(e.sessionId,s);publish(notice);return true;
  }
  // 仅供已确认宿主全部退出的进程监视调用；最小化、失焦或长时间无Hook均不能冒充退出。
  function hostClosed(){if(disposed)return;closedAt=now();sessions.clear();seen.clear();publish();}
  function dispose(){if(disposed)return;disposed=true;if(timer!==null)timers.clearTimeout(timer);timer=null;sessions.clear();seen.clear();}
  return {accept,snapshot,hostClosed,dispose};
}
