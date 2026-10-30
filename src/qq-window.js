(function(){
 'use strict';
 const api=window.qqRemote,$=id=>document.getElementById(id);
 const copy={
  bot:['机器人','Bot'],
  'create-note':['在 QQ 开放平台创建机器人，复制 AppID 和 AppSecret。','Create a bot on the QQ Open Platform, then copy its AppID and AppSecret.'],
  platform:['创建 QQ 机器人','Create QQ bot'],
  'secret-new':['填写 QQ 开放平台提供的 AppSecret。','Enter the AppSecret from QQ Open Platform.'],
  'secret-saved':['已保存；留空可保留原密钥。','Saved. Leave blank to keep it.'],
  project:['任务范围','Task access'],folder:['项目文件夹','Project folder'],
  'choose-folder':['选择文件夹','Choose folder'],'read-only':['只读查看','Read only'],'workspace-write':['允许修改这个文件夹','Allow edits in this folder'],
  save:['保存并连接','Save and connect'],disable:['停用连接','Disconnect'],refresh:['刷新','Refresh'],
  connection:['连接状态','Connection'],task:['任务状态','Task'],pending:['等待送达的回复','Replies awaiting delivery'],
  pairing:['本人绑定','Your QQ account'],
  'pair-note':['生成配对码后，用本人 QQ 私聊机器人，发送下面的配对消息。','Generate a code, then send the pairing message to your bot in a private QQ chat.'],
  'copy-pair':['复制配对消息','Copy message'],generate:['生成配对码','Generate pairing code'],unlink:['解绑','Unpair'],
  paired:['已绑定本人 QQ','Your QQ account is paired'],'not-paired':['尚未绑定','Not paired'],
  'save-first':['先保存设置并连接机器人。','Save your settings and connect the bot first.'],
  expired:['配对码已过期，请重新生成。','This code expired. Generate a new one.'],
  expires:['秒后过期','seconds remaining'],copied:['配对消息已复制。','Pairing message copied.'],saved:['设置已保存。','Settings saved.'],
  unavailable:['暂时无法连接桌宠，请重试。','The pet is unavailable. Try again.'],
  'stopped':['未连接','Disconnected'],connecting:['正在连接','Connecting…'],connected:['已连接','Connected'],
  disconnected:['连接已断开','Connection lost'],reconnecting:['正在重新连接','Reconnecting…'],error:['连接失败，请检查机器人信息后重试。','Connection failed. Check your bot details and try again.'],
  idle:['空闲','Idle'],thinking:['正在思考','Thinking'],working:['正在执行','Working'],waiting:['等待 QQ 确认或回答','Waiting for your reply in QQ'],
  result:['正在整理结果','Preparing the result'],success:['已完成','Completed'],running:['正在执行','Working'],cancelling:['正在取消','Cancelling…'],
  completed:['已完成','Completed'],cancelled:['已取消','Cancelled'],failed:['执行失败','Failed'],interrupted:['已中断','Interrupted'],
  'task-error':['执行失败','Failed'],
 };
 let locale=/^zh(?:[-_]|$)/i.test(navigator.language)?'zh-CN':'en';
 let snapshot=null,busy=false,serviceAvailable=false,lastPollError='',readGeneration=0,toastTimer=null,pollTimer=null,clockTimer=null,disposed=false;
 const t=key=>copy[key]?.[locale==='zh-CN'?0:1]||key;
 function applyLocale(next){
  if(next)locale=next==='zh-CN'?'zh-CN':'en';
  document.documentElement.lang=locale;document.title=locale==='zh-CN'?'Codex Pet · QQ 远程任务':'Codex Pet · QQ remote tasks';
  for(const node of document.querySelectorAll('[data-copy]'))node.textContent=t(node.dataset.copy);
  $('pair-code').setAttribute('aria-label',locale==='zh-CN'?'配对消息':'Pairing message');
 }
 function toast(message){
  clearTimeout(toastTimer);$('message').textContent=message;$('message').hidden=false;
  toastTimer=setTimeout(()=>{$('message').hidden=true;},6500);
 }
 function updatePairing(){
  const pairing=snapshot?.pairing;
  const remaining=pairing?Math.max(0,Math.ceil((Date.parse(pairing.expiresAt)-Date.now())/1000)):0;
  $('pair-code-row').hidden=Boolean(snapshot?.paired)||!pairing;
  if(pairing){$('pair-code').value=(locale==='zh-CN'?'/配对 ':'/pair ')+pairing.code;$('expires').textContent=remaining?`${remaining} ${t('expires')}`:t('expired');}
  $('copy-pair').disabled=busy||!serviceAvailable||!pairing||remaining<=0;
 }
 function controls(){
  for(const control of $('settings').querySelectorAll('input,button'))control.disabled=busy;
  if(busy)return;
  const appId=$('app-id').value.trim(),hasSecret=Boolean($('app-secret').value);
  $('save').disabled=!serviceAvailable||!/^\d{3,32}$/.test(appId)||!$('directory').value||(!snapshot?.configured&&!hasSecret);
  $('disable').disabled=!serviceAvailable||!snapshot?.enabled;
  $('pair').disabled=!serviceAvailable||!snapshot?.configured||snapshot.connection.state!=='connected'||snapshot.paired;
  $('unlink').disabled=!serviceAvailable;
  $('unlink').hidden=!snapshot?.paired;
  updatePairing();
 }
 function render(next,initialize=false){
  snapshot=next;applyLocale(next.locale);
  if(initialize){$('app-id').value=next.appId||'';$('directory').value=next.project.cwd||'';const permission=$('settings').querySelector(`input[name="permission"][value="${next.project.permission==='workspace-write'?'workspace-write':'read-only'}"]`);permission.checked=true;}
  $('secret-note').textContent=t(next.configured?'secret-saved':'secret-new');
  $('connection').textContent=t(next.connection.state);
  $('connection').dataset.state=next.connection.state;
  const state=next.task?.state;$('task').textContent=state?t(state==='error'?'task-error':state):t('idle');
  $('pending-row').hidden=next.pendingReplies===0;$('pending').textContent=String(next.pendingReplies);
  $('pair-status').textContent=t(next.paired?'paired':'not-paired');
  $('pair-note').textContent=t(next.configured?'pair-note':'save-first');
  controls();
 }
 function pollFailed(result){
  serviceAvailable=false;applyLocale(result?.locale);
  $('connection').textContent=t('unavailable');
  $('connection').dataset.state='error';
  $('secret-note').textContent=t(snapshot?.configured?'secret-saved':'secret-new');
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
  finally{busy=false;if(!disposed){controls();void refresh();}}
 }
 $('settings').addEventListener('submit',event=>{
  event.preventDefault();
  const body={appId:$('app-id').value.trim(),appSecret:$('app-secret').value,cwd:$('directory').value,permission:$('settings').querySelector('input[name="permission"]:checked').value,enabled:true};
  void run(async()=>{try{return await api.save(body);}finally{$('app-secret').value='';}},()=>toast(t('saved')));
 });
 $('choose-directory').addEventListener('click',()=>{void run(()=>api.chooseDirectory(),result=>{if(!result.cancelled)$('directory').value=result.directory||'';});});
 $('platform').addEventListener('click',()=>{void run(()=>api.openPlatform());});
 $('disable').addEventListener('click',()=>{void run(()=>api.disable());});
 $('pair').addEventListener('click',()=>{void run(()=>api.pair());});
 $('unlink').addEventListener('click',()=>{void run(()=>api.unpair());});
 $('copy-pair').addEventListener('click',()=>{void run(()=>api.copyPairing(),()=>toast(t('copied')));});
 $('refresh').addEventListener('click',()=>{void refresh();});
 $('app-id').addEventListener('input',controls);$('app-secret').addEventListener('input',controls);
 $('pair-code').addEventListener('click',()=>$('pair-code').select());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
 window.addEventListener('beforeunload',()=>{disposed=true;readGeneration++;clearTimeout(toastTimer);clearInterval(pollTimer);clearInterval(clockTimer);$('app-secret').value='';});
 applyLocale();controls();void refresh();
 pollTimer=setInterval(()=>{if(!document.hidden)void refresh();},2500);
 clockTimer=setInterval(()=>{if(!document.hidden)updatePairing();},1000);
})();
