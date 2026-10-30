import {randomUUID} from 'node:crypto';
import {basename,isAbsolute,parse,resolve} from 'node:path';
import {realpath,stat} from 'node:fs/promises';

const permission=value=>['read-only','workspace-write'].includes(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value);
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const fail=code=>{throw Object.assign(Error(code),{code});};
export const cleanTitle=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,80):'';

/** 项目只能由本机登记；QQ选择编号对应的记录，不能提供任意路径或提升本机权限上限。 */
export function createQQCatalog(config){
  if(config.projects!==undefined&&(!Array.isArray(config.projects)||config.projects.length>32))fail('invalid_settings');
  if(config.sessions!==undefined&&(!Array.isArray(config.sessions)||config.sessions.length>256))fail('invalid_settings');
  config.projects??=[];config.sessions??=[];
  const seen=new Set();
  for(const project of config.projects){
    if(!project||!id(project.id)||seen.has(project.id)||!isAbsolute(project.cwd||'')||parse(project.cwd).root===project.cwd||!permission(project.maxPermission)||!permission(project.permission)||project.maxPermission==='read-only'&&project.permission!=='read-only'||project.threadId&&!id(project.threadId))fail('invalid_settings');
    seen.add(project.id);project.label=cleanTitle(project.label)||basename(project.cwd);
  }
  const sessionIds=new Set();
  for(const session of config.sessions){if(!session||!id(session.id)||sessionIds.has(session.id)||!seen.has(session.projectId)||!permission(session.permission)||!['qq','existing'].includes(session.source)||typeof session.title!=='string'||session.title.length>80)fail('invalid_settings');sessionIds.add(session.id);session.title=cleanTitle(session.title);}
  if(!config.projects.length&&config.cwd){
    const project={id:randomUUID(),label:basename(config.cwd),cwd:config.cwd,maxPermission:config.permission,permission:config.permission,threadId:config.threadId};config.projects.push(project);config.activeProjectId=project.id;
    for(const threadId of [...new Set([...(config.threads||[]),...(config.threadId?[config.threadId]:[])])].slice(-256))config.sessions.push({id:threadId,projectId:project.id,permission:project.permission,title:'',source:'qq'});
  }
  if(config.activeProjectId&&!config.projects.some(p=>p.id===config.activeProjectId))fail('invalid_settings');
  let active=config.projects.find(p=>p.id===config.activeProjectId)||config.projects[0];
  for(const project of config.projects)if(project.threadId&&!config.sessions.some(s=>s.id===project.threadId&&s.projectId===project.id))fail('invalid_settings');
  function sync(){config.activeProjectId=active?.id??null;config.cwd=active?.cwd??'';config.permission=active?.permission??'read-only';config.threadId=active?.threadId??null;}
  sync();
  function current(){return active;}
  function list(){return config.projects.map(p=>({...p,threadId:undefined}));}
  async function check(project=active){
    if(!project)fail('invalid_directory');const canonical=await realpath(project.cwd).catch(()=>fail('invalid_directory'));
    if(!samePath(canonical,project.cwd)||!(await stat(canonical)).isDirectory()||parse(canonical).root===canonical)fail('invalid_directory');return project;
  }
  async function register(cwd,maxPermission){
    if(!isAbsolute(cwd||'')||!permission(maxPermission))fail('invalid_input');
    const canonical=await realpath(cwd).catch(()=>fail('invalid_directory'));
    if(!(await stat(canonical)).isDirectory()||parse(canonical).root===canonical)fail('invalid_directory');
    let project=config.projects.find(p=>samePath(p.cwd,canonical));
    if(!project){if(config.projects.length>=32)fail('project_limit');project={id:randomUUID(),label:basename(canonical),cwd:canonical,maxPermission,permission:maxPermission,threadId:null};config.projects.push(project);}
    else{project.maxPermission=maxPermission;if(maxPermission==='read-only')project.permission='read-only';}
    active=project;sync();return project;
  }
  async function select(projectId){const project=config.projects.find(p=>p.id===projectId);if(!project)fail('invalid_input');await check(project);active=project;sync();return project;}
  function remove(projectId){
    const project=config.projects.find(p=>p.id===projectId);if(!project)fail('invalid_input');
    config.projects=config.projects.filter(p=>p!==project);config.sessions=config.sessions.filter(s=>s.projectId!==projectId);
    if(active===project)active=config.projects[0];sync();
  }
  function setPermission(value){if(!active||!permission(value))fail('invalid_input');if(value==='workspace-write'&&active.maxPermission!=='workspace-write')fail('permission_limit');active.permission=value;sync();}
  function remember(threadId,{title='',source='qq'}={}){
    if(!active||!id(threadId)||!['qq','existing'].includes(source))fail('invalid_thread');
    let session=config.sessions.find(s=>s.id===threadId);
    if(session&&session.projectId!==active.id)fail('thread_scope_mismatch');
    if(!session){session={id:threadId,projectId:active.id,title:cleanTitle(title),source,permission:active.permission};config.sessions.push(session);if(config.sessions.length>256){const selected=new Set([...config.projects.map(p=>p.threadId),threadId]);const index=config.sessions.findIndex(s=>!selected.has(s.id));if(index<0)fail('invalid_settings');config.sessions.splice(index,1);}}
    else{if(title)session.title=cleanTitle(title);session.permission=active.permission;}
    active.threadId=threadId;sync();return session;
  }
  function newSelection(){if(active)active.threadId=null;sync();}
  function clearSelections(){for(const project of config.projects)project.threadId=null;sync();}
  function selected(){return config.sessions.find(s=>s.id===active?.threadId&&s.projectId===active?.id);}
  function session(threadId){return config.sessions.find(s=>s.id===threadId&&s.projectId===active?.id);}
  return{current,list,check,register,select,remove,setPermission,remember,newSelection,clearSelections,selected,session};
}
