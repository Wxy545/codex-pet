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
