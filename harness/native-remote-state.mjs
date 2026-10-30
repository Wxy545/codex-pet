import {lstatSync, fstatSync, openSync, closeSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {basename, dirname, isAbsolute, join, relative, sep} from 'node:path';

const ANCHOR = 'const lock = new LockStore({ onChange: (petId, data) => state.writePet(petId, "lock", data) });';
const MARKER = '/* codex-pet-native-remote-state-v1 */';
const END = '/* /codex-pet-native-remote-state-v1 */';
const inside = (root, file) => {const path = relative(root, file); return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);};
const same = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

// 此函数同时嵌入固定版本宿主：只接受状态元数据，不接受正文、会话标识或外部任务文案。
function normalizeRemoteQQView(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 5 || Object.keys(value).some(key => !['schemaVersion', 'application', 'state', 'activeCount', 'at'].includes(key))) return null;
  if (value.schemaVersion !== 1 || value.application !== 'harness' || !['idle', 'thinking', 'working', 'waiting', 'result', 'success', 'error'].includes(value.state)) return null;
  const busy = ['thinking', 'working', 'waiting', 'result'].includes(value.state);
  if (!Number.isSafeInteger(value.activeCount) || value.activeCount < 0 || value.activeCount > 32 || (busy ? value.activeCount === 0 : value.activeCount !== 0)) return null;
  const ttl = value.state === 'success' || value.state === 'error' ? 5000 : 30000;
  if (!Number.isSafeInteger(value.at) || value.at < 0 || value.at > now || now - value.at > ttl) return null;
  return {schemaVersion: 1, application: 'harness', state: value.state, activeCount: value.activeCount, at: value.at};
}

function remoteStateBlock() {
  return MARKER + '\n' + `const codexPetNormalizeQQView = ${normalizeRemoteQQView.toString()};
  const codexPetQQSlot = "codex-pet-qq";
  let codexPetQQTimer = null, codexPetQQSeq = 0, codexPetQQGeneration = 0, codexPetQQLastAt = -1, codexPetQQDisposed = false;
  const codexPetQQClear = () => {
    codexPetQQGeneration++;
    if (codexPetQQTimer !== null) { clearTimeout(codexPetQQTimer); codexPetQQTimer = null; }
    if (workStatus.clear(codexPetQQSlot)) publishWorkStatus();
  };
  ctx.provide("codexPetQQState", { update(view) {
    if (codexPetQQDisposed) return false;
    const valid = codexPetNormalizeQQView(view);
    if (!valid) { codexPetQQClear(); return false; }
    if (valid.at < codexPetQQLastAt) return false;
    codexPetQQLastAt = valid.at;
    if (valid.state === "idle") { codexPetQQClear(); return true; }
    if (codexPetQQTimer !== null) clearTimeout(codexPetQQTimer);
    const ticket = ++codexPetQQGeneration;
    workStatus.setState(codexPetQQSlot, valid.state, ++codexPetQQSeq);
    workStatus.setTask(codexPetQQSlot, null);
    publishWorkStatus();
    const ttl = valid.state === "success" || valid.state === "error" ? 5000 : 30000;
    codexPetQQTimer = setTimeout(() => { if (ticket === codexPetQQGeneration) codexPetQQClear(); }, Math.max(0, valid.at + ttl - Date.now()));
    codexPetQQTimer?.unref?.();
    return true;
  } });
  ctx.on("dispose", () => { codexPetQQDisposed = true; codexPetQQClear(); });
` + END + '\n';
}

export function patchHarnessRemoteState(input) {
  const source = input.replaceAll('\r\n', '\n'), block = remoteStateBlock(), patched = block + ANCHOR;
  if (source.includes(MARKER)) {
    if (source.split(MARKER).length !== 2 || source.split(patched).length !== 2) throw Error('harness-native-remote-state-anchor-mismatch');
    return source;
  }
  if (source.split(ANCHOR).length !== 2 || source.includes(END)) throw Error('harness-native-remote-state-anchor-mismatch');
  return source.replace(ANCHOR, patched);
}

