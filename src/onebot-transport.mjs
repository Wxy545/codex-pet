import {randomUUID} from 'node:crypto';

// OneBot v11正向WS根路径同时承载API与事件；本模块不登录QQ、不解释任务命令。
export const ONEBOT_TEXT_CHUNK_CHARS=2000;
export const ONEBOT_MAX_TEXT_CHARS=8000;
const RETRY_MS=[1000,2000,5000,10000,30000,60000],MAX_FRAME_BYTES=1024*1024,MAX_QUEUED=64;
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const controls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function numericId(value,{message=false}={}){
 if(typeof value==='number')return Number.isSafeInteger(value)&&(message||value>0)?String(value):null;
 if(typeof value!=='string'||!(message?/^-?(?:0|[1-9]\d{0,15})$/:/^[1-9]\d{0,15}$/).test(value))return null;
 const number=Number(value);return Number.isSafeInteger(number)&&(message||number>0)&&String(number)===value?value:null;
}
function endpoint(value){
 // 不接受域名、替代IP写法和用户凭据；配置中的URL不携带token。
 if(typeof value!=='string'||/[\u0000-\u0020\u007f]/.test(value))return null;
 const match=/^ws:\/\/(127\.0\.0\.1|\[::1\]):(\d{1,5})\/?$/.exec(value);
 if(!match||Number(match[2])<1||Number(match[2])>65535)return null;
 const url=new URL(value);return url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password?url:null;
}
function plainText(message){
 let text;
 if(typeof message==='string'){
  // 字符串模式使用CQ编码；含控制片段时整条拒绝，不剥离片段后继续执行。
  if(/(?:\[|&#91;)CQ:/i.test(message))return null;text=message;
 }else if(Array.isArray(message)&&message.length>0&&message.length<=64){
  const parts=[];
  for(const part of message){if(!record(part)||part.type!=='text'||!record(part.data)||typeof part.data.text!=='string'||Object.keys(part.data).some(key=>key!=='text'))return null;parts.push(part.data.text);}
  text=parts.join('');
 }else return null;
 return text&&text.length<=12000&&!controls.test(text)&&text.trim()?text:null;
}
function incoming(value){
 if(!record(value)||value.post_type!=='message'||value.message_type!=='private'||value.sub_type!=='friend'||!record(value.sender))return null;
 const selfId=numericId(value.self_id),userId=numericId(value.user_id),messageId=numericId(value.message_id,{message:true});
 if(!selfId||!userId||messageId===null||numericId(value.sender.user_id)!==userId||selfId===userId)return null;
 const text=plainText(value.message);return text===null?null:{selfId,userId,messageId,text};
}

export class OneBotTransportError extends Error{
 constructor(code,details={}){super(code);this.name='OneBotTransportError';this.code=code;Object.assign(this,details);}
}
const failure=(code,details)=>new OneBotTransportError(code,details);

/** 配置只接受本机OneBot；票据仅在内部WS握手使用，状态和错误正文不回显URL、token或消息。 */
export function createOneBotTransport({url,accessToken,selfId,onMessage=()=>{},onStatus=()=>{},WebSocketImpl=globalThis.WebSocket,now=Date.now,timers=globalThis}={}){
 const base=endpoint(url),expected=selfId===undefined||selfId===''?null:numericId(selfId);
 if(!base||typeof accessToken!=='string'||!accessToken.trim()||accessToken!==accessToken.trim()||accessToken.length>512||/[\u0000-\u001f\u007f]/.test(accessToken)||selfId!==undefined&&selfId!==''&&!expected||[onMessage,onStatus,WebSocketImpl,now,timers?.setTimeout,timers?.clearTimeout].some(value=>typeof value!=='function'))throw failure('onebot_invalid_options');
 let active=false,lifecycle=0,epoch=0,socket=null,connected=false,pinnedSelfId=expected,retry=0,reconnectTimer=null,handshakeTimer=null,dispatching=null,pendingSends=0;
 const pending=new Map(),seen=new Map(),queues=new Map(),early=[],inbound=[];
 const status=(state,code)=>{try{Promise.resolve(onStatus({state,...(code?{code}:{}),...(state==='connected'?{selfId:pinnedSelfId}:{})})).catch(()=>{});}catch{}};
 const live=(life,connection,owned)=>active&&life===lifecycle&&connection===epoch&&socket===owned;
 const clear=name=>{if(name==='reconnect'){if(reconnectTimer!==null)timers.clearTimeout(reconnectTimer);reconnectTimer=null;}else{if(handshakeTimer!==null)timers.clearTimeout(handshakeTimer);handshakeTimer=null;}};
 function settle(item,error,value){if(!pending.delete(item.echo))return;timers.clearTimeout(item.timer);error?item.reject(error):item.resolve(value);}
 function rejectPending(code){for(const item of [...pending.values()])settle(item,failure(code,{deliveryUnknown:item.action==='send_private_msg'&&item.sent}));}
 function lose(life,connection,owned,code,{terminal=false}={}){
  if(!live(life,connection,owned))return;
  socket=null;connected=false;epoch++;dispatching=null;clear('handshake');early.length=0;inbound.length=0;rejectPending(code);try{owned.close();}catch{}
  status('error',code);
  if(terminal){active=false;lifecycle++;clear('reconnect');return;}
  if(reconnectTimer!==null)return;
  const delay=RETRY_MS[Math.min(retry++,RETRY_MS.length-1)];reconnectTimer=timers.setTimeout(()=>{reconnectTimer=null;if(active&&life===lifecycle)connect(life,true);},delay);
 }
 function check(life,connection,owned){if(!live(life,connection,owned)||!connected||owned.readyState!==1)throw failure('onebot_disconnected',{deliveryUnknown:false});}
 function request(action,params,life,connection,owned){
  return new Promise((resolve,reject)=>{
   if(!live(life,connection,owned)||owned.readyState!==1)return reject(failure('onebot_disconnected',{deliveryUnknown:false}));
   if(pending.size>=64)return reject(failure('onebot_send_queue_full',{deliveryUnknown:false}));
   const echo='codex-pet-'+randomUUID(),item={echo,action,resolve,reject,sent:false,timer:null};pending.set(echo,item);
   item.timer=timers.setTimeout(()=>{settle(item,failure(action==='send_private_msg'?'onebot_send_timeout':'onebot_handshake_failed',{deliveryUnknown:action==='send_private_msg'&&item.sent}));lose(life,connection,owned,action==='send_private_msg'?'onebot_send_timeout':'onebot_handshake_failed');},10000);
   try{item.sent=true;owned.send(JSON.stringify({action,params,echo}));}catch{settle(item,failure('onebot_disconnected',{deliveryUnknown:action==='send_private_msg'}));lose(life,connection,owned,'onebot_disconnected');}
  });
 }
 function receiveReply(value){
  if(typeof value.echo!=='string')return false;const item=pending.get(value.echo);if(!item)return true;
  if(value.status!=='ok'||value.retcode!==0){const rejected=value.status==='failed'&&Number.isSafeInteger(value.retcode)&&value.retcode!==0;settle(item,failure('onebot_api_failed',{deliveryUnknown:item.action==='send_private_msg'&&!rejected}));return true;}
  if(!record(value.data)){settle(item,failure('onebot_invalid_response',{deliveryUnknown:item.action==='send_private_msg'}));return true;}
  if(item.action==='get_login_info'){
   const id=numericId(value.data.user_id);if(!id){settle(item,failure('onebot_invalid_response'));return true;}settle(item,null,{selfId:id});
  }else{
   const id=numericId(value.data.message_id,{message:true});if(id===null){settle(item,failure('onebot_invalid_response',{deliveryUnknown:true}));return true;}settle(item,null,{messageId:id});
  }
  return true;
 }
 async function pump(life,connection,owned){
  if(dispatching)return;const marker={};dispatching=marker;
  try{while(live(life,connection,owned)&&connected&&inbound.length){const item=inbound.shift();try{await onMessage(item);}catch{}}}
  finally{if(dispatching===marker)dispatching=null;if(connected&&inbound.length&&socket)pump(lifecycle,epoch,socket);}
 }
 function enqueue(item,life,connection,owned){
  if(item.selfId!==pinnedSelfId||item.userId===pinnedSelfId)return;
  const id='onebot-'+pinnedSelfId+'-'+item.messageId;if(seen.has(id))return;
  const time=now();for(const[key,at]of seen){if(time-at>86400000||seen.size>=10000)seen.delete(key);else break;}
  seen.set(id,time);if(inbound.length>=MAX_QUEUED){lose(life,connection,owned,'onebot_protocol_limit');return;}
  inbound.push({id,userId:item.userId,text:item.text});void pump(life,connection,owned);
 }
 function connect(life,reconnecting=false){
  if(!active||life!==lifecycle)return;const connection=++epoch;connected=false;status(reconnecting?'reconnecting':'connecting');
  let owned;
  try{
   // OneBot规范允许query鉴权；Node原生WebSocket不支持自定义Authorization头。
   const authenticated=new URL(base.href);authenticated.searchParams.set('access_token',accessToken);owned=new WebSocketImpl(authenticated.href);socket=owned;
  }catch{status('error','onebot_connect_failed');active=false;lifecycle++;return;}
  handshakeTimer=timers.setTimeout(()=>lose(life,connection,owned,'onebot_handshake_failed'),15000);
  owned.addEventListener('open',()=>{if(!live(life,connection,owned))return;
   void request('get_login_info',{},life,connection,owned).then(async value=>{
    if(!live(life,connection,owned))return;if(pinnedSelfId&&value.selfId!==pinnedSelfId){lose(life,connection,owned,'onebot_identity_mismatch',{terminal:true});return;}
    pinnedSelfId=value.selfId;
    // 桥先持久化账号指纹，成功后才接收命令；写入失败不能把未绑定连接视为可用。
    try{await onStatus({state:'connected',selfId:pinnedSelfId});}catch{lose(life,connection,owned,'onebot_storage_failed',{terminal:true});return;}
    if(!live(life,connection,owned))return;connected=true;retry=0;clear('handshake');for(const item of early.splice(0))enqueue(item,life,connection,owned);
   },error=>{if(live(life,connection,owned))lose(life,connection,owned,error.code==='onebot_api_failed'?'onebot_handshake_failed':error.code||'onebot_handshake_failed',{terminal:error.code==='onebot_api_failed'});});
  });
  owned.addEventListener('message',event=>{
   if(!live(life,connection,owned))return;
   if(typeof event.data!=='string'||Buffer.byteLength(event.data,'utf8')>MAX_FRAME_BYTES){lose(life,connection,owned,'onebot_protocol_limit');return;}
   let value;try{value=JSON.parse(event.data);}catch{lose(life,connection,owned,'onebot_invalid_frame');return;}if(!record(value)){lose(life,connection,owned,'onebot_invalid_frame');return;}
   if(receiveReply(value))return;const item=incoming(value);if(!item)return;
   if(!connected){if(early.length>=MAX_QUEUED)lose(life,connection,owned,'onebot_protocol_limit');else early.push(item);return;}enqueue(item,life,connection,owned);
  });
  owned.addEventListener('close',()=>lose(life,connection,owned,'onebot_disconnected'));
  owned.addEventListener('error',()=>lose(life,connection,owned,'onebot_connect_failed'));
 }
 function start(){if(active)return;active=true;retry=0;const life=++lifecycle;connect(life);}
 function stop(){
  if(!active&&!socket&&reconnectTimer===null)return;active=false;lifecycle++;epoch++;connected=false;dispatching=null;clear('reconnect');clear('handshake');early.length=0;inbound.length=0;rejectPending('onebot_stopped');const owned=socket;socket=null;try{owned?.close();}catch{}status('stopped');
 }
 async function sendBatch(message,life,connection,owned){
  const chunks=[];for(let at=0;at<message.text.length;at+=ONEBOT_TEXT_CHUNK_CHARS)chunks.push(message.text.slice(at,at+ONEBOT_TEXT_CHUNK_CHARS).join(''));const messageIds=[];
  for(let index=0;index<chunks.length;index++)try{
   check(life,connection,owned);const result=await request('send_private_msg',{user_id:Number(message.userId),message:[{type:'text',data:{text:chunks[index]}}],auto_escape:true},life,connection,owned);messageIds.push(result.messageId);
  }catch(error){const safe=error instanceof OneBotTransportError?error:failure('onebot_send_failed',{deliveryUnknown:true});Object.assign(safe,{sentCount:messageIds.length,unsentText:chunks.slice(index).join(''),deliveryUnknown:safe.deliveryUnknown===true});throw safe;}
  return{sentCount:messageIds.length,messageIds};
 }
 async function send(value){
  if(!active||!connected||!socket)throw failure('onebot_not_connected',{deliveryUnknown:false});
  const userId=numericId(value?.userId),text=typeof value?.text==='string'?[...value.text]:null;
  if(!record(value)||Object.keys(value).some(key=>!['userId','text','msgId'].includes(key))||!userId||userId===pinnedSelfId||!text||!text.length||text.length>ONEBOT_MAX_TEXT_CHARS||!value.text.trim()||controls.test(value.text)||value.msgId!==undefined&&(typeof value.msgId!=='string'||!value.msgId||value.msgId.length>512||/[\u0000-\u0020\u007f]/.test(value.msgId)))throw failure('onebot_invalid_send',{deliveryUnknown:false});
  const prior=queues.get(userId);if(pendingSends>=256||(prior?.count??0)>=16||!prior&&queues.size>=128)throw failure('onebot_send_queue_full',{deliveryUnknown:false});
  const life=lifecycle,connection=epoch,owned=socket,state={count:(prior?.count??0)+1,promise:null};pendingSends++;
  const promise=(prior?.promise??Promise.resolve()).catch(()=>{}).then(()=>sendBatch({userId,text},life,connection,owned));state.promise=promise;queues.set(userId,state);
  try{return await promise;}finally{pendingSends--;const current=queues.get(userId);if(current===state)queues.delete(userId);else if(current)current.count--;}
 }
 return{start,stop,send};
}
