'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ASSETS = Object.fromEntries(['idle', 'wing-care', 'magic', 'greeting'].map(key => [key, `file:///local/q-${key}.webm`]));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness({ locale = 'en', reason = 'preview', host = 'codex', reduced = false, assets = ASSETS, target = async () => ({ ready: true }), get, audio = true, audioFailure = false } = {}) {
  class Node {
    constructor() {
      this.listeners = new Map(); this.textContent = ''; this.attributes = new Map(); this.dataset = {};
      const values = new Set(); this.classList = { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value) };
    }
    addEventListener(key, fn) { if (!this.listeners.has(key)) this.listeners.set(key, new Set()); this.listeners.get(key).add(fn); }
    removeEventListener(key, fn) { this.listeners.get(key)?.delete(fn); }
    emit(key, value = {}) { for (const fn of [...(this.listeners.get(key) || [])]) fn(value); }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); if (key === 'src') this.src = ''; }
  }
  const nodes = Object.fromEntries(['scene', 'dragon', 'dragon-next', 'particles', 'skip', 'sound', 'ready-label', 'startup-brand', 'status', 'chapter-number'].map(id => [id, new Node()]));
  const videos = [nodes.dragon, nodes['dragon-next']], stats = { ready: 0, finishes: 0, target: 0 }, timers = new Map(), frames = new Map(), audios = [];
  const window = new Node(), document = new Node(); let now = 0, id = 0;
  for (const video of videos) {
    Object.assign(video, { readyState: 0, src: '', paused: true, currentTime: 0, loads: [], plays: 0, pauses: 0, heldPlays: [], deferPlay: false });
    video.load = () => { video.readyState = 0; video.currentTime = 0; video.loads.push(video.src); };
    video.play = () => { video.plays++; video.paused = false; if (!video.deferPlay) return Promise.resolve(); const call = deferred(); video.heldPlays.push(call); return call.promise; };
    video.pause = () => { video.pauses++; video.paused = true; };
  }
  nodes.particles.getContext = () => ({ clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillRect() {} });
  document.documentElement = {}; document.getElementById = name => nodes[name];
  window.matchMedia = () => ({ matches: reduced });
  class Audio {
    constructor() { this.destination = {}; this.oscillators = []; this.gains = []; this.resumes = 0; this.suspends = 0; this.closed = 0; audios.push(this); }
    get currentTime() { return now / 1000; }
    createGain() { const gain = { value: 0, targets: [], setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(value, at, smooth) { gain.targets.push({ value, at, smooth }); } }; this.gains.push(gain); return { gain, connect() {} }; }
    createOscillator() { if (audioFailure) throw Error('audio device unavailable'); const tone = { frequency: {}, connect() {}, start: at => { tone.startAt = at; }, stop: at => { tone.stopAt = at; } }; this.oscillators.push(tone); return tone; }
    resume() { this.resumes++; return Promise.resolve(); }
    suspend() { this.suspends++; return Promise.resolve(); }
    close() { this.closed++; return Promise.resolve(); }
  }
  if (audio) window.AudioContext = Audio;
  const value = { video: ASSETS.idle, assets, durationMs: 14400, locale, reason, host, copy: { skip: locale === 'zh-CN' ? '跳过' : 'Skip' } };
  window.startupScene = { get: get || (async () => value), ready: async () => { stats.ready++; }, finish: async () => { stats.finishes++; }, target: async () => { stats.target++; return target(); } };
  const context = { window, document, innerWidth: 1280, innerHeight: 800, performance: { now: () => now }, Math, console,
    setTimeout: (fn, ms) => { const key = ++id; timers.set(key, { fn, due: now + ms, ms }); return key; }, clearTimeout: key => timers.delete(key),
    requestAnimationFrame: fn => { const key = ++id; frames.set(key, fn); return key; }, cancelAnimationFrame: key => frames.delete(key) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'startup-window.js'), 'utf8'), context);
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  const advance = async ms => {
    const end = now + ms;
    for (let count = 0; count < 1000; count++) {
      const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) { now = end; await flush(); return; }
      now = next[1].due; timers.delete(next[0]); next[1].fn(); await flush();
    }
    throw Error('startup-test-timer-loop');
  };
  const decode = async index => { videos[index].readyState = 2; videos[index].emit('loadeddata'); await flush(); };
  const start = async () => { await flush(); await decode(0); };
  return { window, document, nodes, videos, stats, timers, frames, audios, flush, advance, decode, start, get now() { return now; }, visible: () => videos.filter(video => video.classList.contains('visible')) };
}

