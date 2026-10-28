'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),{join}=require('node:path'),vm=require('node:vm'),A=require('./skin-actions.cjs');
// 执行依赖包真实switchTo/playOnce/onWorkTick；测试替身不得替switchTo写anim。
function harness({deferredImages=false,deferredState=false,failImages=false,deferredMediaPlay=false,videoProfile=false,moveVideo=false,mode='q',locale='zh-CN',random=()=>1}={}){
 const timers=new Map(),observers=[],images=[],draws=[],media=[],positions=[],playPromises=[];let serial=0,clock=100000,changed,menu,initialState;
 const schedule=(fn,kind,delay=0)=>{const id=++serial;timers.set(id,{fn,kind,delay});return id;};
 class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.attrs={};this.classes=new Set();this.style=new Proxy({},{set:(target,key,value)=>{target[key]=value;this.mutate();return true;}});this.classList={add:value=>{this.classes.add(value);this.mutate();},remove:value=>{this.classes.delete(value);this.mutate();},toggle:(value,on)=>on?this.classes.add(value):this.classes.delete(value),contains:value=>this.classes.has(value)};}
  mutate(){for(const o of observers)if(o.targets.has(this))queueMicrotask(()=>{if(!o.closed)o.fn();});}
  appendChild(child){this.children.push(child);return child;} remove(){this.removed=true;} setAttribute(key,value){this.attrs[key]=value;} removeAttribute(key){delete this.attrs[key];if(key==='src')this.src='';}
  getContext(){return{clearRect(){},drawImage:(...args)=>draws.push({canvas:this,args})};}
 }
 class Video extends Element{
  constructor(){super('video');this.handlers=new Map();Object.assign(this,{currentTime:0,duration:10,readyState:0,paused:true,ended:false,loop:false});}
  addEventListener(name,fn){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(fn);}
  removeEventListener(name,fn){this.handlers.get(name)?.delete(fn);} emit(name){for(const fn of [...(this.handlers.get(name)||[])])fn();}
  load(){this.readyState=0;this.currentTime=0;this.ended=false;} ready(){this.readyState=2;this.videoWidth=640;this.videoHeight=360;this.emit('loadeddata');}
  play(){this.paused=false;this.emit('play');this.emit('playing');return deferredMediaPlay&&this.skinMedia?new Promise((resolve,reject)=>playPromises.push({element:this,resolve,reject})):Promise.resolve();} pause(){this.paused=true;this.emit('pause');}
 }
 class Observer{constructor(fn){this.fn=fn;this.targets=new Set();observers.push(this);}observe(v){this.targets.add(v);}disconnect(){this.closed=true;this.targets.clear();}}
 class Image{set src(url){this.url=url;images.push(this);if(!deferredImages)failImages?this.onerror?.():this.onload?.();}}
 const profile=(file,rects)=>({file,columns:4,rows:1,fps:4,frames:[[0,0],[1,0],[2,0],[3,0]],...(rects?{rects}:{})});
 const manifest=A.normalizeManifest({schemaVersion:1,profiles:{idle:videoProfile?{type:'video',file:'idle.webm',sisterFile:'idle-sister.png',forms:{sister:profile('idle-sister.png')}}:profile('idle.png'),work:profile('work.png'),jump:profile('jump.png',[[10,30,80,70],[110,2,80,70],[210,30,80,70],[310,30,80,70]]),walk:moveVideo?{type:'video',file:'walk.webm',sisterFile:'walk-sister.png',forms:{sister:profile('walk-sister.png')}}:profile('walk.png')},actions:{'呼吸':{profile:'idle',coverage:'dedicated'},'工作':{profile:'work',coverage:'dedicated'},'点击跳跃':{profile:'jump',coverage:'dedicated'},'移动':{profile:'walk',coverage:'dedicated'}}});
 const assets=Object.fromEntries(['idle','work','jump','walk'].flatMap(id=>[id+'.png',id+'-sister.png'].map(file=>[file,{available:true,width:400,height:100,url:'file:///'+file}])));
 if(videoProfile)assets['idle.webm']={available:true,type:'video',url:'file:///idle.webm'};
 if(moveVideo)assets['walk.webm']={available:true,type:'video',url:'file:///walk.webm'};
 const character={id:'white-dragon',label:'白龙娘',copy:{name:'白龙娘',actionLabels:{'鲸鱼吐泡泡特效':'龙尾吹泡泡'}},originalVideo:false,available:{q:true,sister:true,occasional:true},manifest,assets};
 const model={locale,selection:{character:'white-dragon',mode},characters:[character,{...character,id:'bluefish',label:'大肥鱼',originalVideo:true}],catalog:[]};
 const words={'图文对话':'Chat with images','操作任务':'Tasks','形象':'Appearance','Q版':'Chibi','姐姐版':'Adult','偶尔变身':'Occasional transformation','逐帧试作':'Frame prototype','素材未就绪':'Assets not ready','基础动画代用':'Base animation substitute','专属帧待制作':'Dedicated frames pending'};
 const L={setLocale(value){this.locale=value;},t(key){return this.locale==='en'?words[key]||key:key;}};
 const pure={};vm.runInNewContext(readFileSync(join(__dirname,'../node_modules/dsh-pet/runtime/electron-helper/shared-core.js'),'utf8'),pure);
 const shared={...pure.PetShared,mountContextMenu:options=>{menu=options;return options;}};
 const win={CodexSkinActions:A,CodexLocale:L,PetShared:shared,__dshPetDebug:{},codexSkins:{getState:()=>deferredState?new Promise(resolve=>{initialState=resolve;}):Promise.resolve(model),select:async value=>({...model,selection:value}),onChanged:fn=>{changed=fn;return()=>{};}},setTimeout:(fn,delay)=>schedule(fn,'timeout',delay),clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>schedule(fn,'interval',delay),clearInterval:id=>timers.delete(id),requestAnimationFrame:fn=>schedule(fn,'raf'),cancelAnimationFrame:id=>timers.delete(id),queueMicrotask,addEventListener(){},matchMedia:()=>({matches:false}),codexChatPanel:{open(){}}};
 const context={window:win,document:{head:new Element(),createElement:tag=>{if(tag==='video'){const v=new Video();v.skinMedia=true;media.push(v);return v;}return new Element(tag);}},navigator:{language:'zh-CN',platform:'Win32'},VIEW:{w:1000,h:800},AREAS:[{x:0,y:0,width:1000,height:800}],toLocal:value=>value,isOpenShortcut:()=>false,MutationObserver:Observer,Image,console:{warn(){},log(){},error(){}},S:shared,BASE:'/dsh-pet-7340',Date:class extends Date{static now(){return clock;}},Math:Object.assign(Object.create(Math),{random}),queueMicrotask,performance:{now:()=>clock},setTimeout:win.setTimeout,clearTimeout:win.clearTimeout,requestAnimationFrame:win.requestAnimationFrame,cancelAnimationFrame:win.cancelAnimationFrame};
 vm.createContext(context);vm.runInContext(readFileSync(join(__dirname,'../node_modules/dsh-pet/runtime/electron-helper/sprite.js'),'utf8')+'\nthis.PetSprite=PetSprite;',context);vm.runInContext(readFileSync(join(__dirname,'../node_modules/dsh-pet/runtime/electron-helper/events.js'),'utf8'),context);
 const P=context.PetSprite;P.prototype.dispose=function(){this.nativeDisposed=true;};vm.runInContext(readFileSync(join(__dirname,'codex-skin-renderer.js'),'utf8'),context);
 function sprite(){const p=Object.create(P.prototype);Object.assign(p,{stage:new Element(),hit:new Element(),tip:new Element(),videoA:new Video(),videoB:new Video(),front:0,pending:null,gen:0,anim:'呼吸',once:true,pet:{id:'main',name:'旧名字',workStatusEnabled:true},assetBase:'file:///original/',_facing:'left',playback:null,pendingSquash:false,pendingMove:null,frozen:false,moveRef:null,moveToken:0,halfW:20,halfH:40,throwRef:null,dragState:{active:false},animations:{idle:['呼吸'],clicks:['点击跳跃'],drag:['拖拽'],turn:[],categories:[],moves:{default:{leadSec:2,tailSec:2},actions:[{name:'移动'}]},events:{workStatus:[[],'工作']}},stopPosFollow(){},stopThrow(){this.throwRef=null;},sendBounds(x,y){positions.push([x,y]);},reportPlayback(id,state){this.report={id,state};},renderBubble(){},startSquash(){this.squashed=true;},closeMenu(){this.menuOpen=false;}});p.videoA.classList.add('is-front');return p;}
 const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
 return{sprite,model,win,timers,images,draws,media,positions,playPromises,flush,menu:()=>menu,change:value=>changed(value),now:value=>{clock=value;},ready:async p=>{(p.front===0?p.videoB:p.videoA).ready();await flush();},frame:async(p,seconds)=>{const v=p.front===0?p.videoA:p.videoB;v.currentTime=seconds;for(const[id,value]of[...timers])if(value.kind==='raf'){timers.delete(id);value.fn();}await flush();},finishImage:async image=>{image.onload?.();await flush();},finishState:async value=>{initialState(value);await flush();}};
}

