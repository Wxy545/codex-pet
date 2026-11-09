import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {patchStandalone047,patchHelper047,protectStandaloneVoice047} from '../scripts/prepare-runtime-047.mjs';
import {readVerifiedUpstream047,UPSTREAM_SHA256_047} from '../scripts/upstream-snapshot-047.mjs';
import {UPSTREAM_SHA256_046} from '../scripts/upstream-snapshot-046.mjs';

const root=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet');
const options={skip:JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version!=='0.4.7'};
const read=name=>readVerifiedUpstream047(root,name);
const readHost=()=>read('lib/standalone.js');
const names=['main.js','main/tray.js','main/bridge.js','main/ipc.js','main/dpi.js','main/user-data.js','main/windows.js','preload.js','renderer.js','sprite.js','sprite/init.js','sprite/window-fit.js','sprite/motion.js','sprite/menu.js','sprite/playback.js','sprite/bubble.js','sprite/input.js','events.js','shared-core.js','index.html'];
const helper=()=>Object.fromEntries(names.map(name=>[name,read('runtime/electron-helper/'+name)]));

function region(source,name){
 const marker='//#region src/'+name;
 const start=source.indexOf(marker),end=source.indexOf('//#endregion',start);
 assert.ok(start>=0&&end>start,name);
 return source.slice(start,end);
}

test('047原生碎念、对话和待办保留语音总闸，手动点播另走原宿主门控',options,async()=>{
 const fixed=patchStandalone047(readHost());
 const flags={voiceEnabled:false,voiceWhisperEnabled:true,voiceTodoEnabled:true};
 const readAllConfig=()=>({main:flags});
 const written=[];
 const sandbox={
  readAllConfig,
  join,
  readFile:async()=>'{ }',
  mkdir:async()=>{},
  writeFile:async()=>{},
  pickVoiceSurface:()=> 'desktop',
  findPetInstance:()=>({entry:'main',conf:{},pet:{display:'desktop'}}),
  composeSystemPrompt:()=> '',
  readMemePool:()=>[],
  configuredModel:()=>undefined,
  sliceMemoryRounds:messages=>messages,
  activeChatMemoryProvider:()=>null,
  generateWhisper:async()=>({ok:true,text:'测试'}),
  generateChat:async()=>({ok:true,text:'测试'}),
  createMemoryOrphans:()=>({}),
  CodexCharacter:{hostPersona:()=>'',readCharacter:()=>({id:'test'}),characterKey:character=>character.id}
 };
 vm.runInNewContext(region(fixed,'host/plugin/chat-memory.ts')+'\nglobalThis.create=createChatMemory;',sandbox);
 const memory=sandbox.create({userRoot:root,log:{info(){}},memeDirsFor:()=>[],state:{writePet:(_id,kind,value)=>written.push({kind,value})}});
 const todo=fixed.match(/isVoiceTodoEnabled: (\(\) => [\s\S]+?),\n\t\tlock,/);
 assert.ok(todo);
 vm.runInNewContext('globalThis.todoVoice='+todo[1]+';',Object.assign(sandbox,{configPaths:{}}));
 for(const [main,part,auto,manual] of [[false,true,false,false],[undefined,true,false,false],[true,false,false,true],[true,true,true,true]]){
  Object.assign(flags,{voiceEnabled:main,voiceWhisperEnabled:part,voiceTodoEnabled:part});
  assert.equal((await memory.publishWhisper('pet',undefined,undefined,'whisper')).ok,true);
  assert.equal(written.pop().value.voiceTo,auto?'desktop':undefined);
  assert.equal((await memory.publishWhisper('pet',undefined,'desktop')).ok,true);
  assert.equal(written.pop().value.voiceTo,manual?'desktop':undefined);
  assert.equal((await memory.chatWithPet('pet','测试')).ok,true);
  assert.equal(written.pop().value.voiceTo,manual?'desktop':undefined);
  assert.equal(sandbox.todoVoice(),auto);
 }
 const capability=fixed.slice(fixed.indexOf('let codexUpstreamCapabilityGate;'),fixed.indexOf('\nimport ',fixed.indexOf('let codexUpstreamCapabilityGate;')));
 vm.runInNewContext(capability.replace('export function','function')+'\nglobalThis.api={setUpstreamCapabilityGate,upstreamCapabilityResult040};',sandbox);
 for(const route of ['voice/speak','voice/hear']){
  sandbox.api.setUpstreamCapabilityGate(()=>({host:'workbuddy',available:true}));
  assert.equal(sandbox.api.upstreamCapabilityResult040(route,'POST').status,403);
  sandbox.api.setUpstreamCapabilityGate(()=>({host:'codex',available:false}));
  assert.equal(sandbox.api.upstreamCapabilityResult040(route,'POST').status,409);
  sandbox.api.setUpstreamCapabilityGate(()=>({host:'codex',available:true}));
  assert.equal(sandbox.api.upstreamCapabilityResult040(route,'POST'),undefined);
 }
});

