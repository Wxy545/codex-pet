// 从 PC2005-cloud/dsh-pet 8ad3d957 择取 profile 可写性与 DPI 失败保护；不迁移现有可写资料。
// 两种宿主共用补丁生成器；生成代码内联，原生 Harness 无须依赖独立宿主目录。
const count = (source, value) => source.split(value).length - 1;
function replaceOne(source, before, after) {
  const oldCount = count(source, before), newCount = count(source, after);
  if (newCount === 1 && oldCount === count(after, before)) return source;
  if (oldCount !== 1 || newCount !== 0) throw Error('helper-startup-anchor-mismatch');
  return source.replace(before, after);
}

/** 临时文件必须由本次独占创建；写入、关闭和清理全部成功才认可目录可写。 */
export function ensureHelperProfile({ app, fileSystem, path, env, home, randomUUID, appMode }) {
  const prepare = dir => {
    let fd, probe, owned = false, error = null;
    try {
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw Error('absolute-profile-required');
      fileSystem.mkdirSync(dir, { recursive: true });
      probe = path.join(dir, '.codex-pet-write-probe-' + randomUUID());
      fd = fileSystem.openSync(probe, 'wx', 0o600);
      owned = true;
      fileSystem.writeFileSync(fd, '1');
    } catch (value) { error = value; }
    finally {
      if (fd !== undefined) try { fileSystem.closeSync(fd); } catch (value) { error ||= value; }
      if (owned) try { fileSystem.unlinkSync(probe); } catch (value) { error ||= value; }
    }
    return error;
  };
  let currentDir, primaryError;
  try { currentDir = app.getPath('userData'); primaryError = prepare(currentDir); }
  catch (error) { primaryError = error; }
  if (!primaryError) return { status: 'current', dir: currentDir, fallback: false, error: null };
  try {
    const dshHome = env.DSH_HOME || path.join(home(), '.dsh');
    if (!path.isAbsolute(dshHome)) throw Error('absolute-profile-home-required');
    const fallbackDir = path.join(dshHome, 'dsh-pet', appMode ? 'app-profile' : 'electron-profile');
    const error = prepare(fallbackDir);
    if (error) return { status: 'unavailable', dir: currentDir ?? null, fallback: false, error };
    app.setPath('userData', fallbackDir);
    return { status: 'fallback', dir: fallbackDir, fallback: true, error: null };
  } catch (error) { return { status: 'unavailable', dir: currentDir ?? null, fallback: false, error }; }
}

const STARTUP_ANCHOR = '// ② 宿主探测：DSH_PET_HOST_PID 由宿主 spawn 时注入；未注入/非法 → parseHostPid 给 0 → 不探测（不误退）。';
const DPI_BEFORE = `if (shouldLinearize({ platform: process.platform, dpiProbe: DPI_PROBE, forceDsf: FORCE_DSF })) {
  PRIMARY_SCALE = readCachedPrimaryScale() || probePrimaryScale();
  const forced = resolveForcedScale({ forceDsf: FORCE_DSF, primaryScale: PRIMARY_SCALE });
  if (forced > 0) {
    app.commandLine.appendSwitch('force-device-scale-factor', String(forced));
    FORCED_SCALE = forced;
  }
}`;
const DPI_AFTER = `if (shouldLinearize({ platform: process.platform, dpiProbe: DPI_PROBE, forceDsf: FORCE_DSF })) {
  // codex-pet-dpi-startup-v1：探测失败只退化缩放补偿，不阻止桌宠启动。
  try {
    PRIMARY_SCALE = readCachedPrimaryScale() || probePrimaryScale();
    const forced = resolveForcedScale({ forceDsf: FORCE_DSF, primaryScale: PRIMARY_SCALE });
    if (forced > 0) {
      app.commandLine.appendSwitch('force-device-scale-factor', String(forced));
      FORCED_SCALE = forced;
    }
  } catch (error) {
    console.error('[dsh-pet-desktop-helper] DPI initialization unavailable');
    PRIMARY_SCALE = 0;
    FORCED_SCALE = 0;
  }
}`;

export function patchHelperStartup(input, { appMode } = {}) {
  if (typeof input !== 'string' || typeof appMode !== 'boolean') throw Error('helper-startup-options-invalid');
  let source = input.replaceAll('\r\n', '\n');
  const marker = '// codex-pet-helper-profile-v1:' + String(appMode);
  if (source.includes('// codex-pet-helper-profile-v1:') && !source.includes(marker)) throw Error('helper-startup-mode-mismatch');
  const inserted = marker + '\nconst codexPetProfile = (' + ensureHelperProfile.toString() + `)({
  app, fileSystem: require('node:fs'), path, env: process.env,
  home: require('node:os').homedir, randomUUID: require('node:crypto').randomUUID, appMode: ${appMode}
});
if (codexPetProfile.status === 'unavailable') console.error('[dsh-pet-desktop-helper] profile unavailable');
else if (codexPetProfile.fallback) console.error('[dsh-pet-desktop-helper] using private fallback profile');
` + STARTUP_ANCHOR;
  if (source.includes('// codex-pet-helper-profile-v1:') && (count(source, marker) !== 1 || count(source, inserted) !== 1)) throw Error('helper-startup-anchor-mismatch');
  source = replaceOne(source, STARTUP_ANCHOR, inserted);
  return replaceOne(source, DPI_BEFORE, DPI_AFTER);
}
