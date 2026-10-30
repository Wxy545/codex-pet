'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createController,installPreload,CHANNELS}=require('./control-window.cjs');

function fixture(options={}) {
 const handlers=new Map(),windows=[],calls=[];const app=new EventEmitter();app.whenReady=async()=>{};
 const ipcMain=new EventEmitter();ipcMain.handle=(key,fn)=>handlers.set(key,fn);ipcMain.removeHandler=key=>handlers.delete(key);
 const pet={mainFrame:{},getURL:()=>pathToFileURL(path.join(__dirname,'index.html')).href+'?petIndex=0'};
 class BrowserWindow extends EventEmitter {
  static fromWebContents(value){return value===pet?{}:windows.find(win=>win.webContents===value);}
  constructor(settings){super();this.settings=settings;this.dead=false;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.getURL=()=>this.url;this.webContents.setWindowOpenHandler=fn=>{this.openHandler=fn;};windows.push(this);}
  async loadFile(file){this.url=pathToFileURL(file).href;}isDestroyed(){return this.dead;}isMinimized(){return false;}show(){}focus(){}setMenu(){}destroy(){this.dead=true;this.emit('closed');}
 }
 let host=options.host||'codex';
 let config={main:{pets:[{id:'main',name:'Custom dragon',size:320,display:'desktop',balanceEnabled:true,whisperEnabled:false,workStatusEnabled:true,fixedEnabled:false,position:{corner:'bottom-right',marginX:80,marginY:30},whisperPrompt:'custom tone'}, {id:'second',name:'Other pet',size:200,display:'none',balanceEnabled:false,whisperEnabled:true,workStatusEnabled:false,fixedEnabled:true,position:{corner:'top-left',marginX:10,marginY:15}}],confineToScreen:true,physics:{gravity:1400,restitution:.78,groundFriction:2.5,ceilingBounce:true,throwPower:1,petCollision:false},font:{family:'candy',size:21,followPet:true},animations:{idle:['original']},unknownAdvanced:{keep:true}}};
 let ai={enabled:true,automaticWhispers:true,whisperIntervalSec:600,maxTokens:1024,timeoutMs:60000,baseUrl:'http://127.0.0.1:1234/v1',model:'codex',hasKey:true,apiKey:'never-expose'};
 const hostRequest=async(method,route,body)=>{calls.push({via:'host',method,route,body:body&&JSON.parse(body)});if(options.hostRequest)return options.hostRequest(method,route,body);if(route.endsWith('/config/meta'))return{status:200,body:JSON.stringify({user:'private-path',storage:[]})};if(method==='PUT'){config={main:{...config.main,...JSON.parse(body)}};}return{status:200,body:JSON.stringify(config)};};
 const apiRequest=async(method,route,body)=>{calls.push({via:'api',method,route,body:body&&JSON.parse(body)});if(options.apiRequest)return options.apiRequest(method,route,body);if(route==='/dsh-pet-7340/config/editable')return{status:200,body:JSON.stringify(options.editable||{merged:config.main,user:config.main})};if(method==='PUT'&&route==='/dsh-pet-7340/config'){if(options.hostRequest)return options.hostRequest(method,route,body);config={main:{...config.main,...JSON.parse(body)}};return{status:200,body:JSON.stringify(config)};}if(route==='/dsh-pet-7340/reload')return{status:200,body:'{"reloading":true}'};if(method==='POST')ai={...ai,...JSON.parse(body)};return{status:200,body:JSON.stringify(ai)};};
 const skins={readModel:async()=>{calls.push({via:'skin-read'});return{locale:'en',selection:{character:'white-dragon',mode:'q'},characters:[{id:'white-dragon',copy:{name:'White Dragon Girl',persona:'private persona'},available:{q:true},assets:{'q-idle.webm':{available:true,type:'video',url:'file:///dragon.webm'}},manifest:{profiles:{idle:{file:'q-idle.webm',type:'video'}}}},{id:'bluefish',copy:{name:'Whale maid'},originalVideo:true,available:{q:true}}]};},select:async value=>{calls.push({via:'skin-select',value});return{selection:value};}};
 const startup={state:()=>({mode:'both',locale:'en'}),setMode:async mode=>{calls.push({via:'startup-mode',mode});return{mode,locale:'en'};},open:async reason=>{calls.push({via:'startup-preview',reason});return true;}};
 const petHost={get:()=>({schemaVersion:1,host,label:host==='codex'?'Codex':'WorkBuddy',capabilities:{chat:host==='codex',quota:host==='codex',chatter:host==='codex'}}),select:async value=>{calls.push({via:'host-select',value});host=value;return{host: value,restarting:true};}};
 const controller=createController({electron:{app,ipcMain,BrowserWindow},hostRequest,apiRequest,skins,startup,petHost,...options.dependencies});
 const event=()=>({sender:windows.at(-1).webContents,senderFrame:windows.at(-1).webContents.mainFrame});
 const invoke=(key,value,from=event())=>handlers.get(key)(from,value);
 return{controller,handlers,windows,calls,pet,invoke,event,config:()=>config};
}

