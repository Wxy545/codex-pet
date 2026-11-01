import {mkdir,readFile,writeFile,rename,unlink,lstat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const HOSTS=['codex','workbuddy','harness'];
const SOURCES=['desktop','qq','pet','content','telegram','discord','line','whatsapp'];
const STATES=['idle','thinking','working','waiting','result','success','error','cancelled','unknown'];
const FINAL=new Set(['success','error','cancelled']);
const EFFORTS=['none','minimal','low','medium','high','xhigh','max','ultra'];
const text=(v,max=120)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
const name=v=>typeof v==='string'&&/^[^\s\x00-\x1f\x7f]{1,100}$/.test(v)?v:null;
const fail=code=>{throw Object.assign(Error(code),{code});};
const validId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
async function safe(file){try{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4*1024*1024)fail('unsafe_task_store');return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}

/** 目录只存任务事实；正文和执行回调留在原服务，渲染器仅按不透明ID请求固定操作。 */
export async function createPetTaskRegistry({dataRoot,now=Date.now,onChange=()=>{},maxEntries=512}={}){
 if(!isAbsolute(dataRoot||'')||!Number.isInteger(maxEntries)||maxEntries<16||maxEntries>2048)fail('invalid_task_store');
 await mkdir(dataRoot,{recursive:true});if((await lstat(dataRoot)).isSymbolicLink())fail('unsafe_task_store');
 const file=join(dataRoot,'task-register.json'),rows=new Map(),actions=new Map();let version=0,queue=Promise.resolve();
 if(await safe(file)){
  const saved=JSON.parse(await readFile(file,'utf8'));
  if(saved.schemaVersion!==1||!Array.isArray(saved.items)||saved.items.length>maxEntries)fail('invalid_task_store');
  for(const item of saved.items){
   if(!validId(item.id)||!HOSTS.includes(item.host)||!SOURCES.includes(item.source)||!STATES.includes(item.state)||!Number.isFinite(item.updatedAt))fail('invalid_task_store');
   rows.set(item.id,{...project(item),active:false,lastKnown:true});
  }
 }
 function project(row){
  return{id:row.id,host:row.host,source:row.source,title:text(row.title),project:text(row.project),state:row.state,active:row.active===true,
   model:name(row.model),effort:EFFORTS.includes(row.effort)?row.effort:null,provenance:['host-record','requested','confirmed','host-default'].includes(row.provenance)?row.provenance:'unknown',
   phase:text(row.phase,80),startedAt:Number.isFinite(row.startedAt)?row.startedAt:row.updatedAt,updatedAt:row.updatedAt,
   attention:['pending','read','snoozed'].includes(row.attention)?row.attention:'none',snoozedUntil:Number.isFinite(row.snoozedUntil)?row.snoozedUntil:null,lastKnown:row.lastKnown===true};
 }
 function list({host,source,state,attention=false}={}){
  if(host!==undefined&&!HOSTS.includes(host)||source!==undefined&&!SOURCES.includes(source)||state!==undefined&&!STATES.includes(state))fail('invalid_filter');
  const stamp=now();
  const items=[...rows.values()].filter(r=>(!host||r.host===host)&&(!source||r.source===source)&&(!state||r.state===state)&&(!attention||r.attention==='pending'||r.attention==='snoozed'&&r.snoozedUntil<=stamp))
   .sort((a,b)=>Number(b.state==='waiting')-Number(a.state==='waiting')||Number(b.active)-Number(a.active)||b.updatedAt-a.updatedAt)
   .map(r=>({...project(r),elapsedMs:Math.max(0,(r.active?stamp:r.updatedAt)-r.startedAt),quietMs:Math.max(0,stamp-r.updatedAt),actions:Object.keys(actions.get(r.id)||{}).filter(k=>['open','cancel','result','artifact'].includes(k)&&typeof actions.get(r.id)[k]==='function'&&(k!=='cancel'||r.active))}));
  return{version,items,activeCount:[...rows.values()].filter(r=>r.active).length,pendingCount:[...rows.values()].filter(r=>r.attention==='pending'||r.attention==='snoozed'&&r.snoozedUntil<=stamp).length};
 }
 async function persist(){
  await safe(file);const temporary=file+'.tmp-'+randomUUID();
  try{await writeFile(temporary,JSON.stringify({schemaVersion:1,items:[...rows.values()].map(project)})+'\n',{flag:'wx',mode:0o600});await rename(temporary,file);}
  finally{await unlink(temporary).catch(()=>{});}
 }
 const serial=action=>{const next=queue.then(action);queue=next.catch(()=>{});return next;};
 const changed=()=>{version++;try{onChange(list());}catch{/* 面板异常不能改变任务状态。 */}};
 function observe(input,controls){return serial(async()=>{
  if(!input||!HOSTS.includes(input.host)||!SOURCES.includes(input.source)||!STATES.includes(input.state)||typeof input.key!=='string'||!input.key||input.key.length>512||/[\x00-\x1f]/.test(input.key)||!Number.isFinite(input.at))fail('invalid_task');
  const id=createHash('sha256').update(input.host+'\0'+input.source+'\0'+input.key).digest('hex'),old=rows.get(id);
  if(old&&(input.at<old.updatedAt||FINAL.has(old.state)&&input.active===true))return project(old);
  if(!old&&rows.size>=maxEntries){
   const drop=[...rows.values()].filter(r=>!r.active&&r.attention!=='pending'&&r.attention!=='snoozed').sort((a,b)=>a.updatedAt-b.updatedAt)[0];
   if(!drop)fail('task_capacity');rows.delete(drop.id);actions.delete(drop.id);
  }
  const row={...old,...project({...input,id,updatedAt:input.at,startedAt:old?.startedAt??input.startedAt??input.at,lastKnown:false}),lastKnown:false};
  row.attention=old?.attention??'none';row.snoozedUntil=old?.snoozedUntil??null;
  if(['waiting','success','error'].includes(input.state)&&old?.state!==input.state){row.attention='pending';row.snoozedUntil=null;}
  else if(old?.state==='waiting'&&!['waiting','success','error'].includes(input.state)){row.attention='none';row.snoozedUntil=null;}
  rows.set(id,row);if(controls)actions.set(id,Object.fromEntries(['open','cancel','result','artifact'].filter(k=>typeof controls[k]==='function').map(k=>[k,controls[k]])));
  await persist();changed();return project(row);
 });}
 function attend({id,action,until}={}){return serial(async()=>{
  const row=rows.get(id);if(!row)fail('task_unavailable');
  if(action==='snooze'){
   if(!Number.isFinite(until)||until<=now()||until-now()>30*86400000)fail('invalid_snooze');row.attention='snoozed';row.snoozedUntil=until;
  }else if(action==='read'||action==='pending'){row.attention=action;row.snoozedUntil=null;}else fail('invalid_action');
  await persist();changed();return list();
 });}
 async function perform({id,action}={}){
  if(!validId(id)||!rows.has(id))fail('task_unavailable');
  const row=rows.get(id),handler=actions.get(id)?.[action];
  if(!['open','cancel','result','artifact'].includes(action)||typeof handler!=='function'||action==='cancel'&&!row.active)fail('action_unavailable');
  return handler();
 }
 return{observe,list,attend,perform,flush:()=>queue};
}
