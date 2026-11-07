import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import Character from '../src/codex-character.cjs';
import {createDesktopChangeGuard} from '../src/control-config.mjs';
import {localizeIndexHtml} from '../scripts/runtime-locale-patches.mjs';
let Module={};try{Module=await import('../scripts/prepare-runtime-040.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const root=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet'),meta=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const supported=['0.4.0','0.4.1','0.4.3','0.4.5'].includes(meta.version),read=name=>readFile(join(root,name),'utf8');
if(meta.version==='0.4.1'){const current=await import('../scripts/prepare-runtime-041.mjs');Module={...Module,patchStandalone040:current.patchStandalone041,patchHelper040:current.patchHelper041};}
if(meta.version==='0.4.3'){const current=await import('../scripts/prepare-runtime-043.mjs');Module={...Module,patchStandalone040:current.patchStandalone043,patchHelper040:current.patchHelper043,patchPlayback040:current.patchPlayback043};}
if(meta.version==='0.4.5'){const current=await import('../scripts/prepare-runtime-045.mjs');Module={...Module,patchStandalone040:current.patchStandalone045,patchHelper040:current.patchHelper045,patchPlayback040:current.patchPlayback045};}

test('0.4宿主保留原生Range与隐藏门控，角色记忆和用途在新生成函数准确接线',{skip:!supported},async()=>{
 assert.equal(typeof Module.patchStandalone040,'function');const source=await read('lib/standalone.js'),fixed=Module.patchStandalone040(source);
 assert.match(fixed,/const decision = parseRange\(req.headers.range, totalBytes\)/);assert.match(fixed,/if \(!isDisplayed\(display\)\)/);
 assert.match(fixed,/createDesktopChangeGuard/);assert.match(fixed,/codexPetPurpose: "whisper"/);assert.match(fixed,/request.codexPetPurpose === "whisper"/);
 assert.match(fixed,/readEditableConfig/);assert.match(fixed,/found.entry \+ ":" \+ characterAtStart.id/);assert.match(fixed,/const characterAtStart = CodexCharacter.readCharacter/);
 assert.throws(()=>Module.patchStandalone040(source.replace('const handlePetRoute = async (rawUrl, method, body, signal) => {','const changed = async () => {')),/锚点|定位|anchor/);
});

test('0.4拆分helper只接原生模块，不还原旧main或sprite，启动和托盘使用对象控制器',{skip:!supported},async()=>{
 assert.equal(typeof Module.patchHelper040,'function');const files=Object.fromEntries(await Promise.all(['main.js','main/tray.js','main/bridge.js','main/ipc.js','main/dpi.js','main/user-data.js','sprite.js','sprite/motion.js','sprite/menu.js','sprite/playback.js','sprite/bubble.js','sprite/input.js','events.js','shared-core.js','index.html',...(['0.4.3','0.4.5'].includes(meta.version)?['sprite/init.js','sprite/window-fit.js']:[])].map(async name=>[name,await read('runtime/electron-helper/'+name)]))),fixed=Module.patchHelper040(files);
 for(const[name,source]of Object.entries(fixed))if(name.endsWith('.js'))assert.doesNotThrow(()=>new vm.Script(source,{filename:name}));
 assert.match(fixed['main.js'],/const petWindows = createWindows/);assert.match(fixed['main.js'],/petWindows\.create\(\)/);assert.match(fixed['main.js'],/codexWorkbench/);assert.match(fixed['main.js'],/codexConnections/);
 assert.match(fixed['main/tray.js'],/extraItems\(\)/);assert.match(fixed['main/ipc.js'],/require\('\.\.\/codex-startup\.cjs'\)/);assert.match(fixed['sprite/input.js'],/pet-status-quota\.is-interactive/);
 assert.match(fixed['events.js'],/codexPendingWorkSnapshot/);assert.match(fixed['sprite/playback.js'],/codexPendingWorkSnapshot/);assert.match(fixed['sprite/motion.js'],/targetRatio - startRatio/);
 assert.match(fixed['main/bridge.js'],/parseRange\(request.headers.get\('range'\), data.length\)/);assert.match(fixed['main/dpi.js'],/dpi 探测失败，按不补偿继续/);
 assert.deepEqual(Module.patchHelper040(fixed),fixed);
 assert.throws(()=>Module.patchHelper040({...files,'main.js':files['main.js'].replace('const tray = createTray({','const other = createTray({')}),/锚点|定位|anchor/);
});

test('0.4自有装饰器排在全部sprite方法模块之后，语言先于装饰且原模块顺序不变',{skip:!supported},async()=>{
 const original=await read('runtime/electron-helper/index.html'),fixed=localizeIndexHtml(original),scripts=[...fixed.matchAll(/<script src="(?:\.\/)?([^"]+)"/g)].map(row=>row[1]);
 const modules=['sprite.js',...(['0.4.3','0.4.5'].includes(meta.version)?['sprite/window-fit.js']:[]),'sprite/init.js','sprite/playback.js','sprite/motion.js','sprite/input.js','sprite/bubble.js','sprite/menu.js'];for(const name of modules){assert.ok(scripts.indexOf(name)>=0,name);assert.ok(scripts.indexOf(name)<scripts.indexOf('codex-skin-renderer.js'),name);}for(let i=1;i<modules.length;i++)assert.ok(scripts.indexOf(modules[i-1])<scripts.indexOf(modules[i]),modules[i]);
 assert.ok(scripts.indexOf('codex-locale.cjs')<scripts.indexOf('codex-skin-renderer.js'));assert.ok(scripts.indexOf('codex-skin-renderer.js')<scripts.indexOf('events.js'));assert.equal(localizeIndexHtml(fixed),fixed);
});

test('0.4梦话遵循既有自动开关和最小周期，未知策略及隐藏不发模型，醒睡共用频率预算',{skip:!supported},async()=>{
 const fixed=Module.patchStandalone040(await read('lib/standalone.js')),end=fixed.indexOf('}, "dsh-pet: sleep talk poll");'),start=fixed.lastIndexOf('ctx.effect(() => {',end);assert.ok(start>=0&&end>start);
 const declarations=['automaticWhisperSchedule','displayCovers','isDisplayed'].map(name=>{const value=fixed.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?^\\}','m'))?.[0];assert.ok(value,name);return value;}).join('\n');
 let now=1000000,pending,enabled=false,policyKnown=true,period=600;const calls=[],lastWhisperAt=new Map(),pet={id:'synthetic-pet',display:'desktop',whisperEnabled:true},found={pet,conf:{eventsRefreshSec:{whisper:600,sleepTalk:60}}},policy={isReady:()=>true,canWhisper:()=>enabled,whisperIntervalSec:()=>period};
 const scope={ctx:{effect:fn=>fn()},Date:{now:()=>now},SLEEP_TALK_DEFAULT_SEC:60,readAllConfig:()=>({}),configPaths:[],sleep:{ids:()=>[pet.id]},findPetInstance:()=>found,standaloneAiPolicy:()=>policyKnown?policy:undefined,whisperPeriodSec:()=>600,sleepTalkPeriodSec:()=>60,lastWhisperAt,publishSleepTalk:async id=>calls.push(id),setTimeout:(callback,ms)=>{pending={callback,ms};return 1;},clearTimeout(){},log:{warn:message=>{throw Error(message);}}};
 vm.runInNewContext(declarations+'\n'+fixed.slice(start,end)+'}, "dsh-pet: sleep talk poll");',scope);assert.deepEqual(calls,[]);
 const tick=advance=>{now+=advance;pending.callback();};enabled=true;tick(0);assert.deepEqual(calls,[pet.id]);assert.equal(pending.ms,600000);assert.equal(lastWhisperAt.get(pet.id),now);
 tick(60000);assert.equal(calls.length,1);tick(540000);assert.equal(calls.length,2);
 pet.whisperEnabled=false;tick(600000);assert.equal(calls.length,2);pet.whisperEnabled=true;policyKnown=false;tick(600000);assert.equal(calls.length,2);policyKnown=true;period=NaN;tick(600000);assert.equal(calls.length,2);period=600;pet.display='none';tick(600000);assert.equal(calls.length,2);pet.display='unexpected';tick(600000);assert.equal(calls.length,2);
 pet.display='desktop';lastWhisperAt.set(pet.id,now);tick(60000);assert.equal(calls.length,2);tick(540000);assert.equal(calls.length,3);
});

test('0.4角色切换清理旧鱼睡眠，只访问可信main实例且同角色刷新不重复唤醒',{skip:!supported},async()=>{
 assert.equal(typeof Module.createSkinChangeHandler040,'function');
 const sleep=new Map([['synthetic-pet',{loop:'fish-sleep'}],['unrelated-pet',{loop:'other-sleep'}]]),calls=[],shown=[];let active=false,refreshes=0;
 const changed=Module.createSkinChangeHandler040({initialCharacter:'bluefish',isNative:()=>active,hostRequest:async(method,url)=>{
  calls.push([method,url]);if(url==='/dsh-pet-7340/config')return {status:200,body:JSON.stringify({main:{pets:[{id:'synthetic-pet'}]},other:{pets:[{id:'unrelated-pet'}]}})};
  assert.equal(method,'POST');const pet=new URL('http://localhost'+url).searchParams.get('pet');const removed=sleep.delete(pet);return {status:200,body:JSON.stringify({ok:true,sleeping:false,changed:removed})};
 },showCharacter:model=>shown.push(model.selection.character),refreshTray:async()=>{refreshes++;}});
 const model=id=>({selection:{character:id}});await changed(model('bluefish'));assert.equal(calls.length,0);
 await changed(model('white-dragon'));assert.equal(sleep.has('synthetic-pet'),false);assert.equal(sleep.has('unrelated-pet'),true);assert.deepEqual(calls,[['GET','/dsh-pet-7340/config'],['POST','/dsh-pet-7340/wake?pet=synthetic-pet']]);
 await changed(model('white-dragon'));assert.equal(calls.length,2);await changed(model('bluefish'));assert.equal(calls.length,2);
 active=true;await changed(model('curly-sheep'));assert.equal(calls.length,2);assert.equal(refreshes,5);assert.deepEqual(shown,['bluefish','white-dragon','white-dragon','bluefish','curly-sheep']);
});

test('0.4清理睡眠失败不记为已处理，拒绝坏实例并能在下次刷新重试',{skip:!supported},async()=>{
 assert.equal(typeof Module.createSkinChangeHandler040,'function');let bad=true,wakes=0,shown=0;
 const changed=Module.createSkinChangeHandler040({initialCharacter:'bluefish',isNative:()=>false,hostRequest:async(method,url)=>{
  if(method==='GET')return {status:200,body:JSON.stringify({main:{pets:[{id:bad?'../bad':'synthetic-pet'}]}})};
  wakes++;return {status:200,body:JSON.stringify({ok:true,sleeping:false})};
 },showCharacter:()=>{shown++;},refreshTray:async()=>{}});
 const model={selection:{character:'white-dragon'}};await assert.rejects(changed(model),/character-sleep-reset-unavailable/);assert.equal(wakes,0);assert.equal(shown,0);
 bad=false;await changed(model);assert.equal(wakes,1);assert.equal(shown,1);await changed(model);assert.equal(wakes,1);
});

test('0.4真实wake路由配合角色投影清宿主睡眠，不播鱼醒来台词或触碰任务锁',{skip:!supported},async t=>{
 const dataRoot=await mkdtemp(join(tmpdir(),'pet040-wake-'));t.after(()=>rm(dataRoot,{recursive:true,force:true}));
 const raw={main:{pets:[{id:'synthetic-pet'}],animations:{sleep:[{start:['fish-in'],loop:['fish-loop'],end:['fish-out']}]},sleepStartTexts:['原鱼睡觉'],sleepEndTexts:['原鱼醒来'],sleepRefuseTexts:['原鱼拒绝']}};
 const source=await read('lib/standalone.js'),sleepFrom=source.indexOf('function textPool(value)'),routeTo=source.indexOf('\n//#endregion',source.indexOf('async function handleSleepRoutes'));
 assert.ok(sleepFrom>=0&&routeTo>sleepFrom);const writes=[],scope={readAllConfig:()=>Character.projectConfig(raw,{dataRoot}),okResult:obj=>({kind:'json',status:200,obj}),methodNotAllowed:()=>assert.fail('wrong method'),failResult:()=>assert.fail('invalid route')};
 vm.runInNewContext(source.slice(sleepFrom,routeTo)+'\nglobalThis.Sleep=SleepStore;globalThis.route=handleSleepRoutes;',scope);
 const sleep=new scope.Sleep({onChange:(id,state)=>writes.push(['sleep',id,state.sleeping])});sleep.enter('synthetic-pet',{start:'fish-in',loop:'fish-loop',end:'fish-out'});writes.length=0;
 const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(4,16);png.writeUInt32BE(4,20);
 await mkdir(join(dataRoot,'skins/white-dragon'),{recursive:true});await writeFile(join(dataRoot,'skins/white-dragon/sprites.png'),png);await writeFile(join(dataRoot,'skins/selection.json'),JSON.stringify({character:'white-dragon',mode:'q'}));
 const changed=Module.createSkinChangeHandler040({initialCharacter:'bluefish',isNative:()=>false,showCharacter(){},refreshTray:async()=>{},hostRequest:async(method,path)=>{
  if(method==='GET')return {status:200,body:JSON.stringify(scope.readAllConfig())};
  const url=new URL('http://localhost'+path),result=await scope.route({configPaths:[],sleep,lock:{locked:()=>assert.fail('wake must not cancel or claim task locks')},state:{writePet:(...args)=>writes.push(args)},requirePet:(params,read)=>{const conf=read().main,pet=conf.pets.find(item=>item.id===params.get('pet'));return {ok:!!pet,petId:pet.id,conf,pet};}},{url,method,rest:'wake'});
  return {status:result.status,body:JSON.stringify(result.obj)};
 }});
 await changed({selection:{character:'white-dragon'}});assert.equal(sleep.sleeping('synthetic-pet'),false);assert.deepEqual(writes,[['sleep','synthetic-pet',false]]);assert.deepEqual(raw.main.sleepEndTexts,['原鱼醒来']);
});

test('0.4原生语音入口按真实宿主门控，缺gate和移交均拒绝，编码路径不能绕过',{skip:!supported},async()=>{
 const fixed=Module.patchStandalone040(await read('lib/standalone.js')),declaration=name=>{const result=fixed.match(new RegExp('(?:export )?(?:async )?function '+name+'\\([^)]*\\) \\{[\\s\\S]*?^\\}','m'))?.[0];assert.ok(result,name);return result.replace(/^export /,'');};
 let voice=0,speech=0;const deps={voice:{speak:async()=>{voice++;return{ok:true,file:'synthetic-speech.mp3'};}},speech:{hear:async()=>{speech++;return{ok:true,text:'synthetic transcription'};}}},scope={URL,ROUTE_SEGMENT:'/dsh-pet-7340',createDesktopChangeGuard:({run})=>run,desktopSyncQueue:Promise.resolve(),okResult:obj=>({kind:'json',status:200,obj}),methodNotAllowed:()=>({kind:'json',status:405}),failResult:()=>({kind:'json',status:500}),sleepGated:()=>false};
 const helpers=['setUpstreamCapabilityGate','upstreamCapabilityResult040','handleVoiceRoutes','createPetRouter','createHttpRoute'].map(declaration).join('\n');vm.runInNewContext('let codexUpstreamCapabilityGate;\n'+helpers+'\nconst HANDLERS=[handleVoiceRoutes];globalThis.make=createHttpRoute;globalThis.setGate=setUpstreamCapabilityGate;',scope);
 const route=scope.make(deps).handlePetRoute,body=JSON.stringify({text:'synthetic only'}),paths=['voice/speak','voice%2Fspeak','%76oice/speak','voice/hear','voice%2Fhear','%76oice/hear'];
 for(const path of paths){const result=await route('/dsh-pet-7340/'+path,'POST',body);assert.equal(result.status,409,path);}assert.equal(voice+speech,0);
 for(const state of [{host:'workbuddy',available:true},{host:'codex',available:false},{host:'harness',available:true}]){
  scope.setGate(()=>state);for(const path of paths){const result=await route('/dsh-pet-7340/'+path,'POST',body);assert.equal(result.status,state.host==='workbuddy'?403:409,path);}assert.equal(voice+speech,0);
 }
 scope.setGate(()=>{throw Error('unknown handoff state');});assert.equal((await route('/dsh-pet-7340/voice/speak','POST',body)).status,409);assert.equal(voice,0);
 scope.setGate(()=>({host:'codex',available:true}));assert.equal((await route('/dsh-pet-7340/voice%2Fspeak','POST',body)).kind,'file');assert.equal((await route('/dsh-pet-7340/voice%2Fhear','POST',body)).obj.text,'synthetic transcription');assert.equal(voice,1);assert.equal(speech,1);
});

test('0.4配置锁等实际拆分Helper重建队列完成再释放，局部队列不越作用域引用',{skip:!supported},async()=>{
 const fixed=Module.patchStandalone040(await read('lib/standalone.js')),declaration=name=>{const value=fixed.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?^\\}','m'))?.[0];assert.ok(value,name);return value;};
 let finishStop,started=0,released=0,claimed=0,busy=false;const stopped=new Promise(resolve=>{finishStop=resolve;}),scope={URL,Promise,process:{env:{}},createDesktopChangeGuard,upstreamCapabilityResult040:()=>undefined,codexDesktopActivity:{acquire:()=>{claimed++;if(busy)return null;busy=true;return()=>{released++;busy=false;};}},ROUTE_SEGMENT:'/dsh-pet-7340',createDesktopPets:()=>({}),createDesktopSpawn:()=>({startHelper:()=>{started++;},stopHelperAndWait:()=>stopped}),createPetRouter:deps=>async()=>{deps.requestRestart();return {kind:'json',status:200};}};
 vm.runInNewContext(['createDesktopSync','createDesktopHelper','createHttpRoute'].map(declaration).join('\n')+'\nglobalThis.makeHelper=createDesktopHelper;globalThis.makeRoute=createHttpRoute;',scope);
 const helper=scope.makeHelper({log:{warn:message=>assert.fail(message)},logDesktopDecision(){}});assert.equal(typeof helper.desktopSettled,'function');
 let returned=false;const route=scope.makeRoute(helper).handlePetRoute,pending=route('/dsh-pet-7340/config','PUT','{}').then(result=>{returned=true;return result;});
 await new Promise(setImmediate);assert.equal(claimed,1);assert.equal(released,0);assert.equal(started,0);assert.equal(returned,false);
 for(const path of ['pet-config','pet%2Dconfig','%70et-config'])assert.equal((await route('/dsh-pet-7340/'+path,'POST','{}')).status,409,path);
 finishStop();assert.equal((await pending).status,200);assert.equal(started,1);assert.equal(released,1);
});
