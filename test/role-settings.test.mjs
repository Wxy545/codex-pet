import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile,symlink,link,rename,realpath,access} from 'node:fs/promises';import{join,resolve}from'node:path';import{tmpdir}from'node:os';import{execFile}from'node:child_process';import{promisify}from'node:util';
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

test('Windows大小写别名指向同一真实目录时可保存并重开设置', {skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'RoleSettingsCaseAlias-'));t.after(()=>rm(root,{recursive:true,force:true}));const alias=root.toUpperCase();assert.notEqual(alias,await realpath(root));assert.equal(await realpath(alias),await realpath(root));
 const s=await Module.createRoleChatSettings({dataRoot:alias});await s.save({host:'workbuddy',revision:0,qqMode:'role'});assert.equal((await Module.createRoleChatSettings({dataRoot:root})).forHost('workbuddy').qqMode,'role');
});

test('Windows真实8.3短路径别名可保存，原设置不会被重置', {skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'RoleSettingsLongDirectoryAlias-'));t.after(()=>rm(root,{recursive:true,force:true}));const canonical=await realpath(root);
 // 仅查询系统已生成的短名称；不启用8.3、不设置短名，也不要求管理员权限。
 assert.equal(/["%&|<>^!\r\n]/.test(canonical),false);const {stdout}=await promisify(execFile)(process.env.ComSpec||'cmd.exe',['/d','/u','/c','for %I in ("'+canonical+'") do @echo %~sI'],{windowsHide:true,windowsVerbatimArguments:true,encoding:'utf16le'}),alias=stdout.trim();
 if(resolve(alias).toLowerCase()===canonical.toLowerCase()){t.skip('当前卷未为测试目录提供8.3别名；大小写与junction对照仍独立执行');return;}
 assert.match(alias,/~[0-9]/);assert.equal(await realpath(alias),canonical);const first=await Module.createRoleChatSettings({dataRoot:root});await first.save({host:'codex',revision:0,shareOwnerMemory:true});
 const s=await Module.createRoleChatSettings({dataRoot:alias});assert.equal(s.forHost('codex').shareOwnerMemory,true);await s.save({host:'codex',revision:1,qqMode:'role'});assert.equal((await Module.createRoleChatSettings({dataRoot:canonical})).forHost('codex').qqMode,'role');
});

test('根或祖先为真实junction或目录链接时拒绝，不在外部目录新建设置',async t=>{
 const root=await mkdtemp(join(tmpdir(),'role-settings-junction-'));t.after(()=>rm(root,{recursive:true,force:true}));const outside=join(root,'outside'),alias=join(root,'linked');await mkdir(outside);await symlink(outside,alias,process.platform==='win32'?'junction':'dir');
 await assert.rejects(Module.createRoleChatSettings({dataRoot:alias}),{code:'role_settings_storage_unsafe'});await assert.rejects(Module.createRoleChatSettings({dataRoot:join(alias,'new-data')}),{code:'role_settings_storage_unsafe'});await assert.rejects(access(join(outside,'new-data')),{code:'ENOENT'});
});

test('保存前根被换成junction仍拒绝，不跟随到外部目录',async t=>{
 const root=await mkdtemp(join(tmpdir(),'role-settings-swapped-'));t.after(()=>rm(root,{recursive:true,force:true}));const data=join(root,'data'),outside=join(root,'outside');await mkdir(data);await mkdir(outside);const s=await Module.createRoleChatSettings({dataRoot:data});await rename(data,join(root,'original'));await symlink(outside,data,process.platform==='win32'?'junction':'dir');
 await assert.rejects(s.save({host:'codex',revision:0,qqMode:'role'}),{code:'role_settings_storage_unsafe'});await assert.rejects(access(join(outside,'role-chat-settings.json')),{code:'ENOENT'});
});

test('设置文件硬链接在载入与保存时均拒绝，保留外部原文件',async t=>{
 const{root,settings:s}=await fixture(t);await s.save({host:'codex',revision:0,qqMode:'role'});const file=join(root,'role-chat-settings.json'),alias=join(root,'same-file.json'),before=await readFile(file,'utf8');await link(file,alias);
 await assert.rejects(Module.createRoleChatSettings({dataRoot:root}),{code:'role_settings_storage_unsafe'});await assert.rejects(s.save({host:'codex',revision:1,shareOwnerMemory:true}),{code:'role_settings_storage_unsafe'});assert.equal(await readFile(alias,'utf8'),before);
});

test('设置文件符号链接不能读取或写入其它文件',async t=>{
 const{root,settings:s}=await fixture(t);await s.save({host:'codex',revision:0,qqMode:'role'});const file=join(root,'role-chat-settings.json'),outside=join(root,'external.json'),before=await readFile(file,'utf8');await rename(file,outside);
 try{await symlink(outside,file,'file');}catch(error){if(process.platform==='win32'&&['EPERM','EACCES'].includes(error.code)){t.skip('当前Windows账号无文件符号链接权限；目录junction和文件硬链接另有真实验证');return;}throw error;}
 await assert.rejects(Module.createRoleChatSettings({dataRoot:root}),{code:'role_settings_storage_unsafe'});await assert.rejects(s.save({host:'codex',revision:1,shareOwnerMemory:true}),{code:'role_settings_storage_unsafe'});assert.equal(await readFile(outside,'utf8'),before);
});