test('拖拽源pause和EOS跨微任务时不等1500ms轮询，迟到play Promise不锁住或判坏素材',async()=>{
 const h=harness({deferredMediaPlay:true});const c=h.model.characters[0];c.manifest.profiles.drag={type:'video',file:'drag.webm'};c.manifest.actions['拖拽']={profile:'drag',coverage:'dedicated'};c.assets['drag.webm']={available:true,type:'video',url:'file:///drag.webm'};
 await h.flush();const p=h.sprite();p.dragState={active:true,dragging:true};p.playOnce('拖拽');await h.ready(p);const source=p.videoB,v=h.media[0];v.ready();await h.flush();assert.equal(h.playPromises.length,1);
 source.pause();await h.flush();assert.equal(v.paused,true);
 source.ended=true;source.onended();source.emit('ended');await h.flush();
 assert.equal(v.paused,false);assert.equal(h.playPromises.length,2);assert.equal(p.stage.classList.contains('codex-skin-active'),true);
 h.playPromises[0].reject(Object.assign(new Error('play interrupted by pause'),{name:'AbortError'}));await h.flush();
 assert.equal(p.stage.classList.contains('codex-skin-active'),true);assert.equal(v.paused,false);
 h.playPromises[1].resolve();await h.flush();assert.equal(h.playPromises.length,2);assert.equal(v.paused,false);
 p.applyFreeze(true);await h.flush();assert.equal(v.paused,true);assert.equal(h.playPromises.length,2);p.dispose();
});

test('冻结中取消未兑现play不误判素材失败，真实播放失败有界停止不重试',async()=>{
 const frozen=harness({deferredMediaPlay:true,videoProfile:true});await frozen.flush();const p=frozen.sprite();p.switchTo('呼吸',false);await frozen.ready(p);const v=frozen.media[0];v.ready();await frozen.flush();p.applyFreeze(true);await frozen.flush();
 frozen.playPromises[0].reject(Object.assign(new Error('play interrupted'),{name:'AbortError'}));await frozen.flush();assert.equal(v.paused,true);assert.equal(p.stage.classList.contains('codex-skin-active'),true);assert.equal(frozen.playPromises.length,1);p.dispose();
 const failed=harness({deferredMediaPlay:true,videoProfile:true});await failed.flush();const q=failed.sprite();q.switchTo('呼吸',false);await failed.ready(q);failed.media[0].ready();await failed.flush();
 failed.playPromises[0].reject(Object.assign(new Error('unsupported codec'),{name:'NotSupportedError'}));await failed.flush();assert.equal(q.stage.classList.contains('codex-skin-active'),false);
 const poll=[...failed.timers.values()].find(item=>item.kind==='interval');poll.fn();await failed.flush();assert.equal(failed.playPromises.length,1);q.dispose();
});