test('真实首帧和play成功才显示，loadeddata重入只开始一次，英文界面不夹中文', async () => {
  const h = harness(); await h.flush(); assert.equal(h.stats.ready, 0); assert.equal(h.videos[0].plays, 0);
  assert.equal(h.videos[0].muted, true); assert.equal(h.videos[0].loop, true); assert.equal(h.videos[0].src, ASSETS.idle);
  await h.decode(0); await h.decode(0);
  assert.equal(h.stats.ready, 1); assert.equal(h.videos[0].plays, 1); assert.equal(h.document.documentElement.lang, 'en');
  assert.equal(h.nodes.skip.textContent, 'Skip'); assert.equal(h.nodes.status.textContent, 'DRAGON AWAKENING');
  assert.equal(h.nodes['chapter-number'].textContent, '01'); assert.equal(h.nodes['ready-label'].textContent, 'READY WHEN YOU ARE');
  assert.ok(!/[\u3400-\u9fff]/u.test(Object.values(h.nodes).map(node => node.textContent).join('')));
});

test('自动演出显示Esc快捷键，未取焦点的预览只提示跳过按钮', async () => {
  const preview = harness(); await preview.start(); assert.equal(preview.nodes.skip.textContent, 'Skip');
  const launch = harness({ reason: 'codex', locale: 'zh-CN' }); await launch.start(); assert.equal(launch.nodes.skip.textContent, '跳过 · Esc');
});

test('14.4秒四阶段使用四段本地视频，双缓冲在play就绪后切换并停止旧媒体', async () => {
  const h = harness(); await h.start(); const [a, b] = h.videos;
  assert.equal(b.src, ASSETS['wing-care']); await h.decode(1); await h.advance(3399); assert.equal(h.nodes.status.textContent, 'DRAGON AWAKENING');
  await h.advance(1); assert.equal(h.nodes.status.textContent, 'NEURAL LINK'); assert.deepEqual(h.visible(), [b]);
  await h.advance(600); assert.equal(a.paused, true); assert.equal(a.src, ASSETS.magic); await h.decode(0);
  await h.advance(2600); assert.equal(h.nodes.status.textContent, 'A LITTLE MAGIC'); assert.deepEqual(h.visible(), [a]);
  await h.advance(600); assert.equal(b.paused, true); assert.equal(b.src, ASSETS.greeting); await h.decode(1);
  await h.advance(2900); assert.equal(h.nodes.status.textContent, 'READY'); assert.deepEqual(h.visible(), [b]);
  await h.advance(3249); assert.equal(h.nodes.scene.classList.contains('departing'), false);
  await h.advance(1); assert.equal(h.nodes.scene.classList.contains('departing'), true); assert.equal(h.stats.finishes, 0);
  await h.advance(1049); assert.equal(h.stats.finishes, 0); await h.advance(1); assert.equal(h.stats.finishes, 1);
  assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0); assert.ok(h.videos.every(video => video.paused && !video.src));
});

test('下一段慢解码保留旧人物，后续已就绪片段仍可继续且不显示空视频', async () => {
  const h = harness(); await h.start(); const [a, b] = h.videos;
  await h.advance(3400); assert.deepEqual(h.visible(), [a]); assert.equal(a.paused, false); assert.equal(b.plays, 0);
  await h.advance(1000); assert.equal(b.src, ASSETS.magic); assert.deepEqual(h.visible(), [a]);
  await h.decode(1); await h.advance(2200); assert.deepEqual(h.visible(), [b]); assert.equal(b.src, ASSETS.magic); assert.equal(b.readyState, 2);
});

