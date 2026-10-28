import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Character from '../src/codex-character.cjs';
import Actions from '../src/skin-actions.cjs';
import { buildHarnessConfig } from '../harness/pack.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'data', 'harness-plugin');
const source = join(root, 'assets', 'white-dragon');
const nativeSource = join(source, 'harness');
const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
Actions.normalizeManifest(manifest);
const meta = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const bundle = JSON.parse(await readFile(join(root, 'harness', 'package.json'), 'utf8'));
bundle.version = meta.version;
const locales = {};
const hashes = {};
const geometry = JSON.parse(await readFile(join(nativeSource, 'geometry.json'), 'utf8'));
if (geometry.schemaVersion !== 1 || geometry.width !== 640 || geometry.height !== 360 || geometry.frameHeight !== 285 || geometry.top !== 50) throw new Error('harness-native-geometry-required');
// 先检查全部已授权Q视频，缺片或混入其他形态时不生成可安装包。
for (const profile of Object.values(manifest.profiles)) {
  if (profile.type !== 'video' || !/^[a-z0-9][a-z0-9_-]{0,95}\.webm$/.test(profile.file)) throw new Error('harness-q-video-required');
  const file = join(source, profile.file), stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('harness-source-file-required');
  const data = await readFile(file);
  if (!data.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) || !data.subarray(4, 512).includes(Buffer.from('4282847765626d', 'hex'))) throw new Error('harness-webm-header-required');
  const sourceSha256 = createHash('sha256').update(data).digest('hex');
  const native = await readFile(join(nativeSource, profile.file));
  const sha256 = createHash('sha256').update(native).digest('hex');
  if (geometry.files?.[profile.file]?.sourceSha256 !== sourceSha256 || geometry.files?.[profile.file]?.sha256 !== sha256) throw new Error('harness-native-export-outdated: ' + profile.file);
  hashes[profile.file] = { sha256, size: native.length };
}
for (const locale of ['zh-CN', 'en']) {
  const built = buildHarnessConfig({ manifest, locale, copy: Character.characterCopy('white-dragon', locale) });
  locales[locale] = { ...built, files: Object.entries(built.media).map(([name, source]) => ({ name, source, ...hashes[source] })) };
}
await mkdir(join(output, 'assets'), { recursive: true });
for (const file of ['index.mjs', 'pack.mjs', 'motion-fix.mjs', 'cordis.patch.yml', 'README.md']) await copyFile(join(root, 'harness', file), join(output, file));
await copyFile(join(root, 'LICENSE'), join(output, 'LICENSE'));
await copyFile(join(source, 'NOTICE.md'), join(output, 'NOTICE.md'));
for (const file of Object.keys(hashes)) await copyFile(join(nativeSource, file), join(output, 'assets', file));
await writeFile(join(output, 'package.json'), JSON.stringify(bundle, null, 2) + '\n');
await writeFile(join(output, 'pack.json'), JSON.stringify({ schemaVersion: 1, version: meta.version, locales }, null, 2) + '\n');
console.log(JSON.stringify({ package: bundle.name, version: meta.version, directory: output, videos: Object.keys(hashes).length, locales: Object.keys(locales) }));
