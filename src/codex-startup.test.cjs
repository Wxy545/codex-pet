'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events'),{pathToFileURL}=require('node:url');
const Startup=(()=>{try{return require('./codex-startup.cjs');}catch(error){if(error.code==='MODULE_NOT_FOUND')return {};throw error;}})();
function fixture(t,mode){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-startup-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'skins/white-dragon');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({schemaVersion:1,profiles:{idle:{type:'video',file:'q-idle.webm',forms:{sister:{file:'sister.webm'}}}}}));
 fs.writeFileSync(path.join(dir,'q-idle.webm'),Buffer.from('1a45dfa3934282847765626d000000000000','hex'));
 const sheep=path.join(root,'skins/curly-sheep');fs.mkdirSync(sheep,{recursive:true});
 fs.writeFileSync(path.join(sheep,'manifest.json'),JSON.stringify({schemaVersion:1,profiles:Object.fromEntries(['idle','working','greeting'].map(key=>[key,{type:'video',file:'q-'+key+'.webm'}]))}));
 for(const key of ['idle','working','greeting'])fs.copyFileSync(path.join(dir,'q-idle.webm'),path.join(sheep,'q-'+key+'.webm'));
 if(mode)fs.writeFileSync(path.join(root,'startup.json'),JSON.stringify({mode}));
 let id=0;const windows=[],handlers=new Map(),timers=new Map(),app=new EventEmitter();app.whenReady=()=>Promise.resolve();
 class Window extends EventEmitter{
  constructor(options){super();this.options=options;this.id=++id;this.webContents=new EventEmitter();this.webContents.getURL=()=>this.url||'';this.webContents.send=(...args)=>{this.message=args;};this.webContents.setWindowOpenHandler=fn=>{this.openHandler=fn;};windows.push(this);}
  static getAllWindows(){return windows.filter(w=>!w.destroyed);} static fromWebContents(contents){return windows.find(w=>w.webContents===contents&&!w.destroyed);}
  async loadFile(file){this.url=pathToFileURL(file).href;} show(){this.shown=true;this.showKind='active';} showInactive(){this.shown=true;this.showKind='inactive';} isDestroyed(){return !!this.destroyed;} close(){this.destroy();} destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('closed');}
 }
 const electron={app,BrowserWindow:Window,screen:{getPrimaryDisplay:()=>({bounds:{x:0,y:0,width:1920,height:1080},workArea:{x:0,y:0,width:1920,height:1040}})},ipcMain:{handle:(key,fn)=>handlers.set(key,fn),removeHandler:key=>handlers.delete(key)}};
 const timerApi={setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;},clearTimeout:key=>timers.delete(key),setInterval:()=>({unref(){}}),clearInterval(){}};
 const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
 return{root,electron,windows,handlers,timers,timerApi,flush,Window,targetRequest:async()=>({ok:false,ready:false})};
}
test('新安装默认双模式，演出偏好只接受三个模式且真实落盘恢复',async t=>{
 const f=fixture(t);assert.equal(typeof Startup.createController,'function');
 const enabled=[];const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest,onPetEnabled:value=>enabled.push(value)});t.after(()=>c.dispose());
 assert.equal(c.state().mode,'both');assert.equal(c.petEnabled(),true);assert.equal(await c.open('manual'),false);assert.equal(f.windows.length,0);
 await assert.rejects(c.setMode('sister'),/invalid-startup-mode/);
 await c.setMode('startup');assert.equal(c.petEnabled(),false);assert.deepEqual(enabled,[false]);assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'startup.json'))).mode,'startup');
 const restored=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest});t.after(()=>restored.dispose());assert.equal(restored.state().mode,'startup');
 await c.setMode('both');assert.equal(c.petEnabled(),true);assert.deepEqual(enabled,[false,true]);
});

