import {readFile, writeFile, mkdir, lstat, rename, rm, realpath} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {isAbsolute, join, relative, dirname} from 'node:path';
import Host from '../src/pet-host.cjs';
import Actions from '../src/skin-actions.cjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function stat(file) { try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

/** 只更新已登记且未被用户编辑的启动电影，不覆盖自定义文件或跟随目录链接。 */
export async function seedBundledStartup({projectRoot, dataRoot = join(projectRoot, 'data'), host = Host.readHost(dataRoot)}) {
  if (!isAbsolute(projectRoot) || !isAbsolute(dataRoot)) throw new Error('absolute-startup-root-required');
  if (!Host.validHost(host)) throw new Error('invalid-startup-host');
  if (host === 'workbuddy') {
    // 卷卷直接引用已安装角色包，不能再复制一套视频或套用龙娘电影。
    const directory = join(dataRoot, 'skins', 'curly-sheep');
    const manifestInfo = await stat(join(directory, 'manifest.json'));
    if (!manifestInfo) return {status: 'not-bundled', character: 'curly-sheep'};
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new Error('invalid-startup-role-manifest');
    if ((await stat(dataRoot))?.isSymbolicLink() || (await stat(directory))?.isSymbolicLink()) return {status: 'preserved', reason: 'linked-role-directory'};
    if (relative(await realpath(dataRoot), await realpath(directory)) !== join('skins', 'curly-sheep')) throw new Error('invalid-startup-role-directory');
    const manifest = Actions.normalizeManifest(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))), files = [];
    for (const key of ['idle', 'working', 'greeting']) {
      const profile = manifest.profiles[key], file = profile && join(directory, profile.file), info = file && await stat(file);
      if (profile?.type !== 'video' || !info?.isFile() || info.isSymbolicLink() || info.size < 16 || info.size > 96 * 1024 * 1024 || dirname(await realpath(file)) !== await realpath(directory)) throw new Error('invalid-startup-role-media');
      const head = (await readFile(file)).subarray(0, 512);
      if (!head.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) || !head.includes(Buffer.from('4282847765626d', 'hex'))) throw new Error('invalid-startup-role-media');
      files.push(profile.file);
    }
    return {status: 'reused', character: 'curly-sheep', files};
  }
  const name = 'white-dragon-cinematic.webm', source = join(projectRoot, 'assets', 'startup', name);
  const sourceStat = await stat(source);
  if (!sourceStat) return {status: 'not-bundled'};
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size < 16 || sourceStat.size > 96 * 1024 * 1024) throw new Error('invalid-startup-movie');
  const bytes = await readFile(source);
  if (!bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) || !bytes.subarray(4, 512).includes(Buffer.from('4282847765626d', 'hex'))) throw new Error('invalid-startup-movie');
  const directory = join(dataRoot, 'startup-media'), target = join(directory, name), stamp = join(directory, '.codex-startup.json');
  const dataStat = await stat(dataRoot);
  if (dataStat && (!dataStat.isDirectory() || dataStat.isSymbolicLink())) return {status: 'preserved', reason: 'linked-data-root'};
  const directoryStat = await stat(directory);
  if (directoryStat && (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())) return {status: 'preserved', reason: 'linked-directory'};
  const targetStat = await stat(target), stampStat = await stat(stamp);
  if ((targetStat && (!targetStat.isFile() || targetStat.isSymbolicLink())) || (stampStat && (!stampStat.isFile() || stampStat.isSymbolicLink()))) return {status: 'preserved', reason: 'customized'};
  const expected = digest(bytes), current = targetStat ? digest(await readFile(target)) : null;
  let previous;
  try { previous = JSON.parse(await readFile(stamp, 'utf8')); } catch { /* 没有可信登记时只接纳与本次内置影片完全相同的文件。 */ }
  if (current && current !== expected && current !== previous?.sha256) return {status: 'preserved', reason: 'customized'};
  await mkdir(directory, {recursive: true});
  const temporary = target + '.tmp-' + randomUUID(), temporaryStamp = stamp + '.tmp-' + randomUUID();
  try {
    // 写入前再次比较，避免准备期间覆盖用户刚替换的影片。
    const latest = await stat(target);
    if ((latest && (!latest.isFile() || latest.isSymbolicLink() || digest(await readFile(target)) !== current)) || (!latest && current)) return {status: 'preserved', reason: 'changed-during-upgrade'};
    if (current !== expected) { await writeFile(temporary, bytes, {flag: 'wx'}); await rename(temporary, target); }
    await writeFile(temporaryStamp, JSON.stringify({schemaVersion: 1, sha256: expected}, null, 2) + '\n', {flag: 'wx'});
    await rename(temporaryStamp, stamp);
    return {status: current === expected ? 'current' : current ? 'updated' : 'installed'};
  } finally { await rm(temporary, {force: true}); await rm(temporaryStamp, {force: true}); }
}