function clickVideoHarness(){
 const h=harness();const c=h.model.characters[0];c.manifest.profiles.jump={type:'video',file:'click.webm'};c.assets['click.webm']={available:true,type:'video',url:'file:///click.webm'};return h;
}

test('核心Q版真实playIdle只抽显式视频分类，原鱼切回完整原表且不污染catalog',async()=>{
 const h=harness({videoProfile:true});const c=h.model.characters[0];c.manifest.profiles.category={type:'video',file:'category.webm'};c.manifest.actions['已支持']={profile:'category',coverage:'dedicated'};c.assets['category.webm']={available:true,type:'video',url:'file:///category.webm'};
 await h.flush();const p=h.sprite();p.weights={idle:0,turn:0,move:0};p.animations.categories=[{id:'动作',weight:1,actions:['已支持','玩魔方']},{id:'缺失分类',weight:1,actions:['吃火锅']}];const original=p.animations,weights=p.weights;
 h.win.PetShared.rollKind=()=> 'action';h.win.PetShared.pickCategoryAction=categories=>({name:categories[0].actions.at(-1)});
 p.playIdle();assert.equal(p.pending.anim,'已支持');assert.equal(p.animations,original);assert.equal(p.weights,weights);assert.equal(p.animations.categories[0].actions.length,2);assert.ok(p.__codexSkinController.catalog.some(entry=>entry.id==='玩魔方'));
 await h.ready(p);const model=structuredClone(h.model);model.selection.character='bluefish';h.change(model);await h.flush();p.playIdle();assert.equal(p.pending.anim,'玩魔方');assert.equal(p.animations,original);p.dispose();
});

test('核心Q版真实playIdle和tryMove只用就绪走路候选，空turn权重归零后恢复',async()=>{
 const h=harness({videoProfile:true,moveVideo:true,random:()=>.5});await h.flush();const p=h.sprite();p.weights={idle:30,turn:20,move:50};p.animations.turn=['无素材转向'];p.animations.moves.default={minDist:60,maxDist:80,margin:20,leadSec:2,tailSec:2};p.animations.moves.actions.push({name:'旧跑摔'});Object.assign(p,{size:462,sideAllow:0,confineToScreen:false,currentCenterX:()=>500,currentCenterY:()=>400});
 const original=p.animations,weights=p.weights;let seen;h.win.PetShared.rollKind=(_roll,w)=>{seen={...w};return 'move';};p.playIdle();
 assert.equal(seen.turn,0);assert.equal(seen.move,50);assert.equal(p.pending.anim,'移动');assert.equal(p.pendingMove.dir,-1);assert.equal(p.animations,original);assert.equal(p.weights,weights);assert.equal(original.moves.actions.length,2);p.dispose();
});

test('核心Q版菜单剪掉缺失动作与空分类，保留基础工具和注册More，atlas-only不剪',async()=>{
 const h=harness({videoProfile:true});await h.flush();h.win.codexTaskPanel={open(){}};const S=h.win.PetShared;
 const tree=[{label:'打开网站',action:'open-site'},{label:'对话',action:'chat'},{label:'动作',children:[{label:'呼吸',anim:'呼吸'},{label:'玩魔方',anim:'玩魔方'}]},{label:'吃饭',children:[{label:'吃火锅',anim:'吃火锅'}]},S.buildMoreBranch([{owner:'动作',label:'外部动作'}])];
 S.mountContextMenu({tree});const next=h.menu().tree;assert.deepEqual(next.find(node=>node.label==='动作').children.map(node=>node.anim),['呼吸']);assert.equal(next.some(node=>node.label==='吃饭'),false);
 assert.ok(next.some(node=>node.action==='open-site'));assert.ok(next.some(node=>node.action==='chat'));assert.ok(next.some(node=>node.action==='codex-task-panel'));assert.ok(next.some(node=>node.children?.some(child=>child.children?.some(leaf=>leaf.action==='codex-select-skin'))));
 assert.equal(JSON.stringify(next.find(node=>node.label===S.MORE_MENU_LABEL).children),JSON.stringify(tree.at(-1).children));assert.equal(tree[2].children.length,2);
 const atlas=harness();await atlas.flush();atlas.win.PetShared.mountContextMenu({tree:[{label:'对话',action:'chat'},{label:'玩魔方',anim:'玩魔方'}]});assert.ok(atlas.menu().tree.some(node=>node.anim==='玩魔方'));
});

test('真实onWorkTick单候选视频循环，回空闲后由新素材真实结束立即回待机',async()=>{
 const h=harness();const c=h.model.characters[0];c.manifest.profiles.work={type:'video',file:'work.webm'};c.assets['work.webm']={available:true,type:'video',url:'file:///work.webm'};
 await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);p.onWorkTick({state:'working'},1);await h.ready(p);
 const source=p.videoA,v=h.media[0];v.ready();await h.flush();assert.equal(source.loop,true);assert.equal(v.loop,true);assert.equal(p.__codexSkinController.active.request.once,false);
 p.onWorkTick({state:null},2);source.emit('timeupdate');await h.flush();assert.equal(source.loop,false);assert.equal(v.loop,false);
 v.ended=true;v.paused=true;v.emit('ended');await h.flush();assert.equal(source.onended,null);assert.equal(source.paused,true);assert.equal(p.pending.anim,'呼吸');const gen=p.gen;v.emit('ended');await h.flush();assert.equal(p.gen,gen);p.dispose();
});