test('主进程兜底强制销毁覆盖窗口，页面拒绝close也不能留下无控制的遮挡',async t=>{
 const f=fixture(t,'both');const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest});t.after(()=>c.dispose());
 await c.open('preview');const win=f.windows[0];let closeCalls=0;win.close=()=>{closeCalls++;};
 const watchdog=[...f.timers.values()].find(timer=>timer.ms===22000);assert.ok(watchdog);watchdog.fn();
 assert.equal(win.isDestroyed(),true);assert.equal(closeCalls,0);assert.equal(f.timers.size,0);
 assert.equal(await c.open('preview'),true);assert.equal(f.windows.length,2);
});
test('启动原因决定演出，独立Q窗口静音安全关闭且不退出主应用',async t=>{
 const f=fixture(t,'both');assert.equal(typeof Startup.createController,'function');const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest});t.after(()=>c.dispose());
 assert.equal(await c.open('manual'),false);assert.equal(await c.open('codex'),true);assert.equal(f.windows.length,1);
 const win=f.windows[0];assert.equal(win.options.webPreferences.nodeIntegration,false);assert.equal(win.options.webPreferences.contextIsolation,true);assert.equal(win.options.webPreferences.sandbox,true);assert.equal(win.options.frame,false);
 assert.equal(win.options.transparent,true);assert.equal(win.options.backgroundColor,'#00000000');assert.equal(win.options.webPreferences.autoplayPolicy,'no-user-gesture-required');
 await f.handlers.get('codex-startup:ready')({sender:win.webContents});assert.equal(win.shown,true);assert.equal(await c.open('preview'),false);assert.equal(f.windows.length,1);
 const scene=await f.handlers.get('codex-startup:scene')({sender:win.webContents});assert.match(scene.video,/q-idle\.webm$/);assert.doesNotMatch(scene.video,/sister/);assert.equal(scene.durationMs,14400);
 assert.deepEqual(win.openHandler({url:'https://example.com'}),{action:'deny'});
 let prevented=false;win.webContents.emit('before-input-event',{preventDefault(){prevented=true;}},{key:'Escape',type:'keyDown'});assert.equal(prevented,true);assert.equal(win.isDestroyed(),true);
 assert.equal(c.petEnabled(),true);assert.equal(f.windows.length,1);assert.equal(f.timers.size,0);
 await c.open('preview');const second=f.windows[1];const timeout=[...f.timers.values()].find(value=>value.ms===22000);assert.ok(timeout);timeout.fn();assert.equal(second.isDestroyed(),true);
});
test('IPC只信任本项目宠物和当前演出窗口，缺失Q素材不建空窗',async t=>{
 const f=fixture(t,'startup');assert.equal(typeof Startup.createController,'function');const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest});t.after(()=>c.dispose());
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
 const first=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest,hostRequest});t.after(()=>first.dispose());first.start('manual');await f.flush();assert.equal(f.windows.length,1);first.dispose();
 assert.deepEqual(requests[0],['POST','/dsh-pet-7340/codex-startup/pending']);
 const next=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest,hostRequest});t.after(()=>next.dispose());next.start('manual');await f.flush();assert.equal(f.windows.length,1);
});
test('外部启动通知只收两个宿主原因，不接受模式/路径或手动预览请求',()=>{
 const q=Startup.createLaunchQueue();assert.equal(typeof q.request,'function');
 for(const value of [null,[],{reason:'manual'},{reason:'preview'},{reason:'codex',mode:'both'},{reason:'codex',path:'C:/private.webm'}])assert.throws(()=>q.request(value),/invalid-startup-reason/);
 q.request({reason:'codex'});assert.equal(q.take().event.reason,'codex');
 q.request({reason:'workbuddy'});assert.equal(q.take().event.reason,'workbuddy');
});

