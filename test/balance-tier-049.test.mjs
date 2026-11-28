import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { patchModularClient049, patchModularHelper049 } from '../harness/modular-runtime-fix.mjs';
import { readUpstream, upstreamVersion } from './support/harness-upstream.mjs';

const options = { skip: upstreamVersion !== '0.4.9' };
const helperNames = [
  'constants.js', 'index.html', 'sprite.js', 'sprite/bubble.js', 'sprite/input.js', 'sprite/window-fit.js',
  'sprite/playback.js', 'main/windows.js', 'main/ipc.js', 'main/displays.js', 'main/dpi.js', 'pointer-target.js',
  'preload.js', 'sprite/init.js', 'sprite/motion.js', 'sprite/menu.js', 'events.js', 'shared-core.js', 'renderer.js',
];
const nativeFiles = () => Object.fromEntries(helperNames.map(name => [name, readUpstream('runtime/electron-helper/' + name)]));
const money = tier => ({ ok: true, shape: 'money', wallets: [{ currency: 'CNY', total: '12.34' }], ...(tier ? { tier } : {}) });
const windows = { ok: true, shape: 'windows', rolling: 37 };
const custom = { ok: true, shape: 'custom', custom: { views: [{ tag: 'div', text: '第三方余额' }] } };

function region(source) {
  const start = source.indexOf('//#region src/client/bubble.ts');
  const end = source.indexOf('//#endregion', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function makeNode(tag = 'div') {
  const classes = new Set();
  let ownText = '';
  const node = {
    tag, children: [], dataset: {}, style: {},
    appendChild(child) { this.children.push(child); },
    append(...children) { this.children.push(...children); },
    classList: {
      add(...names) { for (const name of names) classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, on) { const enabled = on === undefined ? !classes.has(name) : !!on; enabled ? classes.add(name) : classes.delete(name); return enabled; },
    },
  };
  Object.defineProperties(node, {
    className: { get: () => [...classes].join(' '), set(value) { classes.clear(); for (const name of value.split(/\s+/).filter(Boolean)) classes.add(name); } },
    innerHTML: { set(value) { assert.equal(value, ''); this.children = []; ownText = ''; } },
    textContent: { get() { return ownText + this.children.map(child => child.textContent ?? '').join(''); }, set(value) { ownText = String(value); this.children = []; } },
  });
  return node;
}

function desktop(fixed) {
  function PetSprite() {}
  const context = vm.createContext({ PetSprite, window: { __dshPetDebug: {} }, BASE: '', document: { createElement: makeNode } });
  // 余额行由真实上游处理器计算，合成的服务商数据不经过任何账号或网络接口。
  vm.runInContext(readUpstream('runtime/electron-helper/shared-core.js'), context);
  context.S = context.PetShared;
  context.S.createMemeImage = () => null;
  context.S.getVoiceState = () => 'idle';
  vm.runInContext(fixed['sprite/bubble.js'], context);
  const sprite = Object.assign(new PetSprite(), {
    bubble: makeNode(), balanceViewIndex: 0, balanceView: [], bubbleOn: true,
    syncInputBusy() {}, workClickable: () => false, balanceClickable: () => false,
    renderTree(tree) { const node = makeNode(tree.tag); node.textContent = tree.text; return node; },
  });
  return sprite;
}

function web(fixed) {
  const styles = [];
  const shared = vm.createContext({});
  vm.runInContext(readUpstream('runtime/electron-helper/shared-core.js'), shared);
  const context = vm.createContext({
    ROUTE_PATH: '/synthetic', BALANCE_FADE_MS: 250,
    balancePageView: shared.PetShared.balancePageView,
    customViews: shared.PetShared.customViews,
    customClickable: shared.PetShared.customClickable,
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {} }),
      head: { appendChild: style => styles.push(style) },
    },
  });
  vm.runInContext(region(fixed) + '\nglobalThis.balanceFactory = makeBalanceBubble;', context);
  const h = (tag, props) => ({ tag, ...props });
  const Balance = context.balanceFactory({ h, useState: value => [value, () => {}], useEffect() {} });
  return { render: state => Balance({ state, on: true, index: 0, onCycle() {} }), css: styles[0].textContent };
}

