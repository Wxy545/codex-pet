import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url);let Workbench={};try{Workbench=require('../src/workbench-window.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
test('工作台IPC只允许固定任务动作和用途模型设置，不接任意路由或路径',()=>{
 assert.equal(typeof Workbench.validRequest,'function');
 assert.equal(Workbench.validRequest({kind:'tasks',action:'list',filter:{host:'codex'}}),true);
 assert.equal(Workbench.validRequest({kind:'tasks',action:'cancel',id:'a'.repeat(64)}),true);
 for(const bad of [{kind:'tasks',action:'shell',id:'a'.repeat(64)},{kind:'tasks',action:'open',id:'C:/private'},{kind:'models',action:'save',purpose:'chat',host:'codex',model:'real',effort:'low',permission:'all'},{kind:'tasks',action:'list',route:'/shutdown'}])assert.equal(Workbench.validRequest(bad),false);
});
test('工作台加载失败销毁本次窗口，下一次打开重新加载且成功显示',async()=>{
 const instances=[],handlers=new Map(),app=new EventEmitter();app.whenReady=async()=>{};const ipcMain=new EventEmitter();ipcMain.handle=(key,fn)=>handlers.set(key,fn);ipcMain.removeHandler=key=>handlers.delete(key);
 class Window extends EventEmitter{
  constructor(){super();instances.push(this);this.destroyed=false;this.visible=false;this.webContents=new EventEmitter();Object.assign(this.webContents,{setWindowOpenHandler(){},session:{setPermissionRequestHandler(){}},mainFrame:{},getURL:()=>''});}
  setMenu(){}isDestroyed(){return this.destroyed;}destroy(){this.destroyed=true;this.emit('closed');}show(){this.visible=true;}showInactive(){this.visible=true;}focus(){this.focused=true;}
  async loadFile(){if(instances.length===1)throw Error('synthetic-load-failure');this.loaded=true;}
 }
 const controller=Workbench.createController({electron:{app,BrowserWindow:Window,ipcMain,shell:{}},hostRequest:async()=>({status:200,body:'{}'})});
 await assert.rejects(controller.open(),/synthetic-load-failure/);assert.equal(instances.length,1);assert.equal(instances[0].destroyed,true);assert.equal(instances[0].visible,false);
 await controller.open();assert.equal(instances.length,2);assert.equal(instances[1].loaded,true);assert.equal(instances[1].visible,true);assert.equal(instances[1].focused,true);
 controller.dispose();assert.equal(instances[1].destroyed,true);assert.equal(handlers.size,0);assert.equal(ipcMain.listenerCount(Workbench.CHANNELS.open),0);
});