test('WorkBuddy仅播放完整卷卷角色包，有龙娘电影仍不使用，预览不交还焦点',async t=>{
 const f=fixture(t,'both'),calls=[];
 const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,host:'workbuddy',timers:f.timerApi,targetRequest:async action=>{calls.push(action);return{ok:true,ready:true,bounds:{x:0,y:0,width:800,height:600}};}});t.after(()=>c.dispose());
 assert.equal(await c.open('codex'),false);assert.equal(await c.open('workbuddy'),true);
 let win=f.windows.at(-1),scene=f.handlers.get('codex-startup:scene')({sender:win.webContents});assert.equal(scene.host,'workbuddy');assert.equal(scene.brand,'WorkBuddy');assert.equal(scene.sheep,true);assert.equal(scene.character,'curly-sheep');assert.equal(scene.film,false);assert.ok(Object.values(scene.assets).every(url=>url.includes('/curly-sheep/')));assert.match(scene.video,/curly-sheep\/q-idle.webm$/);
 f.handlers.get('codex-startup:finish')({sender:win.webContents});await f.flush();assert.equal(calls.filter(x=>x==='focus').length,1);
 fs.mkdirSync(path.join(f.root,'startup-media'));fs.copyFileSync(path.join(f.root,'skins/white-dragon/q-idle.webm'),path.join(f.root,'startup-media/white-dragon-cinematic.webm'));
 assert.equal(await c.open('preview'),true);win=f.windows.at(-1);scene=f.handlers.get('codex-startup:scene')({sender:win.webContents});assert.equal(scene.film,false);assert.equal(scene.sheep,true);assert.equal(scene.host,'workbuddy');assert.deepEqual(Object.keys(scene.assets).sort(),['greeting','idle','working']);
 f.handlers.get('codex-startup:ready')({sender:win.webContents});assert.equal(win.showKind,'inactive');f.handlers.get('codex-startup:finish')({sender:win.webContents});await f.flush();assert.equal(calls.filter(x=>x==='focus').length,1);
 fs.unlinkSync(path.join(f.root,'skins/curly-sheep/q-working.webm'));assert.equal(await c.open('preview'),false);assert.equal(f.windows.length,2);
 await c.setMode('pet');assert.equal(await c.open('workbuddy'),false);assert.equal(c.state().mode,'pet');
});

test('动态宿主切换后探测分别缓存，已在播放的演出只交还原宿主',async t=>{
 const f=fixture(t,'both'),calls=[];let selected='workbuddy';
 const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,host:()=>selected,timers:f.timerApi,targetRequest:async(action,host)=>{calls.push([action,host]);return{ok:true,ready:true,bounds:{x:0,y:0,width:800,height:600}};}});t.after(()=>c.dispose());
 await c.open('workbuddy');selected='codex';f.handlers.get('codex-startup:finish')({sender:f.windows.at(-1).webContents});await f.flush();
 assert.deepEqual(calls,[['probe','workbuddy'],['focus','workbuddy']]);await c.open('codex');
 const scene=f.handlers.get('codex-startup:scene')({sender:f.windows.at(-1).webContents});assert.equal(scene.host,'codex');assert.deepEqual(calls.at(-1),['probe','codex']);
});

test('已有显式模式均保持，新默认不会覆盖用户选择',async t=>{
 for(const mode of ['pet','startup','both']){
  const f=fixture(t,mode),before=fs.readFileSync(path.join(f.root,'startup.json'));
  const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest});t.after(()=>c.dispose());
  assert.equal(c.state().mode,mode);assert.deepEqual(fs.readFileSync(path.join(f.root,'startup.json')),before);
 }
});