test('049 桌面峰谷余额使用专用行，切换内容后不残留档位样式', options, () => {
  const fixed = patchModularHelper049(nativeFiles());
  const sprite = desktop(fixed);
  for (const tier of ['peak', 'idle']) {
    sprite.balanceState = money(tier);
    sprite.renderBubble();
    assert.equal(sprite.bubble.classList.contains('is-tier'), true);
    const row = sprite.bubble.children[0];
    assert.equal(row.classList.contains('pet-bub-tier-line'), true);
    assert.equal(row.children[1].classList.contains('pet-bub-tier-' + tier), true);
    assert.equal(sprite.bubble.textContent, '余额（' + (tier === 'peak' ? '峰' : '谷') + '）¥12.34');
  }
  // 待办面板由外部挂入；切换样式不能重新生成或清掉其已有节点。
  const todo = makeNode('section');
  todo.textContent = '合成待办面板';
  sprite.bubble.innerHTML = '';
  sprite.bubble.appendChild(todo);
  sprite.todoOpen = true;
  sprite.renderBubble();
  assert.equal(sprite.bubble.classList.contains('is-tier'), false);
  assert.equal(sprite.bubble.classList.contains('dsh-pet-todo-bubble'), true);
  assert.equal(sprite.bubble.classList.contains('is-on'), true);
  assert.equal(sprite.bubble.children.length, 1);
  assert.equal(sprite.bubble.children[0], todo);
  assert.equal(sprite.bubble.textContent, '合成待办面板');
  sprite.todoOpen = false;
  sprite.balanceState = money('peak');
  sprite.renderBubble();
  assert.equal(sprite.bubble.classList.contains('is-tier'), true);
  assert.equal(sprite.bubble.classList.contains('dsh-pet-todo-bubble'), false);
  assert.equal(sprite.bubble.classList.contains('is-on'), true);
  assert.notEqual(sprite.bubble.children[0], todo);
  assert.equal(sprite.bubble.textContent, '余额（峰）¥12.34');
  for (const state of [money(), windows, { ok: true, shape: 'points', points: { total: '44', unit: '积分' } }, custom, { ok: false, reason: 'credential-missing' }]) {
    sprite.balanceState = money('peak'); sprite.renderBubble();
    sprite.balanceState = state; sprite.renderBubble();
    assert.equal(sprite.bubble.classList.contains('is-tier'), false);
    assert.equal(sprite.bubble.children.some(row => row.classList.contains('pet-bub-tier-line')), false);
    assert.equal(sprite.bubble.classList.contains('is-on'), true);
    if (state === custom) assert.equal(sprite.bubble.textContent, '第三方余额');
  }
  for (const slot of ['work', 'whisper']) {
    Object.assign(sprite, { bubbleOn: true, workOn: false, whisperOn: false, balanceState: money('peak') });
    sprite.renderBubble();
    // 隐藏和其他内容都不能继续使用前一份余额的档位样式。
    sprite.bubbleOn = false; sprite.renderBubble();
    assert.equal(sprite.bubbleSlot, 'none');
    assert.equal(sprite.bubble.classList.contains('is-on'), false);
    assert.equal(sprite.bubble.classList.contains('is-tier'), false);
    Object.assign(sprite, slot === 'work' ? { workOn: true, workText: '合成工作' } : { whisperOn: true, whisperView: [{ text: '合成碎念' }] });
    sprite.renderBubble();
    assert.equal(sprite.bubbleSlot, slot);
    assert.equal(sprite.bubble.classList.contains('is-tier'), false);
    assert.equal(sprite.bubble.classList.contains('is-on'), true);
  }
});

