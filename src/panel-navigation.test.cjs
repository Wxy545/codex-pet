'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {createController,installPreload,CHANNEL}=require('./panel-navigation.cjs');

function fixture(options={}){
 const handlers=new Map(),windows=new Map(),opened=[],app=new EventEmitter();
 const ipcMain={handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)};
 const fileRoot=path.resolve('synthetic-panel-root');
 const controller=createController({electron:{app,ipcMain,BrowserWindow:{fromWebContents:contents=>windows.get(contents)}},fileRoot,host:options.host||'codex',openPanel:async name=>{opened.push(name);await options.openPanel?.(name);}});
 const makeWindow=(file='chat-window.html')=>{
  const win={destroyed:false,hidden:0,isDestroyed(){return this.destroyed;},hide(){this.hidden++;}};
  const contents={mainFrame:{},getURL:()=>pathToFileURL(path.join(fileRoot,file)).href};win.webContents=contents;windows.set(contents,win);
  return{win,contents,event:{sender:contents,senderFrame:contents.mainFrame}};
 };
 return{controller,handlers,windows,opened,app,makeWindow,navigate:(event,name)=>handlers.get(CHANNEL)(event,name)};
}

function realPanelFixture(name,options={}){
 const modules={settings:require('./control-window.cjs'),chat:require('./codex-chat-window.cjs'),tasks:require('./codex-task-window.cjs'),qq:require('./qq-window.cjs')};
 const handlers=new Map(),windows=[],calls=[],app=new EventEmitter();app.whenReady=options.whenReady||(async()=>{});
 const ipcMain=new EventEmitter();ipcMain.handle=(channel,handler)=>handlers.set(channel,handler);ipcMain.removeHandler=channel=>handlers.delete(channel);
 const fileRoot=path.resolve('synthetic-panel-root');
 class BrowserWindow extends EventEmitter{
  static fromWebContents(contents){return windows.find(win=>win.webContents===contents);}
  constructor(){super();this.destroyed=false;this.hidden=0;this.shown=0;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.getURL=()=>this.url;this.webContents.setWindowOpenHandler=()=>{};windows.push(this);}
  isDestroyed(){return this.destroyed;}isMinimized(){return false;}setMenu(){}setTitle(){}focus(){}show(){this.shown++;}hide(){this.hidden++;}
  async loadFile(file){this.url=pathToFileURL(file).href;await options.loadFile?.(this);this.emit('ready-to-show');}
  destroy(){this.destroyed=true;this.emit('closed');}
 }
 const electron={app,ipcMain,BrowserWindow};
 const hostRequest=async(...args)=>{calls.push(args);return{status:200,body:JSON.stringify({id:'white-dragon',name:'Synthetic dragon',locale:'en'})};};
 const target=modules[name].createController({electron,hostRequest,apiRequest:hostRequest,fileRoot,canUse:options.canUse,
  skins:{readModel:async()=>({}),select:async()=>({})},startup:{state:()=>({mode:'both'}),setMode:async()=>({}),open:async()=>true},petHost:{get:()=>({host:'codex'}),select:async()=>({})}});
 const navigation=createController({electron,fileRoot,host:'codex',openPanel:()=>target.open()});
 function source(){const win=new BrowserWindow();win.url=pathToFileURL(path.join(fileRoot,name==='qq'?'chat-window.html':'qq-window.html')).href;return win;}
 return{windows,target,source,handlers,calls,channels:modules[name].CHANNELS,navigate:from=>handlers.get(CHANNEL)({sender:from.webContents,senderFrame:from.webContents.mainFrame},name),dispose(){navigation.dispose();target.dispose();}};
}

test('原生移交后隐藏已有Codex功能页并拒绝旧IPC，恢复Codex仍可打开原窗口',async t=>{
 for(const name of ['chat','tasks','qq'])await t.test(name,async child=>{
  let enabled=true;const f=realPanelFixture(name,{canUse:()=>enabled});child.after(()=>f.dispose());
  await f.target.open();const win=f.windows[0],event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  enabled=false;f.target.hide();assert.equal(win.hidden,1);assert.equal(win.destroyed,false);
  const before=f.calls.length;
  for(const channel of Object.values(f.channels))if(f.handlers.has(channel))assert.equal((await f.handlers.get(channel)(event,{})).ok,false,channel);
  assert.equal(f.calls.length,before);const source=f.source();assert.deepEqual(await f.navigate(source),{ok:false,code:'unavailable'});assert.equal(source.hidden,0);
  enabled=true;await f.target.open();assert.equal(f.windows.filter(value=>value!==source).length,1);assert.equal(win.destroyed,false);
 });
});

