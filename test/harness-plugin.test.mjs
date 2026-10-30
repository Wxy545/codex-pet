import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Character from '../src/codex-character.cjs';
let Pack = {};
try { Pack = await import('../harness/pack.mjs'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
let Motion = {};
try { Motion = await import('../harness/motion-fix.mjs'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const profiles = ['idle','walk','click','turn','drag','thinking','working','waiting','success','error','wing-care','tail-nap','magic','shy','proud','dragon-snack','wing-fan','greeting','tickle','wing-hover','book-reading','cushion-rest'];
const manifest = { schemaVersion: 1, profiles: Object.fromEntries(profiles.map(key => [key, {type:'video',file:`q-${key}.webm`}])) };
const definition = (locale, candidate=manifest) => Pack.buildHarnessConfig({manifest:candidate, locale, copy:Character.characterCopy('white-dragon',locale)});
const digest = data => createHash('sha256').update(data).digest('hex');
function fixture(t, locale='zh-CN', candidate=manifest) {
  const dir = mkdtempSync(join(tmpdir(),'codex-pet-harness-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const sourceRoot = join(dir,'bundle');
  const media = join(sourceRoot,'assets'); mkdirSync(media,{recursive:true});
  const built = definition(locale,candidate);
  const files = Object.entries(built.media).map(([name,source]) => {
    const bytes = Buffer.concat([Buffer.from('1a45dfa301000000000000004282847765626d','hex'),Buffer.from(source)]);
    writeFileSync(join(media,source),bytes);
    return {name,source,sha256:digest(bytes),size:bytes.length};
  });
  const pack = {schemaVersion:1,version:'0.1.0',locales:{[locale]:{...built,files}}};
  writeFileSync(join(sourceRoot,'pack.json'),JSON.stringify(pack));
  return {dir,sourceRoot,home:join(dir,'home'),built,pack};
}

test('Harness native pack uses twenty-two actual clips and preserves event slot contracts',()=>{
  assert.equal(typeof Pack.buildHarnessConfig,'function','missing native Harness pack builder');
  const built=definition('zh-CN');
  assert.equal(Object.keys(built.media).length,22);
  assert.equal(built.config.pets[0].id,'codex-white-dragon');
  assert.equal(built.config.animations.clicks.length,5);
  assert.equal(built.config.animations.categories.length,5);
  assert.deepEqual(built.config.animations.categories[0].actions,['整理龙翼','抱尾小憩','抱书阅读','坐垫歇息']);
  assert.equal(built.config.animations.moves.actions.length,2);
  assert.deepEqual(Object.keys(built.config.animations.events),['balance','whisper','workStatus']);
  assert.equal(built.config.animations.events.balance.length,6);
  assert.equal(built.config.animations.events.whisper.length,3);
  assert.equal(built.config.animations.events.workStatus.length,6);
  assert.equal(built.config.animations.events.workStatus[1],built.config.animations.events.workStatus[2]);
  assert.equal(built.config.animations.moves.default.leadSec,.12);
  assert.equal(built.config.animations.moves.default.tailSec,.12);
  assert.equal(built.config.whisperImageEnabled,false);
  assert.equal(built.config.chatImageEnabled,false);
  assert.match(built.config.whisperPrompt,/白龙娘/);
  assert.doesNotMatch(built.config.whisperPrompt,/蓝色大肥鱼/);
  for(const id of Object.values(built.config.animations.events).flat()) assert.ok(built.media[id+'.webm']);
});

test('English pack contains localized role, menu actions and status text',()=>{
  assert.equal(typeof Pack.buildHarnessConfig,'function');
  const built=definition('en');
  assert.equal(built.config.pets[0].name,'Dragon Girl');
  assert.ok(Object.keys(built.media).some(key=>key==='Star-cookie snack.webm'));
  assert.ok(Object.keys(built.media).includes('Reading a spellbook.webm'));
  assert.ok(Object.keys(built.media).includes('Cushion break.webm'));
  assert.doesNotMatch(JSON.stringify(built.config),/[\u3400-\u9fff]/);
  assert.equal(built.config.animations.categories.reduce((n,c)=>n+c.weight,0),80);
});

test('护宝石是同一实际视频的玩耍和宽裕档共用，不新增空槽或缺片名称',t=>{
  const candidate=structuredClone(manifest);candidate.profiles['treasure-guard']={type:'video',file:'q-treasure-guard.webm'};
  candidate.actions={'余额-钱袋满溢':{profile:'treasure-guard',coverage:'shared'},'原地专心玩魔方':{profile:'treasure-guard',coverage:'shared'}};
  for(const locale of ['zh-CN','en']){
    const f=fixture(t,locale,candidate),label=locale==='en'?'Guarding a gem':'护住小宝石';
    assert.equal(Object.keys(f.built.media).length,23);assert.equal(f.built.media[label+'.webm'],'q-treasure-guard.webm');
    assert.ok(f.built.config.animations.categories[1].actions.includes(label));assert.equal(f.built.config.animations.events.balance[0],label);
    assert.equal(f.built.config.animations.events.balance.length,6);assert.equal(Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home,locale}).videos,23);
  }
  assert.equal(definition('en').config.animations.events.balance[0],'Feeling smug');
});

test('optional seated profiles allow the existing pack or either new action without placeholder entries',t=>{
  for(const available of [[],['book-reading'],['cushion-rest'],['book-reading','cushion-rest']]){
    const candidate=structuredClone(manifest);
    for(const key of ['book-reading','cushion-rest'])if(!available.includes(key))delete candidate.profiles[key];
    const f=fixture(t,'zh-CN',candidate),actions=f.built.config.animations.categories[0].actions;
    assert.equal(Object.keys(f.built.media).length,20+available.length);
    assert.equal(actions.includes('抱书阅读'),available.includes('book-reading'));assert.equal(actions.includes('坐垫歇息'),available.includes('cushion-rest'));
    assert.equal(Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home}).videos,20+available.length);
  }
  const invalid=structuredClone(manifest);invalid.profiles['book-reading']={type:'image',file:'book.png'};
  assert.throws(()=>definition('zh-CN',invalid),/harness-profile-video-required: book-reading/);
});

test('seeded media must exactly match the configured actions and reject unknown names',t=>{
  const f=fixture(t);f.pack.locales['zh-CN'].files.pop();writeFileSync(join(f.sourceRoot,'pack.json'),JSON.stringify(f.pack));
  assert.throws(()=>Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home}),/invalid-harness-pack/);
  assert.throws(()=>readFileSync(join(f.home,'dsh-pet','pet','codex-white-dragon-config.json')),/ENOENT/);
  const unknown=fixture(t);unknown.pack.locales['zh-CN'].files[0].name='Unknown action.webm';writeFileSync(join(unknown.sourceRoot,'pack.json'),JSON.stringify(unknown.pack));
  assert.throws(()=>Pack.seedHarnessPack({sourceRoot:unknown.sourceRoot,dshHome:unknown.home}),/invalid-harness-pack-file/);
  assert.throws(()=>readFileSync(join(unknown.home,'dsh-pet','pet','codex-white-dragon-config.json')),/ENOENT/);
});

