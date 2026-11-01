import {mkdir,lstat,readFile,writeFile,rename,unlink,readdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {contentError,contentPlatforms,contentPlatform,CONTENT_OPERATIONS,contentToolRequest,normalizeContentMaterials,contentTargets,publicContentUrl,contentToolName,contentArgumentName} from './platform-catalog.mjs';
import {createContentToolCaller} from './platform-mcp.mjs';
import {readContentSubscription} from './platform-rss.mjs';
import {callContentObs} from './platform-obs.mjs';
import {callOverseasContent,OVERSEAS_API_CAPABILITIES} from './platform-overseas.mjs';
import {protectQQSecret,unprotectQQSecret} from './qq-secrets.mjs';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text=(value,max=200)=>typeof value==='string'&&!/[\u0000-\u001f\u007f]/.test(value)&&value.length<=max;
const clone=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const terminal=new Set(['completed','failed','cancelled','interrupted','declined','uncertain']);
const defaults={maxItems:5,maxFrames:3,mediaSeconds:30,maxToolCalls:5,maxModelCalls:1,maxInputChars:12000,maxMediaBytes:2*1024*1024,dailyRuns:10,dailyModelCalls:10,maxRunSeconds:120};
const ceilings={maxItems:50,maxFrames:12,mediaSeconds:600,maxToolCalls:20,maxModelCalls:3,maxInputChars:32000,maxMediaBytes:8*1024*1024,dailyRuns:200,dailyModelCalls:200,maxRunSeconds:600};
const codes=new Set(['content_cancelled','content_timeout','content_tool_unconfigured','content_tool_failed','content_mcp_failed','content_mcp_unavailable','content_mcp_protocol','content_response_too_large','content_subscription_invalid','content_subscription_unavailable','content_obs_unavailable','content_obs_protocol','content_obs_request_failed','content_auth_required','content_delivery_uncertain','content_daily_budget','content_model_budget','content_tool_budget','content_analysis_unavailable','content_materials_empty','content_write_declined','content_scope_changed','content_platform_unavailable','content_platform_limited','content_action_unsupported','content_account_invalid','content_response_invalid']);
function failed(code){throw contentError(code);}
function budgetOf(value={}){if(!record(value)||Object.keys(value).some(key=>!Object.hasOwn(defaults,key)))failed('content_budget_invalid');const result={...defaults,...value};for(const [key,n]of Object.entries(result))if(!Number.isInteger(n)||n<1||n>ceilings[key])failed('content_budget_invalid');return result;}
function connectionOf(value){
 if(value==null)return null;if(!record(value))failed('content_connection_invalid');
 if(value.type==='platform-api'){
  if(Object.keys(value).some(key=>!['type','accessToken','apiKey','accessTokenSecret','apiKeySecret','clientId','userId','boardId','subreddit','apiVersion'].includes(key)))failed('content_connection_invalid');
  const result={type:'platform-api'};for(const[key,entry]of Object.entries(value)){if(key==='type')continue;if(!text(entry,key.endsWith('Secret')?32768:8192)||/\s/.test(entry))failed('content_account_invalid');result[key]=entry;}return result;
 }
 if(value.type==='mcp-http'){
  if(Object.keys(value).some(key=>!['type','endpoint'].includes(key)))failed('content_connection_invalid');
  let url;try{url=new URL(value.endpoint);if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||!url.port||url.username||url.password||url.search||url.hash)throw Error();}catch{failed('content_endpoint_invalid');}
  return{type:'mcp-http',endpoint:url.href};
 }
 if(value.type==='rss'){
  if(Object.keys(value).some(key=>!['type','url'].includes(key))||!text(value.url,4096))failed('content_connection_invalid');
  let url;try{url=new URL(value.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash)throw Error();}catch{failed('content_subscription_invalid');}return{type:'rss',url:url.href};
 }
 if(value.type==='obs'){
  if(Object.keys(value).some(key=>!['type','endpoint','password','passwordSecret'].includes(key)))failed('content_connection_invalid');
  let url;try{url=new URL(value.endpoint||'ws://127.0.0.1:4455');if(url.protocol!=='ws:'||!['127.0.0.1','[::1]'].includes(url.hostname)||!url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error();}catch{failed('content_endpoint_invalid');}
  if(value.password!==undefined&&!text(value.password,1024)||value.passwordSecret!==undefined&&!text(value.passwordSecret,32768))failed('content_connection_invalid');
  return{type:'obs',endpoint:url.href,...(value.password!==undefined?{password:value.password}:{}),...(value.passwordSecret?{passwordSecret:value.passwordSecret}:{})};
 }
 failed('content_connection_invalid');
}
function profileOf(value,prior,now){
 if(!record(value)||Object.keys(value).some(key=>!['id','platform','host','label','enabled','serverId','revision','connection','bindings','allowedOperations','budget','schedule','readAction','input','shareChannelId','share','dedupe','enrichment'].includes(key)))failed('content_profile_invalid');
 const p={...(prior??{}),...value},platform=contentPlatform(p.platform),changedScope=!!prior&&(prior.host!==p.host||prior.platform!==p.platform);
 if(changedScope){for(const key of ['connection','serverId','revision'])if(!Object.hasOwn(value,key))p[key]=null;if(!Object.hasOwn(value,'allowedOperations'))p.allowedOperations=undefined;if(!Object.hasOwn(value,'bindings'))p.bindings={};}
 if(!['codex','workbuddy','harness'].includes(p.host)||!text(p.label??platform.name,80)||typeof p.enabled!=='boolean'||p.id!==undefined&&!opaque(p.id))failed('content_profile_invalid');
 if(p.serverId!=null&&!opaque(p.serverId)||p.revision!=null&&!text(p.revision,256))failed('content_binding_invalid');
 const allowedOperations={read:true,like:false,comment:false,dm:false,publish:false,broadcast:false,...(!changedScope?prior?.allowedOperations:{}),...p.allowedOperations};
 if(p.allowedOperations!==undefined&&!record(p.allowedOperations)||Object.entries(allowedOperations).some(([key,value])=>!CONTENT_OPERATIONS.includes(key)||typeof value!=='boolean'))failed('content_permission_invalid');
 const bindings=p.bindings??{};if(!record(bindings)||Object.keys(bindings).length>30)failed('content_binding_invalid');
 for(const [action,binding]of Object.entries(bindings)){
  if(!platform.actions[action]||!record(binding)||Object.keys(binding).some(key=>!['tool','arguments'].includes(key))||!contentToolName(binding.tool)||!record(binding.arguments??{})||Object.keys(binding.arguments??{}).length>32)failed('content_binding_invalid');
  for(const [key,arg]of Object.entries(binding.arguments??{}))if(!contentArgumentName(key)||/token|secret|password|cookie|authorization|api_key|headers|env/i.test(key)&&!(typeof arg==='string'&&arg==='$itemToken')||!(arg===null||typeof arg==='boolean'||typeof arg==='number'&&Number.isFinite(arg)||typeof arg==='string'&&arg.length<=2048&&(!arg.startsWith('$')||/^\$(?:query|itemId|itemToken|url|roomId|recipient|text|count|mediaSeconds|frames)$/.test(arg))))failed('content_binding_invalid');
 }
 const schedule={enabled:false,intervalMinutes:60,timeZone:'Asia/Shanghai',startHour:0,endHour:24,...p.schedule};
 if(p.schedule!==undefined&&!record(p.schedule)||Object.keys(schedule).some(key=>!['enabled','intervalMinutes','timeZone','startHour','endHour','nextRunAt'].includes(key))||typeof schedule.enabled!=='boolean'||!Number.isInteger(schedule.intervalMinutes)||schedule.intervalMinutes<5||schedule.intervalMinutes>10080||!Number.isInteger(schedule.startHour)||!Number.isInteger(schedule.endHour)||schedule.startHour<0||schedule.startHour>23||schedule.endHour<1||schedule.endHour>24||schedule.startHour>=schedule.endHour)failed('content_schedule_invalid');
 try{new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timeZone}).format(new Date());}catch{failed('content_schedule_invalid');}
 if(prior?.schedule?.enabled&&(!Number.isSafeInteger(prior.schedule.nextRunAt)||prior.schedule.nextRunAt<0))failed('content_schedule_invalid');
 schedule.nextRunAt=schedule.enabled?(prior?.schedule?.enabled&&prior.schedule.intervalMinutes===schedule.intervalMinutes?prior.schedule.nextRunAt:now+schedule.intervalMinutes*60000):null;
 const readAction=p.readAction??(platform.actions.feed?'feed':Object.keys(platform.actions).find(key=>platform.actions[key].operation==='read'));if(!platform.actions[readAction]||platform.actions[readAction].operation!=='read')failed('content_action_invalid');
 if(p.input!==undefined&&(!record(p.input)||Object.keys(p.input).some(key=>!['query','itemId','url','roomId','recipient','text','count','mediaSeconds','frames'].includes(key))))failed('content_input_invalid');
 if(p.share!==undefined&&typeof p.share!=='boolean'||p.dedupe!==undefined&&typeof p.dedupe!=='boolean'||p.shareChannelId!=null&&!opaque(p.shareChannelId))failed('content_profile_invalid');
 const connection=connectionOf(p.connection?.type==='platform-api'&&prior?.connection?.type==='platform-api'&&prior.platform===p.platform&&prior.host===p.host?{...prior.connection,...p.connection}:p.connection);
 if(connection?.type==='platform-api'&&!OVERSEAS_API_CAPABILITIES[p.platform])failed('content_connection_invalid');
 if(connection?.type==='obs'&&platform.id!=='obs'||platform.id==='obs'&&connection?.type!=='obs'||connection?.type==='rss'&&!['weibo','tieba'].includes(platform.id))failed('content_connection_invalid');
 const enrichment=p.enrichment??[];if(!Array.isArray(enrichment)||enrichment.length>5||new Set(enrichment).size!==enrichment.length||enrichment.some(action=>!['detail','comments','subtitles','frames','watch','cover'].includes(action)||platform.actions[action]?.operation!=='read'))failed('content_enrichment_invalid');
 return{id:p.id??randomUUID(),platform:platform.id,host:p.host,label:p.label??platform.name,enabled:p.enabled,serverId:p.serverId??null,revision:p.revision??null,connection,bindings:clone(bindings),allowedOperations,budget:budgetOf({...prior?.budget,...p.budget}),schedule,readAction,input:clone(p.input??{}),share:p.share===true,shareChannelId:p.shareChannelId??null,dedupe:p.dedupe!==false,enrichment:[...enrichment]};
}
function dayAt(now,timeZone){return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
const limitText=(value,max)=>typeof value==='string'?value.slice(0,max):'';
function modelFact(value){return record(value)&&text(value.id,160)&&['host-response','event-metadata'].includes(value.source)?{id:value.id,source:value.source}:null;}

/** 内容读取、受限分析与外部写入分层；本服务不创建电脑任务或接受模型生成的工具调用。 */
export async function createContentActivityService({dataRoot,activityGate,callPlatformTool=createContentToolCaller(),analyze,onState=()=>{},onShare,confirmWrite=async()=>false,now=Date.now,fetchImpl=globalThis.fetch,obsCall=callContentObs,platformApiCall=callOverseasContent,seal=protectQQSecret,unseal=unprotectQQSecret,scheduler=true}={}){
 if(!isAbsolute(dataRoot??''))failed('content_directory_invalid');
 const directory=join(dataRoot,'content-activities'),artifacts=join(directory,'artifacts'),file=join(directory,'state.json');
 for(const dir of [dataRoot,directory,artifacts]){await mkdir(dir,{recursive:true,mode:0o700});const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())failed('content_store_invalid');}
 async function readStored(path,max=2*1024*1024){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>max)failed('content_store_invalid');return JSON.parse(await readFile(path,'utf8'));}
 let data={schemaVersion:1,profiles:[],jobs:[],daily:{},seen:[]};
 try{data=await readStored(file);if(data.schemaVersion!==1||!Array.isArray(data.profiles)||data.profiles.length>64||!Array.isArray(data.jobs)||data.jobs.length>200||!record(data.daily)||!Array.isArray(data.seen)||data.seen.length>10000)failed('content_store_invalid');data.profiles=data.profiles.map(p=>{if(!uuid(p.id)||['password','accessToken','apiKey'].some(key=>p.connection?.[key]!==undefined))failed('content_store_invalid');return profileOf(p,p,now());});for(const j of data.jobs)if(!uuid(j.id)||!uuid(j.profileId)||!record(j.counts)||!Number.isFinite(j.startedAt))failed('content_store_invalid');}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const job of data.jobs)if(!terminal.has(job.state)){job.state='interrupted';job.error='process_restarted';job.finishedAt=now();}
 let disposed=false,running=null,current=null,queue=Promise.resolve(),writes=Promise.resolve();
 const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
 async function atomic(path,value){let info;try{info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)failed('content_store_invalid');}catch(error){if(error.code!=='ENOENT')throw error;}const raw=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(raw)>8*1024*1024)failed('content_store_limit');const temp=path+'.tmp-'+randomUUID();try{await writeFile(temp,raw,{flag:'wx',mode:0o600});await rename(temp,path);}finally{await unlink(temp).catch(()=>{});}}
 const persist=()=>{const value=clone(data);const task=writes.then(()=>atomic(file,value));writes=task.catch(()=>{});return task;};
 // 只清理本服务按UUID生成、已从持久索引淘汰的普通产物；不递归扫描或跟随链接。
 async function pruneArtifacts(){const retained=new Set(data.jobs.map(job=>job.id+'.json'));for(const name of await readdir(artifacts)){if(retained.has(name)||!name.endsWith('.json')||!uuid(name.slice(0,-5)))continue;const path=join(artifacts,name);try{const info=await lstat(path);if(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1)await unlink(path);}catch(error){if(error.code!=='ENOENT')throw error;}}}
 const counter=profile=>{const day=dayAt(now(),profile.schedule.timeZone);if(data.daily[profile.id]?.day!==day)data.daily[profile.id]={day,runs:0,modelCalls:0,toolCalls:0};return data.daily[profile.id];};
 function publicProfile(profile){const definition=contentPlatform(profile.platform),c=profile.connection,configured=c?.type==='platform-api'?!!((c.accessTokenSecret||c.apiKeySecret)&&(!['x','instagram','twitch'].includes(profile.platform)||c.userId)&&(profile.platform!=='twitch'||c.clientId)&&OVERSEAS_API_CAPABILITIES[profile.platform].actions.includes(profile.readAction)):c?.type==='rss'?profile.readAction==='feed':c?.type==='obs'?true:!!((c||profile.serverId&&profile.revision)&&contentToolName(profile.bindings?.[profile.readAction]?.tool??definition.actions[profile.readAction]?.tool));return{id:profile.id,platform:profile.platform,host:profile.host,label:profile.label,enabled:profile.enabled,configured,state:configured?'configured':'unconfigured',region:definition.region,verification:'not-verified',transport:profile.connection?.type??'host-mcp',apiCredentials:c?.type==='platform-api'?{accessToken:!!c.accessTokenSecret,apiKey:!!c.apiKeySecret}:null,hasObsPassword:c?.type==='obs'&&!!c.passwordSecret,serverId:profile.serverId,revision:profile.revision,bindings:clone(profile.bindings),allowedOperations:clone(profile.allowedOperations),budget:clone(profile.budget),schedule:clone(profile.schedule),readAction:profile.readAction,input:{...clone(profile.input),...(profile.input.url?{url:publicContentUrl(profile.input.url,profile.platform)}:{})},share:profile.share,shareChannelId:profile.shareChannelId,dedupe:profile.dedupe,enrichment:[...profile.enrichment],daily:clone(counter(profile))};}
 function jobView(job){return{id:job.id,profileId:job.profileId,platform:job.platform,host:job.host,label:job.label,action:job.action,operation:job.operation,state:job.state,stage:job.stage,startedAt:job.startedAt,finishedAt:job.finishedAt??null,updatedAt:job.updatedAt,elapsedMs:Math.max(0,(job.finishedAt??now())-job.startedAt),counts:clone(job.counts),sourceCount:job.sourceCount??0,materialKinds:clone(job.materialKinds??[]),partial:job.partial===true,analysis:clone(job.analysis??{state:'not-requested',actualModel:null}),shareState:job.shareState??'not-requested',error:job.error??null,verification:'not-verified',hasArtifact:job.hasArtifact===true};}
 function state(){return{platforms:contentPlatforms().map(platform=>{const api=OVERSEAS_API_CAPABILITIES[platform.id]??null,defaults=platform.actions.some(action=>action.defaultTool);return{...platform,api,implementation:api?'api-and-selected-mcp':defaults?'source-mapped-mcp':['weibo','tieba'].includes(platform.id)?'subscription-and-selected-mcp':platform.id==='obs'?'obs-control':'integration-required',knownGaps:api?.gaps??(platform.id==='facebook'||platform.id==='lemon8'||platform.id==='tiktok-live'?['no-default-account-reader','owner-selected-narrow-service-required']:platform.id==='tieba'?['account-recommendations-not-implemented']:[])}}),profiles:data.profiles.map(publicProfile),jobs:data.jobs.map(jobView),busy:!!running,activeJobId:current?.job.id??null};}
 function emit(job,stage){job.stage=stage;job.updatedAt=now();try{Promise.resolve(onState(jobView(job))).catch(()=>{});}catch{}}
 async function configure(body){return serial(async()=>{
  if(disposed||!record(body))failed('content_unavailable');if(running)failed('content_busy');
  const release=activityGate?.acquire('content-settings');if(activityGate&&!release)failed('content_busy');try{
  if(body.action==='save-profile'){
   if(Object.keys(body).some(key=>!['action','profile'].includes(key)))failed('content_profile_invalid');
   const prior=body.profile?.id?data.profiles.find(p=>p.id===body.profile.id):null;if(body.profile?.id&&!prior)failed('content_profile_not_found');
   if(prior&&current?.job.profileId===prior.id)failed('content_busy');if(!prior&&data.profiles.length>=64)failed('content_profile_limit');
   const profile=profileOf(body.profile,prior,now());
   if(profile.connection?.type==='obs'){
    if(Object.hasOwn(profile.connection,'password')){const password=profile.connection.password;delete profile.connection.password;if(password)profile.connection.passwordSecret=await seal(password);else delete profile.connection.passwordSecret;}
    else if(prior?.connection?.type==='obs'&&prior.connection.passwordSecret)profile.connection.passwordSecret=prior.connection.passwordSecret;
   }
   if(profile.connection?.type==='platform-api')for(const key of ['accessToken','apiKey'])if(Object.hasOwn(profile.connection,key)){const value=profile.connection[key];delete profile.connection[key];if(value)profile.connection[key+'Secret']=await seal(value);else delete profile.connection[key+'Secret'];}
   const before=clone(data);try{data.profiles=prior?data.profiles.map(p=>p.id===prior.id?profile:p):[...data.profiles,profile];await persist();}catch(error){data=before;throw error;}return state();
  }
  if(body.action==='remove-profile'){
   if(Object.keys(body).some(key=>!['action','profileId'].includes(key))||!opaque(body.profileId))failed('content_profile_invalid');if(current?.job.profileId===body.profileId)failed('content_busy');const before=clone(data);try{data.profiles=data.profiles.filter(p=>p.id!==body.profileId);delete data.daily[body.profileId];data.seen=data.seen.filter(value=>!value.startsWith(body.profileId+':'));await persist();}catch(error){data=before;throw error;}return state();
  }
  failed('content_action_invalid');
  }finally{release?.();}
 });}
 async function guarded(promise,signal){if(signal.aborted)failed('content_cancelled');let listener;try{return await Promise.race([promise,new Promise((_,reject)=>{listener=()=>reject(contentError('content_cancelled'));signal.addEventListener('abort',listener,{once:true});})]);}finally{if(listener)signal.removeEventListener('abort',listener);}}
 async function execute(context){
   const {job,profile,input,signal,request}=context;let report={schemaVersion:1,jobId:job.id,profileId:profile.id,platform:profile.platform,host:profile.host,createdAt:job.startedAt,input:Object.fromEntries(Object.entries(input).filter(([name])=>name!=='itemToken').map(([key,value])=>[key,key==='url'?publicContentUrl(value,profile.platform):value])),sources:[],materials:[],analysis:null};
  const output=async()=>{await atomic(join(artifacts,job.id+'.json'),report);job.hasArtifact=true;};
  const apiCall=async(action,values)=>{const account={};for(const key of ['clientId','userId','boardId','subreddit','apiVersion'])if(profile.connection[key])account[key]=profile.connection[key];for(const key of ['accessToken','apiKey'])if(profile.connection[key+'Secret'])account[key]=await unseal(profile.connection[key+'Secret']);return guarded(platformApiCall({platform:profile.platform,action,input:{...values,count:Math.min(values.count??profile.budget.maxItems,profile.budget.maxItems),mediaSeconds:Math.min(values.mediaSeconds??profile.budget.mediaSeconds,profile.budget.mediaSeconds),frames:Math.min(values.frames??profile.budget.maxFrames,profile.budget.maxFrames)},account,signal,fetchImpl}),signal);};
  try{
   if(request.operation!=='read'){
    job.state='waiting';emit(job,'confirmation');await persist();const accepted=await guarded(Promise.resolve(confirmWrite({job:jobView(job),operation:request.operation,platform:profile.platform,host:profile.host,tool:request.tool,arguments:clone(request.arguments),signal})),signal);
    if(accepted!==true){job.state='declined';job.error='content_write_declined';return;}
   }
   if(signal.aborted)failed('content_cancelled');if(job.counts.toolCalls>=profile.budget.maxToolCalls)failed('content_tool_budget');
   job.state='working';job.counts.toolCalls++;counter(profile).toolCalls++;emit(job,'fetching');await persist();
   let response;
   if(profile.connection?.type==='rss'){
    if(job.action!=='feed')failed('content_action_unsupported');response=await guarded(readContentSubscription(profile,{signal,fetchImpl}),signal);report.sourceType='subscription';report.personalized=false;
   }else if(profile.connection?.type==='platform-api'){
    response=await apiCall(job.action,input);report.sourceScope=OVERSEAS_API_CAPABILITIES[profile.platform].scope;report.personalized=false;
   }else if(profile.platform==='obs'){
    const password=profile.connection.passwordSecret?await unseal(profile.connection.passwordSecret):'';
    response=await guarded(obsCall({endpoint:profile.connection.endpoint,password,action:job.action,signal}),signal);report.broadcast={confirmed:response.confirmed===true,operation:response.operation,status:response.status};
   }else{
    response=await guarded(Promise.resolve(callPlatformTool({profile:clone(profile),profileId:profile.id,platform:profile.platform,host:profile.host,serverId:profile.serverId,revision:profile.revision,tool:request.tool,arguments:clone(request.arguments),signal})),signal);
   }
   if(signal.aborted)failed('content_cancelled');
   if(profile.platform!=='obs'){
    emit(job,'materials');const normalized=normalizeContentMaterials(response,{platform:profile.platform,action:job.action,input,maxItems:profile.budget.maxItems,maxChars:profile.budget.maxInputChars});
    let {sources,materials}=normalized;if(normalized.mediaEvidence.partial===true||['watch','frames'].includes(job.action)&&!materials.some(value=>value.kind==='image'))job.partial=true;
    if(profile.dedupe&&['feed','search'].includes(job.action)){
     const old=new Set(data.seen),skipped=new Set(sources.filter(source=>old.has(profile.id+':'+source.id)).map(source=>source.id));
     sources=sources.filter(source=>!skipped.has(source.id));materials=materials.filter(material=>!material.sourceId||!skipped.has(material.sourceId));job.counts.skippedSources=skipped.size;
     for(const source of sources)data.seen.push(profile.id+':'+source.id);data.seen=[...new Set(data.seen)].slice(-10000);
    }
    report.sources=sources;report.materials=materials;report.mediaEvidence=[{action:job.action,...normalized.mediaEvidence}];report.enrichmentErrors=[];
    if(request.operation==='read'&&['feed','search'].includes(job.action)&&profile.enrichment.length&&profile.connection?.type!=='rss'){
     const newSources=new Set(sources.map(source=>source.id)),targets=contentTargets(response,profile.platform,profile.budget.maxItems).filter(target=>!target.sourceId||newSources.has(target.sourceId));
     for(const target of targets){
      for(const action of profile.enrichment){
       if(job.counts.toolCalls>=profile.budget.maxToolCalls){job.partial=true;report.enrichmentErrors.push({action,code:'content_tool_budget'});break;}
       if(signal.aborted)failed('content_cancelled');const stepInput={...input,...target};delete stepInput.sourceId;
       let step;try{step=profile.connection?.type==='platform-api'?{operation:'read',tool:'api:'+profile.platform+':'+action,arguments:stepInput}:contentToolRequest(profile,action,stepInput);}catch(error){job.partial=true;report.enrichmentErrors.push({action,code:error.code==='content_parameter_missing'?'content_parameter_missing':'content_tool_unconfigured'});continue;}job.counts.toolCalls++;counter(profile).toolCalls++;emit(job,'materials:'+action);await persist();
       try{
        const extra=profile.connection?.type==='platform-api'?await apiCall(action,stepInput):await guarded(Promise.resolve(callPlatformTool({profile:clone(profile),profileId:profile.id,platform:profile.platform,host:profile.host,serverId:profile.serverId,revision:profile.revision,tool:step.tool,arguments:clone(step.arguments),signal})),signal);
        const remaining=Math.max(0,profile.budget.maxInputChars-report.materials.reduce((n,row)=>n+(row.text?.length??0),0));
        const shaped=normalizeContentMaterials(extra,{platform:profile.platform,action,input:stepInput,maxItems:profile.budget.maxItems,maxChars:remaining});
        for(const source of shaped.sources)if(!report.sources.some(row=>row.id===source.id))report.sources.push(source);
        for(const material of shaped.materials)if(report.materials.length<40&&!report.materials.some(row=>row.id===material.id))report.materials.push(material);
        report.mediaEvidence.push({action,...shaped.mediaEvidence});if(shaped.mediaEvidence.partial===true||['watch','frames'].includes(action)&&!shaped.materials.some(value=>value.kind==='image'))job.partial=true;
       }catch(error){if(signal.aborted||['mcp_config_changed','mcp_source_changed','content_scope_changed'].includes(error.code))throw error;job.partial=true;report.enrichmentErrors.push({action,code:codes.has(error.code)?error.code:'content_tool_failed'});}
      }
      if(job.counts.toolCalls>=profile.budget.maxToolCalls)break;
     }
    }
    // 相同帧预算下优先留下真实像素，不能让封面URL挤掉已经取得的画面。
    let visualCount=0,mediaBytes=0;report.materials.sort((a,b)=>Number(b.kind==='image')-Number(a.kind==='image'));report.materials=report.materials.filter(material=>{
     const visual=['image','image-reference'].includes(material.kind),bytes=material.data?Buffer.byteLength(material.data,'base64'):0;
     if(visual&&visualCount>=profile.budget.maxFrames||mediaBytes+bytes>profile.budget.maxMediaBytes){job.partial=true;return false;}if(visual)visualCount++;mediaBytes+=bytes;return true;
    });
    report.mediaBytes=mediaBytes;sources=report.sources;materials=report.materials;report.sourceState=sources.length?'available':'unavailable';job.sourceCount=sources.length;job.materialKinds=[...new Set(materials.map(material=>material.kind))];job.counts.materials=materials.length;
    if(context.analyze&&materials.length){
     if(typeof analyze!=='function')failed('content_analysis_unavailable');if(job.counts.modelCalls>=profile.budget.maxModelCalls||counter(profile).modelCalls>=profile.budget.dailyModelCalls)failed('content_model_budget');
     job.counts.modelCalls++;counter(profile).modelCalls++;emit(job,'analyzing');await persist();
     const answer=await guarded(Promise.resolve(analyze({job:jobView(job),profileId:profile.id,host:profile.host,purpose:'content',materials:clone(materials),sources:clone(sources),budget:clone(profile.budget),constraints:{tools:false,computerAccess:false,externalContentIsUntrusted:true},signal})),signal);
     const answerText=limitText(typeof answer==='string'?answer:answer?.text,24000);if(!answerText)failed('content_analysis_unavailable');
     const used=new Set(materials.map(material=>material.id)),supplied=Array.isArray(answer?.materialIdsUsed)?answer.materialIdsUsed.filter(id=>used.has(id)):[];
     report.analysis={text:answerText,actualModel:modelFact(answer?.actualModel),requestedModel:text(answer?.requestedModel,160)?answer.requestedModel:null,materialIdsUsed:[...new Set(supplied)]};job.analysis={state:'completed',actualModel:report.analysis.actualModel,requestedModel:report.analysis.requestedModel,materialIdsUsed:report.analysis.materialIdsUsed};
    }else job.analysis={state:context.analyze?'empty':'not-requested',actualModel:null,materialIdsUsed:[]};
    if(context.share){
     if(typeof onShare!=='function'||!profile.shareChannelId)job.shareState='unconfigured';else{
      emit(job,'sharing');const text=report.analysis?.text??report.sources.map(source=>(source.title?source.title+'\n':'')+source.url).join('\n\n');
      const delivered=await guarded(Promise.resolve(onShare({job:jobView(job),channelId:profile.shareChannelId,text,sources:clone(report.sources),signal})),signal);job.shareState=delivered?.confirmed===true?'confirmed':'unconfirmed';
     }
    }
   }
   await output();job.state='completed';emit(job,'complete');
  }catch(error){
   const code=job.error==='content_timeout'?'content_timeout':['mcp_config_changed','mcp_source_changed'].includes(error?.code)?'content_scope_changed':codes.has(error?.code)?error.code:'content_failed';job.error=code;job.state=code==='content_delivery_uncertain'||request.operation!=='read'&&job.stage==='fetching'?'uncertain':code==='content_cancelled'?'cancelled':'failed';report.error=code;
   if(report.materials.length||report.broadcast)await output().catch(()=>{});
  }finally{job.finishedAt=now();job.updatedAt=now();clearTimeout(context.timer);emit(job,job.state);try{await persist();}finally{context.release?.();if(current===context)current=null;running=null;}}
 }
 async function start(body){return serial(async()=>{
  if(disposed||!record(body)||Object.keys(body).some(key=>!['profileId','action','input','analyze','share','requestId','scheduled'].includes(key))||!opaque(body.profileId)||body.analyze!==undefined&&typeof body.analyze!=='boolean'||body.share!==undefined&&typeof body.share!=='boolean')failed('content_input_invalid');
  const profile=data.profiles.find(p=>p.id===body.profileId);if(!profile)failed('content_profile_not_found');
  const requestKey=body.requestId===undefined?null:text(body.requestId,512)&&body.requestId?hash(profile.id+'\0'+body.requestId):failed('content_input_invalid');const prior=requestKey?data.jobs.find(job=>job.requestKey===requestKey):null;if(prior)return jobView(prior);
  if(running)failed('content_busy');if(!profile.enabled)failed('content_disabled');if(!publicProfile(profile).configured)failed('content_tool_unconfigured');
  const action=body.action??profile.readAction,definition=contentPlatform(profile.platform).actions[action];if(!definition)failed('content_action_invalid');if(!profile.allowedOperations[definition.operation])failed('content_operation_denied');
  if(body.scheduled===true){
   if(!profile.schedule.enabled||profile.schedule.nextRunAt>now())failed('content_schedule_not_due');
   profile.schedule.nextRunAt=now()+profile.schedule.intervalMinutes*60000;
   const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:profile.schedule.timeZone,hour:'numeric',hourCycle:'h23'}).format(new Date(now())));if(hour<profile.schedule.startHour||hour>=profile.schedule.endHour){await persist();return null;}
   if(definition.operation!=='read')failed('content_schedule_write_denied');
  }
  if(counter(profile).runs>=profile.budget.dailyRuns)failed('content_daily_budget');
  if(body.input!==undefined&&!record(body.input))failed('content_input_invalid');const input={...profile.input,...body.input};if(Object.keys(input).some(key=>!['query','itemId','itemToken','url','roomId','recipient','text','count','mediaSeconds','frames'].includes(key))||input.url!==undefined&&!publicContentUrl(input.url,profile.platform)||['count','mediaSeconds','frames'].some(key=>input[key]!==undefined&&(!Number.isInteger(input[key])||input[key]<1)))failed('content_input_invalid');
  let request;if(profile.connection?.type==='rss')request={operation:'read',tool:'subscription',arguments:{}};else if(profile.connection?.type==='platform-api'){if(!OVERSEAS_API_CAPABILITIES[profile.platform].actions.includes(action))failed('content_action_unsupported');request={operation:definition.operation,tool:'api:'+profile.platform+':'+action,arguments:clone(input)};}else if(profile.platform==='obs')request={operation:definition.operation,tool:action,arguments:{}};else request=contentToolRequest(profile,action,input);
  const release=activityGate?.acquire('content-activity');if(activityGate&&!release)failed('content_busy');
  const before=clone(data),job={id:randomUUID(),profileId:profile.id,label:profile.label,platform:profile.platform,region:contentPlatform(profile.platform).region,host:profile.host,action,operation:request.operation,state:'running',stage:'queued',startedAt:now(),updatedAt:now(),requestKey,counts:{toolCalls:0,modelCalls:0,materials:0,skippedSources:0}};
  const controller=new AbortController(),context={job,profile:clone(profile),request,input,controller,signal:controller.signal,release,analyze:body.analyze===true||body.analyze!==false&&typeof analyze==='function',share:body.share??profile.share};
  try{counter(profile).runs++;data.jobs.push(job);while(data.jobs.length>200)data.jobs.shift();await persist();}catch(error){data=before;release?.();throw error;}
  await pruneArtifacts().catch(()=>{});
  current=context;context.timer=setTimeout(()=>{job.error='content_timeout';controller.abort();},profile.budget.maxRunSeconds*1000);running=Promise.resolve().then(()=>execute(context));running.catch(()=>{});emit(job,'queued');return jobView(job);
 });}
 async function cancel(id){if(!opaque(id))failed('content_job_invalid');if(current?.job.id!==id)return false;current.controller.abort();return true;}
 async function tick(){if(disposed||running)return;for(const p of data.profiles){if(!p.enabled||!p.schedule.enabled||p.schedule.nextRunAt>now())continue;try{await start({profileId:p.id,action:p.readAction,scheduled:true,analyze:true,share:p.share});}catch(error){if(error.code==='content_busy')return;p.schedule.nextRunAt=now()+p.schedule.intervalMinutes*60000;await persist();}if(running)return;}}
 async function result(id,{includeContent=false}={}){if(!uuid(id))failed('content_job_invalid');const job=data.jobs.find(value=>value.id===id);if(!job)failed('content_job_not_found');const view=jobView(job);if(!includeContent)return view;if(!job.hasArtifact)return{...view,artifact:null};return{...view,artifact:await readStored(join(artifacts,job.id+'.json'),8*1024*1024)};}
 // 只交给本机主播服务，不直接注册成HTTP或模型工具；会话确认由主播服务持有。
 async function broadcastObs(profileId,action,details={}){if(disposed)failed('content_unavailable');const profile=data.profiles.find(value=>value.id===profileId);if(profile?.platform!=='obs'||!profile.enabled||!profile.connection||!profile.allowedOperations.read||action!=='text-sources'&&!profile.allowedOperations.broadcast)failed('content_operation_denied');const password=profile.connection.passwordSecret?await unseal(profile.connection.passwordSecret):'';return obsCall({endpoint:profile.connection.endpoint,password,action,...details});}
 const timer=scheduler?setInterval(()=>void tick().catch(()=>{}),15000):null;timer?.unref?.();
 await persist();await pruneArtifacts().catch(()=>{});
 return{state,configure,start,cancel,tick,result,obsSources:async(profileId,signal)=>(await broadcastObs(profileId,'text-sources',{signal})).sources,validateCaptionSource:({profileId,sourceName,signal})=>broadcastObs(profileId,'text-read',{sourceName,signal}),async caption({profileId,sourceName,text,signal}){await broadcastObs(profileId,'text-read',{sourceName,signal});return broadcastObs(profileId,'text-write',{sourceName,text,signal});},profileRevision(profileId){const p=data.profiles.find(value=>value.id===profileId);return p?hash(JSON.stringify({host:p.host,platform:p.platform,enabled:p.enabled,connection:p.connection,serverId:p.serverId,revision:p.revision,bindings:p.bindings,allowedOperations:p.allowedOperations})):null;},idle:async()=>{await queue;await running;await writes;},async dispose(){if(disposed)return;disposed=true;if(timer)clearInterval(timer);current?.controller.abort();await queue;await running;await writes;}};
}
