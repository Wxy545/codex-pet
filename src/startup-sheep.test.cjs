'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
function harness({locale='en',reason='preview',target=async()=>({ready:true}),audio=false,audioFailure=false,heldPlay=false,assets}={}){
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.listeners=new Map();this.style={};this.dataset={};this.attributes={};this.textContent='';const c=new Set();this.classList={add:x=>c.add(x),remove:x=>c.delete(x),contains:x=>c.has(x)};}
  appendChild(c){this.children.push(c);c.parent=this;return c;}remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];if(k==='src')this.src='';}
  addEventListener(k,f){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(f);}removeEventListener(k,f){this.listeners.get(k)?.delete(f);}emit(k,event={}){for(const f of[...(this.listeners.get(k)||[])])f(event);}
  set innerHTML(v){this.html=v;this.placeholder=new Element('div');}querySelector(){return this.placeholder;}
 }
 const document=new Element('document'),window=new Element('window'),elements=[],frames=new Map(),timers=new Map(),stats={ready:0,finish:0,target:0},audios=[],gate=deferred();let now=0,id=0;
 document.body=new Element('body');document.documentElement={};document.createElement=tag=>{const e=new Element(tag);elements.push(e);if(tag==='video')Object.assign(e,{src:'',muted:false,readyState:0,currentTime:0,duration:3.542,paused:true,plays:0,play(){this.plays++;this.paused=false;return heldPlay?gate.promise:Promise.resolve();},pause(){this.paused=true;},load(){this.readyState=0;this.currentTime=0;this.duration=this.src.includes('working')?3.917:this.src.includes('greeting')?3.084:3.542;}});return e;};
 window.matchMedia=()=>({matches:false});
 class Audio{
  constructor(){this.currentTime=0;this.destination={};this.gains=[];this.voices=[];this.closed=0;this.suspends=0;audios.push(this);}
  createGain(){const p={targets:[],setTargetAtTime(v){this.targets.push(v);},setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}};const g={gain:p,connect(){}};this.gains.push(g);return g;}
  createOscillator(){if(audioFailure)throw Error('audio-failed');const v={frequency:{setValueAtTime(){}},connect(){},start(){},stop(){this.stopped=true;}};this.voices.push(v);return v;}
  resume(){return Promise.resolve();}close(){this.closed++;return Promise.resolve();}
 }
 if(audio)window.AudioContext=Audio;
 const api={ready:async()=>{stats.ready++;},finish:async()=>{stats.finish++;},target:async()=>{stats.target++;return target();}};
 const context={window,document,innerWidth:1280,innerHeight:800,performance:{now:()=>now},console,Math,Promise,setTimeout:(fn,ms)=>{const n=++id;timers.set(n,{fn,due:now+ms});return n;},clearTimeout:n=>timers.delete(n),requestAnimationFrame:fn=>{const n=++id;frames.set(n,fn);return n;},cancelAnimationFrame:n=>frames.delete(n)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'startup-sheep.js'),'utf8'),context);
 const control=window.CodexStartupSheep.play({api,value:{host:'workbuddy',sheep:true,locale,reason,assets:assets||Object.fromEntries(['idle','working','greeting'].map(k=>[k,'file:///curly-sheep/q-'+k+'.webm'])),copy:{skip:locale==='zh-CN'?'跳过':'Skip'}}});
 const videos=elements.filter(e=>e.tagName==='video'),root=elements.find(e=>e.className==='sheep-startup'),pane=elements.find(e=>e.className==='sheep-app'),buttons=elements.filter(e=>e.tagName==='button');
 const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
 const decode=async slot=>{videos[slot].readyState=2;videos[slot].emit('loadeddata');await flush();};
 const tick=async(slot,time)=>{if(slot!==undefined)videos[slot].currentTime=time;const entry=frames.entries().next().value;if(entry){frames.delete(entry[0]);entry[1](now);}await flush();};
 const advance=async ms=>{const end=now+ms;for(let i=0;i<100;i++){const entry=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!entry)break;now=entry[1].due;timers.delete(entry[0]);entry[1].fn();await flush();}now=end;};
 const ending=async()=>{await decode(0);videos[0].currentTime=3.542;videos[0].emit('ended');await decode(1);videos[1].currentTime=3.917;videos[1].emit('ended');await decode(0);videos[0].currentTime=3.084;videos[0].emit('ended');await flush();};
 return{control,window,document,videos,root,pane,buttons,elements,stats,frames,timers,audios,gate,flush,decode,tick,advance,ending,get now(){return now;}};
}

test('卷卷首帧play成功才ready，只用羊片且完整保留原视频比例，英文无龙娘文字',async()=>{
 const h=harness();assert.equal(h.stats.ready,0);assert.equal(h.videos[0].src,'file:///curly-sheep/q-idle.webm');await h.decode(0);await h.decode(0);assert.equal(h.stats.ready,1);assert.equal(h.videos[0].plays,1);
 assert.equal(h.document.title,'Codex Pet · WorkBuddy');assert.equal(h.buttons[1].textContent,'Skip');assert.equal(h.pane.placeholder.textContent,'Message WorkBuddy');assert.doesNotMatch(h.pane.html,/ChatGPT|dragon/i);
 assert.doesNotMatch(h.elements.map(e=>e.textContent).join(''),/[\u3400-\u9fff]/);assert.ok(h.videos.every(v=>v.muted));assert.match(fs.readFileSync(path.join(__dirname,'startup-sheep.css'),'utf8'),/object-fit:contain/);h.control.finish();
});

