'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{tmpdir}=require('node:os'),{EventEmitter}=require('node:events'),{pathToFileURL}=require('node:url');
const Media=require('./startup-media.cjs');
const MP4=Buffer.from('000000186674797069736f6d0000020069736f6d69736f32000000086d646174','hex');
async function fixture(t,probe=async()=>({duration:6.2,width:1920,height:1080})){const dataRoot=await fs.mkdtemp(path.join(tmpdir(),'startup-media-'));t.after(()=>fs.rm(dataRoot,{recursive:true,force:true}));const source=path.join(dataRoot,'my-intro.mp4');await fs.writeFile(source,MP4);return{dataRoot,source,store:Media.createMediaStore({dataRoot,probe})};}
test('本地导入解码后收库，保存副本且不改原片，状态不返回原路径',async t=>{
 const f=await fixture(t);const loaded=await f.store.importFile(f.source);assert.equal(loaded.items.length,1);const item=loaded.items[0];assert.equal(item.name,'my-intro.mp4');assert.equal(item.durationMs,6200);assert.equal(item.width,1920);assert.equal(loaded.selectedVideo,item.id);assert.equal(JSON.stringify(loaded).includes(f.dataRoot),false);assert.equal(item.file,undefined);assert.deepEqual(await fs.readFile(f.source),MP4);
 const scene=await f.store.resolveScene('codex');assert.equal(scene.theme,'chatgpt');assert.match(scene.custom.url,/\.mp4$/);assert.notEqual(scene.custom.url,pathToFileURL(f.source).href);assert.deepEqual(await fs.readFile(new URL(scene.custom.url)),MP4);const restored=Media.createMediaStore({dataRoot:f.dataRoot,probe:async()=>{throw new Error('should not decode on startup');}});assert.equal(restored.state().selectedVideo,item.id);
});
test('只有有限时长、尺寸与成功解码的视频能收库，失败清掉本次副本',async t=>{
 for(const metadata of [{duration:0,width:1920,height:1080},{duration:Infinity,width:1920,height:1080},{duration:61,width:1920,height:1080},{duration:3,width:8192,height:8192},{duration:3,width:0,height:1080}]){
  const f=await fixture(t,async()=>metadata);await assert.rejects(f.store.importFile(f.source),/invalid-media/);assert.equal(f.store.state().items.length,0);assert.deepEqual(await fs.readdir(path.join(f.dataRoot,'startup-media','custom')),[]);
 }
 const bad=await fixture(t,async()=>{throw new Error('unsupported');});await assert.rejects(bad.store.importFile(bad.source),/decode-failed/);assert.equal(bad.store.state().items.length,0);
});
test('扩展名与容器头不符、非视频和目录在解码前拒绝',async t=>{
 let probes=0;const f=await fixture(t,async()=>{probes++;return{duration:3,width:1280,height:720};});const wrong=path.join(f.dataRoot,'private.webm');await fs.writeFile(wrong,MP4);await assert.rejects(f.store.importFile(wrong),/invalid-media/);await assert.rejects(f.store.importFile(f.dataRoot),/invalid-media/);const text=path.join(f.dataRoot,'note.mp4');await fs.writeFile(text,'not a video');await assert.rejects(f.store.importFile(text),/invalid-media/);assert.equal(probes,0);
});
test('独占复制发现目标已存在时不删除那份既有文件',async t=>{
 const f=await fixture(t),originalCopy=fs.copyFile;let target;
 fs.copyFile=async(_source,destination)=>{target=destination;await fs.writeFile(destination,'pre-existing library file');throw Object.assign(new Error('exists'),{code:'EEXIST'});};
 try{await assert.rejects(f.store.importFile(f.source),{code:'EEXIST'});assert.equal(await fs.readFile(target,'utf8'),'pre-existing library file');}finally{fs.copyFile=originalCopy;}
});
test('主题独立于真实宿主，auto分别选择龙娘、卷卷与DeepSeek，非法偏好不写入',async t=>{
 const f=await fixture(t);for(const[host,theme]of [['codex','chatgpt'],['workbuddy','workbuddy'],['harness','deepseek']])assert.equal((await f.store.resolveScene(host)).theme,theme);
 await f.store.preferences({theme:'workbuddy'});assert.equal((await f.store.resolveScene('codex')).theme,'workbuddy');await f.store.preferences({theme:'deepseek'});assert.equal((await f.store.resolveScene('workbuddy')).theme,'deepseek');
 for(const value of [{theme:'unknown'},{selectedVideo:'file:///private.mp4'},{selectedVideo:'absent'},{theme:'auto',source:'private'}])await assert.rejects(f.store.preferences(value),/invalid-preferences/);assert.equal(f.store.state().theme,'deepseek');
});
test('移除选中片退回内置演出，不删源视频，不允许任意路径删除',async t=>{
 const f=await fixture(t);const state=await f.store.importFile(f.source);const scene=await f.store.resolveScene('codex');await assert.rejects(f.store.remove('../my-intro.mp4'),/invalid-media-id/);await f.store.remove(state.items[0].id);assert.equal(f.store.state().selectedVideo,'builtin');assert.equal(f.store.state().items.length,0);await assert.rejects(fs.stat(new URL(scene.custom.url)),{code:'ENOENT'});assert.deepEqual(await fs.readFile(f.source),MP4);
});
test('库满明确拒绝，缺失或改坏的自定义片不冒充已验证可用',async t=>{
 const f=await fixture(t);for(let i=0;i<8;i++)await f.store.importFile(f.source);await assert.rejects(f.store.importFile(f.source),/capacity/);assert.equal(f.store.state().items.length,8);const scene=await f.store.resolveScene('codex');await fs.unlink(new URL(scene.custom.url));await assert.rejects(f.store.resolveScene('codex'),/media-unavailable/);assert.equal(f.store.state().items.at(-1).available,false);
});
test('副本被同长度内容改动后拒绝播放，不把旧验证结果用于新文件',async t=>{
 const f=await fixture(t);await f.store.importFile(f.source);const scene=await f.store.resolveScene('codex');const changed=Buffer.from(MP4);changed[changed.length-1]=42;await fs.writeFile(new URL(scene.custom.url),changed);await assert.rejects(f.store.resolveScene('codex'),/media-unavailable/);
});
test('被篡改的清单不越界读写，保留损坏文件并禁用修改',async t=>{
 const f=await fixture(t);const file=path.join(f.dataRoot,'startup-appearance.json');await fs.writeFile(file,'{"schemaVersion":1,"theme":"auto","selectedVideo":"../../x","items":[]}');const store=Media.createMediaStore({dataRoot:f.dataRoot,probe:async()=>({})});assert.equal(store.state().error,'storage_failed');await assert.rejects(store.preferences({theme:'chatgpt'}),/storage-failed/);assert.match(await fs.readFile(file,'utf8'),/\.\.\/\.\.\/x/);
});
function decoderFixture(){
 const app=new EventEmitter();app.whenReady=async()=>{};const windows=[],handlers=new Map(),timers=new Map();let count=0;
 class Window extends EventEmitter{constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.getURL=()=>this.url;this.webContents.setWindowOpenHandler=()=>{};windows.push(this);}async loadFile(file){this.url=pathToFileURL(file).href;}isDestroyed(){return!!this.dead;}destroy(){this.dead=true;this.emit('closed');}}
 const probe=Media.createDecoderProbe({electron:{app,BrowserWindow:Window,ipcMain:{handle:(key,fn)=>handlers.set(key,fn),removeHandler:key=>handlers.delete(key)}},fileRoot:__dirname,timers:{setTimeout:(fn,ms)=>{const id=++count;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)}});
 const event=()=>({sender:windows.at(-1).webContents,senderFrame:windows.at(-1).webContents.mainFrame});return{probe,windows,handlers,timers,event};
}
test('解码探针始终隐藏且隔离，只接受自己固定页面的元数据回包',async()=>{
 const f=decoderFixture();const pending=f.probe(path.resolve('chosen.mp4'));await new Promise(resolve=>setImmediate(resolve));const win=f.windows[0];assert.equal(win.options.show,false);assert.equal(win.options.webPreferences.sandbox,true);assert.equal(win.options.webPreferences.nodeIntegration,false);const config=f.handlers.get('startup-media-probe:get')(f.event());assert.match(config.url,/chosen\.mp4$/);assert.throws(()=>f.handlers.get('startup-media-probe:get')({sender:win.webContents,senderFrame:{}}),/denied/);f.handlers.get('startup-media-probe:result')(f.event(),{nonce:config.nonce,ok:true,duration:3,width:1280,height:720});assert.deepEqual(await pending,{duration:3,width:1280,height:720});assert.equal(win.dead,true);assert.equal(f.timers.size,0);f.probe.dispose();assert.equal(f.handlers.size,0);
});
test('解码超时或卸载销毁隐藏探针并拒绝迟到回包',async()=>{
 const f=decoderFixture();const first=f.probe(path.resolve('chosen.mp4'));await new Promise(resolve=>setImmediate(resolve));const rejected=assert.rejects(first,/decode-timeout/);[...f.timers.values()][0].fn();await rejected;assert.equal(f.windows[0].dead,true);const second=f.probe(path.resolve('second.mp4'));await new Promise(resolve=>setImmediate(resolve));const closed=assert.rejects(second,/decode-closed/);f.probe.dispose();await closed;assert.equal(f.windows[1].dead,true);assert.equal(f.handlers.size,0);
});
test('等待Electron就绪期间同时到来的第二次探测不会创建第二个窗口',async()=>{
 const f=decoderFixture();const first=f.probe(path.resolve('first.mp4')),second=f.probe(path.resolve('second.mp4'));first.catch(()=>{});second.catch(()=>{});const rejected=assert.rejects(second,/decode-busy/);rejected.catch(()=>{});try{await new Promise(resolve=>setImmediate(resolve));assert.equal(f.windows.length,1);await rejected;const closed=assert.rejects(first,/decode-closed/);f.probe.dispose();await closed;}finally{f.probe.dispose();}
});
test('视频库IPC只信任控制中心主frame，导入路径只能来自原生选择器',async t=>{
 const f=await fixture(t),handlers=new Map(),app=new EventEmitter(),contents={mainFrame:{},getURL:()=>pathToFileURL(path.join(__dirname,'control-window.html')).href,send(){}};let dialogs=0,probes=0,host='codex';const win={webContents:contents,isDestroyed:()=>false};
 const controller=Media.install({dataRoot:f.dataRoot,fileRoot:__dirname,host:()=>host,probe:async()=>{probes++;return{duration:3,width:1280,height:720};},electron:{app,ipcMain:{handle:(key,fn)=>handlers.set(key,fn),removeHandler:key=>handlers.delete(key)},BrowserWindow:{fromWebContents:value=>value===contents?win:null,getAllWindows:()=>[win]},dialog:{showOpenDialog:async()=>{dialogs++;return{canceled:false,filePaths:[f.source]};}}}});t.after(()=>controller.dispose());const event={sender:contents,senderFrame:contents.mainFrame};
 assert.equal((await handlers.get(Media.CHANNELS.import)({sender:contents,senderFrame:{}},f.source)).ok,false);assert.equal(dialogs,0);
 const result=await handlers.get(Media.CHANNELS.import)(event,{path:'C:/private/credentials.mp4'});assert.equal(result.ok,true);assert.equal(dialogs,1);assert.equal(probes,1);assert.equal(result.state.items[0].name,'my-intro.mp4');assert.equal(JSON.stringify(result).includes(f.dataRoot),false);
 let previews=0;controller.setPreview(async()=>{previews++;return true;});assert.equal((await handlers.get(Media.CHANNELS.preview)(event)).ok,true);assert.equal(previews,1);host='harness';assert.equal((await handlers.get(Media.CHANNELS.import)(event)).code,'host_unavailable');assert.equal((await handlers.get(Media.CHANNELS.preview)(event)).code,'host_unavailable');assert.equal(dialogs,1);assert.equal(previews,1);
});
