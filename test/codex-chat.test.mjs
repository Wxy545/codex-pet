import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
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

const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a4649460001ffd9', 'hex');
const WEBP = Buffer.from('524946460400000057454250', 'hex');
const imagePart = (bytes = PNG, type = 'png') => ({ type: 'image_url', image_url: { url: `data:image/${type};base64,${bytes.toString('base64')}` } });
const imageBody = (parts = [imagePart()], extra = {}) => ({ messages: [{ role: 'user', content: [{ type: 'text', text: '看看这张图。' }, ...parts] }], ...extra });
const imagePaths = call => call.args.flatMap((argument, index) => argument === '--image' ? [call.args[index + 1]] : []);

async function waitFor(check) {
  const deadline = Date.now() + 1500;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('等待异步图片准备或清理超时');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('exports a body limit that fits four images with at most twelve MiB of decoded bytes', () => {
  assert.equal(MAX_CHAT_BODY_BYTES, 17 * 1024 * 1024);
});

test('PNG JPEG and WebP data URLs become private --image files without entering the prompt', async () => {
  const r = rig(); const run = r.start(imageBody([imagePart(PNG), imagePart(JPEG, 'jpeg'), imagePart(WEBP, 'webp')]));
  await waitFor(() => run.child);
  const call = r.calls[0]; const paths = imagePaths(call);
  assert.equal(paths.length, 3);
  for (let index = 0; index < paths.length; index++) {
    assert.ok(isAbsolute(paths[index]));
    assert.deepEqual(readFileSync(paths[index]), [PNG, JPEG, WEBP][index]);
    assert.equal(dirname(paths[index]), dirname(paths[0]));
    assert.ok(!run.child.input.includes(paths[index]));
  }
  assert.doesNotMatch(run.child.input, /data:image|base64/);
  assert.match(run.child.input, /用户图片 1/); assert.match(run.child.input, /用户图片 3/);
  assert.equal(call.options.shell, false); assert.ok(call.args.includes('read-only'));
  for (const feature of ['shell_tool', 'unified_exec', 'apps', 'hooks', 'view_image', 'browser_use', 'computer_use']) {
    assert.ok(call.args.some((argument, index) => argument === '--disable' && call.args[index + 1] === feature));
  }
  r.complete(run.child, '图片里是一条鱼。'); await run.pending;
  assert.equal(JSON.parse(run.res.data).choices[0].message.content, '图片里是一条鱼。');
  assert.equal(existsSync(dirname(paths[0])), false);
  assert.ok(!run.res.data.includes(dirname(paths[0])));
});

test('image requests retain the completion SSE contract and each request gets a unique directory', async () => {
  const r = rig(); const first = r.start(imageBody([], {}));
  r.complete(first.child); await first.pending;
  const second = r.start(imageBody(undefined, { stream: true })); await waitFor(() => second.child);
  const firstDirectory = dirname(imagePaths(r.calls.at(-1))[0]);
  r.complete(second.child, '看到了。'); await second.pending;
  assert.match(second.res.headers['content-type'], /text\/event-stream/);
  assert.match(second.res.data, /看到了/); assert.match(second.res.data, /data: \[DONE\]/);
  const third = r.start(imageBody()); await waitFor(() => third.child);
  const secondDirectory = dirname(imagePaths(r.calls.at(-1))[0]);
  assert.notEqual(firstDirectory, secondDirectory);
  r.complete(third.child); await third.pending;
  assert.equal(existsSync(firstDirectory), false); assert.equal(existsSync(secondDirectory), false);
});

test('temporary image paths are hidden even when CLI assistant text includes them', async () => {
  const r = rig(); const run = r.start(imageBody()); await waitFor(() => run.child);
  const path = imagePaths(r.calls[0])[0]; const directory = dirname(path);
  r.complete(run.child, `附件 ${path}，再次引用 ${path.replaceAll('\\', '/')}，目录 ${directory}。`); await run.pending;
  assert.doesNotMatch(run.res.data, /codex-pet-chat-/);
  assert.match(JSON.parse(run.res.data).choices[0].message.content, /用户图片 1/);
  assert.equal(existsSync(directory), false);
});

test('image-only user messages are accepted and old attachments trimmed from history are not written', async () => {
  const r = rig();
  const messages = [{ role: 'user', content: [imagePart(JPEG, 'jpeg')] },
    ...Array.from({ length: 14 }, (_, index) => ({ role: index % 2 ? 'user' : 'assistant', content: `历史${index}` })),
    { role: 'user', content: [imagePart(PNG)] }];
  const run = r.start({ messages }); await waitFor(() => run.child);
  const paths = imagePaths(r.calls[0]); assert.equal(paths.length, 1); assert.deepEqual(readFileSync(paths[0]), PNG);
  assert.match(run.child.input, /用户图片 1/); assert.doesNotMatch(run.child.input, /用户图片 2/);
  r.complete(run.child); await run.pending; assert.equal(existsSync(dirname(paths[0])), false);
});

test('remote URLs local paths wrong roles unsupported types and malformed base64 never spawn', async () => {
  const highBitWebp = Buffer.from(WEBP); highBitWebp[0] |= 0x80;
  const invalidParts = [
    { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
    { type: 'image_url', image_url: { url: 'file:///C:/private/image.png' } },
    { type: 'image_url', image_url: { url: 'C:/private/image.png' } },
    { type: 'input_image', image_url: { url: 'data:image/png;base64,' + PNG.toString('base64') } },
    { type: 'image_url', image_url: { url: 'data:image/gif;base64,R0lGODlh' } },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + PNG.toString('base64') + '\n' } },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA=AAA' } },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,a===' } },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' } },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + JPEG.toString('base64').replace(/=+$/, '') } },
    imagePart(PNG, 'jpeg'), imagePart(JPEG, 'webp'), imagePart(WEBP, 'png'), imagePart(highBitWebp, 'webp'),
  ];
  let acquisitions = 0;
  const r = rig({ activityGate: { acquire() { acquisitions++; return () => {}; } } });
  for (const part of invalidParts) {
    const run = r.start(imageBody([part])); await run.pending;
    assert.equal(run.res.statusCode, 400); assert.doesNotMatch(run.res.data, /private|example\.com/);
  }
  for (const role of ['system', 'developer', 'assistant']) {
    const run = r.start({ messages: [{ role, content: [imagePart()] }, { role: 'user', content: '你好' }] }); await run.pending;
    assert.equal(run.res.statusCode, 400);
  }
  assert.equal(r.calls.length, 0); assert.equal(acquisitions, 0);
});