test('逐片核对Q视频，只投影可用片段且按真实目标所在屏幕全屏覆盖',async t=>{
 const f=fixture(t,'both'),dir=path.join(f.root,'skins/white-dragon'),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
 for(const key of ['wing-care','greeting','turn','working','magic','success','sister']){
  const name='q-'+key+'.webm';manifest.profiles[key]={type:'video',file:name};
  if(key!=='turn')fs.writeFileSync(path.join(dir,name),key==='working'?'not webm':fs.readFileSync(path.join(dir,'q-idle.webm')));
 }
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));
 let probes=0,converted,matched;
 f.electron.screen.screenToDipRect=(_,value)=>{converted=value;return{...value,x:-800,y:50};};
 f.electron.screen.getDisplayMatching=value=>{matched=value;return{bounds:{x:-1600,y:0,width:1600,height:900}};};
 const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:async()=>{probes++;return{ok:true,ready:true,bounds:{x:-1600,y:100,width:1200,height:700},title:'private'};}});t.after(()=>c.dispose());
 await c.open('preview');const win=f.windows[0],scene=f.handlers.get('codex-startup:scene')({sender:win.webContents});
 assert.deepEqual(Object.keys(scene.assets).sort(),['greeting','idle','magic','success','wing-care']);
 assert.equal(scene.video,scene.assets.idle);assert.ok(Object.values(scene.assets).every(value=>value.startsWith('file:')&&value.endsWith('.webm')));
 assert.deepEqual(scene.target,{ok:true,ready:true});assert.equal(scene.reason,'preview');assert.equal(scene.durationMs,14400);
 assert.deepEqual(converted,{x:-1600,y:100,width:1200,height:700});assert.equal(matched.x,-800);
 assert.deepEqual(['x','y','width','height'].map(key=>win.options[key]),[-1600,0,1600,900]);
 await f.handlers.get('codex-startup:ready')({sender:win.webContents});assert.equal(win.showKind,'inactive');
 assert.deepEqual(await f.handlers.get('codex-startup:target')({sender:win.webContents}),{ok:true,ready:true});assert.equal(probes,1);
 await assert.rejects(f.handlers.get('codex-startup:target')({sender:{}}),/startup-sender-denied/);
});

test('角色目录指向边界外时不提供任何视频或创建窗口',async t=>{
 const f=fixture(t),directory=path.join(f.root,'skins/white-dragon'),external=path.join(f.root,'outside-role');
 fs.renameSync(directory,external);fs.symlinkSync(external,directory,'junction');
 const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest});t.after(()=>c.dispose());
 assert.equal(await c.open('preview'),false);assert.equal(f.windows.length,0);
});

test('仅真实启动结束交还焦点，预览、取消和退出均不聚焦Codex',async t=>{
 const f=fixture(t,'both'),calls=[];
 const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:async action=>{calls.push(action);return{ok:false,ready:false};}});t.after(()=>c.dispose());
 await c.open('preview');f.handlers.get('codex-startup:finish')({sender:f.windows.at(-1).webContents});await f.flush();assert.equal(calls.filter(value=>value==='focus').length,0);
 await c.open('codex');f.handlers.get('codex-startup:finish')({sender:f.windows.at(-1).webContents});await f.flush();assert.equal(calls.filter(value=>value==='focus').length,1);
 await c.open('codex');await c.setMode('pet');await f.flush();assert.equal(calls.filter(value=>value==='focus').length,1);
 await c.setMode('both');await c.open('codex');c.dispose();await f.flush();assert.equal(calls.filter(value=>value==='focus').length,1);
});

test('探测期间去重并取消过期建窗，旧交还完成后才允许新覆盖层显示',async t=>{
 const f=fixture(t,'both');let resolveProbe;
 const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:()=>new Promise(resolve=>{resolveProbe=resolve;})});t.after(()=>c.dispose());
 const first=c.open('codex');await f.flush();assert.equal(await c.open('preview'),false);await c.setMode('pet');resolveProbe({ok:false,ready:false});assert.equal(await first,false);assert.equal(f.windows.length,0);
 const next=fixture(t,'both');let resolveFocus;
 const other=Startup.createController({electron:next.electron,dataRoot:next.root,fileRoot:__dirname,timers:next.timerApi,targetRequest:action=>action==='focus'?new Promise(resolve=>{resolveFocus=resolve;}):Promise.resolve({ok:false,ready:false})});t.after(()=>other.dispose());
 await other.open('codex');next.handlers.get('codex-startup:finish')({sender:next.windows[0].webContents});await next.flush();
 const opening=other.open('preview');await next.flush();assert.equal(next.windows.length,1);resolveFocus({ok:false,ready:false});assert.equal(await opening,true);assert.equal(next.windows.length,2);
});

