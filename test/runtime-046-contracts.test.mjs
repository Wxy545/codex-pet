import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readUpstream,upstreamVersion} from './support/harness-upstream.mjs';
import {validateModularHelper046,validateModularOwnedElectron045,validateModularAlphaLayout045} from '../harness/modular-runtime-fix.mjs';

const only046={skip:upstreamVersion!=='0.4.6'};
const helperNames=['index.html','sprite.js','sprite/input.js','sprite/window-fit.js','sprite/playback.js','main/windows.js','main/ipc.js','preload.js','sprite/init.js','sprite/motion.js','events.js','shared-core.js'];
const read=name=>readUpstream('runtime/electron-helper/'+name);
const helpers=()=>Object.fromEntries(helperNames.map(name=>[name,read(name)]));
const plain=value=>JSON.parse(JSON.stringify(value));

function declaration(source,name){
 const matches=[...source.matchAll(new RegExp('^  function '+name+'\\([^)]*\\) \\{[\\s\\S]*?^  \\}','gm'))];
 assert.equal(matches.length,1);return matches[0][0];
}

test('046真实原生Electron与alpha函数保留完整045契约，不叠旧标记或借宿主Electron',only046,()=>{
 for(const file of ['lib/standalone.js','lib/index.js']){
  const source=readUpstream(file);assert.equal(validateModularOwnedElectron045(source),source);
  assert.throws(()=>validateModularOwnedElectron045(source.replace('push(defaultElectronExe());','push("borrowed.exe");')),/anchor/);
 }
 const source=readUpstream('lib/client.js');assert.equal(validateModularAlphaLayout045(source),source);
 assert.throws(()=>validateModularAlphaLayout045(source.replace('svg.style.position = "absolute";','svg.style.position = "fixed";')),/anchor/);
});

test('046 helper整链拒绝旧core、缺模块、重复及残缺flight/切屏协议，检查不改源码',only046,()=>{
 const original=helpers();assert.equal(validateModularHelper046(original),original);
 for(const name of helperNames){const missing={...original};delete missing[name];assert.throws(()=>validateModularHelper046(missing),/anchor/,name);}
 const mutations=[
  ['sprite.js','    if (this.customPos) {\n      const from','    if (this.customPos || true) {\n      const from'],
  ['main/windows.js','setTimeout(broadcastPetStates, 16)','setTimeout(broadcastPetStates, 0)'],
  ['main/ipc.js','vx: Number.isFinite(vx) ? vx : 0,','vx: Number.isFinite(vx) ? vx : 7,'],
  ['preload.js',"  // 点击穿透翻转：","  reportFlight() {},\n  // 点击穿透翻转："],
  ['sprite/init.js','this.throwState = null;','this.throwState = {};'],
  ['sprite/motion.js','this.throwState = null;','this.throwState = {};'],
  ['events.js','S.utteranceToHold(event)','S.utteranceToHold({})'],
  ['shared-core.js','function utteranceToHold(event) {','function oldUtteranceBridge(event) {'],
 ];
 for(const[name,before,after]of mutations){assert.ok(original[name].includes(before),name);assert.throws(()=>validateModularHelper046({...original,[name]:original[name].replace(before,after)}),/anchor/,name);}
 // 原045实际IPC名是report-flight；追加旧监听也必须拒绝，不能只检查完整原生函数块未变。
 const oldChannel=original['main/ipc.js']+"\nipcMain.on('pet:report-flight',()=>{});\n";
 assert.throws(()=>validateModularHelper046({...original,'main/ipc.js':oldChannel}),/anchor/);
 assert.throws(()=>validateModularHelper046({...original,'main/windows.js':original['main/windows.js']+original['main/windows.js']}),/anchor/);
 assert.equal(validateModularHelper046(original),original);
});