test('image count per-image size and total decoded size are bounded before spawning', async () => {
  const r = rig();
  const paddedImage = size => { const bytes = Buffer.alloc(size); PNG.copy(bytes); return imagePart(bytes); };
  for (const parts of [Array.from({ length: 5 }, () => imagePart()), [paddedImage(5 * 1024 * 1024 + 1)], Array.from({ length: 3 }, () => paddedImage(4 * 1024 * 1024 + 1))]) {
    const run = r.start(imageBody(parts)); await run.pending; assert.equal(run.res.statusCode, 400);
  }
  assert.equal(r.calls.length, 0);
  const run = r.start(imageBody([paddedImage(5 * 1024 * 1024)])); await waitFor(() => run.child);
  assert.equal(readFileSync(imagePaths(r.calls[0])[0]).length, 5 * 1024 * 1024);
  r.complete(run.child); await run.pending;
  const maximumBody = imageBody(Array.from({ length: 4 }, () => paddedImage(3 * 1024 * 1024)));
  assert.ok(Buffer.byteLength(JSON.stringify(maximumBody)) < MAX_CHAT_BODY_BYTES);
  const maximum = r.start(maximumBody); await waitFor(() => maximum.child);
  assert.equal(imagePaths(r.calls.at(-1)).length, 4); r.complete(maximum.child); await maximum.pending;
});

test('image timeout holds files and both locks until the killed child closes', async () => {
  let occupied = false; let releases = 0;
  const gate = { acquire(owner) { assert.equal(owner, 'chat'); if (occupied) return null; occupied = true; return () => { occupied = false; releases++; }; } };
  const r = rig({ timeoutMs: 30, activityGate: gate }); const run = r.start(imageBody()); await waitFor(() => run.child);
  run.child.kill = () => { run.child.killed = true; return true; };
  const paths = imagePaths(r.calls[0]); await run.pending;
  assert.equal(run.res.statusCode, 504); assert.equal(occupied, true); assert.equal(releases, 0);
  assert.equal(existsSync(paths[0]), true); assert.ok(!run.res.data.includes(paths[0]));
  const blocked = r.start(); await blocked.pending; assert.equal(blocked.res.statusCode, 429);
  run.child.emit('close', null, 'SIGTERM'); await waitFor(() => !existsSync(dirname(paths[0])));
  assert.equal(occupied, false); assert.equal(releases, 1);
  const next = r.start(); r.complete(next.child); await next.pending; assert.equal(releases, 2);
});

