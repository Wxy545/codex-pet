'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),path=require('node:path'),{pathToFileURL}=require('node:url');
let api;try{api=require('./pet-actions.cjs');}catch{api={};}
function fixture(){
 assert.equal(typeof api.createController,'function');const handlers=new Map(),ipcMain=new EventEmitter();ipcMain.handle=(name,fn)=>handlers.set(name,fn);ipcMain.removeHandler=name=>handlers.delete(name);const app=new EventEmitter(),sent=[];let host='codex',dead=false,timer;
 const contents=new EventEmitter();contents.mainFrame={};contents.getURL=()=>pathToFileURL(path.join(__dirname,'index.html')).href+'?petIndex=0';contents.send=(...args)=>sent.push(args);
 const win={isDestroyed:()=>dead,webContents:contents},event={sender:contents,senderFrame:contents.mainFrame},other={mainFrame:{},getURL:contents.getURL};
 const controller=api.createController({electron:{app,ipcMain,BrowserWindow:{fromWebContents:value=>value===contents?win:value===other?{isDestroyed:()=>false}:null}},host:()=>host,setTimeoutImpl:fn=>{timer=fn;return{unref(){}};},clearTimeoutImpl:()=>{timer=null;}});
 return{controller,ipcMain,handlers,event,sent,play:value=>controller.play({revision:controller.state().pets.find(item=>item.petId===value.petId)?.revision,...value}),publish:value=>handlers.get(api.CHANNELS.publish)(event,value),ack:value=>ipcMain.emit(api.CHANNELS.result,event,value),foreignAck:value=>ipcMain.emit(api.CHANNELS.result,{sender:other,senderFrame:other.mainFrame},value),expire:()=>timer?.(),host:value=>{host=value;},destroy:()=>{dead=true;contents.emit('destroyed');}};
}
const catalog={petId:'main',name:'Dragon',groups:[{label:'Idle',items:[{anim:'idle-a',label:'Breathe'}]},{label:'Move',items:[{anim:'walk-a',label:'Walk',hint:'Shared animation'}]}]};
test('动作清单只接受宠物主frame的有界展示数据，不接收任意命令或路径',()=>{
 const f=fixture();try{
  assert.equal(f.handlers.get(api.CHANNELS.publish)({...f.event,senderFrame:{}},catalog).code,'unauthorized');
  assert.equal(f.publish({...catalog,command:'whoami'}).code,'invalid_input');assert.equal(f.publish({...catalog,groups:[{label:'x',items:[{anim:'https://example.com/a.webm',label:'remote'}]}]}).code,'invalid_input');
  assert.equal(f.publish(catalog).ok,true);const state=f.controller.state();assert.match(state.pets[0].revision,/^[a-f0-9-]{36}$/);const{revision,...saved}=state.pets[0];assert.deepEqual(saved,catalog);
 }finally{f.controller.dispose();}
});
test('点播只向原发布窗发送已登记动画，回执单次消费，不把控制中心数据直接交给播放器',async()=>{
 const f=fixture();try{f.publish(catalog);await assert.rejects(f.play({petId:'main',anim:'missing'}),/invalid/);await assert.rejects(f.play({petId:'main',anim:'idle-a',url:'file:///other'}),/invalid/);
  const playing=f.play({petId:'main',anim:'walk-a'}),[channel,value]=f.sent[0];assert.equal(channel,api.CHANNELS.play);assert.deepEqual(Object.keys(value).sort(),['anim','petId','requestId','revision']);
  let completed=false;void playing.then(()=>{completed=true;});f.foreignAck({requestId:value.requestId,ok:true});await Promise.resolve();assert.equal(completed,false);f.ack({requestId:value.requestId,ok:true});assert.equal(await playing,true);f.ack({requestId:value.requestId,ok:true});assert.equal(f.sent.length,1);
 }finally{f.controller.dispose();}
});
test('旧角色动作被移除后不可点播，迟到旧回执不能完成新请求',async()=>{
 const f=fixture();try{f.publish(catalog);const old=f.play({petId:'main',anim:'walk-a'}),oldResult=assert.rejects(old,/unavailable/);const oldId=f.sent[0][1].requestId,oldRevision=f.controller.state().pets[0].revision;f.publish({...catalog,groups:[catalog.groups[0]]});await oldResult;
  await assert.rejects(f.play({petId:'main',anim:'idle-a',revision:oldRevision}),/unavailable/);const next=f.play({petId:'main',anim:'idle-a'}),newId=f.sent[1][1].requestId;f.ack({requestId:oldId,ok:true});f.ack({requestId:newId,ok:true});assert.equal(await next,true);await assert.rejects(f.play({petId:'main',anim:'walk-a'}),/invalid/);
 }finally{f.controller.dispose();}
});
test('原生Harness、超时与目标退出均不播放，销毁后不保留catalog或回执',async()=>{
 const f=fixture();try{f.publish(catalog);f.host('harness');await assert.rejects(f.play({petId:'main',anim:'idle-a'}),/unavailable/);f.host('codex');const pending=f.play({petId:'main',anim:'idle-a'}),failed=assert.rejects(pending,/unavailable/);f.expire();await failed;
  const closing=f.play({petId:'main',anim:'idle-a'}),closed=assert.rejects(closing,/unavailable/);f.destroy();await closed;assert.deepEqual(f.controller.state(),{pets:[]});
 }finally{f.controller.dispose();}
});