test('打开期间切为原生Harness或能力探测失败时目标不显示且来源不隐藏',async t=>{
 for(const name of ['chat','tasks','qq'])await t.test(name,async child=>{
  let enabled=true,release;const loading=new Promise(resolve=>{release=resolve;});
  const f=realPanelFixture(name,{canUse:()=>{if(enabled==='throw')throw Error('synthetic');return enabled;},loadFile:()=>loading});child.after(()=>f.dispose());
  const source=f.source(),opening=f.navigate(source);await new Promise(setImmediate);enabled=false;release();
  assert.deepEqual(await opening,{ok:false,code:'unavailable'});assert.equal(source.hidden,0);assert.equal(f.windows[1].shown,0);
  enabled='throw';await assert.rejects(f.target.open(),/unavailable/);
 });
});

test('固定四种面板名，任意URL、路径及原型名称不能成为打开目标',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());const {event}=f.makeWindow();
 for(const name of ['settings','chat','tasks','qq'])assert.equal((await f.navigate(event,name)).ok,true);
 assert.deepEqual(f.opened,['settings','chat','tasks','qq']);
 for(const name of ['https://example.com','file:///C:/other.html','../chat-window.html','chat-window.html','constructor','__proto__','',null,{}]){
  assert.deepEqual(await f.navigate(event,name),{ok:false,code:'unavailable'});
 }
 assert.equal(f.opened.length,4);
});

test('只接受本地已登记窗口主frame，外部页面、子frame、伪造或已关闭窗口均拒绝',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());const valid=f.makeWindow();
 const foreign=f.makeWindow();foreign.contents.getURL=()=> 'https://example.com/chat-window.html';
 const other=f.makeWindow('unrelated.html');
 const fake=f.makeWindow();f.windows.delete(fake.contents);
 const closed=f.makeWindow();closed.win.destroyed=true;
 for(const event of [foreign.event,other.event,fake.event,closed.event,{sender:valid.contents,senderFrame:{}},{sender:valid.contents},{}]){
  assert.deepEqual(await f.navigate(event,'settings'),{ok:false,code:'unauthorized'});
 }
 assert.equal(f.opened.length,0);
});

test('本地宠物页的查询参数不影响身份，导航不会隐藏宠物',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());const {event,contents,win}=f.makeWindow('index.html');
 const url=contents.getURL();contents.getURL=()=>url+'?petIndex=1#synthetic';
 assert.deepEqual(await f.navigate(event,'settings'),{ok:true});
 assert.deepEqual(f.opened,['settings']);assert.equal(win.hidden,0);
});

test('WorkBuddy开放独立QQ连接面板，仍拒绝Codex聊天和任务入口',async t=>{
 const f=fixture({host:'workbuddy'});t.after(()=>f.controller.dispose());const {event}=f.makeWindow('control-window.html');
 for(const name of ['chat','tasks'])assert.deepEqual(await f.navigate(event,name),{ok:false,code:'unavailable'});
 assert.equal(f.opened.length,0);assert.deepEqual(await f.navigate(event,'settings'),{ok:true});assert.deepEqual(f.opened,['settings']);
 assert.deepEqual(await f.navigate(event,'qq'),{ok:true});assert.deepEqual(f.opened,['settings','qq']);
});

test('宿主动态切到原生Harness时现有面板不能继续导航Codex功能，恢复后重新开放',async t=>{
 let host='codex';const f=fixture({host:()=>host});t.after(()=>f.controller.dispose());const {event}=f.makeWindow('control-window.html');
 assert.equal((await f.navigate(event,'chat')).ok,true);
 host='harness';assert.deepEqual(f.handlers.get('codex-panels:state')(event),{ok:true,host:'harness'});
 for(const name of ['chat','tasks'])assert.deepEqual(await f.navigate(event,name),{ok:false,code:'unavailable'});
 assert.deepEqual(await f.navigate(event,'settings'),{ok:true});assert.deepEqual(await f.navigate(event,'qq'),{ok:true});assert.deepEqual(f.opened,['chat','settings','qq']);
 host='codex';assert.deepEqual(await f.navigate(event,'tasks'),{ok:true});
});

test('目标成功打开后才隐藏旧面板，等待期间旧界面保持可用',async t=>{
 let release;const opened=new Promise(resolve=>{release=resolve;});
 const f=fixture({openPanel:()=>opened});t.after(()=>f.controller.dispose());const {event,win}=f.makeWindow();
 const navigation=f.navigate(event,'tasks');await Promise.resolve();assert.equal(win.hidden,0);
 release();assert.deepEqual(await navigation,{ok:true});assert.equal(win.hidden,1);
});

test('打开失败、同页导航或旧窗口已关闭时不隐藏其它窗口',async t=>{
 const failed=fixture({openPanel:async()=>{throw Error('synthetic open failure');}});t.after(()=>failed.controller.dispose());const old=failed.makeWindow();
 assert.deepEqual(await failed.navigate(old.event,'tasks'),{ok:false,code:'unavailable'});assert.equal(old.win.hidden,0);
 const same=fixture();t.after(()=>same.controller.dispose());const current=same.makeWindow('qq-window.html');
 assert.deepEqual(await same.navigate(current.event,'qq'),{ok:true});assert.equal(current.win.hidden,0);
 let release;const delayed=new Promise(resolve=>{release=resolve;});
 const closed=fixture({openPanel:()=>delayed});t.after(()=>closed.controller.dispose());const gone=closed.makeWindow();const navigation=closed.navigate(gone.event,'settings');gone.win.destroyed=true;release();
 assert.deepEqual(await navigation,{ok:true});assert.equal(gone.win.hidden,0);
});

