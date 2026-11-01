import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,symlink} from 'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
let Module={};try{Module=await import('../src/role-settings.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
async function fixture(t){assert.equal(typeof Module.createRoleChatSettings,'function');const root=await mkdtemp(join(tmpdir(),'role-settings-'));t.after(()=>rm(root,{recursive:true,force:true}));const changed=[],settings=await Module.createRoleChatSettings({dataRoot:root,onChange:value=>changed.push(value)});return{root,settings,changed};}
test('角色聊天默认分离记忆、仅本人且QQ仍按原任务模式，三宿主分别保存',async t=>{
 const{settings:s,root,changed}=await fixture(t);for(const host of ['codex','workbuddy','harness'])assert.deepEqual(s.forHost(host),{revision:0,shareOwnerMemory:false,qqMode:'task'});
 await s.save({host:'workbuddy',revision:0,shareOwnerMemory:true,qqMode:'role'});assert.equal(s.forHost('workbuddy').shareOwnerMemory,true);assert.equal(s.forHost('codex').shareOwnerMemory,false);assert.equal(s.forHost('harness').qqMode,'task');assert.equal(changed.length,1);
 const reopened=await Module.createRoleChatSettings({dataRoot:root});assert.equal(reopened.forHost('workbuddy').qqMode,'role');assert.equal(reopened.forHost('workbuddy').shareOwnerMemory,true);assert.equal(reopened.forHost('workbuddy').revision,1);
});
test('撤销和重复切换产生新修订，旧面板不能覆盖较新设置',async t=>{
 const{settings:s}=await fixture(t);await s.save({host:'codex',revision:0,shareOwnerMemory:true});await s.save({host:'codex',revision:1,shareOwnerMemory:false});await s.save({host:'codex',revision:2,shareOwnerMemory:true});assert.equal(s.forHost('codex').revision,3);
 await assert.rejects(s.save({host:'codex',revision:0,qqMode:'role'}),{code:'role_settings_stale'});assert.equal(s.forHost('codex').qqMode,'task');
 const before=s.snapshot();await s.save({host:'codex',revision:3,shareOwnerMemory:true});assert.deepEqual(s.snapshot(),before);
});
test('设置仅接受固定宿主和无工具模式，不允许开放公众、传权限或路径',async t=>{
 const{settings:s,root}=await fixture(t);for(const value of [{host:'other',revision:0,qqMode:'role'},{host:'codex',revision:0,publicChatEnabled:true},{host:'codex',revision:0,shell:true},{host:'codex',revision:0,scope:{actor:'other'}},{host:'codex',revision:0,path:root},{host:'codex',revision:0,qqMode:'unrestricted'},{host:'codex',revision:0,shareOwnerMemory:'true'}])await assert.rejects(s.save(value),{code:'role_settings_invalid'});
 assert.throws(()=>s.forHost('other'),{code:'role_settings_invalid'});assert.equal(s.snapshot().revision,0);
});
test('损坏或链接设置文件明确报错，不重置本人已保存选择',async t=>{
 const{root,settings:s}=await fixture(t);await s.save({host:'codex',revision:0,qqMode:'role'});const file=join(root,'role-chat-settings.json'),before=await readFile(file,'utf8');await writeFile(file,'invalid');await assert.rejects(Module.createRoleChatSettings({dataRoot:root}),{code:'role_settings_storage_invalid'});assert.equal(await readFile(file,'utf8'),'invalid');
 await writeFile(file,before);await s.save({host:'codex',revision:1,shareOwnerMemory:true});assert.equal(s.forHost('codex').shareOwnerMemory,true);
});