test('managed twenty-clips installation gains both seated actions without changing the original whale or old clips',t=>{
  const f=fixture(t),animation=join(f.home,'dsh-pet','pet','codex-white-dragon-animation');
  mkdirSync(animation,{recursive:true});
  const oldFiles=f.pack.locales['zh-CN'].files.filter(item=>!['q-book-reading.webm','q-cushion-rest.webm'].includes(item.source));
  assert.equal(oldFiles.length,20);
  for(const item of oldFiles)writeFileSync(join(animation,item.name),readFileSync(join(f.sourceRoot,'assets',item.source)));
  const oldConfig=structuredClone(f.built.config);oldConfig.animations.categories[0].actions=['整理龙翼','抱尾小憩'];
  const oldConfigData=JSON.stringify(oldConfig,null,2)+'\n';
  writeFileSync(join(f.home,'dsh-pet','pet','codex-white-dragon-config.json'),oldConfigData);
  writeFileSync(join(animation,'.codex-pet-harness.json'),JSON.stringify({schemaVersion:1,version:'0.4.0',locale:'zh-CN',configHash:digest(Buffer.from(oldConfigData)),files:Object.fromEntries(oldFiles.map(item=>[item.name,item.sha256]))}));
  const fish=join(f.home,'dsh-pet','main-config.jsonc');writeFileSync(fish,'{"pets":[{"name":"my whale"}]}');
  f.pack.version='0.5.0';writeFileSync(join(f.sourceRoot,'pack.json'),JSON.stringify(f.pack));
  const result=Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home});
  assert.equal(result.status,'updated');assert.equal(result.videos,22);
  const current=JSON.parse(readFileSync(join(f.home,'dsh-pet','pet','codex-white-dragon-config.json')));
  assert.deepEqual(current.animations.categories[0].actions,['整理龙翼','抱尾小憩','抱书阅读','坐垫歇息']);
  assert.equal(readFileSync(fish,'utf8'),'{"pets":[{"name":"my whale"}]}');
  for(const item of oldFiles)assert.equal(digest(readFileSync(join(animation,item.name))),item.sha256);
  assert.equal(readdirSync(animation).filter(name=>name.endsWith('.webm')).length,22);
});

