import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);let Memory={};try{Memory=require('../src/memory-window.cjs');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
const SID='memory-synthetic',ID='00000000-0000-4000-8000-000000000001',TICKET={scope:'a'.repeat(64),revision:1};
async function fixture(t,options={}){
 assert.equal(typeof Memory.createController,'function','缺少记忆管理窗口');const folder=await mkdtemp(join(tmpdir(),'memory-window-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 const handlers=new Map(),ipcMain=new EventEmitter();ipcMain.handle=(name,fn)=>handlers.set(name,fn);ipcMain.removeHandler=name=>handlers.delete(name);const app=new EventEmitter();app.whenReady=async()=>{};
 const windows=[],calls=[],dialogs=[];let scopes=[{scopeId:SID,label:'本人 · 白龙娘'}],confirm=1;
 class BrowserWindow extends EventEmitter{static fromWebContents(sender){return windows.find(x=>x.webContents===sender);}constructor(value){super();this.options=value;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.getURL=()=>this.url;this.webContents.setWindowOpenHandler=fn=>this.windowOpen=fn;this.webContents.session={setPermissionRequestHandler:fn=>this.permission=fn};windows.push(this);}setMenu(){}isDestroyed(){return this.destroyed===true;}isMinimized(){return false;}show(){}focus(){}async loadFile(file){this.url=pathToFileURL(file).href;}destroy(){this.destroyed=true;this.emit('closed');}}
 const record={id:ID,role:'user',text:'仅本人范围的原文',status:'active',createdAt:'2026-11-02T00:00:00.000Z',source:{kind:'chat',speaker:'owner',confirmation:'stated'},summary:{text:'原文索引',method:'extractive',keywords:[]}};
 const controller=Memory.createController({hostRequest:async(method,route,body)=>{calls.push({method,route,body});const input=body?JSON.parse(body):{};let payload=method==='GET'?{scopes}:route.endsWith('/export')?{schemaVersion:1,records:[record]}:input.id?{record,ticket:TICKET}:{items:[record],total:1,ticket:TICKET,retentionDays:null};if(options.hostRequest)payload=await options.hostRequest(method,route,input,payload);return{status:200,body:JSON.stringify(payload)};},electron:{app,BrowserWindow,ipcMain,dialog:{showMessageBox:async(...args)=>{dialogs.push(args);if(options.beforeConfirm)await options.beforeConfirm();return{response:confirm};},showSaveDialog:async()=>({canceled:false,filePath:join(folder,'memory.json')})}},fileRoot:resolve('src')});
 t.after(()=>controller.dispose());const event=()=>({sender:windows.at(-1).webContents,senderFrame:windows.at(-1).webContents.mainFrame});const invoke=(name,body,ev=event())=>handlers.get(name)(ev,body);
 return{controller,handlers,windows,calls,dialogs,folder,invoke,setScopes:value=>scopes=value,setConfirm:value=>confirm=value};
}

test('记忆窗口单实例、隔离Node，外部页面和子frame不能读取记忆',async t=>{
 const f=await fixture(t);await f.controller.open();await f.controller.open();assert.equal(f.windows.length,1);const w=f.windows[0];assert.equal(w.options.webPreferences.nodeIntegration,false);assert.equal(w.options.webPreferences.contextIsolation,true);assert.equal(w.options.webPreferences.sandbox,true);assert.deepEqual(w.windowOpen({url:'https://example.invalid'}),{action:'deny'});
 const denied=await f.invoke(Memory.CHANNELS.scopes,undefined,{sender:w.webContents,senderFrame:{}});assert.equal(denied.code,'unauthorized');assert.equal(f.calls.length,0);
});
test('记忆管理接受后端完整512范围上限，超限仍拒绝',async t=>{
 const f=await fixture(t);await f.controller.open();
 const scopes=Array.from({length:512},(_,i)=>({scopeId:i.toString(16).padStart(64,'0'),label:'合成范围 '+i}));
 f.setScopes(scopes);const result=await f.invoke(Memory.CHANNELS.scopes);assert.equal(result.ok,true);assert.equal(result.scopes.length,512);
 f.setScopes([...scopes,{scopeId:'f'.repeat(64),label:'超出上限'}]);assert.equal((await f.invoke(Memory.CHANNELS.scopes)).ok,false);
});

test('范围只从后端取且IPC不接受scope、路径或未知动作',async t=>{
 const f=await fixture(t);await f.controller.open();assert.equal((await f.invoke(Memory.CHANNELS.scopes)).scopes[0].scopeId,SID);
 for(const body of [{action:'query',scopeId:SID,scope:{actor:'other'}},{action:'query',scopeId:SID,path:'C:/private'},{action:'export',scopeId:SID},{action:'shell',scopeId:SID},{action:'query',scopeId:'not-authorized'}])assert.equal((await f.invoke(Memory.CHANNELS.request,body)).ok,false);
 assert.equal(f.calls.some(x=>x.method==='POST'),false);const result=await f.invoke(Memory.CHANNELS.request,{action:'query',scopeId:SID,includeText:false});assert.equal(result.ok,true);assert.equal(result.items.length,1);
});

test('导出必须原生本人确认再另存，渲染器不能指定目标文件',async t=>{
 const f=await fixture(t);await f.controller.open();f.setConfirm(0);assert.equal((await f.invoke(Memory.CHANNELS.export,{scopeId:SID})).cancelled,true);assert.equal(f.calls.some(x=>JSON.parse(x.body??'{}').action==='export'),false);
 f.setConfirm(1);const result=await f.invoke(Memory.CHANNELS.export,{scopeId:SID});assert.equal(result.ok,true);assert.equal(JSON.parse(await readFile(join(f.folder,'memory.json'),'utf8')).records.length,1);const exported=f.calls.find(call=>call.route.endsWith('/export'));assert.equal(exported.method,'POST');assert.deepEqual(JSON.parse(exported.body),{scopeId:SID});
 assert.equal((await f.invoke(Memory.CHANNELS.export,{scopeId:SID,path:'C:/anything.json'})).code,'invalid_input');
});

test('删除与清空在原生确认后重新核对范围，关闭或撤销范围不能执行',async t=>{
 let f;f=await fixture(t,{beforeConfirm:async()=>f.setScopes([])});await f.controller.open();const result=await f.invoke(Memory.CHANNELS.request,{action:'clear',scopeId:SID,ticket:TICKET});assert.equal(result.ok,false);assert.equal(f.calls.some(x=>x.method==='POST'),false);
});

test('只允许有限的记忆操作与修订票据，不转发凭据和宿主原始错误',async t=>{
 const f=await fixture(t);await f.controller.open();const bad={action:'correct',scopeId:SID,id:ID,text:'改正',ticket:{...TICKET,other:'bad'}};assert.equal((await f.invoke(Memory.CHANNELS.request,bad)).code,'invalid_input');
 const good=await f.invoke(Memory.CHANNELS.request,{action:'correct',scopeId:SID,id:ID,text:'新的记忆',ticket:TICKET});assert.equal(good.ok,true);assert.deepEqual(JSON.parse(f.calls.find(x=>x.method==='POST').body),{action:'correct',scopeId:SID,id:ID,text:'新的记忆',ticket:TICKET});
});

test('关闭只关闭管理窗口，注销所有handler，不清空记忆或发起模型',async t=>{
 const f=await fixture(t);await f.controller.open();f.controller.dispose();assert.equal(f.handlers.size,0);assert.equal(f.calls.length,0);assert.equal(f.windows[0].isDestroyed(),true);
});

test('导出只保留记忆格式，宿主误附带的设置和秘密字段不进入JSON',async t=>{
 const f=await fixture(t,{hostRequest:(_method,route,input,payload)=>route.endsWith('/export')?{...payload,AppSecret:'DO-NOT-EXPORT',dataRoot:'C:/private'}:payload});await f.controller.open();assert.equal((await f.invoke(Memory.CHANNELS.export,{scopeId:SID})).ok,true);const content=await readFile(join(f.folder,'memory.json'),'utf8');assert.equal(content.includes('DO-NOT-EXPORT'),false);assert.equal(content.includes('C:/private'),false);
});

test('角色设置使用固定鉴权路由且仅投影三宿主共享与无工具聊天模式，不开放公众或路径',async t=>{
 const settings={schemaVersion:1,revision:0,hosts:Object.fromEntries(['codex','workbuddy','harness'].map(host=>[host,{revision:0,shareOwnerMemory:false,qqMode:'task'}]))};
 const f=await fixture(t,{hostRequest:(_method,route,_input,payload)=>route.endsWith('/pet-role/settings')?{...settings,AppSecret:'not-visible'}:payload});await f.controller.open();
 const first=await f.invoke(Memory.CHANNELS.settings,{action:'get'});assert.equal(first.ok,true);assert.equal(first.settings.hosts.codex.shareOwnerMemory,false);assert.equal(JSON.stringify(first).includes('not-visible'),false);
 const body={action:'save',host:'codex',revision:0,shareOwnerMemory:true,qqMode:'role'};assert.equal((await f.invoke(Memory.CHANNELS.settings,body)).ok,true);const call=f.calls.find(x=>x.method==='POST');assert.equal(call.route,'/dsh-pet-7340/pet-role/settings');assert.deepEqual(JSON.parse(call.body),{host:'codex',revision:0,shareOwnerMemory:true,qqMode:'role'});
 for(const bad of [{...body,publicChatEnabled:true},{...body,host:'other'},{...body,path:'C:/private'},{...body,shell:true},{...body,revision:-1}])assert.equal((await f.invoke(Memory.CHANNELS.settings,bad)).code,'invalid_input');
 const w=f.windows[0];assert.equal((await f.invoke(Memory.CHANNELS.settings,{action:'get'},{sender:w.webContents,senderFrame:{}})).code,'unauthorized');
});
