import test from 'node:test';
import assert from 'node:assert/strict';
import {createOneBotTransport,ONEBOT_TEXT_CHUNK_CHARS,OneBotTransportError} from '../src/onebot-transport.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const event=(id=101,extra={})=>({post_type:'message',message_type:'private',sub_type:'friend',self_id:123456,user_id:234567,message_id:id,message:[{type:'text',data:{text:'/状态'}}],sender:{user_id:234567},...extra});
function fixture(t,options={}){
 let clock=1000000,sequence=0;const timers=new Map(),sockets=[],messages=[],statuses=[];
 const {onMessage,onStatus,...settings}=options;
 class Socket extends EventTarget{
  readyState=0;sent=[];
  constructor(url){super();this.url=url;sockets.push(this);}
  send(value){if(this.readyState!==1)throw Error('raw private transport detail');this.sent.push(JSON.parse(value));}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
  frame(value){this.dispatchEvent(new MessageEvent('message',{data:typeof value==='string'?value:JSON.stringify(value)}));}
  reply(request,data={message_id:900},extra={}){this.frame({status:'ok',retcode:0,data,echo:request.echo,...extra});}
 }
 const transport=createOneBotTransport({url:'ws://127.0.0.1:3001/',accessToken:'synthetic-token&+/#',selfId:'123456',WebSocketImpl:Socket,onMessage:value=>{messages.push(value);return onMessage?.(value);},onStatus:value=>{statuses.push(value);return onStatus?.(value);},now:()=>clock,timers:{setTimeout(fn,delay){const id=++sequence;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout(id){timers.delete(id);}},...settings});
 t.after(()=>transport.stop());
 const start=async()=>{await transport.start();await flush();return sockets.at(-1);};
 const ready=async()=>{const socket=await start();socket.open();socket.reply(socket.sent[0],{user_id:123456,nickname:'Synthetic bot'});await flush();return socket;};
 return{transport,sockets,messages,statuses,timers,start,ready,async advance(ms){clock+=ms;for(let i=0;i<100;i++){const due=[...timers].filter(([,value])=>value.at<=clock);if(!due.length)break;for(const[id,value]of due){timers.delete(id);value.fn();}await flush();}}};
}
const sends=socket=>socket.sent.filter(value=>value.action==='send_private_msg');

test('只接受带端口的本机根WS，拒域名、替代IP、凭据、query及不能收事件的API路径',()=>{
 for(const url of ['ws://localhost:3001/','ws://127.1:3001/','ws://2130706433:3001/','ws://0.0.0.0:3001/','ws://192.168.0.2:3001/','wss://127.0.0.1:3001/','http://127.0.0.1:3001/','ws://127.0.0.1/','ws://127.0.0.1:0/','ws://127.0.0.1:65536/','ws://user:secret@127.0.0.1:3001/','ws://127.0.0.1:3001/?access_token=secret','ws://127.0.0.1:3001/#x','ws://127.0.0.1:3001/api','ws://127.0.0.1:3001/event','ws://127.0.0.1:3001/\n'])assert.throws(()=>createOneBotTransport({url,accessToken:'synthetic-secret'}),error=>error.code==='onebot_invalid_options'&&!error.message.includes(url));
 for(const accessToken of ['',undefined,' key','key\nsecret'])assert.throws(()=>createOneBotTransport({url:'ws://127.0.0.1:3001/',accessToken}),error=>error.code==='onebot_invalid_options');
});

test('内部query编码鉴权，get_login_info严格匹配echo后才connected并提供账号指纹',async t=>{
 const f=fixture(t,{selfId:undefined}),socket=await f.start();assert.equal(new URL(socket.url).searchParams.get('access_token'),'synthetic-token&+/#');assert.equal(f.statuses.at(-1).state,'connecting');
 socket.open();assert.equal(socket.sent[0].action,'get_login_info');assert.deepEqual(socket.sent[0].params,{});assert.equal(typeof socket.sent[0].echo,'string');
 socket.frame({status:'ok',retcode:0,data:{user_id:123456},echo:'wrong-echo'});socket.frame(event(100));await flush();assert.equal(f.messages.length,0);assert.equal(f.statuses.at(-1).state,'connecting');
 socket.reply(socket.sent[0],{user_id:'123456'});await flush();assert.deepEqual(f.statuses.at(-1),{state:'connected',selfId:'123456'});assert.deepEqual(f.messages,[{id:'onebot-123456-100',userId:'234567',text:'/状态'}]);assert.doesNotMatch(JSON.stringify(f.statuses),/synthetic-token|access_token|Synthetic bot/);
 const ipv6=fixture(t,{url:'ws://[::1]:6700/'});await ipv6.ready();assert.equal(ipv6.statuses.at(-1).state,'connected');
});

test('登录账号不匹配和明确握手失败停止连接，不回显服务器正文或无限重试',async t=>{
 for(const variant of ['identity','failed']){
  const f=fixture(t),socket=await f.start();socket.open();if(variant==='identity')socket.reply(socket.sent[0],{user_id:999999});else socket.reply(socket.sent[0],{private:'synthetic-token&+/#'},{status:'failed',retcode:1401});await flush();
  assert.equal(f.statuses.at(-1).state,'error');assert.equal(f.statuses.at(-1).code,variant==='identity'?'onebot_identity_mismatch':'onebot_handshake_failed');await f.advance(120000);assert.equal(f.sockets.length,1);assert.doesNotMatch(JSON.stringify(f.statuses),/999999|synthetic-token|private/);
 }
});

test('只投递friend纯文本，拒群临时会话、自发消息、跨账号、引用或混合非文本',async t=>{
 const f=fixture(t),socket=await f.ready();socket.frame(event(-101));socket.frame(event(-101));socket.frame(event(102,{message:'直接文字'}));
 let id=200;for(const extra of [{post_type:'message_sent'},{message_type:'group'},{sub_type:'group'},{user_id:123456,sender:{user_id:123456}},{self_id:888888},{sender:{user_id:345678}},{message:[{type:'reply',data:{id:'1'}},{type:'text',data:{text:'/取消'}}]},{message:[{type:'image',data:{file:'private'}},{type:'text',data:{text:'/状态'}}]},{message:'[CQ:reply,id=1]/取消'},{message:'&#91;CQ:reply,id=1&#93;/取消'},{message:[],raw_message:'/任务 hidden'},{message:[{type:'text',data:{text:'hidden',action:'execute'}}]},{user_id:Number.MAX_SAFE_INTEGER+1,sender:{user_id:Number.MAX_SAFE_INTEGER+1}}])socket.frame(event(id++,extra));
 await flush();assert.deepEqual(f.messages,[{id:'onebot-123456--101',userId:'234567',text:'/状态'},{id:'onebot-123456-102',userId:'234567',text:'直接文字'}]);
});

test('发送仅调用send_private_msg，使用文字段和auto_escape，Unicode分片逐条确认',async t=>{
 const f=fixture(t),socket=await f.ready(),text='🙂'.repeat(4500),promise=f.transport.send({userId:'234567',text,msgId:'onebot-123456-1'});await flush();
 assert.equal(sends(socket).length,1);for(let i=0;i<3;i++){const request=sends(socket)[i];assert.deepEqual(Object.keys(request).sort(),['action','echo','params']);assert.equal(request.params.user_id,234567);assert.equal(request.params.auto_escape,true);assert.equal(request.params.message[0].type,'text');assert.equal([...request.params.message[0].data.text].length,i<2?ONEBOT_TEXT_CHUNK_CHARS:500);socket.reply(request,{message_id:900+i});await flush();}
 assert.deepEqual(await promise,{sentCount:3,messageIds:['900','901','902']});assert.equal(sends(socket).map(value=>value.params.message[0].data.text).join(''),text);
 const literal=f.transport.send({userId:'234567',text:'[CQ:at,qq=all] literal'});await flush();const request=sends(socket).at(-1);assert.equal(request.params.message.length,1);assert.equal(request.params.message[0].data.text,'[CQ:at,qq=all] literal');socket.reply(request);await literal;
});

test('并发按echo精确匹配，不同好友乱序回包不串结果，同一好友按顺序发送',async t=>{
 const f=fixture(t),socket=await f.ready(),a=f.transport.send({userId:'234567',text:'first'}),b=f.transport.send({userId:'345678',text:'other'}),c=f.transport.send({userId:'234567',text:'second'});await flush();assert.equal(sends(socket).length,2);
 const [first,other]=sends(socket);assert.notEqual(first.echo,other.echo);socket.reply(other,{message_id:-902});assert.deepEqual((await b).messageIds,['-902']);assert.equal(sends(socket).length,2);
 socket.reply(first,{message_id:901});await a;await flush();assert.equal(sends(socket).length,3);const second=sends(socket)[2];socket.reply(first,{message_id:999});await flush();socket.reply(second,{message_id:903});assert.deepEqual((await c).messageIds,['903']);
});

test('分片发送超时保留未确认部分，断线和重连都不自动重发，旧回包不能冒充新发送',async t=>{
 const f=fixture(t),socket=await f.ready(),text='a'.repeat(4500),promise=f.transport.send({userId:'234567',text});promise.catch(()=>{});await flush();socket.reply(sends(socket)[0],{message_id:901});await flush();const uncertain=sends(socket)[1];assert.equal(sends(socket).length,2);
 await f.advance(10000);await assert.rejects(promise,error=>error instanceof OneBotTransportError&&error.code==='onebot_send_timeout'&&error.sentCount===1&&error.unsentText==='a'.repeat(2500)&&error.deliveryUnknown===true);assert.doesNotMatch(f.statuses.at(-1).code,/a{4}/);
 await f.advance(1000);const next=f.sockets.at(-1);next.open();next.reply(next.sent[0],{user_id:123456});await flush();assert.equal(sends(next).length,0);socket.reply(uncertain,{message_id:902});socket.frame(event(999));await flush();assert.equal(f.messages.length,0);
 const fresh=f.transport.send({userId:'234567',text:'explicit new send'});await flush();const request=sends(next)[0];next.reply(request,{message_id:903});assert.equal((await fresh).sentCount,1);
});

test('已发送请求断开标记未知，排队未发请求标记未投递，关闭清空定时器和队列',async t=>{
 const f=fixture(t),socket=await f.ready(),a=f.transport.send({userId:'234567',text:'sent but no echo'}),b=f.transport.send({userId:'234567',text:'queued'});a.catch(()=>{});b.catch(()=>{});await flush();socket.close();
 await assert.rejects(a,error=>error.deliveryUnknown===true&&error.sentCount===0);await assert.rejects(b,error=>error.deliveryUnknown===false&&error.sentCount===0);f.transport.stop();assert.equal(f.timers.size,0);const count=f.statuses.length;socket.reply(sends(socket)[0],{message_id:901});socket.frame(event());await f.advance(120000);assert.equal(f.messages.length,0);assert.equal(f.statuses.length,count);assert.equal(f.sockets.length,1);
});

test('明确API失败与异步或坏回复区分投递状态，错误message及状态不包含服务端正文',async t=>{
 for(const mode of ['failed','async','invalid']){
  const f=fixture(t),socket=await f.ready(),promise=f.transport.send({userId:'234567',text:'private user result'});promise.catch(()=>{});await flush();const request=sends(socket)[0];
  if(mode==='invalid')socket.reply(request,{message_id:{private:'synthetic-token'}});else socket.frame({echo:request.echo,status:mode,retcode:mode==='failed'?100:1,data:{private:'synthetic-token'},message:'private user result'});
  await assert.rejects(promise,error=>error.deliveryUnknown===(mode!=='failed')&&!/private|synthetic-token/.test(error.message));assert.doesNotMatch(JSON.stringify(f.statuses),/private|synthetic-token/);
 }
});

test('重连保留同账号去重，自动发现的账号改变时停止，不把新账号当原绑定',async t=>{
 const f=fixture(t,{selfId:undefined}),first=await f.ready();first.frame(event());await flush();first.close();await f.advance(1000);const second=f.sockets.at(-1);second.open();second.reply(second.sent[0],{user_id:123456});await flush();second.frame(event());await flush();assert.equal(f.messages.length,1);
 second.close();await f.advance(1000);const third=f.sockets.at(-1);third.open();third.reply(third.sent[0],{user_id:654321});await flush();assert.equal(f.statuses.at(-1).code,'onebot_identity_mismatch');await f.advance(120000);assert.equal(f.sockets.length,3);
});

test('握手超时、非法/超大帧和回调失败均有界处理，停止后晚到握手不复活',async t=>{
 const f=fixture(t),socket=await f.start();socket.open();f.transport.stop();socket.reply(socket.sent[0],{user_id:123456});await flush();assert.equal(f.statuses.at(-1).state,'stopped');assert.equal(f.timers.size,0);
 const timeout=fixture(t);await timeout.start();await timeout.advance(15000);assert.equal(timeout.statuses.at(-1).code,'onebot_handshake_failed');timeout.transport.stop();assert.equal(timeout.timers.size,0);
 for(const frame of ['not-json','x'.repeat(1024*1024+1)]){const g=fixture(t),s=await g.ready();s.frame(frame);await flush();assert.match(g.statuses.at(-1).code,/onebot_(?:invalid_frame|protocol_limit)/);}
 const callbacks=fixture(t,{async onMessage(){throw Error('private callback');},async onStatus(value){if(value.state!=='connected')throw Error('private status');}}),s=await callbacks.ready();s.frame(event());await flush();await flush();assert.equal(callbacks.statuses.at(-1).state,'connected');
});

test('账号指纹持久化完成才投递消息，存储失败停止而非带未保存绑定继续执行',async t=>{
 let release;const stored=new Promise(resolve=>{release=resolve;}),f=fixture(t,{onStatus:async value=>{if(value.state==='connected')await stored;}}),socket=await f.start();socket.open();socket.reply(socket.sent[0],{user_id:123456});socket.frame(event());await flush();assert.equal(f.messages.length,0);await assert.rejects(f.transport.send({userId:'234567',text:'not ready'}),error=>error.code==='onebot_not_connected');release();await flush();assert.equal(f.messages.length,1);
 const failed=fixture(t,{onStatus:async value=>{if(value.state==='connected')throw Error('private storage path');}}),other=await failed.start();other.open();other.reply(other.sent[0],{user_id:123456});other.frame(event());await flush();assert.equal(failed.messages.length,0);assert.equal(failed.statuses.at(-1).code,'onebot_storage_failed');assert.doesNotMatch(JSON.stringify(failed.statuses),/private storage/);await failed.advance(120000);assert.equal(failed.sockets.length,1);
});

test('等待账号存储时停止，晚到成功回调不恢复连接或投递缓存消息',async t=>{
 let release;const stored=new Promise(resolve=>{release=resolve;}),f=fixture(t,{onStatus:async value=>{if(value.state==='connected')await stored;}}),socket=await f.start();socket.open();socket.reply(socket.sent[0],{user_id:123456});socket.frame(event());await flush();f.transport.stop();release();await flush();assert.equal(f.messages.length,0);assert.equal(f.statuses.at(-1).state,'stopped');assert.equal(f.timers.size,0);await assert.rejects(f.transport.send({userId:'234567',text:'late'}),error=>error.code==='onebot_not_connected');
});

test('拒非法发送和越限单好友队列，不向任意目标API或当前小号自身发消息',async t=>{
 const f=fixture(t);await assert.rejects(f.transport.send({userId:'234567',text:'before handshake'}),error=>error.code==='onebot_not_connected');const socket=await f.ready();
 for(const value of [{userId:'123456',text:'self'},{userId:'../escape',text:'bad'},{userId:Number.MAX_SAFE_INTEGER+1,text:'unsafe'},{userId:'234567',text:'\u0000'},{userId:'234567',text:'a'.repeat(8001)},{userId:'234567',text:'ok',action:'delete_msg'},{userId:'234567',text:'ok',msgId:'bad id'}])await assert.rejects(f.transport.send(value),error=>error.code==='onebot_invalid_send');
 const queued=[];for(let i=0;i<16;i++){const promise=f.transport.send({userId:'234567',text:'queued-'+i});promise.catch(()=>{});queued.push(promise);}await assert.rejects(f.transport.send({userId:'234567',text:'overflow'}),error=>error.code==='onebot_send_queue_full');await flush();assert.equal(sends(socket).length,1);f.transport.stop();await Promise.allSettled(queued);assert.equal(f.timers.size,0);
});
