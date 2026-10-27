'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const actions = require('./skin-actions.cjs');
const catalog = require('./skin-action-catalog.json');
const { createSkinStore } = require('./codex-skins.cjs');
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('动作目录保留事件候选槽位、移动参数及唯一ID，不漏掉非随机动作', () => {
  const result = actions.catalogFromAnimations({ idle: ['呼吸'], turn: ['转向'], drag: ['抓起'], clicks: ['挥手'], moves: { default: { leadSec: 2 }, actions: [{ name: '走路' }] }, categories: [{ id: '玩耍', actions: ['魔方'] }], events: { workStatus: [['思考甲', '思考乙'], '工作'] } });
  assert.equal(result.length, 9);
  assert.equal(result.find(entry => entry.id === '思考乙')?.slot, 0);
  assert.equal(result.find(entry => entry.id === '走路')?.params.leadSec, 2);
  assert.equal(catalog.total, 106);
  assert.equal(new Set(catalog.actions.map(entry => entry.id)).size, 106);
});

const baseAssets = { 'sprites.png': { available: true, width: 1254, height: 1254 }, 'sister.png': { available: true, width: 1254, height: 1254 } };

test('16帧基础样稿支持106动作的代用映射，但专属动画完成数必须是0', () => {
  const manifest = actions.normalizeManifest();
  const coverage = actions.buildCoverage(catalog.actions, manifest, baseAssets, 'q');
  assert.equal(Object.values(manifest.profiles).reduce((sum, profile) => sum + profile.frames.length, 0), 16);
  assert.deepEqual(coverage.summary, { total: 106, dedicated: 0, shared: 106, missing: 0 });
  assert.equal(coverage.actions.find(entry => entry.id === '螃蟹走路').profile, 'walk');
  assert.equal(coverage.actions.find(entry => entry.id === '工作状态-忙碌点按').profile, 'working');
  assert.equal(coverage.actions.find(entry => entry.id === '工作状态-垂头叹气冒汗').profile, 'error');
});

test('只有唯一动作明确绑定的多帧专属素材才计入完成，共用或缺失素材不冒充专属', () => {
  const input = { schemaVersion: 1, profiles: { wave: { file: 'interaction.png', sisterFile: 'interaction-sister.png', columns: 4, rows: 4, frames: [[0, 0], [1, 0], [2, 0], [3, 0]], fps: 6 } }, actions: { '点击回应-元气挥手': { profile: 'wave', coverage: 'dedicated' } } };
  const assets = { ...baseAssets, 'interaction.png': { available: true, width: 1024, height: 1024 } };
  assert.equal(actions.buildCoverage(catalog.actions, actions.normalizeManifest(input), assets, 'q').summary.dedicated, 1);
  assert.equal(actions.buildCoverage(catalog.actions, actions.normalizeManifest(input), assets, 'sister').summary.dedicated, 0);
  input.actions['点击回应-开心跃动'] = { profile: 'wave', coverage: 'dedicated' };
  assert.equal(actions.buildCoverage(catalog.actions, actions.normalizeManifest(input), assets, 'q').summary.dedicated, 0);
  input.profiles.waveCopy = input.profiles.wave;
  input.actions['点击回应-开心跃动'].profile = 'wavecopy';
  input.profiles.wavecopy = input.profiles.wave;
  delete input.profiles.waveCopy;
  assert.equal(actions.buildCoverage(catalog.actions, actions.normalizeManifest(input), assets, 'q').summary.dedicated, 0);
});

test('清单拒绝路径越界、非法网格和帧坐标，不把任意本机文件暴露给renderer', () => {
  for (const profile of [
    { file: '../private.png', frames: [[0, 0]] },
    { file: 'a.png', columns: 0, frames: [[0, 0]] },
    { file: 'a.png', columns: 4, rows: 4, frames: [[4, 0]] },
  ]) assert.throws(() => actions.normalizeManifest({ schemaVersion: 1, profiles: { bad: profile } }), /invalid-skin-manifest/);
});

