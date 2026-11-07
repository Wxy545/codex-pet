import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Script, runInNewContext } from 'node:vm';
import { ensureHelperProfile, patchHelperStartup } from '../harness/helper-startup-fix.mjs';
import {patchModularMain,patchModularUserData,validateModularDpi,validateModularMain} from '../harness/modular-runtime-fix.mjs';
import {readUpstream,upstreamVersion} from './support/harness-upstream.mjs';

const modular=['0.4.0','0.4.1','0.4.3','0.4.5'].includes(upstreamVersion);
assert.ok(modular||upstreamVersion==='0.3.8','测试只接受已审核的dsh-pet版本');
// 独立宿主准备时显式选择app-profile；测试共享函数前仅还原这个已知参数，保留实际函数体。
const actualMain = () => readUpstream('runtime/electron-helper/main.js').replace(/(const userDataDecision = resolveUserDataDir\(\{[\s\S]*?\n  appMode:) true,(\n\}\);)/,'$1 APP_MODE,$2');
const originalProfile = source => source.replace(/\/\/ codex-pet-helper-profile-v1:(?:true|false)\n[\s\S]*?(?=\/\/ ② 宿主探测)/, '');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'pet-helper-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = path.join(root, 'original'), home = path.join(root, 'home'), calls = [];
  const app = { getPath: () => current, setPath: (...args) => calls.push(args) };
  const input = { app, fileSystem: fs, path, env: { DSH_HOME: home }, home: () => root, randomUUID, appMode: true };
  return { root, current, home, calls, input };
}

test('可写原profile保持原样，探针使用独占随机文件并清理', t => {
  const f = fixture(t); fs.mkdirSync(f.current); fs.writeFileSync(path.join(f.current, 'saved.json'), 'keep');
  fs.writeFileSync(path.join(f.current, '.dsh-pet-write-probe'), 'existing-user-file');
  const result = ensureHelperProfile(f.input);
  assert.equal(result.status, 'current'); assert.equal(result.dir, f.current); assert.deepEqual(f.calls, []);
  assert.equal(fs.readFileSync(path.join(f.current, '.dsh-pet-write-probe'), 'utf8'), 'existing-user-file');
  assert.deepEqual(fs.readdirSync(f.current).sort(), ['.dsh-pet-write-probe', 'saved.json']);
  assert.equal(fs.existsSync(f.home), false);
});

test('原profile不可写才切自有fallback，独立宿主与Harness目录分开', t => {
  const f = fixture(t); fs.writeFileSync(f.current, 'not-a-directory');
  for (const appMode of [true, false]) {
    f.calls.length = 0;
    const result = ensureHelperProfile({ ...f.input, appMode });
    const expected = path.join(f.home, 'dsh-pet', appMode ? 'app-profile' : 'electron-profile');
    assert.equal(result.status, 'fallback'); assert.equal(result.dir, expected);
    assert.deepEqual(f.calls, [['userData', expected]]); assert.deepEqual(fs.readdirSync(expected), []);
  }
  assert.equal(fs.readFileSync(f.current, 'utf8'), 'not-a-directory');
});

test('getPath异常仍可选择fallback；未设DSH_HOME使用原生home', t => {
  const f = fixture(t); f.input.app.getPath = () => { throw Error('no-path'); };
  const result = ensureHelperProfile({ ...f.input, env: {}, appMode: false });
  assert.equal(result.status, 'fallback');
  assert.equal(result.dir, path.join(f.root, '.dsh', 'dsh-pet', 'electron-profile'));
  assert.deepEqual(fs.readdirSync(result.dir), []);
});

test('两处不可用、相对home或setPath失败均不报告恢复', t => {
  const f = fixture(t); fs.writeFileSync(f.current, 'original'); fs.writeFileSync(f.home, 'blocked');
  assert.equal(ensureHelperProfile(f.input).status, 'unavailable'); assert.deepEqual(f.calls, []);
  assert.equal(ensureHelperProfile({ ...f.input, env: { DSH_HOME: 'relative' } }).status, 'unavailable');
  fs.unlinkSync(f.home); f.input.app.setPath = () => { throw Error('set-path-rejected'); };
  const result = ensureHelperProfile(f.input); assert.equal(result.status, 'unavailable'); assert.equal(result.fallback, false);
});