test('真实拖拽跨素材与隐藏片结尾仍循环，pointerUp按原路径恢复待机',async()=>{
 const h=harness();const c=h.model.characters[0];c.manifest.profiles.drag={type:'video',file:'drag.webm'};c.manifest.actions['拖拽']={profile:'drag',coverage:'dedicated'};c.assets['drag.webm']={available:true,type:'video',url:'file:///drag.webm'};
 await h.flush();const p=h.sprite();Object.assign(p,{pos:{x:280,y:360},bottomPad:0,dragTrail:[],syncInputBusy(){},startDragFollow(){},stopDragFollow(){},position(){}});
 p.dragState={active:true,dragging:false,sx:0,sy:0,petX:280,petY:360};p.onPointerMove({screenX:20,screenY:0});assert.equal(p.dragState.dragging,true);await h.ready(p);
 const source=p.videoB,v=h.media[0];v.ready();await h.flush();assert.equal(v.loop,true);assert.equal(v.paused,false);assert.equal(p.pending,null);
 source.pause();await h.flush();assert.equal(v.paused,true);await source.play();await h.flush();assert.equal(v.paused,false);
 source.ended=true;source.paused=true;source.onended();source.emit('ended');await h.flush();assert.equal(p.pending,null);assert.equal(v.paused,false);
 p.onPointerUp();await h.flush();assert.equal(p.dragState.active,false);assert.equal(p.dragState.dragging,false);assert.equal(p.pending.anim,'呼吸');assert.equal(v.paused,true);p.dispose();
});

test('手工点播drag仍单次结束，冻结期间拖拽视频不循环或推进链',async()=>{
 const make=()=>{const h=harness();const c=h.model.characters[0];c.manifest.profiles.drag={type:'video',file:'drag.webm'};c.manifest.actions['拖拽']={profile:'drag',coverage:'dedicated'};c.assets['drag.webm']={available:true,type:'video',url:'file:///drag.webm'};return h;};
 const h=make();await h.flush();const p=h.sprite();p.onMenuAction({anim:'拖拽'});await h.ready(p);const v=h.media[0];v.ready();await h.flush();assert.equal(v.loop,false);v.ended=true;v.paused=true;v.emit('ended');await h.flush();assert.equal(p.pending.anim,'呼吸');p.dispose();
 const frozen=make();await frozen.flush();const locked=frozen.sprite();locked.dragState={active:true,dragging:true};locked.playOnce('拖拽');await frozen.ready(locked);const media=frozen.media[0];media.ready();await frozen.flush();locked.applyFreeze(true);await frozen.flush();assert.equal(media.paused,true);media.ended=true;media.emit('ended');await frozen.flush();assert.equal(locked.pending,null);locked.dispose();
});

test('普通Q版鼠标点击优先已就绪专属视频，原候选对象和手动点播不变',async()=>{
 const h=clickVideoHarness();await h.flush();const p=h.sprite();p.animations.clicks.push('旧点击二','旧点击三');const original=p.animations,choices=[];
 h.win.PetShared.pick=values=>{choices.push([...values]);return values.at(-1);};p.onClick({});
 assert.deepEqual(choices[0],['点击跳跃']);assert.equal(p.pending.anim,'点击跳跃');assert.equal(p.animations,original);assert.deepEqual(p.animations.clicks,['点击跳跃','旧点击二','旧点击三']);
 await h.ready(p);p.onMenuAction({anim:'旧点击三'});assert.equal(p.pending.anim,'旧点击三');p.dispose();
});

test('切回原鱼或姐姐及无视频时普通点击恢复全部原候选',async()=>{
 const h=clickVideoHarness();await h.flush();const p=h.sprite();p.animations.clicks.push('旧点击二');const original=p.animations,choices=[];
 h.win.PetShared.pick=values=>{choices.push([...values]);return values.at(-1);};p.onClick({});await h.ready(p);
 const model=structuredClone(h.model);model.selection.character='bluefish';h.change(model);await h.flush();p.onClick({});
 assert.deepEqual(choices.at(-1),['点击跳跃','旧点击二']);assert.equal(p.pending.anim,'旧点击二');assert.equal(p.animations,original);await h.ready(p);
 model.selection.character='white-dragon';model.selection.mode='sister';h.change(structuredClone(model));await h.flush();p.onClick({});assert.deepEqual(choices.at(-1),['点击跳跃','旧点击二']);p.dispose();
 const none=harness();await none.flush();const q=none.sprite();q.animations.clicks.push('旧点击二');let list;none.win.PetShared.pick=values=>{list=[...values];return values.at(-1);};q.onClick({});assert.deepEqual(list,['点击跳跃','旧点击二']);q.dispose();
});

test('点击视频真实结束提前走原handleEnded，一次回执且隐藏十秒视频不再二次结束',async()=>{
 const h=clickVideoHarness();await h.flush();const p=h.sprite(),reports=[];p.reportPlayback=(id,state)=>reports.push([id,state]);
 p.playOnce('点击跳跃','click-request');await h.ready(p);const source=p.videoB,v=h.media[0];v.ready();await h.flush();
 assert.equal(source.duration,10);source.currentTime=3.45;v.ended=true;v.paused=true;v.emit('ended');await h.flush();
 assert.equal(source.paused,true);assert.equal(source.onended,null);assert.equal(p.pending.anim,'呼吸');
 assert.equal(reports.filter(([,state])=>state==='ended').length,1);const gen=p.gen;v.emit('ended');await h.flush();
 assert.equal(p.gen,gen);assert.equal(reports.filter(([,state])=>state==='ended').length,1);p.dispose();
});

