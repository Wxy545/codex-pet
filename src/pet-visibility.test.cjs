'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path'),{tmpdir}=require('node:os'),{pathToFileURL}=require('node:url');
const {createController,createFullscreenWatcher,installPreload,CHANNELS}=require('./pet-visibility.cjs');
async function fixture(t,options={}){
 const dataRoot=options.dataRoot||fs.mkdtempSync(path.join(tmpdir(),'pet-visibility-'));if(!options.dataRoot)t.after(()=>fs.rmSync(dataRoot,{recursive:true,force:true}));
 const app=new EventEmitter();app.whenReady=async()=>{};const handlers=new Map(),ipcMain={handle:(key,fn)=>handlers.set(key,fn),removeHandler:key=>handlers.delete(key)};
 function window(file,visible=true){const win=new EventEmitter();win.visible=visible;win.dead=false;win.calls=[];win.webContents={mainFrame:{},getURL:()=>pathToFileURL(path.join(__dirname,file)).href+'?petIndex=0',send:(...args)=>win.calls.push(['event',...args])};win.isDestroyed=()=>win.dead;win.isVisible=()=>win.visible;win.show=function(){this.visible=true;this.calls.push(['show']);};win.showInactive=function(){this.visible=true;this.calls.push(['showInactive']);};win.hide=function(){this.visible=false;this.calls.push(['hide']);};return win;}
 const pet=window('index.html'),alreadyHidden=window('index.html',false),panel=window('control-window.html'),wins=[pet,alreadyHidden,panel];let report={state:'windowed',reason:'not-fullscreen'},interval;
 const timers={setInterval:fn=>{interval=fn;return{unref(){}};},clearInterval:()=>{interval=null;}};
 const controller=createController({electron:{app,ipcMain,BrowserWindow:{getAllWindows:()=>wins,fromWebContents:contents=>wins.find(win=>win.webContents===contents)}},dataRoot,getPetWindows:()=>wins,probeFullscreen:async()=>report,timers});t.after(()=>controller.dispose());await controller.start();
 const event=(win=panel)=>({sender:win.webContents,senderFrame:win.webContents.mainFrame});
 return{dataRoot,app,controller,pet,alreadyHidden,panel,wins,window,handlers,event,next:async value=>{report=value;if(interval)await interval();},invoke:(channel,value,ev=event())=>handlers.get(channel)(ev,value)};
}
test('手动只隐藏宠物与同窗气泡，恢复不抢焦点且不唤起原本隐藏的窗',async t=>{
 const f=await fixture(t);await f.controller.setManualHidden(true);assert.equal(f.pet.visible,false);assert.equal(f.panel.visible,true);assert.equal(f.alreadyHidden.visible,false);assert.equal(f.controller.state().manualHidden,true);
 await f.controller.setManualHidden(false);assert.equal(f.pet.visible,true);assert.equal(f.alreadyHidden.visible,false);assert.ok(f.pet.calls.some(call=>call[0]==='showInactive'));assert.ok(!f.pet.calls.some(call=>call[0]==='show'));assert.equal(f.panel.calls.filter(call=>call[0]==='hide').length,0);
});

