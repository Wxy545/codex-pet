import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
  return { root, source, target: join(root, 'data', 'skins', 'white-dragon'), manifest };
}

test('新安装只复制清单引用媒体与署名文件，不复制旧原型或写选择', async t => {
  const f = await fixture(t);
  assert.equal((await seedBundledWhiteDragon({ projectRoot: f.root })).status, 'installed');
  assert.deepEqual((await readdir(f.target)).sort(), ['NOTICE.md', 'manifest.json', 'q-idle.webm', 'q-working.webm']);
  assert.equal(await readFile(join(f.target, 'q-idle.webm'), 'utf8'), 'idle media');
  await assert.rejects(access(join(f.root, 'data', 'skins', 'selection.json')));
});

test('已有角色目录、选择和用户文件原样保留，重复prepare不覆盖', async t => {
  const f = await fixture(t);
  await mkdir(f.target, { recursive: true });
  await writeFile(join(f.target, 'manifest.json'), 'user manifest');
  await writeFile(join(f.root, 'data', 'skins', 'selection.json'), 'user selection');
  assert.equal((await seedBundledWhiteDragon({ projectRoot: f.root })).status, 'preserved');
  assert.equal(await readFile(join(f.target, 'manifest.json'), 'utf8'), 'user manifest');
  assert.equal(await readFile(join(f.root, 'data', 'skins', 'selection.json'), 'utf8'), 'user selection');
  assert.deepEqual(await readdir(f.target), ['manifest.json']);
});

test('缺少素材或越界文件名在创建目标前失败，不留下半套素材', async t => {
  const f = await fixture(t);
  await rm(join(f.source, 'q-working.webm'));
  await assert.rejects(seedBundledWhiteDragon({ projectRoot: f.root }));
  await assert.rejects(access(f.target));
  f.manifest.profiles.work.file = '../private.webm';
  await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.manifest));
  await assert.rejects(seedBundledWhiteDragon({ projectRoot: f.root }), /invalid-skin-manifest/);
  await assert.rejects(access(f.target));
});

test('仓库未含公开素材时不生成角色数据，显式dataRoot可用于迁移安装', async t => {
  const f = await fixture(t);
  const dataRoot = join(f.root, 'other-data');
  await seedBundledWhiteDragon({ projectRoot: f.root, dataRoot });
  assert.equal(await readFile(join(dataRoot, 'skins', 'white-dragon', 'q-idle.webm'), 'utf8'), 'idle media');
  await rm(join(f.root, 'assets'), { recursive: true });
  assert.equal((await seedBundledWhiteDragon({ projectRoot: f.root })).status, 'not-bundled');
  await assert.rejects(access(f.target));
});
