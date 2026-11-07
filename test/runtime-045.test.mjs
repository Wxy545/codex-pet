import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {patchStandalone045,patchHelper045,preserveStandalonePolicy045,protectStandaloneMemory045} from '../scripts/prepare-runtime-045.mjs';
import {readVerifiedUpstream045,UPSTREAM_SHA256_045} from '../scripts/upstream-snapshot-045.mjs';
import {UPSTREAM_SHA256_043} from '../scripts/upstream-snapshot-043.mjs';

const root=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet');
const supported=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version==='0.4.5',options={skip:!supported};
const read=name=>readVerifiedUpstream045(root,name);
const names=['main.js','main/tray.js','main/bridge.js','main/ipc.js','main/dpi.js','main/user-data.js','sprite.js','sprite/init.js','sprite/window-fit.js','sprite/motion.js','sprite/menu.js','sprite/playback.js','sprite/bubble.js','sprite/input.js','events.js','shared-core.js','index.html'];
const helper=()=>Object.fromEntries(names.map(name=>[name,read('runtime/electron-helper/'+name)]));
function region(source,name){const marker='//#region src/'+name,a=source.indexOf(marker),b=source.indexOf('//#endregion',a);assert.ok(a>=0&&b>a,name);return source.slice(a,b);}

test('045官方helper逐项同043摘要，保留原模块而不是重新拼装整份helper',()=>{
 const files=Object.keys(UPSTREAM_SHA256_045).filter(name=>name.startsWith('runtime/'));
 assert.ok(files.length>=30);
 for(const name of files)assert.equal(UPSTREAM_SHA256_045[name],UPSTREAM_SHA256_043[name],name);
 assert.ok(files.includes('runtime/electron-helper/sprite/window-fit.js'));
});

test('045实际新宿主保持所有既有策略并可编译，helper修补幂等及未知锚点拒绝',options,()=>{
 const source=read('lib/standalone.js'),fixed=patchStandalone045(source);
 const syntax=spawnSync(process.execPath,['--check','--input-type=module'],{input:fixed,encoding:'utf8',windowsHide:true});assert.equal(syntax.status,0,syntax.stderr);
 for(const value of ['canWhisper: () => runtime.ready() && store.current().automaticWhispers','REQUESTS_PER_MINUTE = 6','createDesktopChangeGuard','desktopSettled: sync.desktopSettled','Endpoint changes require a new API key.'])assert.ok(fixed.includes(value),value);
 assert.match(fixed,/current\$3\.apiKey&&input\.baseUrl!==undefined/);
 const a=fixed.indexOf('const characterAtStart = CodexCharacter.readCharacter();',fixed.indexOf('const chatWithPet = async')),b=fixed.indexOf('const memoryEntry = found.entry');assert.ok(a>=0&&a<b);
 const original=helper(),patched=patchHelper045(original);assert.deepEqual(patchHelper045(patched),patched);
 assert.match(patched['sprite/playback.js'],/this.once = nextOnce; \/\/ codex-pet-once-contract-043/);
 assert.match(patched['sprite/init.js'],/this.stage = stage; \/\/ codex-pet-stage-reference-043/);
 assert.match(patched['index.html'],/sprite\/window-fit.js/);assert.doesNotMatch(patched['sprite/input.js'],/this.stage.style.transform = 'none'/);
 assert.throws(()=>patchStandalone045(source+source),/锚点|定位|anchor/);
 assert.throws(()=>patchHelper045({...original,'sprite/window-fit.js':'unknown'}),/锚点|anchor/);
});

function memoryRegistry(source){
 const scope={};vm.runInNewContext(region(source,'host/chat-memory-provider.ts')+'\nglobalThis.api={register:registerChatMemoryProvider,active:activeChatMemoryProvider,list:listChatMemoryProviders};',scope);return scope.api;
}

test('045独立宿主拒绝外部记忆注册，内部召回和接收也拿不到无scope提供者',options,async()=>{
 const source=read('lib/standalone.js');let recalls=0,captures=0;const provider={id:'synthetic-provider',recall(){recalls++;},capture(){captures++;}};
 // 先证明真实上游接口能注册；补丁改变的是实际入口，不只是界面隐藏。
 const original=memoryRegistry(source),remove=original.register(provider);assert.equal(original.active(),provider);remove();assert.equal(original.active(),null);
 const fixed=patchStandalone045(source),api=memoryRegistry(fixed);
 assert.throws(()=>api.register(provider),/feature-unavailable/);assert.equal(api.active(),null);
 assert.deepEqual(JSON.parse(JSON.stringify(api.list())),{builtin:['native'],external:[]});
 const chat=region(fixed,'host/plugin/chat-memory.ts'),from=chat.indexOf('const recallPatch = async'),to=chat.indexOf('const publishWhisper = async',from);assert.ok(from>=0&&to>from);
 const scope={activeChatMemoryProvider:api.active};
 vm.runInNewContext(chat.slice(from,to)+'\nglobalThis.internal={recall:recallPatch,capture:captureTurn};',scope);
 assert.equal(await scope.internal.recall('synthetic-pet',{system:'synthetic-only',history:[],userText:'synthetic-only'}),undefined);
 assert.equal(scope.internal.capture('synthetic-pet',{userText:'synthetic-only',replyText:'synthetic-only',ts:1}),undefined);
 await Promise.resolve();
 assert.equal(recalls,0);assert.equal(captures,0);
 assert.match(fixed,/const memoryEntry = found\.entry \+ ":" \+ characterAtStart\.id/);
 assert.match(fixed,/const rawMessages = mem\[who\.entry \+ ":" \+ CodexCharacter\.readCharacter\(\)\.id\]/);
});

test('045策略和第三方记忆门控完整重复可用，半补丁、旧变量和陌生模块停止',options,()=>{
 const source=read('lib/standalone.js'),policy=preserveStandalonePolicy045(source),gated=protectStandaloneMemory045(source);
 assert.equal(preserveStandalonePolicy045(policy),policy);assert.equal(protectStandaloneMemory045(gated),gated);
 assert.throws(()=>protectStandaloneMemory045(gated.replace('codex-pet-memory-provider-gate-045','unknown-marker')),/锚点/);
 assert.throws(()=>protectStandaloneMemory045(source+source),/唯一/);
 const connection=source.indexOf('async function testAiConnection(fetcher, current$3, input) {');assert.ok(connection>=0);
 const damaged=source.slice(0,connection)+source.slice(connection).replace('const apiKey = (input.apiKey !== void 0 && input.apiKey !== "" ? input.apiKey : current$3.apiKey).trim();','const changedKey = input.apiKey;');
 assert.throws(()=>preserveStandalonePolicy045(damaged),/锚点/);
 assert.throws(()=>protectStandaloneMemory045('unknown'),/唯一/);
});
