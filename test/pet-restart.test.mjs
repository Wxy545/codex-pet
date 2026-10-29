import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {waitForRestartReady} from '../src/pet-restart.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'pet-restart-'));t.after(()=>rm(root,{recursive:true,force:true}));const child=Object.assign(new EventEmitter(),{pid:123,exitCode:null,killed:false,kill(){this.killed=true;}});return{child,file:join(root,'ready.json'),expectedPid:321,timeoutMs:100,intervalMs:5};}
test('重启必须拿到同一helper及原宿主的就绪回执',async t=>{const f=await fixture(t);await writeFile(f.file,JSON.stringify({schemaVersion:1,pid:123,expectedPid:321}));await waitForRestartReady(f);assert.equal(f.child.listenerCount('exit'),0);});
test('helper成功创建但非零退出不能让旧桌宠退出',async t=>{const f=await fixture(t),promise=waitForRestartReady(f);f.child.exitCode=1;f.child.emit('exit',1);await assert.rejects(promise,/exited/);});
test('helper启动错误、超时、其它进程回执均拒绝交接',async t=>{const error=await fixture(t),promise=waitForRestartReady(error);error.child.emit('error',new Error('blocked'));await assert.rejects(promise,/failed/);const stale=await fixture(t);await writeFile(stale.file,JSON.stringify({schemaVersion:1,pid:999,expectedPid:321}));await assert.rejects(waitForRestartReady(stale),/mismatch/);const timeout=await fixture(t);await assert.rejects(waitForRestartReady({...timeout,timeoutMs:20}),/timeout/);});

test('拒绝交接后停止本次助手，避免旧桌宠稍后退出时被迟到助手重新拉起',async t=>{const f=await fixture(t);await assert.rejects(waitForRestartReady({...f,timeoutMs:20}),/timeout/);assert.equal(f.child.killed,true);assert.equal(f.child.listenerCount('exit'),0);});
