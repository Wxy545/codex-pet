import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir, lstat, realpath, readFile, writeFile, readdir, rename, rm, open} from 'node:fs/promises';
import {join, resolve, relative, isAbsolute, dirname} from 'node:path';
import {createServer} from 'node:net';
import {inflateRawSync} from 'node:zlib';
import {protectQQSecret, unprotectQQSecret} from './qq-secrets.mjs';

// 固定官方已核对的便携包；不运行安装脚本、不注入电脑上原有的 QQ。
export const NAPCAT_RUNTIME_ARTIFACT = Object.freeze({
  version: 'v4.18.42', bytes: 124162399,
  sha256: '77397ac38d66f46383e48f08f35d5f9d37ec575c22069f62d6c600e73b4521ed',
  url: 'https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.42/NapCat.Shell.Windows.Node.zip',
  source: 'https://github.com/NapNeko/NapCatQQ/tree/v4.18.42',
  license: 'https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/LICENSE',
});
const LICENSE = `Limited Redistribution License for NapCat

Copyright © 2024 Mlikiowa

1. Usage and Reproduction:
   - Unauthorized use, reproduction, modification, or distribution of this code is prohibited without explicit permission from the main author of the NapCat repository.
\x20\x20\x20
2. Redistribution:
   - Redistribution of this code is permitted, provided that the full text of this license is included, and the source and copyright information is clearly stated.
   - Minor modifications and extensions are allowed for redistribution purposes, but the modified code must not be publicly released.

3. Non-Commercial Use:
   - This code is not to be used for any commercial purposes.

4. Additional Permissions:
   - Any rights not explicitly addressed in this license must be requested from and granted by the main author of the NapCat repository.

5. Disclaimer:
   - This code is provided "as is," without any express or implied warranties, including but not limited to the implied warranties of merchantability and fitness for a particular purpose. In no event shall the author be liable for any damages or other liability arising from, out of, or in connection with the use or distribution of this code.`;
const ENDPOINT = 'ws://127.0.0.1:17630/', WEB_PORT = 17631, ONEBOT_PORT = 17630;
const MAX_ARCHIVE = 160 * 1024 * 1024, MAX_EXPANDED = 768 * 1024 * 1024, MAX_ENTRY = 256 * 1024 * 1024;
const REQUIRED = ['node.exe', 'index.js', 'wrapper.node', 'config.json', 'package.json', 'napcat/napcat.mjs', 'napcat/static/index.html'];
const hash = value => createHash('sha256').update(value).digest('hex');
const safeCodes = new Set(['archive_size_mismatch', 'archive_digest_mismatch', 'archive_unsafe', 'download_failed', 'download_timeout', 'runtime_incomplete', 'runtime_modified', 'runtime_conflict', 'runtime_identity_mismatch', 'runtime_start_timeout', 'runtime_exited', 'runtime_spawn_failed', 'native_runtime_unavailable', 'port_in_use', 'secret_store_unavailable', 'config_invalid', 'config_conflict', 'preparation_locked', 'unsafe_path', 'not_prepared', 'prepare_failed', 'start_failed', 'runtime_disposed']);
const fail = code => {throw Object.assign(Error(code), {code});};
const safeCode = (error, fallback) => safeCodes.has(error?.code) ? error.code : fallback;
const inside = (root, candidate) => {const part = relative(root, candidate); return !isAbsolute(part) && part !== '..' && !part.startsWith('..\\') && !part.startsWith('../');};
const absent = error => error?.code === 'ENOENT';
async function statOrNull(file) {try {return await lstat(file);} catch (error) {if (absent(error)) return null; throw error;}}
function entryName(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || /[\x00-\x1f:<>"|?*]/.test(name) || name.startsWith('/')) fail('archive_unsafe');
  const parts = name.replace(/\/$/, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('archive_unsafe');
  return name;
}
async function ensureDirectory(root, target) {
  if (!inside(root, target)) fail('unsafe_path');
  const parts = relative(root, target).split(/[\\/]/).filter(Boolean); let current = root;
  for (const part of parts) {
    current = join(current, part); let stat = await statOrNull(current);
    if (!stat) {await mkdir(current); stat = await lstat(current);}
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_path');
  }
}
async function checkedFile(root, file, maximum) {
  await ensureDirectory(root, dirname(file)); const stat = await statOrNull(file);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximum) fail('runtime_incomplete');
  const actual = await realpath(file); if (!inside(root, actual)) fail('unsafe_path');
  return readFile(file);
}
async function jsonFile(root, file, maximum = 256 * 1024) {
  try {return JSON.parse((await checkedFile(root, file, maximum)).toString('utf8'));} catch (error) {if (safeCodes.has(error.code)) throw error; fail('config_invalid');}
}
async function atomicJSON(root, file, value) {
  await ensureDirectory(root, dirname(file)); const existing = await statOrNull(file);
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) fail('unsafe_path');
  const temporary = join(dirname(file), '.' + randomUUID() + '.tmp');
  try {await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: 'wx'}); await rename(temporary, file);} finally {await rm(temporary, {force: true}).catch(() => {});}
}

