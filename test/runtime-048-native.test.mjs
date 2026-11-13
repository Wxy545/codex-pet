import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import vm from 'node:vm';
import { patchModularClient048, patchModularHelper048 } from '../harness/modular-runtime-fix.mjs';
import { readUpstream, upstreamVersion } from './support/harness-upstream.mjs';

const options = { skip: upstreamVersion !== '0.4.8' };
const helperFiles = [
  'index.html', 'sprite.js', 'sprite/input.js', 'sprite/window-fit.js', 'sprite/playback.js',
  'main/windows.js', 'main/ipc.js', 'main/displays.js', 'main/dpi.js', 'pointer-target.js',
  'preload.js', 'sprite/init.js', 'sprite/motion.js', 'sprite/menu.js', 'events.js', 'shared-core.js', 'renderer.js',
];
const readHelper = () => Object.fromEntries(helperFiles.map(name => [name, readUpstream(`runtime/electron-helper/${name}`)]));

test('048 显示器事件合并并向原窗口推送几何，缩放变更只写缓存', options, async () => {
  const files = patchModularHelper048(readHelper());
  const module = { exports: {} };
  const timers = new Map();
  vm.runInNewContext(files['main/displays.js'], {
    module, console: { error() {} },
    setTimeout(run, delay) { const id = { unref() {} }; timers.set(id, { run, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const screen = new EventEmitter();
  const geometry = { width: 3440, height: 1440 };
  const pushed = [];
  const written = [];
  let completeProbe;
  let probes = 0;
  const win = { isDestroyed: () => false, webContents: { send: (...args) => pushed.push(args) } };
  const stale = { isDestroyed: () => true };
  const bounds = new Map([['pet', {}]]);
  const dpi = {
    forcedScale: 1.25, primaryScale: 1.25,
    probePrimaryScaleAsync() { probes++; return new Promise(resolve => { completeProbe = resolve; }); },
    writeCachedPrimaryScale(value) { written.push(value); return true; },
    setPrimaryScale() { assert.fail('当前会话不能改倍数'); },
  };
  const sync = module.exports.createDisplaySync({ screen, dpi, petWindows: {
    geometry: () => geometry, keepOffTaskbar(target) { assert.equal(target, win); },
    state: { windows: new Map([['pet', win], ['closed', stale]]), lastRequestedBounds: bounds },
    closeAll() { assert.fail('不能关闭当前窗口'); }, create() { assert.fail('不能重建当前窗口'); },
  } });
  const runTimer = delay => {
    assert.equal(timers.size, 1);
    const [id, timer] = timers.entries().next().value;
    assert.equal(timer.delay, delay);
    timers.delete(id);
    timer.run();
  };
  assert.equal(timers.size, 0);
  screen.emit('display-added');
  screen.emit('display-metrics-changed');
  runTimer(300);
  assert.equal(bounds.size, 0);
  assert.deepEqual(pushed, [['pet:displays', geometry]]);
  runTimer(1000);
  sync.verifyPrimaryScale();
  assert.equal(probes, 1);
  completeProbe(1.5);
  await Promise.resolve();
  assert.deepEqual(written, [1.5]);
  assert.equal(dpi.primaryScale, 1.25);
});

test('048 保留透明滤镜和余额菜单，拒绝混装桌面或网页补丁', options, () => {
  const raw = readHelper();
  const fixed = patchModularHelper048(raw);
  assert.deepEqual(patchModularHelper048(fixed), fixed);
  assert.throws(() => patchModularHelper048({ ...fixed, 'main/displays.js': raw['main/displays.js'] }), /048-anchor-mismatch/);
  assert.match(fixed['shared-core.js'], /PET_ALPHA_FIX_ENABLED = true/);
  assert.match(fixed['index.html'], /html\.pet-alpha-fix video\.pet-video/);
  assert.doesNotMatch(fixed['sprite/init.js'], /onPointerLeft/);
  assert.equal(fixed['renderer.js'].match(/onPointerLeft/g)?.length, 1);
  const web = readUpstream('lib/client.js');
  const patched = patchModularClient048(web);
  assert.equal(patchModularClient048(patched), patched);
  assert.match(patched, /PET_ALPHA_FIX_ENABLED = true/);
  assert.match(patched, /action: "show-balance"/);
  assert.doesNotMatch(patched, /action: "show-environment"/);
  assert.throws(() => patchModularClient048(web.replace('PET_ALPHA_FIX_ENABLED = false;', 'PET_ALPHA_FIX_ENABLED = true; // 保留已验证的原视频透明修正。')), /048-anchor-mismatch/);
});