test('049 Harness 网页仅真实档位行扩宽，窗口额度和第三方节点保持原排版', options, () => {
  const view = web(patchModularClient049(readUpstream('lib/client.js')));
  for (const tier of ['peak', 'idle']) {
    const node = view.render(money(tier));
    assert.match(node.className, /\bis-tier\b/);
    assert.equal(node.children.className, 'pet-bub-row pet-bub-tier-line');
    assert.equal(node.children.children[1].className, 'pet-bub-tier pet-bub-tier-' + tier);
    assert.equal(node.children.children.map(child => child.children).join(''), '余额（' + (tier === 'peak' ? '峰' : '谷') + '）¥12.34');
  }
  for (const state of [money(), windows, custom, { ok: false, reason: 'unsupported', provider: 'synthetic' }]) {
    const node = view.render(state);
    assert.doesNotMatch(node.className, /\bis-tier\b/);
    if (state === custom) assert.equal(node.children.children[0], '第三方余额');
  }
  assert.match(view.css, /\.dsh-pet-bubble \.pet-bub-row\{[^}]*justify-content:space-between/);
  assert.match(view.css, /\.dsh-pet-bubble \.pet-bub-tier-line\{justify-content:flex-start\}/);
  assert.match(view.css, /\.dsh-pet-bubble\.is-tier\{max-width:min\(calc\(var\(--f\)\*16\),calc\(var\(--dsh-pet-size\)\*2 - var\(--f\)\*0\.6593\*2\)\)\}/);
});

test('049 桌面档位补丁整组幂等，旧完整准备产物可升级，半组及未知函数停止', options, () => {
  const raw = nativeFiles();
  const fixed = patchModularHelper049(raw);
  assert.deepEqual(patchModularHelper049(fixed), fixed);
  // 旧049仅修改点击策略；还原本轮气泡文件与CSS即可构造其完整产物。
  const oldBubble = raw['sprite/bubble.js'].replace(
    "    // 说话气泡同样可点：点下去就是戳破（分流在 init.js，动作是 popWhisper）。\n    const clickable = (slot === 'balance' && this.balanceClickable()) || workClickable || this.whisperClickable();",
    "    // 只有余额和工作气泡保留原来的点击动作。\n    const clickable = (slot === 'balance' && this.balanceClickable()) || workClickable;",
  );
  assert.notEqual(oldBubble, raw['sprite/bubble.js']);
  const oldComplete = { ...fixed, 'index.html': raw['index.html'], 'sprite/bubble.js': oldBubble };
  assert.deepEqual(patchModularHelper049(oldComplete), fixed);
  for (const partial of [
    { ...fixed, 'index.html': raw['index.html'] },
    { ...fixed, 'sprite/bubble.js': oldBubble },
    { ...fixed, 'sprite/bubble.js': fixed['sprite/bubble.js'].replace('pet-bub-row pet-bub-tier-line', 'pet-bub-row') },
    { ...fixed, 'sprite/bubble.js': fixed['sprite/bubble.js'].replace('span.textContent = r.text;', 'span.textContent = String(r.text);') },
    { ...fixed, 'index.html': fixed['index.html'].replace(/(\.pet-bub-tier-line\s*\{[^}]*\})/, '$1\n$1') },
  ]) assert.throws(() => patchModularHelper049(partial), /anchor-mismatch/);
});

test('049 网页档位补丁整组幂等，兼容旧完整补丁并拒绝未知余额函数', options, () => {
  const raw = readUpstream('lib/client.js');
  const fixed = patchModularClient049(raw);
  assert.equal(patchModularClient049(fixed), fixed);
  const oldComplete = fixed.replace(region(fixed), region(raw));
  assert.notEqual(oldComplete, fixed);
  assert.equal(patchModularClient049(oldComplete), fixed);
  for (const partial of [
    fixed.replace('pet-bub-row pet-bub-tier-line', 'pet-bub-row'),
    fixed.replace(/\.dsh-pet-bubble \.pet-bub-tier-line\{justify-content:flex-start\}/, ''),
    fixed.replace('const rows = isCustom ? [] : balancePageView(state, shown);', 'const rows = isCustom ? [] : balancePageView(state, 0);'),
    fixed.replace('function rowsToNodes(h, rows) {', 'function rowsToNodes(h, rows) {\n\trows = [];'),
  ]) {
    assert.notEqual(partial, fixed);
    assert.throws(() => patchModularClient049(partial), /anchor-mismatch/);
  }
});
