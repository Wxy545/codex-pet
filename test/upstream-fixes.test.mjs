import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import Range from '../src/runtime-range.cjs';
import { patchHostAssets, patchBridgeAssets, patchDesktopMotion, patchDesktopBalanceEvents, patchDesktopWorkEvents, patchDesktopWorkResume } from '../scripts/upstream-fixes.mjs';

const host = readFileSync(new URL('../node_modules/dsh-pet/lib/standalone.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../node_modules/dsh-pet/runtime/electron-helper/main.js', import.meta.url), 'utf8');
const sprite = readFileSync(new URL('../node_modules/dsh-pet/runtime/electron-helper/sprite.js', import.meta.url), 'utf8');
const events = readFileSync(new URL('../node_modules/dsh-pet/runtime/electron-helper/events.js', import.meta.url), 'utf8');

test('上游修复在原0.3.8及已准备代码上幂等，锚点缺失或重复时停止', () => {
  for (const [patch, source] of [[patchHostAssets, host], [patchBridgeAssets, bridge], [patchDesktopMotion, sprite], [patchDesktopBalanceEvents, events], [patchDesktopWorkEvents, events], [patchDesktopWorkResume, sprite]]) {
    const result = patch(source);
    assert.equal(patch(result), result);
    assert.throws(() => patch(''), /锚点/);
    assert.throws(() => patch(source + source), /锚点/);
  }
});

test('冻结只保留最新工作快照，解冻同步当前档位和文字，终态不补播',()=>{
 const shared={};vm.runInNewContext(readFileSync(new URL('../node_modules/dsh-pet/runtime/electron-helper/shared-core.js',import.meta.url),'utf8'),shared);
 const work=patchDesktopWorkEvents(events).match(/PetSprite\.prototype\.onWorkTick = function onWorkTick\([\s\S]*?\n\};/)?.[0];
 const freeze=patchDesktopWorkResume(sprite).match(/  applyFreeze\(next\) \{[\s\S]*?\n  \}\n\n  \/\*\*/)?.[0].replace(/\n\n  \/\*\*$/,'');
 const scope={S:shared.PetShared,PetSprite:function(){},window:{clearTimeout(){},setTimeout(){return 1;}},BUBBLE_DURATION_MS:10000,console:{log(){},error(){}}};
 vm.runInNewContext(work,scope);const applyFreeze=vm.runInNewContext('({'+freeze+'}).applyFreeze',scope);
 const make=()=>{
  const calls=[];const pet={pet:{id:'fixture',workStatusEnabled:true},animations:{idle:['idle'],events:{workStatus:['thinking','working','result','waiting','success','error']}},prevWorkTick:0,prevWorkState:null,frozen:false,front:0,videoA:{pause(){},loop:true},workTimer:null,renderBubble(){calls.push('bubble:'+this.workText);},stopMove(){},playOnce(name){calls.push('once:'+name);this.anim=name;},switchTo(name){calls.push('loop:'+name);this.anim=name;},resumeWorkStatusAnim(){if(!this.workState||['success','error'].includes(this.workState))return false;this.switchTo(this.workState);return true;},onWorkTick:scope.PetSprite.prototype.onWorkTick,applyFreeze};return {pet,calls};
 };
 for(const finalState of ['waiting','working',null,'success','error']){
  const {pet,calls}=make();pet.onWorkTick({state:'working',task:'old task'},1);pet.applyFreeze(true);const before=calls.length;
  pet.onWorkTick({state:'thinking',task:'intermediate task'},2);pet.applyFreeze(true);pet.onWorkTick({state:finalState,task:'latest task'},3);
  assert.equal(calls.length,before);assert.equal(pet.workText,'old task');assert.equal(pet.prevWorkTick,1);
  pet.applyFreeze(false);
  if(['waiting','working'].includes(finalState)){assert.equal(pet.workState,finalState);assert.equal(pet.workText,'latest task');assert.equal(pet.anim,finalState);assert.equal(pet.workOn,true);}
  else{assert.equal(pet.workState,null);assert.equal(pet.workText,null);assert.equal(pet.workOn,false);assert.equal(pet.anim,'idle');assert.ok(!calls.includes('once:success')&&!calls.includes('once:error'));}
  assert.equal(pet.prevWorkTick,3);assert.equal(pet.codexPendingWorkSnapshot,null);
 }
 const {pet}=make();pet.onWorkTick({state:'working',task:'unchanged'},1);pet.applyFreeze(true);pet.applyFreeze(false);assert.equal(pet.workState,'working');assert.equal(pet.workText,'unchanged');assert.equal(pet.anim,'working');
});