test('窗口helper请求只允许固定动作，输出不传递路径标题或任意进程字段',async()=>{
 let captured;
 const request=Startup.createTargetRequest({platform:'win32',fileRoot:__dirname,execFileImpl:(file,args,options,callback)=>{captured={file,args,options};callback(null,JSON.stringify({ok:true,ready:true,bounds:{x:0,y:10,width:800,height:600},title:'private',pid:1,path:'C:/private'}));}});
 assert.deepEqual(await request('probe'),{ok:true,ready:true,bounds:{x:0,y:10,width:800,height:600}});
 assert.equal(captured.args.at(-1),'Probe');assert.equal(captured.options.windowsHide,true);assert.equal(captured.options.timeout,2500);
 await request('focus');assert.equal(captured.args.at(-1),'Focus');await assert.rejects(request('launch'),/invalid-startup-target-action/);
 const buddyRequest=Startup.createTargetRequest({platform:'win32',host:'workbuddy',fileRoot:__dirname,execFileImpl:(file,args,options,callback)=>{captured={file,args,options};callback(null,'{"ok":true,"ready":false}');}});await buddyRequest('probe');
 assert.equal(path.basename(captured.args[captured.args.indexOf('-File')+1]),'workbuddy-target.ps1');assert.equal(captured.options.timeout,2500);
 await buddyRequest('focus');assert.equal(captured.options.timeout,6500);assert.equal(captured.args.at(-1),'Focus');
 assert.deepEqual(Startup.normalizeTarget({ok:true,ready:true,bounds:{x:NaN,y:0,width:20,height:30}}),{ok:true,ready:false});
 assert.deepEqual(await Startup.createTargetRequest({platform:'linux'})('probe'),{ok:false,ready:false});
});

test('自有电影优先于Q片且不依赖桌宠清单，来源只暴露受控WebM文件',async t=>{
 const f=fixture(t,'both'),directory=path.join(f.root,'startup-media');fs.mkdirSync(directory);
 fs.copyFileSync(path.join(f.root,'skins/white-dragon/q-idle.webm'),path.join(directory,'white-dragon-cinematic.webm'));
 fs.rmSync(path.join(f.root,'skins'),{recursive:true});
 const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest});t.after(()=>c.dispose());
 assert.equal(await c.open('preview'),true);const win=f.windows[0],scene=f.handlers.get('codex-startup:scene')({sender:win.webContents});
 assert.equal(scene.film,true);assert.match(scene.video,/startup-media\/white-dragon-cinematic\.webm$/);assert.deepEqual(scene.assets,{});assert.equal(scene.durationMs,12000);
 assert.equal([...f.timers.values()].some(timer=>timer.ms===22000),true);
});

test('电影缺失、空文件、坏容器和超大文件只使用原Q路径，不打开任意文件',async t=>{
 const f=fixture(t,'both'),directory=path.join(f.root,'startup-media');fs.mkdirSync(directory);
 const file=path.join(directory,'white-dragon-cinematic.webm');
 const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest});t.after(()=>c.dispose());
 for(const [index,input] of [null,Buffer.alloc(0),Buffer.from('not a webm video container'),Buffer.from('1a45dfa3934282847765626d000000000000','hex')].entries()){
  if(input!==null)fs.writeFileSync(file,input);
  if(index===3)fs.truncateSync(file,96*1024*1024+1);
  assert.equal(await c.open('preview'),true);const win=f.windows.at(-1),scene=f.handlers.get('codex-startup:scene')({sender:win.webContents});
  assert.equal(scene.film,false);assert.match(scene.video,/q-idle\.webm$/);f.handlers.get('codex-startup:finish')({sender:win.webContents});
 }
});

test('电影目录junction不能越过预期目录，即使被指向文件也是WebM也不加载',async t=>{
 const f=fixture(t,'both'),outside=path.join(f.root,'outside-film');fs.mkdirSync(outside);
 fs.copyFileSync(path.join(f.root,'skins/white-dragon/q-idle.webm'),path.join(outside,'white-dragon-cinematic.webm'));
 fs.symlinkSync(outside,path.join(f.root,'startup-media'),'junction');
 const c=Startup.createController({electron:f.electron,dataRoot:f.root,fileRoot:__dirname,timers:f.timerApi,targetRequest:f.targetRequest});t.after(()=>c.dispose());
 await c.open('preview');const win=f.windows[0],scene=f.handlers.get('codex-startup:scene')({sender:win.webContents});assert.equal(scene.film,false);assert.match(scene.video,/q-idle\.webm$/);
});