test('原生移交临时隐藏不写偏好，移交结束仍尊重手动隐藏和未显示窗口',async t=>{
 const f=await fixture(t);f.controller.setExternalHidden(true);assert.equal(f.pet.visible,false);assert.equal(f.panel.visible,true);
 assert.equal(f.controller.state().manualHidden,false);assert.equal(fs.existsSync(path.join(f.dataRoot,'visibility.json')),false);
 f.controller.setExternalHidden(false);assert.equal(f.pet.visible,true);assert.equal(f.alreadyHidden.visible,false);
 await f.controller.setManualHidden(true);f.controller.setExternalHidden(true);f.controller.setExternalHidden(false);assert.equal(f.pet.visible,false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataRoot,'visibility.json'),'utf8')).manualHidden,true);
});
test('自动全屏默认启用，未知不恢复，离开全屏只恢复本模块隐藏的窗',async t=>{
 const f=await fixture(t);assert.equal(f.controller.state().autoHide,true);await f.next({state:'fullscreen',reason:'d3d-fullscreen'});assert.equal(f.pet.visible,false);await f.next({state:'unknown',reason:'probe-unavailable'});assert.equal(f.pet.visible,false);await f.next({state:'windowed',reason:'not-fullscreen'});assert.equal(f.pet.visible,true);assert.equal(f.alreadyHidden.visible,false);
});
test('手动隐藏优先，显示可临时豁免当前全屏，下一次全屏重新隐藏',async t=>{
 const f=await fixture(t);await f.controller.setManualHidden(true);await f.next({state:'fullscreen',reason:'borderless-fullscreen'});await f.next({state:'windowed',reason:'desktop'});assert.equal(f.pet.visible,false);await f.next({state:'fullscreen',reason:'d3d-fullscreen'});await f.controller.setManualHidden(false);assert.equal(f.pet.visible,true);await f.next({state:'fullscreen',reason:'d3d-fullscreen'});assert.equal(f.pet.visible,true);await f.next({state:'windowed',reason:'not-fullscreen'});await f.next({state:'fullscreen',reason:'d3d-fullscreen'});assert.equal(f.pet.visible,false);
});
test('关闭自动隐藏恢复本模块窗口，用户外部hide、none销毁和startup-only均不被恢复',async t=>{
 const f=await fixture(t);await f.next({state:'fullscreen',reason:'d3d-fullscreen'});await f.controller.setAutoHide(false);assert.equal(f.pet.visible,true);await f.controller.setAutoHide(true);assert.equal(f.pet.visible,false);f.pet.hide();await f.next({state:'windowed',reason:'desktop'});assert.equal(f.pet.visible,false);
 f.pet.dead=true;f.wins.splice(f.wins.indexOf(f.pet),1);f.wins.splice(f.wins.indexOf(f.alreadyHidden),1);await f.next({state:'fullscreen',reason:'d3d-fullscreen'});await f.controller.setManualHidden(false);assert.equal(f.wins.length,1);assert.equal(f.panel.visible,true);
});
test('新窗口显示兜底受守卫保护，恢复后沿用上游原有显示意图',async t=>{
 const f=await fixture(t);await f.controller.setManualHidden(true);const next=f.window('index.html',false);f.wins.push(next);f.app.emit('browser-window-created',{},next);await Promise.resolve();next.showInactive();next.show();assert.equal(next.visible,false);assert.equal(next.calls.filter(call=>call[0]==='show'||call[0]==='showInactive').length,0);await f.controller.setManualHidden(false);assert.equal(next.visible,true);assert.equal(next.calls.at(-1)[0],'event');assert.equal(next.calls.filter(call=>call[0]==='showInactive').length,1);
});
test('隐藏偏好落盘且Helper重建仍生效，布尔验证与失败写盘不改变状态',async t=>{
 const f=await fixture(t);await assert.rejects(f.controller.setManualHidden('true'),/invalid/);await assert.rejects(f.controller.setAutoHide({enabled:false}),/invalid/);await f.controller.setManualHidden(true);await f.controller.setAutoHide(false);const saved=JSON.parse(fs.readFileSync(path.join(f.dataRoot,'visibility.json'),'utf8'));assert.deepEqual(saved,{schemaVersion:1,manualHidden:true,autoHide:false});const next=await fixture(t,{dataRoot:f.dataRoot});assert.equal(next.pet.visible,false);assert.equal(next.controller.state().autoHide,false);
});
test('偏好文件不能原子写入时不改变手动状态或窗口',async t=>{
 const directory=fs.mkdtempSync(path.join(tmpdir(),'visibility-write-denied-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));fs.mkdirSync(path.join(directory,'visibility.json'));const f=await fixture(t,{dataRoot:directory});await assert.rejects(f.controller.setManualHidden(true),/save-failed/);assert.equal(f.controller.state().manualHidden,false);assert.equal(f.pet.visible,true);
});
test('IPC只允许宠物和控制中心主frame；托盘始终保留显示入口，卸载还原窗口方法',async t=>{
 const f=await fixture(t);const foreign={sender:{getURL:()=> 'https://example.com'},senderFrame:{}};assert.equal((await f.invoke(CHANNELS.manual,true,foreign)).ok,false);const frame={sender:f.panel.webContents,senderFrame:{}};assert.equal((await f.invoke(CHANNELS.auto,false,frame)).ok,false);assert.equal((await f.invoke(CHANNELS.manual,true)).ok,true);assert.equal((await f.invoke(CHANNELS.get)).state.manualHidden,true);assert.equal(f.controller.trayItems().length>=2,true);assert.ok(f.controller.trayItems()[0].click);
 const exposed=[];installPreload({contextBridge:{exposeInMainWorld:(name,value)=>exposed.push({name,value})},ipcRenderer:{invoke(){},on(){},removeListener(){}}});assert.equal(exposed[0].name,'petVisibility');assert.deepEqual(Object.keys(exposed[0].value),['getState','setManualHidden','setAutoHide','onChanged']);f.controller.dispose();assert.equal(f.handlers.size,0);f.pet.showInactive();assert.equal(f.pet.visible,true);
});
test('原生只读watcher固定启动一次，过滤异常输出，stop后旧进程消息失效',()=>{
 const children=[],updates=[],scheduled=[];const spawnImpl=(executable,args,options)=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{child.killed=true;};children.push({child,executable,args,options});return child;};
 const timers={setTimeout:(fn,delay)=>{const id={fn,delay,unref(){}};scheduled.push(id);return id;},clearTimeout:id=>{if(id)id.dead=true;}};
 const watcher=createFullscreenWatcher({platform:'win32',spawnImpl,timers,onState:value=>updates.push(value)});watcher.start();watcher.start();assert.equal(children.length,1);const created=children[0];assert.equal(created.options.windowsHide,true);assert.equal(created.options.shell,false);assert.ok(created.args.includes('-Watch'));created.child.stdout.emit('data',Buffer.from('{"state":"fullscreen","reason":"d3d-fullscreen"}\n'));assert.deepEqual(updates.at(-1),{state:'fullscreen',reason:'d3d-fullscreen'});created.child.stdout.emit('data',Buffer.from('{"state":"windowed","reason":"a secret"}\n'));assert.equal(updates.at(-1).state,'unknown');assert.equal(JSON.stringify(updates).includes('a secret'),false);watcher.stop();const count=updates.length;created.child.stdout.emit('data',Buffer.from('{"state":"windowed","reason":"desktop"}\n'));assert.equal(updates.length,count);assert.equal(created.child.killed,true);
});
