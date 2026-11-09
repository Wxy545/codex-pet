import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setMaxListeners} from 'node:events';
import vm from 'node:vm';
import {localizeIndexHtml} from '../scripts/runtime-locale-patches.mjs';
const root=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet'),meta=JSON.parse(await readFile(join(root,'package.json'),'utf8')),supported=['0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7'].includes(meta.version);
if(!['0.3.8','0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7'].includes(meta.version))throw Error('unreviewed-upstream-version');
const quick=await readFile(new URL('../src/pet-quick-input.js',import.meta.url),'utf8');
const flush=()=>new Promise(done=>setImmediate(done));
async function fixture({host='codex',lookup}={}){
 let now=1000;const window=new EventTarget(),document=new EventTarget(),metrics={opens:0,site:0,plays:[],throws:0,hostCalls:0,score:0},timers=[];
 Object.assign(document,{body:{},querySelectorAll:()=>[]});
 window.__dshPetDebug={};window.clearTimeout=()=>{};
 window.petHost={getState:async()=>{metrics.hostCalls++;return lookup?lookup():{host,capabilities:{chat:host==='codex'}};}};
 window.codexChatPanel={open:()=>{metrics.opens++;}};window.petBridge={openDshSite:()=>{metrics.site++;}};
 class Controller extends AbortController{constructor(){super();setMaxListeners(64,this.signal);}}
 const scope={window,document,Event,AbortController:Controller,ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},navigator:{platform:'Win32'},performance:{now:()=>now},console:{log(){},warn(){}},BASE:'synthetic-base',ORIGIN:'synthetic-origin',VIEW:{w:1920,h:1080},WORK_AREAS:[{x:0,y:0,width:1920,height:1080}],CONFIG:{isWindowClampedToWorkArea:true,topInsetRatio:0},toLocal:x=>x,config:{clickSoundEnabled:false},setTimeout:fn=>{timers.push(fn);return timers.length;},URL};
 vm.runInNewContext(await readFile(join(root,'runtime/electron-helper/shared-core.js'),'utf8'),scope);scope.S=scope.PetShared;
 scope.S.spawnScoreBurst=()=>{metrics.score++;};scope.S.mountScorePopup=()=>{};
 for(const file of ['sprite.js','sprite/init.js',...(['0.4.3','0.4.5','0.4.6','0.4.7'].includes(meta.version)?['sprite/window-fit.js']:[]),'sprite/input.js','sprite/menu.js'])vm.runInNewContext(await readFile(join(root,'runtime/electron-helper',file),'utf8'),scope);
 vm.runInNewContext('window.ActualPetSprite=PetSprite;',scope);vm.runInNewContext(quick,scope);vm.runInNewContext(quick,scope);
 const hit=new EventTarget();hit.classList={add(){},remove(){}};hit.setPointerCapture=()=>{};
 const sprite=Object.assign(Object.create(window.ActualPetSprite.prototype),{hit,stage:{style:{}},pet:{id:'synthetic-pet',size:160},pos:{x:10,y:20},size:160,halfW:80,halfH:45,bottomPad:6,margin:{l:0,t:0},winOffset:{x:0,y:0},hitRect:{x:0,y:0,w:160,h:90},dragState:{active:false,dragging:false},lastPressAt:0,justDragged:false,pressScoreFired:false,frozen:false,menuOpen:false,chatOpen:false,todoOpen:false,sleeping:false,animations:{clicks:['click-response'],idle:['idle'],drag:['drag']},physics:{throwPower:1},hearHold:{release(){}},throwState:null,
  stopThrow(){this.throwState=null;},stopDragFollow(){},stopMove(){},setTip(){},syncInputBusy(){},subscribeCollision(){},setInteractive(){},syncInputRegions(){},balanceClickable:()=>false,closeMenu(){this.menuOpen=false;},playOnce:id=>metrics.plays.push(id),resumeWorkStatusAnim:()=>false,startThrow(){metrics.throws++;},position(){},startDragFollow(){Object.assign(this.pos,this.dragTarget);}});
 sprite.bindEvents();
 const send=(target,type,extra={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,{button:0,buttons:type==='pointerdown'?1:0,pointerId:1,pointerType:'mouse',screenX:80,screenY:80,clientX:80,clientY:80,detail:0,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...extra});target.dispatchEvent(event);};
 const click=(detail=1,extra={})=>{send(hit,'pointerdown',extra);now+=20;send(window,'pointerup',extra);send(hit,'click',{detail,...extra});now+=40;};
 const double=async(extra={})=>{click(1,extra);click(2,extra);send(hit,'dblclick',{detail:2,...extra});await flush();};
 return{sprite,hit,window,metrics,click,double,send,advance:ms=>now+=ms,flushTimers:()=>timers.splice(0).forEach(fn=>fn())};
}

