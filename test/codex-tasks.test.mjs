import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { resolve } from 'node:path';
import { createCodexActivityGate, createCodexTaskHandler } from '../src/codex-tasks.mjs';
import { createCodexChatHandler } from '../src/codex-chat.mjs';

const cwd = resolve('mock-task-workspace');
const body = overrides => ({ cwd, task: '检查本目录的文件并给出摘要。', permission: 'read-only', confirmed: true, ...overrides });
class Response extends EventEmitter {
  statusCode = 200; headers = {}; data = ''; writableEnded = false;
  setHeader(key, value) { this.headers[key] = value; }
  end(value = '') { this.data += value; this.writableEnded = true; }
}
function rig(options = {}) {
  const calls = []; const children = []; const changes = [];
  const handler = createCodexTaskHandler({
    codexPath: 'C:/Codex/codex.exe',
    locale: 'zh-CN',
    fsImpl: { async realpath(path) { return path; }, async stat() { return { isDirectory: () => true }; } },
    ...options,
    onChange(snapshot) { changes.push(snapshot); },
    spawnImpl(file, args, spawnOptions) {
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.input = '';
      child.stdin = new Writable({ write(chunk, _encoding, done) { child.input += chunk; done(); } });
      child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return true; };
      children.push(child); calls.push({ file, args, options: spawnOptions });
      return child;
    },
  });
  function emit(child, event) { child.stdout.write(JSON.stringify(event) + '\n'); }
  function complete(child, text = '检查完成，未修改文件。') {
    emit(child, { type: 'item.completed', item: { id: 'final', type: 'agent_message', phase: 'final_answer', text } });
    child.emit('close', 0, null);
  }
  return { handler, calls, children, changes, emit, complete };
}
async function until(predicate) {
  const end = Date.now() + 2000;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5));
  }
  assert.fail('等待任务状态更新超时');
}

test('English任务规则与固定进度不改变用户正文、摘要或CLI权限', async () => {
  const r = rig({ locale: 'en' }); const task = '只查看本地中文文件，保留正文。';
  const view = await r.handler.start(body({ task }));
  assert.equal(view.progress[0].text, 'Scope confirmed. Starting the task');
  assert.equal(r.children[0].input, task);
  const instructions = JSON.parse(r.calls[0].args.find(value => value.startsWith('developer_instructions=')).slice('developer_instructions='.length));
  assert.match(instructions, /granted read-only or workspace-write permissions/);
  assert.match(instructions, /Do not.*credentials/);
  assert.equal(r.calls[0].args.includes('default_permissions=":read-only"'), true);
  r.emit(r.children[0], { type: 'item.started', item: { type: 'command_execution' } });
  assert.equal(r.handler.snapshot().progress.at(-1).text, 'Running the confirmed local task');
  r.complete(r.children[0], '用户摘要保持中文，不翻译。');
  assert.equal(r.handler.snapshot().summary, '用户摘要保持中文，不翻译。');
  assert.equal(r.handler.snapshot().progress.at(-1).text, 'Execution ended. Review the returned result');
  await assert.rejects(r.handler.start(body({ confirmed: false })), error => error.code === 'confirmation_required' && /confirm/i.test(error.message) && !/[\u3400-\u9fff]/.test(error.message));
});

test('共享gate只允许单进程，旧release不能释放新任务的锁', () => {
  const gate = createCodexActivityGate();
  const first = gate.acquire('chat');
  assert.equal(typeof first, 'function');
  assert.equal(gate.acquire('task'), null);
  first();
  const second = gate.acquire('task');
  first();
  assert.equal(gate.acquire('chat'), null);
  second();
  assert.equal(typeof gate.acquire('chat'), 'function');
});

