import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { codexQuotaResult } from '../src/quota.mjs';

test('只映射真实5小时与周额度，缺失月度保持缺失',()=>{
  const value=codexQuotaResult({windows:[{usedPercent:0,windowMinutes:300,windowLabel:'5h',resetsAt:2000000000},
    {usedPercent:86,windowMinutes:10080,resetsAt:2000000000}]},1000);
  assert.equal(value.data.rolling,0);assert.equal(value.data.weekly,86);assert.equal(value.data.monthly,undefined);
});
test('缺失、非法及过期额度不能伪装为零',()=>{
  for(const usage of [undefined,{}, {windows:[{usedPercent:NaN}]}, {windows:[{usedPercent:10,resetsAt:1}]}])
    assert.throws(()=>codexQuotaResult(usage,2000,'zh-CN'),/暂无有效/);
});

test('English额度错误与默认标签本地化，真实窗口数值和自定义标签不改',()=>{
  assert.throws(()=>codexQuotaResult(undefined,1000,'en'),/No fresh Codex usage snapshot/);
  const value=codexQuotaResult({windows:[{usedPercent:12},{usedPercent:20,windowMinutes:300,windowLabel:'用户窗口名'}]},1000,'en');
  assert.equal(value.data.rolling,20);assert.equal(value.data.rollingLabel,'用户窗口名');
  assert.equal(codexQuotaResult({usedPercent:12},1000,'en').data.rollingLabel,'Current');
});
test('原桌面额度解析与六档展示接受无月度的Codex快照',()=>{
  const code=readFileSync(new URL('../node_modules/dsh-pet/runtime/electron-helper/shared-core.js',import.meta.url),'utf8');
  const context=vm.createContext({console,Date,setTimeout,clearTimeout});vm.runInContext(code,context);
  const raw=codexQuotaResult({windows:[{usedPercent:92,windowMinutes:10080,resetsAt:2000000000}]},1000);
  const parsed=context.PetShared.toBalanceState(raw);
  assert.equal(parsed.weekly,92);assert.equal(parsed.monthly,undefined);
  const window=context.PetShared.urgentWindow(parsed);
  assert.equal(window.label,'周');assert.equal(window.percent,92);
  assert.equal(context.PetShared.toBalanceState({ok:true,provider:'standalone',shape:'windows',data:{}}),null);
});
