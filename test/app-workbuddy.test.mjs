import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {normalizeHookInput} from '../workbuddy/plugin/hook-event.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('真实WorkBuddy独立宿主不要求Codex且保留旧AI设置，事件/鉴权/忙碌切换走实际HTTP', {timeout:25000}, async()=>{
 const root=await mkdtemp(join(tmpdir(),'codex-pet-workbuddy-app-'));
 let child,runtime;
 try{
  await cp(join(project,'src'),join(root,'src'),{recursive:true});
  await mkdir(join(root,'workbuddy/plugin'),{recursive:true});
  await cp(join(project,'workbuddy/plugin/hook-event.mjs'),join(root,'workbuddy/plugin/hook-event.mjs'));
  await symlink(join(project,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  await mkdir(join(root,'data/dsh-pet'),{recursive:true});
  await writeFile(join(root,'data/host.json'),JSON.stringify({schemaVersion:1,host:'workbuddy'}));
  await writeFile(join(root,'data/dsh-pet/main-config.jsonc'),JSON.stringify({pets:[{id:'main',name:'Test companion',display:'web',size:160,balanceEnabled:true,whisperEnabled:true,workStatusEnabled:true}]}));
  const privateAi='INTENTIONALLY_INVALID_SYNTHETIC_AI_SETTINGS';
  await writeFile(join(root,'data/dsh-pet/standalone-ai.json'),privateAi);
  child=spawn(process.execPath,[join(root,'src/app.mjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CODEX_PET_PORT:'0',CODEX_PET_CLI:join(root,'not-installed-codex.exe'),CODEX_PET_HOST:'codex'}});
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
  const capability=await (await request('/dsh-pet-7340/pet-host')).json();assert.equal(capability.capabilities.chat,false);assert.equal(capability.capabilities.quota,false);
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
  const missing=await request('/dsh-pet-7340/pet-host',{method:'POST',body:{host:'codex'}});assert.equal(missing.status,409);assert.equal((await missing.json()).error,'codex_missing');
  assert.equal(JSON.parse(await readFile(join(root,'data/host.json'),'utf8')).host,'workbuddy');
  assert.equal(await readFile(join(root,'data/dsh-pet/standalone-ai.json'),'utf8'),privateAi);
  await request('/shutdown',{method:'POST'});await once(child,'exit');assert.equal(child.exitCode,0);
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),delay(3000)]);}
  await rm(root,{recursive:true,force:true});
 }
});
