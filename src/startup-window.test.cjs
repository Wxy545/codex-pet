'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(){
 class Node{constructor(){this.listeners=new Map();this.textContent='';this.classList={add:()=>{},toggle:()=>{}};}addEventListener(key,fn){if(!this.listeners.has(key))this.listeners.set(key,new Set());this.listeners.get(key).add(fn);}removeEventListener(key,fn){this.listeners.get(key)?.delete(fn);}emit(key,value={}){for(const fn of this.listeners.get(key)||[])fn(value);}}
 const nodes=Object.fromEntries(['scene','dragon','particles','subject','detail','skip','ready-label','status'].map(id=>[id,new Node()])),video=nodes.dragon;
 let plays=0,pauses=0,ready=0,finishes=0,id=0;const timers=new Map(),frames=new Map(),window=new Node(),document=new Node();
 video.readyState=0;video.play=async()=>{plays++;};video.pause=()=>{pauses++;};video.load=()=>{};
 nodes.particles.getContext=()=>({clearRect(){},beginPath(){},arc(){},fill(){}});
 document.documentElement={};document.getElementById=id=>nodes[id];document.querySelectorAll=()=>Array.from({length:4},()=>new Node());
 window.startupScene={get:async()=>({video:'file:///local/q-idle.webm',durationMs:7600,locale:'en',copy:{subject:'Dragon Girl',detail:'WHITE HORNS',skip:'Skip',status:['LINK','FILE','WINGS','READY']}}),ready:async()=>{ready++;},finish:async()=>{finishes++;}};
 const context={window,document,innerWidth:1280,innerHeight:800,Math,console,setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;},clearTimeout:key=>timers.delete(key),requestAnimationFrame:fn=>{const key=++id;frames.set(key,fn);return key;},cancelAnimationFrame:key=>frames.delete(key)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'startup-window.js'),'utf8'),context);
 const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
 return{window,document,nodes,video,timers,frames,flush,get stats(){return{plays,pauses,ready,finishes};}};
}
test('演出页面等真实媒体可用才显示，英文内容无中文解释，点击关闭清理时钟与监听',async()=>{
 const h=harness();await h.flush();assert.equal(h.stats.ready,0);assert.equal(h.stats.plays,0);assert.equal(h.video.muted,true);assert.equal(h.video.loop,true);assert.match(h.video.src,/q-idle\.webm$/);
 h.video.readyState=2;h.video.emit('loadeddata');await h.flush();assert.equal(h.stats.ready,1);assert.equal(h.stats.plays,1);assert.equal(h.document.documentElement.lang,'en');assert.equal(h.nodes.subject.textContent,'Dragon Girl');assert.equal(h.nodes.skip.textContent,'Skip · Esc');assert.equal(h.nodes.status.textContent,'LINK');assert.ok([...h.timers.values()].some(timer=>timer.ms===7600));
 h.document.emit('pointerup');await h.flush();assert.equal(h.stats.finishes,1);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);assert.equal(h.document.listeners.get('pointerup').size,0);assert.equal(h.window.listeners.get('resize').size,0);
 h.video.emit('loadeddata');await h.flush();assert.equal(h.stats.ready,1);
});
test('演出页面媒体失败与Esc均可有界退出，重复事件不重复完成',async()=>{
 const h=harness();await h.flush();h.video.emit('error');h.document.emit('keydown',{key:'Escape'});await h.flush();assert.equal(h.stats.finishes,1);assert.equal(h.stats.ready,0);
 const other=harness();await other.flush();other.video.readyState=2;other.video.emit('loadeddata');await other.flush();other.document.emit('keydown',{key:'Escape'});await other.flush();assert.equal(other.stats.finishes,1);assert.equal(other.timers.size,0);
});
