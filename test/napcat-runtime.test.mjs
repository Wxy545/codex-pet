import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, lstat, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {deflateRawSync} from 'node:zlib';
import {createNapCatRuntime, NAPCAT_RUNTIME_ARTIFACT} from '../src/napcat-runtime.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// 只生成合成的未压缩 ZIP，不使用账号、下载产物或真实 QQ 数据。
function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, content, attributes = 0, method = 0] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(content), compressed = method === 8 ? deflateRawSync(data) : data, local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(3 << 8 | 20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(attributes >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, compressed); centrals.push(central, filename); offset += local.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const files = () => [
  ['node.exe', 'MZ synthetic node'], ['wrapper.node', 'MZ synthetic native'], ['index.js', '// original synthetic entry'],
  ['config.json', '{}'], ['package.json', '{}'], ['napcat/napcat.mjs', '// synthetic runtime'], ['napcat/static/index.html', '<html>local login</html>'],
];
async function fixture(t, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pet-napcat-test-'))); t.after(() => rm(root, {recursive: true, force: true}));
  let bytes = options.bytes || zip(files()), fetches = 0, nativeStarts = 0, runtimeStarts = 0;
  const children = [], calls = [], snapshots = [];
  const artifact = {...NAPCAT_RUNTIME_ARTIFACT, bytes: bytes.length, sha256: hash(bytes)};
  const runtime = await createNapCatRuntime({dataRoot: root, artifact,
    seal: async value => 'sealed:' + Buffer.from(value).toString('base64'),
    unseal: async value => Buffer.from(value.slice(7), 'base64').toString(),
    fetchImpl: async () => { fetches++; return new Response(bytes); },
    portCheckImpl: async () => {}, probeImpl: async () => true,
    spawnImpl(executable, args, opts) {
      const child = new EventEmitter(); child.killed = false; child.kill = () => {child.killed = true; child.emit('exit', 0); return true;};
      children.push(child); calls.push({executable, args, opts});
      if (args[0] === '-e') { nativeStarts++; setImmediate(() => child.emit('close', 0)); }
      else { runtimeStarts++; setImmediate(() => child.emit('spawn')); }
      return child;
    },
    onState: state => snapshots.push(state),
    ...options.overrides,
  });
  t.after(() => runtime.dispose());
  async function until(state) { for (let i = 0; i < 300 && runtime.state().state !== state; i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(runtime.state().state, state, JSON.stringify(runtime.state())); return runtime.state(); }
  return {runtime, root, artifact, children, calls, snapshots, until,
    get fetches() { return fetches; }, get nativeStarts() { return nativeStarts; }, get runtimeStarts() { return runtimeStarts; },
    setBytes(value) { bytes = value; },
  };
}

test('准备便携包校验并隔离配置，状态不含密钥，prepare/start 单飞且不触碰系统 QQ', async t => {
  const f = await fixture(t);
  assert.equal(f.runtime.state().state, 'not-installed');
  assert.equal(f.runtime.prepare().state, 'preparing'); f.runtime.prepare();
  await f.until('ready'); assert.equal(f.fetches, 1);
  const record = JSON.parse(await readFile(join(f.root, 'napcat/runtime.json'), 'utf8'));
  assert.match(record.secret, /^sealed:/); assert.equal(record.onebotToken, undefined);
  const version = join(f.root, 'napcat/versions/v4.18.42');
  assert.match(await readFile(join(version, 'LICENSE.NapCat.txt'), 'utf8'), /Limited Redistribution License/);
  const manifest = JSON.parse(await readFile(join(version, 'SOURCE.json'), 'utf8'));
  assert.equal(manifest.sha256, f.artifact.sha256); assert.equal(manifest.version, 'v4.18.42');
  const connection = await f.runtime.connection(); assert.equal(connection.url, 'ws://127.0.0.1:17630/'); assert.ok(connection.accessToken.length >= 32);
  assert.equal(await f.runtime.getLoginUrl(), null);
  f.runtime.start(); f.runtime.start(); await f.until('running');
  assert.equal(f.nativeStarts, 1); assert.equal(f.runtimeStarts, 1);
  const launch = f.calls.find(call => call.args[0] !== '-e');
  assert.equal(launch.executable, join(version, 'node.exe')); assert.deepEqual(launch.args, [join(version, 'index.js')]);
  assert.equal(launch.opts.windowsHide, true); assert.equal(launch.opts.shell, false); assert.equal(launch.opts.stdio, 'ignore');
  assert.equal(launch.opts.cwd, join(f.root, 'napcat/work'));
  assert.equal(launch.opts.env.NAPCAT_QQ_DATA_DIR, join(f.root, 'napcat/qq-data')); assert.equal(launch.opts.env.NAPCAT_WORKDIR, join(f.root, 'napcat/work'));
  const web = JSON.parse(await readFile(join(f.root, 'napcat/work/config/webui.json'), 'utf8'));
  const ob = JSON.parse(await readFile(join(f.root, 'napcat/work/config/onebot11.json'), 'utf8'));
  assert.equal(web.host, '127.0.0.1'); assert.equal(web.port, 17631); assert.notEqual(web.token, connection.accessToken);
  assert.equal(ob.network.websocketServers[0].token, connection.accessToken); assert.equal(ob.network.websocketServers[0].reportSelfMessage, false);
  assert.equal(ob.network.websocketServers[0].host, '127.0.0.1'); assert.equal(ob.network.httpServers.length, 0);
  assert.equal(new URL(await f.runtime.getLoginUrl()).searchParams.get('token'), web.token);
  assert.doesNotMatch(JSON.stringify(f.snapshots), new RegExp(connection.accessToken + '|' + web.token));
  assert.deepEqual(Object.keys(f.runtime.state()).sort(), ['canLogin', 'endpoint', 'phase', 'state']);
  assert.equal(f.runtime.prepare().state, 'running'); assert.equal(f.runtimeStarts, 1);
  f.runtime.dispose(); assert.equal(f.children.at(-1).killed, true); assert.equal(f.runtime.state().canLogin, false);
});

test('坏摘要或下载超限失败，不执行下载内容，也不留下可用安装', async t => {
  const f = await fixture(t, {overrides: {artifact: {...NAPCAT_RUNTIME_ARTIFACT, bytes: 12, sha256: '0'.repeat(64)}, fetchImpl: async () => new Response('not a zip!!!')}});
  f.runtime.prepare(); await f.until('error'); assert.equal(f.runtime.state().code, 'archive_digest_mismatch'); assert.equal(f.runtimeStarts, 0);
  const g = await fixture(t, {overrides: {artifact: {...NAPCAT_RUNTIME_ARTIFACT, bytes: 4, sha256: '0'.repeat(64)}, fetchImpl: async () => new Response('too many bytes')}});
  g.runtime.prepare(); await g.until('error'); assert.equal(g.runtime.state().code, 'archive_size_mismatch');
});

test('ZIP 路径穿越、绝对路径、Windows设备名、大小写覆盖和符号链接全部拒绝', async t => {
  for (const extra of [['../escape', 'bad'], ['/absolute', 'bad'], ['C:/outside', 'bad'], ['napcat/CON', 'bad'], ['NODE.exe', 'bad'], ['link', 'outside', 0o120777 << 16]]) {
    const f = await fixture(t, {bytes: zip([...files(), extra])}); f.runtime.prepare(); await f.until('error'); assert.equal(f.runtime.state().code, 'archive_unsafe');
    assert.equal(f.runtimeStarts, 0); assert.equal((await readdir(join(f.root, 'napcat/versions')).catch(() => [])).length, 0);
  }
});

test('已有版本完整性可复用，修改过的版本不覆盖、不运行', async t => {
  const f = await fixture(t); f.runtime.prepare(); await f.until('ready');
  const path = join(f.root, 'napcat/versions/v4.18.42/index.js'); await writeFile(path, '// user change');
  f.runtime.start(); await f.until('error'); assert.equal(f.runtime.state().code, 'runtime_modified'); assert.equal(f.runtimeStarts, 0);
  f.runtime.prepare(); await f.until('error'); assert.equal(f.runtime.state().code, 'runtime_modified'); assert.equal(await readFile(path, 'utf8'), '// user change'); assert.equal(f.fetches, 1);
});

test('端口占用、原生依赖失败和 WebUI 身份验证失败都有明确安全状态', async t => {
  const port = await fixture(t, {overrides: {portCheckImpl: async () => {throw Object.assign(Error('sensitive local details'), {code: 'EADDRINUSE'});}}});
  port.runtime.prepare(); await port.until('ready'); port.runtime.start(); await port.until('error'); assert.equal(port.runtime.state().code, 'port_in_use'); assert.equal(port.runtimeStarts, 0);
  const native = await fixture(t, {overrides: {preflightImpl: async () => {throw Error('secret stderr');}}}); native.runtime.prepare(); await native.until('ready'); native.runtime.start(); await native.until('error'); assert.equal(native.runtime.state().code, 'native_runtime_unavailable');
  const login = await fixture(t, {overrides: {probeImpl: async () => {throw Object.assign(Error('not our server'), {code: 'runtime_identity_mismatch'});}}});
  login.runtime.prepare(); await login.until('ready'); login.runtime.start(); await login.until('error'); assert.equal(login.runtime.state().code, 'runtime_identity_mismatch'); assert.equal(login.children.at(-1).killed, true);
});

test('准备中退出会中止下载，迟到回包不会写版本或恢复运行', async t => {
  let release, signal;
  const f = await fixture(t, {overrides: {fetchImpl: async (_url, init) => {signal = init.signal; return new Promise(resolve => {release = resolve;});}}});
  f.runtime.prepare(); while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  f.runtime.dispose(); assert.equal(signal.aborted, true); release(new Response(zip(files()))); await new Promise(resolve => setTimeout(resolve, 30));
  assert.notEqual(f.runtime.state().state, 'ready'); assert.notEqual(f.runtime.state().state, 'running'); assert.equal(f.runtimeStarts, 0);
  assert.equal((await readdir(join(f.root, 'napcat/versions')).catch(() => [])).length, 0);
});

test('解压注入器产生额外链接或缺文件时，不接受准备完成', async t => {
  const f = await fixture(t, {overrides: {unpackImpl: async (_archive, destination) => {await mkdir(destination, {recursive: true}); await writeFile(join(destination, 'node.exe'), 'MZ');}}});
  f.runtime.prepare(); await f.until('error'); assert.equal(f.runtime.state().code, 'runtime_incomplete');
});

test('DEFLATE 包可准备，重建管理器复用已校验版本与密封口令，不重复下载', async t => {
  const f = await fixture(t, {bytes: zip(files().map(([name, content]) => [name, content, 0, 8]))}); f.runtime.prepare(); await f.until('ready');
  const before = await f.runtime.connection(); f.runtime.dispose(); let downloads = 0;
  const reopened = await createNapCatRuntime({dataRoot: f.root, artifact: f.artifact,
    unseal: async value => Buffer.from(value.slice(7), 'base64').toString(), fetchImpl: async () => {downloads++; throw Error('must not fetch');}});
  t.after(() => reopened.dispose()); assert.equal(reopened.state().state, 'ready'); assert.deepEqual(await reopened.connection(), before);
  reopened.prepare(); for (let i = 0; i < 100 && reopened.state().state === 'preparing'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(reopened.state().state, 'ready'); assert.equal(downloads, 0);
});

test('只维护我方命名连接，已有账户配置、其它连接和 WebUI 外观保留', async t => {
  const f = await fixture(t); f.runtime.prepare(); await f.until('ready'); const config = join(f.root, 'napcat/work/config'); await mkdir(config, {recursive: true});
  const account = join(config, 'onebot11_123456789.json');
  await writeFile(account, JSON.stringify({network: {httpServers: [{name: 'user-http', port: 19001}], websocketServers: [{name: 'user-ws', enable: true, port: 19002}, {name: 'codex-pet-managed', enable: false, port: 12000}]}, musicSignUrl: 'https://example.invalid/user-owned'}));
  await writeFile(join(config, 'webui.json'), JSON.stringify({theme: {localAppearance: 'kept'}, host: '0.0.0.0'}));
  f.runtime.start(); await f.until('running'); const saved = JSON.parse(await readFile(account, 'utf8'));
  assert.deepEqual(saved.network.httpServers, [{name: 'user-http', port: 19001}]); assert.equal(saved.network.websocketServers.filter(value => value.name === 'codex-pet-managed').length, 1);
  assert.equal(saved.network.websocketServers[0].name, 'user-ws'); assert.equal(saved.musicSignUrl, 'https://example.invalid/user-owned');
  assert.deepEqual(JSON.parse(await readFile(join(config, 'webui.json'), 'utf8')).theme, {localAppearance: 'kept'});
});

test('运行时异常退出可重试，旧启动探测迟到也不会覆盖新实例状态', async t => {
  let release, probes = 0;
  const f = await fixture(t, {overrides: {probeImpl: async () => ++probes === 1 ? new Promise(resolve => {release = resolve;}) : true}});
  f.runtime.prepare(); await f.until('ready'); f.runtime.start(); while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  f.children.at(-1).emit('exit', 1); assert.equal(f.runtime.state().code, 'runtime_exited');
  f.runtime.start(); release(true); await f.until('running'); assert.equal(f.runtimeStarts, 2); assert.equal(f.runtime.state().canLogin, true);
});

test('第三方配置目录不能通过已有 junction 引到其它目录', async t => {
  const f = await fixture(t); const other = join(f.root, 'outside'); await mkdir(other);
  try {await symlink(other, join(f.root, 'napcat'), 'junction');} catch (error) {if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {t.skip('当前账号不能创建目录链接'); return;} throw error;}
  f.runtime.prepare(); await f.until('error'); assert.equal(f.runtime.state().code, 'unsafe_path'); assert.equal(f.fetches, 0); assert.deepEqual(await readdir(other), []);
});

test('下载超时返回固定错误码，不把上游响应或内部错误放入状态', async t => {
  const f = await fixture(t, {overrides: {downloadTimeoutMs: 10, fetchImpl: async (_url, {signal}) => new Promise((_resolve, reject) => {signal.addEventListener('abort', () => reject(Error('sensitive remote body')));})}});
  f.runtime.prepare(); await f.until('error'); assert.equal(f.runtime.state().code, 'download_timeout'); assert.doesNotMatch(JSON.stringify(f.snapshots), /sensitive/);
});

test('原生模块加载后保留句柄时，预检仍能显式正常退出', async t => {
  let stub;
  const f = await fixture(t, {overrides: {nativeTimeoutMs: 1000, spawnImpl(_executable, args, options) {
    if (args[0] === '-e') return spawn(process.execPath, ['-e', args[1].replace(/^const w=require\([\s\S]*?\);/, 'const w=require(' + JSON.stringify(stub) + ');')], options);
    const child = new EventEmitter(); child.kill = () => {child.emit('exit', 0); return true;}; setImmediate(() => child.emit('spawn')); return child;
  }}});
  stub = join(f.root, 'synthetic-native-with-open-handle.cjs');
  await writeFile(stub, "require('node:fs').writeFileSync('beacon_report.log','');module.exports={NodeQQNTWrapperUtil:{}};setInterval(()=>{},1000);");
  f.runtime.prepare(); await f.until('ready'); f.runtime.start(); await f.until('running');
  assert.equal(f.runtime.state().canLogin, true);
  assert.equal((await lstat(join(f.root, 'napcat/work/beacon_report.log'))).size, 0);
  assert.equal(await lstat(join(f.root, 'napcat/versions/v4.18.42/beacon_report.log')).catch(() => null), null);
});

test('只在全部官方文件校验成功后迁移旧空beacon日志，不改变原摘要或重复下载', async t => {
  const f = await fixture(t); f.runtime.prepare(); await f.until('ready'); f.runtime.dispose();
  const version = join(f.root, 'napcat/versions/v4.18.42'), manifest = await readFile(join(version, 'SOURCE.json'), 'utf8');
  await writeFile(join(version, 'beacon_report.log'), ''); let downloads = 0;
  const reopened = await createNapCatRuntime({dataRoot: f.root, artifact: f.artifact, unseal: async value => Buffer.from(value.slice(7), 'base64').toString(), fetchImpl: async () => {downloads++; throw Error('unexpected download');}}); t.after(() => reopened.dispose());
  assert.equal(reopened.state().state, 'ready'); assert.equal(downloads, 0); assert.equal(await readFile(join(version, 'SOURCE.json'), 'utf8'), manifest);
  assert.equal(await lstat(join(version, 'beacon_report.log')).catch(() => null), null);
  assert.equal((await readdir(join(f.root, 'napcat/work'))).filter(name => name.startsWith('beacon-report.legacy-')).length, 1);
});

test('非空beacon、其它新增文件或代码篡改都拒收，不能借日志迁移放宽校验', async t => {
  for (const [filename, contents, tamper] of [['beacon_report.log', 'synthetic unreviewed contents', false], ['unknown.log', '', false], ['beacon_report.log', '', true]]) {
    const f = await fixture(t); f.runtime.prepare(); await f.until('ready'); f.runtime.dispose(); const version = join(f.root, 'napcat/versions/v4.18.42');
    await writeFile(join(version, filename), contents); if (tamper) await writeFile(join(version, 'index.js'), '// changed code');
    const reopened = await createNapCatRuntime({dataRoot: f.root, artifact: f.artifact, unseal: async value => Buffer.from(value.slice(7), 'base64').toString()}); t.after(() => reopened.dispose());
    assert.equal(reopened.state().code, 'runtime_modified'); assert.equal(await readFile(join(version, filename), 'utf8'), contents);
    assert.doesNotMatch(JSON.stringify(reopened.state()), /synthetic unreviewed/);
  }
});