test('待机跟真实视频时钟，工作和招呼自然EOS后才切段，180ms交接保留旧帧',async()=>{
 const h=harness();await h.decode(0);await h.advance(5000);await h.tick(0,.3);assert.equal(h.videos[1].src,'');await h.tick(0,3.4);assert.equal(h.videos[1].src,'');h.videos[0].emit('ended');assert.match(h.videos[1].src,/q-working.webm$/);
 await h.decode(1);await h.advance(180);await h.tick(1,.2);assert.equal(h.videos[0].paused,true);assert.equal(h.videos[1].style.opacity,'1');assert.equal(h.root.dataset.phase,'working');
 await h.tick(1,3.7);assert.match(h.videos[0].src,/q-idle.webm$/);h.videos[1].emit('ended');assert.match(h.videos[0].src,/q-greeting.webm$/);await h.decode(0);await h.tick(0,2);assert.equal(h.root.dataset.phase,'greeting');assert.ok(Number(h.pane.style.opacity)>0);h.control.finish();
});

test('卷卷预览最后一段真实结束后铺窗揭幕，3秒内结束且不探测目标',async()=>{
 const h=harness();await h.ending();await h.advance(1550);await h.tick(0,3.084);assert.equal(h.root.dataset.phase,'handoff');assert.match(h.pane.style.transform,/scale\(1\)/);await h.advance(780);await h.tick(0,3.084);assert.equal(h.stats.finish,1);assert.equal(h.stats.target,0);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
});

test('WorkBuddy真实启动等正确目标，未就绪或永久挂起仍独立20秒退场',async()=>{
 let ready=false;const h=harness({reason:'workbuddy',locale:'zh-CN',target:async()=>({ready})});await h.ending();assert.equal(h.buttons[1].textContent,'跳过 · Esc');assert.equal(h.pane.placeholder.textContent,'向 WorkBuddy 发送消息');
 await h.advance(1550);await h.tick(0,3.084);await h.tick(0,3.084);assert.equal(h.stats.target,1);assert.equal(h.root.dataset.phase,'window');ready=true;await h.advance(650);await h.tick(0,3.084);await h.tick(0,3.084);assert.equal(h.root.dataset.phase,'handoff');h.control.finish();
 const pending=deferred(),blocked=harness({reason:'workbuddy',target:()=>pending.promise});await blocked.ending();await blocked.advance(1550);await blocked.tick(0,3.084);await blocked.advance(20000-blocked.now);await blocked.tick(0,3.084);assert.equal(blocked.root.dataset.phase,'handoff');await blocked.advance(780);await blocked.tick(0,3.084);assert.equal(blocked.stats.finish,1);pending.resolve({ready:true});await blocked.flush();assert.equal(blocked.stats.finish,1);
});

test('跳过和卸载只关闭一次并清两个视频、rAF、音频和监听，迟到play不复活',async()=>{
 const h=harness({heldPlay:true,audio:true});await h.decode(0);h.buttons[1].emit('click');h.gate.resolve();await h.flush();h.window.emit('beforeunload');h.document.emit('keydown',{key:'Escape'});await h.advance(30000);await h.tick();assert.equal(h.stats.ready,0);assert.equal(h.stats.finish,1);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert.ok(h.videos.every(v=>!v.src&&v.paused));assert.ok(h.elements.every(e=>[...e.listeners.values()].every(s=>s.size===0)));
 const playing=harness({audio:true});await playing.decode(0);playing.control.finish();await playing.flush();assert.equal(playing.audios[0].closed,1);assert.ok(playing.audios[0].voices.every(v=>v.stopped));
});

test('缺羊片、坏媒体时长和解码失败有界关闭，音频失败不截断画面，静音不暂停时钟',async()=>{
 const missing=harness({assets:{idle:'file:///curly-sheep/q-idle.webm'}});await missing.flush();assert.equal(missing.stats.finish,1);assert.equal(missing.stats.ready,0);
 const bad=harness();bad.videos[0].readyState=2;bad.videos[0].duration=30;bad.videos[0].emit('loadeddata');await bad.flush();assert.equal(bad.stats.finish,1);
 const broken=harness();broken.videos[0].emit('error');await broken.flush();assert.equal(broken.stats.finish,1);
 const failed=harness({audio:true,audioFailure:true});await failed.decode(0);assert.equal(failed.stats.ready,1);assert.equal(failed.stats.finish,0);assert.equal(failed.buttons[0].textContent,'Sound off');failed.control.finish();
 const muted=harness({audio:true});await muted.decode(0);muted.buttons[0].emit('click');assert.equal(muted.audios[0].gains[0].gain.targets.at(-1),0);assert.equal(muted.audios[0].suspends,0);muted.videos[0].emit('ended');await muted.decode(1);assert.equal(muted.root.dataset.phase,'working');muted.control.finish();
});
