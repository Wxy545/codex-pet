import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const require=createRequire(import.meta.url);
let QQ={};try{QQ=require('../src/qq-window.cjs');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
const L=require('../src/codex-locale.cjs');
const folder=resolve('synthetic-qq-project'),other=resolve('synthetic-other-project');
function fixture(options={}){
 assert.equal(typeof QQ.createController,'function','QQ settings controller is missing');
 const handlers=new Map(),windows=[],calls=[],links=[],copied=[];
 const app=new EventEmitter();app.whenReady=async()=>{};
 const ipcMain=new EventEmitter();ipcMain.handle=(name,fn)=>handlers.set(name,fn);ipcMain.removeHandler=name=>handlers.delete(name);
 class BrowserWindow extends EventEmitter{
  static fromWebContents(contents){return windows.find(w=>w.webContents===contents);}
  constructor(settings){super();this.settings=settings;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.getURL=()=>this.url;this.webContents.setWindowOpenHandler=fn=>{this.newWindow=fn;};windows.push(this);}
  setMenu(){}isDestroyed(){return !!this.destroyed;}isMinimized(){return false;}show(){}focus(){}
  async loadFile(file){this.url=pathToFileURL(file).href;}
  destroy(){this.destroyed=true;this.emit('closed');}
 }
 let state={enabled:false,configured:true,appId:'12345678',connection:{state:'stopped'},paired:false,project:{cwd:folder,permission:'read-only'},pairing:null,task:null,pendingReplies:0};
 let selected=folder;
 const controller=QQ.createController({electron:{BrowserWindow,ipcMain,app,clipboard:{writeText:value=>copied.push(value)},shell:{openExternal:async url=>links.push(url)},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[selected]}),showMessageBox:async()=>({response:1})}},fsImpl:{realpath:async target=>target,stat:async()=>({isDirectory:()=>true}),...options.fsImpl},hostRequest:async(method,route,body)=>{
  calls.push({method,route,body});if(options.hostRequest)return options.hostRequest(method,route,body);
  if(method==='POST'){const value=JSON.parse(body);if(value.action==='save')state={...state,appId:value.appId,enabled:value.enabled,project:{cwd:value.cwd,permission:value.permission}};if(value.action==='disable')state={...state,enabled:false,connection:{state:'stopped'}};if(value.action==='pair')state={...state,pairing:{code:'123456',expiresAt:'2026-10-30T11:00:00.000Z'}};}
  return{status:200,body:JSON.stringify(state)};
 }});
 const event=()=>({sender:windows.at(-1).webContents,senderFrame:windows.at(-1).webContents.mainFrame});
 return{controller,windows,handlers,calls,links,copied,app,ipcMain,event,invoke:(key,body,source=event())=>handlers.get(QQ.CHANNELS[key])(source,body),setDirectory:value=>{selected=value;},setState:value=>{state=value;}};
}

test('QQ设置拒绝其他页面和子frame，打开窗口不给渲染器Node权限',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();
 const win=f.windows[0];assert.equal(win.settings.webPreferences.nodeIntegration,false);assert.equal(win.settings.webPreferences.contextIsolation,true);assert.equal(win.settings.webPreferences.sandbox,true);
 assert.deepEqual(win.newWindow({url:'https://example.com'}),{action:'deny'});
 const foreign={sender:{getURL:()=>win.url},senderFrame:{}};
 for(const key of ['state','directory','save','action','platform'])assert.equal((await f.invoke(key,{},foreign)).code,'unauthorized');
 assert.equal((await f.invoke('state',undefined,{sender:win.webContents,senderFrame:{}})).code,'unauthorized');assert.equal(f.calls.length,0);
});

test('设置响应只投影公开字段，不把AppSecret、QQ身份或原始错误回传窗口',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();
 f.setState({enabled:true,configured:true,appId:'12345678',appSecret:'synthetic-secret',token:'synthetic-token',ownerId:'private-owner',connection:{state:'error',code:'secret traceback',message:'synthetic-secret'},paired:true,project:{cwd:folder,permission:'read-only'},pairing:null,task:{state:'working',text:'private task'},pendingReplies:2});
 const view=await f.invoke('state');assert.equal(view.ok,true);assert.equal(view.snapshot.appId,'12345678');assert.equal(view.snapshot.paired,true);assert.equal(view.snapshot.pendingReplies,2);
 assert.doesNotMatch(JSON.stringify(view),/synthetic-secret|synthetic-token|private-owner|private task|secret traceback/);
});

test('保存只能使用已保存或原生选择的项目目录，不能从页面替换到另一个目录',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();await f.invoke('state');
 const body={appId:'12345678',appSecret:'synthetic-secret',cwd:folder,permission:'read-only',enabled:true};
 assert.equal((await f.invoke('save',{...body,cwd:other})).code,'invalid_cwd');
 assert.equal((await f.invoke('save',{...body,permission:'danger-full-access'})).code,'invalid_input');assert.equal(f.calls.some(c=>c.method==='POST'),false);
 f.setDirectory(other);assert.equal((await f.invoke('directory')).directory,other);
 const saved=await f.invoke('save',{...body,cwd:other,permission:'workspace-write'});assert.equal(saved.ok,true);assert.equal(saved.snapshot.project.cwd,other);
 const post=f.calls.find(c=>c.method==='POST');assert.equal(post.route,'/dsh-pet-7340/qq-remote');assert.deepEqual(JSON.parse(post.body),{action:'save',...body,cwd:other,permission:'workspace-write'});assert.doesNotMatch(JSON.stringify(saved),/synthetic-secret/);
});