test('写探针失败也关闭并清理本次文件，wx碰撞不会覆盖或删除他人文件', t => {
  const f = fixture(t); let created, closed = 0, removed = 0;
  const failing = { ...fs, writeFileSync(fd) { if (typeof fd === 'number') { created = true; throw Error('write-failed'); } }, closeSync(fd) { closed++; fs.closeSync(fd); }, unlinkSync(file) { removed++; fs.unlinkSync(file); } };
  assert.equal(ensureHelperProfile({ ...f.input, fileSystem: failing }).status, 'unavailable');
  assert.equal(created, true); assert.equal(closed, 2); assert.equal(removed, 2);
  assert.deepEqual(fs.readdirSync(f.current), []); assert.deepEqual(fs.readdirSync(path.join(f.home, 'dsh-pet', 'app-profile')), []);
  const existing = path.join(f.current, '.codex-pet-write-probe-collision'); fs.writeFileSync(existing, 'do-not-touch');
  const result = ensureHelperProfile({ ...f.input, randomUUID: () => 'collision' });
  assert.equal(result.status, 'fallback'); assert.equal(fs.readFileSync(existing, 'utf8'), 'do-not-touch');
});

test('固定版本实际启动模块可补丁、可编译且幂等，错误或重复锚点停止', () => {
  if(modular){
    const source=actualMain(),patched=patchModularMain(source);
    assert.equal(validateModularMain(source),source);assert.equal(patchModularMain(patched),patched);new Script(patched);
    assert.ok(patched.includes("require('./main/user-data.js')"));assert.ok(patched.includes("require('./main/dpi.js')"));
    assert.ok(patched.indexOf('codex-pet-user-data-get-path-v2')<patched.indexOf('const dpi = createDpi('));
    assert.throws(()=>patchModularMain(source+source),/anchor-mismatch/);assert.throws(()=>patchModularMain(patched.replace("return app.getPath('userData')","return app.getPath('changed')")),/anchor-mismatch/);
    const user=readUpstream('runtime/electron-helper/main/user-data.js'),probe=patchModularUserData(user);assert.equal(patchModularUserData(probe),probe);new Script(probe);assert.ok(probe.includes("openSync(probe, 'wx', 0o600)"));assert.throws(()=>patchModularUserData(user+user),/anchor-mismatch/);
    return;
  }
  const source = originalProfile(actualMain());
  for (const appMode of [true, false]) {
    const patched = patchHelperStartup(source, { appMode });
    assert.equal(patchHelperStartup(patched, { appMode }), patched); new Script(patched);
    assert.ok(patched.indexOf('// codex-pet-helper-profile-v1:') > patched.indexOf("stream.on('error'"));
    assert.ok(patched.indexOf('// codex-pet-helper-profile-v1:') < patched.indexOf('function dpiCacheFile()'));
    assert.throws(() => patchHelperStartup(patched, { appMode: !appMode }), /mode-mismatch/);
    assert.throws(() => patchHelperStartup(patched.replace('primaryError = prepare(currentDir)', 'primaryError = prepare(currentDir) || null'), { appMode }), /anchor-mismatch/);
  }
  assert.throws(() => patchHelperStartup(source.replace('// ② 宿主探测：', '// changed:'), { appMode: true }), /anchor-mismatch/);
  assert.throws(() => patchHelperStartup(source + source, { appMode: false }), /anchor-mismatch/);
  assert.throws(() => patchHelperStartup(source, {}), /options-invalid/);
});

