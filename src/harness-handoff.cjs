'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const L=require('./codex-locale.cjs');
const OFFICIAL_URL='https://deepseek.com/harness/';
const VERSIONS=['0.2.1-rc.2','0.2.1-rc.5'];
const PROFILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const text=(zh,en)=>L.getLocale()==='zh-CN'?zh:en;
const inside=(file,root)=>{const relative=path.relative(root,file);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
const bundled=command=>/[\\/]resources[\\/]runtime[\\/]cli[\\/]bin[\\/]dsh(?:\.cmd)?$/i.test(command);
const regularFile=file=>{try{const stat=fs.lstatSync(file);return stat.isFile()&&!stat.isSymbolicLink();}catch{return false;}};
function json(file,limit=1048576){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw Error('invalid-file');return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}

/** 独立宿主的 DSH_HOME 属于本项目；原生 Harness 始终使用自己的 home。 */
function nativeHome(env=process.env){return path.resolve(env.CODEX_PET_NATIVE_DSH_HOME||path.join(os.homedir(),'.dsh'));}
function candidates({projectRoot,env=process.env,previous}={}){
 const names=process.platform==='win32'?['dsh.cmd','dsh']:['dsh'];
 const directories=String(env.PATH||env.Path||'').split(path.delimiter).filter(Boolean);
 const known=[env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs','DeepSeek Harness'),env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'DeepSeek Harness'),env.ProgramFiles&&path.join(env.ProgramFiles,'DeepSeek Harness')].filter(Boolean);
 const all=[previous,...directories.flatMap(dir=>names.map(name=>path.join(dir,name))),...known.map(dir=>path.join(dir,'resources','runtime','cli','bin','dsh.cmd'))].filter(Boolean);
 return [...new Set(all.map(file=>path.resolve(file)))].filter(file=>!inside(file,projectRoot)&&regularFile(file)).slice(0,8);
}
function profiles(home,desktop){
 try{return fs.readdirSync(path.join(home,'profiles'),{withFileTypes:true}).filter(item=>item.isDirectory()&&!item.isSymbolicLink()&&PROFILE.test(item.name)&&(desktop||item.name!=='desktop')&&regularFile(path.join(home,'profiles',item.name,'package.json'))).map(item=>item.name).sort();}catch{return[];}
}
function verifiedProfile(record){
 if(!record||!path.isAbsolute(record.home)||!PROFILE.test(record.profile)||!VERSIONS.includes(record.version)||!regularFile(record.command))return false;
 try{
  const profile=json(path.join(record.home,'profiles',record.profile,'package.json'));
  const installed=json(path.join(record.home,'profiles',record.profile,'node_modules','codex-pet-harness','package.json'));
  const bundles=profile.dsh?.profile?.bundles;
  return profile.dependencies?.['dsh-pet']==='0.3.8'&&typeof profile.dependencies?.['codex-pet-harness']==='string'&&Array.isArray(bundles)&&bundles.includes('dsh-pet')&&bundles.includes('codex-pet-harness')&&installed.name==='codex-pet-harness';
 }catch{return false;}
}
function readLink(dataRoot,projectRoot){
 const link=json(path.join(dataRoot,'harness-link.json'),8192);
 if(link.schemaVersion!==1||typeof link.active!=='boolean'||!path.isAbsolute(link.command)||inside(link.command,projectRoot)||!path.isAbsolute(link.home)||inside(link.home,dataRoot)||!PROFILE.test(link.profile)||!VERSIONS.includes(link.version))throw Error('invalid-link');
 return link;
}
/** 后端与原生窗口共用同一份已验证移交记录，不把任意 active 字段当成已接入。 */
function isActive({dataRoot,projectRoot}){try{const link=readLink(dataRoot,projectRoot);return link.active===true&&verifiedProfile(link);}catch{return false;}}
function createController({electron,projectRoot=path.resolve(__dirname,'../../../..'),dataRoot=process.env.DSH_HOME,home=nativeHome(),env=process.env,runCommand,onHandoff=async()=>{},onRestore=async()=>{}}={}){
 const {app,dialog,shell}=electron;
 if(!path.isAbsolute(projectRoot)||!path.isAbsolute(dataRoot)||!path.isAbsolute(home))throw Error('invalid-harness-path');
 const file=path.join(dataRoot,'harness-link.json');let link=null,invalidLink=false,disposed=false,opening=null;
  try{link=readLink(dataRoot,projectRoot);}
 catch(error){link=null;if(error.code!=='ENOENT')invalidLink=true;}
 const publicState=()=>{const installed=verifiedProfile(link);return{active:link?.active===true&&installed,installed,profile:link?.profile||null};};
 function save(value){
  for(const target of [dataRoot,file]){try{if(fs.lstatSync(target).isSymbolicLink())throw Error('linked-harness-link');}catch(error){if(error.code!=='ENOENT')throw error;}}
  fs.mkdirSync(dataRoot,{recursive:true});const temporary=file+'.tmp-'+randomUUID();
  try{fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});fs.renameSync(temporary,file);}finally{try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
 }
 const run=runCommand||((action,args)=>new Promise((resolve,reject)=>{
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const command=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(projectRoot,'scripts','harness-handoff.ps1'),'-Action',action,'-DshCommand',args.command,'-DshHome',args.home,'-AppRoot',projectRoot,...(args.profile?['-Profile',args.profile]:[])];
  execFile(powershell,command,{windowsHide:true,shell:false,timeout:action==='install'?600000:30000,maxBuffer:32768,env:{...process.env,DSH_HOME:args.home}},(error,stdout)=>{if(error)return reject(Error('harness-command-failed'));try{const result=JSON.parse(stdout.trim());if(result.ok!==true)throw Error();resolve(result);}catch{reject(Error('harness-command-failed'));}});
 }));
 const available=()=>{if(disposed)throw Error('unavailable');};
 async function chooseCommand(){
  const found=candidates({projectRoot,env,previous:link?.command});
  const answer=await dialog.showMessageBox({type:'question',message:text('接入 DeepSeek Harness 原生桌宠','Connect the native DeepSeek Harness pet'),detail:found.length?text('选择正在使用的 Harness。桌宠沿用该应用的会话、账户与 dsh-pet 服务。','Choose your Harness installation. Its own sessions, account and dsh-pet service will be used.'):text('未找到已安装的 Harness。先从官网安装并启动一次，或选择已有安装的 dsh 命令。','No Harness installation was found. Install it from the official website and open it once, or select an installed dsh command.'),buttons:[...found.map(command=>bundled(command)?'Harness Desktop':text('Harness 命令行','Harness CLI')),text('选择已安装的 dsh','Choose installed dsh'),text('打开 Harness 官网','Open Harness website'),text('取消','Cancel')],cancelId:found.length+2,defaultId:found.length?0:1});
  available();
  if(answer.response<found.length)return found[answer.response];
  if(answer.response===found.length+1){await shell.openExternal(OFFICIAL_URL);return null;}
  if(answer.response!==found.length)return null;
  const selected=await dialog.showOpenDialog({title:text('选择 Harness 的 dsh.cmd','Choose the Harness dsh command'),properties:['openFile','dontAddToRecent'],filters:[{name:'dsh',extensions:['cmd','exe','*']}]});
  available();if(selected.canceled||selected.filePaths.length!==1)return null;
  const command=fs.realpathSync(selected.filePaths[0]);
  if(!path.isAbsolute(command)||inside(command,projectRoot)||!/^dsh(?:\.cmd)?$/i.test(path.basename(command))||!regularFile(command))throw Error('invalid-command');
  return command;
 }
 async function chooseProfile(command){
  let selectedHome=link?.home||home;
  for(;;){
   available();if(inside(selectedHome,dataRoot))throw Error('invalid-home');const names=profiles(selectedHome,bundled(command));
   const choices=names.length?names:bundled(command)?[]:['web'];
   const visible=choices.slice(0,6),more=choices.length>visible.length;
   const answer=await dialog.showMessageBox({type:'question',message:text('选择 Harness 配置','Choose a Harness profile'),detail:choices.length?text('只向所选 profile 添加原生龙娘插件；已有角色和账户保留。','Only the selected profile receives the native dragon plugin. Existing pets and account settings are kept.'):text('此数据目录尚无已初始化的桌面配置。先启动 Harness Desktop 一次并完全退出，或选择正确的数据目录。','This home has no initialized Desktop profile. Open Harness Desktop once and fully quit it, or choose the correct data folder.'),buttons:[...visible,...(more?[text('选择其他 profile','Choose another profile')]:[]),text('选择其他数据目录','Choose another data folder'),text('取消','Cancel')],cancelId:visible.length+Number(more)+1,defaultId:0});
   available();if(answer.response<visible.length)return{command,home:selectedHome,profile:visible[answer.response]};
   if(more&&answer.response===visible.length){
    const selected=await dialog.showOpenDialog({title:text('选择 Harness profile 文件夹','Choose a Harness profile folder'),defaultPath:path.join(selectedHome,'profiles'),properties:['openDirectory','dontAddToRecent']});
    available();if(selected.canceled||selected.filePaths.length!==1)return null;
    const selectedProfile=fs.realpathSync(selected.filePaths[0]),name=path.basename(selectedProfile);
    if(path.dirname(selectedProfile)!==fs.realpathSync(path.join(selectedHome,'profiles'))||!choices.includes(name))throw Error('invalid-profile');
    return{command,home:selectedHome,profile:name};
   }
   if(answer.response!==visible.length+Number(more))return null;
   const selected=await dialog.showOpenDialog({title:text('选择 Harness 数据目录（含 profiles 文件夹）','Choose the Harness data folder (containing profiles)'),defaultPath:selectedHome,properties:['openDirectory','dontAddToRecent']});
   available();if(selected.canceled||selected.filePaths.length!==1)return null;
   selectedHome=fs.realpathSync(selected.filePaths[0]);if(!path.isAbsolute(selectedHome)||inside(selectedHome,dataRoot))throw Error('invalid-home');
  }
 }
 async function flow(){
  available();if(invalidLink)throw Error('invalid-link');
  const command=await chooseCommand();if(!command)return{cancelled:true,...publicState()};
  const inspection=await run('inspect',{command,home:link?.home||home});available();
  if(!VERSIONS.includes(inspection.version))throw Error('unsupported-version');
  const selected=await chooseProfile(command);if(!selected)return{cancelled:true,...publicState()};
  const confirmed=await dialog.showMessageBox({type:'question',message:text('将龙娘接入这个 Harness profile？','Add Dragon Girl to this Harness profile?'),detail:text(`配置：${selected.profile}。桌面版请先从托盘完全退出 Harness；安装不会替你结束会话。安装后重新打开该 profile。`,`Profile: ${selected.profile}. For Desktop, fully quit Harness from its tray first. No running session will be stopped. Reopen the profile after installation.`),buttons:[text('安装并接入','Install and connect'),text('取消','Cancel')],defaultId:0,cancelId:1});
  available();if(confirmed.response!==0)return{cancelled:true,...publicState()};
  await run('install',selected);available();
  const record={schemaVersion:1,active:true,...selected,version:inspection.version};if(!verifiedProfile(record))throw Error('install-unverified');
  const previous=link;save(record);link=record;
  try{await onHandoff(publicState());}catch{if(previous){save(previous);link=previous;}else{save({...record,active:false});link={...record,active:false};}throw Error('handoff-failed');}
  return{external:true,...publicState()};
 }
 async function open(){
  available();if(opening)return opening;
  opening=flow().catch(async error=>{
   if(!disposed)await dialog.showMessageBox({type:'error',message:text('Harness 尚未接入，当前桌宠保持原样。','Harness was not connected. Your current pet is unchanged.'),detail:error.message==='unsupported-version'?text('当前插件已验证 Harness 0.2.1-rc.2 和 0.2.1-rc.5。请更新项目或选择兼容的正式安装。','This plugin has been verified with Harness 0.2.1-rc.2 and 0.2.1-rc.5. Update Codex Pet or choose a compatible installation.'):text('请检查安装位置、数据目录和 profile；桌面版需先完全退出。原配置和账户不会被替换。','Check the installation, data folder and profile. Fully quit Desktop first. Existing configuration and account settings are kept.'),buttons:[text('确定','OK')]});
   throw Error('harness-unavailable');
  });try{return await opening;}finally{opening=null;}
 }
 async function deactivate(){available();if(opening)throw Error('harness-busy');if(!link?.active)return publicState();const previous=link;const next={...link,active:false};save(next);link=next;try{await onRestore();}catch{save(previous);link=previous;throw Error('harness-restore-failed');}return publicState();}
 function dispose(){disposed=true;app.removeListener('before-quit',dispose);}
 app.once('before-quit',dispose);
 return{open,state:publicState,deactivate,dispose};
}
function install(options){return createController({...options,electron:options.electron||require('electron')});}
module.exports={createController,install,candidates,profiles,verifiedProfile,nativeHome,isActive,OFFICIAL_URL};
