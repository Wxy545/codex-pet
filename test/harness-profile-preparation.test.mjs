import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,linkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {prepareHarnessProfile} from '../scripts/prepare-harness-profile.mjs';
import {readUpstream,upstreamVersion} from './support/harness-upstream.mjs';

const files=['lib/client.js','lib/index.js','runtime/electron-helper/shared-core.js','runtime/electron-helper/sprite/motion.js','runtime/electron-helper/main.js','runtime/electron-helper/main/dpi.js','runtime/electron-helper/main/user-data.js','runtime/electron-helper/sprite.js','runtime/electron-helper/sprite/input.js','runtime/electron-helper/index.html'];
if(['0.4.3','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9'].includes(upstreamVersion))files.push('runtime/electron-helper/sprite/playback.js','runtime/electron-helper/sprite/window-fit.js');
if(['0.4.6','0.4.7','0.4.8','0.4.9'].includes(upstreamVersion))files.push(...['main/windows.js','main/ipc.js','preload.js','sprite/init.js','events.js'].map(name=>'runtime/electron-helper/'+name));
if(['0.4.7','0.4.8','0.4.9'].includes(upstreamVersion))files.push('runtime/electron-helper/renderer.js');
if(['0.4.8','0.4.9'].includes(upstreamVersion))files.push(...['main/displays.js','pointer-target.js','sprite/menu.js'].map(name=>'runtime/electron-helper/'+name));
if(upstreamVersion==='0.4.9')files.push('runtime/electron-helper/constants.js','runtime/electron-helper/sprite/bubble.js');
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
 for(const dshVersion of ['next','0.2.2-rc.2','0.2.2-rc.3'])assert.throws(()=>prepareHarnessProfile({...f.options,dshVersion}),/unverified/);
 assert.throws(()=>prepareHarnessProfile({...f.options,bundleDir:f.root}),/bundle-mismatch/);
 for(const version of ['0.4.4','0.4.10','^0.4.5','^0.4.6','^0.4.7','^0.4.8','^0.4.9']){
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

test('046/047/048/049飞行协议混入旧reportFlight通道时四类补丁均不落盘',{skip:!['0.4.6','0.4.7','0.4.8','0.4.9'].includes(upstreamVersion)},t=>{
 const f=fixture(t),before=Object.fromEntries(files.map(name=>[name,readFileSync(join(f.pkg,name),'utf8')]));
 const name='runtime/electron-helper/main/ipc.js',mixed=before[name]+"\nipcMain.on('pet:report-flight',()=>{});\n";
 writeFileSync(join(f.pkg,name),mixed);
 assert.throws(()=>prepareHarnessProfile(f.options),/anchor/);
 for(const file of files)assert.equal(readFileSync(join(f.pkg,file),'utf8'),file===name?mixed:before[file],file);
});

test('048/049 原生 HTTP 与 Helper 共用路由拒绝环境查询，本机时钟与内置图片保留',{skip:!['0.4.8','0.4.9'].includes(upstreamVersion)},async t=>{
 const f=fixture(t);
 prepareHarnessProfile(f.options);
 const host=readFileSync(join(f.pkg,'lib/index.js'),'utf8');
 const block=start=>{
  const from=host.indexOf(start),to=host.indexOf('\n}',from);
  assert.ok(from>=0&&to>from,start);
  return host.slice(from,to+2);
 };
 const quietDeps=new Proxy({ctx:{get(name){assert.equal(name,'codexPetHarnessTasks');}}}, {
  get(target,name){
   assert.equal(name,'ctx');
   return target.ctx;
  },
 });
 const route=runInNewContext([
  block('async function currentEnvironment('),
  block('async function handleEnvironmentRoutes('),
  block('function failureBody('),
  block('function sleepGated('),
  block('function createPetRouter('),
  block('function createHttpRoute('),
  host.match(/^const MAX_BODY_BYTES = .*;.*$/m)?.[0] || '',
  'const HANDLERS=[handleEnvironmentRoutes]; ({currentEnvironment,route:createHttpRoute(quietDeps).handlePetRoute});',
 ].join('\n'),{URL,Buffer,quietDeps,ROUTE_SEGMENT:'/dsh-pet-7340',fetch(){throw Error('unexpected-network');}});
 assert.equal(await route.currentEnvironment({force:true}),undefined);
 for(const method of ['GET','HEAD','POST','PATCH','DELETE']){
  for(const path of ['environment','%65nvironment','environment%2Fmore']){
   const result=await route.route('/dsh-pet-7340/'+path+'?pet=example&fresh=1',method);
   assert.equal(result.status,403);
   assert.equal(result.obj.reason,'forbidden');
  }
 }
 if(upstreamVersion==='0.4.9'){
  const clear=await route.route('/dsh-pet-7340/bubble%2Fclear','POST','{}');
  assert.equal(clear.status,403);
  const oversized=await route.route('/dsh-pet-7340/voice%2Fhear','POST','界'.repeat(350000));
  assert.equal(oversized.status,413);
  assert.match(host,/const MAX_BODY_BYTES = 1024 \* 1024;/);
 }
 assert.match(host,/timeContextOf\(parts\.now, parts\.env\)/);
 assert.match(host,/const picFile = resolveExisting\(join\(PACKAGE_ROOT, "assets", "pic"\), picRel\);/);
 assert.doesNotMatch(host,/resolveExisting\(join\(userRoot, "pic"\), picRel\)/);
});

test('048/049 环境与语音锚点未知时四类补丁均不落盘',{skip:!['0.4.8','0.4.9'].includes(upstreamVersion)},t=>{
 const f=fixture(t),name='lib/index.js';
 const originals=new Map(files.map(file=>[file,readFileSync(join(f.pkg,file),'utf8')]));
 const changes=[['const located = await locateCity(deps);','const located = await locateCity({ ...deps });']];
 if(upstreamVersion==='0.4.9')changes.push(['ensureDeepseekAsrProvider({ resolveKey: resolveDeepseekKey });','ensureDeepseekAsrProvider({ resolveKey: thirdPartyResolver });']);
 for(const [before,after] of changes){
  const modified=originals.get(name).replace(before,after);
  assert.notEqual(modified,originals.get(name));
  writeFileSync(join(f.pkg,name),modified);
  assert.throws(()=>prepareHarnessProfile(f.options),/native-host-04[89]-anchor-mismatch/);
  for(const [file,source] of originals)assert.equal(readFileSync(join(f.pkg,file),'utf8'),file===name?modified:source,file);
 }
});

test('049 只保留 Edge 音色和原生 DSH 识别，显式旧音色可用而陌生配置不会启用替代服务', {skip:upstreamVersion!=='0.4.9'}, async t=>{
 const f=fixture(t);prepareHarnessProfile(f.options);
 const host=readFileSync(join(f.pkg,'lib/index.js'),'utf8');
 const region=name=>{
  const start=host.indexOf('//#region '+name+'\n'),end=host.indexOf('//#endregion',start);
  assert.ok(start>=0&&end>start,name);
  return host.slice(start,end);
 };
 let calls=0,seen;
 const voiceRoot=join(f.root,'synthetic-voice-root');
 const mockSpeech={listProviders:()=>['native'],snapshot:()=>({providers:[{preparation:{phase:'ready'}}]}),resolve:data=>data,
  transcribe:async (request,signal)=>{assert.equal(signal.aborted,false);seen=request;calls++;return{text:'synthetic transcript'};}};
  const options={userRoot:voiceRoot,configuredVoice:()=>'<unsupported>',configuredProvider:()=>'dsh',log:{warn:message=>assert.fail(message)}};
 const noop=()=>{throw Error('unexpected external operation');};
 const voice=runInNewContext([
  ...['types','registry','speech-types','speech-registry','builtin-dsh','voices','builtin-edge','cache','speak','hear'].map(name=>region('src/host/voice/'+name+'.ts')),
  'ensureEdgeProvider(); ensureDshSpeechProvider({speechToText:()=>mockSpeech});',
  '({registerVoiceProvider,registerSpeechProvider,resolveVoice,cacheKey,voice:createVoiceService(options),hear:createHearService(options)});',
 ].join('\n'),{
  Buffer,AbortController,AbortSignal,createHash,setTimeout,clearTimeout,join,options,mockSpeech,
  stat:async path=>{assert.equal(path,join(voiceRoot,'voice-cache',expectedKey+'.mp3'));return {isFile:()=>true,size:10};},
  mkdir:noop,writeFile:noop,readFile:noop,readdir:noop,synthesize:noop,fetch:noop,credentials:{resolve:noop},
 });
 const expectedKey=createHash('sha1').update('edge\nzh-CN-XiaoyiNeural\n+0%\nsynthetic').digest('hex');
  assert.equal(voice.cacheKey('zh-CN-XiaoyiNeural',0,'synthetic'),expectedKey);
 assert.equal(voice.voice.list().providers.map(item=>item.id).join(','),'edge');
 assert.equal(voice.hear.list().providers.map(item=>item.id).join(','),'dsh');
 assert.throws(()=>voice.registerVoiceProvider({id:'deepseek',synthesize:noop}),/unsupported pet voice provider/);
 assert.throws(()=>voice.registerSpeechProvider({id:'other',transcribe:noop}),/unsupported pet speech provider/);
 assert.equal(voice.resolveVoice('zh-CN-XiaoyiNeural').limitedId,'edge/zh-CN-XiaoyiNeural');
  for(const id of ['zh-CN-XiaoyiNeural','edge/zh-CN-XiaoyiNeural']){
   const result=await voice.voice.speak({text:'synthetic',voice:id});
   assert.equal(result.ok,true,result.message);
  }
 assert.equal((await voice.voice.speak({text:'synthetic',voice:'deepseek/anything'})).message,'voice unavailable');
 assert.equal((await voice.voice.speak({text:'synthetic'})).message,'voice unavailable');
 assert.equal((await voice.hear.hear({audio:'eA==',provider:'deepseek'})).reason,'unsupported');
 assert.match((await voice.hear.hear({audio:Buffer.alloc(768*1024+1).toString('base64')})).message,/audio too large/);
 const cancelled=await voice.hear.hear({audio:'eA=='},AbortSignal.abort());
 assert.equal(cancelled.ok,false);
 assert.equal(calls,0);
 assert.equal((await voice.hear.hear({audio:'eA==',language:' zh '})).text,'synthetic transcript');
 assert.equal(seen.language,'zh');
 assert.equal(calls,1);
 assert.doesNotMatch(host,/setup\.standaloneDeepseekKey|const resolveDeepseekKey = async|ctx\.credentials\.resolve\(credentialRef\("DEEPSEEK_API_KEY"\)\)/);
});

test('047/048/049 半套语音配置或未知锚点不在 profile 落盘',{skip:!['0.4.7','0.4.8','0.4.9'].includes(upstreamVersion)},t=>{
 const f=fixture(t),name='runtime/electron-helper/renderer.js';
 const originals=new Map(files.map(file=>[file,readFileSync(join(f.pkg,file),'utf8')]));
 for(const modified of [
  originals.get(name).replace('S.setVoiceConfig(cfg.voiceName, cfg.voiceVolume);','S.setVoiceConfig(cfg.voiceName, cfg.voiceVolume, cfg.voiceEnabled);'),
  originals.get(name).replace('S.setVoiceConfig(cfg.voiceName, cfg.voiceVolume);','S.setVoiceConfig(cfg.voiceVolume);'),
 ]){
  assert.notEqual(modified,originals.get(name));
  writeFileSync(join(f.pkg,name),modified);
  assert.throws(()=>prepareHarnessProfile(f.options),/voice-047-anchor-mismatch/);
  for(const [file,source] of originals)assert.equal(readFileSync(join(f.pkg,file),'utf8'),file===name?modified:source,file);
 }
});

test('047/048/049 八套网页语言如实区分气泡总闸、分项与独立通知',{skip:!['0.4.7','0.4.8','0.4.9'].includes(upstreamVersion)},t=>{
 const f=fixture(t),name='lib/client.js',file=join(f.pkg,name);
 const original=readFileSync(file,'utf8');
 const changed=original.replace('voiceEnabled: "Speak manual whispers"','voiceEnabled: "Unreviewed copy"');
 assert.notEqual(changed,original);
 writeFileSync(file,changed);
 assert.throws(()=>prepareHarnessProfile(f.options),/voice-047-anchor-mismatch/);
 assert.equal(readFileSync(file,'utf8'),changed);
 writeFileSync(file,original);
 prepareHarnessProfile(f.options);
 const prepared=readFileSync(file,'utf8');
 const labels={de:'Sprechblasen vorlesen',en:'Speak bubbles',es:'Leer los globos en voz alta',fr:'Lire les bulles à voix haute',ja:'吹き出しの読み上げ',pt:'Ler os balões em voz alta',ru:'Озвучивать реплики в пузырях',zh:'气泡播报'};
 for(const [locale,label] of Object.entries(labels)){
  const anchor='//#region src/client/settings/locales/'+locale+'.ts';
  const start=prepared.indexOf(anchor),end=prepared.indexOf('//#endregion',start);
  assert.ok(start>=0&&end>start,locale);
  const dictionary=prepared.slice(start,end);
  assert.ok(dictionary.includes('voiceEnabled: '+JSON.stringify(label)+','),locale);
  const oldStart=original.indexOf(anchor);
  const oldDictionary=original.slice(oldStart,original.indexOf('//#endregion',oldStart));
  assert.notEqual(dictionary.match(/\tvoiceHint: .*\n/)?.[0],oldDictionary.match(/\tvoiceHint: .*\n/)?.[0],locale);
 }
 assert.match(prepared,/Periodic whispers and to-do reminders also need their own switch\. Work-status speech and the chat speaker button for a single line are independent/);
 assert.match(prepared,/定时碎碎念和待办提醒还要开启各自的开关。工作状态播报单独开启，对话中的喇叭可随时点播一句。/);
 assert.equal(prepareHarnessProfile(f.options).status,'current');
});

test('047/048/049 网页与桌面保留旧总闸，原生通知与单句点播独立，迟到配置不能重开语音',{skip:!['0.4.7','0.4.8','0.4.9'].includes(upstreamVersion)},async t=>{
 const f=fixture(t);prepareHarnessProfile(f.options);
 const idle=()=>new Promise(resolve=>setImmediate(resolve));
 for(const [name,surface] of [['lib/client.js','web'],['runtime/electron-helper/shared-core.js','desktop']]){
  const source=readFileSync(join(f.pkg,name),'utf8'),start=source.indexOf('//#region src/shared/voice.ts'),end=source.indexOf('//#endregion',start);
  assert.ok(start>=0&&end>start,name);
  const synthesized=[];
  let releaseConfig;
  const config=new Promise(resolve=>{releaseConfig=resolve;});
  const document={hidden:false,addEventListener(){}};
  const voice=runInNewContext(source.slice(start,end)+'\n;({setSurface,setVoiceConfig,setVoiceNotifyEnabled,playSayVoice,speakNotice,speakText});',{
   ROUTE_PATH:'/test',AbortSignal,document,
   fetch(url,options){
    if(url==='/test/config')return config;
    assert.equal(url,'/test/voice/speak');
    synthesized.push(JSON.parse(options.body).text);
    return Promise.resolve({ok:false});
   },
  });
  voice.setSurface(surface);
  voice.playSayVoice({text:'迟到的旧气泡',voiceTo:surface});
  voice.setVoiceConfig('',1,false);
  releaseConfig({json:async()=>({main:{voiceEnabled:true,voiceNotifyEnabled:true}})});
  await idle();
  voice.playSayVoice({text:'关着总闸',voiceTo:surface});
  voice.speakNotice('默认关闭');
  await idle();
  assert.deepEqual(synthesized,[],name);

  document.hidden=true;
  voice.setVoiceNotifyEnabled(true);
  voice.speakNotice('明确启用通知');
  voice.speakText('手动点播');
  await idle();
  assert.deepEqual(synthesized,['明确启用通知','手动点播'],name);

  document.hidden=false;
  voice.setVoiceConfig('',1,true);
  voice.playSayVoice({text:'允许气泡',voiceTo:surface});
  await idle();
  assert.deepEqual(synthesized,['明确启用通知','手动点播','允许气泡'],name);
 }
});
