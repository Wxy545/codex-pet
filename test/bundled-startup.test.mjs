import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink, access, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {seedBundledStartup} from '../scripts/bundled-startup.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex-startup-film-')); t.after(() => rm(root, {recursive: true, force: true}));
  const source = join(root, 'assets/startup/white-dragon-cinematic.webm'), directory = join(root, 'data/startup-media');
  await mkdir(join(root, 'assets/startup'), {recursive: true});
  const bytes = Buffer.concat([Buffer.from('1a45dfa3934282847765626d000000000000', 'hex'), Buffer.from('owned film')]);
  await writeFile(source, bytes);
  return {root, source, directory, target: join(directory, 'white-dragon-cinematic.webm'), bytes};
}
test('新安装复制完整电影，重复prepare幂等，已登记未改文件可升级', async t => {
  const f = await fixture(t);
  assert.equal((await seedBundledStartup({projectRoot: f.root})).status, 'installed');
  assert.deepEqual(await readFile(f.target), f.bytes);
  assert.equal((await seedBundledStartup({projectRoot: f.root})).status, 'current');
  const updated = Buffer.concat([f.bytes, Buffer.from(' revised')]); await writeFile(f.source, updated);
  assert.equal((await seedBundledStartup({projectRoot: f.root})).status, 'updated'); assert.deepEqual(await readFile(f.target), updated);
});
test('已有自定义影片或更新后用户改动不覆盖，无效来源不写入data', async t => {
  const f = await fixture(t); await mkdir(f.directory, {recursive: true}); await writeFile(f.target, 'custom movie');
  assert.equal((await seedBundledStartup({projectRoot: f.root})).status, 'preserved'); assert.equal(await readFile(f.target, 'utf8'), 'custom movie');
  await rm(f.directory, {recursive: true}); await seedBundledStartup({projectRoot: f.root}); await writeFile(f.target, 'user edit');
  assert.equal((await seedBundledStartup({projectRoot: f.root})).status, 'preserved'); assert.equal(await readFile(f.target, 'utf8'), 'user edit');
  await rm(f.directory, {recursive: true}); await writeFile(f.source, 'not webm');
  await assert.rejects(seedBundledStartup({projectRoot: f.root}), /invalid-startup-movie/); await assert.rejects(access(f.target));
});
test('目标目录junction不写边界外文件', async t => {
  const f = await fixture(t), external = join(f.root, 'external'); await mkdir(external); await mkdir(join(f.root, 'data'));
  await symlink(external, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await seedBundledStartup({projectRoot: f.root})).status, 'preserved'); await assert.rejects(access(join(external, 'white-dragon-cinematic.webm')));
});
test('data根是junction时不得在其指向的目录创建影片或登记文件', async t => {
  const f = await fixture(t), external = join(f.root, 'external-data'); await mkdir(external);
  await symlink(external, join(f.root, 'data'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await seedBundledStartup({projectRoot: f.root})).reason, 'linked-data-root');
  await assert.rejects(access(join(external, 'startup-media')));
});
test('无内置电影保留旧路径，同内容未登记文件可接管，不修改启动模式', async t => {
  const f = await fixture(t); await mkdir(f.directory, {recursive: true}); await writeFile(f.target, f.bytes);
  const preference = join(f.root, 'data/startup.json'); await writeFile(preference, '{"mode":"pet"}');
  assert.equal((await seedBundledStartup({projectRoot: f.root})).status, 'current'); assert.equal(await readFile(preference, 'utf8'), '{"mode":"pet"}');
  await rm(f.source); assert.equal((await seedBundledStartup({projectRoot: f.root})).status, 'not-bundled'); assert.deepEqual(await readFile(f.target), f.bytes);
});

test('WorkBuddy启动只验证复用卷卷3片，不复制龙娘电影、不重复复制羊媒体或改模式',async t=>{
 const f=await fixture(t),role=join(f.root,'data/skins/curly-sheep');await mkdir(role,{recursive:true});
 const keys=['idle','working','greeting'];await writeFile(join(role,'manifest.json'),JSON.stringify({schemaVersion:1,profiles:Object.fromEntries(keys.map(key=>[key,{type:'video',file:'q-'+key+'.webm'}]))}));
 for(const key of keys)await writeFile(join(role,'q-'+key+'.webm'),f.bytes);
 await writeFile(join(f.root,'data/host.json'),'{"schemaVersion":1,"host":"workbuddy"}');await writeFile(join(f.root,'data/startup.json'),'{"mode":"both"}');
 await writeFile(f.source,'bad dragon movie is irrelevant to sheep');
 const before=await readdir(role),result=await seedBundledStartup({projectRoot:f.root});assert.equal(result.status,'reused');assert.equal(result.character,'curly-sheep');assert.deepEqual(result.files,['q-idle.webm','q-working.webm','q-greeting.webm']);assert.deepEqual(await readdir(role),before);await assert.rejects(access(f.directory));assert.equal(await readFile(join(f.root,'data/startup.json'),'utf8'),'{"mode":"both"}');
 await writeFile(join(role,'q-working.webm'),'broken');await assert.rejects(seedBundledStartup({projectRoot:f.root}),/invalid-startup-role-media/);await assert.rejects(access(f.directory));
});

test('WorkBuddy缺卷卷包时不套用龙娘电影或创建启动媒体目录',async t=>{
 const f=await fixture(t);assert.deepEqual(await seedBundledStartup({projectRoot:f.root,host:'workbuddy'}),{status:'not-bundled',character:'curly-sheep'});await assert.rejects(access(f.directory));
});
