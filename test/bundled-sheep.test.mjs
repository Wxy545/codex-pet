import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access, symlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { seedBundledSheep, SHEEP_MEDIA } from '../scripts/bundled-sheep.mjs';

const manifest = JSON.parse(await readFile(fileURLToPath(new URL('../assets/curly-sheep/manifest.json', import.meta.url)), 'utf8'));
const webm = Buffer.from('1a45dfa3934282847765626d000000000000', 'hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex-bundled-sheep-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'assets/curly-sheep'), target = join(root, 'data/skins/curly-sheep'); await mkdir(source, { recursive: true });
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest)); await writeFile(join(source, 'NOTICE.md'), 'User-owned character; shared with permission.\n');
  for (const name of SHEEP_MEDIA) await writeFile(join(source, name), webm);
  await writeFile(join(source, 'private-original.png'), 'not bundled');
  return { root, source, target };
}

test('小羊首装预检7段WebM后原子写整包，不复制参考图、不改角色选择', async t => {
  const f = await fixture(t); const result = await seedBundledSheep({ projectRoot: f.root }); assert.equal(result.status, 'installed');
  assert.deepEqual((await readdir(f.target)).sort(), ['NOTICE.md', 'manifest.json', ...SHEEP_MEDIA].sort());
  assert.equal(SHEEP_MEDIA.length, 7); assert.equal(manifest.profiles.error.file, manifest.profiles.thinking.file); assert.equal(manifest.actions['工作状态-垂头叹气冒汗'].coverage, 'shared'); await assert.rejects(access(join(f.target, 'q-error.webm')));
  assert.deepEqual(await readFile(join(f.target, 'q-idle.webm')), webm); await assert.rejects(access(join(f.root, 'data/skins/selection.json')));
  await writeFile(join(f.target, 'user-notes.txt'), 'keep'); assert.equal((await seedBundledSheep({ projectRoot: f.root })).status, 'current'); assert.equal(await readFile(join(f.target, 'user-notes.txt'), 'utf8'), 'keep');
});

test('小羊自定义清单、视频、选择全部保留，不补进缺失媒体', async t => {
  const f = await fixture(t); await mkdir(f.target, { recursive: true }); await writeFile(join(f.target, 'manifest.json'), 'custom manifest'); await writeFile(join(f.target, 'q-click.webm'), 'custom video');
  await writeFile(join(f.root, 'data/skins/selection.json'), 'custom selection'); assert.equal((await seedBundledSheep({ projectRoot: f.root })).status, 'preserved');
  assert.equal(await readFile(join(f.target, 'manifest.json'), 'utf8'), 'custom manifest'); assert.equal(await readFile(join(f.target, 'q-click.webm'), 'utf8'), 'custom video'); assert.equal(await readFile(join(f.root, 'data/skins/selection.json'), 'utf8'), 'custom selection'); assert.deepEqual((await readdir(f.target)).sort(), ['manifest.json', 'q-click.webm']);
});

for (const name of SHEEP_MEDIA) test('小羊缺少' + name + '时不建目标和半成品目录', async t => {
  const f = await fixture(t); await rm(join(f.source, name)); await assert.rejects(seedBundledSheep({ projectRoot: f.root })); await assert.rejects(access(f.target)); await assert.rejects(access(join(f.root, 'data')));
});

test('小羊拒绝假WebM、借名Matroska和越界清单，不创建目标', async t => {
  const f = await fixture(t);
  for (const bytes of [Buffer.from('not video'), Buffer.from('1a45dfa3934282846d617472000000000000', 'hex')]) {
    await writeFile(join(f.source, 'q-idle.webm'), bytes); await assert.rejects(seedBundledSheep({ projectRoot: f.root }), /bundled-sheep-webm-required/); await assert.rejects(access(f.target));
  }
  await writeFile(join(f.source, 'manifest.json'), JSON.stringify({ ...manifest, profiles: { ...manifest.profiles, idle: { type: 'video', file: '../private.webm' } } }));
  await assert.rejects(seedBundledSheep({ projectRoot: f.root }), /invalid-skin-manifest/); await assert.rejects(access(f.target));
});

test('小羊缺署名和被链接的素材均不安装，仓库无素材返回not-bundled', async t => {
  const f = await fixture(t); await rm(join(f.source, 'NOTICE.md')); await assert.rejects(seedBundledSheep({ projectRoot: f.root }), /bundled-sheep-file-required/); await assert.rejects(access(f.target));
  await writeFile(join(f.source, 'NOTICE.md'), 'permission'); const moved = join(f.root, 'linked-source'); await rename(f.source, moved); await symlink(moved, f.source, 'junction'); await assert.rejects(seedBundledSheep({ projectRoot: f.root }), /bundled-sheep-directory-required/);
  await rm(join(f.root, 'assets'), { recursive: true }); assert.equal((await seedBundledSheep({ projectRoot: f.root })).status, 'not-bundled');
});
