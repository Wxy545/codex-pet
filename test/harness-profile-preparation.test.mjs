import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,linkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareHarnessProfile} from '../scripts/prepare-harness-profile.mjs';
import {readUpstream,upstreamVersion} from './support/harness-upstream.mjs';

const files=['lib/client.js','lib/index.js','runtime/electron-helper/shared-core.js','runtime/electron-helper/sprite/motion.js','runtime/electron-helper/main.js','runtime/electron-helper/main/dpi.js','runtime/electron-helper/main/user-data.js','runtime/electron-helper/sprite.js','runtime/electron-helper/sprite/input.js','runtime/electron-helper/index.html'];
if(['0.4.3','0.4.5'].includes(upstreamVersion))files.push('runtime/electron-helper/sprite/playback.js','runtime/electron-helper/sprite/window-fit.js');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'harness-pre-import-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const profileDir=join(root,'home','profiles','web'),pkg=join(profileDir,'node_modules','dsh-pet'),bundleDir=join(root,'bundle');mkdirSync(pkg,{recursive:true});mkdirSync(join(bundleDir,'runtime'),{recursive:true});
 const manifest={dependencies:{'dsh-pet':upstreamVersion,'codex-pet-harness':'link:'+bundleDir},dsh:{profile:{bundles:['dsh-pet','codex-pet-harness']}}};writeFileSync(join(profileDir,'package.json'),JSON.stringify(manifest));
 writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'dsh-pet',version:upstreamVersion,exports:{'./package.json':'./package.json'}}));
 writeFileSync(join(bundleDir,'package.json'),JSON.stringify({name:'codex-pet-harness'}));symlinkSync(bundleDir,join(profileDir,'node_modules','codex-pet-harness'),'junction');
 for(const name of files){mkdirSync(dirname(join(pkg,name)),{recursive:true});writeFileSync(join(pkg,name),readUpstream(name));}
 for(const name of ['pet-status-strip.js','pet-status-strip.css'])writeFileSync(join(bundleDir,'runtime',name),readFileSync(fileURLToPath(new URL('../src/'+name,import.meta.url))));
 for(const name of ['native-tasks-ui.js','native-tasks.css'])writeFileSync(join(bundleDir,name),readFileSync(fileURLToPath(new URL('../harness/'+name,import.meta.url))));
 return{root,profileDir,pkg,bundleDir,manifest,options:{profileDir,bundleDir,dshVersion:'0.2.2-rc.1'}};
}

test('官方原件在任何宿主import前离线准备四类补丁，且不改pnpm共享原件',t=>{
 const f=fixture(t),shared=join(f.root,'shared-original.js');linkSync(join(f.pkg,'lib/index.js'),shared);
 const result=prepareHarnessProfile(f.options);assert.equal(result.status,'updated');assert.equal(result.petVersion,upstreamVersion);
 const host=readFileSync(join(f.pkg,'lib/index.js'),'utf8');assert.ok(host.includes('ctx.provide("codexPetQQState"'));assert.ok(host.includes('codexPetNativeTasks?.transition(session,event,next)'));
 assert.ok(readFileSync(join(f.pkg,'lib/client.js'),'utf8').includes('CodexNativeBalanceFooter'));assert.equal(readFileSync(shared,'utf8'),readUpstream('lib/index.js'));
 for(const dshVersion of ['0.2.1-rc.2','0.2.1-rc.5','0.2.2-rc.1'])assert.equal(prepareHarnessProfile({...f.options,dshVersion}).status,'current');
});

test('未登记、错误bundle或未知版本在准备前拒绝，真实原件保持不变',t=>{
 const f=fixture(t),original=readFileSync(join(f.pkg,'lib/index.js'),'utf8');
 assert.throws(()=>prepareHarnessProfile({...f.options,dshVersion:'next'}),/unverified/);
 assert.throws(()=>prepareHarnessProfile({...f.options,bundleDir:f.root}),/bundle-mismatch/);
 for(const version of ['0.4.4','0.4.6','^0.4.5']){
  f.manifest.dependencies['dsh-pet']=version;writeFileSync(join(f.profileDir,'package.json'),JSON.stringify(f.manifest));
  assert.throws(()=>prepareHarnessProfile(f.options),/not-registered/);
  assert.equal(readFileSync(join(f.pkg,'lib/index.js'),'utf8'),original);
 }
 f.manifest.dependencies['dsh-pet']=upstreamVersion;
 f.manifest.dsh.profile.bundles.pop();writeFileSync(join(f.profileDir,'package.json'),JSON.stringify(f.manifest));assert.throws(()=>prepareHarnessProfile(f.options),/not-registered/);
 assert.equal(readFileSync(join(f.pkg,'lib/index.js'),'utf8'),original);
});

test('profile祖先及后续目标文件链接在第一步写入前拒绝',t=>{
 const f=fixture(t),original=readFileSync(join(f.pkg,'lib/index.js'),'utf8'),alias=join(f.root,'home-alias');symlinkSync(join(f.root,'home'),alias,'junction');
 assert.throws(()=>prepareHarnessProfile({...f.options,profileDir:join(alias,'profiles','web')}),/directory/);assert.equal(readFileSync(join(f.pkg,'lib/index.js'),'utf8'),original);
 const input=join(f.pkg,'runtime/electron-helper/sprite/input.js'),outside=join(f.root,'outside');mkdirSync(outside);writeFileSync(join(outside,'input.js'),'not-a-pet-module');rmSync(dirname(input),{recursive:true});symlinkSync(outside,dirname(input),'junction');
 assert.throws(()=>prepareHarnessProfile(f.options),/directory|outside-profile/);assert.equal(readFileSync(join(f.pkg,'lib/index.js'),'utf8'),original);assert.equal(readFileSync(join(outside,'input.js'),'utf8'),'not-a-pet-module');
});
