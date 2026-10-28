import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { seedBundledWhiteDragon } from '../scripts/bundled-skins.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex-pet-bundled-skin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'assets', 'white-dragon');
  await mkdir(source, { recursive: true });
  const manifest = { schemaVersion: 1, profiles: { idle: { type: 'video', file: 'q-idle.webm' }, work: { type: 'video', file: 'q-working.webm' } }, actions: { idle: { profile: 'idle', coverage: 'dedicated' }, work: { profile: 'work', coverage: 'dedicated' } } };
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(source, 'NOTICE.md'), '角色素材来源与项目使用授权。\n');
  await writeFile(join(source, 'q-idle.webm'), 'idle media');
  await writeFile(join(source, 'q-working.webm'), 'work media');
  await writeFile(join(source, 'old-prototype.png'), 'not published');
  const files = Object.fromEntries(await Promise.all(['manifest.json','NOTICE.md','q-idle.webm','q-working.webm'].map(async name => [name,createHash('sha256').update(await readFile(join(source,name))).digest('hex')])));
  return { root, source, target: join(root, 'data', 'skins', 'white-dragon'), manifest, baseline: { schemaVersion:1, version:'0.3.0-fixture', files } };
}

test('新安装只复制清单引用媒体与署名文件，不复制旧原型或写选择', async t => {
  const f = await fixture(t);
  assert.equal((await seedBundledWhiteDragon({ projectRoot: f.root, baseline:f.baseline })).status, 'installed');
  assert.deepEqual((await readdir(f.target)).sort(), ['NOTICE.md', 'manifest.json', 'q-idle.webm', 'q-working.webm']);
  assert.equal(await readFile(join(f.target, 'q-idle.webm'), 'utf8'), 'idle media');
  await assert.rejects(access(join(f.root, 'data', 'skins', 'selection.json')));
});

test('已有角色目录、选择和用户文件原样保留，重复prepare不覆盖', async t => {
  const f = await fixture(t);
  await mkdir(f.target, { recursive: true });
  await writeFile(join(f.target, 'manifest.json'), 'user manifest');
  await writeFile(join(f.root, 'data', 'skins', 'selection.json'), 'user selection');
  assert.equal((await seedBundledWhiteDragon({ projectRoot: f.root, baseline:f.baseline })).status, 'preserved');
  assert.equal(await readFile(join(f.target, 'manifest.json'), 'utf8'), 'user manifest');
  assert.equal(await readFile(join(f.root, 'data', 'skins', 'selection.json'), 'utf8'), 'user selection');
  assert.deepEqual(await readdir(f.target), ['manifest.json']);
});

test('缺少素材或越界文件名在创建目标前失败，不留下半套素材', async t => {
  const f = await fixture(t);
  await rm(join(f.source, 'q-working.webm'));
  await assert.rejects(seedBundledWhiteDragon({ projectRoot: f.root, baseline:f.baseline }));
  await assert.rejects(access(f.target));
  f.manifest.profiles.work.file = '../private.webm';
  await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest));
  await assert.rejects(seedBundledWhiteDragon({ projectRoot: f.root, baseline:f.baseline }), /invalid-skin-manifest/);
  await assert.rejects(access(f.target));
});

test('仓库未含公开素材时不生成角色数据，显式dataRoot可用于迁移安装', async t => {
  const f = await fixture(t);
  const dataRoot = join(f.root, 'other-data');
  await seedBundledWhiteDragon({ projectRoot: f.root, dataRoot, baseline:f.baseline });
  assert.equal(await readFile(join(dataRoot, 'skins', 'white-dragon', 'q-idle.webm'), 'utf8'), 'idle media');
  await rm(join(f.root, 'assets'), { recursive: true });
  assert.equal((await seedBundledWhiteDragon({ projectRoot: f.root, baseline:f.baseline })).status, 'not-bundled');
  await assert.rejects(access(f.target));
});