test('rects必须逐帧对应、使用整数正尺寸，并在已读取的PNG边界内', () => {
  const profile = { file: 'sprites.png', sisterFile: 'sister.png', frames: [[0, 0], [1, 0]], rects: [[54, 7, 269, 309], [357, 9, 258, 305]] };
  const manifest = actions.normalizeManifest({ schemaVersion: 1, profiles: { located: profile } });
  assert.deepEqual(manifest.profiles.located.rects, profile.rects);
  assert.equal(actions.profileReady(manifest.profiles.located, baseAssets, 'q'), true);
  for (const rects of [[[0, 0, 10, 10]], [[-1, 0, 10, 10], [1, 1, 1, 1]], [[0, 0, 0, 10], [1, 1, 1, 1]], [[0.5, 0, 10, 10], [1, 1, 1, 1]]]) assert.throws(() => actions.normalizeManifest({ schemaVersion: 1, profiles: { located: { ...profile, rects } } }), /invalid-skin-manifest/);
  const outside = actions.normalizeManifest({ schemaVersion: 1, profiles: { located: { ...profile, rects: [[1250, 0, 10, 10], [1, 1, 1, 1]] } } });
  assert.equal(actions.profileReady(outside.profiles.located, baseAssets, 'q'), false);
});

test('rects才是真实取帧来源，改无关frames或profile名字不能重复计专属', () => {
  const first = { file: 'sprites.png', sisterFile: 'sister.png', frames: [[0, 0], [1, 0]], rects: [[0, 0, 100, 100], [100, 0, 100, 100]] };
  const manifest = actions.normalizeManifest({ schemaVersion: 1, profiles: { first, second: { ...first, frames: [[2, 0], [3, 0]] } }, actions: { a: { profile: 'first', coverage: 'dedicated' }, b: { profile: 'second', coverage: 'dedicated' } } });
  const report = actions.buildCoverage([{ id: 'a' }, { id: 'b' }], manifest, baseAssets, 'q');
  assert.equal(report.summary.dedicated, 0);
});

test('姐姐可独立使用4x2竖长格，Q保留原4x4；姐姐基础覆盖不继承Q的专属计数', () => {
  const base = actions.defaultManifest().profiles.idle;
  const manifest = actions.normalizeManifest({ schemaVersion: 1, profiles: { idle: { ...base, forms: { sister: { file: 'adult.png', columns: 4, rows: 2, frames: [[0, 0], [1, 0]], fps: 2 } } } }, actions: { '呼吸': { profile: 'idle', coverage: 'dedicated' } } });
  const assets = { ...baseAssets, 'adult.png': baseAssets['sister.png'] };
  const q = actions.effectiveProfile(manifest.profiles.idle, 'q');
  const sister = actions.effectiveProfile(manifest.profiles.idle, 'sister');
  assert.equal(q.rows, 4); assert.equal(q.frames.length, 4); assert.equal(q.file, 'sprites.png');
  assert.equal(sister.rows, 2); assert.equal(sister.frames.length, 2); assert.equal(sister.file, 'adult.png');
  assert.equal(actions.profileReady(manifest.profiles.idle, assets, 'sister'), true);
  assert.equal(actions.buildCoverage([{ id: '呼吸', group: 'idle' }], manifest, assets, 'q').summary.dedicated, 1);
  assert.equal(actions.buildCoverage([{ id: '呼吸', group: 'idle' }], manifest, assets, 'sister').summary.dedicated, 0);
  assert.equal(actions.buildCoverage([{ id: '呼吸', group: 'idle' }], manifest, assets, 'sister').summary.shared, 1);
});

test('新姐姐层不误继承Q的rects，非法或嵌套形态覆盖明确拒绝', () => {
  const profile = { file: 'sprites.png', sisterFile: 'sister.png', columns: 4, rows: 4, frames: [[0, 0], [1, 0]], rects: [[0, 0, 200, 300], [320, 0, 200, 300]], forms: { sister: { file: 'sister.png', columns: 4, rows: 2, frames: [[2, 1]], fps: 1 } } };
  const manifest = actions.normalizeManifest({ schemaVersion: 1, profiles: { located: profile } });
  assert.equal(actions.effectiveProfile(manifest.profiles.located, 'sister').rects, undefined);
  const legacy = actions.normalizeManifest({ schemaVersion: 1, profiles: { located: { ...profile, forms: undefined } } });
  assert.equal(actions.effectiveProfile(legacy.profiles.located, 'sister').rects, undefined);
  assert.throws(() => actions.normalizeManifest({ schemaVersion: 1, profiles: { located: { ...profile, forms: { sister: { ...profile.forms.sister, frames: [[0, 2]] } } } } }), /invalid-skin-manifest/);
  assert.throws(() => actions.normalizeManifest({ schemaVersion: 1, profiles: { located: { ...profile, forms: { sister: { ...profile.forms.sister, forms: { sister: {} } } } } } }), /invalid-skin-manifest/);
});