// 先检查整个中央目录，再解压任何条目。限制体积、类型及 Windows 路径语义，拒绝链接与重名覆盖。
function inspectZip(bytes) {
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (bytes.readUInt32LE(index) === 0x06054b50 && index + 22 + bytes.readUInt16LE(index + 20) === bytes.length) {end = index; break;}
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail('archive_unsafe');
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (!count || count > 30000 || count !== bytes.readUInt16LE(end + 8) || start + size !== end) fail('archive_unsafe');
  const names = new Set(), entries = []; let position = start, total = 0;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50) fail('archive_unsafe');
    const flags = bytes.readUInt16LE(position + 8), method = bytes.readUInt16LE(position + 10), compressed = bytes.readUInt32LE(position + 20), expanded = bytes.readUInt32LE(position + 24);
    const nameSize = bytes.readUInt16LE(position + 28), extraSize = bytes.readUInt16LE(position + 30), commentSize = bytes.readUInt16LE(position + 32), external = bytes.readUInt32LE(position + 38), local = bytes.readUInt32LE(position + 42);
    const next = position + 46 + nameSize + extraSize + commentSize;
    if (next > end || flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || expanded > MAX_ENTRY || bytes.readUInt16LE(position + 34)) fail('archive_unsafe');
    let name; try {name = new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(position + 46, position + 46 + nameSize));} catch {fail('archive_unsafe');}
    entryName(name); const key = name.replace(/\/$/, '').toLowerCase(), type = (external >>> 16) & 0o170000, directory = name.endsWith('/');
    if (names.has(key) || (type && type !== 0o100000 && type !== 0o040000) || type === 0o040000 && !directory || external & 0x400) fail('archive_unsafe');
    names.add(key); total += expanded; if (total > MAX_EXPANDED || directory && expanded !== 0) fail('archive_unsafe');
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt16LE(local + 6) & 1) fail('archive_unsafe');
    const localNameSize = bytes.readUInt16LE(local + 26), data = local + 30 + localNameSize + bytes.readUInt16LE(local + 28);
    if (!bytes.subarray(local + 30, local + 30 + localNameSize).equals(bytes.subarray(position + 46, position + 46 + nameSize)) || data + compressed > start) fail('archive_unsafe');
    entries.push({name, directory, method, data, compressed, expanded, local}); position = next;
  }
  if (position !== start + size) fail('archive_unsafe');
  const ordered = [...entries].sort((a, b) => a.local - b.local);
  if (ordered.some((entry, index) => index && entry.local < ordered[index - 1].data + ordered[index - 1].compressed)) fail('archive_unsafe');
  return entries;
}
async function unpackZip(bytes, destination, entries) {
  for (const entry of entries) {
    const target = join(destination, ...entry.name.split('/'));
    if (entry.directory) {await ensureDirectory(destination, target); continue;}
    await ensureDirectory(destination, dirname(target)); let data;
    try {const compressed = bytes.subarray(entry.data, entry.data + entry.compressed); data = entry.method === 8 ? inflateRawSync(compressed, {maxOutputLength: entry.expanded + 1}) : compressed;} catch {fail('archive_unsafe');}
    if (data.length !== entry.expanded) fail('archive_unsafe');
    await writeFile(target, data, {flag: 'wx', mode: 0o600});
  }
}
async function treeFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const name of await readdir(directory)) {
      const file = join(directory, name), stat = await lstat(file), key = relative(root, file).replaceAll('\\', '/'); entryName(key);
      if (stat.isSymbolicLink() || !inside(root, await realpath(file))) fail('unsafe_path');
      if (stat.isDirectory()) await walk(file);
      else if (stat.isFile() && stat.nlink === 1 && stat.size <= MAX_ENTRY) files.push({key, file, stat});
      else fail('unsafe_path');
    }
  }
  await walk(root); return files;
}
async function hashFiles(entries) {
  const files = Object.create(null);
  for (const {key, file, stat} of entries) files[key] = {bytes: stat.size, sha256: hash(await readFile(file))};
  return files;
}
const treeHashes = async root => hashFiles(await treeFiles(root));
async function assertPorts() {
  const servers = [];
  try {
    for (const port of [ONEBOT_PORT, WEB_PORT]) await new Promise((resolvePromise, reject) => {
      const server = createServer(); servers.push(server); server.once('error', reject); server.listen({host: '127.0.0.1', port, exclusive: true}, resolvePromise);
    });
  } catch {fail('port_in_use');} finally {await Promise.all(servers.map(server => new Promise(resolvePromise => server.listening ? server.close(resolvePromise) : resolvePromise())));}
}

