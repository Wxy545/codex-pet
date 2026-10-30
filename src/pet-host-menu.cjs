'use strict';
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const Host = require('./pet-host.cjs');
const L = require('./codex-locale.cjs');
const CHANNELS = {get: 'pet-host:get', select: 'pet-host:select'};
function createController({electron, hostRequest, harness, onChanged=()=>{}, host = process.env.CODEX_PET_HOST || 'codex', fileRoot = __dirname}) {
  const {app, ipcMain, BrowserWindow, dialog} = electron;
  const petUrl = pathToFileURL(path.join(fileRoot, 'index.html')).href;
  let disposed = false,changing=false;
  const trusted = event => {
    try {const url=new URL(event.sender.getURL());url.search='';url.hash='';return !disposed&&url.href===petUrl
      &&event.senderFrame===event.sender.mainFrame&&Boolean(BrowserWindow.fromWebContents(event.sender));}catch{return false;}
  };
  const get = () => {const native=harness?.state();return native?.active?{schemaVersion:1,host:'harness',label:'DeepSeek Harness',external:true,profile:native.profile,capabilities:{events:true,chat:false,images:false,tasks:false,quota:false,chatter:false}}:Host.publicHost(host);};
  async function selectImpl(value) {
    if(value==='harness'){
      if(!harness)throw new Error('harness-unavailable');
      const result=await harness.open();return{...get(),...(result.cancelled?{cancelled:true}:{external:true,installed:result.installed})};
    }
    if (!Host.validHost(value)) throw new Error('invalid-pet-host');
    const response = await hostRequest('POST', '/dsh-pet-7340/pet-host', JSON.stringify({host: value}));
    if (response.status === 409) {
      let reason;try{reason=JSON.parse(response.body).error;}catch{}
      await dialog?.showMessageBox?.({type: 'info', message: L.t(reason==='codex_missing'?'请先安装 Codex CLI，再选择 Codex 联动。':'请先等当前任务结束，再切换联动应用。'), buttons: [L.t('确定')]});
      return get();
    }
    if (![200,202].includes(response.status)) {await dialog?.showMessageBox?.({type:'error',message:L.t('联动应用未能切换，请稍后重试。'),buttons:[L.t('确定')]});throw new Error('pet-host-switch-unavailable');}
    const result=JSON.parse(response.body);
    await harness?.deactivate();
    return result;
  }
  const refresh=async()=>{if(disposed)return;try{await onChanged(get());}catch{/* 托盘刷新失败不能撤销已完成的宿主选择。 */}};
  async function select(value){
    if(disposed)throw new Error('pet-host-unavailable');
    if(changing){await refresh();throw new Error('pet-host-switch-busy');}
    changing=true;try{return await selectImpl(value);}finally{try{await refresh();}finally{changing=false;}}
  }
  const getHandler = event => {if(!trusted(event))throw new Error('host-sender-denied');return get();};
  const selectHandler = (event,value) => {if(!trusted(event))throw new Error('host-sender-denied');return select(value);};
  ipcMain.handle(CHANNELS.get,getHandler);ipcMain.handle(CHANNELS.select,selectHandler);
  function trayItems() {return [{label:L.t('联动应用'),submenu:[...Host.HOSTS,'harness'].map(value=>({label:value==='harness'?(L.getLocale()==='zh-CN'?'DeepSeek Harness（原生插件）':'DeepSeek Harness (native plugin)'):Host.publicHost(value).label,type:'radio',checked:value===get().host,click:()=>{void select(value).catch(()=>{});}}))}];}
  function dispose(){if(disposed)return;disposed=true;ipcMain.removeHandler(CHANNELS.get);ipcMain.removeHandler(CHANNELS.select);app.removeListener('before-quit',dispose);}
  app.once('before-quit',dispose);
  return {get,select,trayItems,dispose};
}
function install(options){return createController({...options,electron:options.electron||require('electron')});}
function installPreload(electron=require('electron')) {
  electron.contextBridge.exposeInMainWorld('petHost', Object.freeze({
    initialHost:process.env.CODEX_PET_HOST==='workbuddy'?'workbuddy':'codex',
    getState:()=>electron.ipcRenderer.invoke(CHANNELS.get),selectHost:host=>electron.ipcRenderer.invoke(CHANNELS.select,host),
  }));
}
module.exports={createController,install,installPreload,CHANNELS};
