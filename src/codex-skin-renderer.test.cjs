'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const A = require('./skin-actions.cjs');

function harness({ failFirstImage = false, chatOpen, mode = 'q', random = () => 1, rects, sisterLayer } = {}) {
  const observers = [];
  const timers = new Map();
  let timerId = 0; let attempts = 0; let lastMenu; let clock = 100000;
  const draws = [];
  class Element {
    constructor() {
      this.style = {}; this.children = [];
      const classes = new Set();
      this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
    }
    appendChild(child) { this.children.push(child); return child; }
    getContext() { return { clearRect() {}, drawImage: (...args) => draws.push(args) }; }
  }
  class Sprite {
    constructor() {
      this.stage = new Element(); this.videoA = new Element(); this.videoB = new Element(); this.front = 0;
      this.videoA.currentTime = 4; this.videoA.duration = 10; this.videoA.playing = true;
      this.animations = { idle: ['呼吸'], moves: { actions: [] } }; this.anim = '呼吸'; this.nativeCalls = 0; this.oldChatCalls = 0;
    }
    switchTo() { this.nativeCalls++; return 'native-switch-result'; }
    applyFreeze(value) { this.frozen = value; }
    dispose() { this.nativeDisposed = true; }
    closeMenu() { this.menuClosed = true; }
    onMenuAction() { this.oldChatCalls++; }
  }
  const manifest = A.normalizeManifest(rects ? { schemaVersion: 1, profiles: { located: { file: 'sprites.png', sisterFile: 'sister.png', frames: [[0, 0], [1, 0], [2, 0], [3, 0]], fps: 4, rects } }, actions: { '呼吸': { profile: 'located', coverage: 'dedicated' } } } : sisterLayer ? { schemaVersion: 1, profiles: { idle: { ...A.defaultManifest().profiles.idle, forms: { sister: sisterLayer } } } } : undefined);
  const character = { id: 'white-dragon', label: '白龙娘', originalVideo: false, available: { q: true, sister: true, occasional: true }, manifest, assets: { 'sprites.png': { available: true, width: 1254, height: 1254, url: 'file:///sprites.png' }, 'sister.png': { available: true, width: 1254, height: 1254, url: 'file:///sister.png' } } };
  const model = { selection: { character: 'white-dragon', mode }, characters: [character], catalog: [{ id: '呼吸', group: 'idle' }] };
  const shared = { mountContextMenu: options => { lastMenu = options; return options; } };
  const fakeWindow = {
    CodexSkinActions: A, PetShared: shared,
    codexSkins: { getState: async () => model, select: async value => ({ ...model, selection: value }), onChanged: () => () => {} },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay, kind: 'timeout' }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay, kind: 'interval' }); return id; }, clearInterval: id => timers.delete(id),
    requestAnimationFrame: fn => { const id = ++timerId; timers.set(id, { fn, kind: 'raf' }); return id; }, cancelAnimationFrame: id => timers.delete(id),
    addEventListener() {},
  };
  if (chatOpen) fakeWindow.codexChatPanel = { open: chatOpen };
  class Observer { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  class Image {
    set src(_value) { attempts++; if (failFirstImage && attempts === 1) this.onerror(); else this.onload(); }
  }
  const context = { window: fakeWindow, document: { head: new Element(), createElement: () => new Element() }, PetSprite: Sprite, MutationObserver: Observer, Image, console: { warn() {} }, Date: { now: () => clock }, Math: Object.assign(Object.create(Math), { random }) };
  vm.runInNewContext(readFileSync(join(__dirname, 'codex-skin-renderer.js'), 'utf8'), context);
  return { Sprite, window: fakeWindow, observers, timers, shared, draws, attempts: () => attempts, menu: () => lastMenu, setNow: value => { clock = value; }, runTimer: id => { const value = timers.get(id); if (value.kind !== 'interval') timers.delete(id); value.fn(); } };
}

test('sprite覆盖层继续原switchTo和视频时钟，镜像与Q弹transform同步，dispose释放观察和定时器', async () => {
  const h = harness();
  await Promise.resolve();
  const sprite = new h.Sprite();
  assert.equal(sprite.switchTo('呼吸', true), 'native-switch-result');
  assert.equal(sprite.nativeCalls, 1);
  assert.equal(sprite.videoA.currentTime, 4);
  assert.equal(sprite.videoA.playing, true);
  assert.equal(sprite.stage.classList.contains('codex-skin-active'), true);
  const controller = sprite.__codexSkinController;
  sprite.videoA.style.transform = 'scaleX(-1) scaleY(.55)';
  sprite.videoA.style.transformOrigin = 'bottom';
  h.observers[0].callback();
  assert.equal(controller.layer.style.transform, 'scaleX(-1) scaleY(.55)');
  assert.equal(controller.layer.style.transformOrigin, 'bottom');
  sprite.applyFreeze(true);
  assert.equal(controller.frame.style.animationPlayState, 'paused');
  sprite.dispose();
  assert.equal(sprite.nativeDisposed, true);
  assert.equal(h.observers[0].disconnected, true);
  assert.equal(h.timers.size, 0);
});

