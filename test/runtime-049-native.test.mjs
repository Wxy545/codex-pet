import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { patchModularClient049, patchModularHelper049, validateModularOwnedElectron049 } from '../harness/modular-runtime-fix.mjs';
import { readUpstream, upstreamVersion } from './support/harness-upstream.mjs';

const options = { skip: upstreamVersion !== '0.4.9' };
const helperFiles = [
  'constants.js', 'index.html', 'sprite.js', 'sprite/bubble.js', 'sprite/input.js', 'sprite/window-fit.js',
  'sprite/playback.js', 'main/windows.js', 'main/ipc.js', 'main/displays.js', 'main/dpi.js', 'pointer-target.js',
  'preload.js', 'sprite/init.js', 'sprite/motion.js', 'sprite/menu.js', 'events.js', 'shared-core.js', 'renderer.js',
];

function runBlock(source, start, end, globals = {}) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return vm.runInNewContext(`(${source.slice(a, b + end.length)})`, globals);
}

test('049 桌面说话气泡保持穿透，工作跳转和余额翻页仍各走原入口', options, () => {
  const files = Object.fromEntries(helperFiles.map(name => [name, readUpstream('runtime/electron-helper/' + name)]));
  const fixed = patchModularHelper049(files);
  assert.deepEqual(patchModularHelper049(fixed), fixed);
  assert.throws(() => patchModularHelper049({ ...fixed, 'sprite/bubble.js': files['sprite/bubble.js'] }), /049-anchor-mismatch/);
  assert.throws(() => patchModularHelper049({ ...files, 'events.js': files['events.js'].replace('this.clearWhisper();', 'this.hideWhisper();') }), /anchor-mismatch/);
  assert.match(fixed['shared-core.js'], /PET_ALPHA_FIX_ENABLED = true/);
  assert.match(fixed['shared-core.js'], /MAX_RECORD_MS = 24e3/);
  assert.match(fixed['main/displays.js'], /writeCachedPrimaryScale\(real\)/);
  assert.doesNotMatch(fixed['main/displays.js'], /petWindows\.closeAll\(\)|petWindows\.create\(\)/);
  assert.equal(fixed['renderer.js'].match(/onPointerLeft/g)?.length, 1);

  function PetSprite() {}
  const toggles = new Map();
  const events = [];
  let click;
  const makeNode = () => ({
    style: { setProperty() {} }, setAttribute() {}, appendChild() {}, textContent: '',
    classList: { add() {}, remove() {}, toggle(name, value) { toggles.set(name, value); } },
    addEventListener(type, receive) { assert.equal(this.className, 'pet-bubble'); assert.equal(type, 'click'); click = receive; },
  });
  const context = vm.createContext({
    PetSprite, window: { __dshPetDebug: {} }, BASE: '',
    rootEl: { appendChild() {} },
    document: { createElement: makeNode },
    S: {
      HIT_BOX: { x0: 0, x1: 640, y0: 0, y1: 360 }, resolveFontPx: () => ({ bubble: 12, tip: 12 }),
      createMemeImage: () => null, getVoiceState: () => 'idle', customViews: () => null, balancePageCount: () => 2,
    },
  });
  for (const name of ['sprite/init.js', 'sprite/input.js', 'sprite/bubble.js']) vm.runInContext(fixed[name], context);
  const sprite = Object.assign(new PetSprite(), {
    pet: { name: '合成角色' }, size: 100, winOffset: { x: 0, y: 0 }, dragState: { active: false }, position() {}, syncInputBusy() {},
    openWorkSession: () => events.push('work'), toggleBalanceDetail: () => events.push('balance'),
    popWhisper: () => assert.fail('说话气泡不应创建戳破定时器'),
  });
  sprite.buildDom();
  assert.equal(typeof click, 'function');
  const e = { stopPropagation: () => events.push('stop'), preventDefault: () => events.push('prevent') };

  Object.assign(sprite, { whisperOn: true, whisperView: [{ text: '合成台词' }] });
  sprite.renderBubble();
  assert.equal(sprite.bubbleSlot, 'whisper');
  assert.equal(toggles.get('is-clickable'), false);
  assert.equal(sprite.inputBusy(), false);
  click(e);
  assert.deepEqual(events, []);

  Object.assign(sprite, { whisperOn: false, workOn: true, workText: '合成工作', workSessionId: 'synthetic' });
  sprite.renderBubble();
  assert.equal(toggles.get('is-clickable'), true);
  assert.equal(sprite.inputBusy(), true);
  click(e);
  Object.assign(sprite, { workOn: false, bubbleOn: true, balanceView: [], balanceState: {}, balanceViewIndex: 0 });
  context.S.balancePageView = () => [];
  sprite.renderBubble();
  assert.equal(toggles.get('is-clickable'), true);
  assert.equal(sprite.inputBusy(), true);
  click(e);
  assert.deepEqual(events, ['stop', 'prevent', 'work', 'stop', 'prevent', 'balance']);
});