test('047独立宿主关闭新通知语音，文本广播拒绝附带的新播报指令',options,async()=>{
 const fixed=patchStandalone047(readHost());
 const config={main:{voiceEnabled:false,voiceNotifyEnabled:true}};
 const projected=fixed.slice(fixed.indexOf('function readAllConfig(paths) {'),fixed.indexOf('function flattenPetList'));
 const saved=[];
 const sandbox={
  URL,readEditableConfig:()=>config,CodexCharacter:{projectConfig:value=>value},
  normalizeBroadcastText:value=>String(value),
  normalizeBroadcastDuration:()=>0,
  normalizeBroadcastAnim:()=>true,
  normalizeBroadcastVoice:value=>value===true,
  decideBroadcast:()=>({ok:true,petId:'pet',text:'测试',anim:false}),
  normalizeSurface:value=>value,
  voiceTargetOfSurface:value=>value,
  okResult:obj=>({status:200,obj}),
  failResult:(_reason,message)=>{throw Error(message);}
 };
 vm.runInNewContext(projected+'\n'+region(fixed,'host/routes/interaction.ts')+'\nglobalThis.api={readAllConfig,handleInteractionRoutes};',sandbox);
 assert.equal(sandbox.api.readAllConfig().main.voiceNotifyEnabled,false);
 assert.equal(config.main.voiceNotifyEnabled,true);
 const settings=region(fixed,'standalone/settings-page/script/globals.ts');
 assert.match(settings,/语音播报/);
 assert.doesNotMatch(settings,/g-voice-notify/);
 assert.doesNotMatch(region(fixed,'standalone/settings-page/script/pets.ts'),/voiceNotifyEnabled: state\.globals\.voiceNotifyEnabled/);
 assert.doesNotMatch(fixed,/outConfig\.voiceNotifyEnabled = vne/);
 const deps={lockBlocked:()=>null,surfaceBlocked:()=>null,state:{writePet:(_id,_kind,value)=>saved.push(value)}};
 for(const [main,speak] of [[false,true],[undefined,true],[true,undefined],[true,'true'],[true,true]]){
  config.main.voiceEnabled=main;
  const reply=await sandbox.api.handleInteractionRoutes(deps,{rest:'broadcast',method:'POST',body:JSON.stringify({text:'测试',speak}),url:new URL('http://local/?pet=pet&surface=desktop')});
  assert.equal(reply.status,200);
  assert.equal(saved.pop().voiceTo,undefined);
 }
});

