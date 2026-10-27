'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createController, NoticeHistory, notificationDecision, nativeErrorCode, threadUrl, noticeUrl, createNoticeRequest } = require('./codex-notifications.cjs');

const THREAD = '00000000-0000-4000-8000-000000000001';
const notice = (id = 'one') => ({ id, kind: 'completed', title: '任务完成', body: '可以查看结果', threadId: THREAD });

function fixture(foreground, options = {}) {
  const app = new EventEmitter();
  app.isReady = () => false;
  app.whenReady = () => new Promise(() => {});
  const shown = [];
  const opened = [];
  const logs = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(value) { super(); this.value = value; }
    show() { shown.push(this); }
    close() { this.emit('close'); }
  }
  let checks = 0;
  const controller = createController({
    hostRequest: options.hostRequest || (async () => ({ status: 200, body: JSON.stringify({ notices: [notice()] }) })),
    checkForeground: async () => { checks += 1; if (foreground instanceof Error) throw foreground; return foreground; },
    electron: { app, Notification, shell: { openExternal: async (url) => { opened.push(url); } } },
    log: (value) => logs.push(value),
  });
  return { controller, app, shown, opened, logs, checks: () => checks };
}

test('foreground and failed checks suppress notifications; errors never disclose payload', async () => {
  for (const state of [{ ok: true, isCodexForeground: true }, new Error('sensitive payload'), { ok: false }]) {
    const f = fixture(state);
    await f.controller.poll();
    await f.controller.poll();
    assert.equal(f.shown.length, 0);
    assert.equal(f.checks(), 1);
    assert.ok(f.logs.every((entry) => !entry.includes('sensitive payload')));
    f.controller.stop();
  }
  assert.equal(notificationDecision(null), 'error');
});

test('background sends once, validates thread UUID and opens only a registered Codex protocol', async () => {
  const f = fixture({ ok: true, isCodexForeground: false, protocolRegistered: true });
  await f.controller.poll();
  await f.controller.poll();
  assert.equal(f.shown.length, 1);
  f.shown[0].emit('click');
  await new Promise(setImmediate);
  assert.deepEqual(f.opened, [`codex://threads/${THREAD}`]);
  assert.equal(threadUrl({ threadId: null }, true), null);
  assert.equal(threadUrl({ threadId: '../other' }, true), null);
  assert.equal(threadUrl(notice(), false), null);
  f.controller.stop();
});

test('unregistered protocol keeps toast without attempting an external open', async () => {
  const f = fixture({ ok: true, isCodexForeground: false, protocolRegistered: false });
  await f.controller.poll();
  f.shown[0].emit('click');
  await new Promise(setImmediate);
  assert.equal(f.shown.length, 1);
  assert.deepEqual(f.opened, []);
  f.controller.stop();
});

test('polls do not overlap and shutdown ignores a pending response', async () => {
  let release;
  let calls = 0;
  const f = fixture({ ok: true, isCodexForeground: false }, {
    hostRequest: () => { calls += 1; return new Promise((resolve) => { release = resolve; }); },
  });
  const first = f.controller.poll();
  await f.controller.poll();
  assert.equal(calls, 1);
  f.app.emit('before-quit');
  release({ status: 200, body: JSON.stringify({ notices: [notice()] }) });
  await first;
  await f.controller.poll();
  assert.equal(f.shown.length, 0);
  assert.equal(calls, 1);
});

test('history rejects malformed data and stays bounded', () => {
  const history = new NoticeHistory(2);
  assert.equal(history.take([notice('a'), notice('a'), { id: 'bad' }]).length, 1);
  history.take([notice('b'), notice('c')]);
  assert.equal(history.ids.size, 2);
  assert.deepEqual([...history.ids], ['b', 'c']);
});

test('HTTP notice endpoint is fixed to loopback and never follows a redirect', async () => {
  const safe = 'http://127.0.0.1:3180/dsh-pet-7340/codex-notices';
  assert.equal(noticeUrl(safe), safe);
  for (const value of [
    'https://127.0.0.1:3180/dsh-pet-7340/codex-notices',
    'http://example.com:3180/dsh-pet-7340/codex-notices',
    'http://user:secret@127.0.0.1:3180/dsh-pet-7340/codex-notices',
    safe + '?secret=anything', safe + '#fragment', safe.replace('codex-notices', 'config'),
  ]) assert.equal(noticeUrl(value), null);
  const request = createNoticeRequest(safe, async (url, options) => {
    assert.equal(url, safe);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return { status: 200, text: async () => '{"notices":[]}' };
  });
  assert.deepEqual(await request(), { status: 200, body: '{"notices":[]}' });
  await assert.rejects(createNoticeRequest('bad'), /notice-endpoint-invalid/);
});

test('native diagnostics retain only HRESULT and never notification content', async () => {
  assert.equal(nativeErrorCode('WinAPI: Show failed, ERROR (HRESULT: -2147023728) secret title'), 'HRESULT=0x80070490');
  assert.equal(nativeErrorCode(new Error('HRESULT=0x80040154 private body')), 'HRESULT=0x80040154');
  assert.equal(nativeErrorCode('sensitive title, user value 0x12345678'), 'HRESULT=unavailable');
  const f = fixture({ ok: true, isCodexForeground: false, protocolRegistered: true });
  await f.controller.poll();
  f.shown[0].emit('failed', {}, 'WinAPI: Show failed, ERROR (HRESULT: -2147023728) sensitive title');
  assert.ok(f.logs.some((entry) => entry.includes('0x80070490')));
  assert.ok(f.logs.every((entry) => !entry.includes('sensitive title')));
  f.controller.stop();
});
