import {randomUUID} from 'node:crypto';

export const HOOK_EVENTS = new Set(['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure',
  'Notification','PermissionRequest','PermissionDenied','Elicitation','ElicitationResult','Stop','FinalStop','StopFailure','SessionEnd',
  'SubagentStart','SubagentStop']);
export const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const reasons = new Set(['completed','cancelled','interrupted','failed']);
const waitNotifications = new Set(['permission_prompt','elicitation_dialog','agent_needs_input']);

/** 只采集事件元数据；stdin中的提示词、工具正文、错误和路径永不进入传输对象。 */
export function normalizeHookInput(input, {env=process.env,at=Date.now(),eventId=randomUUID()}={}) {
  if (!input || !HOOK_EVENTS.has(input.hook_event_name) || !safeId(input.session_id) || !safeId(eventId)) return null;
  const sessionId=input.session_id, actual=env.CODEBUDDY_SESSION_ID, requestId=env.CODEBUDDY_CONVERSATION_REQUEST_ID;
  const event=input.hook_event_name;
  const subagent=['SubagentStart','SubagentStop'].includes(event) || safeId(actual) && actual !== sessionId;
  const out={schemaVersion:1,source:'workbuddy',eventId,event,sessionId,...safeId(requestId)?{requestId}:{},at,subagent:Boolean(subagent)};
  const callId=input.call_id ?? input.tool_use_id ?? input.elicitation_id;
  if (safeId(callId)) out.callId=callId;
  if (event === 'PreToolUse') out.interaction=['AskUserQuestion','AskUserForStructuredInput'].includes(input.tool_name) ? 'question' : 'tool';
  if (event === 'Notification') out.interaction=waitNotifications.has(input.notification_type) ? 'waiting' : 'other';
  if (event === 'FinalStop') out.reason=reasons.has(input.final_stop_reason) ? input.final_stop_reason : 'unknown';
  if (input.is_truncation_recovery === true) out.recovering=true;
  if (input.is_internal_continuation === true) out.internal=true;
  return out;
}

/** 宿主再次核对固定schema，不接受外部拼入的正文或任意附加字段。 */
export function validateHookEvent(value) {
  const fields=new Set(['schemaVersion','source','eventId','event','sessionId','requestId','at','subagent','callId','interaction','reason','recovering','internal']);
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!fields.has(k))
    || value.schemaVersion!==1 || value.source!=='workbuddy' || !HOOK_EVENTS.has(value.event)
    || !safeId(value.eventId) || !safeId(value.sessionId) || !Number.isSafeInteger(value.at) || value.at<1
    || typeof value.subagent!=='boolean') return false;
  if (value.requestId!==undefined && !safeId(value.requestId) || value.callId!==undefined && !safeId(value.callId)) return false;
  if (value.interaction!==undefined && !['question','tool','waiting','other'].includes(value.interaction)) return false;
  if (value.reason!==undefined && ![...reasons,'unknown'].includes(value.reason)) return false;
  return ['recovering','internal'].every(k=>value[k]===undefined || typeof value[k]==='boolean');
}
