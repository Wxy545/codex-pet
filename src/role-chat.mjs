import {normalizeMemoryScope} from './pet-memory.mjs';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const fail=code=>{throw Object.assign(Error(code),{code});};
const text=(value,max,empty=false)=>typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const EFFORTS=['none','minimal','low','medium','high','xhigh','max','ultra'];
function trusted(value){
 if(!object(value)||value.isOwner!==true||value.audience!=='owner')fail('role_chat_owner_required');
 if(!fields(value,['host','profile','channel','account','audience','actor','isOwner']))fail('role_chat_identity_invalid');
 try{const{isOwner,...scope}=value;return{...normalizeMemoryScope({...scope,character:'validation'}),isOwner};}catch{fail('role_chat_identity_invalid');}
}
function character(value){
 const name=value?.name||value?.copy?.name||value?.id,persona=value?.persona||value?.copy?.persona||'';
 if(!object(value)||!id(value.id)||!text(name,120)||!text(persona,8000,true)||value.locale!==undefined&&!text(value.locale,40))fail('role_chat_character_invalid');
 return{id:value.id,name,persona,locale:value.locale||'zh-CN'};
}
function execution(value,{input=false}={}){
 if(value==null)return null;
 const keys=['host','purpose','model','effort','provenance','configurable'];
 if(!object(value)||input&&!fields(value,keys))fail('role_chat_input_invalid');
 const result={};
 for(const key of ['host','purpose','model','effort','provenance'])if(value[key]!==undefined&&value[key]!==null){
  if(!text(value[key],key==='model'?100:40)||key==='effort'&&!EFFORTS.includes(value[key]))fail('role_chat_input_invalid');result[key]=value[key];
 }
 if(typeof value.configurable==='boolean')result.configurable=value.configurable;
 return Object.keys(result).length?result:null;
}
function generated(value){
 if(!object(value)||!text(value.text,16384))fail('role_chat_response_invalid');
 // 生成器必须在宿主层关闭工具。这里额外拒收带工具调用的响应，不能替代宿主层限制。
 if(value.toolCalls?.length||value.tool_calls?.length||value.functionCall||value.function_call)fail('role_chat_tools_forbidden');
 const result={text:value.text,execution:execution(value.execution)};
 if(object(value.usage)){const usage={};for(const key of ['inputTokens','outputTokens','totalTokens','cachedInputTokens'])if(Number.isFinite(value.usage[key])&&value.usage[key]>=0)usage[key]=value.usage[key];if(Object.keys(usage).length)result.usage=usage;}
 if(Array.isArray(value.materialsUsed))result.materialsUsed=[...new Set(value.materialsUsed.filter(kind=>['text','image','audio','video'].includes(kind)))];
 return result;
}

