import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import Actions from '../src/skin-actions.cjs';

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function seedBundledWhiteDragon({ projectRoot, dataRoot = join(projectRoot, 'data') }) {
  if (!isAbsolute(projectRoot) || !isAbsolute(dataRoot)) throw new Error('absolute-skin-root-required');
  const source = join(projectRoot, 'assets', 'white-dragon');
  const skinsRoot = join(dataRoot, 'skins');
  const target = join(skinsRoot, 'white-dragon');
  // 已有目录即视作用户素材，不覆盖、合并或替用户重写选择。
  if (await exists(target)) return { status: 'preserved' };
  if (!await exists(source)) return { status: 'not-bundled' };
  const input = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  Actions.normalizeManifest(input);
  const profiles = Object.values(input.profiles ?? {});
  if (!profiles.length || profiles.some(profile => profile.type !== 'video')) throw new Error('bundled-q-video-profiles-required');
  const names = [...new Set(['manifest.json', 'NOTICE.md', ...profiles.map(profile => profile.file)])];
  // 文件名已经过清单校验；只复制显式Q版媒体和署名，不把素材目录其他文件带进用户数据。
  for (const name of names) if (!(await lstat(join(source, name))).isFile()) throw new Error('bundled-skin-file-required');
  await mkdir(skinsRoot, { recursive: true });
  const staging = await mkdtemp(join(skinsRoot, '.white-dragon-seed-'));
  try {
    for (const name of names) await copyFile(join(source, name), join(staging, name));
    // 完整复制后才发布新目录；并发准备中另一方已完成时保留先到的目录。
    if (await exists(target)) return { status: 'preserved' };
    try { await rename(staging, target); }
    catch (error) { if (await exists(target)) return { status: 'preserved' }; throw error; }
    return { status: 'installed', files: names };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