test('控制中心单实例且隔离Node，宠物只能打开、外窗和iframe不能读写设置',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();await f.controller.open();assert.equal(f.windows.length,1);
 const win=f.windows[0];assert.equal(win.settings.webPreferences.nodeIntegration,false);assert.equal(win.settings.webPreferences.contextIsolation,true);assert.equal(win.settings.webPreferences.sandbox,true);assert.deepEqual(win.openHandler(),{action:'deny'});
 for(const channel of Object.values(CHANNELS).filter(key=>key!==CHANNELS.open)){
  assert.equal((await f.invoke(channel,{}, {sender:f.pet,senderFrame:f.pet.mainFrame})).code,'unauthorized');
  assert.equal((await f.invoke(channel,{}, {sender:win.webContents,senderFrame:{}})).code,'unauthorized');
 }
 assert.equal(f.calls.length,0);const exposed=[];const sent=[];
 installPreload({contextBridge:{exposeInMainWorld:(name,value)=>exposed.push({name,value})},ipcRenderer:{send:(...args)=>sent.push(args)}});
 assert.deepEqual(Object.keys(exposed[0].value),['open']);exposed[0].value.open('ignored');assert.deepEqual(sent,[[CHANNELS.open]]);
});
test('按当前分区读取，角色卡只返回展示所需媒体，不透传人设、清单或本机配置路径',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();
 const result=await f.invoke(CHANNELS.state,'character');assert.equal(result.ok,true);assert.equal(result.state.section,'character');assert.equal(result.state.characters[0].preview.url,'file:///dragon.webm');assert.equal(result.state.characters[0].name,'White Dragon Girl');assert.equal(result.state.characters[0].persona,undefined);assert.equal(result.state.characters[0].manifest,undefined);assert.deepEqual(f.calls.map(call=>call.via),['skin-read']);
 const interaction=await f.invoke(CHANNELS.state,'interaction');assert.equal(interaction.state.pets[0].id,'main');assert.equal(interaction.state.pets[0].whisperPrompt,undefined);assert.equal(interaction.state.meta,undefined);assert.equal(interaction.state.animations,undefined);
 assert.equal((await f.invoke(CHANNELS.state,'unknown')).code,'invalid_input');
});
test('互动保存只改目标宠物和允许的顶层偏好，保留其它宠物、自定义人设及高级配置',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();
 const result=await f.invoke(CHANNELS.interaction,{petId:'main',size:380,fixedEnabled:true,workStatusEnabled:false,confineToScreen:false});assert.equal(result.ok,true);
 const saved=f.calls.find(call=>call.method==='PUT');assert.equal(saved.via,'api');assert.equal(saved.route,'/dsh-pet-7340/config');assert.equal(saved.body.pets[0].size,380);assert.equal(saved.body.pets[0].name,'Custom dragon');assert.equal(saved.body.pets[0].whisperPrompt,'custom tone');assert.equal(saved.body.pets[1].name,'Other pet');assert.equal(saved.body.pets[1].size,200);assert.equal(saved.body.physics,undefined);assert.equal(saved.body.animations,undefined);assert.equal(f.config().main.unknownAdvanced.keep,true);
});
test('任务忙碌时保存与重载均走受保护HTTP，不把409忙碌误报为配置损坏',async t=>{
 let blocking=true;const f=fixture({apiRequest:async(method,route)=>{if(method==='GET')return{status:200,body:JSON.stringify({merged:f.config().main,user:f.config().main})};return blocking?{status:409,body:'{"error":"host_busy"}'}:{status:200,body:'{"reloading":true}'};}});t.after(()=>f.controller.dispose());await f.controller.open();
 assert.equal((await f.invoke(CHANNELS.interaction,{petId:'main',size:400})).code,'task_busy');assert.equal((await f.invoke(CHANNELS.reload)).code,'task_busy');assert.equal(f.config().main.pets[0].size,320);assert.ok(f.calls.filter(call=>call.method!=='GET').every(call=>call.via==='api'));
 blocking=false;assert.equal((await f.invoke(CHANNELS.reload)).ok,true);assert.equal(f.calls.at(-1).route,'/dsh-pet-7340/reload');
});
test('不接收任意配置、非法数值与未知宠物，也不自动强制覆盖损坏配置',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();
 for(const value of [{petId:'main',size:0},{petId:'main',size:NaN},{petId:'main',notificationsEnabled:false},{petId:'main',physics:{gravity:-1}},{petId:'main',display:'web'},{petId:'main',force:true}])assert.equal((await f.invoke(CHANNELS.interaction,value)).code,'invalid_input');
 assert.equal(f.calls.length,0);assert.equal((await f.invoke(CHANNELS.interaction,{petId:'absent',size:300})).code,'invalid_input');assert.ok(!f.calls.some(call=>call.method==='PUT'));
 const broken=fixture({hostRequest:async(method)=>({status:method==='PUT'?409:200,body:method==='PUT'?'{"needConfirm":true}':JSON.stringify(f.config())})});t.after(()=>broken.controller.dispose());await broken.controller.open();assert.equal((await broken.invoke(CHANNELS.interaction,{petId:'main',size:300})).code,'config_conflict');assert.equal(broken.calls.filter(call=>call.method==='PUT').length,1);
});
test('用户未写自定义人设时不会把合并默认人设固化，配置保留其它字段',async t=>{
 const merged={pets:[{id:'main',name:'Original default',size:320,display:'desktop',balanceEnabled:true,whisperEnabled:true,workStatusEnabled:true,fixedEnabled:false,position:{corner:'bottom-right',marginX:80,marginY:30},whisperPrompt:'not a user override'}]};
 const f=fixture({editable:{merged,user:{pets:[{id:'main',name:'User name',size:320}],customAdvanced:'keep'}}});t.after(()=>f.controller.dispose());await f.controller.open();
 assert.equal((await f.invoke(CHANNELS.interaction,{petId:'main',fixedEnabled:true})).ok,true);const body=f.calls.find(call=>call.method==='PUT').body;assert.equal(body.pets[0].name,'User name');assert.equal(body.pets[0].whisperPrompt,undefined);assert.equal(body.pets[0].display,'desktop');assert.equal(body.customAdvanced,undefined);
});
test('AI碎念只读写偏好，不回显连接地址或密钥，也不允许修改连接或清密钥',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();
 const loaded=await f.invoke(CHANNELS.state,'chatter');assert.deepEqual(loaded.state.chatter,{enabled:true,automaticWhispers:true,whisperIntervalSec:600,maxTokens:1024,timeoutMs:60000});
 const saved=await f.invoke(CHANNELS.chatter,{automaticWhispers:false,whisperIntervalSec:900});assert.equal(saved.ok,true);assert.deepEqual(f.calls.at(-1).body,{automaticWhispers:false,whisperIntervalSec:900});
 for(const body of [{baseUrl:'https://example.com'},{apiKey:'secret'},{clearApiKey:true},{whisperIntervalSec:59},{maxTokens:10000}])assert.equal((await f.invoke(CHANNELS.chatter,body)).code,'invalid_input');
});
test('WorkBuddy模式不读取AI设置且拒绝碎念保存，角色、互动、启动仍可用',async t=>{
 const f=fixture({host:'workbuddy'});t.after(()=>f.controller.dispose());await f.controller.open();
 assert.equal((await f.invoke(CHANNELS.state,'chatter')).code,'host_unavailable');assert.equal((await f.invoke(CHANNELS.chatter,{automaticWhispers:true})).code,'host_unavailable');assert.equal(f.calls.length,0);
 assert.equal((await f.invoke(CHANNELS.state,'startup')).state.host.host,'workbuddy');assert.equal((await f.invoke(CHANNELS.character,'bluefish')).ok,true);
});

