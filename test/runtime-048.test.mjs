import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,normalize,resolve,sep} from 'node:path';
import vm from 'node:vm';
import {patchHelper048,patchStandalone048,preserveStandalonePolicy048} from '../scripts/prepare-runtime-048.mjs';
import {readVerifiedUpstream048} from '../scripts/upstream-snapshot-048.mjs';

const root=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet');
const options={skip:JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version!=='0.4.8'};
const read=name=>readVerifiedUpstream048(root,name);
const host=()=>patchStandalone048(read('lib/standalone.js'));
const helperNames=[
 'main.js','main/bridge.js','main/displays.js','main/dpi.js','main/ipc.js','main/tray.js','main/user-data.js','main/windows.js',
 'pointer-target.js','preload.js','renderer.js','sprite.js','sprite/bubble.js','sprite/init.js','sprite/input.js','sprite/menu.js',
 'sprite/motion.js','sprite/playback.js','sprite/window-fit.js','events.js','shared-core.js','index.html'
];
const helper=()=>Object.fromEntries(helperNames.map(name=>[name,read('runtime/electron-helper/'+name)]));

function section(source,start,end){
 const first=source.indexOf(start),last=source.indexOf(end,first+start.length);
 assert.ok(first>=0&&last>first,start);
 return source.slice(first,last);
}

const region=(source,name)=>section(source,'//#region src/'+name+'\n','//#endregion');

test('048独立宿主拒绝编码、子路径和HEAD环境读取，普通配置保留原路由',options,async()=>{
 const source=host();
 const route=section(source,'const runPetRoute = async','const dispatchPetRoute = createPetRouter(deps);');
 const security=region(source,'standalone/request-security.ts');
 let dispatches=0;
 const sandbox={
  URL,ROUTE_SEGMENT:'/dsh-pet-7340',configQueue:Promise.resolve(),upstreamCapabilityResult040:()=>undefined,
  dispatchPetRoute:()=>{dispatches++;return {status:200};}
 };
 vm.runInNewContext(`${route}\n${security}\nglobalThis.api={route:runPetRoute,publicRead};`,sandbox);
 for(const method of ['GET','HEAD','POST','PUT','DELETE']){
  for(const path of ['environment','%65nvironment','environment/fresh','environment%2ffresh']){
   const url='/dsh-pet-7340/'+path+'?pet=demo&surface=desktop&fresh=1';
   assert.equal(sandbox.api.publicRead({url,method}),false);
   assert.equal((await sandbox.api.route(url,method,'{}')).status,403);
  }
 }
 assert.equal(dispatches,0);
 assert.equal((await sandbox.api.route('/dsh-pet-7340/config','GET','')).status,200);
 assert.equal(dispatches,1);
});

test('048碎念、梦话和聊天使用本机时间，角色切换拦截旧回复及记忆写入',options,async()=>{
 const original=read('lib/standalone.js');
 const source=host();
 assert.equal(preserveStandalonePolicy048(preserveStandalonePolicy048(original)),preserveStandalonePolicy048(original));
 assert.throws(()=>preserveStandalonePolicy048(original.replace('await queryWeather(located.city, deps)','await queryWeather(located.city)')),/环境查询.*锚点/);
 let id='dragon',memoryWrites=0;
 const published=[],prompts=[];
 let onRead=()=>{};
 const rejectNetwork=()=>{throw Error('unexpected environment lookup');};
 const sandbox={
  join,Date,locateCity:rejectNetwork,queryWeather:rejectNetwork,
  readAllConfig:()=>({main:{voiceEnabled:true,voiceWhisperEnabled:true}}),
  readFile:async()=>{onRead();return '{}';},mkdir:async()=>{},writeFile:async()=>{memoryWrites++;},
  findPetInstance:()=>({entry:'main',conf:{},pet:{id:'demo',display:'desktop'}}),
  composeSystemPrompt:parts=>{prompts.push(parts);return '测试';},pickVoiceSurface:()=> 'desktop',
  readMemePool:()=>[],configuredModel:()=>undefined,sliceMemoryRounds:messages=>messages,
  generateWhisper:async()=>({ok:true,text:'测试'}),generateChat:async()=>({ok:true,text:'测试'}),
  activeChatMemoryProvider:()=>null,createMemoryOrphans:()=>({}),SLEEP_TALK_INSTRUCTION:'测试',
  CodexCharacter:{hostPersona:()=>'',readCharacter:()=>({id}),characterKey:character=>character.id,changedResult:()=>({ok:false,reason:'changed'})}
 };
 vm.runInNewContext(region(source,'host/environment.ts')+'\n'+region(source,'host/plugin/chat-memory.ts')+'\nglobalThis.api={currentEnvironment,createChatMemory};',sandbox);
 const memory=sandbox.api.createChatMemory({userRoot:root,log:{info(){}},memeDirsFor:()=>[],state:{writePet:(...args)=>published.push(args)}});
 assert.equal(await sandbox.api.currentEnvironment({force:true}),undefined);
 assert.equal((await memory.publishWhisper('demo',undefined,undefined,'whisper')).ok,true);
 assert.equal(await memory.publishSleepTalk('demo'),true);
 assert.equal((await memory.chatWithPet('demo','测试')).ok,true);
 assert.equal(prompts.length,3);
 assert.ok(prompts.every(parts=>parts.now instanceof Date&&!Object.hasOwn(parts,'env')));
 assert.equal(memoryWrites,1);
 assert.equal(published.length,3);
 onRead=()=>{id='sheep';};
 assert.equal((await memory.chatWithPet('demo','切换前发起')).reason,'changed');
 assert.equal(memoryWrites,1);
 assert.equal(published.length,3);
});