test('installer seeds independent native pet paths, is idempotent and leaves original whale untouched',t=>{
  assert.equal(typeof Pack.seedHarnessPack,'function');
  const f=fixture(t); mkdirSync(join(f.home,'dsh-pet'),{recursive:true});
  const fish=join(f.home,'dsh-pet','main-config.jsonc');writeFileSync(fish,'{"pets":[{"name":"my whale"}]}');
  const result=Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home,locale:'zh-CN'});
  assert.equal(result.status,'installed');
  const config=join(f.home,'dsh-pet','pet','codex-white-dragon-config.json');
  const animation=join(f.home,'dsh-pet','pet','codex-white-dragon-animation');
  assert.deepEqual(JSON.parse(readFileSync(config)),f.built.config);
  assert.equal(readdirSync(animation).filter(x=>x.endsWith('.webm')).length,22);
  assert.equal(readFileSync(fish,'utf8'),'{"pets":[{"name":"my whale"}]}');
  assert.equal(Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home,locale:'zh-CN'}).status,'current');
  const changed=JSON.parse(readFileSync(config));changed.pets[0].name='custom dragon';writeFileSync(config,JSON.stringify(changed));
  const updated=Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home,locale:'zh-CN'});
  assert.equal(updated.status,'preserved');assert.equal(JSON.parse(readFileSync(config)).pets[0].name,'custom dragon');
});

test('missing or tampered media fails before creating pet configuration',t=>{
  assert.equal(typeof Pack.seedHarnessPack,'function');
  const f=fixture(t);writeFileSync(join(f.sourceRoot,'assets',f.pack.locales['zh-CN'].files[0].source),'tampered');
  assert.throws(()=>Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home,locale:'zh-CN'}),/media|hash|source/);
  assert.throws(()=>readFileSync(join(f.home,'dsh-pet','pet','codex-white-dragon-config.json')),/ENOENT/);
});

test('pack file names and target symlinks cannot escape the owned pet root',t=>{
  assert.equal(typeof Pack.seedHarnessPack,'function');
  const f=fixture(t);f.pack.locales['zh-CN'].files[0].name='../outside.webm';writeFileSync(join(f.sourceRoot,'pack.json'),JSON.stringify(f.pack));
  assert.throws(()=>Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home,locale:'zh-CN'}),/invalid.*file|path/);
});

test('pre-existing dsh-pet junction is rejected before writing outside DSH_HOME',t=>{
  const f=fixture(t),outside=join(f.dir,'outside');mkdirSync(outside);mkdirSync(f.home);
  symlinkSync(outside,join(f.home,'dsh-pet'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home,locale:'zh-CN'}),/unsafe.*path/);
  assert.deepEqual(readdirSync(outside),[]);
});

test('official managed updates replace unchanged files while preserving edited animation and configuration',t=>{
  const f=fixture(t);Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home,locale:'zh-CN'});
  const animation=join(f.home,'dsh-pet','pet','codex-white-dragon-animation');
  const [official,custom]=f.pack.locales['zh-CN'].files;
  writeFileSync(join(animation,custom.name),'my edited clip');
  const fresh=Buffer.concat([readFileSync(join(f.sourceRoot,'assets',official.source)),Buffer.from('upgraded')]);
  writeFileSync(join(f.sourceRoot,'assets',official.source),fresh);
  official.size=fresh.length;official.sha256=digest(fresh);f.pack.version='0.2.0';
  writeFileSync(join(f.sourceRoot,'pack.json'),JSON.stringify(f.pack));
  const result=Pack.seedHarnessPack({sourceRoot:f.sourceRoot,dshHome:f.home,locale:'zh-CN'});
  assert.equal(result.status,'preserved');
  assert.deepEqual(readFileSync(join(animation,official.name)),fresh);
  assert.equal(readFileSync(join(animation,custom.name),'utf8'),'my edited clip');
});