test('049 Harness 网页沿用原聚焦、语音选择与配置保存边界', options, () => {
  const raw = readUpstream('lib/client.js');
  const fixed = patchModularClient049(raw);
  assert.equal(patchModularClient049(fixed), fixed);
  assert.throws(() => patchModularClient049(fixed.replace('const MAX_RECORD_MS = 24e3; // 保留原生录音体积与时长上限。', 'const MAX_RECORD_MS = 2e5;')), /049-anchor-mismatch/);
  assert.doesNotMatch(fixed, /fetch\(ROUTE_PATH \+ "\/voice\/hear-providers"\)|onPop: clearWhisper|h\(EnvironmentCard/);
  const shouldRemind = runBlock(fixed, 'function shouldRemind(whenFocused, pageActive) {', '\n}');
  assert.equal(shouldRemind(true, true), false);
  assert.equal(shouldRemind(false, false), true);
  const buildSaveBody = runBlock(fixed, 'function buildSaveBody(fields) {', '\n}');
  const body = buildSaveBody({ notifyWhenFocused: true, speechProvider: 'external', environmentCity: 'synthetic', voiceName: 'synthetic-legacy' });
  assert.equal(body.voiceName, 'synthetic-legacy');
  for (const key of ['notifyWhenFocused', 'speechProvider', 'environmentCity']) assert.equal(Object.hasOwn(body, key), false);
  const makeVoicePicker = runBlock(fixed, 'function makeVoicePicker(rt) {', '\n}', { makeSelect: () => 'select' });
  const picker = makeVoicePicker({ h: (_component, props) => props });
  const props = { options: [{ id: 'edge/synthetic-legacy', name: '原音色' }] };
  assert.equal(picker({ ...props, value: 'synthetic-legacy' }).value, 'edge/synthetic-legacy');
  assert.equal(picker({ ...props, value: 'synthetic-unknown' }).value, 'synthetic-unknown');
  assert.match(fixed, /PET_ALPHA_FIX_ENABLED = true/);
});

test('049 自有 Electron 装配保留宿主实际提供的入口', options, () => {
  for (const file of ['lib/index.js', 'lib/standalone.js']) {
    const raw = readUpstream(file);
    assert.equal(validateModularOwnedElectron049(raw), raw);
    assert.throws(() => validateModularOwnedElectron049(raw.replace('entry.open', '!entry.open')), /049-anchor-mismatch/);
    const resolve = runBlock(raw, 'function resolveDesktopSiteUrl(ctx, origin) {', '\n}', { ENTRY_URL_EVENT: 'webserver/entry-url' });
    const origin = 'https://synthetic.invalid';
    assert.equal(resolve({ connection: { authenticatedUrl: value => value + '/old-entry' } }, origin), origin + '/old-entry');
    assert.equal(resolve({ webServer: 'synthetic', emit(service, event, incoming, entries) {
      assert.equal(service, 'synthetic'); assert.equal(event, 'webserver/entry-url'); assert.equal(incoming, origin);
      entries.push({ open: false, url: origin + '/closed' }, { open: true, url: origin + '/entry' });
    } }, origin), origin + '/entry');
  }
});