test('真实0.4双击按原down/up/click顺序，第二按命中弹弓但未拖动仍只打开一次输入',{skip:!supported},async()=>{
 const f=await fixture();await f.double();assert.equal(f.sprite.dragState.sling,true);assert.equal(f.sprite.dragState.dragging,false);assert.equal(f.metrics.throws,0);assert.deepEqual(f.metrics.plays,['click-response','click-response']);assert.equal(f.sprite.pendingSquash,true);assert.equal(f.metrics.opens,1);assert.equal(f.metrics.hostCalls,1);
});
test('真实0.4拖拽弹弓和飞行抓取积分不会被双击打开输入，积分click清标记后仍拒绝',{skip:!supported},async()=>{
 const drag=await fixture();drag.click();drag.send(drag.hit,'pointerdown');drag.send(drag.hit,'pointermove',{screenX:160,screenY:80});drag.send(drag.window,'pointerup');drag.send(drag.hit,'click',{detail:2});drag.send(drag.hit,'dblclick',{detail:2});await flush();assert.equal(drag.metrics.throws,1);assert.equal(drag.metrics.opens,0);assert.equal(drag.metrics.hostCalls,0);
 const score=await fixture();score.click();score.sprite.throwState={vx:10000,vy:0};score.click(2);assert.equal(score.sprite.pressScoreFired,false);score.send(score.hit,'dblclick',{detail:2});await flush();assert.equal(score.metrics.score,1);assert.equal(score.metrics.opens,0);assert.equal(score.metrics.hostCalls,0);
});
test('真实0.4修饰键快捷、长按、菜单和取消保持原行为，不误触发输入',{skip:!supported},async()=>{
 for(const modifier of ['ctrlKey','metaKey','altKey','shiftKey']){const f=await fixture();await f.double({[modifier]:true});assert.equal(f.metrics.opens,0);if(['ctrlKey','metaKey'].includes(modifier))assert.equal(f.metrics.site,2);}
 const held=await fixture();held.send(held.hit,'pointerdown');held.advance(1800);held.send(held.window,'pointerup');held.send(held.hit,'click',{detail:1});await flush();assert.equal(held.metrics.opens,0);assert.deepEqual(held.metrics.plays,['click-response']);
 const menu=await fixture();menu.sprite.menuOpen=true;await menu.double();assert.equal(menu.metrics.opens,0);
 const cancel=await fixture();cancel.click();cancel.send(cancel.hit,'pointerdown');cancel.send(cancel.window,'pointercancel');cancel.send(cancel.hit,'click',{detail:2});cancel.send(cancel.hit,'dblclick',{detail:2});await flush();assert.equal(cancel.metrics.opens,0);
});
test('宿主必须实时确认：WorkBuddy走既有open-site，Harness/未知/查询失败不进Codex',{skip:!supported},async()=>{
 const workbuddy=await fixture({host:'workbuddy'});await workbuddy.double();assert.equal(workbuddy.metrics.site,1);assert.equal(workbuddy.metrics.opens,0);
 for(const host of ['harness','unknown',undefined]){const f=await fixture({lookup:async()=>({host})});await f.double();assert.equal(f.metrics.opens,0);assert.equal(f.metrics.site,0);}
 const failed=await fixture({lookup:async()=>{throw Error('unavailable');}});await failed.double();assert.equal(failed.metrics.opens,0);
});
test('AbortSignal清监听和在途宿主查询；新按下或销毁都使旧双击失效',{skip:!supported},async()=>{
 const f=await fixture();f.sprite.ac.abort();await f.double();assert.equal(f.metrics.opens,0);assert.equal(f.metrics.hostCalls,0);assert.deepEqual(f.metrics.plays,[]);
 for(const action of ['abort','pointerdown']){let resolveHost;const delayed=await fixture({lookup:()=>new Promise(done=>{resolveHost=done;})});delayed.click();delayed.click(2);delayed.send(delayed.hit,'dblclick',{detail:2});if(action==='abort')delayed.sprite.ac.abort();else delayed.send(delayed.hit,'pointerdown');resolveHost({host:'codex',capabilities:{chat:true}});await flush();assert.equal(delayed.metrics.opens,0);}
});
test('0.4加载顺序保留全部原脚本，双击装饰排在原型扩展后和renderer前且不重复',{skip:!supported},async()=>{
 const source=await readFile(join(root,'runtime/electron-helper/index.html'),'utf8'),fixed=localizeIndexHtml(source),scripts=[...fixed.matchAll(/<script src="(?:\.\/)?([^"]+)"/g)].map(row=>row[1]),before=[...source.matchAll(/<script src="(?:\.\/)?([^"]+)"/g)].map(row=>row[1]);
 assert.equal(scripts.filter(file=>file==='pet-quick-input.js').length,1);assert.ok(scripts.indexOf('pet-quick-input.js')>scripts.indexOf('sprite/input.js'));assert.ok(scripts.indexOf('pet-quick-input.js')>scripts.indexOf('sprite/menu.js'));assert.ok(scripts.indexOf('pet-quick-input.js')<scripts.indexOf('renderer.js'));assert.deepEqual(scripts.filter(file=>before.includes(file)),before);assert.equal(localizeIndexHtml(fixed),fixed);
});
