import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import Actions from '../src/skin-actions.cjs';

export const SHEEP_MEDIA = Object.freeze(['q-idle.webm', 'q-walk-left.webm', 'q-click.webm', 'q-thinking.webm', 'q-working.webm', 'q-waiting.webm', 'q-greeting.webm']);
const digest = value => createHash('sha256').update(value).digest('hex');
async function info(file) {
  try { return await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** 首发小羊只做完整新安装；已有本机角色包逐字保留，不假设它仍是官方版本。 */
export async function seedBundledSheep({ projectRoot, dataRoot = join(projectRoot, 'data') }) {
  if (!isAbsolute(projectRoot) || !isAbsolute(dataRoot)) throw new Error('absolute-skin-root-required');
  const source = join(projectRoot, 'assets', 'curly-sheep'), skinsRoot = join(dataRoot, 'skins'), target = join(skinsRoot, 'curly-sheep');
  const existing = await info(target);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) return { status: 'preserved', reason: 'customized' };
  const sourceInfo = await info(source);
  if (!sourceInfo) return { status: existing ? 'preserved' : 'not-bundled' };
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error('bundled-sheep-directory-required');
  if (relative(await realpath(projectRoot), await realpath(source)) !== join('assets', 'curly-sheep')) throw new Error('bundled-sheep-path-required');
  const manifestFile = join(source, 'manifest.json'), manifestInfo = await info(manifestFile);
  if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink()) throw new Error('bundled-sheep-file-required');
  const manifestBytes = await readFile(manifestFile), input = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''));
  Actions.normalizeManifest(input);
  const profiles = Object.values(input.profiles ?? {}), media = [...new Set(profiles.map(profile => profile.file))];
  if (!profiles.length || profiles.some(profile => profile.type !== 'video') || media.length !== SHEEP_MEDIA.length || SHEEP_MEDIA.some(name => !media.includes(name))) throw new Error('bundled-sheep-seven-videos-required');
  const core = { idle: 'q-idle.webm', walk: 'q-walk-left.webm', click: 'q-click.webm', thinking: 'q-thinking.webm', working: 'q-working.webm', waiting: 'q-waiting.webm', error: 'q-thinking.webm', greeting: 'q-greeting.webm' };
  if (Object.entries(core).some(([key, name]) => input.profiles[key]?.file !== name)) throw new Error('bundled-sheep-core-profiles-required');
  const names = ['manifest.json', 'NOTICE.md', ...SHEEP_MEDIA], contents = { 'manifest.json': manifestBytes };
  // 素材和署名全部预检后才建目标目录；坏头或缺片不会安装半套角色。
  for (const name of names.slice(1)) {
    const file = join(source, name), stat = await info(file);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 96 * 1024 * 1024) throw new Error('bundled-sheep-file-required');
    const bytes = await readFile(file); contents[name] = bytes;
    if (name.endsWith('.webm')) {
      const header = bytes.subarray(0, 512);
      if (bytes.length < 16 || !header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) || !header.includes(Buffer.from('4282847765626d', 'hex'))) throw new Error('bundled-sheep-webm-required');
    }
  }
  if (existing) {
    const identical = await Promise.all(names.map(async name => {
      const file = join(target, name), stat = await info(file);
      return stat?.isFile() && !stat.isSymbolicLink() && digest(await readFile(file)) === digest(contents[name]);
    }));
    return identical.every(Boolean) ? { status: 'current' } : { status: 'preserved', reason: 'customized' };
  }
  for (const directory of [dataRoot, skinsRoot]) if ((await info(directory))?.isSymbolicLink()) throw new Error('linked-sheep-data-path');
  await mkdir(skinsRoot, { recursive: true });
  const staging = await mkdtemp(join(skinsRoot, '.curly-sheep-seed-'));
  try {
    for (const name of names) await writeFile(join(staging, name), contents[name], { flag: 'wx' });
    if (await info(target)) return { status: 'preserved', reason: 'concurrent-install' };
    try { await rename(staging, target); }
    catch (error) { if (await info(target)) return { status: 'preserved', reason: 'concurrent-install' }; throw error; }
    return { status: 'installed', files: names };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
