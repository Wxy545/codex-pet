// QQ 官方协议：api-use、event-emit/websocket、v2_users_user_openid_messages.post。
// 只收发 C2C 文本；审批、任务和结果持久化属于调用方，不把消息解释为命令行。
const API = 'https://api.bot.qq.com';
const INTENTS = 1 << 25;
const RETRY_MS = [1000, 2000, 5000, 10000, 30000, 60000];
const TERMINAL_CLOSES = new Set([4001,4002,4010,4011,4012,4013,4014,4914,4915]);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === 'string' && ID.test(value);
const referenceId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x20\x7f]/.test(value);
export const QQ_TEXT_CHUNK_CHARS = 2000;
export const QQ_MAX_TEXT_CHARS = 8000;
const MAX_TRACKED = 10000, TRACK_MS = 86400000;

export class QQTransportError extends Error {
  constructor(code, details = {}) { super(code); this.name = 'QQTransportError'; this.code = code; Object.assign(this, details); }
}
const failure = (code, details) => new QQTransportError(code, details);

/** token 仅驻内存；fetch/WebSocket/时钟替身只用于隔离测试，不读取环境或账号文件。 */
export function createQQTransport({appId, appSecret, onMessage = () => {}, onStatus = () => {},
  fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket, now = Date.now, timers = globalThis} = {}) {
  if (!validId(appId) || typeof appSecret !== 'string' || !appSecret.trim()
    || appSecret.length > 512 || /[\x00-\x1f\x7f]/.test(appSecret)
    || [onMessage,onStatus,fetchImpl,WebSocketImpl,now,timers.setTimeout,timers.clearTimeout].some(value => typeof value !== 'function'))
    throw failure('qq_invalid_options');
  let active = false, generation = 0, socket = null, connected = false, retry = 0;
  let heartbeatTimer = null, handshakeTimer = null, reconnectTimer = null, awaitingAck = false;
  let sessionId = null, sequence = null, token = null, tokenRequest = null;
  let dispatching = null, pendingSends = 0, nextProactiveAt = 0, proactiveQueue = Promise.resolve();
  const controllers = new Set(), delays = new Map(), incoming = [], seen = new Map(), replies = new Map(), sendQueues = new Map(), userSendAt = new Map();
  const alive = run => active && generation === run;
  function check(run) { if (!alive(run)) throw failure('qq_stopped'); }
  function status(state, code) { try { onStatus(code ? {state,code} : {state}); } catch { /* 展示失败不改变协议状态。 */ } }
  function later(callback, ms) { const timer = timers.setTimeout(callback, ms); timer?.unref?.(); return timer; }
  function clear(name) {
    const timer = name === 'heartbeat' ? heartbeatTimer : name === 'handshake' ? handshakeTimer : reconnectTimer;
    if (timer !== null) timers.clearTimeout(timer);
    if (name === 'heartbeat') heartbeatTimer = null; else if (name === 'handshake') handshakeTimer = null; else reconnectTimer = null;
  }
  function dropSocket() {
    const previous = socket; socket = null; connected = false; awaitingAck = false;
    clear('heartbeat'); clear('handshake');
    try { previous?.close(1000); } catch { /* 已断开的连接不再接收本轮事件。 */ }
  }
  function cancelNetwork() {
    for (const controller of controllers) controller.abort();
    for (const [timer,reject] of delays) { timers.clearTimeout(timer); reject(failure('qq_stopped')); }
    delays.clear();
  }
  function prune(map) {
    for (const [key,value] of map) if (now() - value.at >= TRACK_MS) map.delete(key);
  }
  function trackedReply(userId, msgId) {
    prune(replies);
    const key = userId + ':' + msgId;
    if (!replies.has(key)) {
      if (replies.size >= MAX_TRACKED) throw failure('qq_reply_tracking_full');
      replies.set(key, {at: now(), next: 1, attempts: 0});
    }
    return replies.get(key);
  }

  async function http(path, {method = 'GET', body, accessToken, run, stage} = {}) {
    check(run);
    const controller = new AbortController(); controllers.add(controller);
    const timeout = later(() => controller.abort(), 15000);
    let response, data;
    try {
      response = await fetchImpl(API + path, {method, headers: {'content-type':'application/json',
        ...(accessToken ? {Authorization: 'QQBot ' + accessToken} : {})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: controller.signal, redirect: 'error'});
      check(run);
      const raw = await response.text(); check(run);
      if (raw.length > 65536) throw failure('qq_response_invalid');
      try { data = JSON.parse(raw); } catch { data = null; }
      if (!response.ok || (typeof data?.code === 'number' && data.code !== 0)) {
        if (response.status === 401) token = null;
        const code = Number.isSafeInteger(data?.code) && data.code >= 0 ? 'qq_api_' + data.code : 'qq_http_' + response.status;
        throw failure(code, {httpStatus: response.status,
          terminal: (stage !== 'send' && [400,401,403].includes(response.status)) || (stage === 'token' && [100007,100016,10004].includes(data?.code)),
          ...(data?.code === 100001 || response.status === 429 ? {retryAfterMs:60000} : {}),
          deliveryUnknown: stage === 'send' && response.status >= 500});
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('qq_response_invalid');
      return data;
    } catch (error) {
      if (!alive(run)) throw failure('qq_stopped', {deliveryUnknown: stage === 'send'});
      if (error instanceof QQTransportError) {
        if (stage === 'send' && error.code === 'qq_response_invalid') error.deliveryUnknown = true;
        throw error;
      }
      throw failure(controller.signal.aborted ? 'qq_request_timeout' : 'qq_network_error', {deliveryUnknown: stage === 'send'});
    } finally { timers.clearTimeout(timeout); controllers.delete(controller); }
  }
  async function access(run) {
    check(run);
    if (token && now() < token.refreshAt) return token.value;
    if (tokenRequest) return tokenRequest;
    const pending = (async () => {
      const data = await http('/app/getAppAccessToken', {method:'POST', body:{appId,clientSecret:appSecret},run,stage:'token'});
      const ttl = Number(data.expires_in);
      if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 8192
        || /[\x00-\x20\x7f]/.test(data.access_token) || !Number.isFinite(ttl) || ttl <= 0 || ttl > 7200)
        throw failure('qq_token_response_invalid', {terminal:true});
      check(run);
      token = {value:data.access_token,refreshAt:now()+ttl*1000-Math.min(60000,ttl*1000/3)};
      return token.value;
    })();
    tokenRequest = pending;
    try { return await pending; } finally { if (tokenRequest === pending) tokenRequest = null; }
  }
  function disconnected(error, run, {reset = false, delay} = {}) {
    if (!alive(run)) return;
    dropSocket(); clear('reconnect');
    if (reset) { sessionId = null; sequence = null; }
    status('error', error.code);
    if (error.terminal) {
      active = false; generation++; token = null; tokenRequest = null; incoming.length = 0; cancelNetwork(); return;
    }
    const wait = delay ?? error.retryAfterMs ?? RETRY_MS[Math.min(retry++, RETRY_MS.length-1)];
    reconnectTimer = later(() => { reconnectTimer = null; void connect(run); }, wait);
  }
  function wire(ws, payload) {
    try { if (ws === socket && ws.readyState === 1) ws.send(JSON.stringify(payload)); else throw failure('qq_not_connected'); }
    catch { disconnected(failure('qq_socket_send_failed'), generation); }
  }
  function heartbeat(ws, run, interval) {
    heartbeatTimer = later(() => {
      heartbeatTimer = null;
      if (!alive(run) || ws !== socket) return;
      if (awaitingAck) { disconnected(failure('qq_heartbeat_timeout'), run); return; }
      awaitingAck = true; wire(ws, {op:1,d:sequence});
      if (ws === socket) heartbeat(ws, run, interval);
    }, interval);
  }
  function commit(payload, run) {
    if (alive(run) && Number.isSafeInteger(payload.s) && payload.s >= 0) sequence = Math.max(sequence ?? 0, payload.s);
  }
  async function dispatch(payload, run) {
    if (!alive(run)) return;
    if (payload.t === 'READY') {
      if (!referenceId(payload.d?.session_id)) { disconnected(failure('qq_ready_invalid'),run,{reset:true}); return; }
      sessionId = payload.d.session_id; connected = true; retry = 0; clear('handshake'); status('connected');
    } else if (payload.t === 'RESUMED') {
      connected = true; retry = 0; clear('handshake'); status('connected');
    } else if (payload.t === 'C2C_MESSAGE_CREATE') {
      const d = payload.d, userId = d?.author?.user_openid;
      // 不取引用正文/卡片/附件中的指令，C2C user_openid 不按 QQ 号或 union_openid 猜测。
      if (!referenceId(d?.id) || !validId(userId) || d.author.bot === true
        || (d.message_type !== undefined && d.message_type !== 0) || typeof d.content !== 'string'
        || !d.content.trim() || [...d.content].length > QQ_MAX_TEXT_CHARS) { commit(payload,run); return; }
      prune(seen);
      const index = Array.isArray(d.message_scene?.ext) ? d.message_scene.ext.find(x => typeof x === 'string' && x.startsWith('msg_idx=')) : null;
      const key = userId + ':' + (index || d.id + ':' + (Number.isSafeInteger(d.msg_seq) ? d.msg_seq : ''));
      if (!seen.has(key)) {
        if (seen.size >= MAX_TRACKED) { disconnected(failure('qq_dedup_capacity'),run); return; }
        seen.set(key,{at:now()});
        try { await onMessage({id:d.id,userId,text:d.content}); }
        catch { if (alive(run)) status('error','qq_message_handler_failed'); }
      }
    }
    commit(payload,run);
  }
  function enqueue(payload, run) {
    if (incoming.length >= 256) { disconnected(failure('qq_inbound_queue_full'),run); return; }
    incoming.push({payload,run});
    if (dispatching === run) return;
    dispatching = run;
    void (async () => {
      try { while (alive(run) && incoming.length) { const next = incoming.shift(); await dispatch(next.payload,next.run); } }
      finally { if (dispatching === run) dispatching = null; }
    })().catch(() => { if (alive(run)) status('error','qq_dispatch_failed'); });
  }
  function payload(ws, event, run, accessToken) {
    if (!alive(run) || ws !== socket) return;
    if (typeof event.data !== 'string' || event.data.length > 65536) { disconnected(failure('qq_frame_invalid'),run); return; }
    let value;
    try { value = JSON.parse(event.data); } catch { disconnected(failure('qq_frame_invalid'),run); return; }
    if (!value || typeof value !== 'object' || !Number.isInteger(value.op)) { disconnected(failure('qq_frame_invalid'),run); return; }
    if (value.op === 10) {
      const interval = value.d?.heartbeat_interval;
      if (!Number.isSafeInteger(interval) || interval < 100 || interval > 300000) { disconnected(failure('qq_heartbeat_invalid'),run); return; }
      clear('heartbeat'); awaitingAck = false;
      wire(ws,sessionId && sequence !== null ? {op:6,d:{token:'QQBot '+accessToken,session_id:sessionId,seq:sequence}}
        : {op:2,d:{token:'QQBot '+accessToken,intents:INTENTS,shard:[0,1]}});
      if (ws === socket) heartbeat(ws,run,interval);
    } else if (value.op === 11) awaitingAck = false;
    else if (value.op === 1) { awaitingAck = true; wire(ws,{op:1,d:sequence}); }
    else if (value.op === 7) disconnected(failure('qq_gateway_reconnect'),run);
    else if (value.op === 9) disconnected(failure('qq_session_invalid'),run,{reset:value.d !== true,delay:3000});
    else if (value.op === 0) enqueue(value,run);
  }
  async function connect(run) {
    if (!alive(run)) return;
    status('connecting');
    try {
      const value = await access(run), gateway = await http('/gateway',{accessToken:value,run,stage:'gateway'}); check(run);
      let url;
      try { url = new URL(gateway.url); } catch { throw failure('qq_gateway_url_invalid',{terminal:true}); }
      if (url.protocol !== 'wss:' || !['api.bot.qq.com','api.sgroup.qq.com'].includes(url.hostname)
        || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw failure('qq_gateway_url_invalid',{terminal:true});
      const ws = new WebSocketImpl(url.href); socket = ws;
      handshakeTimer = later(() => disconnected(failure('qq_handshake_timeout'),run),30000);
      ws.addEventListener('message',event=>payload(ws,event,run,value));
      ws.addEventListener('error',()=>{if(alive(run)&&ws===socket)disconnected(failure('qq_socket_error'),run);});
      ws.addEventListener('close',event=>{
        if (!alive(run)||ws!==socket)return;
        const code = Number.isInteger(event.code) ? event.code : 1006;
        if (code===4004) token=null;
        const reset = [4004,4006,4007].includes(code)||(code>=4900&&code<=4913);
        disconnected(failure('qq_gateway_close_'+code,{terminal:TERMINAL_CLOSES.has(code)}),run,{reset,delay:code===4008?60000:undefined});
      });
    } catch (error) {
      if (alive(run)) disconnected(error instanceof QQTransportError ? error : failure('qq_connect_failed'),run);
    }
  }
  async function start() {
    if (active) return;
    active = true; generation++; retry = 0; sessionId = null; sequence = null;
    void connect(generation);
  }
  function stop() {
    active = false; generation++; dropSocket(); clear('reconnect'); cancelNetwork();
    token = null; tokenRequest = null; sessionId = null; sequence = null; incoming.length = 0;
    status('stopped');
  }
  function pause(ms, run) {
    if (ms <= 0) { check(run); return Promise.resolve(); }
    return new Promise((resolve,reject)=>{
      const timer = timers.setTimeout(()=>{delays.delete(timer);try{check(run);resolve();}catch(error){reject(error);}},ms);
      delays.set(timer,reject);
    });
  }
  async function proactiveSlot(userId, run) {
    const previous = proactiveQueue;
    const next = previous.catch(()=>{}).then(async()=>{
      check(run); await pause(Math.max(0,nextProactiveAt-now(),(userSendAt.get(userId)??0)-now()),run); check(run);
      // 按未认证机器人更低的主动频控留余量；被动回复不借此消耗主动配额。
      nextProactiveAt = now()+2100; userSendAt.set(userId,now()+3100);
    });
    proactiveQueue = next.catch(()=>{}); await next;
    if (userSendAt.size > 256) for (const [key,at] of userSendAt) if (at < now()) userSendAt.delete(key);
  }
  async function sendBatch({userId,text,msgId,seq}, run) {
    check(run); if (!connected) throw failure('qq_not_connected');
    const chars = [...text], chunks = [];
    for (let i=0;i<chars.length;i+=QQ_TEXT_CHUNK_CHARS) chunks.push(chars.slice(i,i+QQ_TEXT_CHUNK_CHARS).join(''));
    const record = msgId ? trackedReply(userId,msgId) : null;
    const startSeq = seq ?? record?.next ?? 1;
    if (record && startSeq < record.next) throw failure('qq_sequence_used');
    if (record && record.attempts+chunks.length>4) throw failure('qq_reply_limit');
    const messageIds = [];
    for (let i=0;i<chunks.length;i++) {
      const current = startSeq+i;
      try {
        check(run); if (!connected) throw failure('qq_not_connected');
        if (!msgId) await proactiveSlot(userId,run);
        const value = await access(run); check(run); if (!connected) throw failure('qq_not_connected');
        // 在外呼前预留序号：超时或断网不能证明平台没收到，不自动重发、更不改为主动。
        if (record) {record.next=current+1;record.attempts++;}
        const data = await http('/v2/users/'+encodeURIComponent(userId)+'/messages',{method:'POST',accessToken:value,run,stage:'send',
          body:{content:chunks[i],msg_type:0,msg_seq:current,...(msgId?{msg_id:msgId}:{})}});
        if (!referenceId(data.id)) throw failure('qq_response_invalid',{deliveryUnknown:true});
        messageIds.push(data.id);
      } catch (error) {
        const safe = error instanceof QQTransportError ? error : failure('qq_send_failed');
        Object.assign(safe,{sentCount:messageIds.length,failedSeq:current,unsentText:chunks.slice(i).join(''),deliveryUnknown:safe.deliveryUnknown===true});
        if (alive(run)) status('error',safe.code); throw safe;
      }
    }
    return {sentCount:messageIds.length,messageIds,nextSeq:startSeq+chunks.length};
  }
  async function send(input) {
    if (!active || !connected) throw failure('qq_not_connected');
    if (!input || !validId(input.userId) || typeof input.text !== 'string' || !input.text.trim()
      || input.text.length>QQ_MAX_TEXT_CHARS*2 || [...input.text].length>QQ_MAX_TEXT_CHARS || (input.msgId!==undefined&&!referenceId(input.msgId))
      || (input.seq!==undefined&&(!Number.isSafeInteger(input.seq)||input.seq<1||input.seq>2147483643))) throw failure('qq_invalid_send');
    const run=generation,userId=input.userId,previous=sendQueues.get(userId);
    const message={userId,text:input.text,msgId:input.msgId,seq:input.seq};
    if (pendingSends>=256 || (previous?.count??0)>=16 || (!previous&&sendQueues.size>=128)) throw failure('qq_send_queue_full');
    pendingSends++;
    const state={count:(previous?.count??0)+1,promise:null};
    const promise=(previous?.promise??Promise.resolve()).catch(()=>{}).then(()=>sendBatch(message,run));
    state.promise=promise;sendQueues.set(userId,state);
    try {return await promise;} finally {
      pendingSends--; const current=sendQueues.get(userId); if(current===state)sendQueues.delete(userId);else if(current)current.count--;
    }
  }
  return {start,stop,send};
}
