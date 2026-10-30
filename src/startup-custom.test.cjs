'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function harness({duration=6,reason='preview',target=async()=>({ready:true}),heldPlay=false}={}){
 class Element{constructor(tag){this.tagName=tag;this.children=[];this.style={};this.dataset={};this.attributes={};this.listeners=new Map();this.classList={add(){},remove(){}};}appendChild(child){this.children.push(child);child.parent=this;return child;}remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){if(k==='src')this.src='';delete this.attributes[k];}addEventListener(k,fn){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(fn);}removeEventListener(k,fn){this.listeners.get(k)?.delete(fn);}emit(k,value={}){for(const fn of [...this.listeners.get(k)||[]])fn(value);}}
 const document=new Element('document'),window=new Element('window'),elements=[],timers=new Map(),frames=new Map(),stats={ready:0,finish:0,target:0};let now=0,id=0,resolvePlay;const playPromise=new Promise(resolve=>{resolvePlay=resolve;});
 document.body=new Element('body');document.documentElement={};document.createElement=tag=>{const e=new Element(tag);elements.push(e);if(tag==='video')Object.assign(e,{duration,videoWidth:1920,videoHeight:1080,readyState:0,currentTime:0,paused:true,plays:0,load(){},play(){this.paused=false;this.plays++;return heldPlay?playPromise:Promise.resolve();},pause(){this.paused=true;}});return e;};window.matchMedia=()=>({matches:false});
 const api={ready:async()=>{stats.ready++;},finish:async()=>{stats.finish++;},target:async()=>{stats.target++;return target();}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'startup-custom.js'),'utf8'),{window,document,performance:{now:()=>now},requestAnimationFrame:fn=>{const key=++id;frames.set(key,fn);return key;},cancelAnimationFrame:key=>frames.delete(key),setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,due:now+ms});return key;},clearTimeout:key=>timers.delete(key)});
 const control=window.CodexStartupCustom.play({api,value:{video:'file:///verified/custom.mp4',custom:true,theme:'deepseek',brand:'DeepSeek',locale:'en',reason,host:'workbuddy',durationMs:duration*1000}}),video=elements.find(e=>e.tagName==='video');
 const flush=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
 const advance=async ms=>{const end=now+ms;for(let i=0;i<50;i++){const next=[...timers].filter(([,timer])=>timer.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].fn();await flush();}now=end;};
 const tick=async time=>{video.currentTime=time;const next=frames.entries().next().value;if(next){frames.delete(next[0]);next[1](now);}await flush();};
 return{control,video,stats,window,document,elements,timers,frames,flush,advance,tick,resolvePlay,decode:async()=>{video.readyState=2;video.emit('loadeddata');await flush();}};
}
test('自定义片完整原比例、单次播放并保留原音轨，解码成功后才显示',async()=>{
 const h=harness({duration:60});assert.equal(h.stats.ready,0);assert.equal(h.video.loop,false);assert.equal(h.video.src,'file:///verified/custom.mp4');await h.decode();await h.decode();assert.equal(h.video.plays,1);assert.equal(h.stats.ready,1);assert.equal(h.video.muted,false);assert.ok(h.video.volume>0);h.control.finish();await h.flush();assert.equal(h.video.src,'');assert.equal(h.video.volume,0);assert.equal(h.video.paused,true);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
});
test('预览真实EOS后退场，不探测或聚焦宿主；重复结束只清理一次',async()=>{
 const h=harness();await h.decode();h.video.emit('ended');h.video.emit('ended');await h.tick(6);await h.advance(500);await h.tick(6);assert.equal(h.stats.finish,1);assert.equal(h.stats.target,0);assert.equal(h.document.body.children.length,0);
});
test('实际启动在EOS后等待真实目标，主题不决定目标且永久等待有界退出',async()=>{
 const h=harness({reason:'workbuddy',target:()=>new Promise(()=>{})});await h.decode();h.video.emit('ended');await h.tick(6);assert.equal(h.stats.target,1);await h.advance(5500);await h.tick(6);await h.advance(500);await h.tick(6);assert.equal(h.stats.finish,1);
});
test('坏时长、无首帧或播放无进度均退出，Esc与迟到play不能复活窗口',async()=>{
 const invalid=harness({duration:61});await invalid.decode();assert.equal(invalid.stats.finish,1);assert.equal(invalid.stats.ready,0);
 const load=harness();await load.advance(8000);assert.equal(load.stats.finish,1);
 const stalled=harness();await stalled.decode();await stalled.advance(8500);await stalled.tick(0);assert.equal(stalled.stats.finish,1);
 const late=harness({heldPlay:true});await late.decode();late.document.emit('keydown',{key:'Escape'});late.resolvePlay();await late.flush();assert.equal(late.stats.finish,1);assert.equal(late.stats.ready,0);assert.equal(late.video.paused,true);assert.equal(late.frames.size,0);
});