const oldMotion = 'const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;\nif (t <= leadSec) ratioX = startRatio;\nelse ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);';
test('native web and desktop move interpolation follows actual target even for negative distance',()=>{
  assert.equal(typeof Motion.patchNativeMotion,'function','missing native upstream motion fix');
  const patched=Motion.patchNativeMotion(oldMotion);
  const expression=/else ratioX = ([^;]+);/.exec(patched)[1];
  const evaluate=new Function('startRatio','targetRatio','t','leadSec','travelWindow',`return ${expression}`);
  assert.equal(evaluate(.7,.5,2.12,.12,4),.6);
  assert.equal(evaluate(.5,.7,2.12,.12,4),.6);
  assert.equal(Motion.patchNativeMotion(patched),patched);
  assert.throws(()=>Motion.patchNativeMotion(oldMotion.replace('totalRatio *','different *')),/anchor|锚点/);
});

test('native upstream repair stays in selected profile and leaves caller files alone',t=>{
  assert.equal(typeof Motion.prepareHarnessDependency,'function');
  const root=mkdtempSync(join(tmpdir(),'harness-motion-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const profile=join(root,'profile'),pkg=join(profile,'node_modules','dsh-pet');
  mkdirSync(join(pkg,'lib'),{recursive:true});mkdirSync(join(pkg,'runtime','electron-helper'),{recursive:true});
  writeFileSync(join(profile,'package.json'),'{"private":true}');
  writeFileSync(join(pkg,'package.json'),'{"name":"dsh-pet","version":"0.3.8","exports":{"./package.json":"./package.json"}}');
  for(const file of ['lib/client.js','runtime/electron-helper/sprite.js'])writeFileSync(join(pkg,file),oldMotion);
  assert.equal(Motion.prepareHarnessDependency({profileDir:profile}).status,'updated');
  assert.equal(Motion.prepareHarnessDependency({profileDir:profile}).status,'current');
  const outside=join(root,'outside');mkdirSync(outside,{recursive:true});writeFileSync(join(outside,'package.json'),'{"name":"dsh-pet","version":"0.3.8","exports":{"./package.json":"./package.json"}}');
  rmSync(pkg,{recursive:true});symlinkSync(outside,pkg,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>Motion.prepareHarnessDependency({profileDir:profile}),/outside|profile/);
});

test('native repair rejects a package internal junction before modifying external files',t=>{
  const root=mkdtempSync(join(tmpdir(),'harness-motion-junction-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const profile=join(root,'profile'),pkg=join(profile,'node_modules','dsh-pet'),outside=join(root,'outside');
  mkdirSync(outside,{recursive:true});mkdirSync(join(pkg,'runtime','electron-helper'),{recursive:true});
  writeFileSync(join(profile,'package.json'),'{"private":true}');
  writeFileSync(join(pkg,'package.json'),'{"name":"dsh-pet","version":"0.3.8","exports":{"./package.json":"./package.json"}}');
  writeFileSync(join(outside,'client.js'),oldMotion);writeFileSync(join(pkg,'runtime','electron-helper','sprite.js'),oldMotion);
  symlinkSync(outside,join(pkg,'lib'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>Motion.prepareHarnessDependency({profileDir:profile}),/outside|unsafe/);
  assert.equal(readFileSync(join(outside,'client.js'),'utf8'),oldMotion);
  assert.equal(readFileSync(join(pkg,'runtime','electron-helper','sprite.js'),'utf8'),oldMotion);
});

test('Windows installer accepts verified releases in Chinese spaced paths and refuses other versions or the npm desktop CLI before build', {skip:process.platform!=='win32'},t=>{
  const temp=mkdtempSync(join(tmpdir(),'harness-installer-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const root=join(temp,'中文 空格 project'),scripts=join(root,'scripts');mkdirSync(scripts,{recursive:true});
  const installer=join(scripts,'install-harness.ps1');
  writeFileSync(installer,readFileSync(fileURLToPath(new URL('../scripts/install-harness.ps1',import.meta.url))));
  writeFileSync(join(scripts,'build-harness-plugin.mjs'),`import{mkdirSync,writeFileSync}from'node:fs';import{dirname,resolve,join}from'node:path';import{fileURLToPath}from'node:url';const r=resolve(dirname(fileURLToPath(import.meta.url)),'..');mkdirSync(join(r,'data/harness-plugin'),{recursive:true});writeFileSync(join(r,'data/harness-plugin/pack.json'),'{}');writeFileSync(join(r,'built.txt'),'yes');console.log(JSON.stringify({directory:join(r,'data/harness-plugin')}));`);
  const stub=join(root,'dsh.cmd'),log=join(root,'calls.jsonl'),versionFile=join(root,'version.txt');
  writeFileSync(join(root,'dsh-stub.mjs'),`import{appendFileSync,readFileSync}from'node:fs';const a=process.argv.slice(2);if(a[0]==='--version')console.log(readFileSync(${JSON.stringify(versionFile)},'utf8'));else appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');`);
  writeFileSync(stub,`@"${process.execPath}" "%~dp0dsh-stub.mjs" %*\r\n`);
  writeFileSync(join(root,'pnpm.cmd'),'@echo 10.20.0\r\n');
  const env={...process.env,PATH:root+';'+process.env.PATH};
  const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',installer,'-Profile','web','-DshHome',join(temp,'isolated-home'),'-DshCommand',stub,'-NodeCommand',process.execPath];
  for(const version of ['0.2.1-rc.2','0.2.1-rc.5']){
    writeFileSync(versionFile,version);writeFileSync(log,'');
    const run=spawnSync('powershell.exe',args,{encoding:'utf8',env,windowsHide:true,timeout:15000});
    assert.equal(run.status,0,run.stderr||run.stdout);
    const calls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(calls[0],['plugin','--profile','web','add','dsh-pet@0.3.8']);
    assert.deepEqual(calls[1].slice(0,4),['plugin','--profile','web','add']);assert.equal(calls[1].length,5);
    // Windows可能保留8.3短名拼写，用卷号和文件ID确认仍是同一中文空格目录。
    const actualTarget=statSync(calls[1][4],{bigint:true}),expectedTarget=statSync(join(root,'data/harness-plugin'),{bigint:true});
    assert.ok(actualTarget.isDirectory());assert.equal(actualTarget.dev,expectedTarget.dev);assert.equal(actualTarget.ino,expectedTarget.ino);
    rmSync(join(root,'built.txt'));
  }
  for(const version of ['0.2.1-rc.3','0.2.1-rc.6','0.2.1']){
    writeFileSync(versionFile,version);writeFileSync(log,'');
    const denied=spawnSync('powershell.exe',args,{encoding:'utf8',env,windowsHide:true,timeout:15000});
    assert.notEqual(denied.status,0);assert.match(denied.stderr,/Other versions have not been verified/);
    assert.throws(()=>readFileSync(join(root,'built.txt')),/ENOENT/);assert.equal(readFileSync(log,'utf8'),'');
  }
  writeFileSync(log,'');args[args.indexOf('web')]='desktop';
  const denied=spawnSync('powershell.exe',args,{encoding:'utf8',env,windowsHide:true,timeout:15000});
  assert.notEqual(denied.status,0);assert.match(denied.stderr,/official Desktop|npm CLI/);
  assert.throws(()=>readFileSync(join(root,'built.txt')),/ENOENT/);assert.equal(readFileSync(log,'utf8'),'');
});

test('pack language follows Windows display language before regional format and honors an explicit override',()=>{
  assert.equal(typeof Pack.detectPackLocale,'function','missing Windows display-language detection');
  let reads=0;
  const probes={platform:'win32',readWindowsUiLocale:()=>{reads++;return 'zh-CN'},fallbackLocale:()=> 'en-US'};
  assert.equal(Pack.detectPackLocale(undefined,probes),'zh-CN');
  assert.equal(Pack.detectPackLocale('en',probes),'en');assert.equal(reads,1);
  assert.equal(Pack.detectPackLocale(undefined,{...probes,readWindowsUiLocale:()=>{throw Error('unavailable')}}),'en');
});
