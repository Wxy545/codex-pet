import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer as createPipeServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {normalizeHookInput} from '../workbuddy/plugin/hook-event.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('真实WorkBuddy独立宿主不要求Codex且保留旧AI设置，事件/鉴权/忙碌切换走实际HTTP', {timeout:25000}, async()=>{
 const root=await mkdtemp(join(tmpdir(),'codex-pet-workbuddy-app-'));
 const nativeHome=await mkdtemp(join(tmpdir(),'codex-pet-native-harness-'));
 let child,runtime,pipeServer,connections=0;const sockets=new Set();
 try{
  await cp(join(project,'src'),join(root,'src'),{recursive:true});
  // HTTP/Hook验收使用合成的存活宿主，不能被测试机真实WorkBuddy是否运行及探测返回时序左右。
  // 只替换本fixture副本；正式进程身份探测由workbuddy-target.test.cjs单独验证。
  await writeFile(join(root,'src/workbuddy-target.ps1'),"param([string]$Action)\nif ($Action -ne 'Alive') { throw 'unexpected-fixture-action' }\n[Console]::WriteLine('{\"ok\":true,\"running\":true}')\n");
  await mkdir(join(root,'workbuddy/plugin'),{recursive:true});
  await cp(join(project,'workbuddy/plugin/hook-event.mjs'),join(root,'workbuddy/plugin/hook-event.mjs'));
  await symlink(join(project,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  await mkdir(join(root,'data/dsh-pet'),{recursive:true});
  await writeFile(join(root,'data/host.json'),JSON.stringify({schemaVersion:1,host:'workbuddy'}));
  await writeFile(join(root,'data/dsh-pet/main-config.jsonc'),JSON.stringify({pets:[{id:'main',name:'Test companion',display:'web',size:160,balanceEnabled:true,whisperEnabled:true,workStatusEnabled:true}]}));
  const privateAi='INTENTIONALLY_INVALID_SYNTHETIC_AI_SETTINGS';
  await writeFile(join(root,'data/dsh-pet/standalone-ai.json'),privateAi);
  const pipe='\\\\.\\pipe\\wbipc-'+randomBytes(8).toString('hex');
  await mkdir(join(root,'synthetic-workbuddy-home','wbipc'),{recursive:true});
  await writeFile(join(root,'synthetic-workbuddy-home','wbipc','endpoint.json'),JSON.stringify({endpoint:pipe,ticket:randomBytes(32).toString('base64url')}));
  pipeServer=createPipeServer(socket=>{connections++;sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));socket.destroy();});
  await new Promise((resolve,reject)=>{pipeServer.once('error',reject);pipeServer.listen(pipe,resolve);});
  child=spawn(process.execPath,[join(root,'src/app.mjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CODEX_PET_PORT:'0',CODEX_PET_CLI:join(root,'not-installed-codex.exe'),CODEX_PET_HOST:'codex',WORKBUDDY_CONFIG_DIR:join(root,'synthetic-workbuddy-home')}});
  let output='';child.stdout.on('data',bytes=>{output+=bytes;});child.stderr.on('data',bytes=>{output+=bytes;});
  for(let i=0;i<120;i++){
   if(child.exitCode!==null)throw Error('workbuddy-host-start-failed: '+output.slice(-1200));
   try{runtime=JSON.parse(await readFile(join(root,'data/dsh-pet/standalone-runtime.json'),'utf8'));const h=await fetch(`http://127.0.0.1:${runtime.port}/health`);if(h.ok&&(await h.json()).pid===child.pid)break;runtime=null;}catch{runtime=null;}
   await delay(70);
  }
  assert.ok(runtime,'isolated host did not become ready');
  const base=`http://127.0.0.1:${runtime.port}`;
  const request=(path,{method='GET',body,headers={}}={})=>fetch(base+path,{method,headers:{'x-dsh-pet-token':runtime.token,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(3000)});
  const health=await (await request('/health')).json();assert.equal(health.host,'workbuddy');
  const capability=await (await request('/dsh-pet-7340/pet-host')).json();assert.equal(capability.capabilities.chat,false);assert.equal(capability.capabilities.quota,true);
  assert.equal((await request('/dsh-pet-7340/balance',{method:'POST'})).status,200);
  const balance=(await (await request('/dsh-pet-7340/state')).json()).sections.balance.data;assert.equal(balance.ok,false);assert.equal(balance.provider,'workbuddy');assert.equal(balance.reason,'fetch-error');
  const ai=await (await request('/standalone-ai/settings')).json();assert.equal(ai.enabled,false);assert.equal(ai.hasKey,false);
  assert.equal((await request('/dsh-pet-7340/codex-chat',{method:'POST',body:{messages:[]}})).status,409);
  assert.equal((await request('/dsh-pet-7340/codex-tasks')).status,409);
  const env={CODEBUDDY_SESSION_ID:'synthetic-session',CODEBUDDY_CONVERSATION_REQUEST_ID:'synthetic-request'};
  const event=name=>normalizeHookInput({hook_event_name:name,session_id:'synthetic-session',tool_use_id:'synthetic-tool',tool_name:'Read',final_stop_reason:'completed'},{env});
  const start=event('UserPromptSubmit');
  const unauthorized=await fetch(base+'/dsh-pet-7340/workbuddy-events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(start)});assert.ok([401,403].includes(unauthorized.status));
  assert.equal((await request('/dsh-pet-7340/workbuddy-events',{method:'POST',body:start,headers:{origin:'https://example.com'}})).status,403);
  assert.equal((await request('/dsh-pet-7340/workbuddy-events',{method:'POST',body:start})).status,202);
  let state=await (await request('/dsh-pet-7340/codex-status')).json();assert.equal(state.state,'thinking');assert.equal(state.activeCount,1);
  assert.equal((await request('/dsh-pet-7340/workbuddy-events',{method:'POST',body:event('PreToolUse')})).status,202);
  state=await (await request('/dsh-pet-7340/codex-status')).json();assert.equal(state.state,'working');
  const busy=await request('/dsh-pet-7340/pet-host',{method:'POST',body:{host:'codex'}});assert.equal(busy.status,409);assert.equal((await busy.json()).error,'host_busy');
  await request('/dsh-pet-7340/workbuddy-events',{method:'POST',body:event('Stop')});
  assert.equal((await (await request('/dsh-pet-7340/codex-status')).json()).state,'result');
  await request('/dsh-pet-7340/workbuddy-events',{method:'POST',body:event('FinalStop')});
  state=await (await request('/dsh-pet-7340/codex-status')).json();assert.equal(state.state,'success');assert.equal(state.activeCount,0);
  const notices=await (await request('/dsh-pet-7340/codex-notices')).json();assert.equal(notices.notices.length,1);assert.equal(notices.notices[0].source,'workbuddy');assert.equal(notices.notices[0].threadId,null);
  // 在隔离profile中模拟已核实的原生移交；不启动Harness或读取真实账户。
  const nativeCommand=join(nativeHome,'dsh.cmd'),profile=join(nativeHome,'profiles','web');
  await writeFile(nativeCommand,'synthetic command - never executed');
  await mkdir(join(profile,'node_modules','codex-pet-harness'),{recursive:true});
  await writeFile(join(profile,'package.json'),JSON.stringify({dependencies:{'dsh-pet':'0.3.8','codex-pet-harness':'link:synthetic'},dsh:{profile:{bundles:['dsh-pet','codex-pet-harness']}}}));
  await writeFile(join(profile,'node_modules','codex-pet-harness','package.json'),JSON.stringify({name:'codex-pet-harness'}));
  const setNative=active=>writeFile(join(root,'data/harness-link.json'),JSON.stringify({schemaVersion:1,active,command:nativeCommand,home:nativeHome,profile:'web',version:'0.2.1-rc.5'}));
  const presentation=(mode,options={})=>request('/dsh-pet-7340/pet-host/presentation',{method:'POST',body:{mode},...options});
  assert.equal((await request('/dsh-pet-7340/pet-host/presentation')).status,405);
  assert.equal((await request('/dsh-pet-7340/pet-host/presentation',{method:'POST',body:{mode:'resume',path:'/other'}})).status,400);
  assert.equal((await presentation('resume',{headers:{'x-dsh-pet-token':'invalid'}})).status,403);
  env.CODEBUDDY_CONVERSATION_REQUEST_ID='synthetic-before-handoff';
  await request('/dsh-pet-7340/workbuddy-events',{method:'POST',body:event('UserPromptSubmit')});
  await request('/dsh-pet-7340/workbuddy-events',{method:'POST',body:event('FinalStop')});
  await setNative(true);
  assert.equal((await presentation('resume')).status,409);
  assert.equal((await presentation('pause')).status,200);
  const frozenWorkStatus=(await (await request('/dsh-pet-7340/state')).json()).sections.workStatus.data;
  assert.deepEqual(await (await request('/dsh-pet-7340/codex-notices')).json(),{notices:[]});
  const beforeNativeQuery=connections;
  assert.equal((await request('/dsh-pet-7340/balance',{method:'POST'})).status,200);
  const nativeBalance=(await (await request('/dsh-pet-7340/state')).json()).sections.balance.data;
  assert.equal(nativeBalance.ok,false);assert.equal(nativeBalance.provider,'workbuddy');assert.equal(nativeBalance.reason,'host-unavailable');assert.equal(connections,beforeNativeQuery);
  env.CODEBUDDY_CONVERSATION_REQUEST_ID='synthetic-during-handoff';
  await request('/dsh-pet-7340/workbuddy-events',{method:'POST',body:event('UserPromptSubmit')});
  assert.equal((await (await request('/dsh-pet-7340/codex-status')).json()).state,'thinking');
  assert.deepEqual((await (await request('/dsh-pet-7340/state')).json()).sections.workStatus.data,frozenWorkStatus);
  await request('/dsh-pet-7340/workbuddy-events',{method:'POST',body:event('PreToolUse')});
  assert.equal((await (await request('/dsh-pet-7340/codex-status')).json()).state,'working');
  assert.deepEqual((await (await request('/dsh-pet-7340/state')).json()).sections.workStatus.data,frozenWorkStatus);
  await request('/dsh-pet-7340/workbuddy-events',{method:'POST',body:event('FinalStop')});
  const finished=(await (await request('/dsh-pet-7340/codex-status')).json());assert.equal(finished.state,'success');assert.equal(finished.activeCount,0);
  // 暂停保留移交前的外观；前一回合本来就可能已完成，不能把success本身当成越界推送。
  assert.deepEqual((await (await request('/dsh-pet-7340/state')).json()).sections.workStatus.data,frozenWorkStatus);
  await setNative(false);
  assert.equal((await presentation('pause')).status,409);
  assert.equal((await presentation('resume')).status,200);
  assert.equal((await (await request('/dsh-pet-7340/state')).json()).sections.workStatus.data.state,finished.state);
  assert.deepEqual(await (await request('/dsh-pet-7340/codex-notices')).json(),{notices:[]});
  if(process.platform==='win32')assert.ok(connections>beforeNativeQuery,'restoring WorkBuddy must refresh its own quota provider');
  const missing=await request('/dsh-pet-7340/pet-host',{method:'POST',body:{host:'codex'}});assert.equal(missing.status,409);assert.equal((await missing.json()).error,'codex_missing');
  assert.equal(JSON.parse(await readFile(join(root,'data/host.json'),'utf8')).host,'workbuddy');
  assert.equal(await readFile(join(root,'data/dsh-pet/standalone-ai.json'),'utf8'),privateAi);
  await request('/shutdown',{method:'POST'});await once(child,'exit');assert.equal(child.exitCode,0);
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),delay(3000)]);}
  for(const socket of sockets)socket.destroy();
  if(pipeServer)await new Promise(resolve=>pipeServer.close(resolve));
  await rm(nativeHome,{recursive:true,force:true});
  await rm(root,{recursive:true,force:true});
 }
});