async function upgradeFixture(t) {
  const f=await fixture(t);
  await seedBundledWhiteDragon({projectRoot:f.root,baseline:f.baseline});
  const oldManifest=await readFile(join(f.target,'manifest.json'));
  f.manifest.profiles.magic={type:'video',file:'q-magic.webm'};f.manifest.actions.magic={profile:'magic',coverage:'dedicated'};
  await writeFile(join(f.source,'manifest.json'),JSON.stringify(f.manifest));
  await writeFile(join(f.source,'q-magic.webm'),'new magic media');
  await writeFile(join(f.source,'NOTICE.md'),'新版角色素材来源与项目使用授权。\n');
  return {...f,oldManifest};
}

test('已知官方旧包只增加新媒体并更新清单，重复新版返回current且保留选择与额外文件',async t=>{
  const f=await upgradeFixture(t);
  await writeFile(join(f.target,'my-notes.txt'),'user notes');
  await writeFile(join(f.root,'data','skins','selection.json'),'user selection');
  const result=await seedBundledWhiteDragon({projectRoot:f.root,baseline:f.baseline});
  assert.equal(result.status,'updated');assert.equal(await readFile(join(f.target,'q-magic.webm'),'utf8'),'new magic media');
  assert.equal(await readFile(join(f.target,'q-idle.webm'),'utf8'),'idle media');assert.equal(await readFile(join(f.target,'my-notes.txt'),'utf8'),'user notes');
  assert.equal(await readFile(join(f.root,'data','skins','selection.json'),'utf8'),'user selection');
  assert.deepEqual(await readFile(join(f.target,'manifest.json')),await readFile(join(f.source,'manifest.json')));
  assert.equal((await seedBundledWhiteDragon({projectRoot:f.root,baseline:f.baseline})).status,'current');
});

for(const changed of ['manifest.json','q-idle.webm','NOTICE.md'])test('用户改过'+changed+'时保留整套原皮肤，不添加新版文件',async t=>{
  const f=await upgradeFixture(t);await writeFile(join(f.target,changed),'user changed');
  assert.equal((await seedBundledWhiteDragon({projectRoot:f.root,baseline:f.baseline})).status,'preserved');
  assert.equal(await readFile(join(f.target,changed),'utf8'),'user changed');await assert.rejects(access(join(f.target,'q-magic.webm')));
});

test('新版同名文件冲突保留旧清单，同hash残留允许续完并识别新版NOTICE',async t=>{
  const f=await upgradeFixture(t);await writeFile(join(f.target,'q-magic.webm'),'user collision');
  assert.equal((await seedBundledWhiteDragon({projectRoot:f.root,baseline:f.baseline})).status,'preserved');
  assert.deepEqual(await readFile(join(f.target,'manifest.json')),f.oldManifest);assert.equal(await readFile(join(f.target,'q-magic.webm'),'utf8'),'user collision');
  await writeFile(join(f.target,'q-magic.webm'),await readFile(join(f.source,'q-magic.webm')));
  await writeFile(join(f.target,'NOTICE.md'),await readFile(join(f.source,'NOTICE.md')));
  assert.equal((await seedBundledWhiteDragon({projectRoot:f.root,baseline:f.baseline})).status,'updated');
});

test('新版预检缺片或改动原核心媒体时失败，旧manifest和已安装核心保持原样',async t=>{
  const f=await upgradeFixture(t);await rm(join(f.source,'q-magic.webm'));
  await assert.rejects(seedBundledWhiteDragon({projectRoot:f.root,baseline:f.baseline}));
  assert.deepEqual(await readFile(join(f.target,'manifest.json')),f.oldManifest);await assert.rejects(access(join(f.target,'q-magic.webm')));
  await writeFile(join(f.source,'q-magic.webm'),'new magic media');await writeFile(join(f.source,'q-idle.webm'),'changed official core');
  await assert.rejects(seedBundledWhiteDragon({projectRoot:f.root,baseline:f.baseline}),/bundled-core-media-changed/);
  assert.deepEqual(await readFile(join(f.target,'manifest.json')),f.oldManifest);assert.equal(await readFile(join(f.target,'q-idle.webm'),'utf8'),'idle media');
});