test('偶尔变身只在安全时小概率触发，持续7至10秒且结束后冷却至少90秒', () => {
  const first = actions.advanceTransformation({ mode: 'occasional', state: {}, safe: true, now: 100000, random: () => 0 });
  assert.deepEqual(first, { form: 'sister', until: 107000, nextEligibleAt: 197000 });
  const expired = actions.advanceTransformation({ mode: 'occasional', state: first, safe: true, now: 107001, random: () => 0 });
  assert.equal(expired.form, 'q');
  assert.equal(actions.advanceTransformation({ mode: 'occasional', state: expired, safe: true, now: 196999, random: () => 0 }).form, 'q');
  assert.equal(actions.advanceTransformation({ mode: 'occasional', state: expired, safe: true, now: 197000, random: () => 0 }).form, 'sister');
  assert.equal(actions.advanceTransformation({ mode: 'occasional', state: first, safe: false, now: 100500, random: () => 0 }).form, 'q');
});

test('纯Q与纯姐姐不会随机变身；任务、菜单、拖拽、飞行和漫游不触发', () => {
  const failRandom = () => { throw new Error('random-not-allowed'); };
  for (const mode of ['q', 'sister']) assert.equal(actions.advanceTransformation({ mode, state: {}, safe: true, now: 1, random: failRandom }).form, mode);
  for (const sprite of [
    { workState: 'working' }, { menuOpen: true }, { chatOpen: true }, { dragState: { active: true } }, { moveRef: 1 }, { throwRef: 1 }, { frozen: true },
  ]) assert.equal(actions.isCalmMoment(sprite, 'idle'), false);
  assert.equal(actions.isCalmMoment({ workState: 'success' }, 'success'), true);
  assert.equal(actions.isCalmMoment({}, 'idle'), true);
  assert.equal(actions.isCalmMoment({}, 'working'), false);
});

async function fixture(t) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'codex-skin-test-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  await mkdir(join(dataRoot, 'skins', 'white-dragon'), { recursive: true });
  const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(1254, 16); png.writeUInt32BE(1254, 20);
  await writeFile(join(dataRoot, 'skins', 'white-dragon', 'sprites.png'), png);
  const hostRequest = async () => ({ status: 200, body: JSON.stringify({ main: { animations: { idle: ['呼吸'], moves: { actions: [] } } } }) });
  return { dataRoot, png, hostRequest };
}

test('形象选择落盘并重启恢复，原大肥鱼Q始终可选，未准备的姐姐素材不能选择', async t => {
  const options = await fixture(t);
  const store = createSkinStore(options);
  assert.deepEqual((await store.readModel()).selection, { character: 'white-dragon', mode: 'q' });
  await assert.rejects(store.select({ character: 'white-dragon', mode: 'sister' }), /skin-unavailable/);
  await store.select({ character: 'bluefish', mode: 'q' });
  assert.deepEqual((await createSkinStore(options).readModel()).selection, { character: 'bluefish', mode: 'q' });
  await writeFile(join(options.dataRoot, 'skins', 'white-dragon', 'sister.png'), options.png);
  await store.select({ character: 'white-dragon', mode: 'occasional' });
  const saved = JSON.parse(await readFile(join(options.dataRoot, 'skins', 'selection.json'), 'utf8'));
  assert.equal(saved.mode, 'occasional');
  const model = await createSkinStore(options).readModel();
  assert.equal(model.characters.find(character => character.id === 'white-dragon').assets['sprites.png'].width, 1254);
});

test('主进程按姐姐有效profile收集独立图片，不会只加载旧sisterFile', async t => {
  const options = await fixture(t);
  const base = actions.defaultManifest().profiles.idle;
  await writeFile(join(options.dataRoot, 'skins', 'white-dragon', 'adult.png'), options.png);
  await writeFile(join(options.dataRoot, 'skins', 'white-dragon', 'manifest.json'), JSON.stringify({ schemaVersion: 1, profiles: { idle: { ...base, forms: { sister: { file: 'adult.png', columns: 4, rows: 2, frames: [[0, 0], [1, 0]], fps: 2 } } } } }));
  const model = await createSkinStore(options).readModel();
  const dragon = model.characters.find(character => character.id === 'white-dragon');
  assert.equal(dragon.assets['adult.png']?.available, true);
  assert.equal(dragon.available.sister, true);
});
