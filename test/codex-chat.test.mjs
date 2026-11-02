import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createCodexChatHandler, MAX_CHAT_BODY_BYTES } from '../src/codex-chat.mjs';

class Response extends EventEmitter {
  statusCode = 200;
  headers = {};
  data = '';
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  setHeader(key, value) { this.headers[key.toLowerCase()] = value; }
  write(value) { this.headersSent = true; this.data += value; return true; }
  end(value = '') { this.write(value); this.writableEnded = true; }
}

function rig(options = {}) {
  const calls = [];
  const children = [];
  const handler = createCodexChatHandler({
    codexPath: 'C:/Program Files/Codex/codex.exe', cwd: 'C:/pet-chat',
    ...options,
    spawnImpl(file, args, spawnOptions) {
      calls.push({ file, args, options: spawnOptions });
      if (options.spawnImpl) return options.spawnImpl(file, args, spawnOptions);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.input = '';
      child.stdin = new Writable({ write(chunk, _encoding, done) { child.input += chunk; done(); } });
      child.killed = false;
      child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
      children.push(child);
      return child;
    },
  });
  const start = (body = { messages: [{ role: 'user', content: '王工今天加班吗' }] }) => {
    const req = new EventEmitter();
    const res = new Response();
    const childIndex = children.length;
    const pending = handler(req, res, body);
    return { req, res, pending, get child() { return children[childIndex]; } };
  };
  const complete = (child, text = '王工，歇会儿再继续。') => {
    const event = JSON.stringify({ type: 'item.completed', item: { id: 'a', type: 'agent_message', text } });
    // 故意跨块切开JSONL，验证不是按网络块解析JSON。
    child.stdout.write(event.slice(0, 17));
    child.stdout.write(event.slice(17) + '\n' + JSON.stringify({ type: 'turn.completed', usage: {} }));
    child.emit('close', 0, null);
  };
  return { handler, calls, children, start, complete };
}

test('returns final assistant text without a shell and keeps persona inside bounded input', async () => {
  const r = rig();
  const run = r.start({ messages: [{ role: 'system', content: '你是傲娇的大肥鱼。' }, { role: 'user', content: '$(whoami); `echo secret`' }] });
  r.complete(run.child);
  await run.pending;
  assert.equal(run.res.statusCode, 200);
  assert.equal(JSON.parse(run.res.data).choices[0].message.content, '王工，歇会儿再继续。');
  const call = r.calls[0];
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.ok(call.options.env && call.options.env !== process.env);
  assert.equal(Object.keys(call.options.env).some(key => /^(CODEX_PET_|DSH_PET_|DSH_HOME$)/i.test(key)), false);
  assert.equal(call.options.cwd, 'C:/pet-chat');
  assert.ok(call.args.includes('--ephemeral'));
  assert.ok(call.args.includes('--ignore-user-config'));
  assert.ok(call.args.includes('read-only'));
  assert.ok(call.args.includes('pet-chat'));
  assert.ok(!call.args.some(arg => arg.includes('whoami')));
  assert.match(run.child.input, /傲娇的大肥鱼/);
  assert.match(run.child.input, /\$\(whoami\)/);
  const rules=JSON.parse(call.args.find(arg=>arg.startsWith('developer_instructions=')).slice('developer_instructions='.length));
  assert.match(rules,/Do not run code|不执行代码/);
  assert.match(rules,/Blue|大肥鱼/);
});

test('服务器当前身份和系统语言高于历史人设，切换角色后丢弃在途旧回复',async()=>{
 let identity={id:'white-dragon',locale:'en',persona:'You are White Dragon Girl. Speak English.'};
 const r=rig({characterProvider:()=>identity});
 const run=r.start({messages:[{role:'system',content:'你是蓝色大肥鱼，只说中文。'},{role:'assistant',content:'我是鱼。'},{role:'user',content:'Hello'}]});
 const rules=JSON.parse(r.calls[0].args.find(arg=>arg.startsWith('developer_instructions=')).slice('developer_instructions='.length));
 assert.match(rules,/Reply briefly in English/);assert.match(rules,/White Dragon Girl/);assert.doesNotMatch(rules,/你是蓝色大肥鱼/);
 assert.match(run.child.input,/蓝色大肥鱼/);
 identity={id:'bluefish',locale:'en',persona:'You are Bluefish.'};r.complete(run.child,'Old dragon reply');await run.pending;
 assert.equal(run.res.statusCode,409);assert.equal(JSON.parse(run.res.data).error.code,'character_changed');assert.doesNotMatch(run.res.data,/Old dragon/);
 const next=r.start();r.complete(next.child,'Hello');await next.pending;assert.equal(next.res.statusCode,200);
});

test('legacy unphased plan and final messages return only the last eligible answer for JSON and SSE', async () => {
  for (const stream of [false, true]) {
    const r = rig();
    const run = r.start({ messages: [{ role: 'user', content: '你好' }], stream });
    const emit = item => run.child.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', ...item } }) + '\n');
    emit({ id: 'plan', text: '我会先想一想。' });
    emit({ id: 'final', text: '王工，下午好。' });
    emit({ id: 'analysis', phase: 'analysis', text: 'PRIVATE_REASONING' });
    emit({ id: 'commentary', channel: 'commentary', text: 'PRIVATE_COMMENTARY' });
    emit({ id: 'empty', text: '  ' });
    assert.equal(run.res.data, '');
    run.child.emit('close', 0);
    await run.pending;
    if (stream) {
      const chunks = run.res.data.split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice(6)));
      assert.equal(chunks.map(chunk => chunk.choices[0].delta.content ?? '').join(''), '王工，下午好。');
      assert.match(run.res.data, /data: \[DONE\]/);
    } else assert.equal(JSON.parse(run.res.data).choices[0].message.content, '王工，下午好。');
    assert.doesNotMatch(run.res.data, /我会先|PRIVATE_/);
  }
});