test('048普通图片只读固定依赖包内目录，原有表情包路径仍可用',options,async()=>{
 const source=host();
 const paths=[];
 const packageRoot=join(root,'package-fixture'),userRoot=join(root,'user-fixture');
 const bundled=join(packageRoot,'assets','pic','bundled.png');
 const privatePic=join(userRoot,'pic','personal.png');
 const meme=join(userRoot,'memes','smile.png');
 const sandbox={
  join,normalize,sep,URL,PACKAGE_ROOT:packageRoot,MIME:{'.png':'image/png'},isValidPetId:id=>id==='main',
  existsSync:path=>{paths.push(path);return [bundled,privatePic,meme].includes(path);}
 };
 vm.runInNewContext(section(source,'function resolveAsset(root, rel) {','function parseRange(')+'\n'+region(source,'host/routes/assets.ts')+'\nglobalThis.route=handleAssetsRoutes;',sandbox);
 const request=rest=>sandbox.route({userRoot,memeDirsFor:()=>[join(userRoot,'memes')]},{rest,url:new URL('http://localhost/')});
 assert.equal((await request('pic/bundled.png')).file,bundled);
 assert.equal((await request('pic/personal.png')).status,404);
 assert.equal((await request('pic/memes/main/smile.png')).file,meme);
 assert.equal((await request('pic/../personal.png')).status,404);
 assert.ok(!paths.includes(privatePic));
});

test('048手动余额带原生宠物和显示面校验，其他窗口的查询不会改本窗口额度状态',options,async()=>{
 const source=host();
 const calls=[];
 const sandbox={URL,okResult:obj=>({status:200,obj}),readAllConfig:()=>({}),methodNotAllowed:()=>({status:405})};
 vm.runInNewContext(region(source,'host/routes/balance.ts')+'\nglobalThis.route=handleBalanceRoutes;',sandbox);
 let surfaceBlocked=false,locked=false;
 const deps={
  requirePet:(params,_read,settings)=>{
   assert.equal(settings.surface,true);
   const petId=params.get('pet');
   return petId==='demo'?{ok:true,petId}:{ok:false,res:{status:404}};
  },
  surfaceBlocked:()=>surfaceBlocked?{status:409}:undefined,
  lockBlocked:()=>locked?{status:423}:undefined,
  refreshBalance:async(...args)=>calls.push(args)
 };
 const request=(search='',method='POST')=>sandbox.route(deps,{rest:'balance',method,url:new URL('http://localhost/'+search)});
 assert.equal((await request('', 'GET')).status,405);
 assert.equal((await request('?pet=other&surface=desktop')).status,404);
 surfaceBlocked=true;
 assert.equal((await request('?pet=demo&surface=desktop')).status,409);
 surfaceBlocked=false;
 locked=true;
 assert.equal((await request('?pet=demo&surface=desktop')).status,423);
 locked=false;
 assert.equal((await request('?pet=demo&surface=desktop')).status,200);
 assert.equal((await request()).status,200);
 assert.deepEqual(calls,[[true,'demo'],[true]]);

 const original=helper(),fixed=patchHelper048(original);
 assert.deepEqual(patchHelper048(fixed),fixed);
 assert.match(fixed['sprite/menu.js'],/encodeURIComponent\(this\.pet\.id\) \+ '&surface=desktop'/);
 assert.doesNotMatch(fixed['sprite/menu.js'],/label: '查询天气'/);
 assert.match(fixed['sprite/bubble.js'],/this\.bubbleSlot = slot;\n    this\.bubble\.dataset\.slot=slot;/);
 const output=[];
 const scope={
  window:{__dshPetDebug:{}},console:{error(){}},codexFixedText:text=>text,
  sprites:[{pet:{id:'demo'},onBalanceTick:state=>output.push(state),showBalanceNotice:state=>output.push(state)}]
 };
 const balanceSection=section(fixed['events.js'],'function applyBalanceNotice(','function applyEnvLeaf(');
 const noticeLogic=region(fixed['shared-core.js'],'shared/balance/notice.ts');
 vm.runInNewContext(`let balance, balanceNoticeKey=null, balanceTick=0;\n${noticeLogic}\nconst S={readBalance:value=>value,decideBalanceNotice};\n${balanceSection}\nglobalThis.api={applyBalanceLeaf,read:()=>balance};`,scope);
 const failed={ok:false,provider:'fixture',reason:'fetch-error'},valid={ok:true,provider:'fixture'};
 const add=(state,petId,manual=false)=>scope.api.applyBalanceLeaf({state,petId,manual});
 add(failed,undefined);
 add(valid,'other',true);
 assert.equal(scope.api.read(),failed);
 add(failed,undefined);
 assert.deepEqual(output,[failed]);
 add(valid,'demo',true);
 add(failed,undefined);
 assert.deepEqual(output,[failed,valid,failed]);
});

test('048独立语音总闸与原生模块混装或半补丁均停止',options,()=>{
 const original=helper(),fixed=patchHelper048(original);
 assert.match(fixed['renderer.js'],/S\.setVoiceConfig\(cfg\.voiceName, cfg\.voiceEnabled, cfg\.voiceVolume\);/);
 assert.match(fixed['shared-core.js'],/function isVoiceNotifyEnabled\(\) \{\n\treturn false;/);
 assert.throws(()=>patchHelper048({...fixed,'renderer.js':original['renderer.js']}),/补丁不完整/);
 assert.throws(()=>patchHelper048({...fixed,'shared-core.js':fixed['shared-core.js'].replace('if (!voiceEnabled)','if (false)')}),/锚点|anchor/);
 assert.throws(()=>patchHelper048({...fixed,'main/displays.js':original['main/displays.js']}),/anchor/);
});
