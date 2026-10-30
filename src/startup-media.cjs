'use strict';
const fs=require('node:fs');
const io=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const L=require('./codex-locale.cjs');
const THEMES=['auto','chatgpt','deepseek','workbuddy'];
const MAX_BYTES=256*1024*1024,MAX_ITEMS=8,MAX_PIXELS=8847360;
const CHANNELS={get:'startup-media:get',import:'startup-media:import',preferences:'startup-media:preferences',remove:'startup-media:remove',preview:'startup-media:preview'};
const idValid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>{throw new Error(code);};
const metadataValid=value=>value&&Number.isFinite(value.duration)&&value.duration>=.25&&value.duration<=60&&Number.isInteger(value.width)&&Number.isInteger(value.height)&&value.width>=16&&value.height>=16&&value.width<=4096&&value.height<=4096&&value.width*value.height<=MAX_PIXELS;
function videoHeader(file,extension){let fd;try{fd=fs.openSync(file,'r');const header=Buffer.alloc(512),length=fs.readSync(fd,header,0,512,0);if(extension==='.mp4')return length>=16&&header.subarray(4,8).equals(Buffer.from('ftyp'));return extension==='.webm'&&length>=12&&header.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'))&&header.subarray(4,length).includes(Buffer.from('4282847765626d','hex'));}catch{return false;}finally{if(fd!==undefined)fs.closeSync(fd);}}
async function hashFile(file){const hash=createHash('sha256');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return hash.digest('hex');}

/** 清单和原片都只留在data；从不改用户选择前的源视频。 */
function createMediaStore({dataRoot,probe}={}){
 if(!dataRoot||!path.isAbsolute(dataRoot)||typeof probe!=='function')throw new TypeError('startup media dependencies required');
 const directory=path.join(dataRoot,'startup-media','custom'),file=path.join(dataRoot,'startup-appearance.json');let error=null,queue=Promise.resolve();
 let value={schemaVersion:1,theme:'auto',selectedVideo:'builtin',items:[]};
 const validItem=item=>object(item)&&idValid(item.id)&&['.mp4','.webm'].some(ext=>item.file===item.id+ext)&&typeof item.name==='string'&&item.name.length<=160&&Number.isInteger(item.bytes)&&item.bytes>=16&&item.bytes<=MAX_BYTES&&/^[a-f0-9]{64}$/.test(item.sha256)&&metadataValid({duration:item.durationMs/1000,width:item.width,height:item.height});
 function assertPaths(){for(const target of[dataRoot,path.dirname(directory),directory,file])try{if(fs.lstatSync(target).isSymbolicLink())fail('storage-failed');}catch(e){if(e.code!=='ENOENT')throw e;}}
 try{assertPaths();const stat=fs.statSync(file);if(!stat.isFile()||stat.size>128*1024)fail('storage-failed');const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(!object(saved)||saved.schemaVersion!==1||!THEMES.includes(saved.theme)||!Array.isArray(saved.items)||saved.items.length>MAX_ITEMS||saved.items.some(item=>!validItem(item))||new Set(saved.items.map(item=>item.id)).size!==saved.items.length||saved.selectedVideo!=='builtin'&&!saved.items.some(item=>item.id===saved.selectedVideo))fail('storage-failed');value=saved;}
 catch(e){if(e.code!=='ENOENT')error='storage_failed';}
 function available(item){try{assertPaths();const candidate=path.join(directory,item.file);const stat=fs.lstatSync(candidate);return !stat.isSymbolicLink()&&stat.isFile()&&stat.size===item.bytes&&videoHeader(candidate,path.extname(item.file));}catch{return false;}}
 const state=()=>({theme:value.theme,selectedVideo:value.selectedVideo,items:value.items.map(item=>({id:item.id,name:item.name,durationMs:item.durationMs,width:item.width,height:item.height,bytes:item.bytes,available:available(item)})),limits:{maxSeconds:60,maxBytes:MAX_BYTES,maxItems:MAX_ITEMS},...(error?{error}:{})});
 const serialize=fn=>{const result=queue.catch(()=>{}).then(()=>{if(error)fail('storage-failed');assertPaths();return fn();});queue=result;return result;};
 async function save(next){assertPaths();await io.mkdir(dataRoot,{recursive:true});const temp=file+'.tmp-'+randomUUID();try{await io.writeFile(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx'});await io.rename(temp,file);value=next;}catch(e){await io.unlink(temp).catch(()=>{});throw e;}}
 async function importFile(source){return serialize(async()=>{
  if(value.items.length>=MAX_ITEMS)fail('capacity');if(typeof source!=='string'||!path.isAbsolute(source)||/^(\\\\|\/\/)/.test(source))fail('invalid-media');
  const extension=path.extname(source).toLowerCase();if(!['.mp4','.webm'].includes(extension))fail('invalid-media');let stat;try{stat=await io.lstat(source);}catch{fail('invalid-media');}
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size<16||stat.size>MAX_BYTES||!videoHeader(source,extension))fail('invalid-media');
  await io.mkdir(directory,{recursive:true});assertPaths();const id=randomUUID(),name=id+extension,destination=path.join(directory,name);let created=false;
  try{
   await io.copyFile(source,destination,fs.constants.COPYFILE_EXCL);created=true;const copied=await io.lstat(destination);if(copied.size!==stat.size||!videoHeader(destination,extension))fail('invalid-media');
   let metadata;try{metadata=await probe(destination);}catch{fail('decode-failed');}if(!metadataValid(metadata))fail('invalid-media');
   const item={id,file:name,name:path.basename(source).slice(0,160),durationMs:Math.round(metadata.duration*1000),width:metadata.width,height:metadata.height,bytes:copied.size,sha256:await hashFile(destination)};
   await save({...value,selectedVideo:id,items:[...value.items,item]});return state();
  }catch(e){if(created)await io.unlink(destination).catch(()=>{});throw e;}
 });}
 async function preferences(patch){return serialize(async()=>{if(!object(patch)||!Object.keys(patch).length||Object.keys(patch).some(key=>!['theme','selectedVideo'].includes(key))||patch.theme!==undefined&&!THEMES.includes(patch.theme)||patch.selectedVideo!==undefined&&patch.selectedVideo!=='builtin'&&!value.items.some(item=>item.id===patch.selectedVideo))fail('invalid-preferences');await save({...value,...patch});return state();});}
 async function remove(id){return serialize(async()=>{if(!idValid(id)||!value.items.some(item=>item.id===id))fail('invalid-media-id');const item=value.items.find(item=>item.id===id),candidate=path.join(directory,item.file);try{if((await io.lstat(candidate)).isSymbolicLink())fail('storage-failed');}catch(e){if(e.code!=='ENOENT')throw e;}
  await save({...value,selectedVideo:value.selectedVideo===id?'builtin':value.selectedVideo,items:value.items.filter(item=>item.id!==id)});try{await io.unlink(candidate);}catch(e){if(e.code!=='ENOENT')fail('remove-failed');}return state();
 });}
 async function resolveScene(host){
  const theme=value.theme==='auto'?(host==='workbuddy'?'workbuddy':host==='harness'?'deepseek':'chatgpt'):value.theme;
  if(error||value.selectedVideo==='builtin')return{theme,custom:null};const item=value.items.find(item=>item.id===value.selectedVideo);if(!item||!available(item))fail('media-unavailable');const candidate=path.join(directory,item.file);if(await hashFile(candidate)!==item.sha256)fail('media-unavailable');return{theme,custom:{url:pathToFileURL(candidate).href,durationMs:item.durationMs,width:item.width,height:item.height}};
 }
 return{state,importFile,preferences,remove,resolveScene};
}

/** 固定隐藏页探测元数据与首帧解码，不依赖ffmpeg，不显示窗口或读取任意URL。 */
function createDecoderProbe({electron,fileRoot=__dirname,timers=globalThis}={}){
 const{app,BrowserWindow,ipcMain}=electron,panelFile=path.join(fileRoot,'startup-media-probe.html'),panelUrl=pathToFileURL(panelFile).href;let active=null,disposed=false;
 const trusted=event=>active&&!disposed&&event?.sender===active.win.webContents&&event.senderFrame===active.win.webContents.mainFrame&&Boolean(event.senderFrame)&&active.win.webContents.getURL()===panelUrl;
 function finish(error,metadata){const item=active;if(!item)return;active=null;timers.clearTimeout(item.timer);if(!item.win.isDestroyed())item.win.destroy();if(error)item.reject(new Error(error));else item.resolve(metadata);}
 const get=event=>{if(!trusted(event))throw new Error('probe-sender-denied');return{url:active.url,nonce:active.nonce};};
 const result=(event,value)=>{if(!trusted(event)||value?.nonce!==active.nonce)return false;if(value.ok!==true){finish('decode-failed');return false;}finish(null,{duration:value.duration,width:value.width,height:value.height});return true;};
 ipcMain.handle('startup-media-probe:get',get);ipcMain.handle('startup-media-probe:result',result);
 async function probe(file){
  if(disposed)fail('decode-closed');if(active)fail('decode-busy');if(!path.isAbsolute(file))fail('invalid-media');await app.whenReady();if(disposed)fail('decode-closed');if(active)fail('decode-busy');
  return new Promise((resolve,reject)=>{
   const win=new BrowserWindow({width:16,height:16,show:false,frame:false,focusable:false,skipTaskbar:true,webPreferences:{preload:path.join(fileRoot,'startup-media-probe-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}});
   const item={win,url:pathToFileURL(file).href,nonce:randomUUID(),resolve,reject,timer:timers.setTimeout(()=>{if(active===item)finish('decode-timeout');},12000)};active=item;
   win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.on('will-attach-webview',event=>event.preventDefault());win.webContents.on('render-process-gone',()=>{if(active===item)finish('decode-failed');});win.once('closed',()=>{if(active===item)finish('decode-closed');});
   void win.loadFile(panelFile).catch(()=>{if(active===item)finish('decode-failed');});
  });
 }
 probe.dispose=()=>{if(disposed)return;disposed=true;finish('decode-closed');ipcMain.removeHandler('startup-media-probe:get');ipcMain.removeHandler('startup-media-probe:result');};return probe;
}

function install({electron=require('electron'),dataRoot=process.env.DSH_HOME,fileRoot=__dirname,host=process.env.CODEX_PET_HOST||'codex',probe:providedProbe}={}){
 const{app,ipcMain,BrowserWindow,dialog}=electron,probe=providedProbe||createDecoderProbe({electron,fileRoot}),store=createMediaStore({dataRoot,probe}),controlUrl=pathToFileURL(path.join(fileRoot,'control-window.html')).href;
 let busy=false,disposed=false,preview=null;
 const currentHost=()=>typeof host==='function'?host():host;
 const trusted=event=>{try{return!disposed&&event.senderFrame===event.sender.mainFrame&&Boolean(event.senderFrame)&&event.sender.getURL()===controlUrl&&Boolean(BrowserWindow.fromWebContents(event.sender));}catch{return false;}};
 const response=(code)=>({ok:false,code,message:L.getLocale()==='zh-CN'?({capacity:'视频库已满，最多8条。',invalid_media:'请选择可解码的 MP4 或 WebM，0.25–60秒，最大256MiB与4K。',host_unavailable:'请在当前桌宠宿主中设置启动演出。',busy:'正在处理视频，请稍候。',storage_failed:'启动视频设置暂时无法保存。'}[code]||'操作未完成，请重试。'):({capacity:'The library is full (8 videos).',invalid_media:'Choose a decodable MP4 or WebM, 0.25–60 seconds, up to 256 MiB and 4K.',host_unavailable:'Startup scenes are unavailable for this companion app.',busy:'A video is being processed. Try again shortly.',storage_failed:'Startup video settings could not be saved.'}[code]||'That did not finish. Try again.')});
 function publish(){for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&&win.webContents.getURL()===controlUrl)win.webContents.send('startup-media:changed',store.state());}
 async function run(event,fn){if(!trusted(event))return response('unauthorized');if(currentHost()==='harness')return response('host_unavailable');if(busy)return response('busy');busy=true;try{const out=await fn();publish();return{ok:true,state:store.state(),...out};}catch(error){const code=error.message==='capacity'?'capacity':/invalid-media|decode/.test(error.message)?'invalid_media':/preferences|media-id/.test(error.message)?'invalid_input':'storage_failed';return response(code);}finally{busy=false;}}
 const handlers={
  [CHANNELS.get]:event=>trusted(event)&&currentHost()!=='harness'?{ok:true,state:store.state()}:response('host_unavailable'),
  [CHANNELS.import]:event=>run(event,async()=>{const chosen=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:L.getLocale()==='zh-CN'?'导入启动视频':'Import startup video',properties:['openFile','dontAddToRecent'],filters:[{name:'MP4 / WebM',extensions:['mp4','webm']}]});if(chosen.canceled)return{cancelled:true};if(chosen.filePaths?.length!==1)fail('invalid-media');await store.importFile(chosen.filePaths[0]);return{};}),
  [CHANNELS.preferences]:(event,patch)=>run(event,async()=>{await store.preferences(patch);return{};}),
  [CHANNELS.remove]:(event,id)=>run(event,async()=>{await store.remove(id);return{};}),
  [CHANNELS.preview]:event=>run(event,async()=>{if(!preview||await preview()!==true)fail('preview-unavailable');return{};}),
 };
 for(const[channel,handler]of Object.entries(handlers))ipcMain.handle(channel,handler);
 function dispose(){if(disposed)return;disposed=true;probe.dispose?.();for(const channel of Object.values(CHANNELS))ipcMain.removeHandler(channel);app.removeListener('before-quit',dispose);}
 app.once('before-quit',dispose);
 return{state:store.state,preferences:store.preferences,resolveScene:store.resolveScene,setPreview:fn=>{if(typeof fn!=='function')throw new TypeError('preview callback required');preview=fn;},dispose};
}
module.exports={createMediaStore,createDecoderProbe,install,THEMES,CHANNELS};