function spriteFixture(manual=false){
 // 执行官方共享几何和实际PetSprite；仅替换窗口落位出口，不复制定位算法。
 const shared=vm.runInNewContext(read('shared-core.js')+'\nPetShared;',{}, {timeout:2000});
 const view={x:0,y:0,w:3840,h:1032},left={x:0,y:0,width:1920,height:1032};
 const context={navigator:{platform:'Win32',userAgent:'synthetic'},BASE:'',VIEW:view,AREAS:[left,{...left,x:1920}],PRIMARY_AREA:left,S:shared,CONFIG:{topInsetRatio:0}};
 const proto=vm.runInNewContext(read('sprite.js')+'\nPetSprite.prototype;',context,{timeout:2000}),sprite=Object.create(proto);let stopped=0;
 Object.assign(sprite,{size:320,halfW:160,halfH:90,pet:{position:{corner:'bottom-right',marginX:0,marginY:60}},customPos:manual?{rx:3000/view.w,ry:600/view.h}:null,dragState:{active:false},throwRef:null,pos:{x:0,y:0},stopMove:()=>stopped++,sendBounds:(x,y)=>{sprite.pos={x,y};}});
 sprite.position();
 return{sprite,view,stopped:()=>stopped,setPrimary(width){context.AREAS=[{x:0,y:0,width,height:1032}];context.PRIMARY_AREA=context.AREAS[0];view.w=width;}};
}

test('046真实切屏：角落跟随新主屏与边距，自定义位置守世界坐标后夹回',only046,()=>{
 const corner=spriteFixture();assert.deepEqual(corner.sprite.pos,{x:1600,y:792});
 let before={...corner.view};corner.setPrimary(3840);corner.sprite.relayout(before);assert.deepEqual(corner.sprite.pos,{x:3520,y:792});
 before={...corner.view};corner.setPrimary(1920);corner.sprite.relayout(before);assert.deepEqual(corner.sprite.pos,{x:1600,y:792});assert.equal(corner.sprite.customPos,null);
 const manual=spriteFixture(true);assert.deepEqual(manual.sprite.pos,{x:2840,y:510});
 before={...manual.view};manual.setPrimary(3840);manual.sprite.relayout(before);assert.deepEqual(manual.sprite.pos,{x:2840,y:510});
 before={...manual.view};manual.setPrimary(1920);manual.sprite.relayout(before);assert.deepEqual(manual.sprite.pos,{x:1759,y:510});assert.notEqual(manual.sprite.customPos,null);
});

test('046切屏时拖拽与飞行仍由原物理接管，不插入定位或取消用户动作',only046,()=>{
 for(const state of ['drag','throw']){
  const f=spriteFixture();const previous={...f.sprite.pos};f.sprite.space={};if(state==='drag')f.sprite.dragState.active=true;else f.sprite.throwRef=42;
  const before={...f.view};f.setPrimary(1920);f.sprite.relayout(before);assert.equal(f.sprite.space,null);assert.deepEqual(f.sprite.pos,previous);assert.equal(f.stopped(),0);
 }
});

test('046真实window-fit及preload只用setBounds交完整像素状态，停飞速度归零',only046,()=>{
 const calls=[],context={PetSprite:function(){},window:{petBridge:{setBounds:(...args)=>calls.push(args)}},CONFIG:{},VIEW:{x:-100,y:0},toScreen:value=>value*2};
 vm.runInNewContext(read('sprite/window-fit.js'),context);
 const f={pos:{x:70,y:90},size:100,bottomPad:30,throwState:{vx:3,vy:4}},fit={x:20,y:30,width:200,height:180,offsetX:50,offsetY:60};
 context.PetSprite.prototype.reportWindow.call(f,fit);assert.deepEqual(calls[0],[-160,60,400,360,140,180,200,60,6,8,100,120]);
 f.throwState=null;context.PetSprite.prototype.reportWindow.call(f,fit);assert.deepEqual(calls[1].slice(8,10),[0,0]);
 const sent=[];let bridge;
 vm.runInNewContext(read('preload.js'),{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{send:(...args)=>sent.push(args)}};}});
 assert.equal(bridge.reportFlight,undefined);bridge.setBounds(...calls[0]);assert.equal(sent[0][0],'pet:set-bounds');
 assert.deepEqual(plain(sent[0][1]),{x:-160,y:60,width:400,height:360,boxX:140,boxY:180,size:200,bottomPad:60,vx:6,vy:8,marginL:100,marginT:120});
});

