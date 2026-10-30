import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,symlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Host from '../src/pet-host.cjs';
const fixture = t => {const root=mkdtempSync(join(tmpdir(),'codex-pet-host-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};
test('宿主选择保留旧安装Codex默认，已保存选择优先于重启子进程继承的旧环境',t=>{
  const root=fixture(t);assert.equal(Host.readHost(root,''),'codex');
  Host.writeHost(root,'workbuddy');assert.equal(Host.readHost(root,'codex'),'workbuddy');
  assert.equal(Host.publicHost('workbuddy').capabilities.chat,false);
  assert.equal(Host.publicHost('workbuddy').capabilities.quota,true);
  assert.equal(Host.publicHost('workbuddy').capabilities.chatter,false);
  assert.equal(Host.publicHost('codex').capabilities.quota,true);
  assert.throws(()=>Host.writeHost(root,'harness'));assert.equal(Host.readHost(root,''),'workbuddy');
});
test('宿主设置不跟随目标文件和data根junction，不修改链接外配置',t=>{
  const root=fixture(t),outside=join(root,'outside');mkdirSync(outside);writeFileSync(join(outside,'host.json'),'private');
  const linked=join(root,'linked');symlinkSync(outside,linked,'junction');
  assert.throws(()=>Host.writeHost(linked,'workbuddy'),/linked/);assert.equal(readFileSync(join(outside,'host.json'),'utf8'),'private');
});
test('WorkBuddy未接账号时AI服务不就绪且全部入口无法调用模型',async()=>{
  const ai=Host.unavailableAi();assert.equal(ai.isReady(),false);assert.equal(ai.canWhisper(),false);
  assert.deepEqual(ai.listProviders(),[]);assert.deepEqual(await ai.listModels(),[]);assert.equal(ai.getSettings().enabled,false);
  assert.equal(ai.getSettings().automaticWhispers,false);assert.equal((await ai.testConnection()).ok,false);
  await assert.rejects(ai.saveSettings({enabled:true}),/unavailable/);
  await assert.rejects(async()=>{for await(const chunk of ai.stream({}))void chunk;},/unavailable/);
});
