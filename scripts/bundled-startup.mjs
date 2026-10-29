import {readFile, writeFile, mkdir, lstat, rename, rm} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {isAbsolute, join} from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function stat(file) { try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

/** 只更新已登记且未被用户编辑的启动电影，不覆盖自定义文件或跟随目录链接。 */
export async function seedBundledStartup({projectRoot, dataRoot = join(projectRoot, 'data')}) {
  if (!isAbsolute(projectRoot) || !isAbsolute(dataRoot)) throw new Error('absolute-startup-root-required');
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
