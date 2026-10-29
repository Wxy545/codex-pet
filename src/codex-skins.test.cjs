'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const actions = require('./skin-actions.cjs');
const catalog = require('./skin-action-catalog.json');
const { createSkinStore } = require('./codex-skins.cjs');
const Character = require('./codex-character.cjs');
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

test('旧形态选择只迁移为同角色Q，API拒绝旧形态且公开模型不含姐姐资源',async()=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'codex-q-only-'));
 try{
  const directory=join(dataRoot,'skins','white-dragon');await mkdir(directory,{recursive:true});
  const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(400,16);png.writeUInt32BE(400,20);
  await writeFile(join(directory,'sprites.png'),png);await writeFile(join(directory,'sister.png'),'old local art');
  await writeFile(join(directory,'manifest.json'),JSON.stringify({schemaVersion:1,profiles:{idle:{file:'sprites.png',frames:[[0,0],[1,0]],sisterFile:'sister.png',forms:{sister:{file:'sister.png',frames:[[0,0]],fps:1}}}}}));
  const hostRequest=async()=>({status:200,body:JSON.stringify({main:{animations:{idle:['呼吸'],moves:{actions:[]}}}})});
  for(const mode of ['sister','occasional']){
   await writeFile(join(dataRoot,'skins','selection.json'),JSON.stringify({character:'white-dragon',mode}));
   const store=createSkinStore({dataRoot,hostRequest});const model=await store.readModel(),dragon=model.characters.find(c=>c.id==='white-dragon');
   assert.deepEqual(model.selection,{character:'white-dragon',mode:'q'});assert.deepEqual(model.requestedSelection,model.selection);
   assert.equal(JSON.parse(await readFile(join(dataRoot,'skins','selection.json'),'utf8')).mode,'q');
   assert.deepEqual(dragon.available,{q:true});assert.deepEqual(Object.keys(dragon.coverage),['q']);assert.equal(dragon.assets['sister.png'],undefined);
   assert.equal(dragon.manifest.profiles.idle.forms,undefined);assert.equal(dragon.manifest.profiles.idle.sisterFile,undefined);
   await assert.rejects(store.select({character:'white-dragon',mode}),/invalid-skin-selection/);
  }
  assert.equal(await readFile(join(directory,'sister.png'),'utf8'),'old local art');
  assert.equal(actions.advanceTransformation,undefined);assert.equal(actions.isCalmMoment,undefined);assert.equal(actions.effectiveProfile,undefined);
 }finally{await rm(dataRoot,{recursive:true,force:true});}
});

test('透明WebM仅使用Q层，旧形态字段不进入模型且拒绝越界路径', () => {
  const input = { schemaVersion: 1, profiles: { idle: { type: 'video', file: 'q-idle.webm', sisterFile: 'sister.png', forms: { sister: { file: 'sister.png', columns: 4, rows: 2, frames: [[0,0],[1,0]], fps: 2 } } } }, actions: { '呼吸': { profile: 'idle', coverage: 'dedicated' } } };
  const manifest = actions.normalizeManifest(input);
  assert.deepEqual(manifest.profiles.idle, { type:'video', file:'q-idle.webm' });
  const assets = {...baseAssets,'q-idle.webm':{available:true,type:'video'}};
  assert.equal(actions.profileReady(manifest.profiles.idle,assets,'q'),true);
  assert.equal(actions.buildCoverage([{id:'呼吸',group:'idle'}],manifest,assets,'q').summary.dedicated,1);
  assert.equal(actions.profileReady(manifest.profiles.idle,baseAssets,'q'),false);
  const reused=structuredClone(input);reused.actions['别的动作']={profile:'idle',coverage:'dedicated'};
  assert.equal(actions.buildCoverage([{id:'呼吸',group:'idle'},{id:'别的动作'}],actions.normalizeManifest(reused),assets,'q').summary.dedicated,0);
  for (const file of ['../q.webm','C:/private.webm','bad.png']) assert.throws(()=>actions.normalizeManifest({schemaVersion:1,profiles:{idle:{type:'video',file}}}),/invalid-skin-manifest/);
  assert.throws(()=>actions.normalizeManifest({schemaVersion:1,profiles:{idle:{type:'video',file:'q.webm',frames:[[0,0]]}}}),/invalid-skin-manifest/);
});

test('本机视频素材仅接受WebM头，损坏文件不标为可用', async () => {
  const dataRoot=await mkdtemp(join(tmpdir(),'codex-skin-video-'));
  try {
    const directory=join(dataRoot,'skins','white-dragon');await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'manifest.json'),JSON.stringify({schemaVersion:1,profiles:{idle:{type:'video',file:'q-idle.webm',sisterFile:'sister.png'}}}));
    await writeFile(join(directory,'q-idle.webm'),Buffer.from('1a45dfa3934282847765626d000000000000','hex'));
    const store=createSkinStore({dataRoot});
    const model=await store.readModel();const dragon=model.characters.find(c=>c.id==='white-dragon');
    assert.equal(dragon.available.q,true);assert.equal(dragon.assets['q-idle.webm'].type,'video');
    await writeFile(join(directory,'q-idle.webm'),'not a webm');
    assert.equal((await store.readModel()).characters.find(c=>c.id==='white-dragon').available.q,false);
  } finally { await rm(dataRoot,{recursive:true,force:true}); }
});

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





