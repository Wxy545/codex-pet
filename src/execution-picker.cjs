'use strict';const path=require('node:path'),{pathToFileURL}=require('node:url');
/** 模型目录只从当前宿主读取，目录查询不运行模型，表单不能传入路由。 */
function install({electron=require('electron'),hostRequest,canUse=()=>true,fileRoot=__dirname}){
 const{ipcMain,BrowserWindow,app}=electron,urls=new Set(['chat-window.html','task-window.html'].map(f=>pathToFileURL(path.join(fileRoot,f)).href));let disposed=false;
 ipcMain.handle('pet-execution:catalog',async e=>{
  if(disposed||!canUse()||e.senderFrame!==e.sender.mainFrame||!BrowserWindow.fromWebContents(e.sender)||!urls.has(e.sender.getURL()))return{ok:false,code:'unauthorized'};
  try{const response=await hostRequest('POST','/dsh-pet-7340/pet-model-policy',JSON.stringify({action:'catalog',host:'codex'}));if(response.status!==200)return{ok:false,code:'catalog_unavailable'};return{ok:true,catalog:JSON.parse(response.body)};}catch{return{ok:false,code:'catalog_unavailable'};}
 });
 function dispose(){if(disposed)return;disposed=true;ipcMain.removeHandler('pet-execution:catalog');app.removeListener('before-quit',dispose);}app.once('before-quit',dispose);return{dispose};
}
function validExecution(value){return value===undefined||value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['model','effort'].includes(k))&&(value.model===null||typeof value.model==='string'&&value.model.length>0&&value.model.length<=100&&!/[\x00-\x20\x7f]/.test(value.model))&&(value.effort===null||['none','minimal','low','medium','high','xhigh','max','ultra'].includes(value.effort));}
module.exports={install,validExecution};