/** 只原子替换选中profile的固定依赖，断开pnpm硬链接，绝不改共享store或其它profile。 */
export function prepareHarnessRemoteState({profileDir}) {
  if (!isAbsolute(profileDir || '')) throw Error('absolute-harness-profile-required');
  const selected = lstatSync(profileDir); if (!selected.isDirectory() || selected.isSymbolicLink()) throw Error('unsafe-harness-remote-state-profile');
  const profile = realpathSync(profileDir), require = createRequire(join(profile, 'package.json'));
  const pkg = realpathSync(dirname(require.resolve('dsh-pet/package.json')));
  if (!inside(profile, pkg)) throw Error('harness-dsh-pet-outside-selected-profile');
  const metaFile = join(pkg, 'package.json'), metaStat = lstatSync(metaFile);
  if (!metaStat.isFile() || metaStat.isSymbolicLink() || metaStat.size > 65536) throw Error('unsafe-harness-remote-state-package');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  if (meta.name !== 'dsh-pet' || meta.version !== '0.3.8') throw Error('harness-dsh-pet-0.3.8-required');
  const file = join(pkg, 'lib/index.js'), parent = realpathSync(dirname(file)), physical = realpathSync(file), beforeStat = lstatSync(file);
  if (!inside(pkg, parent) || !inside(profile, parent) || !inside(pkg, physical) || !inside(profile, physical)) throw Error('unsafe-harness-remote-state-file-outside-profile');
  if (!beforeStat.isFile() || beforeStat.isSymbolicLink() || beforeStat.size > 8 * 1024 * 1024) throw Error('unsafe-harness-remote-state-file');
  const before = readFileSync(file, 'utf8'), after = patchHarnessRemoteState(before);
  if (before === after) return {status: 'current', version: '0.3.8', files: []};
  const current = lstatSync(file);
  if (!current.isFile() || current.isSymbolicLink() || current.ino !== beforeStat.ino || current.dev !== beforeStat.dev || current.size !== beforeStat.size || current.mtimeMs !== beforeStat.mtimeMs || realpathSync(file) !== physical || realpathSync(dirname(file)) !== parent || readFileSync(file, 'utf8') !== before) throw Error('harness-upstream-file-changed');
  const temporary = join(parent, basename(file) + '.qq-state-' + randomUUID());
  try {writeFileSync(temporary, after, {flag: 'wx', mode: beforeStat.mode}); renameSync(temporary, file);} finally {if (existsSync(temporary)) unlinkSync(temporary);}
  return {status: 'updated', version: '0.3.8', files: ['lib/index.js']};
}

// 用已验证的文件句柄读取小型元数据，拒绝软/硬链接；不遍历任何账户和会话目录。
function readSmallJSON(file, maximum = 2048) {
  let descriptor;
  try {
    const before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 2 || before.size > maximum) return null;
    descriptor = openSync(file, 'r'); const opened = fstatSync(descriptor);
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size || opened.nlink !== 1) return null;
    const text = readFileSync(descriptor, 'utf8'), after = fstatSync(descriptor), current = lstatSync(file);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.nlink !== 1 || current.isSymbolicLink() || current.ino !== opened.ino || current.dev !== opened.dev || current.size !== opened.size || current.mtimeMs !== opened.mtimeMs) return null;
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {return null;} finally {if (descriptor !== undefined) closeSync(descriptor);}
}
function activityFile(sourceRoot) {
  try {
    if (!isAbsolute(sourceRoot || '')) return null;
    const source = realpathSync(sourceRoot), sourceStat = lstatSync(source), expected = dirname(source);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink() || basename(expected).toLowerCase() !== 'data') return null;
    const bridge = readSmallJSON(join(source, 'bridge.json'));
    if (!bridge || typeof bridge !== 'object' || Array.isArray(bridge) || Object.keys(bridge).length !== 2 || bridge.schemaVersion !== 1 || !isAbsolute(bridge.dataRoot || '')) return null;
    const dataRoot = realpathSync(bridge.dataRoot); if (!same(dataRoot, expected) || !lstatSync(dataRoot).isDirectory()) return null;
    return join(dataRoot, 'qq-activity.json');
  } catch {return null;}
}

/** 原生种类文案自带中英；这里仅传标准状态，不把独立宿主、账号或消息带进Harness。 */
export function installHarnessRemoteState(ctx, {sourceRoot, locale, now = Date.now, timers = globalThis} = {}) {
  if (typeof now !== 'function' || typeof timers?.setInterval !== 'function' || typeof timers?.clearInterval !== 'function') throw Error('invalid-harness-remote-state-options');
  let disposed = false, stopPoll = () => {}, injection;
  const dispose = () => {if (disposed) return; disposed = true; stopPoll(); injection?.dispose?.();};
  if (!activityFile(sourceRoot)) return {status: 'unavailable', dispose};
  injection = ctx.inject(['codexPetQQState'], child => {
    if (disposed) return;
    stopPoll(); const service = child.get?.('codexPetQQState') ?? child.codexPetQQState;
    if (!service || typeof service.update !== 'function') return;
    let stopped = false, timer;
    const poll = () => {if (stopped || disposed) return; const file = activityFile(sourceRoot); const view = file ? normalizeRemoteQQView(readSmallJSON(file), now()) : null; service.update(view);};
    const stop = () => {if (stopped) return; stopped = true; if (timer !== undefined) timers.clearInterval(timer); service.update(null);};
    stopPoll = stop; child.on?.('dispose', stop); poll(); timer = timers.setInterval(poll, 1500); timer?.unref?.();
    return stop;
  });
  ctx.on?.('dispose', dispose);
  return {status: 'installed', dispose};
}