async function fixture(t) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'codex-skin-test-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  await mkdir(join(dataRoot, 'skins', 'white-dragon'), { recursive: true });
  const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(1254, 16); png.writeUInt32BE(1254, 20);
  await writeFile(join(dataRoot, 'skins', 'white-dragon', 'sprites.png'), png);
  const hostRequest = async () => ({ status: 200, body: JSON.stringify({ main: { animations: { idle: ['呼吸'], moves: { actions: [] } } } }) });
  return { dataRoot, png, hostRequest };
}

test('两个宿主的新装形象与真实身份一致，已保存三角色选择逐字保留',async t=>{
 const options=await fixture(t),previous=process.env.CODEX_PET_HOST,directory=join(options.dataRoot,'skins/curly-sheep'),selection=join(options.dataRoot,'skins/selection.json');
 await mkdir(directory,{recursive:true});await writeFile(join(directory,'manifest.json'),JSON.stringify({schemaVersion:1,profiles:{idle:{type:'video',file:'q-idle.webm'}}}));
 const media=Buffer.from('1a45dfa3934282847765626d000000000000','hex');await writeFile(join(directory,'q-idle.webm'),media);
 try{
  for(const[host,expected]of [['workbuddy','curly-sheep'],['codex','white-dragon']]){
   process.env.CODEX_PET_HOST=host;const model=await createSkinStore(options).readModel(),identity=Character.readCharacter(options.dataRoot);assert.deepEqual(model.selection,identity.selection);assert.equal(model.selection.character,expected);
   await assert.rejects(readFile(selection));
   for(const id of ['white-dragon','bluefish','curly-sheep']){
    const saved=JSON.stringify({schemaVersion:1,character:id,mode:'q',userNote:'keep'});await writeFile(selection,saved);
    const existing=await createSkinStore(options).readModel();assert.deepEqual(existing.selection,{character:id,mode:'q'});assert.deepEqual(existing.selection,Character.readCharacter(options.dataRoot).selection);assert.equal(await readFile(selection,'utf8'),saved);
   }
   await rm(selection);
  }
  process.env.CODEX_PET_HOST='workbuddy';await writeFile(join(directory,'q-idle.webm'),'broken media');
  assert.deepEqual((await createSkinStore(options).readModel()).selection,{character:'bluefish',mode:'q'});assert.equal(Character.readCharacter(options.dataRoot).id,'bluefish');
  const saved=JSON.stringify({schemaVersion:1,character:'curly-sheep',mode:'q'});await writeFile(selection,saved);const missing=await createSkinStore(options).readModel();assert.equal(missing.selection.character,'bluefish');assert.equal(missing.requestedSelection.character,'curly-sheep');assert.equal(await readFile(selection,'utf8'),saved);
 }finally{if(previous===undefined)delete process.env.CODEX_PET_HOST;else process.env.CODEX_PET_HOST=previous;}
});

test('仅Q版形象选择落盘并重启恢复，旧形态请求始终拒绝', async t => {
  const options = await fixture(t), store = createSkinStore(options);
  assert.deepEqual((await store.readModel()).selection, { character: 'white-dragon', mode: 'q' });
  for(const mode of ['sister','occasional']) await assert.rejects(store.select({ character: 'white-dragon', mode }), /invalid-skin-selection/);
  await store.select({ character: 'white-dragon', mode: 'q' });
  const saved = JSON.parse(await readFile(join(options.dataRoot, 'skins', 'selection.json'), 'utf8'));
  assert.equal(saved.mode, 'q');
  const model = await createSkinStore(options).readModel();
  assert.deepEqual(model.selection,{character:'white-dragon',mode:'q'});
  assert.equal(model.characters.find(character => character.id === 'white-dragon').assets['sprites.png'].width, 1254);
  await store.select({character:'bluefish',mode:'q'});
  assert.deepEqual((await createSkinStore(options).readModel()).selection,{character:'bluefish',mode:'q'});
});

test('主进程忽略旧manifest的forms资源，仅加载Q层并保留本地文件', async t => {
  const options = await fixture(t), directory=join(options.dataRoot,'skins','white-dragon');
  const base = actions.defaultManifest().profiles.idle;
  await writeFile(join(directory,'adult.png'), options.png);
  await writeFile(join(directory,'manifest.json'),JSON.stringify({schemaVersion:1,profiles:{idle:{...base,sisterFile:'adult.png',forms:{sister:{file:'adult.png',columns:4,rows:2,frames:[[0,0],[1,0]],fps:2}}}}}));
  const model=await createSkinStore(options).readModel(),dragon=model.characters.find(character=>character.id==='white-dragon');
  assert.equal(dragon.assets['adult.png'],undefined);assert.deepEqual(dragon.available,{q:true});
  assert.equal(dragon.manifest.profiles.idle.forms,undefined);assert.equal(dragon.manifest.profiles.idle.sisterFile,undefined);
  assert.deepEqual(await readFile(join(directory,'adult.png')),options.png);
});
