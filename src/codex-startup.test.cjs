'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events'),{pathToFileURL}=require('node:url');
const Startup=(()=>{try{return require('./codex-startup.cjs');}catch(error){if(error.code==='MODULE_NOT_FOUND')return {};throw error;}})();
function fixture(t,mode){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-startup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'skins/white-dragon');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({schemaVersion:1,profiles:{idle:{type:'video',file:'q-idle.webm',forms:{sister:{file:'sister.webm'}}}}}));
 fs.writeFileSync(path.join(dir,'q-idle.webm'),Buffer.from('1a45dfa3934282847765626d000000000000','hex'));
 if(mode)fs.writeFileSync(path.join(root,'startup.json'),JSON.stringify({mode}));
 let id=0;const windows=[],handlers=new Map(),timers=new Map(),app=new EventEmitter();app.whenReady=()=>Promise.resolve();
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.id=++id;this.webContents=new EventEmitter();this.webContents.getURL=()=>this.url||'';this.webContents.send=(...args)=>{this.message=args;};this.webContents.setWindowOpenHandler=fn=>{this.openHandler=fn;};windows.push(this);}
  static getAllWindows(){return windows.filter(w=>!w.destroyed);} static fromWebContents(contents){return windows.find(w=>w.webContents===contents&&!w.destroyed);}
  async loadFile(file){this.url=pathToFileURL(file).href;} show(){this.shown=true;} showInactive(){this.shown=true;} isDestroyed(){return !!this.destroyed;} close(){this.destroy();} destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
 }
 const electron={app,BrowserWindow:Window,screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},ipcMain:{handle:(key,fn)=>handlers.set(key,fn),removeHandler:key=>handlers.delete(key)}};
 const timerApi={setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;},clearTimeout:key=>timers.delete(key),setInterval:()=>({unref(){}}),clearInterval(){}};
 const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
 return{root,electron,windows,handlers,timers,timerApi,flush,Window};
}
test('默认仅桌宠，演出偏好只接受三个模式且真实落盘恢复',async t=>{
 const f=fixture(t);assert.equal(typeof Startup.createController,'function');
 const enabled=[];const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,onPetEnabled:value=>enabled.push(value)});t.after(()=>c.dispose());
 assert.equal(c.state().mode,'pet');assert.equal(c.petEnabled(),true);assert.equal(await c.open('codex'),false);assert.equal(f.windows.length,0);
 await assert.rejects(c.setMode('sister'),/invalid-startup-mode/);
 await c.setMode('startup');assert.equal(c.petEnabled(),false);assert.deepEqual(enabled,[false]);assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'startup.json'))).mode,'startup');
 const restored=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi});t.after(()=>restored.dispose());assert.equal(restored.state().mode,'startup');
 await c.setMode('both');assert.equal(c.petEnabled(),true);assert.deepEqual(enabled,[false,true]);
});
test('启动原因决定演出，独立Q窗口静音安全关闭且不退出主应用',async t=>{
 const f=fixture(t,'both');assert.equal(typeof Startup.createController,'function');const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi});t.after(()=>c.dispose());
 assert.equal(await c.open('manual'),false);assert.equal(await c.open('codex'),true);assert.equal(f.windows.length,1);
 const win=f.windows[0];assert.equal(win.options.webPreferences.nodeIntegration,false);assert.equal(win.options.webPreferences.contextIsolation,true);assert.equal(win.options.webPreferences.sandbox,true);assert.equal(win.options.frame,false);
 await f.handlers.get('codex-startup:ready')({sender:win.webContents});assert.equal(win.shown,true);assert.equal(await c.open('preview'),false);assert.equal(f.windows.length,1);
 const scene=await f.handlers.get('codex-startup:scene')({sender:win.webContents});assert.match(scene.video,/q-idle\.webm$/);assert.doesNotMatch(scene.video,/sister/);assert.equal(scene.durationMs,7600);
 assert.deepEqual(win.openHandler({url:'https://example.com'}),{action:'deny'});
 let prevented=false;win.webContents.emit('before-input-event',{preventDefault(){prevented=true;}},{key:'Escape',type:'keyDown'});assert.equal(prevented,true);assert.equal(win.isDestroyed(),true);
 assert.equal(c.petEnabled(),true);assert.equal(f.windows.length,1);assert.equal(f.timers.size,0);
 await c.open('preview');const second=f.windows[1];const timeout=[...f.timers.values()].find(value=>value.ms===12000);assert.ok(timeout);timeout.fn();assert.equal(second.isDestroyed(),true);
});
test('IPC只信任本项目宠物和当前演出窗口，缺失Q素材不建空窗',async t=>{
 const f=fixture(t,'startup');assert.equal(typeof Startup.createController,'function');const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi});t.after(()=>c.dispose());
 const outsider=new f.Window({});outsider.url='https://example.com/';assert.throws(()=>f.handlers.get('codex-startup:set')({sender:outsider.webContents},{mode:'both'}),/startup-sender-denied/);
 const pet=new f.Window({});pet.url=pathToFileURL(path.join(__dirname,'index.html')).href;
 assert.equal((await f.handlers.get('codex-startup:get')({sender:pet.webContents})).mode,'startup');
 await f.handlers.get('codex-startup:set')({sender:pet.webContents},{mode:'pet'});assert.equal(c.petEnabled(),true);
 fs.rmSync(path.join(f.root,'skins/white-dragon/q-idle.webm'));assert.equal(await c.open('preview'),false);
 assert.equal(f.windows.length,2);
});
test('宿主启动事件只接受明确原因并且消费一次，积压有界',()=>{
 assert.equal(typeof Startup.createLaunchQueue,'function');const q=Startup.createLaunchQueue();assert.throws(()=>q.push('preview'),/invalid-startup-reason/);q.push('manual');assert.equal(q.take().event.reason,'manual');q.push('codex');q.push('codex');
 const event=q.take().event;assert.equal(event.reason,'codex');assert.equal(typeof event.id,'string');assert.equal(q.take().event,null);
});
test('宿主事件被一次消费后helper重建不重播，启动演出模式手动启动仅播一次',async t=>{
 const f=fixture(t,'startup'),q=Startup.createLaunchQueue();q.push('manual');
 const requests=[];const hostRequest=async(method,route)=>{requests.push([method,route]);return{status:200,body:JSON.stringify(q.take())};};
 const first=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,hostRequest});t.after(()=>first.dispose());first.start('manual');await f.flush();assert.equal(f.windows.length,1);first.dispose();
 assert.deepEqual(requests[0],['POST','/dsh-pet-7340/codex-startup/pending']);
 const next=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,hostRequest});t.after(()=>next.dispose());next.start('manual');await f.flush();assert.equal(f.windows.length,1);
});
test('外部启动通知只收Codex原因，不接受模式/路径或手动预览请求',()=>{
 const q=Startup.createLaunchQueue();assert.equal(typeof q.request,'function');
 for(const value of [null,[],{reason:'manual'},{reason:'preview'},{reason:'codex',mode:'both'},{reason:'codex',path:'C:/private.webm'}])assert.throws(()=>q.request(value),/invalid-startup-reason/);
 q.request({reason:'codex'});assert.equal(q.take().event.reason,'codex');
});