test('旧点击视频迟到结束不能覆盖新请求或切换后的角色，冻结取消不推进动画链',async()=>{
 const h=clickVideoHarness();await h.flush();const p=h.sprite();p.playOnce('点击跳跃');await h.ready(p);const v=h.media[0];v.ready();await h.flush();
 p.playOnce('工作');const gen=p.gen;v.ended=true;v.paused=true;v.emit('ended');await h.flush();assert.equal(p.gen,gen);assert.equal(p.pending.anim,'工作');await h.ready(p);
 v.emit('ended');await h.flush();assert.equal(p.anim,'工作');p.dispose();
 const changed=clickVideoHarness();await changed.flush();const role=changed.sprite();role.playOnce('点击跳跃');await changed.ready(role);const old=changed.media[0];old.ready();await changed.flush();
 const model=structuredClone(changed.model);model.selection.character='bluefish';changed.change(model);await changed.flush();old.ended=true;old.paused=true;old.emit('ended');await changed.flush();assert.equal(role.pending,null);assert.equal(changed.win.__codexSkinDebug.character,'bluefish');role.dispose();
 const frozen=clickVideoHarness();await frozen.flush();const locked=frozen.sprite(),reports=[];locked.reportPlayback=(id,state)=>reports.push([id,state]);locked.playOnce('点击跳跃','frozen-click');await frozen.ready(locked);const ended=frozen.media[0];ended.ready();await frozen.flush();locked.applyFreeze(true);await frozen.flush();
 ended.ended=true;ended.paused=true;ended.emit('ended');await frozen.flush();assert.equal(locked.pending,null);assert.equal(locked.anim,'点击跳跃');assert.ok(reports.some(([,s])=>s==='cancelled'));assert.ok(!reports.some(([,s])=>s==='ended'));locked.dispose();
});

test('真实startMoveDrive只在位移窗口循环原生步态，lead和tail保持落脚首帧',async()=>{
 const h=harness({moveVideo:true});await h.flush();const p=h.sprite();p._facing='right';
 p.pendingMove={startRatio:.3,startYRatio:.5,targetRatio:.6,leadSec:2,tailSec:2};p.playOnce('移动');await h.ready(p);
 const v=h.media[0];v.ready();await h.flush();assert.equal(v.paused,true);assert.equal(v.currentTime,0);assert.equal(p.__codexSkinController.layers[p.front].layer.style.transform,'scaleX(-1)');
 await h.frame(p,1);assert.deepEqual(h.positions.at(-1),[280,360]);assert.equal(v.paused,true);
 await h.frame(p,2.5);assert.ok(h.positions.at(-1)[0]>280);assert.equal(v.paused,false);assert.equal(v.loop,true);
 v.currentTime=.75;await h.frame(p,8.1);assert.deepEqual(h.positions.at(-1),[580,360]);assert.equal(v.paused,true);assert.equal(v.currentTime,0);assert.equal(p.moveRef,null);p.dispose();
});

test('原生走路冻结停在当前姿势并停止物理，未移动窗口不会继续踏步',async()=>{
 const h=harness({moveVideo:true});await h.flush();const p=h.sprite();p.pendingMove={startRatio:.3,startYRatio:.5,targetRatio:.6,leadSec:2,tailSec:2};p.playOnce('移动');await h.ready(p);
 const v=h.media[0];v.ready();await h.flush();await h.frame(p,3);assert.equal(v.paused,false);v.currentTime=.5;
 p.applyFreeze(true);await h.flush();const count=h.positions.length;assert.equal(v.paused,true);assert.equal(v.currentTime,.5);assert.equal(p.moveRef,null);await h.frame(p,3.5);assert.equal(h.positions.length,count);p.dispose();
});

test('窗口未发车的move纯播放不踏步，真实点击打断后旧步态不复播',async()=>{
 const h=harness({moveVideo:true});await h.flush();const p=h.sprite();p.playOnce('移动');await h.ready(p);const v=h.media[0];v.ready();await h.flush();
 await h.frame(p,3);assert.equal(v.paused,true);assert.equal(h.positions.length,0);
 p.pendingMove={startRatio:.3,startYRatio:.5,targetRatio:.6,leadSec:2,tailSec:2};p.playOnce('移动');await h.ready(p);const moving=h.media.at(-1);moving.ready();await h.flush();await h.frame(p,3);assert.equal(moving.paused,false);
 p.onClick({});assert.equal(moving.paused,true);assert.equal(p.moveRef,null);await h.ready(p);await h.frame(p,4);assert.equal(h.win.__codexSkinDebug.action,'点击跳跃');assert.equal(moving.paused,true);p.dispose();
});

test('透明待机视频用原生时钟连续循环，原视频回绕不重置，冻结和换动作停止',async()=>{
 const h=harness({videoProfile:true});await h.flush();const p=h.sprite();p.switchTo('呼吸',false);await h.ready(p);
 assert.equal(h.media.length,1);const v=h.media[0];v.ready();await h.flush();
 assert.equal(v.loop,true);assert.equal(v.muted,true);assert.equal(v.paused,false);assert.equal(h.win.__codexSkinDebug.playback,'transparent-video');
 v.currentTime=4;await h.frame(p,0);assert.equal(v.currentTime,4);
 p.applyFreeze(true);await h.flush();assert.equal(v.paused,true);p.applyFreeze(false);await h.ready(p);
 const resumed=h.media.at(-1);resumed.ready();resumed.emit('seeked');await h.flush();assert.equal(resumed.paused,false);assert.equal(resumed.loop,true);
 p.playOnce('点击跳跃');assert.equal(v.paused,true);await h.ready(p);assert.equal(h.win.__codexSkinDebug.playback,'frame-prototype');
 p.dispose();assert.equal(v.src,'');
});

