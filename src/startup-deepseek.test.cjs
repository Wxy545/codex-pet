'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
function fixture({locale='en',reason='preview',host='codex',target=async()=>({ready:true}),ready=async()=>{},audio=false,audioFailure=false,canvasFailure=false,reduced=false}={}){
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.listeners=new Map();this.style={setProperty(name,value){this[name]=value;}};this.dataset={};this.attributes={};this.textContent='';const values=new Set();this.classList={add:value=>values.add(value),remove:value=>values.delete(value),contains:value=>values.has(value)};}
  appendChild(child){this.children.push(child);child.parent=this;}append(...children){children.forEach(child=>this.appendChild(child));}remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,handler){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(handler);}removeEventListener(name,handler){this.listeners.get(name)?.delete(handler);}emit(name,event={}){for(const handler of [...this.listeners.get(name)||[]])handler(event);}
 }
 const document=new Element('document'),window=new Element('window'),elements=[],timers=new Map(),frames=new Map(),audios=[],stats={ready:0,finish:0,target:0,paint:0};let now=0,sequence=0;
 document.body=new Element('body');document.documentElement={};
 const gradient={addColorStop(){}};
 const drawing=new Proxy({createRadialGradient:()=>gradient,createLinearGradient:()=>gradient},{get(object,key){if(key in object)return object[key];return(..._args)=>{stats.paint++;};},set(object,key,value){object[key]=value;return true;}});
 document.createElement=tag=>{const node=new Element(tag);elements.push(node);if(tag==='canvas')node.getContext=()=>canvasFailure?null:drawing;return node;};
 window.matchMedia=()=>({matches:reduced});window.innerWidth=1280;window.innerHeight=800;window.devicePixelRatio=2;
 class Audio{
  constructor(){this.currentTime=0;this.sampleRate=24000;this.destination={};this.closed=0;this.voices=[];this.gains=[];audios.push(this);}
  createGain(){const p={targets:[],setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(value){this.targets.push(value);}};const node={gain:p,connect(){},disconnect(){}};this.gains.push(node);return node;}
  createOscillator(){if(audioFailure)throw Error('device unavailable');const node={frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){},start(){},stop(){this.stopped=true;}};this.voices.push(node);return node;}
  createBuffer(_channels,size){return{getChannelData:()=>new Float32Array(size)};}createBufferSource(){const node={connect(){},disconnect(){},start(){},stop(){this.stopped=true;}};this.voices.push(node);return node;}
  createBiquadFilter(){return{frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},Q:{value:0},connect(){},disconnect(){}};}resume(){return Promise.resolve();}close(){this.closed++;return Promise.resolve();}
 }
 if(audio)window.AudioContext=Audio;
 const api={ready:async()=>{stats.ready++;return ready();},target:async(...args)=>{stats.target++;assert.deepEqual(args,[]);return target();},finish:async()=>{stats.finish++;}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'startup-deepseek.js'),'utf8'),{window,document,innerWidth:1280,innerHeight:800,performance:{now:()=>now},Math,Float32Array,setTimeout:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,due:now+delay});return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{const id=++sequence;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
 const control=window.CodexStartupDeepseek.play({api,value:{locale,reason,host,brand:'DeepSeek'}});
 const flush=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
 const advance=async delay=>{const end=now+delay;for(let i=0;i<100;i++){const entry=[...timers].filter(([,value])=>value.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!entry)break;now=entry[1].due;timers.delete(entry[0]);entry[1].fn();await flush();}now=end;};
 const tick=async()=>{const entry=frames.entries().next().value;if(entry){frames.delete(entry[0]);entry[1](now);}await flush();};
 return{control,window,document,elements,frames,timers,audios,stats,flush,advance,tick,root:elements.find(node=>node.className==='deepseek-intro'),buttons:elements.filter(node=>node.tagName==='button')};
}

test('DeepSeek程序演出先绘制有效画布再ready，中英控件正确且预览不探测目标',async()=>{
 for(const locale of ['en','zh-CN']){const f=fixture({locale});await f.flush();assert.equal(f.stats.ready,1);await f.tick();assert.ok(f.stats.paint>0);assert.equal(f.document.title,'Codex Pet · DeepSeek');assert.equal(f.buttons[1].textContent,locale==='en'?'Skip':'跳过');await f.advance(7000);assert.equal(f.stats.finish,1);assert.equal(f.stats.target,0);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);if(locale==='en')assert.doesNotMatch(f.elements.map(node=>node.textContent).join(''),/[\u3400-\u9fff]/);}
});

test('目标未知或IPC永久挂起仍按7秒结束，视觉品牌不会改变实际宿主请求',async()=>{
 const pending=deferred(),f=fixture({host:'workbuddy',reason:'workbuddy',target:()=>pending.promise});await f.flush();await f.advance(4600);assert.equal(f.stats.target,1);await f.advance(2400);assert.equal(f.stats.finish,1);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);pending.resolve({ready:true});await f.flush();assert.equal(f.stats.finish,1);
 const unknown=fixture({host:'unknown',reason:'manual',target:async()=>{throw Error('unknown');}});await unknown.flush();await unknown.advance(7000);assert.equal(unknown.stats.finish,1);assert.equal(unknown.stats.target,0);
});

test('Escape、跳过和卸载幂等清理RAF、定时器、音轨和监听',async()=>{
 const f=fixture({audio:true});await f.flush();f.document.emit('keydown',{key:'Escape'});f.buttons[1].emit('click');f.window.emit('beforeunload');await f.advance(30000);await f.tick();assert.equal(f.stats.finish,1);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(f.audios[0].closed,1);assert.ok(f.audios[0].voices.every(node=>node.stopped));assert.ok(f.elements.every(node=>[...node.listeners.values()].every(listeners=>listeners.size===0)));assert.equal(f.document.body.children.length,0);
});

test('坏画布不显示，ready永久挂起有看门狗且迟到兑现不会复活',async()=>{
 const broken=fixture({canvasFailure:true});await broken.flush();assert.equal(broken.stats.ready,0);assert.equal(broken.stats.finish,1);assert.equal(broken.frames.size,0);assert.equal(broken.timers.size,0);
 const pending=deferred(),held=fixture({ready:()=>pending.promise});await held.flush();await held.advance(8500);assert.equal(held.stats.finish,1);pending.resolve();await held.flush();assert.equal(held.frames.size,0);assert.equal(held.stats.finish,1);
 const lost=fixture();await lost.flush();lost.elements.find(node=>node.tagName==='canvas').emit('contextlost');assert.equal(lost.stats.finish,1);assert.equal(lost.frames.size,0);assert.equal(lost.timers.size,0);
});

test('音频失败不截断画面，静音只改gain，减弱动态仍正常结束',async()=>{
 const failed=fixture({audio:true,audioFailure:true});await failed.flush();assert.equal(failed.stats.finish,0);assert.equal(failed.buttons[0].textContent,'Sound off');failed.control.finish();
 const muted=fixture({audio:true,reduced:true});await muted.flush();muted.buttons[0].emit('click');assert.equal(muted.audios[0].gains[0].gain.targets.at(-1),0);assert.equal(muted.buttons[0].attributes['aria-pressed'],'false');await muted.advance(7000);assert.equal(muted.stats.finish,1);
});
