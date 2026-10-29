import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import Actions from '../src/skin-actions.cjs';
import officialBaseline from './bundled-white-dragon-0.3.0.json' with { type: 'json' };
import officialBaseline031 from './bundled-white-dragon-0.3.1.json' with { type: 'json' };
import officialBaseline040 from './bundled-white-dragon-0.4.0.json' with { type: 'json' };
import officialBaseline041 from './bundled-white-dragon-0.4.1.json' with { type: 'json' };

const digest = data => createHash('sha256').update(data).digest('hex');
const mediaName = name => /^[a-z0-9][a-z0-9_-]{0,95}\.webm$/.test(name);
async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function fileHash(file) {
  try { return (await lstat(file)).isFile() ? digest(await readFile(file)) : null; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function seedBundledWhiteDragon({ projectRoot, dataRoot = join(projectRoot, 'data'), baseline = [officialBaseline, officialBaseline031, officialBaseline040, officialBaseline041] }) {
  if (!isAbsolute(projectRoot) || !isAbsolute(dataRoot)) throw new Error('absolute-skin-root-required');
  const source = join(projectRoot, 'assets', 'white-dragon');
  const skinsRoot = join(dataRoot, 'skins');
  const target = join(skinsRoot, 'white-dragon');
  const targetExists = await exists(target);
  if (!await exists(source)) return { status: targetExists ? 'preserved' : 'not-bundled' };
  const input = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  Actions.normalizeManifest(input);
  const profiles = Object.values(input.profiles ?? {});
  if (!profiles.length || profiles.some(profile => profile.type !== 'video')) throw new Error('bundled-q-video-profiles-required');
  const names = [...new Set(['manifest.json', 'NOTICE.md', ...profiles.map(profile => profile.file)])];
  const contents = {}, hashes = {};
  // 全包先读成已核对的快照，缺片时不写用户目录；只含清单媒体与署名。
  for (const name of names) {
    if (!(await lstat(join(source, name))).isFile()) throw new Error('bundled-skin-file-required');
    contents[name] = await readFile(join(source, name)); hashes[name] = digest(contents[name]);
  }
  const versions = (Array.isArray(baseline) ? baseline : [baseline]).map(value => {
    const files = value?.files;
    if (!files?.['manifest.json'] || !files['NOTICE.md'] || Object.entries(files).some(([name, hash]) => (!mediaName(name) && !['manifest.json', 'NOTICE.md'].includes(name)) || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('invalid-bundled-skin-baseline');
    const media = Object.keys(files).filter(mediaName);
    // 只增加新动作；任何已发布媒体变化都必须停下，不借升级覆盖旧片。
    if (!media.length || media.some(name => hashes[name] !== files[name])) throw new Error('bundled-core-media-changed');
    return { files, media };
  });
  if (!versions.length) throw new Error('invalid-bundled-skin-baseline');
  const current = async () => (await Promise.all(names.map(async name => await fileHash(join(target, name)) === hashes[name]))).every(Boolean);
  const matchesOld = async ({ files: old, media: oldMedia }) => {
    if (await fileHash(join(target, 'manifest.json')) !== old['manifest.json']) return false;
    if (!(await Promise.all(oldMedia.map(async name => await fileHash(join(target, name)) === old[name]))).every(Boolean)) return false;
    const notice = await fileHash(join(target, 'NOTICE.md'));
    // NOTICE可能已在上次中断前更新；只接受可验证的官方旧版或本次新版原文。
    return notice === old['NOTICE.md'] || notice === hashes['NOTICE.md'];
  };
  let previous = versions[0];
  if (targetExists) {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) return { status: 'preserved', reason: 'customized' };
    if (await current()) return { status: 'current' };
    previous = undefined;
    for (const version of versions) if (await matchesOld(version)) { previous = version; break; }
    if (!previous) return { status: 'preserved', reason: 'customized' };
  }
  const unchangedOld = () => matchesOld(previous);
  const additions = names.filter(name => mediaName(name) && !previous.media.includes(name));
  const noConflict = async () => {
    for (const name of additions) if (await exists(join(target, name)) && await fileHash(join(target, name)) !== hashes[name]) return false;
    return true;
  };
  if (targetExists && !await noConflict()) return { status: 'preserved', reason: 'conflict' };
  await mkdir(skinsRoot, { recursive: true });
  const staging = await mkdtemp(join(skinsRoot, '.white-dragon-seed-'));
  try {
    const stagedNames = targetExists ? ['manifest.json', 'NOTICE.md', ...additions] : names;
    for (const name of stagedNames) await writeFile(join(staging, name), contents[name]);
    if (!targetExists) {
      if (await exists(target)) return { status: 'preserved', reason: 'concurrent-install' };
      try { await rename(staging, target); }
      catch (error) { if (await exists(target)) return { status: 'preserved', reason: 'concurrent-install' }; throw error; }
      return { status: 'installed', files: names };
    }
    if (!await unchangedOld() || !await noConflict()) return { status: 'preserved', reason: 'changed-during-upgrade' };
    for (const name of additions) {
      try { await copyFile(join(staging, name), join(target, name), constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (await fileHash(join(target, name)) !== hashes[name]) return { status: 'preserved', reason: 'conflict' };
    }
    // 新片均已落盘且旧核心仍未改动，才原子更新署名与清单。清单始终最后提交。
    if (!await unchangedOld()) return { status: 'preserved', reason: 'changed-during-upgrade' };
    if (await fileHash(join(target, 'NOTICE.md')) !== hashes['NOTICE.md']) await rename(join(staging, 'NOTICE.md'), join(target, 'NOTICE.md'));
    if (!await unchangedOld()) return { status: 'preserved', reason: 'changed-during-upgrade' };
    await rename(join(staging, 'manifest.json'), join(target, 'manifest.json'));
    return { status: 'updated', files: additions };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
