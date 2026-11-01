import {mkdir,lstat,realpath,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {isAbsolute,join,resolve,parse,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

const HOSTS=['codex','workbuddy','harness'];
const fail=code=>{throw Object.assign(Error(code),{code});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const only=(value,keys)=>object(value)&&Object.keys(value).every(key=>keys.includes(key));
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const defaults=()=>({revision:0,shareOwnerMemory:false,qqMode:'task'});
const validHost=value=>only(value,['revision','shareOwnerMemory','qqMode'])&&revision(value.revision)&&typeof value.shareOwnerMemory==='boolean'&&['task','role'].includes(value.qqMode);
async function directory(path,{create=false}={}){
 const requested=resolve(path),root=parse(requested).root,parts=requested.slice(root.length).split(sep).filter(Boolean);
 const inspect=async missing=>{let current=root;for(const part of ['',...parts]){if(part)current=join(current,part);let info;try{info=await lstat(current);}catch(error){if(missing&&error.code==='ENOENT')return;throw error;}if(!info.isDirectory()||info.isSymbolicLink())fail('role_settings_storage_unsafe');}};
 // 逐段拒绝真实链接，再规范化8.3短名与大小写；文字不同不代表目录越界。
 await inspect(create);if(create)await mkdir(requested,{recursive:true,mode:0o700});await inspect(false);return realpath(requested);
}
/** 本机设置分宿主保存。关闭共享立即撤销后续使用；修订号防止开关往返后误用旧上下文。 */
export async function createRoleChatSettings({dataRoot,onChange=()=>{}}={}){
 if(!isAbsolute(dataRoot??'')||typeof onChange!=='function')fail('role_settings_invalid');
 const root=await directory(dataRoot,{create:true}),file=join(root,'role-chat-settings.json');let state={schemaVersion:1,revision:0,hosts:Object.fromEntries(HOSTS.map(host=>[host,defaults()]))},queue=Promise.resolve();
 async function existing(){await directory(root);try{const item=await lstat(file);if(!item.isFile()||item.isSymbolicLink()||item.nlink!==1||item.size>8192)fail('role_settings_storage_unsafe');return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
 if(await existing()){
  try{const saved=JSON.parse(await readFile(file,'utf8'));if(!only(saved,['schemaVersion','revision','hosts'])||saved.schemaVersion!==1||!revision(saved.revision)||!only(saved.hosts,HOSTS)||!HOSTS.every(host=>validHost(saved.hosts[host])&&saved.hosts[host].revision<=saved.revision))fail('role_settings_storage_invalid');state=saved;}
  catch(error){if(error.code?.startsWith('role_settings_'))throw error;fail('role_settings_storage_invalid');}
 }
 const snapshot=()=>structuredClone(state);
 function forHost(host){if(!HOSTS.includes(host))fail('role_settings_invalid');return structuredClone(state.hosts[host]);}
 async function save(value){
  if(!only(value,['host','revision','shareOwnerMemory','qqMode'])||!HOSTS.includes(value.host)||!revision(value.revision)||value.shareOwnerMemory!==undefined&&typeof value.shareOwnerMemory!=='boolean'||value.qqMode!==undefined&&!['task','role'].includes(value.qqMode)||value.shareOwnerMemory===undefined&&value.qqMode===undefined)fail('role_settings_invalid');
  const action=async()=>{
   const before=state.hosts[value.host];if(value.revision!==before.revision)fail('role_settings_stale');
   const selected={...before,...(value.shareOwnerMemory===undefined?{}:{shareOwnerMemory:value.shareOwnerMemory}),...(value.qqMode===undefined?{}:{qqMode:value.qqMode})};
   if(selected.shareOwnerMemory===before.shareOwnerMemory&&selected.qqMode===before.qqMode)return snapshot();
   if(state.revision>=Number.MAX_SAFE_INTEGER||before.revision>=Number.MAX_SAFE_INTEGER)fail('role_settings_storage_invalid');selected.revision++;
   const next={schemaVersion:1,revision:state.revision+1,hosts:{...state.hosts,[value.host]:selected}};await existing();const temporary=file+'.tmp-'+randomUUID();
   try{await writeFile(temporary,JSON.stringify(next)+'\n',{flag:'wx',mode:0o600});await rename(temporary,file);state=next;}finally{await unlink(temporary).catch(()=>{});}
   try{await onChange({host:value.host,previous:structuredClone(before),current:structuredClone(selected)});}catch{/* 通知失败不能伪称本机设置尚未保存。 */}
   return snapshot();
  };
  const pending=queue.then(action);queue=pending.catch(()=>{});return pending;
 }
 return{snapshot,forHost,save,flush:()=>queue};
}
