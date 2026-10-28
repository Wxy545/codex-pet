import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(root, 'assets', 'white-dragon'), targetRoot = join(sourceRoot, 'harness');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--ffmpeg')) throw new Error('Usage: node scripts/export-harness-videos.mjs [--ffmpeg <executable>]');
const ffmpeg = args[1] || 'ffmpeg';
const manifest = JSON.parse(await readFile(join(sourceRoot, 'manifest.json'), 'utf8'));
const files = [...new Set(Object.values(manifest.profiles ?? {}).map(profile => {
  if (profile.type !== 'video' || !/^[a-z0-9][a-z0-9_-]{0,95}\.webm$/.test(profile.file)) throw new Error('harness-q-video-required');
  return profile.file;
}))];
const digest = data => createHash('sha256').update(data).digest('hex');
await mkdir(targetRoot, { recursive: true });
const result = { schemaVersion: 1, width: 640, height: 360, frameHeight: 285, top: 50, centerX: 320, files: {} };
for (const name of files) {
  const source = join(sourceRoot, name), target = join(targetRoot, name), temporary = join(targetRoot, '.export-' + randomUUID() + '.webm');
  const before = digest(await readFile(source));
  try {
    // 与Codex覆盖层同一几何：frame顶50/高285；原生DSH命中区和脚底线无需另改。
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-c:v', 'libvpx-vp9', '-threads', '2', '-i', source,
      '-vf', 'format=rgba,scale=trunc(iw*285/ih):285:flags=lanczos,pad=640:360:(ow-iw)/2:50:color=black@0,format=yuva420p',
      '-an', '-fps_mode', 'passthrough', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '18', '-b:v', '0',
      '-deadline', 'good', '-cpu-used', '4', '-threads', '2', '-row-mt', '1', '-auto-alt-ref', '0', '-metadata:s:v:0', 'alpha_mode=1', temporary],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let errors = '';
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-4096); });
    await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? accept() : reject(new Error('harness-video-export-failed: ' + name + '\n' + errors))); });
    if (digest(await readFile(source)) !== before) throw new Error('harness-original-video-changed');
    const bytes = await readFile(temporary);
    await rename(temporary, target);
    result.files[name] = { sourceSha256: before, sha256: digest(bytes), bytes: bytes.length };
    console.log(name + ' exported');
  } finally { await rm(temporary, { force: true }); }
}
await writeFile(join(targetRoot, 'geometry.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ videos: files.length, width: result.width, height: result.height, directory: 'assets/white-dragon/harness' }));
