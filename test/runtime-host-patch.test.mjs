import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {patchHostOpenTarget} from '../scripts/runtime-host-patch.mjs';
const source='const openSite = (url) => { opened.push(url); }; globalThis.openSite=openSite;';
test('同一原生打开入口在WorkBuddy只激活固定目标，Codex保留原站点语义',async()=>{
 const patched=patchHostOpenTarget(source);assert.equal(patchHostOpenTarget(patched),patched);
 for(const host of ['codex','workbuddy']){
  const opened=[],focus=[];const context={opened,process:{env:{CODEX_PET_HOST:host}},require:name=>{assert.equal(name,'./codex-startup.cjs');return{createTargetRequest:options=>async action=>focus.push([options.host,action])};}};
  vm.runInNewContext(patched,context);context.openSite('https://example.com/ignored');await Promise.resolve();
  assert.deepEqual(opened,host==='codex'?['https://example.com/ignored']:[]);assert.deepEqual(focus,host==='workbuddy'?[['workbuddy','focus']]:[]);
 }
 assert.throws(()=>patchHostOpenTarget('missing'),/锚点/);
});

test('拆分IPC使用正确相对模块，已补丁但模块错位或标记重复时停止',()=>{
 const raw="const openSite = (url) => { calls.push(url); };",fixed=patchHostOpenTarget(raw,{startupModule:'../codex-startup.cjs'});
 assert.match(fixed,/require\('\.\.\/codex-startup.cjs'\)/);assert.equal(patchHostOpenTarget(fixed,{startupModule:'../codex-startup.cjs'}),fixed);
 assert.throws(()=>patchHostOpenTarget(fixed),/锚点/);assert.throws(()=>patchHostOpenTarget(fixed+'\n// codex-pet-workbuddy-open-target-v1',{startupModule:'../codex-startup.cjs'}),/锚点/);
 assert.throws(()=>patchHostOpenTarget(raw,{startupModule:'../other.cjs'}),/不匹配/);
});