function brokerFixture(){
 const source=read('main/windows.js'),messages=[],timers=[],cleared=[],windows=new Map(),petStates=new Map();
 const context={windows,petStates,setTimeout:(fn,ms)=>{const timer={fn,ms,unref(){timer.unreferenced=true;}};timers.push(timer);return timer;},clearTimeout:timer=>cleared.push(timer)};
 const api=vm.runInNewContext('let petStateTimer=null;\n'+declaration(source,'broadcastPetStates')+'\n'+declaration(source,'updatePetState')+'\n({updatePetState,broadcastPetStates,pending:()=>petStateTimer});',context);
 const add=id=>windows.set(id,{id,isDestroyed:()=>false,webContents:{send:(channel,value)=>messages.push({id,channel,value:plain(value)})}});
 return{source,context,api,add,windows,petStates,messages,timers,cleared};
}

test('046真实broker单窗不广播、多窗16ms合并且末帧与静止速度不丢，重复状态不再排队',only046,()=>{
 const f=brokerFixture();f.add('a');f.api.updatePetState('a',{x:1,y:2,vx:3,vy:4,size:100,bottomPad:10});assert.equal(f.timers.length,0);
 f.add('b');f.api.updatePetState('a',{x:8});assert.equal(f.timers.length,1);assert.equal(f.timers[0].ms,16);assert.equal(f.timers[0].unreferenced,true);
 f.api.updatePetState('a',{x:9,vx:0,vy:0});assert.equal(f.timers.length,1);f.timers[0].fn();assert.equal(f.api.pending(),null);assert.equal(f.messages.length,2);
 assert.deepEqual(f.messages[0].value.a,{x:9,y:2,vx:0,vy:0,size:100,bottomPad:10});assert.equal(f.messages[0].channel,'pet:flight-states');
 f.api.updatePetState('a',{x:9,vx:0,vy:0});assert.equal(f.timers.length,1);
});

test('046真实closed回调清共享状态与待广播定时器，不给其它窗口留下旧宠物',only046,()=>{
 const f=brokerFixture();f.add('a');f.add('b');f.api.updatePetState('a',{x:1});f.api.updatePetState('b',{x:2});const pending=f.api.pending();assert.ok(pending);
 const maps={};for(const key of ['lastRequestedBounds','winMargins','windowIgnore','inputBusy','inputRegions','offBodyMs'])maps[key]=new Map([['b',true]]);
 let stops=0;Object.assign(f.context,maps,{win:{id:'b'},pet:{id:'b'},stopPointerFallback:()=>stops++,stopTopmostWatchdog:()=>stops++});
 const start=f.source.indexOf("    win.on('closed', ")+"    win.on('closed', ".length,end=f.source.indexOf('\n    });',start);assert.ok(start>0&&end>start);
 const callback=vm.runInNewContext('('+f.source.slice(start,end+'\n    }'.length)+')',f.context);callback();
 assert.equal(stops,2);assert.equal(f.windows.has('b'),false);assert.equal(f.petStates.has('b'),false);assert.equal(f.api.pending(),null);assert.ok(f.cleared.includes(pending));
 assert.deepEqual(Object.keys(f.messages.at(-1).value),['a']);for(const map of Object.values(maps))assert.equal(map.has('b'),false);
});

test('046原生语音事件翻译来自同一共享core，世代编号在hold/release中保持',only046,()=>{
 const shared=vm.runInNewContext(read('shared-core.js')+'\nPetShared;',{}, {timeout:2000});
 assert.deepEqual(plain(shared.utteranceToHold({kind:'start',seq:3})),{kind:'hold',seq:3});
 assert.deepEqual(plain(shared.utteranceToHold({kind:'end',seq:3})),{kind:'release',seq:3});
 assert.ok(read('events.js').includes('const hold = S.utteranceToHold(event);'));
});