test('四种真实面板加载失败均保留来源窗口并可重试，加载错误不泄露本机路径',async t=>{
 for(const name of ['settings','chat','tasks','qq'])await t.test(name,async child=>{
  let failLoad=true;
  const f=realPanelFixture(name,{loadFile:async()=>{if(failLoad){failLoad=false;throw Error('C:/private-path/unavailable-panel.html');}}});child.after(()=>f.dispose());
  const source=f.source();
  assert.deepEqual(await f.navigate(source),{ok:false,code:'unavailable'});
  assert.equal(source.hidden,0);assert.equal(f.windows[1].destroyed,true);
  failLoad=true;await assert.rejects(f.target.open(),error=>error.message==='unavailable');assert.equal(f.windows[2].destroyed,true);
  assert.deepEqual(await f.navigate(source),{ok:true});assert.equal(source.hidden,1);assert.equal(f.windows[3].shown,1);
 });
});

test('并发打开等待同一次加载，首次失败不会提前隐藏任一来源，之后可正常重试',async t=>{
 for(const name of ['chat','tasks','qq'])await t.test(name,async child=>{
  let rejectLoad;let fail=true;const loading=new Promise((_resolve,reject)=>{rejectLoad=reject;});
  const f=realPanelFixture(name,{loadFile:()=>fail?loading:Promise.resolve()});child.after(()=>f.dispose());
  const first=f.source(),second=f.source();let settled=0;
  const a=f.navigate(first).then(value=>{settled++;return value;}),b=f.navigate(second).then(value=>{settled++;return value;});
  await new Promise(setImmediate);assert.equal(settled,0);assert.equal(f.windows.length,3);assert.equal(first.hidden+second.hidden,0);
  rejectLoad(Error('C:/private-load-failure'));for(const result of await Promise.all([a,b]))assert.deepEqual(result,{ok:false,code:'unavailable'});
  assert.equal(first.hidden+second.hidden,0);assert.equal(f.windows[2].destroyed,true);
  fail=false;assert.deepEqual(await f.navigate(first),{ok:true});assert.equal(first.hidden,1);assert.equal(f.windows.length,4);
 });
});

test('等待应用就绪或页面加载时释放控制器，不显示目标也不隐藏导航来源',async t=>{
 for(const name of ['settings','chat','tasks','qq'])for(const stage of ['ready','load'])await t.test(`${name}/${stage}`,async child=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const f=realPanelFixture(name,{whenReady:stage==='ready'?()=>pending:async()=>{},loadFile:stage==='load'?()=>pending:async()=>{}});child.after(()=>f.dispose());
  const source=f.source(),opening=f.navigate(source);await new Promise(setImmediate);f.target.dispose();finish();
  assert.deepEqual(await opening,{ok:false,code:'unavailable'});assert.equal(source.hidden,0);
  assert.equal(f.windows.filter(win=>win!==source).reduce((total,win)=>total+win.shown,0),0);
  await assert.rejects(f.target.open(),error=>error.message==='unavailable');
 });
});

test('dispose和应用退出移除处理器，已持有的旧handler不能再次导航',async()=>{
 for(const exit of [false,true]){
  const f=fixture(),{event}=f.makeWindow(),handler=f.handlers.get(CHANNEL);assert.equal(f.app.listenerCount('before-quit'),1);
  if(exit)f.app.emit('before-quit');else f.controller.dispose();
  f.controller.dispose();assert.equal(f.handlers.size,0);assert.equal(f.app.listenerCount('before-quit'),0);
  assert.deepEqual(await handler(event,'settings'),{ok:false,code:'unauthorized'});assert.equal(f.opened.length,0);
 }
});

test('preload只暴露冻结的宿主与固定导航能力，不提供URL或命令执行器',async()=>{
 const before=process.env.CODEX_PET_HOST;
 try{
  for(const host of ['codex','workbuddy']){
   process.env.CODEX_PET_HOST=host;let exposed;const calls=[];
   installPreload({contextBridge:{exposeInMainWorld:(name,value)=>{exposed={name,value};}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return{ok:true};}}});
   assert.equal(exposed.name,'petPanels');assert.equal(exposed.value.host,host);assert.ok(Object.isFrozen(exposed.value));
   assert.deepEqual(Object.keys(exposed.value),['host','getState','onChanged','navigate']);await exposed.value.navigate('settings');await exposed.value.getState();assert.deepEqual(calls,[[CHANNEL,'settings'],['codex-panels:state']]);
  }
 }finally{if(before===undefined)delete process.env.CODEX_PET_HOST;else process.env.CODEX_PET_HOST=before;}
});
