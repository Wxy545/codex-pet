import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {patchStandalone046,patchHelper046,preserveStandalonePolicy046,protectStandaloneCharacter046} from '../scripts/prepare-runtime-046.mjs';
import {readVerifiedUpstream046,UPSTREAM_SHA256_046} from '../scripts/upstream-snapshot-046.mjs';
import {UPSTREAM_SHA256_045} from '../scripts/upstream-snapshot-045.mjs';

const root=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet');
const supported=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version==='0.4.6',options={skip:!supported};
const read=name=>readVerifiedUpstream046(root,name);
const names=['main.js','main/tray.js','main/bridge.js','main/ipc.js','main/dpi.js','main/user-data.js','main/windows.js','preload.js','sprite.js','sprite/init.js','sprite/window-fit.js','sprite/motion.js','sprite/menu.js','sprite/playback.js','sprite/bubble.js','sprite/input.js','events.js','shared-core.js','index.html'];
const helper=()=>Object.fromEntries(names.map(name=>[name,read('runtime/electron-helper/'+name)]));
function region(source,name){const marker='//#region src/'+name,a=source.indexOf(marker),b=source.indexOf('//#endregion',a);assert.ok(a>=0&&b>a,name);return source.slice(a,b);}

test('046原件清单固定50项，真实runtime八文件有变化，不冒充与043/045全同',()=>{
 assert.equal(Object.keys(UPSTREAM_SHA256_046).length,50);
 const changed=Object.keys(UPSTREAM_SHA256_046).filter(name=>name.startsWith('runtime/')&&UPSTREAM_SHA256_046[name]!==UPSTREAM_SHA256_045[name]).sort();
 assert.deepEqual(changed,['events.js','main/ipc.js','main/windows.js','preload.js','shared-core.js','sprite.js','sprite/init.js','sprite/motion.js'].map(name=>'runtime/electron-helper/'+name).sort());
 assert.equal(UPSTREAM_SHA256_046['runtime/electron-helper/sprite/window-fit.js'],UPSTREAM_SHA256_045['runtime/electron-helper/sprite/window-fit.js']);
});

test('046实际宿主编译并保留端点、模型、角色快照、碎念限流及独立记忆范围',options,()=>{
 const source=read('lib/standalone.js'),fixed=patchStandalone046(source);
 const syntax=spawnSync(process.execPath,['--check','--input-type=module'],{input:fixed,encoding:'utf8',windowsHide:true});assert.equal(syntax.status,0,syntax.stderr);
 for(const value of ['canWhisper: () => runtime.ready() && store.current().automaticWhispers','REQUESTS_PER_MINUTE = 6','createDesktopChangeGuard','desktopSettled: sync.desktopSettled','Endpoint changes require a new API key.','codex-pet-memory-provider-gate-045','codex-pet-character-route-gate-046'])assert.ok(fixed.includes(value),value);
 assert.match(fixed,/current\$3\.apiKey&&input\.baseUrl!==undefined/);
 const a=fixed.indexOf('const characterAtStart = CodexCharacter.readCharacter();',fixed.indexOf('const chatWithPet = async')),b=fixed.indexOf('const memoryEntry = found.entry');assert.ok(a>=0&&a<b);
 const registry={};vm.runInNewContext(region(fixed,'host/chat-memory-provider.ts')+'\nglobalThis.api={register:registerChatMemoryProvider,active:activeChatMemoryProvider,list:listChatMemoryProviders};',registry);
 assert.throws(()=>registry.api.register({id:'synthetic-provider',recall(){}}),/feature-unavailable/);assert.equal(registry.api.active(),null);assert.deepEqual(JSON.parse(JSON.stringify(registry.api.list())),{builtin:['native'],external:[]});
 assert.throws(()=>patchStandalone046(source+source),/锚点|定位|anchor|唯一/);
});

