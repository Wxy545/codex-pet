'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return {promise,resolve,reject}; }
function harness({locale='en',reason='preview',target=async()=>({ready:true}),audio=false,audioFailure=false,heldPlay=false,duration=8,reduced=false}={}) {
 class Element {
  constructor(tag) { this.tagName=tag;this.children=[];this.listeners=new Map();this.style={};this.dataset={};this.attributes={};this.textContent='';const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)}; }
  appendChild(child){this.children.push(child);child.parent=this;return child;} remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  setAttribute(k,v){this.attributes[k]=v;} removeAttribute(k){delete this.attributes[k];if(k==='src')this.src='';}
  addEventListener(k,fn){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(fn);} removeEventListener(k,fn){this.listeners.get(k)?.delete(fn);} emit(k,value={}){for(const fn of [...(this.listeners.get(k)||[])])fn(value);}
  set innerHTML(value){this.html=value;this.placeholder=new Element('div');} querySelector(){return this.placeholder;}
 }
 const document=new Element('document'),window=new Element('window'),elements=[],timers=new Map(),frames=new Map(),stats={ready:0,finish:0,target:0},audios=[];let now=0,id=0,playGate=deferred();
 document.body=new Element('body');document.documentElement={};document.createElement=tag=>{const e=new Element(tag);elements.push(e);if(tag==='video')Object.assign(e,{src:'',muted:false,loop:true,readyState:0,duration,currentTime:0,videoWidth:1920,videoHeight:1080,paused:true,plays:0,loads:0,play(){this.plays++;this.paused=false;return heldPlay?playGate.promise:Promise.resolve();},pause(){this.paused=true;},load(){this.loads++;}});return e;};
 window.matchMedia=()=>({matches:reduced});
 class Audio {
  constructor(){this.currentTime=0;this.sampleRate=48000;this.destination={};this.gains=[];this.voices=[];this.resumes=0;this.suspends=0;this.closed=0;audios.push(this);}
  createGain(){const param={targets:[],setTargetAtTime(v,at){this.targets.push({v,at});},setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}};const out={gain:param,connect(){}};this.gains.push(out);return out;}
  createOscillator(){if(audioFailure)throw Error('device unavailable');const out={frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},start(){},stop(){this.stopped=true;}};this.voices.push(out);return out;}
  createBuffer(_channels,n){return{getChannelData:()=>new Float32Array(n)};} createBufferSource(){const out={connect(){},start(){},stop(){this.stopped=true;}};this.voices.push(out);return out;}
  createBiquadFilter(){return{frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},Q:{value:0},connect(){}};} resume(){this.resumes++;return Promise.resolve();} suspend(){this.suspends++;return Promise.resolve();} close(){this.closed++;return Promise.resolve();}
 }
 if(audio)window.AudioContext=Audio;
 const api={ready:async()=>{stats.ready++;},finish:async()=>{stats.finish++;},target:async()=>{stats.target++;return target();}};
 const context={window,document,innerWidth:1280,innerHeight:800,performance:{now:()=>now},console,Math,Float32Array,setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,due:now+ms});return key;},clearTimeout:key=>timers.delete(key),requestAnimationFrame:fn=>{const key=++id;frames.set(key,fn);return key;},cancelAnimationFrame:key=>frames.delete(key)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'startup-cinema.js'),'utf8'),context);
 const control=window.CodexStartupCinema.play({api,value:{film:true,video:'file:///local/white-dragon-cinematic.webm',locale,reason,copy:{skip:locale==='zh-CN'?'跳过':'Skip'}}});
 const root=elements.find(e=>e.className==='cinema'),video=elements.find(e=>e.tagName==='video'),application=elements.find(e=>e.className==='cinema-app'),buttons=elements.filter(e=>e.tagName==='button');
 const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
 const decode=async()=>{video.readyState=2;video.emit('loadeddata');await flush();};
 const tick=async(time=video.currentTime)=>{video.currentTime=time;const task=frames.entries().next().value;if(task){frames.delete(task[0]);task[1](now);}await flush();};
 const advance=async ms=>{const end=now+ms;for(let i=0;i<100;i++){const entry=[...timers].filter(([,v])=>v.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!entry)break;now=entry[1].due;timers.delete(entry[0]);entry[1].fn();await flush();}now=end;};
 return{root,video,application,buttons,window,document,elements,timers,frames,stats,audios,control,flush,decode,tick,advance,playGate,get now(){return now;}};
}
test('电影首帧解码并成功play才显示，只播一次，英文窗口与预览按钮无中文/假Esc提示',async()=>{
 const h=harness();assert.equal(h.stats.ready,0);assert.equal(h.video.loop,false);assert.equal(h.video.muted,true);assert.equal(h.video.src,'file:///local/white-dragon-cinematic.webm');
 await h.decode();await h.decode();assert.equal(h.stats.ready,1);assert.equal(h.video.plays,1);assert.equal(h.document.documentElement.lang,'en');assert.equal(h.buttons[1].textContent,'Skip');assert.equal(h.application.placeholder.textContent,'Message ChatGPT');assert.equal(h.root.dataset.phase,'film');
 assert.equal(h.document.body.classList.contains('cinema-active'),true);assert.ok(!/[\u3400-\u9fff]/.test(h.elements.map(e=>e.textContent).join('')));
});
test('阶段和音效只跟电影currentTime，墙钟前进不会提前显现玻璃窗',async()=>{
 const h=harness({audio:true});await h.decode();await h.tick(2);const voices=h.audios[0].voices.length;await h.advance(5000);await h.tick(2);
 assert.equal(h.application.style.opacity,'0');assert.equal(h.audios[0].voices.length,voices);await h.tick(4.2);assert.ok(Number(h.application.style.opacity)>0);const built=h.audios[0].voices.length;await h.tick(4.2);assert.equal(h.audios[0].voices.length,built);
});
test('真实EOS启动程序窗口推进，预览不探测目标且3秒内揭幕结束',async()=>{
 const h=harness();await h.decode();await h.tick(7.9);assert.ok(Number(h.application.style.opacity)>0);h.video.currentTime=8;h.video.emit('ended');h.video.emit('ended');
 await h.advance(1450);await h.tick(8);assert.match(h.application.style.transform,/scale\(1\)/);assert.equal(h.root.dataset.phase,'window');
 await h.advance(500);await h.tick(8);assert.equal(h.root.dataset.phase,'handoff');await h.advance(780);await h.tick(8);assert.equal(h.stats.finish,1);assert.equal(h.stats.target,0);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
});
test('Codex窗口未就绪时保持落稳画面，ready后只退出一次',async()=>{
 let ready=false;const h=harness({reason:'codex',locale:'zh-CN',target:async()=>({ready})});await h.decode();assert.equal(h.buttons[1].textContent,'跳过 · Esc');h.video.currentTime=8;h.video.emit('ended');
 await h.advance(2000);await h.tick(8);assert.equal(h.stats.target,1);assert.notEqual(h.root.dataset.phase,'handoff');ready=true;await h.advance(650);await h.tick(8);await h.tick(8);assert.equal(h.root.dataset.phase,'handoff');await h.advance(780);await h.tick(8);assert.equal(h.stats.finish,1);
});
test('目标IPC永不兑现或媒体卡顿时独立20秒上限仍退场',async()=>{
 for(const eof of [false,true]){const pending=deferred(),h=harness({reason:'codex',target:()=>pending.promise});await h.decode();if(eof){h.video.currentTime=8;h.video.emit('ended');await h.advance(2000);await h.tick(8);}
  await h.advance(20000-h.now);await h.tick(eof?8:0);assert.equal(h.root.dataset.phase,'handoff');await h.advance(780);await h.tick(eof?8:0);assert.equal(h.stats.finish,1);pending.resolve({ready:true});await h.flush();assert.equal(h.stats.finish,1);
 }
});
test('跳过清除媒体、合成声音、按钮与窗口监听，迟到play不能回报ready',async()=>{
 const h=harness({heldPlay:true,audio:true});await h.decode();h.buttons[1].emit('click');h.playGate.resolve();await h.flush();h.document.emit('keydown',{key:'Escape'});h.window.emit('beforeunload');await h.advance(30000);await h.tick(8);
 assert.equal(h.stats.ready,0);assert.equal(h.stats.finish,1);assert.equal(h.video.src,'');assert.equal(h.video.paused,true);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);assert.ok(h.elements.every(e=>[...e.listeners.values()].every(s=>s.size===0)));
 const playing=harness({audio:true});await playing.decode();await playing.tick(2);playing.control.finish();await playing.flush();assert.equal(playing.audios[0].closed,1);assert.ok(playing.audios[0].voices.every(v=>v.stopped));
});
test('坏片、异常时长、音频失败均有界处理，音频失败不截断有效电影',async()=>{
 const bad=harness({duration:30});await bad.decode();assert.equal(bad.stats.ready,0);assert.equal(bad.stats.finish,1);
 const broken=harness();broken.video.emit('error');broken.document.emit('keydown',{key:'Escape'});await broken.flush();assert.equal(broken.stats.finish,1);
 const audio=harness({audio:true,audioFailure:true});await audio.decode();await audio.tick(0);assert.equal(audio.audios[0].closed,1);assert.equal(audio.buttons[0].textContent,'Sound off');assert.equal(audio.stats.finish,0);audio.control.finish();
});
test('静音只控制gain，缓冲时静音，恢复播放不暂停合成时钟',async()=>{
 const h=harness({audio:true});await h.decode();await h.tick(1);const audio=h.audios[0];h.buttons[0].emit('click');assert.equal(h.buttons[0].textContent,'Sound off');assert.equal(audio.gains[0].gain.targets.at(-1).v,0);assert.equal(audio.suspends,0);
 h.buttons[0].emit('click');h.video.emit('waiting');assert.equal(audio.gains[0].gain.targets.at(-1).v,0);h.video.emit('playing');assert.equal(audio.gains[0].gain.targets.at(-1).v,3.15);assert.equal(audio.suspends,0);h.control.finish();
});