test('余额失败恢复后再次同样失败会通知，连续同失败仍去重且手动查询始终答复',()=>{
 const context={};
 vm.runInNewContext(readFileSync(new URL('../node_modules/dsh-pet/runtime/electron-helper/shared-core.js',import.meta.url),'utf8'),context);
 const fixed=patchDesktopBalanceEvents(events);
 const declarations=['applyBalanceNotice','applyBalanceLeaf'].map(name=>fixed.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'))?.[0]).join('\n');
 const trace=[];
 const receiver={showBalanceNotice:state=>trace.push('notice:'+state.reason),onBalanceTick:state=>trace.push('success:'+state.rolling)};
 const env={S:context.PetShared,sprites:[receiver],window:{__dshPetDebug:{}},console:{error(){}},codexFixedText:x=>x};
 vm.runInNewContext('let balance,balanceTick=0,balanceNoticeKey=null;\n'+declarations+'\nglobalThis.apply=applyBalanceLeaf;',env);
 const failure={data:{ok:false,provider:'standalone',reason:'fetch-error'}};
 env.apply(failure);env.apply(failure);
 assert.deepEqual(trace,['notice:fetch-error']);
 env.apply({data:{ok:true,provider:'standalone',shape:'windows',data:{rolling:72}}});
 env.apply(failure);env.apply(failure);
 assert.deepEqual(trace,['notice:fetch-error','success:72','notice:fetch-error']);
 env.apply({data:{...failure.data,manual:true}});
 assert.deepEqual(trace,['notice:fetch-error','success:72','notice:fetch-error','notice:fetch-error']);
});

test('Range只接受单段字节区间，非法、多段、过大数字不误作文件偏移', () => {
  assert.deepEqual(Range.parseRange('bytes=3-7', 20), { start: 3, end: 7 });
  assert.deepEqual(Range.parseRange('bytes=10-', 20), { start: 10, end: 19 });
  assert.deepEqual(Range.parseRange('bytes=-50', 20), { start: 0, end: 19 });
  for (const header of ['bytes=20-', 'bytes=10-2']) assert.equal(Range.parseRange(header, 20), 'unsatisfiable');
  for (const header of [null, '', 'bytes=0-1,3-4', 'items=1-2', 'bytes=-0', 'bytes=-', 'bytes=9007199254740993-']) assert.equal(Range.parseRange(header, 20), null);
  assert.equal(Range.parseRange('bytes=1-', 0), null);
});

test('真实HTTP素材应答按请求读取206切片、416或整份200，字节与Content-Length一致', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pet-range-'));
  const file = join(directory, 'synthetic.webm');
  const bytes = Buffer.from('0123456789abcdefghij');
  await writeFile(file, bytes);
  const fixed = patchHostAssets(host);
  const declaration = fixed.match(/function sendFile\(req, res, file, contentType\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(declaration);
  const send = vm.runInNewContext(declaration + '\nsendFile', { CodexRuntimeRange: Range });
  const server = createServer((req, res) => send(req, res, file, 'video/webm'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}/asset`;
  for (const [range, status, content, contentRange] of [
    [null, 200, bytes, null], ['bytes=3-7', 206, bytes.subarray(3, 8), 'bytes 3-7/20'],
    ['bytes=10-', 206, bytes.subarray(10), 'bytes 10-19/20'], ['bytes=-5', 206, bytes.subarray(15), 'bytes 15-19/20'],
    ['bytes=17-99', 206, bytes.subarray(17), 'bytes 17-19/20'], ['bytes=20-', 416, Buffer.alloc(0), 'bytes */20'],
    ['bytes=7-2', 416, Buffer.alloc(0), 'bytes */20'], ['bytes=0-1,4-5', 200, bytes, null], ['garbage', 200, bytes, null],
  ]) {
    const response = await fetch(url, { headers: range ? { Range: range } : {} });
    assert.equal(response.status, status, range);
    assert.equal(response.headers.get('content-length'), String(content.length), range);
    assert.equal(response.headers.get('content-range'), contentRange, range);
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('content-type'), 'video/webm');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), content, range);
  }
  assert.match(fixed, /else sendFile\(req, res, result\.file, result\.contentType\);/);
  // Node HTTP按既有HEAD语义省略正文；这里不新增静态路由的方法许可。
  for (const range of [null, 'bytes=3-7']) {
    const response = await fetch(url, { method: 'HEAD', headers: range ? { Range: range } : {} });
    assert.equal(response.status, range ? 206 : 200);
    assert.equal(response.headers.get('content-length'), range ? '5' : '20');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});

test('HTTP客户端在open或fstat期间断开时关闭已打开fd，不启动流', () => {
  const source = readFileSync(new URL('../src/runtime-range.cjs', import.meta.url), 'utf8');
  for (const phase of ['open', 'stat']) {
    let onOpen, onStat; const closed = [];
    const module = { exports: {} };
    vm.runInNewContext(source, { module, Response, Uint8Array, require: name => {
      assert.equal(name, 'node:fs');
      return { open: (_file, _mode, callback) => { onOpen = callback; }, fstat: (_fd, callback) => { onStat = callback; }, close: (fd, callback) => { closed.push(fd); callback(); }, createReadStream: () => assert.fail('closed response must not start reading') };
    } });
    const res = new EventEmitter(); res.destroyed = false; res.writableEnded = false;
    module.exports.sendFile({ headers: {} }, res, 'already-authorized-file', 'video/webm');
    if (phase === 'open') res.destroyed = true;
    onOpen(null, 7);
    if (phase === 'stat') { res.destroyed = true; res.emit('close'); onStat(null, { size: 20 }); }
    assert.deepEqual(closed, [7]);
  }
});

test('实际Electron bridge闭包传递Range并保留CORS/类型，非文件请求照旧返回', async () => {
  const fixed = patchBridgeAssets(bridge);
  const declaration = fixed.match(/async function handleBridgeRequest\(request\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(declaration);
  const bytes = Buffer.from('0123456789'); let fileResponse = true;
  const handle = vm.runInNewContext(declaration + '\nhandleBridgeRequest', {
    URL, Response, Uint8Array, console,
    fsPromises: { readFile: async file => { assert.equal(file, 'already-authorized-file'); return bytes; } },
    bridgeRequest: async () => fileResponse ? { file: 'already-authorized-file', contentType: 'video/webm', status: 200 } : { body: 'config', status: 200 },
    require: name => { assert.equal(name, './runtime-range.cjs'); return Range; },
  });
  for (const [range, status, content] of [['bytes=3-', 206, '3456789'], ['bytes=-2', 206, '89'], ['bytes=10-', 416, ''], ['bytes=0-1,4-5', 200, '0123456789']]) {
    const response = await handle(new Request('dsh-pet-bridge://dsh-pet/asset', { headers: { Range: range } }));
    assert.equal(response.status, status); assert.equal(await response.text(), content);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('content-type'), 'video/webm');
  }
  fileResponse = false;
  const config = await handle(new Request('dsh-pet-bridge://dsh-pet/config', { headers: { Range: 'bytes=1-2' } }));
  assert.equal(config.status, 200); assert.equal(await config.text(), 'config');
});

test('实际PetSprite走位按规划落点插值，负距离不反向并在结束时连续落地', () => {
  const fixed = patchDesktopMotion(sprite);
  const method = fixed.match(/  startMoveDrive\(el\) \{[\s\S]*?\n  \}\n\n  stopMove/)?.[0].replace(/\n\n  stopMove$/, '');
  assert.ok(method);
  for (const [start, target, dir] of [[.6, .2, 1], [.2, .8, -1]]) {
    let step; const positions = [];
    const methods = vm.runInNewContext('({' + method + '})', { VIEW: { w: 1000, h: 800 }, requestAnimationFrame: callback => { step = callback; return 1; } });
    const pet = { ...methods, pendingMove: { startRatio: start, startYRatio: .8, targetRatio: target, dir, totalRatio: Math.abs(target - start), leadSec: 1, tailSec: 1 }, moveRef: null, moveToken: 0, halfW: 20, halfH: 30, sendBounds: x => positions.push((x + 20) / 1000) };
    const video = { duration: 10, currentTime: 0 }; pet.startMoveDrive(video);
    for (const time of [1, 5, 9]) { video.currentTime = time; step(); }
    for (const [actual, expected] of positions.map((value, index) => [value, [start, (start + target) / 2, target][index]])) assert.ok(Math.abs(actual - expected) < 1e-10);
    assert.equal(pet.customPos.rx, target); assert.equal(pet.moveRef, null);
  }
});

test('独立模式菜单只改可见文案，open-site动作和desktop分支保留', () => {
  const fixed = patchDesktopMotion(sprite);
  const expression = fixed.match(/label: (OPEN_TARGET === 'desktop' \? '打开软件' : '打开 AI 设置'),/);
  assert.ok(expression);
  assert.equal(vm.runInNewContext(expression[1], { OPEN_TARGET: 'site' }), '打开 AI 设置');
  assert.equal(vm.runInNewContext(expression[1], { OPEN_TARGET: 'desktop' }), '打开软件');
  assert.match(fixed, /label: OPEN_TARGET === 'desktop' \? '打开软件' : '打开 AI 设置',\n\s*action: 'open-site'/);
});