test('exports a text-only body limit', () => {
  assert.equal(MAX_CHAT_BODY_BYTES, 256 * 1024);
});

test('SSE emits compatible assistant delta, stop and DONE only for final answer', async () => {
  const r = rig(); const run = r.start({ stream: true, messages: [{ role: 'user', content: '你好' }] });
  run.child.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'private reasoning' } }) + '\n');
  r.complete(run.child, '你好，王工！'); await run.pending;
  assert.equal(run.res.headers['content-type'], 'text/event-stream; charset=utf-8');
  const values = run.res.data.split('\n\n').filter(Boolean).map(line => line.slice(6));
  assert.equal(values.at(-1), '[DONE]');
  const events = values.slice(0, -1).map(JSON.parse);
  assert.equal(events[0].choices[0].delta.role, 'assistant');
  assert.equal(events.map(e => e.choices[0].delta.content ?? '').join(''), '你好，王工！');
  assert.equal(events.at(-1).choices[0].finish_reason, 'stop');
  assert.doesNotMatch(run.res.data, /private reasoning/);
});

test('one active child returns 429 and lock clears after close', async () => {
  const r = rig(); const first = r.start(); const second = r.start(); await second.pending;
  assert.equal(second.res.statusCode, 429); assert.equal(r.calls.length, 1);
  r.complete(first.child); await first.pending;
  const third = r.start(); assert.equal(r.calls.length, 2); r.complete(third.child); await third.pending;
});

test('failure and empty output expose short fixed errors rather than stderr', async () => {
  const r = rig(); let run = r.start();
  run.child.stderr.write('SECRET_TOKEN and C:/private/user/data');
  run.child.emit('close', 1, null); await run.pending;
  assert.equal(run.res.statusCode, 502); assert.doesNotMatch(run.res.data, /SECRET|private/);
  run = r.start(); run.child.emit('close', 0, null); await run.pending;
  assert.equal(run.res.statusCode, 502); assert.equal(JSON.parse(run.res.data).error.code, 'empty_reply');
});

test('timeout kills its own child and returns 504', async () => {
  const r = rig({ timeoutMs: 15 }); const run = r.start(); await run.pending;
  assert.equal(run.child.killed, true); assert.equal(run.res.statusCode, 504);
  assert.equal(JSON.parse(run.res.data).error.code, 'timeout');
});

test('timeout keeps the single-process lock until the killed process actually closes', async () => {
  const r = rig({ timeoutMs: 10 }); const first = r.start();
  first.child.kill = () => { first.child.killed = true; return true; };
  await first.pending;
  const blocked = r.start(); await blocked.pending;
  assert.equal(blocked.res.statusCode, 429); assert.equal(r.calls.length, 1);
  first.child.emit('close', null, 'SIGTERM');
  const next = r.start(); r.complete(next.child); await next.pending;
  assert.equal(next.res.statusCode, 200);
});

test('UTF-8 bytes split inside a Chinese character are preserved', async () => {
  const r = rig(); const run = r.start();
  const bytes = Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '王工你好' } }) + '\n');
  const split = bytes.indexOf(Buffer.from('王')) + 1;
  run.child.stdout.write(bytes.subarray(0, split));
  run.child.stdout.write(bytes.subarray(split));
  run.child.emit('close', 0, null); await run.pending;
  assert.equal(JSON.parse(run.res.data).choices[0].message.content, '王工你好');
});

test('client cancellation kills its child and does not write a response', async () => {
  const r = rig(); const run = r.start(); run.req.aborted = true; run.req.emit('aborted'); await run.pending;
  assert.equal(run.child.killed, true); assert.equal(run.res.data, '');
  const next = r.start(); r.complete(next.child); await next.pending;
  assert.equal(next.res.statusCode, 200);
});

test('spawn errors and unexpected tool events do not leak details or allow tools', async () => {
  const r = rig(); let run = r.start(); run.child.emit('error', new Error('secret spawn diagnostic')); await run.pending;
  assert.equal(run.res.statusCode, 502); assert.doesNotMatch(run.res.data, /secret/);
  run = r.start(); run.child.stdout.write(JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'whoami' } }) + '\n'); await run.pending;
  assert.equal(run.child.killed, true); assert.equal(JSON.parse(run.res.data).error.code, 'tools_disabled');
});

test('images and invalid bodies fail before spawning; text history is bounded', async () => {
  const r = rig(); let run = r.start({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aaaa' } }] }] }); await run.pending;
  assert.equal(run.res.statusCode, 400); assert.equal(JSON.parse(run.res.data).error.code, 'invalid_input'); assert.equal(r.calls.length, 0);
  run = r.start({ messages: [] }); await run.pending; assert.equal(run.res.statusCode, 400);
  run = r.start({ messages: Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: 'history-' + i })) });
  r.complete(run.child); await run.pending;
  assert.doesNotMatch(run.child.input, /history-0"/); assert.match(run.child.input, /history-29/);
});