test('真实switchTo重复同待机先续接相位，seeked后交接，不因新front从零闪现',async()=>{
 const h=harness({videoProfile:true});await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);
 const first=h.media[0];first.ready();await h.flush();first.currentTime=4.25;
 const before=p.__codexSkinController.layers[p.front];assert.equal(before.layer.style.opacity,'1');
 p.playOnce('呼吸');assert.equal(first.paused,true);await h.ready(p);
 const next=h.media.at(-1);next.ready();await h.flush();
 assert.equal(next.currentTime,4.25);assert.equal(next.paused,true);assert.equal(before.layer.style.opacity,'1');
 next.emit('seeked');await h.flush();assert.equal(next.paused,false);assert.equal(before.layer.style.opacity,'0');
 next.currentTime=2.5;p.playOnce('点击跳跃');await h.ready(p);p.playOnce('呼吸');await h.ready(p);
 const reset=h.media.at(-1);reset.ready();await h.flush();assert.equal(reset.currentTime,0);assert.equal(reset.paused,false);p.dispose();
});

test('迟到视频加载不得覆盖已切换角色或姐姐PNG，once结束保持最后画面',async()=>{
 const h=harness({videoProfile:true});await h.flush();const p=h.sprite();p.animations.idle=[];p.animations.clicks.push('呼吸');p.playOnce('呼吸');await h.ready(p);const v=h.media[0];
 const next=structuredClone(h.model);next.selection.mode='sister';h.change(next);await h.flush();v.ready();await h.flush();
 assert.equal(h.win.__codexSkinDebug.form,'sister');assert.equal(h.win.__codexSkinDebug.playback,'frame-prototype');assert.equal(v.paused,true);
 next.selection.mode='q';h.change(structuredClone(next));await h.flush();const latest=h.media.at(-1);latest.ready();await h.flush();
 assert.equal(latest.loop,false);latest.ended=true;latest.paused=true;latest.emit('ended');await h.flush();
 assert.equal(latest.paused,true);assert.equal(latest.ended,true);p.dispose();
});

test('视频错误和加载超时只回退一次，迟到事件不能恢复旧角色视频',async()=>{
 const h=harness({videoProfile:true});await h.flush();const p=h.sprite();p.switchTo('呼吸',false);await h.ready(p);
 const v=h.media[0];v.emit('error');await h.flush();assert.equal(p.stage.classList.contains('codex-skin-active'),false);
 const interval=[...h.timers.values()].find(x=>x.kind==='interval');interval.fn();await h.flush();assert.equal(h.media.length,1);
 const next=structuredClone(h.model);next.selection.character='bluefish';h.change(next);await h.flush();v.ready();await h.flush();
 assert.equal(h.win.__codexSkinDebug.character,'bluefish');assert.equal(h.win.__codexSkinDebug.playback,'original-video');assert.equal(v.paused,true);p.dispose();
 const slow=harness({videoProfile:true});await slow.flush();const other=slow.sprite();other.switchTo('呼吸',false);await slow.ready(other);
 const guard=[...slow.timers].find(([,x])=>x.kind==='timeout'&&x.delay===10000);assert.ok(guard);guard[1].fn();await slow.flush();
 assert.equal(other.stage.classList.contains('codex-skin-active'),false);assert.equal(slow.media[0].paused,true);other.dispose();
});

test('视频专属动作菜单不标逐帧试作，共用和缺失仍保留原提示',async()=>{
 const h=harness({videoProfile:true,locale:'en'});await h.flush();
 const hint=()=>{h.win.PetShared.mountContextMenu({tree:[{label:'对话',action:'chat'},{label:'呼吸',anim:'呼吸'}]});return h.menu().tree[1].hint;};
 assert.equal(hint(),'');
 const shared=structuredClone(h.model);shared.characters[0].manifest.actions['呼吸'].coverage='shared';h.change(shared);await h.flush();
 assert.equal(hint(),'Base animation substitute');
 shared.characters[0].assets['idle.webm'].available=false;h.change(structuredClone(shared));await h.flush();
 assert.equal(hint(),'Dedicated frames pending');
});