test('046整个新flight/relayout/voice链预检，保留stage、once和原生循环而不恢复旧上报',options,()=>{
 const original=helper(),fixed=patchHelper046(original);assert.deepEqual(patchHelper046(fixed),fixed);
 assert.match(fixed['sprite/init.js'],/this.stage = stage; \/\/ codex-pet-stage-reference-043/);
 assert.match(fixed['sprite/playback.js'],/this.once = nextOnce; \/\/ codex-pet-once-contract-043/);
 assert.match(fixed['sprite/playback.js'],/el\.onended = nextOnce \? \(\) => this\.handleEnded\(\) : \(\) => this\.restartLoop\(el\);/);
 assert.equal(fixed['main/windows.js'],original['main/windows.js']);assert.equal(fixed['preload.js'],original['preload.js']);
 assert.doesNotMatch(fixed['preload.js'],/reportFlight:/);assert.doesNotMatch(fixed['main/ipc.js'],/pet:report-flight/);
 assert.match(fixed['events.js'],/S\.utteranceToHold\(event\)/);assert.match(fixed['shared-core.js'],/function utteranceToHold\(event\)/);
 for(const name of ['main/windows.js','main/ipc.js','preload.js','sprite.js','sprite/init.js','sprite/motion.js','sprite/window-fit.js','events.js','shared-core.js'])assert.throws(()=>patchHelper046({...original,[name]:'unknown'}),/锚点|anchor/,name);
});

test('046实际公共路由规范化后拒绝参考图所有方法与编码变体，其它路由仍委派',options,async()=>{
 const fixed=patchStandalone046(read('lib/standalone.js')),start=fixed.indexOf('const runPetRoute = async'),end=fixed.indexOf('const dispatchPetRoute = createPetRouter(deps);',start);assert.ok(start>=0&&end>start);
 let calls=0;const scope={URL,ROUTE_SEGMENT:'/dsh-pet-7340',configQueue:Promise.resolve(),upstreamCapabilityResult040:()=>undefined,dispatchPetRoute:(_url,rest,method)=>{calls++;return{kind:'json',status:200,obj:{rest,method}};}};
 // 执行准备后真正共用于HTTP和helper管道的函数；不拿另写的正则模拟后端拒绝。
 vm.runInNewContext(fixed.slice(start,end)+'\nglobalThis.route=runPetRoute;',scope);
 for(const method of ['GET','HEAD','POST','PUT','DELETE'])for(const route of ['character','%63haracter','char%61cter','character/extra','character%2fextra']){
  const result=await scope.route('/dsh-pet-7340/'+route+'?root=synthetic-root',method,'{}');assert.equal(result.status,403,method+' '+route);assert.equal(result.obj.reason,'feature-unavailable');
 }
 assert.equal(calls,0);const config=await scope.route('/dsh-pet-7340/config','GET','');assert.equal(config.status,200);assert.equal(config.obj.rest,'config');assert.equal(calls,1);
});

test('046策略与参考图门控可重复，半补丁、旧端点符号或陌生模块停止',options,()=>{
 const source=read('lib/standalone.js'),policy=preserveStandalonePolicy046(source),guarded=protectStandaloneCharacter046(source);
 assert.equal(preserveStandalonePolicy046(policy),policy);assert.equal(protectStandaloneCharacter046(guarded),guarded);
 assert.throws(()=>protectStandaloneCharacter046(guarded.replace('codex-pet-character-route-gate-046','unknown-marker')),/补丁不完整/);
 assert.throws(()=>protectStandaloneCharacter046(source+source),/锚点/);
 assert.throws(()=>preserveStandalonePolicy046(source.replace('async function testAiConnection(fetcher, current$3, input) {','async function testAiConnection(fetcher, oldCurrent, input) {')),/锚点/);
 const connection=source.indexOf('async function testAiConnection(fetcher, current$3, input) {');assert.ok(connection>=0);
 const damaged=source.slice(0,connection)+source.slice(connection).replace('const apiKey = (input.apiKey !== void 0 && input.apiKey !== "" ? input.apiKey : current$3.apiKey).trim();','const changedKey = input.apiKey;');
 assert.throws(()=>preserveStandalonePolicy046(damaged),/锚点/);
 assert.throws(()=>protectStandaloneCharacter046('unknown'),/锚点/);
});
