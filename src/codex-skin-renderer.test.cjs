'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),{join}=require('node:path'),vm=require('node:vm'),A=require('./skin-actions.cjs');
// 执行依赖包真实switchTo/playOnce/onWorkTick；测试替身不得替switchTo写anim。
function harness({deferredImages=false,deferredState=false,failImages=false,mode='q',locale='zh-CN',random=()=>1}={}){
 const timers=new Map(),observers=[],images=[],draws=[];let serial=0,clock=100000,changed,menu,initialState;
 const schedule=(fn,kind,delay=0)=>{const id=++serial;timers.set(id,{fn,kind,delay});return id;};
 class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.attrs={};this.classes=new Set();this.style=new Proxy({},{set:(target,key,value)=>{target[key]=value;this.mutate();return true;}});this.classList={add:value=>{this.classes.add(value);this.mutate();},remove:value=>{this.classes.delete(value);this.mutate();},toggle:(value,on)=>on?this.classes.add(value):this.classes.delete(value),contains:value=>this.classes.has(value)};}
  mutate(){for(const o of observers)if(o.targets.has(this))queueMicrotask(()=>{if(!o.closed)o.fn();});}
  appendChild(child){this.children.push(child);return child;} remove(){this.removed=true;} setAttribute(key,value){this.attrs[key]=value;}
  getContext(){return{clearRect(){},drawImage:(...args)=>draws.push({canvas:this,args})};}
 }
 class Video extends Element{
  constructor(){super('video');this.handlers=new Map();Object.assign(this,{currentTime:0,duration:10,readyState:0,paused:true,ended:false,loop:false});}
  addEventListener(name,fn){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(fn);}
  removeEventListener(name,fn){this.handlers.get(name)?.delete(fn);} emit(name){for(const fn of [...(this.handlers.get(name)||[])])fn();}
  load(){this.readyState=0;this.currentTime=0;this.ended=false;} ready(){this.readyState=2;this.emit('loadeddata');}
  play(){this.paused=false;this.emit('play');this.emit('playing');return Promise.resolve();} pause(){this.paused=true;this.emit('pause');}
 }
 class Observer{constructor(fn){this.fn=fn;this.targets=new Set();observers.push(this);}observe(v){this.targets.add(v);}disconnect(){this.closed=true;this.targets.clear();}}
 class Image{set src(url){this.url=url;images.push(this);if(!deferredImages)failImages?this.onerror?.():this.onload?.();}}
 const profile=(file,rects)=>({file,columns:4,rows:1,fps:4,frames:[[0,0],[1,0],[2,0],[3,0]],...(rects?{rects}:{})});
 const manifest=A.normalizeManifest({schemaVersion:1,profiles:{idle:profile('idle.png'),work:profile('work.png'),jump:profile('jump.png',[[10,30,80,70],[110,2,80,70],[210,30,80,70],[310,30,80,70]]),walk:profile('walk.png')},actions:{'呼吸':{profile:'idle',coverage:'dedicated'},'工作':{profile:'work',coverage:'dedicated'},'点击跳跃':{profile:'jump',coverage:'dedicated'},'移动':{profile:'walk',coverage:'dedicated'}}});
 const assets=Object.fromEntries(['idle','work','jump','walk'].flatMap(id=>[id+'.png',id+'-sister.png'].map(file=>[file,{available:true,width:400,height:100,url:'file:///'+file}])));
 const character={id:'white-dragon',label:'白龙娘',copy:{name:'白龙娘',actionLabels:{'鲸鱼吐泡泡特效':'龙尾吹泡泡'}},originalVideo:false,available:{q:true,sister:true,occasional:true},manifest,assets};
 const model={locale,selection:{character:'white-dragon',mode},characters:[character,{...character,id:'bluefish',label:'大肥鱼',originalVideo:true}],catalog:[]};
 const words={'图文对话':'Chat with images','操作任务':'Tasks','形象':'Appearance','Q版':'Chibi','姐姐版':'Adult','偶尔变身':'Occasional transformation','逐帧试作':'Frame prototype','素材未就绪':'Assets not ready','基础动画代用':'Base animation substitute','专属帧待制作':'Dedicated frames pending'};
 const L={setLocale(value){this.locale=value;},t(key){return this.locale==='en'?words[key]||key:key;}};
 const pure={};vm.runInNewContext(readFileSync(join(__dirname,'../node_modules/dsh-pet/runtime/electron-helper/shared-core.js'),'utf8'),pure);
 const shared={...pure.PetShared,mountContextMenu:options=>{menu=options;return options;}};
 const win={CodexSkinActions:A,CodexLocale:L,PetShared:shared,__dshPetDebug:{},codexSkins:{getState:()=>deferredState?new Promise(resolve=>{initialState=resolve;}):Promise.resolve(model),select:async value=>({...model,selection:value}),onChanged:fn=>{changed=fn;return()=>{};}},setTimeout:(fn,delay)=>schedule(fn,'timeout',delay),clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>schedule(fn,'interval',delay),clearInterval:id=>timers.delete(id),requestAnimationFrame:fn=>schedule(fn,'raf'),cancelAnimationFrame:id=>timers.delete(id),queueMicrotask,addEventListener(){},matchMedia:()=>({matches:false}),codexChatPanel:{open(){}}};
 const context={window:win,document:{head:new Element(),createElement:tag=>new Element(tag)},navigator:{language:'zh-CN',platform:'Win32'},MutationObserver:Observer,Image,console:{warn(){},log(){},error(){}},S:shared,BASE:'/dsh-pet-7340',Date:class extends Date{static now(){return clock;}},Math:Object.assign(Object.create(Math),{random}),queueMicrotask,performance:{now:()=>clock},requestAnimationFrame:win.requestAnimationFrame,cancelAnimationFrame:win.cancelAnimationFrame};
 vm.createContext(context);vm.runInContext(readFileSync(join(__dirname,'../node_modules/dsh-pet/runtime/electron-helper/sprite.js'),'utf8')+'\nthis.PetSprite=PetSprite;',context);vm.runInContext(readFileSync(join(__dirname,'../node_modules/dsh-pet/runtime/electron-helper/events.js'),'utf8'),context);
 const P=context.PetSprite;P.prototype.dispose=function(){this.nativeDisposed=true;};vm.runInContext(readFileSync(join(__dirname,'codex-skin-renderer.js'),'utf8'),context);
 function sprite(){const p=Object.create(P.prototype);Object.assign(p,{stage:new Element(),hit:new Element(),tip:new Element(),videoA:new Video(),videoB:new Video(),front:0,pending:null,gen:0,anim:'呼吸',once:true,pet:{id:'main',name:'旧名字',workStatusEnabled:true},assetBase:'file:///original/',_facing:'left',playback:null,pendingSquash:false,pendingMove:null,frozen:false,moveRef:null,throwRef:null,dragState:{active:false},animations:{idle:['呼吸'],clicks:['点击跳跃'],drag:['拖拽'],turn:[],categories:[],moves:{default:{leadSec:2,tailSec:2},actions:[{name:'移动'}]},events:{workStatus:[[],'工作']}},stopMove(){this.moveRef=null;},reportPlayback(id,state){this.report={id,state};},renderBubble(){},startSquash(){this.squashed=true;},closeMenu(){this.menuOpen=false;}});p.videoA.classList.add('is-front');return p;}
 const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
 return{sprite,model,win,timers,images,draws,flush,menu:()=>menu,change:value=>changed(value),now:value=>{clock=value;},ready:async p=>{(p.front===0?p.videoB:p.videoA).ready();await flush();},frame:async(p,seconds)=>{const v=p.front===0?p.videoA:p.videoB;v.currentTime=seconds;for(const[id,value]of[...timers])if(value.kind==='raf'){timers.delete(id);value.fn();}await flush();},finishImage:async image=>{image.onload?.();await flush();},finishState:async value=>{initialState(value);await flush();}};
}

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