test('共用fallback片段有两个待兑现play时，旧阶段不能回写当前槽或让预载清空可见帧', async () => {
  const h = harness({ assets: { idle: ASSETS.idle, greeting: ASSETS.greeting } }); await h.start(); const [a, b] = h.videos;
  await h.decode(1); b.deferPlay = true; await h.advance(3400); await h.advance(3200); assert.equal(b.heldPlays.length, 2);
  for (const call of b.heldPlays) call.resolve(); await h.flush(); assert.deepEqual(h.visible(), [b]);
  await h.advance(600);
  assert.equal(b.src, ASSETS.idle); assert.equal(b.readyState, 2); assert.equal(b.paused, false);
  assert.equal(a.src, ASSETS.greeting); assert.equal(a.classList.contains('visible'), false);
});

test('跳过不重入并移除双视频、窗口及按钮监听，清空所有定时器/帧/音频', async () => {
  const h = harness(); await h.start(); await h.decode(1); h.videos[1].deferPlay = true; await h.advance(3400);
  h.nodes.skip.emit('click'); h.document.emit('keydown', { key: 'Escape' }); h.window.emit('beforeunload');
  for (const call of h.videos[1].heldPlays) call.resolve(); await h.flush(); await h.advance(30000);
  assert.equal(h.stats.finishes, 1); assert.equal(h.stats.ready, 1); assert.equal(h.frames.size, 0); assert.equal(h.timers.size, 0);
  assert.ok(h.videos.every(video => video.paused && !video.src)); assert.equal(h.audios[0].closed, 1);
  for (const target of [h.window, h.document, ...h.videos, h.nodes.skip, h.nodes.sound]) assert.ok([...target.listeners.values()].every(listeners => listeners.size === 0));
  await h.decode(0); assert.equal(h.stats.ready, 1);
});

test('关闭早于get或首个play兑现时，迟到结果不重开演出或回报ready', async () => {
  const get = deferred(), h = harness({ get: () => get.promise }); h.nodes.skip.emit('click'); get.resolve({ locale: 'en', assets: ASSETS, copy: { skip: 'Skip' }, durationMs: 14400 }); await h.flush();
  assert.equal(h.stats.finishes, 1); assert.equal(h.stats.ready, 0); assert.equal(h.videos[0].loads.length, 1);
  const p = harness(); await p.flush(); p.videos[0].deferPlay = true; await p.decode(0); p.document.emit('keydown', { key: 'Escape' }); p.videos[0].heldPlays[0].resolve(); await p.flush();
  assert.equal(p.stats.finishes, 1); assert.equal(p.stats.ready, 0); assert.equal(p.timers.size, 0);
});

test('首片损坏只关闭一次；非活动预载片损坏不清空当前可见人物', async () => {
  const broken = harness(); await broken.flush(); broken.videos[0].emit('error'); broken.document.emit('keydown', { key: 'Escape' }); await broken.flush(); assert.equal(broken.stats.finishes, 1); assert.equal(broken.stats.ready, 0);
  const h = harness(); await h.start(); h.videos[1].emit('error'); assert.equal(h.stats.finishes, 0); assert.deepEqual(h.visible(), [h.videos[0]]);
});

test('合成音轨只建一次；静音只改gain而不暂停音轨时钟，关闭释放', async () => {
  const h = harness(); await h.start(); await h.decode(0); assert.equal(h.audios.length, 1);
  assert.equal(h.audios[0].oscillators.length, 11); assert.equal(h.nodes.sound.textContent, 'Sound on');
  await h.advance(2000); h.nodes.sound.emit('click'); assert.equal(h.nodes.sound.textContent, 'Sound off'); assert.equal(h.audios[0].suspends, 0);
  assert.equal(h.audios[0].gains[0].targets.at(-1).value, 0); await h.advance(1000); assert.equal(h.audios[0].currentTime, 3);
  h.nodes.sound.emit('click'); assert.equal(h.nodes.sound.textContent, 'Sound on'); assert.equal(h.audios[0].resumes, 2);
  assert.equal(h.audios[0].gains[0].targets.at(-1).value, .1); assert.equal(h.audios[0].gains[0].targets.at(-1).at, 3);
  assert.equal(h.audios[0].oscillators[3].startAt, 6.6); assert.equal(h.audios[0].oscillators[7].startAt, 10.15);
  h.nodes.skip.emit('click'); assert.equal(h.audios[0].closed, 1);
  const reduced = harness({ reduced: true, locale: 'zh-CN' }); await reduced.start();
  assert.equal(reduced.audios.length, 1); assert.equal(reduced.nodes.sound.textContent, '声音 开'); assert.equal(reduced.nodes.status.textContent, '龙息苏醒');
});