test('真实switchTo等待loadeddata提交，新动作不借旧视频相位提前出画',async()=>{const h=harness();await h.flush();const p=h.sprite();p.playOnce('呼吸');assert.equal(h.win.__codexSkinDebug?.action,undefined);await h.ready(p);assert.equal(h.win.__codexSkinDebug.action,'呼吸');await h.frame(p,.75);const count=h.draws.length;p.playOnce('点击跳跃');assert.equal(h.win.__codexSkinDebug.action,'呼吸');assert.equal(h.draws.length,count);await h.ready(p);assert.equal(h.win.__codexSkinDebug.action,'点击跳跃');assert.deepEqual(h.draws.at(-1).args.slice(1,5),[10,30,80,70]);p.dispose();});
test('真实onWorkTick单候选只调switchTo，覆盖层跟工作动作而非旧sprite.anim',async()=>{const h=harness();await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);p.onWorkTick({state:'working'},1);assert.equal(p.anim,'呼吸');await h.ready(p);assert.equal(h.win.__codexSkinDebug.action,'工作');assert.equal(p.videoA.loop,true);p.dispose();});
test('PNG网格与rects共用视频时钟，once保持末帧，不拉长或无限重播四姿势',async()=>{const h=harness();await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);await h.frame(p,.5);assert.equal(h.draws.at(-1).args[1],200);await h.frame(p,1.2);assert.equal(h.draws.at(-1).args[1],300);await h.frame(p,5.2);assert.equal(h.draws.at(-1).args[1],300);assert.equal(h.win.__codexSkinDebug.playback,'frame-prototype');p.dispose();});
test('真实pause停止逐帧驱动，冻结中显式playOnce仍播放，不拿frozen代替paused',async()=>{const h=harness();await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);p.applyFreeze(true);await h.flush();assert.equal([...h.timers.values()].some(t=>t.kind==='raf'),false);p.playOnce('点击跳跃');await h.ready(p);assert.equal(p.frozen,true);assert.equal(p.videoA.paused,false);await h.frame(p,.25);assert.deepEqual(h.draws.at(-1).args.slice(1,5),[110,2,80,70]);p.dispose();});
test('异步新图预载，等图期间旧rAF停止，只发布当前已提交动作',async()=>{const h=harness({deferredImages:true});await h.flush();const p=h.sprite();p.playOnce('呼吸');assert.equal(h.images[0].url,'file:///idle.png');await h.finishImage(h.images[0]);await h.ready(p);p.playOnce('点击跳跃');assert.equal(h.images.at(-1).url,'file:///jump.png');await h.ready(p);const count=h.draws.length;await h.frame(p,.75);assert.equal(h.draws.length,count);await h.finishImage(h.images.at(-1));assert.equal(h.win.__codexSkinDebug.action,'点击跳跃');p.dispose();});
test('两层跟原front交接180ms，镜像挤压复制各视频，dispose清事件和rAF',async()=>{const h=harness();await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);const first=p.__codexSkinController.layers.find(layer=>layer.video===p.videoB);p.videoB.style.transform='scaleX(-1) scaleY(.55)';p.videoB.style.transformOrigin='bottom';await h.flush();assert.equal(first.layer.style.transform,'scaleX(-1) scaleY(.55)');p.playOnce('点击跳跃');await h.ready(p);const second=p.__codexSkinController.layers.find(layer=>layer.video===p.videoA);assert.equal(first.layer.style.opacity,'0');assert.equal(second.layer.style.opacity,'1');assert.match(second.layer.style.transition,/0\.18s/);p.dispose();assert.equal(p.nativeDisposed,true);assert.equal([...h.timers.values()].some(t=>['raf','interval'].includes(t.kind)),false);assert.equal(p.videoA.handlers.get('playing')?.size||0,0);});
test('rects用统一格内锚点保留第二姿势上跃28像素',async()=>{const h=harness();await h.flush();const p=h.sprite();p.playOnce('点击跳跃');await h.ready(p);const first=h.draws.at(-1).args;await h.frame(p,.25);const second=h.draws.at(-1).args;assert.ok(second[6]<first[6]);assert.ok(Math.abs((first[6]-second[6])/(first[7]/first[3])-28)<1e-8);p.dispose();});
test('移动四帧只在lead和tail间循环，准备和收尾不踏步',async()=>{const h=harness();await h.flush();const p=h.sprite();p.playOnce('移动');await h.ready(p);await h.frame(p,1);assert.equal(h.draws.at(-1).args[1],0);await h.frame(p,2.5);assert.equal(h.draws.at(-1).args[1],200);await h.frame(p,8.5);assert.equal(h.draws.at(-1).args[1],300);p.dispose();});
test('重复同一model不重置视频相位或重新装载图片',async()=>{const h=harness();await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);await h.frame(p,.5);const count=h.draws.length,images=h.images.length;h.change(structuredClone(h.model));await h.flush();assert.equal(h.draws.length,count);assert.equal(h.images.length,images);assert.equal(p.videoB.currentTime,.5);p.dispose();});
test('无服务端revision时迟到初始GET不能覆盖已提交的角色语言与真实播放器动作',async()=>{
 const h=harness({deferredState:true});const stale=structuredClone(h.model);stale.selection.character='bluefish';
 const latest=structuredClone(h.model);latest.locale='en';latest.characters[0].copy.name='White Dragon';
 h.change(latest);await h.flush();const p=h.sprite();p.playOnce('点击跳跃');await h.ready(p);await h.frame(p,.25);
 const gen=p.gen,draws=h.draws.length;assert.equal(h.win.__codexSkinDebug.character,'white-dragon');
 await h.finishState(stale);
 assert.equal(h.win.__codexSkinDebug.character,'white-dragon');assert.equal(h.win.__codexSkinDebug.action,'点击跳跃');
 assert.equal(p.hit.attrs['aria-label'],'White Dragon');assert.equal(p.stage.classList.contains('codex-skin-active'),true);
 assert.equal(p.gen,gen);assert.equal(p.videoB.currentTime,.25);assert.equal(h.draws.length,draws);p.dispose();
});
test('原版bluefish Q不改播放器时钟，不换成PNG',async()=>{const h=harness();h.model.selection.character='bluefish';await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);assert.equal(h.images.length,0);assert.equal(p.stage.classList.contains('codex-skin-active'),false);assert.equal(h.win.__codexSkinDebug.profile,'original-video');p.dispose();});
test('菜单翻译label保留ID，可信copy同步名字aria和tip，逐帧明确标试作',async()=>{const h=harness({locale:'en'});h.model.characters[0].copy={name:'White Dragon',actionLabels:{'鲸鱼吐泡泡特效':'Dragon bubbles'}};await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);h.win.PetShared.mountContextMenu({tree:[{label:'对话',action:'chat'},{label:'鲸鱼吐泡泡特效',anim:'鲸鱼吐泡泡特效'}]});const tree=h.menu().tree;assert.equal(tree[0].label,'Chat with images');assert.equal(tree[1].label,'Dragon bubbles');assert.equal(tree[1].anim,'鲸鱼吐泡泡特效');assert.match(tree[1].hint,/prototype/);assert.equal(p.hit.attrs['aria-label'],'White Dragon');assert.equal(p.tip.textContent,'White Dragon');assert.equal(p.pet.name,'旧名字');p.dispose();});
test('真实更多菜单只翻根标题，第三方owner和label原文经原onMenuAction回传',async()=>{
 const h=harness({locale:'en'});h.win.CodexLocale.t=key=>require('./codex-locale.cjs').t(key,{},'en');await h.flush();
 const p=h.sprite(),S=h.win.PetShared,calls=[];S.postAction=async(url,body)=>{calls.push({url,body});};
 const more=S.buildMoreBranch([{owner:'动作',label:'对话'},{owner:'动作',label:'形象'},{owner:'形象',label:'更多'}]);
 const original=JSON.stringify(more);S.mountContextMenu({tree:[{label:'打开网站',action:'open-site'},{label:'动作',children:[{label:'写代码',anim:'写代码'}]},more]});
 const tree=h.menu().tree,custom=tree[2];assert.equal(tree[0].label,'Open website');assert.equal(tree[1].label,'Actions');
 assert.equal(tree[1].children[0].label,'Write code');assert.equal(tree[1].children[0].anim,'写代码');assert.equal(custom.label,'More');
 assert.equal(custom.children[0].label,'动作');assert.equal(custom.children[0].children[0].label,'对话');
 assert.equal(custom.children[0].children[1].label,'形象');assert.equal(custom.children[1].label,'更多');
 for(const leaf of [...custom.children[0].children,custom.children[1]])p.onMenuAction(leaf);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
  {url:'/dsh-pet-7340/menu/click',body:{owner:'动作',label:'对话',pet:'main'}},
  {url:'/dsh-pet-7340/menu/click',body:{owner:'动作',label:'形象',pet:'main'}},
  {url:'/dsh-pet-7340/menu/click',body:{owner:'形象',label:'更多',pet:'main'}},
 ]);assert.equal(JSON.stringify(more),original);p.dispose();
});
test('解码失败有界回退，不空白不无限重试',async()=>{const h=harness({failImages:true});await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);assert.equal(h.images.length,1);assert.equal(p.stage.classList.contains('codex-skin-active'),false);p.dispose();});

