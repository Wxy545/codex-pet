import test from 'node:test';
import assert from 'node:assert/strict';

let QQ = {};
try { QQ = await import('../src/qq-transport.mjs'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const flush = () => new Promise(resolve => setImmediate(resolve));
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json'}});
const incoming = (id = 'synthetic-message', extra = {}) => ({op: 0, s: 2, t: 'C2C_MESSAGE_CREATE', d: {
  id, author: {user_openid: 'synthetic-user', bot: false}, content: '/状态', message_type: 0,
  message_scene: {ext: ['msg_idx=synthetic-index-' + id]}, ...extra,
}});
function fixture(t, options = {}) {
  assert.equal(typeof QQ.createQQTransport, 'function', 'QQ官方收发模块尚未实现');
  let now = 1_000_000, timerId = 0;
  const timers = new Map(), requests = [], sockets = [], statuses = [], messages = [];
  class Socket extends EventTarget {
    readyState = 0;
    sent = [];
    constructor(url) { super(); this.url = url; sockets.push(this); }
    send(value) { assert.equal(this.readyState, 1); this.sent.push(JSON.parse(value)); }
    close(code = 1000) { this.readyState = 3; this.dispatchEvent(Object.assign(new Event('close'), {code})); }
    event(payload) { this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify(payload)})); }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  }
  let handler = async (url, init) => url.endsWith('/app/getAppAccessToken') ? json({access_token: 'synthetic-access-token', expires_in: '7200'})
    : url.endsWith('/gateway') ? json({url: 'wss://api.bot.qq.com/websocket/'})
      : json({id: 'synthetic-sent-' + requests.length});
  const transport = QQ.createQQTransport({
    appId: '12345678', appSecret: 'SYNTHETIC-SECRET',
    fetchImpl: async (url, init) => { requests.push({url, init}); return handler(url, init); },
    WebSocketImpl: Socket, now: () => now,
    timers: {setTimeout(fn, delay) { const id = ++timerId; timers.set(id, {fn, at: now + delay}); return id; }, clearTimeout(id) { timers.delete(id); }},
    onMessage: value => { messages.push(value); return options.onMessage?.(value); },
    onStatus: value => statuses.push(value),
  });
  t.after(() => transport.stop());
  const start = async () => { await transport.start(); await flush(); return sockets.at(-1); };
  const ready = async () => { const socket = await start(); socket.open(); socket.event({op: 10, d: {heartbeat_interval: 1000}});
    socket.event({op: 0, t: 'READY', s: 0, d: {session_id: 'synthetic-session'}}); await flush(); return socket; };
  return {transport, requests, sockets, statuses, messages, timers, start, ready,
    setHandler(next) {handler = next;}, setTime(value) {now = value;},
    async advance(ms) { now += ms; for (let count = 0; count < 30; count++) { const due = [...timers].filter(([,v]) => v.at <= now); if (!due.length) break;
      for (const [id,v] of due) { timers.delete(id); v.fn(); } await flush(); } },
  };
}
const sends = f => f.requests.filter(x => /\/v2\/users\//.test(x.url));

test('官方鉴权与网关仅内存持票，READY后才连接成功，心跳支持序号0及ACK', async t => {
  const f = fixture(t), socket = await f.start();
  assert.equal(f.statuses.at(-1).state, 'connecting');
  assert.equal(f.requests[0].url, 'https://api.bot.qq.com/app/getAppAccessToken');
  assert.deepEqual(JSON.parse(f.requests[0].init.body), {appId: '12345678', clientSecret: 'SYNTHETIC-SECRET'});
  assert.equal(f.requests[1].init.headers.Authorization, 'QQBot synthetic-access-token');
  socket.open(); socket.event({op: 10, d: {heartbeat_interval: 1000}});
  assert.deepEqual(socket.sent[0], {op: 2, d: {token: 'QQBot synthetic-access-token', intents: 1 << 25, shard: [0,1]}});
  assert.equal(f.statuses.at(-1).state, 'connecting');
  socket.event({op: 0, s: 0, t: 'READY', d: {session_id: 'synthetic-session'}});
  assert.equal(f.statuses.at(-1).state, 'connected');
  await f.advance(1000); assert.deepEqual(socket.sent.at(-1), {op: 1, d: 0});
  socket.event({op: 11}); await f.advance(1000); assert.equal(f.sockets.length, 1);
  assert.doesNotMatch(JSON.stringify(f.statuses), /SECRET|access-token/);
});
test('C2C只投递当前纯文本与用户OpenID，重复消息和群聊/引用/机器人均不执行', async t => {
  const f = fixture(t), socket = await f.ready();
  socket.event(incoming()); socket.event({...incoming(), s: 3});
  socket.event({...incoming('group'), t: 'GROUP_AT_MESSAGE_CREATE'});
  socket.event(incoming('bot', {author: {user_openid: 'synthetic-user', bot: true}}));
  socket.event(incoming('quote', {message_type: 103, content: 'quoted task'}));
  socket.event(incoming('long', {content: 'a'.repeat(9000)}));
  socket.event(incoming('bad-id', {author: {user_openid: '../escape'}}));
  await flush();
  assert.deepEqual(f.messages, [{id: 'synthetic-message', userId: 'synthetic-user', text: '/状态'}]);
});
test('已停止socket及旧鉴权回包不会恢复连接或投递命令', async t => {
  const f = fixture(t), socket = await f.ready(); f.transport.stop(); const count = f.statuses.length;
  socket.event(incoming('late')); socket.event({op: 0, s: 3, t: 'READY', d: {session_id: 'late'}});
  await f.advance(120000); assert.equal(f.messages.length, 0); assert.equal(f.statuses.length, count); assert.equal(f.timers.size, 0);
  const g = fixture(t); let release;
  g.setHandler(() => new Promise(resolve => {release = resolve;})); await g.transport.start(); await flush();
  g.transport.stop(); release(json({access_token: 'late-secret', expires_in: 7200})); await flush();
  assert.equal(g.sockets.length, 0); assert.equal(g.statuses.at(-1).state, 'stopped');
});
test('HTTP鉴权失败与WSS权限关闭明确报错且不循环重试，不泄漏平台错误正文', async t => {
  const f = fixture(t);
  f.setHandler(async () => json({code: 11244, message: 'SYNTHETIC-SECRET token'}, 401));
  await f.start(); assert.equal(f.statuses.at(-1).state, 'error'); await f.advance(120000); assert.equal(f.requests.length, 1);
  assert.doesNotMatch(JSON.stringify(f.statuses), /SYNTHETIC|token/);
  for (const code of [4014,4914,4915]) { const g=fixture(t), socket=await g.ready(); socket.close(code);
    assert.equal(g.statuses.at(-1).state, 'error'); assert.match(g.statuses.at(-1).code, new RegExp(String(code)));
    await g.advance(120000); assert.equal(g.sockets.length, 1); }
});
test('op7重连用session和最近序号恢复，补发重复事件不会重复提交任务', async t => {
  const f=fixture(t), first=await f.ready(); first.event(incoming()); await flush(); first.event({op:7});
  await f.advance(1000); const next=f.sockets.at(-1); assert.notEqual(next,first); next.open(); next.event({op:10,d:{heartbeat_interval:1000}});
  assert.deepEqual(next.sent[0],{op:6,d:{token:'QQBot synthetic-access-token',session_id:'synthetic-session',seq:2}});
  next.event({...incoming(),s:3}); next.event({op:0,t:'RESUMED',s:4,d:''}); await flush();
  assert.equal(f.messages.length,1); assert.equal(f.statuses.at(-1).state,'connected');
});
test('无效session重新Identify，丢ACK或握手超时会重连', async t => {
  const f=fixture(t), first=await f.ready(); first.event({op:9,d:false}); await f.advance(3000);
  const next=f.sockets.at(-1); next.open(); next.event({op:10,d:{heartbeat_interval:1000}});
  assert.equal(next.sent[0].op,2); next.event({op:0,t:'READY',s:1,d:{session_id:'next-session'}});
  await f.advance(1000); await f.advance(1000); assert.equal(f.statuses.at(-1).state,'error');
  await f.advance(1000); assert.ok(f.sockets.length>=3);
  const g=fixture(t); await g.start(); await g.advance(30000); assert.equal(g.statuses.at(-1).state,'error');
});
test('被动回复按Unicode完整分片及递增seq，同入站消息四次上限提前拒绝', async t => {
  const f=fixture(t); await f.ready(); const text='🙂'.repeat(4500);
  const result=await f.transport.send({userId:'synthetic-user',text,msgId:'synthetic-message'});
  assert.equal(result.sentCount,3); assert.equal(result.nextSeq,4);
  const parts=sends(f).map(x=>JSON.parse(x.init.body));
  assert.deepEqual(parts.map(x=>x.msg_seq),[1,2,3]); assert.ok(parts.every(x=>x.msg_id==='synthetic-message'&&x.msg_type===0));
  assert.equal(parts.map(x=>x.content).join(''),text); assert.ok(parts.every(x=>[...x.content].length<=2000));
  await assert.rejects(f.transport.send({userId:'synthetic-user',text:'a'.repeat(4001),msgId:'synthetic-message'}),error=>error.code==='qq_reply_limit');
  assert.equal(sends(f).length,3);
  await f.transport.send({userId:'synthetic-user',text:'last',msgId:'synthetic-message'}); assert.equal(sends(f).length,4);
});
test('每用户队列保持顺序与seq，其它用户不被慢请求堵住', async t => {
  const f=fixture(t); await f.ready(); let release;
  f.setHandler(async (url,init)=>JSON.parse(init.body).content==='first'?new Promise(resolve=>{release=resolve;}):json({id:'ok'}));
  const first=f.transport.send({userId:'synthetic-user',text:'first',msgId:'msg'});
  const second=f.transport.send({userId:'synthetic-user',text:'second',msgId:'msg'});
  const other=f.transport.send({userId:'synthetic-other',text:'other',msgId:'other-msg'});
  await flush(); assert.deepEqual(sends(f).map(x=>JSON.parse(x.init.body).content),['first','other']);
  await other; release(json({id:'first'})); await Promise.all([first,second]);
  assert.deepEqual(sends(f).filter(x=>x.url.includes('/synthetic-user/')).map(x=>JSON.parse(x.init.body).msg_seq),[1,2]);
  await assert.rejects(f.transport.send({userId:'synthetic-user',text:'duplicate',msgId:'msg',seq:2}),error=>error.code==='qq_sequence_used');
});
test('POST网络结果不明不自动重发，剩余文本与失败序号返回调用方保存', async t => {
  const f=fixture(t); await f.ready();
  f.setHandler(async()=>{throw Error('SYNTHETIC-SECRET network');});
  await assert.rejects(f.transport.send({userId:'synthetic-user',text:'retain this result',msgId:'msg'}),error=>{
    assert.equal(error.code,'qq_network_error'); assert.equal(error.deliveryUnknown,true); assert.equal(error.sentCount,0);
    assert.equal(error.unsentText,'retain this result'); assert.equal(error.failedSeq,1); assert.doesNotMatch(error.message,/SECRET/); return true;
  });
  await f.advance(60000); assert.equal(sends(f).length,1);
});
test('平台被动过期/主动拒收按真实错误失败，禁止静默换主动消息', async t => {
  const f=fixture(t); await f.ready(); f.setHandler(async()=>json({code:40034005,message:'SYNTHETIC-SECRET expired'},400));
  await assert.rejects(f.transport.send({userId:'synthetic-user',text:'result',msgId:'expired'}),error=>error.code==='qq_api_40034005'&&!error.deliveryUnknown);
  assert.equal(sends(f).length,1); assert.equal(JSON.parse(sends(f)[0].init.body).msg_id,'expired');
  f.setHandler(async()=>json({code:40054013,message:'refused'},400));
  await assert.rejects(f.transport.send({userId:'synthetic-user',text:'explicit proactive'}),error=>error.code==='qq_api_40054013');
  assert.equal('msg_id' in JSON.parse(sends(f)[1].init.body),false);
});
test('stop中止在途和排队发送，重启也不会让旧队列继续发信', async t => {
  const f=fixture(t); await f.ready(); let release;
  f.setHandler(async()=>new Promise(resolve=>{release=resolve;}));
  const first=f.transport.send({userId:'synthetic-user',text:'first',msgId:'msg'}).catch(e=>e);
  const second=f.transport.send({userId:'synthetic-user',text:'second',msgId:'msg'}).catch(e=>e);
  await flush(); f.transport.stop(); assert.equal(sends(f)[0].init.signal.aborted,true);
  release(json({id:'late'})); assert.equal((await first).code,'qq_stopped'); assert.equal((await second).code,'qq_stopped');
  assert.equal(sends(f).length,1);
});
test('令牌接近过期时并发发送合并刷新且新请求用新票据', async t => {
  const f=fixture(t); await f.ready(); f.setTime(1_000_000+7_150_000);
  let tokens=0; f.setHandler(async url=>url.endsWith('/app/getAppAccessToken')?(tokens++,json({access_token:'fresh-token',expires_in:7200})):json({id:'sent'}));
  await Promise.all(['one','two'].map(userId=>f.transport.send({userId,text:'result',msgId:'msg-'+userId})));
  assert.equal(tokens,1); assert.ok(sends(f).every(x=>x.init.headers.Authorization==='QQBot fresh-token'));
});
test('发送前校验长度/目标/序号与连接，非法请求不会产生外呼', async t => {
  const f=fixture(t);
  await assert.rejects(f.transport.send({userId:'synthetic-user',text:'not connected'}),error=>error.code==='qq_not_connected');
  await f.ready(); const count=f.requests.length;
  for(const args of [{userId:'../target',text:'x'},{userId:'synthetic-user',text:' '},{userId:'synthetic-user',text:'a'.repeat(8001)},{userId:'synthetic-user',text:'x',seq:0}])
    await assert.rejects(f.transport.send(args),error=>error.code==='qq_invalid_send');
  assert.equal(f.requests.length,count);
});

test('停止后异步业务回调和HTTP回包不得把stopped改回error', async t => {
  let rejectHandler; const f=fixture(t,{onMessage:()=>new Promise((_resolve,reject)=>{rejectHandler=reject;})});
  const socket=await f.ready(); socket.event(incoming()); await flush(); f.transport.stop();
  rejectHandler(Error('private detail')); await flush(); assert.equal(f.statuses.at(-1).state,'stopped');
  const g=fixture(t); await g.ready(); let release;
  g.setHandler(()=>new Promise(resolve=>{release=resolve;}));
  const pending=g.transport.send({userId:'synthetic-user',text:'result',msgId:'msg'}).catch(e=>e);
  await flush(); g.transport.stop(); release(json({id:'late'})); await pending;
  assert.equal(g.statuses.at(-1).state,'stopped');
});
test('纯文本HTTP权限错误明确停止，网关外域被拒且凭据请求不允许重定向', async t => {
  const f=fixture(t); f.setHandler(async()=>new Response('private secret html',{status:403})); await f.start();
  await f.advance(120000); assert.equal(f.requests.length,1); assert.equal(f.statuses.at(-1).code,'qq_http_403');
  const g=fixture(t); g.setHandler(async url=>url.endsWith('/app/getAppAccessToken')?json({access_token:'test-token',expires_in:7200}):json({url:'wss://example.com/trap'}));
  await g.start(); assert.equal(g.sockets.length,0); assert.equal(g.statuses.at(-1).code,'qq_gateway_url_invalid');
  assert.ok(g.requests.every(x=>x.init.redirect==='error'));
});
test('队列使用校验时的消息快照，修改原对象不能换收件人或正文', async t => {
  const f=fixture(t); await f.ready();
  const input={userId:'synthetic-user',text:'safe original',msgId:'msg'};
  const pending=f.transport.send(input); input.text='changed'; input.userId='unapproved-target'; await pending;
  assert.equal(sends(f)[0].url,'https://api.bot.qq.com/v2/users/synthetic-user/messages');
  assert.equal(JSON.parse(sends(f)[0].init.body).content,'safe original');
  await assert.rejects(f.transport.send({userId:123,text:'x'}),error=>error.code==='qq_invalid_send');
});

test('HTTP200中的永久凭据业务错误停止，限频错误至少退避一分钟', async t => {
  for(const code of [100007,100016,10004]){
    const f=fixture(t);f.setHandler(async()=>json({code,message:'SYNTHETIC-SECRET'}));await f.start();await f.advance(120000);
    assert.equal(f.requests.length,1);assert.equal(f.statuses.at(-1).code,'qq_api_'+code);
  }
  const g=fixture(t);g.setHandler(async()=>json({code:100001,message:'Too many requests'}));await g.start();
  await g.advance(59000);assert.equal(g.requests.length,1);await g.advance(1000);assert.equal(g.requests.length,2);
});
test('部分分片已发送后只报告未发送部分和失败序号，不重发已成功片段', async t => {
  const f=fixture(t);await f.ready();let count=0;
  f.setHandler(async()=>++count===1?json({id:'sent-first'}):new Response('unknown upstream failure',{status:503}));
  await assert.rejects(f.transport.send({userId:'synthetic-user',text:'a'.repeat(4500),msgId:'msg'}),error=>{
    assert.equal(error.sentCount,1);assert.equal(error.failedSeq,2);assert.equal(error.unsentText,'a'.repeat(2500));
    assert.equal(error.deliveryUnknown,true);return true;
  });
  assert.equal(sends(f).length,2);
});
test('明确主动发送按单用户频控等待，停止时取消等待且不发送排队片段', async t => {
  const f=fixture(t);await f.ready();await f.transport.send({userId:'synthetic-user',text:'first'});
  const next=f.transport.send({userId:'synthetic-user',text:'second'}).catch(e=>e);
  await flush();assert.equal(sends(f).length,1);await f.advance(3000);assert.equal(sends(f).length,1);
  await f.advance(100);assert.equal((await next).sentCount,1);
  const last=f.transport.send({userId:'synthetic-user',text:'cancelled'}).catch(e=>e);
  await flush();f.transport.stop();assert.equal((await last).code,'qq_stopped');assert.equal(sends(f).length,2);
});

test('发信401不重放POST但废弃旧票，下一次明确发送重新鉴权', async t => {
  const f=fixture(t);await f.ready();let first=true,refreshes=0;
  f.setHandler(async url=>url.endsWith('/app/getAppAccessToken')?(refreshes++,json({access_token:'new-token',expires_in:7200}))
    :first?(first=false,json({code:11244},401)):json({id:'sent'}));
  await assert.rejects(f.transport.send({userId:'synthetic-user',text:'first',msgId:'msg'}),error=>error.code==='qq_api_11244');
  assert.equal(sends(f).length,1);assert.equal(refreshes,0);
  await f.transport.send({userId:'synthetic-user',text:'explicit retry',msgId:'msg'});
  assert.equal(refreshes,1);assert.equal(sends(f).at(-1).init.headers.Authorization,'QQBot new-token');
});

test('停止后新一轮连接不被旧的未完成业务回调阻塞', async t => {
  let release,first=true;const f=fixture(t,{onMessage:()=>first?(first=false,new Promise(resolve=>{release=resolve;})):undefined});
  const old=await f.ready();old.event(incoming('old'));await flush();f.transport.stop();
  try{const current=await f.ready();current.event(incoming('new'));await flush();
    assert.equal(f.statuses.at(-1).state,'connected');assert.deepEqual(f.messages.map(x=>x.id),['old','new']);}
  finally{release();await flush();}
});