export async function createNapCatRuntime({dataRoot, fetchImpl = fetch, spawnImpl = spawn, unpackImpl, seal = protectQQSecret, unseal = unprotectQQSecret,
  artifact = NAPCAT_RUNTIME_ARTIFACT, onState = () => {}, portCheckImpl = assertPorts, preflightImpl, probeImpl,
  downloadTimeoutMs = 600000, startupTimeoutMs = 45000, nativeTimeoutMs = 15000, pollIntervalMs = 350} = {}) {
  if (!dataRoot || artifact.version !== NAPCAT_RUNTIME_ARTIFACT.version || artifact.url !== NAPCAT_RUNTIME_ARTIFACT.url || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > MAX_ARCHIVE) fail('config_invalid');
  await mkdir(resolve(dataRoot), {recursive: true}); const data = await realpath(resolve(dataRoot));
  const base = join(data, 'napcat'), versions = join(base, 'versions'), version = join(versions, artifact.version), work = join(base, 'work'), qqData = join(base, 'qq-data'), recordFile = join(base, 'runtime.json');
  let snapshot = {state: 'not-installed', phase: 'idle', endpoint: ENDPOINT, canLogin: false}, installed = false, stopped = false, pending = null, controller = null, child = null, tokens = null, generation = 0;
  const owned = new Set(), cancelNative = new Set();
  const state = () => ({...snapshot});
  function publish(value, phase = value, code) {snapshot = {state: value, phase, ...(code ? {code} : {}), endpoint: ENDPOINT, canLogin: value === 'running'}; try {onState(state());} catch { /* 面板异常不能改变运行时生命周期。 */ } return state();}
  const active = ticket => {if (stopped || ticket !== generation) fail('runtime_disposed');};
  async function verifyInstalled() {
    const existing = await statOrNull(version); if (!existing) return false;
    if (!existing.isDirectory() || existing.isSymbolicLink()) fail('unsafe_path');
    await ensureDirectory(data, version);
    const manifest = await jsonFile(data, join(version, 'SOURCE.json'), 8 * 1024 * 1024);
    if (manifest.schema !== 1 || manifest.version !== artifact.version || manifest.url !== artifact.url || manifest.source !== artifact.source || manifest.license !== artifact.license || manifest.sha256 !== artifact.sha256 || manifest.bytes !== artifact.bytes || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) fail('runtime_conflict');
    // 原生QQ的beacon SDK会在cwd创建空日志。只迁移旧版本运行留下的这一项；未知文件先拒绝，不读取正文。
    const entries = await treeFiles(version), extra = entries.filter(entry => entry.key !== 'SOURCE.json' && !Object.hasOwn(manifest.files, entry.key));
    if (extra.some(entry => entry.key !== 'beacon_report.log' || entry.stat.size !== 0)) fail('runtime_modified');
    const actual = await hashFiles(entries.filter(entry => entry.key !== 'SOURCE.json' && Object.hasOwn(manifest.files, entry.key)));
    if (REQUIRED.some(name => !actual[name]) || !actual['LICENSE.NapCat.txt']) fail('runtime_incomplete');
    if (Object.keys(actual).length !== Object.keys(manifest.files).length || Object.entries(actual).some(([name, info]) => info.sha256 !== manifest.files[name]?.sha256 || info.bytes !== manifest.files[name]?.bytes)) fail('runtime_modified');
    if (extra.length) {
      await ensureDirectory(data, work);
      for (const entry of extra) {
        const current = await lstat(entry.file);
        if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.size !== 0 || current.ino !== entry.stat.ino || current.dev !== entry.stat.dev) fail('runtime_modified');
        const target = join(work, 'beacon-report.legacy-' + randomUUID() + '.log');
        if (!inside(work, target) || !inside(version, entry.file)) fail('unsafe_path');
        await rename(entry.file, target);
      }
    }
    return true;
  }
  async function getTokens(create = false) {
    if (tokens) return tokens;
    const existing = await statOrNull(recordFile);
    if (existing) {
      const record = await jsonFile(data, recordFile);
      if (record.schema !== 1 || typeof record.secret !== 'string' || record.secret.length > 128000) fail('secret_store_unavailable');
      try {tokens = JSON.parse(await unseal(record.secret));} catch {fail('secret_store_unavailable');}
      if (!tokens || !/^[a-zA-Z0-9_-]{43,96}$/.test(tokens.onebotToken || '') || !/^[a-zA-Z0-9_-]{43,96}$/.test(tokens.webuiToken || '') || tokens.onebotToken === tokens.webuiToken) {tokens = null; fail('secret_store_unavailable');}
    } else if (create) {
      const next = {onebotToken: randomBytes(32).toString('base64url'), webuiToken: randomBytes(32).toString('base64url')}; let sealed;
      try {sealed = await seal(JSON.stringify(next));} catch {fail('secret_store_unavailable');}
      if (typeof sealed !== 'string' || !sealed || sealed.length > 128000) fail('secret_store_unavailable');
      await atomicJSON(data, recordFile, {schema: 1, secret: sealed}); tokens = next;
    } else fail('not_prepared');
    return tokens;
  }
  async function writeConfigs() {
    const secret = await getTokens(); const config = join(work, 'config'); await ensureDirectory(data, config); await ensureDirectory(data, qqData);
    const webPath = join(config, 'webui.json'), previous = await statOrNull(webPath) ? await jsonFile(data, webPath) : {};
    await atomicJSON(data, webPath, {...previous, host: '127.0.0.1', port: WEB_PORT, token: secret.webuiToken, loginRate: 10, autoLoginAccount: '', disableWebUI: false});
    const server = {name: 'codex-pet-managed', enable: true, host: '127.0.0.1', port: ONEBOT_PORT, reportSelfMessage: false, enableForcePushEvent: true, messagePostFormat: 'array', token: secret.onebotToken, debug: false, heartInterval: 30000};
    const names = new Set(['onebot11.json', ...(await readdir(config)).filter(name => /^onebot11_[1-9]\d{4,19}\.json$/.test(name))]);
    for (const name of names) {
      const file = join(config, name), previous = await statOrNull(file) ? await jsonFile(data, file) : {}, network = previous.network || {};
      if (typeof network !== 'object' || Array.isArray(network)) fail('config_invalid');
      const merged = {...network};
      for (const type of ['httpServers', 'httpSseServers', 'httpClients', 'websocketServers', 'websocketClients', 'plugins']) {if (merged[type] != null && !Array.isArray(merged[type])) fail('config_invalid'); merged[type] ||= [];}
      if (merged.websocketServers.some(value => value?.name !== server.name && value?.enable && value?.port === ONEBOT_PORT)) fail('config_conflict');
      merged.websocketServers = [...merged.websocketServers.filter(value => value?.name !== server.name), server];
      await atomicJSON(data, file, {...previous, network: merged, musicSignUrl: previous.musicSignUrl || '', enableLocalFile2Url: previous.enableLocalFile2Url ?? false, parseMultMsg: previous.parseMultMsg ?? false, imageDownloadProxy: previous.imageDownloadProxy || ''});
    }
  }
  async function doPrepare(ticket) {
    await ensureDirectory(data, base); await ensureDirectory(data, versions);
    if (await verifyInstalled()) {await getTokens(); active(ticket); installed = true; return 'ready';}
    const lockPath = join(base, '.prepare.lock'); let lock;
    try {lock = await open(lockPath, 'wx', 0o600);} catch (error) {if (error.code === 'EEXIST') fail('preparation_locked'); throw error;}
    const temporary = join(base, '.prepare-' + randomUUID());
    try {
      await ensureDirectory(data, temporary); await getTokens(true); active(ticket);
      publish('preparing', 'downloading'); controller = new AbortController(); const timeout = setTimeout(() => controller?.abort(), downloadTimeoutMs); let bytes;
      try {
        const response = await fetchImpl(artifact.url, {signal: controller.signal, redirect: 'follow', headers: {'User-Agent': 'codex-pet-runtime'}}); active(ticket);
        if (!response.ok || !response.body) fail('download_failed');
        const declared = response.headers.get('content-length'); if (declared && Number(declared) !== artifact.bytes) fail('archive_size_mismatch');
        const chunks = []; let received = 0;
        for await (const chunk of response.body) {active(ticket); received += chunk.length; if (received > artifact.bytes || received > MAX_ARCHIVE) fail('archive_size_mismatch'); chunks.push(Buffer.from(chunk));}
        if (received !== artifact.bytes) fail('archive_size_mismatch'); bytes = Buffer.concat(chunks);
      } catch (error) {if (controller.signal.aborted && !stopped) fail('download_timeout'); throw error;} finally {clearTimeout(timeout); controller = null;}
      active(ticket); publish('preparing', 'verifying'); if (hash(bytes) !== artifact.sha256) fail('archive_digest_mismatch');
      const entries = inspectZip(bytes), payload = join(temporary, 'payload'); await ensureDirectory(data, payload); active(ticket); publish('preparing', 'extracting');
      if (unpackImpl) await unpackImpl(bytes, payload, entries); else await unpackZip(bytes, payload, entries);
      active(ticket); const extracted = await treeHashes(payload);
      if (REQUIRED.some(name => !extracted[name])) fail('runtime_incomplete');
      if (Object.keys(extracted).length !== entries.filter(entry => !entry.directory).length || entries.some(entry => !entry.directory && extracted[entry.name]?.bytes !== entry.expanded)) fail('archive_unsafe');
      for (const name of ['node.exe', 'wrapper.node']) if ((await readFile(join(payload, name))).subarray(0, 2).toString() !== 'MZ') fail('runtime_incomplete');
      await writeFile(join(payload, 'LICENSE.NapCat.txt'), LICENSE, {flag: 'wx', mode: 0o600});
      const files = await treeHashes(payload); const manifest = {schema: 1, version: artifact.version, url: artifact.url, bytes: artifact.bytes, sha256: artifact.sha256, source: artifact.source, license: artifact.license, licenseName: 'Limited Redistribution License for NapCat', files};
      await atomicJSON(data, join(payload, 'SOURCE.json'), manifest); active(ticket);
      if (await statOrNull(version)) fail('runtime_conflict'); await rename(payload, version); active(ticket);
      installed = true; return 'ready';
    } finally {
      if (inside(base, temporary) && (await statOrNull(temporary))?.isDirectory()) await rm(temporary, {recursive: true, force: true}).catch(() => {});
      await lock.close().catch(() => {}); await rm(lockPath, {force: true}).catch(() => {});
    }
  }
  function launchEnvironment() {
    const env = {...process.env}; for (const name of Object.keys(env)) if (/^NAPCAT_/i.test(name) || /^NODE_(OPTIONS|PATH)$/i.test(name)) delete env[name];
    return {...env, NAPCAT_QQ_DATA_DIR: qqData, NAPCAT_WORKDIR: work, NAPCAT_WEBUI_PREFERRED_PORT: String(WEB_PORT)};
  }
  async function nativeCheck(env) {
    if (preflightImpl) {try {await preflightImpl({directory: version, workDir: work}); return;} catch {fail('native_runtime_unavailable');}}
    await new Promise((resolvePromise, reject) => {
      let processChild, done = false, timer;
      const cancel = () => finish(false);
      const finish = ok => {if (done) return; done = true; clearTimeout(timer); cancelNative.delete(cancel); owned.delete(processChild); ok ? resolvePromise() : reject(Object.assign(Error('native_runtime_unavailable'), {code: 'native_runtime_unavailable'}));};
      // QQ原生模块加载成功后仍保留活动句柄；与上游CI一致，探测完成必须显式退出。
      try {processChild = spawnImpl(join(version, 'node.exe'), ['-e', 'const w=require(' + JSON.stringify(join(version, 'wrapper.node')) + ');if(!w.NodeQQNTWrapperUtil)process.exit(2);process.exit(0)'], {cwd: work, env, windowsHide: true, shell: false, stdio: 'ignore'}); owned.add(processChild);} catch {finish(false); return;}
      cancelNative.add(cancel); processChild.once('error', () => finish(false)); processChild.once('close', code => finish(code === 0));
      timer = setTimeout(() => {processChild.kill(); finish(false);}, nativeTimeoutMs);
    });
  }
  async function probe(secret, signal) {
    if (probeImpl) return probeImpl({origin: 'http://127.0.0.1:' + WEB_PORT, token: secret.webuiToken, signal});
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(1800)]); let html;
    try {html = await fetchImpl('http://127.0.0.1:' + WEB_PORT + '/webui/', {signal: requestSignal});} catch {return false;}
    if (!html.ok) return false; await html.body?.cancel().catch(() => {});
    let response, result;
    try {response = await fetchImpl('http://127.0.0.1:' + WEB_PORT + '/api/auth/login', {method: 'POST', signal: requestSignal, headers: {'content-type': 'application/json'}, body: JSON.stringify({hash: hash(secret.webuiToken + '.napcat')})}); result = await response.json();} catch {fail('runtime_identity_mismatch');}
    if (!response.ok || result.code !== 0 || typeof result.data?.Credential !== 'string') fail('runtime_identity_mismatch');
    return true;
  }
  async function doStart(ticket) {
    if (!await verifyInstalled()) fail('not_prepared'); const secret = await getTokens(); active(ticket);
    await ensureDirectory(data, work); await ensureDirectory(data, qqData);
    publish('starting', 'checking-runtime'); const env = launchEnvironment(); await nativeCheck(env); active(ticket);
    publish('starting', 'checking-ports'); try {await portCheckImpl([ONEBOT_PORT, WEB_PORT]);} catch {fail('port_in_use');}
    active(ticket); await writeConfigs(); active(ticket); publish('starting', 'launching');
    try {child = spawnImpl(join(version, 'node.exe'), [join(version, 'index.js')], {cwd: work, env, windowsHide: true, shell: false, stdio: 'ignore'}); owned.add(child);} catch {fail('runtime_spawn_failed');}
    const launched = child;
    const launchController = new AbortController(); controller = launchController;
    launched.once('error', () => {if (!stopped && ticket === generation) {pending = null; generation++; launchController.abort(); publish('error', 'error', 'runtime_spawn_failed');} owned.delete(launched);});
    launched.once('exit', () => {owned.delete(launched); if (child === launched) child = null; if (!stopped && ticket === generation) {pending = null; generation++; launchController.abort(); publish('error', 'error', 'runtime_exited');}});
    const signal = launchController.signal, deadline = Date.now() + startupTimeoutMs;
    try {
      while (Date.now() < deadline) {active(ticket); if (await probe(secret, signal)) {active(ticket); return 'running';} await new Promise(resolvePromise => setTimeout(resolvePromise, pollIntervalMs));}
      fail('runtime_start_timeout');
    } finally {if (controller === launchController) controller = null;}
  }
  function begin(kind, action) {
    if (stopped || pending || snapshot.state === 'running') return state();
    const ticket = ++generation; publish(kind);
    const job = action(ticket); pending = job;
    void job.then(result => {if (pending === job) pending = null; if (!stopped && ticket === generation) publish(result);}, error => {
      if (pending === job) pending = null;
      if (stopped || ticket !== generation) return;
      if (kind === 'starting' && child) {const own = child; child = null; owned.delete(own); own.removeAllListeners('exit'); try {own.kill();} catch { /* 不影响安全错误状态。 */ }}
      publish('error', 'error', safeCode(error, kind === 'preparing' ? 'prepare_failed' : 'start_failed'));
    });
    return state();
  }
  try {if (await statOrNull(base)) {await ensureDirectory(data, base); if (await verifyInstalled()) {await getTokens(); installed = true; publish('ready');}}} catch (error) {publish('error', 'error', safeCode(error, 'prepare_failed'));}
  return {
    state,
    prepare: () => begin('preparing', doPrepare),
    start: () => begin('starting', doStart),
    async connection() {if (!installed || stopped) fail('not_prepared'); const secret = await getTokens(); return {url: ENDPOINT, accessToken: secret.onebotToken};},
    async getLoginUrl() {if (!snapshot.canLogin || stopped) return null; return 'http://127.0.0.1:' + WEB_PORT + '/webui?token=' + encodeURIComponent((await getTokens()).webuiToken);},
    dispose() {if (stopped) return; stopped = true; generation++; controller?.abort(); for (const processChild of owned) {try {processChild.kill();} catch { /* 只清理本管理器创建的子进程。 */ }} for (const cancel of cancelNative) cancel(); owned.clear(); child = null; tokens = null; publish(installed ? 'ready' : 'not-installed', 'stopped');},
  };
}
