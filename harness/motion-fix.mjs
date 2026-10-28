import { lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

const staysWithin = (root, file) => { const rel = relative(root, file); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };

function replaceOne(source, before, after) {
  const oldCount = source.split(before).length - 1, newCount = source.split(after).length - 1;
  if (oldCount === 0 && newCount === 1) return source;
  if (oldCount !== 1 || newCount !== 0) throw new Error('harness-native-motion-anchor-mismatch');
  return source.replace(before, after);
}

// 移植自 PC2005-cloud/dsh-pet 86181ce；只修目标与起点的差值，不改宿主、菜单和物理参数。
export function patchNativeMotion(input) {
  let source = input.replaceAll('\r\n', '\n');
  source = replaceOne(source,
    'const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;',
    'const { startRatio, startYRatio, targetRatio, leadSec, tailSec } = pm;');
  return replaceOne(source,
    'else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);',
    'else ratioX = startRatio + (targetRatio - startRatio) * ((t - leadSec) / travelWindow);');
}

export function prepareHarnessDependency({ profileDir }) {
  if (!isAbsolute(profileDir)) throw new Error('absolute-harness-profile-required');
  // 显式从官方profile目录解析，不能落到外部linked bundle祖先的Codex依赖。
  const require = createRequire(join(profileDir, 'package.json'));
  const packageRoot = realpathSync(dirname(require.resolve('dsh-pet/package.json')));
  const profileRoot = realpathSync(profileDir), rel = relative(profileRoot, packageRoot);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('harness-dsh-pet-outside-selected-profile');
  const meta = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (meta.name !== 'dsh-pet' || meta.version !== '0.3.8') throw new Error('harness-dsh-pet-0.3.8-required');
  const planned = ['lib/client.js', 'runtime/electron-helper/sprite.js'].map(name => {
    const file = join(packageRoot, name), stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe-harness-upstream-file');
    const realFile = realpathSync(file);
    if (!staysWithin(packageRoot, realFile) || !staysWithin(profileRoot, realFile)) throw new Error('unsafe-harness-upstream-file-outside-profile');
    const before = readFileSync(file, 'utf8'), after = patchNativeMotion(before);
    return { name, file, realFile, before, after, mode: stat.mode };
  });
  // 两个锚点文件都通过才落盘；临时文件rename断开pnpm硬链接，不写共享store的inode。
  const changed = [];
  for (const item of planned) {
    if (item.before === item.after) continue;
    const realFile = realpathSync(item.file);
    if (realFile !== item.realFile || !staysWithin(packageRoot, realFile) || !staysWithin(profileRoot, realFile)) throw new Error('unsafe-harness-upstream-file-outside-profile');
    if (readFileSync(item.file, 'utf8') !== item.before) throw new Error('harness-upstream-file-changed');
    const temporary = item.file + '.dragon-' + randomUUID();
    try {
      writeFileSync(temporary, item.after, { flag: 'wx', mode: item.mode });
      renameSync(temporary, item.file); changed.push(item.name);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  return { status: changed.length ? 'updated' : 'current', version: meta.version, files: changed };
}