test('Harness原生移交只返回宿主选择页，不能修改隐藏的Codex角色、互动或启动电影',async t=>{
 const petHost={get:()=>({host:'harness',external:true,profile:'web'}),select:async host=>({host,cancelled:true})};
 const f=fixture({dependencies:{petHost}});t.after(()=>f.controller.dispose());await f.controller.open();
 const state=await f.invoke(CHANNELS.state,'character');assert.equal(state.ok,true);assert.equal(state.state.section,'startup');assert.equal(state.state.host.host,'harness');assert.equal(state.state.characters,undefined);assert.equal(f.calls.length,0);
 for(const[channel,value]of [[CHANNELS.character,'bluefish'],[CHANNELS.interaction,{petId:'main',size:400}],[CHANNELS.startup,'pet'],[CHANNELS.preview],[CHANNELS.reload],[CHANNELS.chatter,{automaticWhispers:true}]])assert.equal((await f.invoke(channel,value)).code,'host_unavailable');
 assert.equal(f.calls.length,0);const cancelled=await f.invoke(CHANNELS.host,'harness');assert.equal(cancelled.ok,true);assert.equal(cancelled.cancelled,true);
});
test('角色与启动设置经已有控制器执行，非法形态和联动应用不会下发',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();
 assert.equal((await f.invoke(CHANNELS.character,'curly-sheep')).ok,true);assert.deepEqual(f.calls.find(call=>call.via==='skin-select'),{via:'skin-select',value:{character:'curly-sheep',mode:'q'}});
 assert.equal((await f.invoke(CHANNELS.character,'sister')).code,'invalid_input');assert.equal((await f.invoke(CHANNELS.startup,'startup')).ok,true);assert.equal((await f.invoke(CHANNELS.preview)).ok,true);assert.equal((await f.invoke(CHANNELS.host,'workbuddy')).ok,true);assert.deepEqual(f.calls.at(-1),{via:'host-select',value:'workbuddy'});assert.equal((await f.invoke(CHANNELS.host,'other')).code,'invalid_input');
});
test('控制中心复用的角色select仍清除旧气泡、向宠物广播并更新聊天角色',async t=>{
 const fs=require('node:fs/promises'),{tmpdir}=require('node:os'),Skins=require('./codex-skins.cjs');
 const directory=await fs.mkdtemp(path.join(tmpdir(),'control-skin-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const dragon=path.join(directory,'skins','white-dragon');await fs.mkdir(dragon,{recursive:true});
 const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(400,16);png.writeUInt32BE(400,20);await fs.writeFile(path.join(dragon,'idle.png'),png);await fs.writeFile(path.join(dragon,'manifest.json'),JSON.stringify({schemaVersion:1,profiles:{idle:{file:'idle.png',frames:[[0,0],[1,0]]}}}));await fs.writeFile(path.join(directory,'skins','selection.json'),'{"character":"white-dragon","mode":"q"}');
 const channels=new Map(),app=new EventEmitter(),sent=[],cleared=[],changed=[];
 const ipcMain={handle:(key,fn)=>channels.set(key,fn),removeHandler:key=>channels.delete(key)};
 const contents={getURL:()=>pathToFileURL(path.join(__dirname,'index.html')).href,send:(...args)=>sent.push(args)};
 const store=Skins.install({dataRoot:directory,electronApi:{app,ipcMain,BrowserWindow:{getAllWindows:()=>[{isDestroyed:()=>false,webContents:contents}]}},hostRequest:async(method,route)=>{if(method==='POST'){cleared.push(route);return{status:200,body:'{"ok":true}'};}return{status:200,body:'{"main":{"animations":{"idle":["breathing"],"moves":{"actions":[]}}}}'};},onSelectionChanged:value=>changed.push(value.selection.character)});
 const result=await store.select({character:'bluefish',mode:'q'});assert.equal(result.selection.character,'bluefish');assert.deepEqual(cleared,['/dsh-pet-7340/bubble/clear?pet=main']);assert.equal(sent[0][0],'codex-skin:changed');assert.deepEqual(changed,['bluefish']);app.emit('before-quit');
});
test('保存互斥且失败可重试，卸载后旧面板不能继续更改配置',async t=>{
 let release;const wait=new Promise(resolve=>{release=resolve;});const f=fixture({dependencies:{startup:{state:()=>({mode:'both'}),setMode:()=>wait,open:async()=>true}}});t.after(()=>f.controller.dispose());await f.controller.open();
 const changing=f.invoke(CHANNELS.startup,'pet');assert.equal((await f.invoke(CHANNELS.character,'bluefish')).code,'busy');release({mode:'pet'});assert.equal((await changing).ok,true);assert.equal((await f.invoke(CHANNELS.character,'bluefish')).ok,true);
 const event=f.event();const old=f.handlers.get(CHANNELS.character);f.controller.dispose();assert.equal((await old(event,'white-dragon')).code,'unauthorized');assert.equal(f.handlers.size,0);
});