test('047实际宿主通过语法检查，参考图、独立记忆和端点凭据保护仍有效',options,async()=>{
 const fixed=patchStandalone047(readHost());
 const syntax=spawnSync(process.execPath,['--check','--input-type=module'],{input:fixed,encoding:'utf8',windowsHide:true});
 assert.equal(syntax.status,0,syntax.stderr);
 assert.match(fixed,/current\$3\.apiKey&&input\.baseUrl!==undefined/);
 assert.match(fixed,/REQUESTS_PER_MINUTE = 6/);
 const registry={};
 vm.runInNewContext(region(fixed,'host/chat-memory-provider.ts')+'\nglobalThis.api={register:registerChatMemoryProvider,active:activeChatMemoryProvider};',registry);
 assert.throws(()=>registry.api.register({id:'test',recall(){}}),/feature-unavailable/);
 assert.equal(registry.api.active(),null);
 const start=fixed.indexOf('const runPetRoute = async'),end=fixed.indexOf('const dispatchPetRoute = createPetRouter(deps);',start);
 let calls=0;
 const routeScope={URL,ROUTE_SEGMENT:'/dsh-pet-7340',configQueue:Promise.resolve(),upstreamCapabilityResult040:()=>undefined,dispatchPetRoute:()=>{calls++;return{status:200};}};
 vm.runInNewContext(fixed.slice(start,end)+'\nglobalThis.route=runPetRoute;',routeScope);
 for(const method of ['GET','HEAD','POST','PUT','DELETE'])for(const route of ['character','%63haracter','character/extra','character%2fextra']){
  assert.equal((await routeScope.route('/dsh-pet-7340/'+route,method,'{}')).status,403);
 }
 assert.equal(calls,0);
 assert.equal((await routeScope.route('/dsh-pet-7340/config','GET','')).status,200);
 assert.equal(protectStandaloneVoice047(fixed),fixed);
 assert.throws(()=>protectStandaloneVoice047(fixed.replace('return config?.voiceEnabled === true && config.voiceTodoEnabled === true;','return true;')),/锚点|补丁不完整/);
});

test('047固定原件核验两个实际helper变更，独立版恢复自动播放总闸且补丁幂等',options,async()=>{
 assert.equal(Object.keys(UPSTREAM_SHA256_047).length,50);
 const changed=Object.keys(UPSTREAM_SHA256_047).filter(name=>name.startsWith('runtime/')&&UPSTREAM_SHA256_047[name]!==UPSTREAM_SHA256_046[name]);
 assert.deepEqual(changed,['runtime/electron-helper/renderer.js','runtime/electron-helper/shared-core.js']);
 const original=helper(),fixed=patchHelper047(original);
 assert.deepEqual(patchHelper047(fixed),fixed);
 assert.match(fixed['renderer.js'],/S\.setVoiceConfig\(cfg\.voiceName, cfg\.voiceEnabled, cfg\.voiceVolume\);/);
 assert.throws(()=>patchHelper047({...fixed,'renderer.js':original['renderer.js']}),/补丁不完整/);
 assert.throws(()=>patchHelper047({...fixed,'shared-core.js':fixed['shared-core.js'].replace('if (!voiceEnabled)', 'if (false)')}),/锚点|补丁不完整/);
 assert.throws(()=>patchHelper047({...original,'shared-core.js':original['shared-core.js'].replace('if (document.hidden && !autoAudioCanPlayHidden)', 'if (document.hidden)')}),/锚点|anchor|补丁不完整/);
 const invisibleCleanup=original['shared-core.js'].replace('document.addEventListener("visibilitychange",','document.addEventListener("unexpected-event",');
 assert.notEqual(invisibleCleanup,original['shared-core.js']);
 assert.throws(()=>patchHelper047({...original,'shared-core.js':invisibleCleanup}),/anchor/);
 assert.doesNotMatch(fixed['preload.js'],/reportFlight:/);
 assert.doesNotMatch(fixed['main/ipc.js'],/pet:report-flight/);
 const requests=[];
 const sandbox={AbortSignal,fetch:async(_url,options)=>{requests.push(JSON.parse(options.body));return{ok:false};}};
 vm.runInNewContext(fixed['shared-core.js'],sandbox);
 const voice=sandbox.PetShared;
 voice.setSurface('desktop');
 voice.setVoiceConfig('test-voice',false,0.25);
 voice.playSayVoice({text:'静音',voiceTo:'desktop'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.length,0);
 voice.speakText('手动点播');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(requests.splice(0),[{text:'手动点播',voice:'test-voice'}]);
 voice.setVoiceConfig('test-voice',true,0.25);
 voice.setVoiceNotifyEnabled(true);
 assert.equal(voice.isVoiceNotifyEnabled(),false);
 voice.speakNotice('通知仍为静音');
 voice.playSayVoice({text:'已有播报',voiceTo:'desktop'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(requests,[{text:'已有播报',voice:'test-voice'}]);
});
