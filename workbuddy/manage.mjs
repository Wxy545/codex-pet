import {readFile,writeFile,lstat,mkdir,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {homedir} from 'node:os';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const NAME='codex-pet-workbuddy',PLUGIN='codex-pet-companion@'+NAME;
const source=dirname(fileURLToPath(import.meta.url));
const files=['.codebuddy-plugin/marketplace.json','plugin/.codebuddy-plugin/plugin.json','plugin/hook-event.mjs','plugin/hooks/hooks.json','plugin/hooks/report.mjs','plugin/hooks/report.ps1'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function stat(path){try{return await lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&resolve(a).toLowerCase()===resolve(b).toLowerCase();
const savedExecutable=value=>typeof value==='string'&&isAbsolute(value)&&basename(value).toLowerCase()==='workbuddy.exe';
async function ownDirectory(root,directory){
  const rel=relative(root,directory);if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('unsafe-workbuddy-plugin-path');
  let cursor=root;
  for(const part of ['',...rel.split(sep).filter(Boolean)]){
    if(part)cursor=join(cursor,part);
    const info=await stat(cursor);if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw Error('unsafe-workbuddy-plugin-path');
    if(!info)await mkdir(cursor);
  }
}
async function atomic(file,bytes){
  const info=await stat(file);if(info&&(!info.isFile()||info.isSymbolicLink()))throw Error('unsafe-workbuddy-plugin-file');
  const temp=file+'.tmp-'+randomUUID();await writeFile(temp,bytes,{flag:'wx'});await rename(temp,file);
}
async function cli(args,context){
  return new Promise((ok,fail)=>execFile(context.nodePath,[context.cliPath,...args],{cwd:context.appRoot,windowsHide:true,timeout:45000,maxBuffer:1024*1024,
    env:{...process.env,CODEBUDDY_CONFIG_DIR:context.workBuddyHome,WORKBUDDY_CONFIG_DIR:context.workBuddyHome,CODEBUDDY_FORCE_LITE_WB_BUNDLE:'1',DISABLE_TELEMETRY:'1',NODE_OPTIONS:''}},(error)=>error?fail(Error('workbuddy-cli-command-failed: '+args.slice(0,3).join(' '))):ok()));
}
async function options(input){
  const {appRoot,workBuddyExe,nodePath=process.execPath}=input;
  if(![appRoot,workBuddyExe,nodePath].every(p=>typeof p==='string'&&isAbsolute(p))||basename(workBuddyExe).toLowerCase()!=='workbuddy.exe')throw Error('absolute-workbuddy-path-required');
  for(const p of [workBuddyExe,nodePath])if(!(await stat(p))?.isFile())throw Error('workbuddy-executable-missing');
  if(!(await stat(appRoot))?.isDirectory())throw Error('app-root-missing');
  const bundled=join(dirname(workBuddyExe),'resources','app.asar.unpacked','cli'),cliPath=join(bundled,'bin','codebuddy');
  const product=await json(join(bundled,'product.json')),meta=await json(join(bundled,'package.json'));
  if(product.productName!=='WorkBuddy'||meta.name!=='@genie/agent-cli'||!(await stat(cliPath))?.isFile())throw Error('workbuddy-bundled-cli-required');
  const folder=product.dataFolderName;if(typeof folder!=='string'||!/^\.[A-Za-z0-9_-]+$/.test(folder))throw Error('workbuddy-home-unconfirmed');
  const workBuddyHome=input.workBuddyHome??join(homedir(),folder);if(!isAbsolute(workBuddyHome))throw Error('absolute-workbuddy-home-required');
  return {appRoot:resolve(appRoot),workBuddyExe:resolve(workBuddyExe),nodePath:resolve(nodePath),workBuddyHome:resolve(workBuddyHome),cliPath,cliVersion:meta.version};
}
async function registryEntry(context){
  const file=join(context.workBuddyHome,'plugins','known_marketplaces.json');if(!await stat(file))return null;
  const registry=await json(file);return registry[NAME]??null;
}
function assertRegistry(entry,target){
  if(entry&&(entry.source?.source!=='directory'||!same(entry.source.path,target)||!same(entry.installLocation,target)))throw Error('marketplace-name-in-use');
}
async function refreshOwnedCache(context,target,previous,snapshot){
  const file=join(context.workBuddyHome,'plugins','installed_plugins.json');if(!await stat(file))return;
  const installed=(await json(file)).plugins?.[PLUGIN]?.find(item=>item.scope==='user');if(!installed)return;
  if(typeof installed.version!=='string'||!/^[A-Za-z0-9_.+-]+$/.test(installed.version))throw Error('unsafe-workbuddy-cache-version');
  const expected=join(context.workBuddyHome,'plugins','cache',NAME,'codex-pet-companion',installed.version);
  if(!same(installed.installPath,expected))throw Error('unsafe-workbuddy-cache-path');
  const planned=[];
  for(const item of snapshot.filter(x=>x.name.startsWith('plugin/'))){
    const name=item.name.slice(7),destination=join(expected,name),info=await stat(destination);
    if(info&&(!info.isFile()||info.isSymbolicLink()))throw Error('unsafe-workbuddy-cache-file');
    if(info){const current=hash(await readFile(destination)),baseline=previous?.cacheFiles?.[item.name]??previous?.files?.[item.name];if(current!==hash(item.bytes)&&current!==baseline)throw Error('modified-workbuddy-plugin-cache');}
    planned.push({destination,bytes:item.bytes});
  }
  // 原生CLI同版本不刷新缓存；只替换已登记未改的自有脚本，第三方文件和用户配置保持原样。
  for(const item of planned){await ownDirectory(context.workBuddyHome,dirname(item.destination));await atomic(item.destination,item.bytes);}
  await atomic(join(expected,'connection.json'),await readFile(join(target,'plugin','connection.json')));
}
/** 安装只调用本客户端自带CLI；不编辑用户settings或第三方插件条目。 */
export async function installWorkBuddyPlugin(input){
  const context=await options(input),run=input.runCli??cli,managed=join(context.appRoot,'data','workbuddy-plugin'),target=join(managed,'marketplace');
  const entry=await registryEntry(context);assertRegistry(entry,target);
  const stampFile=join(managed,'.codex-pet-workbuddy.json');let previous;
  if(await stat(stampFile)){previous=await json(stampFile);if(previous.schemaVersion!==1||!same(previous.appRoot,context.appRoot)||!same(previous.workBuddyHome,context.workBuddyHome)||(previous.workBuddyExe!==undefined&&!savedExecutable(previous.workBuddyExe)))throw Error('workbuddy-plugin-owner-mismatch');}
  const snapshot=[];
  for(const name of files){
    const bytes=await readFile(join(source,name)),file=join(target,name),info=await stat(file);
    if(info&&(!info.isFile()||info.isSymbolicLink()))throw Error('unsafe-workbuddy-plugin-file');
    if(info){const current=hash(await readFile(file));if(current!==hash(bytes)&&current!==previous?.files?.[name])throw Error('modified-workbuddy-plugin');}
    snapshot.push({name,bytes});
  }
  await run(['plugin','validate',source],context);
  await ownDirectory(context.appRoot,managed);await ownDirectory(context.appRoot,target);
  for(const item of snapshot){await ownDirectory(context.appRoot,dirname(join(target,item.name)));await atomic(join(target,item.name),item.bytes);}
  await atomic(join(target,'plugin','connection.json'),JSON.stringify({schemaVersion:1,appRoot:context.appRoot,nodePath:context.nodePath},null,2)+'\n');
  // 先记录自有文件；CLI安装中断后也能准确识别这一次创建的内容。
  // 路径来自本次已核实的客户端；只留在本机登记，供目标窗口唤起时再次独立验明身份。
  const stamp={schemaVersion:1,appRoot:context.appRoot,workBuddyHome:context.workBuddyHome,workBuddyExe:context.workBuddyExe,marketplaceRoot:target,files:Object.fromEntries(snapshot.map(x=>[x.name,hash(x.bytes)])),cacheFiles:previous?.cacheFiles??previous?.files??{}};
  await atomic(stampFile,JSON.stringify(stamp,null,2)+'\n');
  if(!entry)await run(['plugin','marketplace','add',target,'--name',NAME],context);
  const installedFile=join(context.workBuddyHome,'plugins','installed_plugins.json');
  const installed=await stat(installedFile)?await json(installedFile):null;
  const existing=installed?.plugins?.[PLUGIN]?.some(item=>item.scope==='user');
  await run(['plugin',existing?'update':'install',PLUGIN,'--scope','user'],context);
  await refreshOwnedCache(context,target,previous,snapshot);
  stamp.cacheFiles=stamp.files;await atomic(stampFile,JSON.stringify(stamp,null,2)+'\n');
  return {plugin:PLUGIN,marketplaceRoot:target,workBuddyHome:context.workBuddyHome,cliVersion:context.cliVersion};
}
/** 卸载保留本插件数据，不prune，不删除用户目录或其他插件。 */
export async function uninstallWorkBuddyPlugin(input){
  const context=await options(input),run=input.runCli??cli,target=join(context.appRoot,'data','workbuddy-plugin','marketplace');
  const stamp=await json(join(context.appRoot,'data','workbuddy-plugin','.codex-pet-workbuddy.json'));
  if(stamp.schemaVersion!==1||!same(stamp.appRoot,context.appRoot)||!same(stamp.workBuddyHome,context.workBuddyHome)||!same(stamp.marketplaceRoot,target)||(stamp.workBuddyExe!==undefined&&(!savedExecutable(stamp.workBuddyExe)||!same(stamp.workBuddyExe,context.workBuddyExe))))throw Error('workbuddy-plugin-owner-mismatch');
  assertRegistry(await registryEntry(context),target);
  await run(['plugin','uninstall',PLUGIN,'--scope','user','--keep-data'],context);
  const installedFile=join(context.workBuddyHome,'plugins','installed_plugins.json'),installed=await stat(installedFile)?await json(installedFile):null;
  const remaining=Object.entries(installed?.plugins??{}).some(([name,records])=>name.endsWith('@'+NAME)&&Array.isArray(records)&&records.length>0);
  if(!remaining)await run(['plugin','marketplace','remove',NAME],context);
  return {plugin:PLUGIN,status:'removed',dataPreserved:true,marketplacePreserved:remaining};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [command,...args]=process.argv.slice(2),map={};for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||!args[i+1])throw Error('invalid-workbuddy-installer-arguments');map[args[i].slice(2)]=args[i+1];}
    const input={appRoot:map['app-root'],workBuddyExe:map['workbuddy-exe'],nodePath:map['node-path'],workBuddyHome:map['workbuddy-home']};
    if(!['install','uninstall'].includes(command))throw Error('invalid-workbuddy-installer-action');
    console.log(JSON.stringify(await(command==='install'?installWorkBuddyPlugin(input):uninstallWorkBuddyPlugin(input))));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
