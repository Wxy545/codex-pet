import {readFile,writeFile,rename,unlink,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createModelPolicy} from './model-policy.mjs';
import {createPetTaskRegistry} from './pet-task-registry.mjs';
import {createPetMemoryStore,normalizeMemoryScope} from './pet-memory.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const fields=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const label=(v,max=120)=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,max):'';
const scopeKey=scope=>createHash('sha256').update(JSON.stringify(normalizeMemoryScope(scope))).digest('hex');
const projectName=path=>typeof path==='string'?path.split(/[\\/]/).filter(Boolean).at(-1)||'':'';
const STATES={running:'working',cancelling:'working',completed:'success',failed:'error',timed_out:'error',cancelled:'cancelled'};

/** 新面板共用可信后端范围和既有执行器；不通过前端提供的scope、路径或会话ID扩张能力。 */
export async function createPetWorkspace({dataRoot,host=()=> 'codex',getCharacter=()=>({id:'white-dragon'}),locale='zh-CN',onChange=()=>{},now=Date.now,summarizeMemory}={}){
 const models=await createModelPolicy({dataRoot});
 const tasks=await createPetTaskRegistry({dataRoot,onChange,now});
 const memory=await createPetMemoryStore({dataRoot});
 const scopes=new Map(),lastContexts=new Map(),file=join(dataRoot,'memory-scopes.json');let scopeQueue=Promise.resolve();
 try{
  const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>512*1024)fail('memory_scope_storage');
  const saved=JSON.parse(await readFile(file,'utf8'));
  if(saved.schemaVersion!==1||!Array.isArray(saved.scopes)||saved.scopes.length>512)fail('memory_scope_storage');
  for(const row of saved.scopes){const scope=normalizeMemoryScope(row.scope),id=scopeKey(scope);if(id!==row.id)fail('memory_scope_storage');scopes.set(id,{scope,label:label(row.label)});}
 }catch(e){if(e.code!=='ENOENT')throw e;}
 async function registerMemoryScope(value,{name}={}){
  const scope=normalizeMemoryScope(value),id=scopeKey(scope);
  const action=async()=>{if(scopes.has(id))return id;if(scopes.size>=512)fail('memory_scope_capacity');const temporary=file+'.tmp-'+randomUUID(),next=new Map(scopes);next.set(id,{scope,label:label(name)||scope.character});
   try{await writeFile(temporary,JSON.stringify({schemaVersion:1,scopes:[...next].map(([id,row])=>({id,...row}))})+'\n',{flag:'wx',mode:0o600});await rename(temporary,file);scopes.set(id,next.get(id));}
   finally{await unlink(temporary).catch(()=>{});}
   return id;
  };
  const next=scopeQueue.then(action);scopeQueue=next.catch(()=>{});return next;
 }
 async function ownerScope(identity,character){
  const current=character||getCharacter(),selected=identity?.host||(typeof host==='function'?host():host);
  const scope=normalizeMemoryScope({host:selected,profile:'standalone',channel:'desktop',account:'local',audience:'owner',actor:'owner',character:current.id||'white-dragon'});
  await registerMemoryScope(scope,{name:(current.name||current.copy?.name||scope.character)+(locale==='en'?' · Desktop chat':' · 桌面闲聊')});return scope;
 }
 async function memoryScopes(){await ownerScope();return{scopes:[...scopes].map(([scopeId,row])=>({scopeId,label:row.label})),locale};}
 function allowedScope(id){if(typeof id!=='string'||!scopes.has(id))fail('memory_scope_unavailable');return scopes.get(id).scope;}
 async function memoryAction(body){
  if(!fields(body,['action','scopeId','id','ids','text','query','limit','offset','mode','days','ticket','includeText','includeSuperseded','maxChars']))fail('invalid_input');
  const scope=allowedScope(body.scopeId);
  if(body.action==='query')return body.id?memory.get(scope,{id:body.id,maxChars:body.maxChars??16384}):memory.query(scope,{query:body.query||'',limit:body.limit??20,offset:body.offset??0,includeText:false,includeSuperseded:body.includeSuperseded===true});
  if(body.action==='context'){
   if(body.mode==='last-used'){
    const used=lastContexts.get(body.scopeId);
    if(used&&await memory.isCurrent(scope,used.ticket))return{...structuredClone(used),used:true};
    return{context:'',selectedIds:[],used:false};
   }
   if(body.mode!==undefined&&body.mode!=='preview')fail('invalid_input');
   return{...await memory.buildContext(scope,{query:body.query||'',maxTokens:4096,maxChars:12000}),used:false};
  }
  if(body.action==='correct')return memory.correct(scope,{id:body.id,role:'user',text:body.text,source:{kind:'chat',speaker:'owner',confirmation:'confirmed',label:locale==='en'?'Owner correction':'本人更正'}},{ticket:body.ticket});
  if(body.action==='remove')return memory.remove(scope,{ids:body.ids},{ticket:body.ticket});
  if(body.action==='clear')return memory.clear(scope,{ticket:body.ticket});
  if(body.action==='retention')return memory.setRetention(scope,{days:body.days},{ticket:body.ticket});
  if(body.action==='summarize'){
   if(typeof summarizeMemory!=='function'||typeof body.id!=='string')fail('action_unavailable');
   return memory.summarize(scope,{ids:[body.id],limit:1,ticket:body.ticket,summarizer:batch=>summarizeMemory({scope,...batch})});
  }
  fail('invalid_action');
 }
 function markMemoryUsed(scope,context,execution={}){
  const id=scopeKey(scope);if(!scopes.has(id)||!context?.ticket)return;
  lastContexts.set(id,{context:context.context,selectedIds:[...(context.selectedIds||[])],ticket:structuredClone(context.ticket),execution:{model:label(execution.model,100),effort:label(execution.effort,20),provenance:label(execution.provenance,30)}});
 }
 async function observeManual(view,controller={}){
  if(!view?.id||!STATES[view.state])return;
  const terminal=['completed','failed','timed_out','cancelled'].includes(view.state),stamp=Date.parse(view.updatedAt||view.finishedAt||view.progress?.at(-1)?.at||view.startedAt)||now();
  return tasks.observe({key:'manual:'+view.id,host:'codex',source:'pet',state:STATES[view.state],active:!terminal,at:stamp,startedAt:Date.parse(view.startedAt)||stamp,
   title:locale==='en'?'Project task':'目录任务',project:projectName(view.cwd),model:view.execution?.model,effort:view.execution?.effort,provenance:view.execution?.provenance,
   phase:terminal?'response':view.progress?.at(-1)?.kind||'working'},
  {...(typeof controller.cancel==='function'?{cancel:()=>({ok:controller.cancel(view.id)===true})}:{}),result:()=>({summary:view.summary||'',progress:structuredClone(view.progress||[]),execution:view.execution||null})});
 }
 return{models,tasks,memory,ownerScope,registerMemoryScope,memoryScopes,memoryAction,markMemoryUsed,observeManual,
  memoryExport:async id=>memory.export(allowedScope(id)),flush:async()=>{await scopeQueue;await tasks.flush();}};
}
