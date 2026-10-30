'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const vm=require('node:vm');
const Host=require('./pet-host-menu.cjs');
function fixture(status=202){
 const app=new EventEmitter(),handlers=new Map(),calls=[],dialogs=[],frame={};
 const sender={mainFrame:frame,getURL:()=>pathToFileURL(join(__dirname,'index.html')).href};
 const electron={app,ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},BrowserWindow:{fromWebContents:s=>s===sender?{}:null},dialog:{showMessageBox:async v=>dialogs.push(v)}};
 const controller=Host.createController({electron,host:'workbuddy',hostRequest:async(...args)=>{calls.push(args);return{status,body:JSON.stringify({host:'codex',restarting:true})};}});
 return{controller,app,handlers,calls,dialogs,event:{sender,senderFrame:frame}};
}
test('宿主切换IPC仅允许本项目宠物主frame，外部页面和子frame不能切换',async()=>{
 const f=fixture();assert.equal(f.handlers.get(Host.CHANNELS.get)(f.event).host,'workbuddy');
 await f.handlers.get(Host.CHANNELS.select)(f.event,'codex');assert.deepEqual(f.calls[0],['POST','/dsh-pet-7340/pet-host','{"host":"codex"}']);
 assert.throws(()=>f.handlers.get(Host.CHANNELS.select)({...f.event,senderFrame:{}},'codex'),/denied/);
 assert.throws(()=>f.handlers.get(Host.CHANNELS.get)({...f.event,sender:{...f.event.sender,getURL:()=> 'https://example.com/'} }),/denied/);
 f.controller.dispose();assert.equal(f.handlers.size,0);
});
test('忙碌时保留原宿主并提示，托盘明确当前选择',async()=>{
 const f=fixture(409);assert.equal((await f.controller.select('codex')).host,'workbuddy');assert.equal(f.dialogs.length,1);
 assert.deepEqual(f.controller.trayItems()[0].submenu.map(x=>x.checked),[false,true]);
 await assert.rejects(f.controller.select('other'),/invalid/);f.controller.dispose();
});
test('WorkBuddy菜单移除未接入账号入口，保留互动、动作点播和第三方菜单',async()=>{
 let mounted,selected;
 const foreign={action:'third-party',children:[{action:'chat',label:'custom'}]};
 const shared={mountContextMenu:v=>{mounted=v;return{close(){}};},displayMenuBranch:()=>({action:'display'}),buildMoreBranch:()=>foreign,buildMenuTree:()=>[{label:'Balance levels',children:[{anim:'balance-1',label:'Plenty'}]}]};
 const window={PetShared:shared,__dshPetDebug:{},qqRemoteSettings:{open(){}},petHost:{initialHost:'workbuddy',getState:async()=>({host:'workbuddy'}),selectHost:async id=>{selected=id;}},addEventListener(){},CodexLocale:{getLocale:()=> 'en'}};
 const context=vm.createContext({window,S:shared,OPEN_TARGET:'web',navigator:{language:'en',platform:'Win32'},console});
 // 执行上游实际onContextMenu；禁止假造不存在的PetSprite.mountContextMenu方法。
 vm.runInContext(readFileSync(join(__dirname,'../node_modules/dsh-pet/runtime/electron-helper/sprite.js'),'utf8'),context);
 vm.runInContext(readFileSync(join(__dirname,'pet-host-menu.js'),'utf8'),context);
 const sprite=vm.runInContext('Object.create(PetSprite.prototype)',context);
 Object.assign(sprite,{dragState:{},animations:{},menuItems:[],stopThrow(){},stopMove(){},setInteractive(){},syncInputBusy(){},syncInputRegions(){},visibleClampRect:()=>null,closeMenu(){}});
 sprite.onContextMenu({preventDefault(){},clientX:0,clientY:0});
 assert.ok(!mounted.tree.some(x=>['chat','balance','show-balance','codex-task-panel','qq-remote-settings','whisper'].includes(x.action)));
 assert.equal(mounted.tree.find(x=>x.action==='open-site').label,'Open WorkBuddy');
 assert.ok(mounted.tree.some(x=>x.action==='home'));assert.equal(mounted.tree.find(x=>x.action==='third-party'),foreign);
 assert.ok(mounted.tree.find(x=>x.label==='Balance levels'));assert.equal(mounted.tree.at(-1).label,'Companion app');
 sprite.onMenuAction({action:'pet-select-host',host:'codex'});await Promise.resolve();assert.equal(selected,'codex');
});