test('实片擦镜2.5秒触发构建，3.8秒接窗音，4.45秒完全显现且均不重播',async()=>{
 const h=harness({audio:true});await h.decode();await h.tick(2.49);const before=h.audios[0].voices.length;
 await h.tick(2.5);assert.equal(h.audios[0].voices.length,before+4);await h.tick(3.79);assert.equal(h.application.style.opacity,'0');
 await h.tick(3.8);assert.equal(h.audios[0].voices.length,before+7);await h.tick(4.45);assert.equal(h.application.style.opacity,'1');
 const after=h.audios[0].voices.length;await h.tick(4.45);assert.equal(h.audios[0].voices.length,after);h.control.finish();
});

test('任意7.542秒短片的玻璃窗持续生长和转正，EOS前不提前全屏或静止等待',async()=>{
 const duration=181/24,h=harness({duration});await h.decode();await h.tick(3.8);
 const transform=()=>h.application.style.transform,scale=()=>Number(transform().match(/scale\(([^)]+)\)/)[1]),yaw=()=>Number(transform().match(/rotateY\(([^)]+)deg\)/)[1]);
 assert.equal(scale(),.28);assert.equal(yaw(),-24);await h.tick(5.5);const middle=scale();assert.ok(middle>.28&&middle<.35);assert.ok(yaw()>-24&&yaw()<-12);
 await h.tick(duration);assert.ok(Math.abs(scale()-.35)<1e-12);assert.equal(yaw(),-12);assert.equal(h.root.dataset.phase,'film');assert.equal(h.stats.finish,0);h.control.finish();
});
