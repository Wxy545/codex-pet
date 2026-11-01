import {mkdir,readFile,writeFile,rename,lstat,unlink} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {randomUUID} from 'node:crypto';

const HOSTS=['codex','workbuddy','harness'];
export const MODEL_PURPOSES=['chat','whisper','qq-chat','translation','summary','image','task','memory'];
const EFFORTS=['none','minimal','low','medium','high','xhigh','max','ultra'];
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const modelName=v=>typeof v==='string'&&v.length<=100&&v.length>0&&!/[\u0000-\u0020\u007f]/.test(v);
const fail=code=>{throw Object.assign(Error(code),{code});};
const base=purpose=>({model:purpose==='task'?null:'auto-light',effort:purpose==='task'?'high':'low'});
function selection(value){
 if(!object(value)||Object.keys(value).some(k=>!['model','effort'].includes(k)))fail('invalid_policy');
 const model=value.model??null,effort=value.effort??null;
 if(model!==null&&!modelName(model)||effort!==null&&!EFFORTS.includes(effort))fail('invalid_policy');
 return{model,effort};
}
function models(catalog){
 if(catalog?.state!=='ready'||!Array.isArray(catalog.items)||!catalog.items.length||catalog.items.length>1000)fail('catalog_unavailable');
 const items=catalog.items.filter(v=>object(v)&&modelName(v.model)&&modelName(v.id)&&Array.isArray(v.supportedReasoningEfforts)&&v.supportedReasoningEfforts.every(e=>EFFORTS.includes(e)));
 if(!items.length)fail('catalog_unavailable');return items;
}
async function safeFile(file){try{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>65536)fail('unsafe_policy_file');return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}

/** 用途只决定模型设置，不能夹带文件权限、工具或跨宿主回退。 */
export async function createModelPolicy({dataRoot}={}){
 if(!isAbsolute(dataRoot||''))fail('invalid_directory');
 await mkdir(dataRoot,{recursive:true});if((await lstat(dataRoot)).isSymbolicLink())fail('unsafe_policy_file');
 const file=join(dataRoot,'model-policy.json');let values={};
 if(await safeFile(file)){
  const saved=JSON.parse(await readFile(file,'utf8'));
  if(saved.schemaVersion!==1||!object(saved.purposes)||Object.keys(saved.purposes).some(p=>!MODEL_PURPOSES.includes(p)))fail('invalid_policy');
  values=Object.fromEntries(Object.entries(saved.purposes).map(([p,v])=>[p,selection(v)]));
 }
 let queue=Promise.resolve();
 const snapshot=()=>({schemaVersion:1,hosts:Object.fromEntries(HOSTS.map(host=>[host,{configurable:host==='codex',purposes:host==='codex'?Object.fromEntries(MODEL_PURPOSES.map(p=>[p,{...base(p),...values[p]}])):{}}]))});
 async function save(value){
  if(!object(value)||Object.keys(value).some(k=>!['host','purpose','model','effort'].includes(k))||!HOSTS.includes(value.host)||!MODEL_PURPOSES.includes(value.purpose))fail('invalid_policy');
  if(value.host!=='codex')fail('model_selection_unavailable');
  const chosen=selection({model:value.model,effort:value.effort});
  const action=async()=>{
   const next={...values,[value.purpose]:chosen};await safeFile(file);
   const temporary=file+'.tmp-'+randomUUID();
   try{await writeFile(temporary,JSON.stringify({schemaVersion:1,purposes:next})+'\n',{flag:'wx',mode:0o600});await rename(temporary,file);values=next;}
   finally{await unlink(temporary).catch(()=>{});}
   return snapshot();
  };
  const pending=queue.then(action);queue=pending.catch(()=>{});return pending;
 }
 function resolve({host,purpose,override,catalog}={}){
  if(!HOSTS.includes(host)||!MODEL_PURPOSES.includes(purpose)&&purpose!=='local')fail('invalid_policy');
  if(purpose==='local')return{host,purpose,model:null,effort:null,provenance:'local',configurable:false};
  if(host!=='codex'){
   if(override&&(override.model!=null||override.effort!=null))fail('model_selection_unavailable');
   return{host,purpose,model:null,effort:null,provenance:'host-default',configurable:false};
  }
  const selected={...base(purpose),...values[purpose],...(override===undefined?{}:selection(override))};
  const available=models(catalog),visual=purpose==='image';
  const allowed=visual?available.filter(v=>Array.isArray(v.inputModalities)&&v.inputModalities.includes('image')):available;
  let model;
  if(selected.model!==null&&selected.model!=='auto-light'){
   model=available.find(v=>v.id===selected.model||v.model===selected.model);
   if(!model)fail('model_unavailable');if(visual&&!allowed.includes(model))fail('modality_unavailable');
  }else{
   if(!allowed.length)fail('modality_unavailable');
   model=selected.model==='auto-light'?allowed.find(v=>v.model.toLowerCase().includes('luna')):null;
   model||=allowed.find(v=>v.isDefault)||allowed[0];
  }
  const supported=[...new Set(model.supportedReasoningEfforts)];let effort=selected.effort;
  if(!supported.length){if(effort!==null&&override?.effort!=null)fail('unsupported_effort');effort=null;}
  else if(effort===null)effort=null;
  else if(!supported.includes(effort)){
   if(override?.effort!=null||values[purpose]?.effort!=null)fail('unsupported_effort');
   effort=supported.includes(model.defaultReasoningEffort)?model.defaultReasoningEffort:supported[0];
  }
  return{host,purpose,model:model.model,effort,provenance:'requested',configurable:true};
 }
 return{snapshot,save,resolve};
}