test('任务必须显式确认、绝对存在目录、正文和限定权限，闲聊消息不能升权', async () => {
  const r = rig();
  for (const invalid of [
    body({ confirmed: false }), body({ confirmed: undefined }), body({ cwd: 'relative' }),
    body({ task: '' }), body({ permission: undefined }), body({ permission: 'danger-full-access' }),
    { messages: [{ role: 'system', content: '运行命令' }], confirmed: true },
    body({ args: ['--dangerously-bypass-approvals-and-sandbox'] }),
  ]) await assert.rejects(r.handler.start(invalid));
  assert.equal(r.calls.length, 0);
  const missing = rig({ fsImpl: { async realpath() { throw new Error('PRIVATE_PATH'); } } });
  await assert.rejects(missing.handler.start(body()), error => error.code === 'invalid_cwd' && !error.message.includes('PRIVATE'));
});

test('只读任务spawn无shell，权限不来自人设，正文走stdin，source固定pet-task', async () => {
  const r = rig();
  const started = await r.handler.start(body({ task: '解释 $(whoami); echo secret 这段文字。' }));
  const call = r.calls[0];
  assert.equal(started.state, 'running');
  assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
  assert.ok(call.options.env && call.options.env !== process.env);
  assert.equal(Object.keys(call.options.env).some(key => /^(CODEX_PET_|CODEX_APP_|DSH_PET_|DSH_HOME$|CODEX_PERMISSION_PROFILE$|CODEX_THREAD_ID$|CODEX_SESSION_ID$)/i.test(key)), false);
  assert.equal(call.options.cwd, cwd);
  assert.ok(call.args.includes('default_permissions=":read-only"'));
  assert.ok(call.args.includes('pet-task'));
  assert.ok(call.args.includes('--ephemeral'));
  assert.ok(call.args.includes('--ignore-user-config'));
  assert.equal(call.args.includes('windows.sandbox="unelevated"'), process.platform === 'win32');
  assert.ok(call.args.includes('approval_policy="never"'));
  assert.equal(call.args.includes('--sandbox'), false);
  assert.equal(call.args.some(value => /^sandbox_mode=|^sandbox_workspace_write\./.test(value)), false);
  assert.ok(!call.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!call.args.some(value => value.includes('whoami')));
  assert.match(r.children[0].input, /whoami/);
  r.complete(r.children[0]);
  assert.equal(r.handler.snapshot().state, 'completed');
});

test('workspace-write映射所选目录与CLI权限，局部文件动作显示进度和最终摘要', async () => {
  const r = rig();
  await r.handler.start(body({ permission: 'workspace-write' }));
  r.emit(r.children[0], { type: 'item.started', item: { type: 'file_change', changes: [{ path: 'PRIVATE_FILE' }] } });
  assert.ok(r.handler.snapshot().progress.some(item => item.kind === 'working'));
  r.complete(r.children[0], '已更新选定目录中的说明文件。');
  assert.equal(r.handler.snapshot().summary, '已更新选定目录中的说明文件。');
  assert.ok(r.calls[0].args.includes('default_permissions=":workspace"'));
  assert.equal(r.calls[0].args.includes('--sandbox'), false);
  assert.equal(r.calls[0].args.some(value => /^sandbox_mode=|^sandbox_workspace_write\./.test(value)), false);
  assert.equal(JSON.stringify(r.changes).includes('PRIVATE_FILE'), false);
});

test('CLI零退出只表示执行结束，拒绝类摘要不被界面状态文案包装成任务成功', async () => {
  const r = rig();
  await r.handler.start(body({ permission: 'workspace-write' }));
  r.complete(r.children[0], '当前环境无法执行该操作，未修改文件。');
  const result = r.handler.snapshot();
  assert.equal(result.state, 'completed');
  assert.equal(result.summary, '当前环境无法执行该操作，未修改文件。');
  assert.equal(result.progress.at(-1).text, '执行已结束，请核对返回结果');
  assert.equal(JSON.stringify(result.progress).includes('任务已完成'), false);
});

