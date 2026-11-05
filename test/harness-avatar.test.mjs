import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createAvatarGuard,patchNativeAvatar041} from '../harness/avatar-fix.mjs';
import {readUpstream,upstreamVersion} from './support/harness-upstream.mjs';

const extensions=['.png','.jpg','.jpeg','.webp','.gif'],mime={'.png':'image/png','.jpg':'image/jpeg'};
const guard=fileSystem=>createAvatarGuard({fs:fileSystem||fs,path,randomUUID,validId:value=>typeof value==='string'&&/^[\p{L}\p{N}_-]+$/u.test(value)});
function fixture(t){
 const root=fs.mkdtempSync(path.join(tmpdir(),'harness-avatar-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'native-home','dsh-pet','pet');fs.mkdirSync(dir,{recursive:true});return{root,dir};
}

test('正常头像换格式保持原生命名、读取和mtime选择，写后不留下临时文件',t=>{
 const f=fixture(t),api=guard(),first=Buffer.from('synthetic-png'),next=Buffer.from('synthetic-jpeg');
 assert.deepEqual(api.save(f.dir,'白龙娘',first,'.png',extensions),{ok:true});
 assert.equal(api.read(f.dir,'白龙娘',extensions,mime).contentType,'image/png');
 assert.deepEqual(api.save(f.dir,'白龙娘',next,'.jpg',extensions),{ok:true});
 assert.deepEqual(fs.readdirSync(f.dir),['白龙娘-avatar.jpg']);
 assert.deepEqual(fs.readFileSync(api.read(f.dir,'白龙娘',extensions,mime).file),next);
});

test('Windows真实目录大小写及8.3别名可正常读写，仍以规范目录保存',{skip:process.platform!=='win32'},t=>{
 const f=fixture(t),api=guard();
 assert.deepEqual(api.save(f.dir.toUpperCase(),'dragon',Buffer.from('case-safe'),'.png',extensions),{ok:true});
 // Windows非native实现可能保留临时目录祖先的8.3拼写，期望值应使用系统规范长路径。
 assert.equal(api.read(f.dir.toUpperCase(),'dragon',extensions,mime).file.toLowerCase(),fs.realpathSync.native(path.join(f.dir,'dragon-avatar.png')).toLowerCase());
 // 只读取本次临时目录的系统短名；不经其它shell删除、移动或修改文件。
 assert.doesNotMatch(f.dir,/["%!^&|<>]/);
 const command=path.join(process.env.SystemRoot||'C:\\Windows','System32','cmd.exe');
 const result=spawnSync(command,['/u','/d','/s','/c','for %I in ("'+f.dir+'") do @echo %~sI'],{encoding:'utf16le',windowsHide:true,windowsVerbatimArguments:true,timeout:3000});
 assert.equal(result.status,0,'读取测试目录短名失败');const short=result.stdout.trim(),canonical=fs.realpathSync.native(f.dir);
 if(short.toLowerCase()===canonical.toLowerCase()){t.diagnostic('此卷没有不同的8.3目录别名；大小写路径已核对');return;}
 assert.equal(fs.statSync(short).ino,fs.statSync(canonical).ino);
 assert.deepEqual(api.save(short,'dragon',Buffer.from('short-safe'),'.jpg',extensions),{ok:true});
 assert.equal(api.read(short,'dragon',extensions,mime).file.toLowerCase(),path.join(canonical,'dragon-avatar.jpg').toLowerCase());
 assert.deepEqual(fs.readdirSync(canonical),['dragon-avatar.jpg']);
});

test('头像目标或待清理旧格式为硬链时，读取拒绝且保存不改外部内容或旧头像',t=>{
 for(const ext of ['.png','.jpg']){
  const f=fixture(t),outside=path.join(f.root,'outside-owned-image');fs.writeFileSync(outside,'keep-external');
  fs.linkSync(outside,path.join(f.dir,'dragon-avatar'+ext));
  if(ext!=='.png')fs.writeFileSync(path.join(f.dir,'dragon-avatar.png'),'keep-current');
  const before=fs.readdirSync(f.dir).map(name=>[name,fs.readFileSync(path.join(f.dir,name)).toString()]);
  const api=guard();assert.equal(api.read(f.dir,'dragon',extensions,mime),undefined);
  assert.deepEqual(api.save(f.dir,'dragon',Buffer.from('replace'),'.png',extensions),{ok:false,reason:'write-failed'});
  assert.equal(fs.readFileSync(outside,'utf8'),'keep-external');
  assert.deepEqual(fs.readdirSync(f.dir).map(name=>[name,fs.readFileSync(path.join(f.dir,name)).toString()]),before);
 }
});

test('头像目录及祖先junction均不读取或写入外部目录，原用户文件保留',t=>{
 const f=fixture(t),outside=path.join(f.root,'outside');fs.mkdirSync(path.join(outside,'pet'),{recursive:true});
 fs.writeFileSync(path.join(outside,'pet','dragon-avatar.png'),'keep-outside');
 const linked=path.join(f.root,'linked-parent');fs.symlinkSync(outside,linked,process.platform==='win32'?'junction':'dir');
 const api=guard();for(const dir of [linked,path.join(linked,'pet')]){
  assert.equal(api.read(dir,'dragon',extensions,mime),undefined);
  assert.deepEqual(api.save(dir,'dragon',Buffer.from('replace'),'.png',extensions),{ok:false,reason:'write-failed'});
 }
 assert.deepEqual(fs.readdirSync(outside),['pet']);assert.equal(fs.readFileSync(path.join(outside,'pet','dragon-avatar.png'),'utf8'),'keep-outside');
});

test('固定头像名拒绝路径和数据流，rename失败不改旧文件且清理本次临时文件',t=>{
 const f=fixture(t),old=path.join(f.dir,'dragon-avatar.png');fs.writeFileSync(old,'keep-old');
 const api=guard({...fs,renameSync(){throw Error('synthetic-rename-failure');}});
 assert.deepEqual(api.save(f.dir,'dragon',Buffer.from('replace'),'.png',extensions),{ok:false,reason:'write-failed'});
 assert.deepEqual(fs.readdirSync(f.dir),['dragon-avatar.png']);assert.equal(fs.readFileSync(old,'utf8'),'keep-old');
 for(const id of ['../outside','dragon:stream','dragon\\other'])assert.deepEqual(guard().save(f.dir,id,Buffer.from('replace'),'.png',extensions),{ok:false,reason:'write-failed'});
});

test('041真实头像模块精确修补并幂等，未知函数和半补丁不静默接受',{skip:!['0.4.1','0.4.3'].includes(upstreamVersion)},()=>{
 const source=readUpstream('lib/index.js'),patched=patchNativeAvatar041(source);
 assert.notEqual(patched,source);assert.equal(patchNativeAvatar041(patched),patched);
 assert.throws(()=>patchNativeAvatar041(source.replace('writeFileSync(file, bytes);','writeFileSync(file, bytes, "utf8");')),/avatar-anchor/);
 assert.throws(()=>patchNativeAvatar041(patched.replace('codexPetNativeAvatarGuard.save','codexPetNativeAvatarGuard.changedSave')),/avatar-anchor/);
 assert.throws(()=>patchNativeAvatar041(source+source),/avatar-anchor/);
});