test('空密钥保存保留原密钥，配对和停用只发送固定动作',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();await f.invoke('state');
 assert.equal((await f.invoke('save',{appId:'12345678',appSecret:'',cwd:folder,permission:'read-only',enabled:true})).ok,true);
 const pair=await f.invoke('action','pair');assert.equal(pair.snapshot.pairing.code,'123456');
 const disabled=await f.invoke('action','disable');assert.equal(disabled.snapshot.enabled,false);
 assert.equal((await f.invoke('action','shell-command')).code,'invalid_input');
 assert.deepEqual(f.calls.filter(c=>c.method==='POST').map(c=>JSON.parse(c.body)),[{action:'save',appId:'12345678',cwd:folder,permission:'read-only',enabled:true},{action:'pair'},{action:'disable'}]);
});

test('平台按钮仅打开固定QQ官方地址，关闭面板不停止连接',async t=>{
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();
 assert.equal((await f.invoke('platform','https://example.com')).ok,true);assert.deepEqual(f.links,['https://q.qq.com/']);
 f.windows[0].destroy();assert.equal(f.calls.length,0);
 await f.controller.open();assert.equal(f.windows.length,2);f.controller.dispose();assert.equal(f.handlers.size,0);
});

test('复制配对消息只读取本机当前六位码，不接受页面传入的其他内容',async t=>{
 L.setLocale('en');t.after(()=>L.setLocale('zh-CN'));
 const f=fixture();t.after(()=>f.controller.dispose());await f.controller.open();
 assert.equal(typeof f.handlers.get(QQ.CHANNELS.copyPairing),'function','Pairing-copy handler is missing');
 assert.equal((await f.invoke('copyPairing','private secret')).ok,false);assert.deepEqual(f.copied,[]);
 f.setState({enabled:true,configured:true,appId:'12345678',connection:{state:'connected'},paired:false,project:{cwd:folder,permission:'read-only'},pairing:{code:'123456',expiresAt:'2099-10-30T11:00:00.000Z'},pendingReplies:0});
 assert.equal((await f.invoke('copyPairing','private secret')).ok,true);assert.deepEqual(f.copied,['/pair 123456']);
});

test('宿主错误只显示固定本地化文案，英文窗口没有中文内部解释',async t=>{
 L.setLocale('en');t.after(()=>L.setLocale('zh-CN'));
 const f=fixture({hostRequest:async()=>({status:400,body:JSON.stringify({error:{code:'invalid_secret',message:'私密错误和密钥'}})})});t.after(()=>f.controller.dispose());await f.controller.open();
 const result=await f.invoke('state');assert.equal(result.ok,false);assert.equal(result.code,'invalid_secret');assert.doesNotMatch(result.message,/[\u3400-\u9fff]/);assert.doesNotMatch(JSON.stringify(result),/私密错误/);
});

test('设置页轮询失败显示不可达且同错误只提示一次，恢复连接后可以重新提示',async()=>{
 const elements=new Map(),intervals=new Map(),timeouts=new Map(),windowEvents=new Map();let sequence=0,offline=false,shown=0;
 const radio={value:'read-only',checked:true};
 const controlIds=['app-id','app-secret','directory','save','disable','refresh','pair','unlink','copy-pair','choose-directory','platform'];
 function element(id){
  if(elements.has(id))return elements.get(id);
  let hidden=false;const item={value:'',disabled:false,textContent:'',dataset:{},setAttribute(){},addEventListener(){},select(){},querySelector:()=>radio,querySelectorAll:()=>controlIds.map(element)};
  Object.defineProperty(item,'hidden',{get:()=>hidden,set:value=>{hidden=value;if(id==='message'&&value===false)shown++;}});
  elements.set(id,item);return item;
 }
 const document={hidden:false,title:'',documentElement:{lang:''},getElementById:element,querySelectorAll:()=>[],addEventListener(){}};
 const state={enabled:true,configured:true,appId:'123456',connection:{state:'connected'},paired:false,project:{cwd:'C:/synthetic-project',permission:'read-only'},pairing:null,task:{state:'idle'},pendingReplies:0,locale:'en'};
 const window={qqRemote:{getState:async()=>{if(offline)throw Error('private transport details');return{ok:true,snapshot:structuredClone(state)};}},addEventListener:(name,fn)=>windowEvents.set(name,fn)};
 vm.runInNewContext(readFileSync(new URL('../src/qq-window.js',import.meta.url),'utf8'),{window,document,navigator:{language:'en-US'},Date,setInterval:(fn,ms)=>{const id=++sequence;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id),setTimeout:(fn,ms)=>{const id=++sequence;timeouts.set(id,{fn,ms});return id;},clearTimeout:id=>timeouts.delete(id)});
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 const poll=async()=>{[...intervals.values()].find(item=>item.ms===2500).fn();await settle();};
 try{
  await settle();assert.equal(element('connection').textContent,'Connected');assert.equal(element('connection').dataset.state,'connected');assert.equal(element('pair').disabled,false);
  offline=true;await poll();assert.match(element('connection').textContent,/unavailable/i);assert.equal(element('connection').dataset.state,'error');assert.equal(element('pair').disabled,true);assert.equal(shown,1);
  for(const timer of timeouts.values())timer.fn();assert.equal(element('message').hidden,true);
  await poll();assert.equal(shown,1);assert.equal(element('message').hidden,true);
  offline=false;await poll();assert.equal(element('connection').textContent,'Connected');assert.equal(element('connection').dataset.state,'connected');assert.equal(element('pair').disabled,false);
  offline=true;await poll();assert.equal(shown,2);assert.doesNotMatch(element('message').textContent,/private transport/);
 }finally{windowEvents.get('beforeunload')();}
});