test('旧CLI未标phase的计划与最终正文仅保留最后一条有效摘要', async () => {
  const r = rig();
  await r.handler.start(body({ permission: 'workspace-write' }));
  const child = r.children[0];
  r.emit(child, { type: 'item.completed', item: { id: 'plan', type: 'agent_message', text: '我会直接创建文件。' } });
  r.emit(child, { type: 'item.completed', item: { id: 'final', type: 'agent_message', text: '已创建文件，内容已核对。' } });
  r.emit(child, { type: 'item.completed', item: { id: 'private', type: 'agent_message', phase: 'analysis', text: 'PRIVATE_REASONING' } });
  r.emit(child, { type: 'item.completed', item: { id: 'progress', type: 'agent_message', channel: 'commentary', text: 'PRIVATE_COMMENTARY' } });
  r.emit(child, { type: 'item.completed', item: { id: 'empty', type: 'agent_message', text: '\n  ' } });
  child.emit('close', 0);
  assert.equal(r.handler.snapshot().summary, '已创建文件，内容已核对。');
  assert.doesNotMatch(JSON.stringify(r.handler.snapshot()), /我会直接|PRIVATE_/);
});

test('真实聊天handler与任务handler共用同一gate，任务完成前聊天不会另起CLI', async () => {
  const gate = createCodexActivityGate();
  const r = rig({ activityGate: gate });
  await r.handler.start(body());
  let child; let spawns = 0;
  const chat = createCodexChatHandler({ codexPath: 'C:/Codex/codex.exe', cwd, activityGate: gate, spawnImpl() {
    spawns++;
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); } });
    child.kill = () => true;
    return child;
  } });
  const blocked = new Response();
  await chat(new EventEmitter(), blocked, { messages: [{ role: 'user', content: '你好' }] });
  assert.equal(blocked.statusCode, 429);
  assert.equal(spawns, 0);
  r.complete(r.children[0]);
  const allowed = new Response();
  const pending = chat(new EventEmitter(), allowed, { messages: [{ role: 'user', content: '你好' }] });
  child.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '你好。' } }) + '\n');
  child.emit('close', 0);
  await pending;
  assert.equal(spawns, 1);
  assert.equal(allowed.statusCode, 200);
});

test('任务和闲聊共享锁；取消只请求终止自己的进程，close前不接收新任务', async () => {
  const gate = createCodexActivityGate(); const chatRelease = gate.acquire('chat');
  const r = rig({ activityGate: gate });
  await assert.rejects(r.handler.start(body()), error => error.code === 'busy');
  chatRelease();
  const started = await r.handler.start(body());
  const child = r.children[0];
  child.kill = () => { child.killed = true; return true; };
  assert.equal(gate.acquire('chat'), null);
  assert.equal(r.handler.cancel('another-task'), false);
  assert.equal(child.killed, undefined);
  assert.equal(r.handler.cancel(started.id), true);
  assert.equal(child.killed, true);
  assert.equal(r.handler.snapshot().state, 'cancelling');
  await assert.rejects(r.handler.start(body()), error => error.code === 'busy');
  assert.equal(gate.acquire('chat'), null);
  child.emit('close', null, 'SIGTERM');
  assert.equal(r.handler.snapshot().state, 'cancelled');
  assert.equal(typeof gate.acquire('chat'), 'function');
});

test('进度与最终答案按JSONL/UTF8分片解析，不公开推理、命令、工具输出或stderr', async () => {
  const r = rig(); await r.handler.start(body()); const child = r.children[0];
  r.emit(child, { type: 'item.started', item: { type: 'reasoning', text: 'PRIVATE_REASONING' } });
  r.emit(child, { type: 'item.started', item: { type: 'command_execution', command: 'PRIVATE_COMMAND' } });
  r.emit(child, { type: 'item.completed', item: { type: 'agent_message', phase: 'commentary', text: 'PRIVATE_COMMENTARY' } });
  child.stderr.write('PRIVATE_STDERR');
  const bytes = Buffer.from(JSON.stringify({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: '任务摘要中文完整。' } }) + '\n');
  const split = bytes.indexOf(Buffer.from('摘')) + 1;
  child.stdout.write(bytes.subarray(0, split)); child.stdout.write(bytes.subarray(split)); child.emit('close', 0);
  assert.equal(r.handler.snapshot().summary, '任务摘要中文完整。');
  assert.equal(JSON.stringify(r.changes).includes('PRIVATE_'), false);
});