test('音轨设备或节点创建失败时关闭部分context，画面时间轴仍正常完成', async () => {
  const h = harness({ audioFailure: true }); await h.start(); assert.equal(h.nodes.sound.textContent, 'Sound off');
  assert.equal(h.audios[0].closed, 1); await h.advance(14400); assert.equal(h.stats.finishes, 1);
});

test('真正启动在目标就绪后退场，预览不调用目标探测', async () => {
  let ready = false; const h = harness({ reason: 'codex', target: async () => ({ ready }) }); await h.start(); await h.advance(13350);
  assert.equal(h.stats.target, 1); assert.equal(h.stats.finishes, 0); assert.equal(h.nodes.scene.classList.contains('departing'), false);
  ready = true; await h.advance(600); assert.equal(h.nodes.scene.classList.contains('departing'), true); await h.advance(1050); assert.equal(h.stats.finishes, 1);
  const preview = harness(); await preview.start(); await preview.advance(14400); assert.equal(preview.stats.target, 0); assert.equal(preview.stats.finishes, 1);
});

test('缺电影的WorkBuddy兼容Q演出显示正确宿主并等待它就绪', async () => {
  let ready = false; const h = harness({ host: 'workbuddy', reason: 'workbuddy', target: async () => ({ ready }) }); await h.start();
  assert.equal(h.document.title, 'Codex Pet · WorkBuddy'); assert.equal(h.nodes['startup-brand'].textContent, 'WorkBuddy'); assert.equal(h.nodes.scene.attributes.get('aria-label'), 'WorkBuddy');
  await h.advance(13350); assert.equal(h.stats.target, 1); assert.equal(h.stats.finishes, 0); ready = true; await h.advance(1650); assert.equal(h.stats.finishes, 1);
});

test('目标一直未就绪或探测拒绝时仍有界退场', async () => {
  for (const target of [async () => ({ ready: false }), async () => { throw Error('local probe unavailable'); }]) {
    const h = harness({ reason: 'codex', target }); await h.start(); await h.advance(22000);
    assert.equal(h.stats.finishes, 1); assert.equal(h.timers.size, 0); assert.ok(h.stats.target > 1);
  }
});

test('目标探测Promise不兑现也不能绕过页面等待上限，迟到响应不重复退场', async () => {
  const pending = deferred(), h = harness({ reason: 'codex', target: () => pending.promise }); await h.start(); await h.advance(22000);
  assert.equal(h.stats.finishes, 1); assert.equal(h.timers.size, 0); pending.resolve({ ready: true }); await h.flush(); await h.advance(2000); assert.equal(h.stats.finishes, 1);
});

test('单次读取到电影时撤销旧Q全部监听再委派，不重开旧视频或关闭电影', async () => {
  const h = harness({ get: async () => ({ film: true, video: 'file:///local/white-dragon-cinematic.webm', locale: 'en' }) });
  let delegated = 0;
  h.window.CodexStartupCinema = { play: ({ api, value }) => { delegated++; assert.equal(api, h.window.startupScene); assert.equal(value.film, true); } };
  await h.flush();
  assert.equal(delegated, 1); assert.equal(h.stats.ready, 0); assert.equal(h.stats.finishes, 0); assert.ok(h.videos.every(video => video.loads.length === 0));
  h.document.emit('keydown', { key: 'Escape' }); h.window.emit('beforeunload'); h.nodes.skip.emit('click');
  assert.equal(h.stats.finishes, 0);
  for (const target of [h.window, h.document, h.nodes.skip, h.nodes.sound]) assert.ok([...target.listeners.values()].every(list => list.size === 0));
});

test('电影模块缺失时有界关闭，早于scene返回的跳过不再委派', async () => {
  const missing = harness({ get: async () => ({ film: true }) }); await missing.flush(); assert.equal(missing.stats.finishes, 1);
  const pending = deferred(), early = harness({ get: () => pending.promise }); let delegated = 0; early.window.CodexStartupCinema = { play: () => delegated++ };
  early.nodes.skip.emit('click'); pending.resolve({ film: true }); await early.flush(); assert.equal(early.stats.finishes, 1); assert.equal(delegated, 0);
});