/** 纯角色闲聊只接可信身份与无工具生成器；不接管执行会话，也不从来信推断本人身份。 */
export function createRoleChatService({workspace,generate,characterProvider,canUseHost=()=>false,notifyPet=async()=>false,settings=()=>({shareOwnerMemory:false}),now=Date.now,timeoutMs=120000,maxQueuedPerScope=8}={}){
 if(!workspace?.memory||typeof workspace.ownerScope!=='function'||typeof workspace.registerMemoryScope!=='function'||typeof workspace.markMemoryUsed!=='function'||typeof generate!=='function'||typeof characterProvider!=='function'||typeof canUseHost!=='function'||typeof notifyPet!=='function'||typeof settings!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>300000||!Number.isInteger(maxQueuedPerScope)||maxQueuedPerScope<1||maxQueuedPerScope>32)fail('role_chat_configuration_invalid');
 const queues=new Map(),controllers=new Set(),receipts=new WeakMap();let disposed=false;
 const currentCharacter=async identity=>character(await characterProvider(identity));
 const settingSnapshot=async identity=>{const value=await settings(identity);return{shareOwnerMemory:value?.shareOwnerMemory===true,revision:Number.isSafeInteger(value?.revision)&&value.revision>=0?value.revision:null};};
 const cancelled=signal=>{if(disposed||signal?.aborted)fail('role_chat_cancelled');};
 async function validate(snapshot,ticket,signal){
  cancelled(signal);
  if(!await canUseHost(snapshot.identity.host,snapshot.identity)||JSON.stringify(await settingSnapshot(snapshot.identity))!==snapshot.settingsFingerprint||JSON.stringify(await currentCharacter(snapshot.identity))!==snapshot.characterFingerprint||!await workspace.memory.isCurrent(snapshot.scope,ticket))fail('role_chat_stale');
  cancelled(signal);return true;
 }
 async function prepare(who){
  const identity=trusted(who);delete identity.character;delete identity.project;
  if(!await canUseHost(identity.host,identity))fail('role_chat_host_unavailable');
  const pet=await currentCharacter(identity),selectedSettings=await settingSnapshot(identity),shared=selectedSettings.shareOwnerMemory;let scope;
  if(shared){
   scope=normalizeMemoryScope(await workspace.ownerScope(identity,pet));
   if(scope.host!==identity.host||scope.character!==pet.id||scope.audience!=='owner')fail('role_chat_scope_invalid');
  }else{const{isOwner,...principal}=identity;scope=normalizeMemoryScope({...principal,character:pet.id});}
  const scopeId=await workspace.registerMemoryScope(scope,{name:pet.name+' · '+identity.host+' · '+(scope.channel==='desktop'?'桌面闲聊':'本人私聊')});
  return{identity,pet,shared,scope,scopeId,characterFingerprint:JSON.stringify(pet),settingsFingerprint:JSON.stringify(selectedSettings)};
 }
 async function run(snapshot,input){
  const controller=new AbortController(),{signal}=controller;controllers.add(controller);
  let abortReason='role_chat_cancelled',timer,abortListener,assistantId;
  const abort=reason=>{abortReason=reason;controller.abort();};
  if(input.signal){if(input.signal.aborted)abort('role_chat_cancelled');else{abortListener=()=>abort('role_chat_cancelled');input.signal.addEventListener('abort',abortListener,{once:true});}}
  const aborted=new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error(abortReason),{code:abortReason})),{once:true}));
  // 提前挂上拒绝处理，取消发生在磁盘操作期间也不会产生未处理的 Promise。
  aborted.catch(()=>{});
  timer=setTimeout(()=>abort('role_chat_timeout'),timeoutMs);
  try{
   cancelled(signal);await validate(snapshot,await workspace.memory.revision(snapshot.scope),signal);
   const stamp=now();if(!Number.isFinite(stamp))fail('role_chat_configuration_invalid');
   const user=input.purpose==='whisper'?null:await workspace.memory.append(snapshot.scope,{role:'user',text:input.text,source:{kind:'chat',speaker:snapshot.identity.actor,confirmation:'stated',at:new Date(stamp).toISOString()}});
   // 检索词有独立上限；长来信仍完整保存和提交，不拿全文长度撑大每次索引查询。
   const context=await workspace.memory.buildContext(snapshot.scope,{query:input.text.slice(0,2048),recentLimit:6,limit:8,maxTokens:4096,maxChars:8192,excludeIds:user?[user.record.id]:[]});
   await validate(snapshot,context.ticket,signal);
   const request={host:snapshot.identity.host,profile:snapshot.identity.profile,purpose:input.purpose||(snapshot.identity.channel==='desktop'?'chat':'qq-chat'),character:structuredClone(snapshot.pet),text:input.text,context:context.context,execution:input.execution,tools:[],signal};
   // 一次生成的同一文本交给桌宠和 QQ；无重试、不为气泡另调模型。
   const response=generated(await Promise.race([Promise.resolve().then(()=>generate(request)),aborted]));
   await validate(snapshot,context.ticket,signal);
   const saved=await workspace.memory.append(snapshot.scope,{role:'assistant',text:response.text,source:{kind:input.purpose==='whisper'?'event':'chat',speaker:snapshot.pet.id,label:snapshot.pet.name,confirmation:'inferred'},derivedFrom:[...new Set([...(user?[user.record.id]:[]),...context.selectedIds])]},{ticket:context.ticket});
   assistantId=saved.record.id;await validate(snapshot,saved.ticket,signal);
   const memory={scopeId:snapshot.scopeId,ticket:saved.ticket,selectedIds:[...context.selectedIds],shared:snapshot.shared};
   // 助手回写本身提高修订号；只有本轮实际使用的片段可携新票据展示，不能重新预览冒充使用。
   await workspace.markMemoryUsed(snapshot.scope,{...context,ticket:saved.ticket},response.execution||{});
   const answer={...response,memory,presentation:{delivered:false}};
   const stillCurrent=()=>validate(snapshot,saved.ticket,signal).then(()=>true,()=>false);
   receipts.set(answer,stillCurrent);
   try{answer.presentation.delivered=await Promise.race([Promise.resolve().then(()=>notifyPet({host:snapshot.identity.host,character:structuredClone(snapshot.pet),...answer,signal,isCurrent:stillCurrent})),aborted])===true;}catch(error){if(signal.aborted)throw error;}
   await validate(snapshot,saved.ticket,signal);return answer;
  }catch(error){
   // 若取消恰落在助手写入期间，只删除本轮派生回复，不能清空其他有效来信。
   if(assistantId)await workspace.memory.remove(snapshot.scope,{ids:[assistantId]}).catch(()=>{});
   if(signal.aborted)fail(abortReason);
   if(error?.code==='memory_stale')fail('role_chat_stale');
   if(typeof error?.code==='string'&&/^(role_chat_|memory_)/.test(error.code))throw error;
   fail('role_chat_generation_failed');
  }finally{clearTimeout(timer);if(abortListener)input.signal.removeEventListener('abort',abortListener);controllers.delete(controller);}
 }
 async function reply(input){
  if(disposed)fail('role_chat_disposed');
  if(!fields(input,['trustedIdentity','text','signal','execution','purpose'])||!text(input.text,16384)||input.purpose!==undefined&&!['chat','qq-chat','translation','summary','whisper'].includes(input.purpose)||input.signal!==undefined&&typeof input.signal?.addEventListener!=='function')fail('role_chat_input_invalid');
  const selected=execution(input.execution,{input:true}),snapshot=await prepare(input.trustedIdentity);if(disposed)fail('role_chat_disposed');
  const key=JSON.stringify(snapshot.scope),queue=queues.get(key)||{tail:Promise.resolve(),count:0};if(queue.count>=maxQueuedPerScope)fail('role_chat_busy');
  queue.count++;queues.set(key,queue);const next=queue.tail.catch(()=>{}).then(()=>run(snapshot,{text:input.text,execution:selected,signal:input.signal,purpose:input.purpose}));queue.tail=next;
  try{return await next;}finally{queue.count--;if(queue.count===0&&queues.get(key)===queue)queues.delete(key);}
 }
 return{reply,isCurrent:answer=>receipts.get(answer)?.()||Promise.resolve(false),dispose(){disposed=true;for(const controller of controllers)controller.abort();}};
}