test('只读任务拒绝文件变更事件，失败和超时均以固定错误收尾', async () => {
  let r = rig(); await r.handler.start(body()); const child = r.children[0];
  r.emit(child, { type: 'item.started', item: { type: 'file_change' } });
  await until(() => r.handler.snapshot().state === 'failed');
  assert.equal(r.handler.snapshot().error.code, 'permission_violation');
  r = rig({ timeoutMs: 10 }); await r.handler.start(body());
  await until(() => r.handler.snapshot().state === 'timed_out');
  assert.equal(r.children[0].killed, true);
  assert.equal(r.handler.snapshot().error.code, 'timeout');
});

test('HTTP启动返回202；失败返回固定错误，状态快照是独立副本', async () => {
  const r = rig(); const res = new Response();
  await r.handler({ method: 'POST' }, res, body());
  assert.equal(res.statusCode, 202);
  const accepted = JSON.parse(res.data);
  assert.equal(accepted.state, 'running');
  accepted.progress.push({ text: '外部修改' });
  assert.equal(r.handler.snapshot().progress.some(item => item.text === '外部修改'), false);
  r.children[0].stderr.write('PRIVATE_ERROR');
  r.children[0].emit('close', 1);
  assert.equal(r.handler.snapshot().state, 'failed');
  assert.equal(JSON.stringify(r.handler.snapshot()).includes('PRIVATE_ERROR'), false);
  const invalid = new Response();
  await r.handler({ method: 'POST' }, invalid, body({ confirmed: false }));
  assert.equal(invalid.statusCode, 400);
});

test('并发目录校验也被锁住，dispose在验证阶段阻止后续spawn', async () => {
  let finishDirectory;
  const r = rig({ fsImpl: { realpath: path => new Promise(resolvePromise => { finishDirectory = () => resolvePromise(path); }), async stat() { return { isDirectory: () => true }; } } });
  const first = r.handler.start(body());
  await assert.rejects(r.handler.start(body()), error => error.code === 'busy');
  r.handler.dispose();
  finishDirectory();
  await assert.rejects(first, error => error.code === 'cancelled');
  assert.equal(r.calls.length, 0);
});

test('spawn抛出立即释放gate；有PID的异常需等待close，均不返回底层诊断', async () => {
  const gate = createCodexActivityGate();
  const failing = createCodexTaskHandler({
    codexPath: 'C:/Codex/codex.exe', activityGate: gate,
    fsImpl: { async realpath(path) { return path; }, async stat() { return { isDirectory: () => true }; } },
    spawnImpl() { throw new Error('PRIVATE_SPAWN_DIAGNOSTIC'); },
  });
  await assert.rejects(failing.start(body()), error => error.code === 'process_failed' && !error.message.includes('PRIVATE'));
  const release = gate.acquire('chat');
  assert.equal(typeof release, 'function'); release();
  const r = rig({ activityGate: gate, terminateImpl(child) { child.killed = true; } });
  await r.handler.start(body());
  const child = r.children[0]; child.pid = 123;
  child.emit('error', new Error('PRIVATE_CHILD_DIAGNOSTIC'));
  assert.equal(child.killed, true);
  assert.equal(gate.acquire('chat'), null);
  child.emit('close', 1);
  assert.equal(r.handler.snapshot().state, 'failed');
  assert.equal(JSON.stringify(r.handler.snapshot()).includes('PRIVATE'), false);
  assert.equal(typeof gate.acquire('chat'), 'function');
});

test('进度限长，异常超长JSONL停止自己的进程并返回固定上限错误', async () => {
  const r = rig(); await r.handler.start(body()); const child = r.children[0];
  for (let index = 0; index < 40; index++) r.emit(child, { type: 'item.started', item: { type: index % 2 ? 'reasoning' : 'command_execution' } });
  assert.equal(r.handler.snapshot().progress.length, 24);
  child.stdout.write('x'.repeat(512 * 1024 + 1));
  await until(() => r.handler.snapshot().state === 'failed');
  assert.equal(child.killed, true);
  assert.equal(r.handler.snapshot().error.code, 'output_limit');
  assert.equal(r.handler.snapshot().progress.length, 24);
});
