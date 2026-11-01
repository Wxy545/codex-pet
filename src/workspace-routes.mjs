const only=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const error=code=>{throw Object.assign(Error(code),{code});};
const KNOWN=new Set(['invalid_input','invalid_action','invalid_filter','task_unavailable','action_unavailable','invalid_snooze','model_unavailable','catalog_unavailable','modality_unavailable','unsupported_effort','invalid_policy','model_selection_unavailable','memory_scope_unavailable','memory_input_invalid','memory_stale','memory_capacity','memory_scope_invalid','busy','host_unavailable','unconfigured','content_input_invalid','content_not_configured','content_budget_exceeded','content_permission_denied']);
const send=(res,status,value)=>{if(res.writableEnded||res.destroyed)return;res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));};

/** 私有路由始终由主进程令牌鉴权；各业务模块继续核验自己的范围和参数。 */
export function createWorkspaceRoutes({workspace,security,requestJson,getCatalog,content,contentSources,contentApprovals,broadcast,prefix='/dsh-pet-7340'}={}){
 const routes=[];
 function route(path,methods,run){routes.push({kind:'exact',path:prefix+path,handler:async(req,res)=>{
  if(req.headers?.['x-dsh-pet-token']!==security.token||req.headers?.origin)return send(res,403,{error:{code:'unauthorized'}});
  if(!methods.includes(req.method))return send(res,405,{error:{code:'method_not_allowed'}});
  try{const body=req.method==='GET'?null:await requestJson(req,64*1024);send(res,200,await run(req,body));}
  catch(e){const code=KNOWN.has(e.code)?e.code:'feature_unavailable';send(res,['busy','memory_stale','host_unavailable'].includes(code)?409:400,{error:{code}});}
 }});}
 route('/pet-workspace/tasks',['GET','POST'],async(req,body)=>{
  if(req.method==='GET')return workspace.tasks.list();
  if(!only(body,['action','id','until','filter']))error('invalid_input');
  if(body.action==='list')return workspace.tasks.list(body.filter||{});
  if(['read','pending','snooze'].includes(body.action))return workspace.tasks.attend({id:body.id,action:body.action,until:body.until});
  if(['open','cancel','result','artifact'].includes(body.action))return workspace.tasks.perform({id:body.id,action:body.action});
  error('invalid_action');
 });
 route('/pet-memory/scopes',['GET'],()=>workspace.memoryScopes());
 route('/pet-memory',['POST'],(_req,body)=>workspace.memoryAction(body));
 route('/pet-memory/export',['POST'],async(_req,body)=>{if(!only(body,['scopeId'])||typeof body.scopeId!=='string')error('invalid_input');return workspace.memoryExport(body.scopeId);});
 route('/pet-model-policy',['GET','POST'],async(req,body)=>{
  if(req.method==='GET')return workspace.models.snapshot();
  if(!body||!['catalog','save'].includes(body.action))error('invalid_input');
  if(body.action==='catalog'){
   if(!only(body,['action','host'])||!['codex','workbuddy','harness'].includes(body.host))error('invalid_input');
   return getCatalog(body.host);
  }
  if(!only(body,['action','host','purpose','model','effort']))error('invalid_input');
  // 手选保存时就核对目录；实际发出请求前仍会再次验证，失效不静默换模型。
  const {action,...value}=body;
  workspace.models.resolve({host:value.host,purpose:value.purpose,override:{model:value.model,effort:value.effort},catalog:await getCatalog(value.host)});
  return workspace.models.save(value);
 });
 for(const code of ['content_busy','content_tool_unconfigured','content_source_stale','content_scope_changed','content_daily_budget','content_operation_denied','content_parameter_missing','content_source_invalid','content_write_declined','content_source_limit','content_store_invalid','content_schedule_invalid','content_budget_invalid','content_binding_invalid','content_profile_invalid','content_enrichment_invalid','content_connection_invalid','content_endpoint_invalid','content_subscription_invalid','content_profile_not_found','content_job_not_found','content_job_invalid'])KNOWN.add(code);
 for(const code of ['content_broadcast_unconfigured','content_broadcast_invalid','content_broadcast_confirmation_required','content_voice_unavailable','content_voice_invalid','content_voice_timeout','content_obs_source_invalid','content_obs_source_file'])KNOWN.add(code);
 if(content)route('/pet-content',['GET','POST'],async(req,body)=>{
  if(req.method==='GET')return{...content.state(),...(broadcast?{broadcast:broadcast.state()}:{})};
  if(typeof body?.action==='string'&&body.action.startsWith('broadcast-')){
   if(!broadcast)error('content_broadcast_unconfigured');
   if(body.action==='broadcast-configure'&&only(body,['action','config']))return broadcast.configure(body.config);
   if(body.action==='broadcast-sources'&&only(body,['action','obsProfileId']))return{sources:await broadcast.sources(body.obsProfileId)};
   if(body.action==='broadcast-voices'&&only(body,['action']))return{voices:await broadcast.voices()};
   if(body.action==='broadcast-prepare'&&only(body,['action']))return broadcast.prepare();
   if(body.action==='broadcast-start'&&only(body,['action','ticket']))return broadcast.start({ticket:body.ticket});
   if(body.action==='broadcast-pause'&&only(body,['action']))return{accepted:broadcast.pause()};
   if(body.action==='broadcast-resume'&&only(body,['action']))return{accepted:broadcast.resume()};
   if(body.action==='broadcast-cancel'&&only(body,['action']))return{accepted:broadcast.cancel()};
   if(body.action==='broadcast-result'&&only(body,['action','id']))return broadcast.result(body.id);
   error('invalid_input');
  }
  if(body?.action==='approval-pending'){if(!contentApprovals||!only(body,['action']))error('invalid_input');return{items:contentApprovals.pending()};}
  if(body?.action==='approval-decide'){if(!contentApprovals||!only(body,['action','id','approved']))error('invalid_input');return{accepted:contentApprovals.decide({id:body.id,approved:body.approved})};}
  if(body?.action==='source-catalog'){
   if(!contentSources||!only(body,['action','host','sourcePath']))error('invalid_input');return contentSources.catalog({host:body.host,...(body.sourcePath===undefined?{}:{sourcePath:body.sourcePath})});
  }
  if(body?.action==='save-profile'){
   if(!only(body,['action','profile','source']))error('invalid_input');let profile=body.profile;
   if(body.source){if(!contentSources||!only(body.source,['host','sourceId','revision','serverId'])||body.source.host!==profile?.host)error('invalid_input');profile={...profile,...await contentSources.bind(body.source),connection:null};}
   return content.configure({action:'save-profile',profile});
  }
  if(body?.action==='start'){
   if(!only(body,['action','profileId','readAction','input','analyze','share','requestId']))error('invalid_input');
   return content.start({profileId:body.profileId,...(body.readAction?{action:body.readAction}:{}),...(body.input?{input:body.input}:{}),...(body.analyze===undefined?{}:{analyze:body.analyze}),...(body.share===undefined?{}:{share:body.share}),...(body.requestId?{requestId:body.requestId}:{})});
  }
  if(body?.action==='cancel'){if(!only(body,['action','id']))error('invalid_input');return content.cancel(body.id);}
  if(body?.action==='result'){if(!only(body,['action','id','includeContent']))error('invalid_input');return content.result(body.id,{includeContent:body.includeContent===true});}
  return content.configure(body);
 });
 return routes;
}