test('image cancellation and handler disposal clean files after process close without a response', async () => {
  const r = rig();
  for (const dispose of [false, true]) {
    const run = r.start(imageBody()); await waitFor(() => run.child); const paths = imagePaths(r.calls.at(-1));
    if (dispose) r.handler.dispose(); else { run.req.aborted = true; run.req.emit('aborted'); }
    await run.pending; await waitFor(() => !existsSync(dirname(paths[0])));
    assert.equal(run.child.killed, true); assert.equal(run.res.data, '');
  }
});

test('cancelling during image preparation does not spawn and releases the gate', async () => {
  let releases = 0;
  const r = rig({ activityGate: { acquire: () => () => { releases++; } } });
  const run = r.start(imageBody()); run.req.aborted = true; run.req.emit('aborted'); await run.pending;
  assert.equal(r.calls.length, 0); assert.equal(run.res.data, ''); assert.equal(releases, 1);
  const next = r.start(); assert.ok(next.child); r.complete(next.child); await next.pending;
});

test('a synchronous spawn throw cleans prepared image files and releases the gate once', async () => {
  let releases = 0;
  const r = rig({ activityGate: { acquire: () => () => { releases++; } }, spawnImpl() { throw new Error('secret path'); } });
  const run = r.start(imageBody()); await run.pending;
  const paths = imagePaths(r.calls[0]);
  assert.equal(run.res.statusCode, 502); assert.equal(existsSync(dirname(paths[0])), false); assert.equal(releases, 1);
  assert.doesNotMatch(run.res.data, /secret/); assert.ok(!run.res.data.includes(dirname(paths[0])));
});

test('failed empty and unspawned-error image processes clean their temporary directories', async () => {
  const r = rig();
  for (const result of ['failed', 'empty', 'error']) {
    const run = r.start(imageBody()); await waitFor(() => run.child); const paths = imagePaths(r.calls.at(-1));
    if (result === 'error') run.child.emit('error', new Error('private diagnostic'));
    else run.child.emit('close', result === 'failed' ? 1 : 0);
    await run.pending; assert.equal(run.res.statusCode, 502); assert.equal(existsSync(dirname(paths[0])), false);
    assert.doesNotMatch(run.res.data, /private|codex-pet-chat-/);
  }
});

test('an occupied activity gate rejects chat before spawning and leaves the gate owner untouched', async () => {
  let acquisitions = 0;
  const r = rig({ activityGate: { acquire(owner) { assert.equal(owner, 'chat'); acquisitions++; return null; } } });
  const run = r.start(imageBody()); await run.pending;
  assert.equal(run.res.statusCode, 429); assert.equal(r.calls.length, 0); assert.equal(acquisitions, 1);
});

test('a child error with a process pid retains the gate until close while spawn failure releases it', async () => {
  let releases = 0;
  const r = rig({ activityGate: { acquire: () => () => { releases++; } } });
  const run = r.start(); run.child.pid = 12345; run.child.kill = () => true;
  run.child.emit('error', new Error('private child error')); await run.pending;
  assert.equal(run.res.statusCode, 502); assert.equal(releases, 0);
  const blocked = r.start(); await blocked.pending; assert.equal(blocked.res.statusCode, 429);
  run.child.emit('close', 1); assert.equal(releases, 1);
  const failedSpawn = r.start(); failedSpawn.child.emit('error', new Error('failed to spawn')); await failedSpawn.pending;
  assert.equal(releases, 2);
  failedSpawn.child.emit('close', 1); assert.equal(releases, 2);
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

test('images and invalid bodies fail before spawning; old history is bounded', async () => {
  const r = rig(); let run = r.start({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aaaa' } }] }] }); await run.pending;
  assert.equal(run.res.statusCode, 400); assert.equal(r.calls.length, 0);
  run = r.start({ messages: [] }); await run.pending; assert.equal(run.res.statusCode, 400);
  run = r.start({ messages: Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: 'history-' + i })) });
  r.complete(run.child); await run.pending;
  assert.doesNotMatch(run.child.input, /history-0"/); assert.match(run.child.input, /history-29/);
});
