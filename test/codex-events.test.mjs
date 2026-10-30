import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexWatcher } from '../src/codex-events.mjs';

const record = (type, payload, timestamp = new Date().toISOString()) => JSON.stringify({ timestamp, type, payload }) + '\n';
const meta = (id, thread_source = 'user') => record('session_meta', { id, thread_source });
const event = (type, fields = {}, timestamp) => record('event_msg', { type, ...fields }, timestamp);

async function fixture(t, initial = {}, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'codex-bluefish-events-'));
  const now = new Date();
  const dir = join(home, 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(initial)) await writeFile(join(dir, name), text);
  const changes = [];
  const notifications = [];
  const watcher = createCodexWatcher({ codexHome: home, pollMs: 20, locale: 'zh-CN', ...options, onChange(snapshot, notification) {
    changes.push(snapshot);
    if (notification) notifications.push(notification);
  } });
  t.after(async () => {
    await watcher.stop();
    await rm(home, { recursive: true, force: true });
  });
  return { home, dir, watcher, changes, notifications };
}

async function until(predicate, message = '等待事件适配器更新') {
  // 测试可控制事件时间；轮询超时仍按真实经过时间计算，避免时钟冻结后挂起。
  const limit = performance.now() + 4000;
  while (performance.now() < limit) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

test('QQ实时管理的线程不重复汇总或通知，但仍保留真实额度观测',async t=>{
  const f=await fixture(t,{'remote.jsonl':meta('remote-thread')+event('task_started'),'local.jsonl':meta('local-thread')+event('task_started')},{excludeThread:id=>id==='remote-thread'});
  await f.watcher.start();assert.equal(f.watcher.snapshot().activeCount,1);assert.equal(f.watcher.snapshot().threadId,'local-thread');
  await appendFile(join(f.dir,'remote.jsonl'),event('token_count',{rate_limits:{primary:{used_percent:17,window_minutes:300}}})+event('exec_approval_request',{id:'remote-approval'})+event('task_complete',{turn_id:'remote-turn'}));
  await until(()=>f.watcher.snapshot().usage?.usedPercent===17);
  assert.equal(f.watcher.snapshot().activeCount,1);assert.equal(f.notifications.length,0);
});

test('English事件状态、窗口与通知固定文案可读，线程ID与自报窗口名保留', async t => {
  const f = await fixture(t, { 'a.jsonl': meta('thread-a') + event('task_started'), 'b.jsonl': meta('thread-b') + event('task_started') }, { locale: 'en' });
  await f.watcher.start(); assert.equal(f.watcher.snapshot().task, '2 chats · Thinking');
  await appendFile(join(f.dir, 'a.jsonl'), event('token_count', { rate_limits: { primary: { used_percent: 8, window_minutes: 300 }, secondary: { used_percent: 12, window_label: '自报窗口名' } } }));
  await until(() => f.watcher.snapshot().usage?.usedPercent === 12);
  assert.equal(f.watcher.snapshot().usage.windows[0].windowLabel, '5-hour window');
  assert.equal(f.watcher.snapshot().usage.windows[1].windowLabel, '自报窗口名');
  await appendFile(join(f.dir, 'a.jsonl'), event('request_user_input', { turn_id: 'approval-en' }));
  await until(() => f.notifications.length === 1);
  assert.equal(f.notifications[0].title, 'Codex needs your input'); assert.equal(f.notifications[0].threadId, 'thread-a');
});

test('聚合多个会话：一个完成不会清除另一个运行中的会话，且不泄漏正文', async t => {
  const f = await fixture(t, {
    'a.jsonl': meta('thread-a') + event('task_started', { turn_id: 'a1' }),
    'b.jsonl': meta('thread-b') + event('task_started', { turn_id: 'b1' }),
  });
  await f.watcher.start();
  assert.equal(f.watcher.snapshot().activeCount, 2);
  await appendFile(join(f.dir, 'a.jsonl'), record('response_item', { type: 'function_call', name: 'exec_command', arguments: 'PRIVATE_PROMPT_SECRET' }));
  await until(() => f.watcher.snapshot().state === 'working');
  await appendFile(join(f.dir, 'a.jsonl'), event('task_complete', { turn_id: 'a1', last_agent_message: 'PRIVATE_REPLY_SECRET' }));
  await until(() => f.watcher.snapshot().activeCount === 1 && f.notifications.length === 1);
  assert.equal(f.watcher.snapshot().threadId, 'thread-b');
  assert.equal(f.watcher.snapshot().state, 'thinking');
  await appendFile(join(f.dir, 'b.jsonl'), event('task_complete', { turn_id: 'b1' }));
  await until(() => f.watcher.snapshot().activeCount === 0 && f.notifications.length === 2);
  assert.equal(f.watcher.snapshot().state, 'success');
  assert.equal(JSON.stringify({ changes: f.changes, notifications: f.notifications }).includes('PRIVATE_'), false);
});

test('通知保留触发会话ID：另一会话正在工作时，完成和错误不能跳到聚合快照所选会话', async t => {
  const f = await fixture(t, {
    'finishing.jsonl': meta('finishing-thread') + event('task_started', { turn_id: 'finish-1' }),
    'working.jsonl': meta('working-thread') + event('task_started', { turn_id: 'work-1' })
      + record('response_item', { type: 'function_call', name: 'exec_command' }),
  });
  await f.watcher.start();
  assert.equal(f.watcher.snapshot().threadId, 'working-thread');
  await appendFile(join(f.dir, 'finishing.jsonl'), event('task_complete', { turn_id: 'finish-1' }));
  await until(() => f.notifications.length === 1);
  assert.equal(f.watcher.snapshot().state, 'working');
  assert.equal(f.watcher.snapshot().threadId, 'working-thread');
  assert.equal(f.notifications[0].kind, 'complete');
  assert.equal(f.notifications[0].threadId, 'finishing-thread');
  assert.notEqual(f.notifications[0].threadId, f.watcher.snapshot().threadId);
  await appendFile(join(f.dir, 'finishing.jsonl'), event('task_started', { turn_id: 'finish-2' })
    + event('task_complete', { turn_id: 'finish-2', error: { code: 'failed' } }));
  await until(() => f.notifications.length === 2);
  assert.equal(f.notifications[1].kind, 'error');
  assert.equal(f.notifications[1].threadId, 'finishing-thread');
  assert.equal(f.watcher.snapshot().threadId, 'working-thread');
});

test('启动只重建状态，旧完成不通知；新完成去重，pet-chat 来源排除', async t => {
  const old = '2026-01-01T00:00:00.000Z';
  const f = await fixture(t, {
    'old.jsonl': meta('old') + event('task_started', { turn_id: 'old-turn' }, old) + event('task_complete', { turn_id: 'old-turn' }, old),
    'self.jsonl': meta('self', 'pet-chat') + event('task_started', { turn_id: 'self-turn' }),
  });
  await f.watcher.start();
  assert.equal(f.notifications.length, 0);
  assert.equal(f.watcher.snapshot().activeCount, 0);
  await appendFile(join(f.dir, 'old.jsonl'), event('task_started', { turn_id: 'new-turn' }));
  await until(() => f.watcher.snapshot().activeCount === 1);
  const done = event('task_complete', { turn_id: 'new-turn' });
  await appendFile(join(f.dir, 'old.jsonl'), done + done);
  await until(() => f.notifications.length === 1);
  assert.equal(f.notifications[0].kind, 'complete');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(f.notifications.length, 1);
});

test('额度只读真实字段，选择使用率最高的有效窗口，缺失时不伪造余额', async t => {
  const f = await fixture(t, { 'quota.jsonl': meta('quota') });
  await f.watcher.start();
  assert.equal(f.watcher.snapshot().usage, undefined);
  await appendFile(join(f.dir, 'quota.jsonl'), event('token_count', { rate_limits: {
    primary: { used_percent: 32.5, window_minutes: 300, resets_at: 1800000000 },
    secondary: { used_percent: 87, window_minutes: 10080, resets_at: 1800500000 },
    credits: { balance: 'PRIVATE_CREDIT_STRING' },
  } }));
  await until(() => f.watcher.snapshot().usage?.usedPercent === 87);
  assert.deepEqual(f.watcher.snapshot().usage, {
    usedPercent: 87, windowLabel: '7 天额度', resetsAt: 1800500000,
    windows: [
      { usedPercent: 32.5, windowMinutes: 300, windowLabel: '5 小时额度', resetsAt: 1800000000 },
      { usedPercent: 87, windowMinutes: 10080, windowLabel: '7 天额度', resetsAt: 1800500000 },
    ],
  });
  await appendFile(join(f.dir, 'quota.jsonl'), event('token_count', { rate_limits: { primary: { used_percent: 0, window_minutes: 300, resets_at: 1800600000 } } }));
  await until(() => f.watcher.snapshot().usage?.usedPercent === 0);
  assert.equal(f.watcher.snapshot().usage.windowLabel, '5 小时额度');
  assert.equal(JSON.stringify(f.changes).includes('PRIVATE_CREDIT_STRING'), false);
});

test('额度保留真实窗口；重置时间已过只标记过期，不把旧额度改成0', async t => {
  const f = await fixture(t, { 'stale.jsonl': meta('stale') });
  await f.watcher.start();
  const past = Math.floor(Date.now() / 1000) - 60;
  await appendFile(join(f.dir, 'stale.jsonl'), event('token_count', { rate_limits: {
    primary: { used_percent: 93, window_minutes: 300, resets_at: past },
  } }));
  await until(() => f.watcher.snapshot().usage?.usedPercent === 93);
  assert.equal(f.watcher.snapshot().usage.stale, true);
  assert.equal(f.watcher.snapshot().usage.windows[0].stale, true);
  assert.equal(f.watcher.snapshot().usage.windows.length, 1);
  await appendFile(join(f.dir, 'stale.jsonl'), event('token_count', { rate_limits: {
    primary: { used_percent: 8, window_minutes: 300, resets_at: past + 3600 },
    secondary: { used_percent: 20, window_label: '自报额度窗口', resets_at: past + 7200 },
  } }));
  await until(() => f.watcher.snapshot().usage?.usedPercent === 20);
  assert.equal(f.watcher.snapshot().usage.stale, undefined);
  assert.equal(f.watcher.snapshot().usage.windows[1].windowLabel, '自报额度窗口');
  assert.equal(f.watcher.snapshot().usage.windows[1].windowMinutes, undefined);
});

test('取消和错误只结束对应会话，不覆盖其他正在工作的会话', async t => {
  const f = await fixture(t, {
    'worker.jsonl': meta('worker') + event('task_started', { turn_id: 'worker' }) + record('response_item', { type: 'function_call', name: 'exec_command' }),
    'other.jsonl': meta('other') + event('task_started', { turn_id: 'cancel' }),
  });
  await f.watcher.start();
  await appendFile(join(f.dir, 'other.jsonl'), event('turn_aborted', { turn_id: 'cancel', reason: 'interrupted' }));
  await until(() => f.watcher.snapshot().activeCount === 1);
  assert.equal(f.watcher.snapshot().state, 'working');
  assert.equal(f.notifications.length, 0);
  await appendFile(join(f.dir, 'other.jsonl'), event('task_started', { turn_id: 'failed' }) + event('task_complete', { turn_id: 'failed', error: { message: 'PRIVATE_ERROR' } }));
  await until(() => f.notifications.length === 1);
  assert.equal(f.watcher.snapshot().activeCount, 1);
  assert.equal(f.watcher.snapshot().state, 'working');
  assert.equal(f.watcher.snapshot().threadId, 'worker');
  assert.equal(f.notifications[0].kind, 'error');
});

test('完成和错误短暂保留后回idle，等待输入和仍在工作的会话不因超时清除', async t => {
  const terminalHoldMs = 100;
  let now = Date.now();
  const timestamp = () => new Date(now).toISOString();
  // 只推进状态过期时钟，文件读取与轮询照常运行，不依赖 CI 在 100ms 内调度断言。
  t.mock.method(Date, 'now', () => now);
  const f = await fixture(t, { 'hold.jsonl': meta('hold') + event('task_started', { turn_id: 'hold-1' }, timestamp()) }, { terminalHoldMs });
  await f.watcher.start();
  await appendFile(join(f.dir, 'hold.jsonl'), event('task_complete', { turn_id: 'hold-1' }, timestamp()));
  await until(() => f.watcher.snapshot().state === 'success');
  assert.equal(f.watcher.snapshot().activeCount, 0);
  now += terminalHoldMs - 1;
  assert.equal(f.watcher.snapshot().state, 'success');
  now += 1;
  assert.equal(f.watcher.snapshot().state, 'idle');
  await until(() => f.changes.at(-1).state === 'idle');
  await appendFile(join(f.dir, 'hold.jsonl'), event('task_started', { turn_id: 'hold-2' }, timestamp()) + event('task_complete', { turn_id: 'hold-2', error: { code: 'failed' } }, timestamp()));
  await until(() => f.watcher.snapshot().state === 'error');
  now += terminalHoldMs - 1;
  assert.equal(f.watcher.snapshot().state, 'error');
  now += 1;
  assert.equal(f.watcher.snapshot().state, 'idle');
  await until(() => f.changes.at(-1).state === 'idle');
  await appendFile(join(f.dir, 'hold.jsonl'), event('request_user_input', { id: 'wait-forever' }, timestamp()));
  await until(() => f.watcher.snapshot().state === 'waiting');
  now += terminalHoldMs * 10;
  assert.equal(f.watcher.snapshot().state, 'waiting');
  assert.equal(f.watcher.snapshot().activeCount, 1);
  await appendFile(join(f.dir, 'hold.jsonl'), record('response_item', { type: 'function_call', name: 'exec_command' }, timestamp()));
  await until(() => f.watcher.snapshot().state === 'working');
  now += terminalHoldMs * 10;
  assert.equal(f.watcher.snapshot().state, 'working');
  assert.equal(f.watcher.snapshot().activeCount, 1);
});

test('半行跨轮询和UTF8分片不会提前处理；截断重建不重放旧通知', async t => {
  const f = await fixture(t, { 'split.jsonl': meta('split') + event('task_complete', { turn_id: 'old', last_agent_message: '垫'.repeat(300) }) });
  await f.watcher.start();
  const started = Buffer.from(event('task_started', { turn_id: 'new', ignored_text: '中文分片' }));
  const splitAt = started.indexOf(Buffer.from('中文')) + 1;
  await appendFile(join(f.dir, 'split.jsonl'), started.subarray(0, splitAt));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(f.watcher.snapshot().activeCount, 0);
  await appendFile(join(f.dir, 'split.jsonl'), started.subarray(splitAt));
  await until(() => f.watcher.snapshot().activeCount === 1);
  await writeFile(join(f.dir, 'split.jsonl'), meta('split') + event('task_started', { turn_id: 'after-truncate' }));
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(f.notifications.length, 0);
  await appendFile(join(f.dir, 'split.jsonl'), event('task_complete', { turn_id: 'after-truncate' }));
  await until(() => f.notifications.length === 1);
  assert.equal(f.watcher.snapshot().state, 'success');
});

test('发现新文件与同路径替换，按稳定thread ID合并；只通知启动后的新事件', async t => {
  const f = await fixture(t, { 'roll.jsonl': meta('roll') + event('task_started', { turn_id: 'first' }) });
  await f.watcher.start();
  const replacement = join(f.dir, 'replacement.tmp');
  await writeFile(replacement, meta('roll') + event('task_complete', { turn_id: 'first' }));
  await rm(join(f.dir, 'roll.jsonl'));
  await rename(replacement, join(f.dir, 'roll.jsonl'));
  await until(() => f.watcher.snapshot().activeCount === 0);
  assert.equal(f.notifications.length, 0);
  await writeFile(join(f.dir, 'brand-new.jsonl'), meta('new-thread') + event('task_started', { turn_id: 'new-file-turn' }));
  await until(() => f.watcher.snapshot().activeCount === 1);
  await appendFile(join(f.dir, 'brand-new.jsonl'), event('exec_approval_request', { id: 'approval-1', command: 'PRIVATE_COMMAND' }));
  await until(() => f.watcher.snapshot().state === 'waiting' && f.notifications.length === 1);
  assert.equal(f.notifications[0].kind, 'approval');
  await appendFile(join(f.dir, 'brand-new.jsonl'), event('task_complete', { turn_id: 'new-file-turn', error: { message: 'PRIVATE_ERROR' } }));
  await until(() => f.watcher.snapshot().state === 'error' && f.notifications.length === 2);
  assert.equal(f.notifications[1].kind, 'error');
  assert.equal(JSON.stringify(f.notifications).includes('PRIVATE_'), false);
});

test('初扫限制尾部，不读取大正文来构建状态；停止后不回调', async t => {
  const f = await fixture(t, { 'large.jsonl': meta('large') + record('response_item', { type: 'message', role: 'user', content: '私'.repeat(250000) }) + event('task_complete', { turn_id: 'old-large' }) });
  await f.watcher.start();
  assert.equal(f.watcher.snapshot().state, 'success');
  assert.equal(f.notifications.length, 0);
  await f.watcher.stop();
  const count = f.changes.length;
  await appendFile(join(f.dir, 'large.jsonl'), event('task_started', { turn_id: 'stopped' }));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(f.changes.length, count);
});