test('生产DPI保护块在探测异常时关闭补偿且不抛出，成功时保留原倍率', () => {
  if(modular){
    const source=readUpstream('runtime/electron-helper/main/dpi.js');assert.equal(validateModularDpi(source),source);new Script(source);
    const pure={module:{exports:{}}};runInNewContext(readUpstream('runtime/electron-helper/dpi-linearization.js'),pure);
    for(const mode of ['cached','probe-failed','scale-error']){
      let switches=0,probes=0;
      const module={exports:{}},app={getPath:()=>path.join(tmpdir(),'synthetic-dpi'),commandLine:{hasSwitch:()=>false,appendSwitch(){switches++;}}};
      const safeRequire=name=>name==='node:path'?path:name==='node:fs'?{readFileSync(){if(mode==='probe-failed')throw Error('denied');return '{"scaleFactor":1.5}';},writeFileSync(){}}:name==='node:child_process'?{execFileSync(){probes++;throw Error('synthetic-probe-failure');}}:name==='../dpi-linearization.js'?{...pure.module.exports,...(mode==='scale-error'?{resolveForcedScale(){throw Error('scale-unavailable');}}:{})}:(()=>{throw Error('unexpected-import');})();
      runInNewContext(source,{module,require:safeRequire,process:{platform:'win32',execPath:'synthetic-electron',env:{}},console:{error(){}}});
      const result=module.exports.createDpi({app,screen:{},mainPath:'synthetic-main.js',linuxPointer:null,dpiProbe:false,dpiMark:'SYNTHETIC_DPI=',forceDsf:undefined});
      assert.equal(result.primaryScale,mode==='cached'?1.5:0);assert.equal(result.forcedScale,mode==='cached'?1:0);assert.equal(switches,mode==='cached'?1:0);assert.equal(probes,mode==='probe-failed'?1:0);
    }
    return;
  }
  const source = patchHelperStartup(originalProfile(actualMain()), { appMode: true });
  const from = source.indexOf('if (shouldLinearize('), to = source.indexOf('/**\n * 渲染端的 CONFIG.scale', from);
  const block = source.slice(from, to);
  assert.ok(block.includes('codex-pet-dpi-startup-v1'));
  for (const failure of [true, false]) {
    let switches = 0;
    const result = runInNewContext('let PRIMARY_SCALE=0,FORCED_SCALE=0; const DPI_PROBE=false,FORCE_DSF=undefined;\n' + block + '\n({primary:PRIMARY_SCALE,forced:FORCED_SCALE});', {
      shouldLinearize: () => true, process: { platform: 'win32' }, console: { error() {} },
      readCachedPrimaryScale: () => { if (failure) throw Error('denied'); return 1.5; }, probePrimaryScale: () => 2,
      resolveForcedScale: () => 1, app: { commandLine: { appendSwitch() { switches++; } } },
    });
    assert.equal(result.primary, failure ? 0 : 1.5); assert.equal(result.forced, failure ? 0 : 1); assert.equal(switches, failure ? 0 : 1);
  }
});

// 不加载Electron：执行实际main里的目录决策，再交给实际user-data模块验证getPath异常回退。
test('0.4实际main的getPath失败沿原生目录选择恢复，APP_MODE隔离仍保留',{skip:modular?false:'当前为0.3.8单体启动分支'},t=>{
 const f=fixture(t),source=patchModularMain(actualMain()),start=source.indexOf('const userDataDecision = resolveUserDataDir({'),end=source.indexOf('\n});',start)+4;assert.ok(start>=0&&end>start);
 const user={module:{exports:{}}};runInNewContext(patchModularUserData(readUpstream('runtime/electron-helper/main/user-data.js')),{...user,require:name=>name==='node:fs'?fs:name==='node:path'?path:name==='node:os'?{homedir:()=>f.root}:name==='node:crypto'?{randomUUID}:(()=>{throw Error('unexpected-import');})()});
 for(const appMode of [true,false]){const context={app:{getPath(){throw Error('get-path-unavailable');}},APP_MODE:appMode,dshHomeDir:()=>f.home,resolveUserDataDir:user.module.exports.resolveUserDataDir};runInNewContext(source.slice(start,end)+';globalThis.decision=userDataDecision;',context);assert.equal(context.decision.fallback,true);assert.equal(context.decision.dir,path.join(f.home,'dsh-pet',appMode?'app-profile':'electron-profile'));assert.deepEqual(fs.readdirSync(context.decision.dir),[]);}
});
