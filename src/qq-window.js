(function(){
 'use strict';
 const api=window.qqRemote,$=id=>document.getElementById(id);
 const copy={
  bot:['QQ 连接','QQ connection'],
  application:['任务应用','Task app'],provider:['QQ 连接方式','QQ connection'],official:['QQ 官方机器人','Official QQ bot'],onebot:['普通 QQ 小号','QQ account'],
  'selection-draft':['尚未保存','Not saved'],'save-selection-first':['先保存切换，再绑定这个连接。','Save this selection before pairing it.'],
  'prepare-napcat':['准备连接','Prepare connection'],'login-napcat':['启动并扫码登录','Start and sign in'],
  'napcat-not-installed':['尚未准备','Not set up'],'napcat-preparing':['正在准备…','Setting up…'],'napcat-ready':['可以启动','Ready to start'],'napcat-starting':['正在启动…','Starting…'],'napcat-running':['小号服务运行中','QQ account service is running'],'napcat-error':['准备未完成，请重试','Setup did not finish. Try again'],
  'napcat-download':['正在下载…','Downloading…'],'napcat-verify':['正在检查文件…','Checking files…'],'napcat-extract':['正在解压…','Extracting…'],'napcat-configure':['正在准备连接…','Preparing the connection…'],
  'napcat-login-error':['登录页未能打开，请重试扫码登录。','The sign-in page could not be opened. Try QR sign-in again.'],
  'create-note':['在 QQ 开放平台创建机器人，复制 AppID 和 AppSecret。','Create a bot on the QQ Open Platform, then copy its AppID and AppSecret.'],
  platform:['创建 QQ 机器人','Create QQ bot'],
  'secret-new':['填写 QQ 开放平台提供的 AppSecret。','Enter the AppSecret from QQ Open Platform.'],
  'secret-saved':['已保存；留空可保留原密钥。','Saved. Leave blank to keep it.'],
  project:['任务范围','Task access'],folder:['项目文件夹','Project folder'],
  'authorized-projects':['已授权项目','Authorized projects'],'add-project':['添加文件夹','Add folder'],'remove-project':['移除授权','Remove access'],
  'maximum-permission':['允许的最高权限','Maximum permission allowed'],'choose-project':['选择项目','Choose a project'],'new-project':['新项目（未保存）','New project (not saved)'],
  'choose-folder':['选择文件夹','Choose folder'],'read-only':['只读查看','Read only'],'workspace-write':['允许修改这个文件夹','Allow edits in this folder'],
  save:['保存并连接','Save and connect'],disable:['停用连接','Disconnect'],refresh:['刷新','Refresh'],
  connection:['连接状态','Connection'],task:['任务状态','Task'],pending:['等待送达的回复','Replies awaiting delivery'],
  pairing:['本人绑定','Your QQ account'],
  'pair-note':['生成配对码后，用本人 QQ 私聊机器人，发送下面的配对消息。','Generate a code, then send the pairing message to your bot in a private QQ chat.'],
  'pair-note-account':['生成配对码后，用本人 QQ 私聊已登录的小号，发送下面的配对消息。','Generate a code, then send it from your own QQ account to the signed-in QQ account in a private chat.'],
  'copy-pair':['复制配对消息','Copy message'],generate:['生成配对码','Generate pairing code'],unlink:['解绑','Unpair'],
  paired:['已绑定本人 QQ','Your QQ account is paired'],'not-paired':['尚未绑定','Not paired'],
  'save-first':['先保存设置并连接 QQ。','Save your settings and connect QQ first.'],
  expired:['配对码已过期，请重新生成。','This code expired. Generate a new one.'],
  expires:['秒后过期','seconds remaining'],copied:['配对消息已复制。','Pairing message copied.'],saved:['设置已保存。','Settings saved.'],
  unavailable:['暂时无法连接桌宠，请重试。','The pet is unavailable. Try again.'],
  'stopped':['未连接','Disconnected'],connecting:['正在连接','Connecting…'],connected:['已连接','Connected'],
  disconnected:['连接已断开','Connection lost'],reconnecting:['正在重新连接','Reconnecting…'],error:['连接失败，请检查机器人信息后重试。','Connection failed. Check your bot details and try again.'],
  'account-error':['QQ 小号尚未连接，请检查登录状态后重试。','The QQ account is not connected. Check its sign-in and try again.'],
  idle:['空闲','Idle'],thinking:['正在思考','Thinking'],working:['正在执行','Working'],waiting:['等待 QQ 确认或回答','Waiting for your reply in QQ'],
  result:['正在整理结果','Preparing the result'],success:['已完成','Completed'],running:['正在执行','Working'],cancelling:['正在取消','Cancelling…'],
  completed:['已完成','Completed'],cancelled:['已取消','Cancelled'],failed:['执行失败','Failed'],interrupted:['已中断','Interrupted'],
  'task-error':['执行失败','Failed'],
  'allow-shell':['允许命令执行','Allow command execution'],'allow-mcp':['允许 MCP 工具','Allow MCP tools'],
  'refresh-mcp':['刷新服务','Refresh servers'],'choose-mcp-source':['选择配置文件','Choose configuration'],
  'mcp-loading':['正在读取服务…','Loading servers…'],'mcp-empty':['未找到可用服务','No available servers'],
  'mcp-unknown':['暂时无法读取服务','Servers are unavailable'],'mcp-not-installed':['未找到所选应用','The selected app was not found'],
  'mcp-selection':['请选择服务','Choose a server'],'mcp-stale':['所选服务已变化，请刷新后重新选择','Selected servers changed. Refresh and choose again'],
  'mcp-missing':['已失效的服务','Unavailable server'],
 };
 let locale=/^zh(?:[-_]|$)/i.test(navigator.language)?'zh-CN':'en';
 let snapshot=null,busy=false,serviceAvailable=false,lastPollError='',readGeneration=0,toastTimer=null,pollTimer=null,clockTimer=null,disposed=false,directoryDraft=false,displayedProfile='';
 const t=key=>copy[key]?.[locale==='zh-CN'?0:1]||key;
 const key=value=>(value?.application||'codex')+':'+(value?.provider||'official');
 const draft=()=>({application:$('application').value||'codex',provider:$('provider').value||'official'});
 const currentDraft=()=>key(draft())===key(snapshot);
 const formDrafts=new Map(),profileDrafts=new Map(),serverInputs=new Map();
 let formKey='',formProjectId='',formDirty=false,mcpCatalog=null,mcpLoading=false,catalogGeneration=0;
 const tools=value=>({shell:value?.shell===true,mcp:value?.mcp===true,mcpServerIds:Array.isArray(value?.mcpServerIds)?[...value.mcpServerIds]:[]});
 let selectedServers=[];
 const formScope=(selection,cwd)=>key(selection)+'\0'+String(cwd||'').toLowerCase();
 function rememberForm(dirty=false){if(!formKey)return;formDirty=formDirty||dirty;formDrafts.set(formKey,{cwd:$('directory').value,projectId:formProjectId,permission:$('settings').querySelector('input[name="permission"]:checked')?.value||'read-only',shell:$('allow-shell').checked===true,mcp:$('allow-mcp').checked===true,ids:[...selectedServers],catalog:mcpCatalog,directoryDraft,dirty:formDirty});profileDrafts.set(formKey.split('\0')[0],{scope:formKey,appId:$('app-id').value});while(formDrafts.size>192)formDrafts.delete(formDrafts.keys().next().value);}
 function profile(){const selected=(snapshot?.profiles||[]).find(value=>key(value)===key(draft()));if(selected)return selected;if(currentDraft())return snapshot;return{appId:'',hasSecret:false,configured:false,enabled:false,paired:false,connection:{state:'stopped'},project:{id:'',cwd:'',permission:'read-only'},projects:[],pendingReplies:0};}
 function fillDraft(){const value=profile(),remembered=profileDrafts.get(key(draft())),saved=remembered&&formDrafts.get(remembered.scope);$('app-id').value=remembered?.appId??value?.appId??'';$('app-secret').value='';fillProject(saved?{project:{id:saved.projectId,cwd:saved.cwd}}:value||{project:{}});displayedProfile=key(draft());if(value)renderProjects(value);}
 function applyLocale(next){
  if(next)locale=next==='zh-CN'?'zh-CN':'en';
  document.documentElement.lang=locale;document.title=locale==='zh-CN'?'Codex Pet · QQ 远程任务':'Codex Pet · QQ remote tasks';
  for(const node of document.querySelectorAll('[data-copy]'))node.textContent=t(node.dataset.copy);
  $('pair-code').setAttribute('aria-label',locale==='zh-CN'?'配对消息':'Pairing message');
  $('mcp-servers').setAttribute('aria-label',locale==='zh-CN'?'MCP 服务':'MCP servers');
 }
 function toast(message){
  clearTimeout(toastTimer);$('message').textContent=message;$('message').hidden=false;
  toastTimer=setTimeout(()=>{$('message').hidden=true;},6500);
 }
 function updatePairing(){
  const pairing=currentDraft()?snapshot?.pairing:null;
  const remaining=pairing?Math.max(0,Math.ceil((Date.parse(pairing.expiresAt)-Date.now())/1000)):0;
  $('pair-code-row').hidden=!currentDraft()||Boolean(snapshot?.paired)||!pairing;
  if(pairing){$('pair-code').value=(locale==='zh-CN'?'/配对 ':'/pair ')+pairing.code;$('expires').textContent=remaining?`${remaining} ${t('expires')}`:t('expired');}
  else{$('pair-code').value='';$('expires').textContent='';}
  $('copy-pair').disabled=busy||!serviceAvailable||!currentDraft()||!pairing||remaining<=0;
 }
 function controls(){
  for(const control of $('settings').querySelectorAll('input,button,select'))control.disabled=busy;
  if(busy)return;
  const taskBusy=[snapshot,...(snapshot?.profiles||[])].some(value=>['thinking','working','waiting','result','running','cancelling'].includes(value?.task?.state));
  const view=profile(),same=currentDraft(),official=draft().provider==='official';
  const appId=$('app-id').value.trim(),hasSecret=Boolean($('app-secret').value);
  $('application').disabled=taskBusy||!serviceAvailable;$('provider').disabled=taskBusy||!serviceAvailable;
  $('official-connection').hidden=!official;$('onebot-connection').hidden=official;$('selection-state').hidden=same&&!formDirty&&!directoryDraft;
  $('app-id').disabled=!official||taskBusy;$('app-id').required=official;$('app-secret').disabled=!official||taskBusy;
  const mcp=$('allow-mcp').checked===true,mcpValid=!mcp||!mcpLoading&&mcpCatalog?.state==='ready'&&Date.now()-mcpCatalog.loadedAt<5*60_000&&mcpCatalog.sourceId&&mcpCatalog.revision&&selectedServers.length&&selectedServers.length<=32&&selectedServers.every(id=>mcpCatalog.items.some(item=>item.id===id));
  $('save').disabled=taskBusy||!serviceAvailable||!$('directory').value||!mcpValid||official&&(!/^\d{3,32}$/.test(appId)||(!(view?.hasSecret||view?.configured)||appId!==view?.appId)&&!hasSecret);
  $('allow-shell').disabled=taskBusy||!serviceAvailable||!$('directory').value;$('allow-mcp').disabled=taskBusy||!serviceAvailable||!$('directory').value;
  $('mcp-panel').hidden=!mcp;$('refresh-mcp').disabled=taskBusy||!serviceAvailable||mcpLoading||!mcp;$('choose-mcp-source').disabled=$('refresh-mcp').disabled;
  for(const[id,input]of serverInputs)input.disabled=taskBusy||busy||!serviceAvailable||mcpLoading||selectedServers.length>=32&&!selectedServers.includes(id);
  $('project-select').disabled=taskBusy||!serviceAvailable||!same||!view?.projects?.length;
  $('choose-directory').disabled=taskBusy||!serviceAvailable;
  $('remove-project').disabled=taskBusy||!serviceAvailable||!same||!$('project-select').value;
  $('disable').disabled=!serviceAvailable||!same||!snapshot?.enabled;
  $('pair').disabled=!serviceAvailable||!same||!snapshot?.configured||snapshot.connection.state!=='connected'||snapshot.paired;
  $('unlink').disabled=!serviceAvailable||!same;$('unlink').hidden=!same||!snapshot?.paired;
  const napcat=snapshot?.napcat;$('prepare-napcat').disabled=!serviceAvailable||taskBusy||['preparing','starting','running'].includes(napcat?.state);$('login-napcat').disabled=!serviceAvailable||taskBusy||!['ready','starting','running'].includes(napcat?.state);
  updatePairing();
 }
 function renderProjects(next){
  const select=$('project-select');select.replaceChildren();
  const empty=document.createElement('option');empty.value='';empty.textContent=t(directoryDraft?'new-project':'choose-project');select.appendChild(empty);
  for(const project of next.projects||[]){const option=document.createElement('option');option.value=project.id;option.textContent=project.label||project.cwd;select.appendChild(option);}
  select.value=directoryDraft?'':formProjectId||next.project.id||'';
 }
 function fillProject(next,restore=true){
  catalogGeneration++;mcpLoading=false;const project=next.project||{},scope=formScope(draft(),project.cwd),saved=restore?formDrafts.get(scope):null,policy=tools(project.toolPolicy);
  formKey=scope;formProjectId=saved?.projectId??project.id??'';formDirty=saved?.dirty||false;directoryDraft=saved?.directoryDraft||false;$('directory').value=saved?.cwd??project.cwd??'';
  const selected=saved?.permission??project.maxPermission??project.permission;
  $('settings').querySelector(`input[name="permission"][value="${selected==='workspace-write'?'workspace-write':'read-only'}"]`).checked=true;
  $('allow-shell').checked=saved?saved.shell:policy.shell;$('allow-mcp').checked=saved?saved.mcp:policy.mcp;selectedServers=saved?[...saved.ids]:policy.mcpServerIds;mcpCatalog=saved?.catalog||null;renderMcp();
  if($('allow-mcp').checked&&!mcpCatalog)void loadMcp();
 }
 function updateMcpStatus(){
  $('mcp-source-name').textContent=mcpCatalog?.sourceName||'';
  const state=mcpCatalog?.state||'unknown',invalid=selectedServers.some(id=>!mcpCatalog?.items?.some(item=>item.id===id))||state==='ready'&&Date.now()-mcpCatalog.loadedAt>=5*60_000;
  $('mcp-status').textContent=mcpLoading?t('mcp-loading'):state!=='ready'?t(state==='not-installed'?'mcp-not-installed':'mcp-unknown'):invalid?t('mcp-stale'):!mcpCatalog.items.length?t('mcp-empty'):!selectedServers.length?t('mcp-selection'):'';
 }
 function renderMcp(){
  const group=$('mcp-servers');group.replaceChildren();serverInputs.clear();updateMcpStatus();
  const items=mcpCatalog?.items||[],missing=mcpCatalog?.state==='ready'?selectedServers.filter(id=>!items.some(item=>item.id===id)).map(id=>({id,label:t('mcp-missing')})):[];
  for(const item of [...items,...missing]){const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');label.className='mcp-server';input.type='checkbox';input.checked=selectedServers.includes(item.id);span.textContent=item.label||item.id;input.addEventListener?.('change',()=>{selectedServers=input.checked?[...new Set([...selectedServers,item.id])]:selectedServers.filter(id=>id!==item.id);rememberForm(true);updateMcpStatus();controls();});label.appendChild?.(input);label.appendChild?.(span);group.appendChild(label);serverInputs.set(item.id,input);}
 }
 async function loadMcp(choose=false){
  if(disposed||busy||mcpLoading||!$('allow-mcp').checked||!$('directory').value)return;
  const scope=formKey,generation=++catalogGeneration,selection={...draft(),cwd:$('directory').value},startedAt=Date.now();mcpLoading=true;renderMcp();controls();
  try{const result=await(choose?api.chooseMcpSource(selection):api.getMcpCatalog(selection));if(disposed||scope!==formKey||generation!==catalogGeneration)return;if(result?.cancelled)return;
   mcpCatalog=result?.ok?{...(result.snapshot?.mcpCatalog||{state:'unknown',items:[]}),loadedAt:startedAt}:{state:'unknown',items:[]};if(!result?.ok)toast(result?.message||t('mcp-unknown'));rememberForm();
  }catch{if(scope===formKey&&generation===catalogGeneration)mcpCatalog={state:'unknown',items:[]};}
  finally{if(!disposed&&scope===formKey&&generation===catalogGeneration){mcpLoading=false;renderMcp();controls();}}
 }
 function render(next,initialize=false){
  const previous=profile(),wasCurrent=currentDraft();snapshot=next;applyLocale(next.locale);
  if(initialize||wasCurrent&&displayedProfile&&displayedProfile!==key(next)){$('application').value=next.application||'codex';$('provider').value=next.provider||'official';}
  const view=profile();if(initialize||displayedProfile!==key(draft()))fillDraft();else if(previous?.project?.id!==view?.project?.id&&!directoryDraft&&!formDirty)fillProject(view);
  renderProjects(view);
  $('secret-note').textContent=t(view?.hasSecret||view?.configured?'secret-saved':'secret-new');
  const connectionState=view?.connection?.state||'stopped';$('connection').textContent=t(draft().provider==='onebot'&&connectionState==='error'?'account-error':connectionState);$('connection').dataset.state=connectionState;
  const state=view?.task?.state;$('task').textContent=state?t(state==='error'?'task-error':state):t('idle');
  $('pending-row').hidden=!view?.pendingReplies;$('pending').textContent=String(view?.pendingReplies||0);
  $('pair-status').textContent=t(currentDraft()&&next.paired?'paired':'not-paired');
  $('pair-note').textContent=t(!currentDraft()?'save-selection-first':next.configured?(draft().provider==='onebot'?'pair-note-account':'pair-note'):'save-first');
  const phase=String(next.napcat?.phase||'').replace(/ing$/,'').replace(/verif(?:y)?$/,'verify').replace(/configur$/,'configure').replace(/extract$/,'extract').replace(/download$/,'download');
  $('napcat-status').textContent=t(next.napcat?.loginError?'napcat-login-error':next.napcat?.state==='preparing'&&copy['napcat-'+phase]?'napcat-'+phase:'napcat-'+(next.napcat?.state||'not-installed'));
  updateMcpStatus();
  controls();
 }
 function pollFailed(result){
  serviceAvailable=false;applyLocale(result?.locale);
  $('connection').textContent=t('unavailable');
  $('connection').dataset.state='error';
  const selected=profile();$('secret-note').textContent=t(selected?.hasSecret||selected?.configured?'secret-saved':'secret-new');
  controls();
  const code=result?.code||'host_unavailable';
  // 后台轮询同类失败只提醒一次；恢复后再出现才开始新一轮提示。
  if(lastPollError!==code){lastPollError=code;toast(result?.message||t('unavailable'));}
 }
 async function refresh(){
  if(disposed||busy)return;const generation=++readGeneration;
  try{
   const result=await api.getState();if(disposed||generation!==readGeneration||busy)return;
   if(!result?.ok){pollFailed(result);return;}
   serviceAvailable=true;
   if(lastPollError){clearTimeout(toastTimer);$('message').hidden=true;lastPollError='';}
   render(result.snapshot,snapshot===null);
  }catch{if(!disposed&&generation===readGeneration)pollFailed();}
 }
 async function run(action,onSuccess){
  if(busy||disposed)return;busy=true;readGeneration++;controls();
  try{
   const result=await action();if(disposed)return;
   if(!result?.ok){applyLocale(result?.locale);toast(result?.message||t('unavailable'));return;}
   if(result.snapshot){serviceAvailable=true;render(result.snapshot);}
   if(!result.cancelled)onSuccess?.(result);
  }catch{if(!disposed)toast(t('unavailable'));}
  finally{busy=false;if(!disposed){controls();void refresh();if($('allow-mcp').checked&&!mcpCatalog)void loadMcp();}}
 }
 $('settings').addEventListener('submit',event=>{
  event.preventDefault();
  const selected=draft(),mcp=$('allow-mcp').checked===true,body={...selected,...(selected.provider==='official'?{appId:$('app-id').value.trim(),appSecret:$('app-secret').value}:{}),cwd:$('directory').value,permission:$('settings').querySelector('input[name="permission"]:checked').value,enabled:true,toolPolicy:{shell:$('allow-shell').checked===true,mcp,mcpServerIds:mcp?[...selectedServers]:[]},...(mcp?{mcpSourceId:mcpCatalog?.sourceId,mcpRevision:mcpCatalog?.revision}:{})};
  void run(async()=>{try{return await api.save(body);}finally{$('app-secret').value='';}},result=>{if(result.snapshot){formDrafts.delete(formKey);profileDrafts.delete(key(selected));fillProject(result.snapshot,false);renderProjects(result.snapshot);}toast(t('saved'));});
 });
 $('choose-directory').addEventListener('click',()=>{rememberForm();void run(()=>api.chooseDirectory(draft()),result=>{if(!result.cancelled){const known=profile()?.projects?.find(item=>item.cwd===result.directory);fillProject({project:known||{cwd:result.directory,permission:'read-only'}});directoryDraft=true;rememberForm(true);if(snapshot)renderProjects(profile());}});});
 $('project-select').addEventListener('change',()=>{const id=$('project-select').value;if(!id)return;rememberForm();void run(()=>api.selectProject(id),result=>{if(result.snapshot){fillProject(result.snapshot);renderProjects(result.snapshot);}});});
 $('remove-project').addEventListener('click',()=>{const id=$('project-select').value;if(id)void run(()=>api.removeProject(id),result=>{if(result.snapshot){fillProject(result.snapshot);renderProjects(result.snapshot);}});});
 $('platform').addEventListener('click',()=>{void run(()=>api.openPlatform());});
 for(const id of ['application','provider'])$(id).addEventListener('change',()=>{rememberForm();readGeneration++;fillDraft();if(snapshot)render(snapshot);else controls();});
 for(const id of ['allow-shell','allow-mcp'])$(id).addEventListener('change',()=>{rememberForm(true);renderMcp();controls();if(id==='allow-mcp'&&$('allow-mcp').checked&&!mcpCatalog)void loadMcp();});
 $('refresh-mcp').addEventListener('click',()=>{void loadMcp();});$('choose-mcp-source').addEventListener('click',()=>{void loadMcp(true);});
 for(const value of ['read-only','workspace-write'])$('settings').querySelector(`input[name="permission"][value="${value}"]`).addEventListener?.('change',()=>{rememberForm(true);controls();});
 $('prepare-napcat').addEventListener('click',()=>{void run(()=>api.prepareNapCat());});
 $('login-napcat').addEventListener('click',()=>{void run(()=>api.openNapCatLogin());});
 $('disable').addEventListener('click',()=>{void run(()=>api.disable());});
 $('pair').addEventListener('click',()=>{void run(()=>api.pair());});
 $('unlink').addEventListener('click',()=>{void run(()=>api.unpair());});
 $('copy-pair').addEventListener('click',()=>{void run(()=>api.copyPairing(),()=>toast(t('copied')));});
 $('refresh').addEventListener('click',()=>{void refresh();});
 $('app-id').addEventListener('input',()=>{rememberForm(true);controls();});$('app-secret').addEventListener('input',controls);
 $('pair-code').addEventListener('click',()=>$('pair-code').select());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
 window.addEventListener('beforeunload',()=>{disposed=true;readGeneration++;catalogGeneration++;formDrafts.clear();profileDrafts.clear();serverInputs.clear();clearTimeout(toastTimer);clearInterval(pollTimer);clearInterval(clockTimer);$('app-secret').value='';});
 applyLocale();controls();void refresh();
 pollTimer=setInterval(()=>{if(!document.hidden)void refresh();},2500);
 clockTimer=setInterval(()=>{if(!document.hidden){updatePairing();if($('allow-mcp').checked){updateMcpStatus();controls();}}},1000);
})();