test('原视频加载失败或10秒超时释放pending后恢复旧有效画面，不永久冻结',async()=>{
 const h=harness();await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);
 p.playOnce('点击跳跃');const target=p.videoA;target.onerror();target.emit('error');await h.flush();
 assert.equal(p.pending,null);await h.frame(p,.5);assert.equal(h.draws.at(-1).args[1],200);
 p.playOnce('点击跳跃');const guard=[...h.timers].find(([,value])=>value.kind==='timeout'&&value.delay===10000);assert.ok(guard);
 h.timers.delete(guard[0]);guard[1].fn();const poll=[...h.timers.values()].find(value=>value.kind==='interval');poll.fn();await h.flush();
 await h.frame(p,.25);assert.equal(h.draws.at(-1).args[1],100);p.dispose();
});

test('连续请求中旧loadeddata被上游gen拒绝，覆盖层也不提交被顶替动作',async()=>{
 const h=harness();await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);
 p.playOnce('点击跳跃');p.playOnce('工作');await h.ready(p);
 assert.equal(h.win.__codexSkinDebug.action,'工作');assert.equal(p.videoA.src,'file:///original/'+encodeURIComponent('工作')+'.webm');p.dispose();
});

test('非once真实视频loop按自身currentTime回绕，暂停及seek不产生独立CSS时钟',async()=>{
 const h=harness();await h.flush();const p=h.sprite();p.switchTo('工作',false);await h.ready(p);
 await h.frame(p,1.25);assert.equal(h.draws.at(-1).args[1],100);p.videoB.pause();await h.flush();
 p.videoB.currentTime=.5;p.videoB.emit('seeked');await h.flush();assert.equal(h.draws.at(-1).args[1],200);
 assert.equal([...h.timers.values()].some(value=>value.kind==='raf'),false);p.dispose();
});

test('上游将进行中循环改为播完即停后，覆盖层以真实loop值收尾',async()=>{
 const h=harness();await h.flush();const p=h.sprite();p.switchTo('工作',false);await h.ready(p);
 p.videoB.loop=false;await h.frame(p,1.25);assert.equal(h.draws.at(-1).args[1],300);p.dispose();
});

test('偶尔变身只切覆盖形态且到期恢复，不重启当前原视频或动作',async()=>{
 const h=harness({mode:'occasional',random:()=>0});await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);
 const originalGen=p.gen;const interval=[...h.timers.values()].find(value=>value.kind==='interval');interval.fn();await h.flush();
 assert.equal(h.win.__codexSkinDebug.form,'sister');const expiry=[...h.timers].find(([,value])=>value.kind==='timeout'&&value.delay===7000);assert.ok(expiry);
 h.now(107000);h.timers.delete(expiry[0]);expiry[1].fn();await h.flush();assert.equal(h.win.__codexSkinDebug.form,'q');assert.equal(p.gen,originalGen);p.dispose();
});

test('原悬浮提示使用可信显示名定位但不改用户配置昵称，图文窗口失败不影响动作链',async()=>{
 const h=harness();await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);p.renderTip();assert.equal(p.tip.textContent,'白龙娘');assert.equal(p.pet.name,'旧名字');
 let calls=0;h.win.codexChatPanel.open=()=>{calls++;throw new Error('window unavailable');};assert.doesNotThrow(()=>p.onMenuAction({action:'chat'}));assert.equal(calls,1);assert.equal(p.anim,'呼吸');p.dispose();
});

for(const character of ['white-dragon','bluefish'])test(character+'真实onWorkTick回idle解除loop，ended恢复原待机链',async()=>{
 const h=harness();h.model.selection.character=character;await h.flush();const p=h.sprite();p.playOnce('呼吸');await h.ready(p);
 p.onWorkTick({state:'working'},1);await h.ready(p);const working=p.videoA;
 p.onWorkTick({state:null},2);assert.equal(working.loop,false);assert.equal(typeof working.onended,'function');
 working.currentTime=working.duration;working.ended=true;working.paused=true;working.onended();
 assert.equal(p.pending.anim,'呼吸');await h.ready(p);assert.equal(h.win.__codexSkinDebug.action,'呼吸');assert.equal(p.videoB.loop,false);p.dispose();
});