test('本地图像解码失败不会无限重新加载或把原视频隐藏成空白', async () => {
  const h = harness({ failFirstImage: true });
  await Promise.resolve();
  const sprite = new h.Sprite();
  sprite.switchTo('呼吸', true);
  assert.equal(h.attempts(), 1);
  assert.equal(sprite.stage.classList.contains('codex-skin-active'), false);
  sprite.dispose();
});

test('有新API时转图文窗口，窗口失败不抛到动作链；无API时保留原对话', async () => {
  let calls = 0;
  const h = harness({ chatOpen: () => { calls++; throw new Error('PRIVATE_WINDOW_ERROR'); } });
  await Promise.resolve();
  const sprite = new h.Sprite();
  assert.doesNotThrow(() => sprite.onMenuAction({ action: 'chat' }));
  assert.equal(calls, 1);
  assert.equal(sprite.oldChatCalls, 0);
  h.shared.mountContextMenu({ tree: [{ label: '对话', action: 'chat' }] });
  assert.equal(h.menu().tree[0].label, '图文对话');
  const legacy = harness(); await Promise.resolve();
  const old = new legacy.Sprite(); old.onMenuAction({ action: 'chat' });
  assert.equal(old.oldChatCalls, 1);
});

test('偶尔变身有独立到时恢复，实际展示不因1500ms轮询而超过10秒', async () => {
  const h = harness({ mode: 'occasional', random: () => 0 }); await Promise.resolve();
  const sprite = new h.Sprite(); sprite.switchTo('呼吸', true);
  const interval = [...h.timers].find(([, timer]) => timer.kind === 'interval');
  h.runTimer(interval[0]);
  assert.equal(h.window.__codexSkinDebug.form, 'sister');
  const expiry = [...h.timers].find(([, timer]) => timer.kind === 'timeout' && timer.delay === 7000);
  assert.ok(expiry, '变身必须登记确切的恢复时刻');
  h.setNow(107000); h.runTimer(expiry[0]);
  assert.equal(h.window.__codexSkinDebug.form, 'q');
  sprite.dispose(); assert.equal(h.timers.size, 0);
});

test('真实偏格包用rects从原PNG取帧，前台视频时钟换帧，统一比例和脚底；切回视频停止rAF', async () => {
  const rects = [[54, 7, 269, 309], [357, 9, 258, 305], [652, 7, 267, 307], [959, 5, 265, 312]];
  const h = harness({ rects }); await Promise.resolve();
  const sprite = new h.Sprite(); sprite.switchTo('呼吸', true);
  assert.ok(h.draws.length > 0, 'rects模式必须执行真实drawImage源裁取');
  assert.deepEqual(h.draws.at(-1).slice(1, 5), rects[0]);
  const first = h.draws.at(-1);
  sprite.videoA.currentTime = 0.5;
  const raf = [...h.timers].find(([, timer]) => timer.kind === 'raf'); h.runTimer(raf[0]);
  const second = h.draws.at(-1);
  assert.deepEqual(second.slice(1, 5), rects[2]);
  assert.equal(first[7] / rects[0][2], second[7] / rects[2][2]);
  assert.equal(first[6] + first[8], second[6] + second[8]);
  const count = h.draws.length;
  const frozenRaf = [...h.timers].find(([, timer]) => timer.kind === 'raf'); h.runTimer(frozenRaf[0]);
  assert.equal(h.draws.length, count, '暂停时钟不重画、不自走帧');
  sprite.switchTo('外部动画', true, null, 'https://example.com/clip.webm');
  assert.equal([...h.timers.values()].some(timer => timer.kind === 'raf'), false);
  sprite.dispose(); assert.equal(h.timers.size, 0);
});

test('姐姐非rect帧按真实竖长格比例显示，Q网格不被姐姐覆盖', async () => {
  const sisterLayer = { file: 'sister.png', columns: 4, rows: 2, frames: [[0, 0], [1, 0]], fps: 2 };
  const h = harness({ mode: 'sister', sisterLayer }); await Promise.resolve();
  const sprite = new h.Sprite(); sprite.switchTo('呼吸', true);
  assert.equal(sprite.__codexSkinController.frame.style.backgroundSize, '400% 200%');
  assert.equal(sprite.__codexSkinController.frame.style.aspectRatio, '313.5 / 627');
  assert.equal(sprite.__codexSkinController.frame.style.animationDuration, '1s');
  sprite.dispose();
  const q = harness({ sisterLayer }); await Promise.resolve();
  const small = new q.Sprite(); small.switchTo('呼吸', true);
  assert.equal(small.__codexSkinController.frame.style.backgroundSize, '400% 400%');
  small.dispose();
});

test('专属profile改名为located后，仍按catalog空闲语义触发偶尔变身', async () => {
  const rects = [[54, 7, 269, 309], [357, 9, 258, 305], [652, 7, 267, 307], [959, 5, 265, 312]];
  const h = harness({ mode: 'occasional', random: () => 0, rects }); await Promise.resolve();
  const sprite = new h.Sprite(); sprite.switchTo('呼吸', true);
  const interval = [...h.timers].find(([, timer]) => timer.kind === 'interval'); h.runTimer(interval[0]);
  assert.equal(h.window.__codexSkinDebug.form, 'sister');
  sprite.dispose(); assert.equal(h.timers.size, 0);
});
