import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url)),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('原生Harness移交在实际HTTP入口阻止新Codex任务，保留既有结果和取消，并复核在途请求', {timeout:25000}, async()=>{
 const temp=await mkdtemp(join(tmpdir(),'pet-harness-admission-')),root=join(temp,'pet'),home=join(root,'data'),nativeHome=join(temp,'native'),command=join(temp,'installed','dsh.cmd');
 let child,runtime;
 try{
  await cp(join(project,'src'),join(root,'src'),{recursive:true});await mkdir(join(root,'workbuddy','plugin'),{recursive:true});await cp(join(project,'workbuddy','plugin','hook-event.mjs'),join(root,'workbuddy','plugin','hook-event.mjs'));await symlink(join(project,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  await mkdir(join(home,'dsh-pet'),{recursive:true});await mkdir(join(temp,'installed'),{recursive:true});await writeFile(command,'synthetic installed command');
  await mkdir(join(nativeHome,'profiles','web','node_modules','codex-pet-harness'),{recursive:true});
  await writeFile(join(nativeHome,'profiles','web','package.json'),JSON.stringify({dependencies:{'dsh-pet':'0.3.8','codex-pet-harness':'link:synthetic'},dsh:{profile:{bundles:['dsh-pet','codex-pet-harness']}}}));
  await writeFile(join(nativeHome,'profiles','web','node_modules','codex-pet-harness','package.json'),'{"name":"codex-pet-harness"}');
  await writeFile(join(home,'host.json'),'{"schemaVersion":1,"host":"codex"}');
  await writeFile(join(home,'dsh-pet','main-config.jsonc'),JSON.stringify({pets:[{id:'main',name:'Synthetic companion',display:'web',size:160,balanceEnabled:false,whisperEnabled:false,workStatusEnabled:true}]}));
  const record={schemaVersion:1,active:false,command,home:nativeHome,profile:'web',version:'0.2.1-rc.5'},saveActive=active=>writeFile(join(home,'harness-link.json'),JSON.stringify({...record,active}));await saveActive(false);
  // CLI 指向 Node，账户目录完全隔离；测试正文均无效，不会启动真实模型或读取用户会话。
  child=spawn(process.execPath,[join(root,'src/app.mjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CODEX_PET_PORT:'0',CODEX_PET_CLI:process.execPath,CODEX_HOME:join(temp,'synthetic-codex-home')}});
  let output='';child.stdout.on('data',bytes=>{output+=bytes;});child.stderr.on('data',bytes=>{output+=bytes;});
  for(let i=0;i<120;i++){
   if(child.exitCode!==null)throw Error('isolated-host-start-failed: '+output.slice(-1000));
   try{runtime=JSON.parse(await readFile(join(home,'dsh-pet','standalone-runtime.json'),'utf8'));const response=await fetch(`http://127.0.0.1:${runtime.port}/health`);if(response.ok&&(await response.json()).pid===child.pid)break;runtime=null;}catch{runtime=null;}await delay(70);
  }
  assert.ok(runtime,'isolated host did not become ready');
  const base=`http://127.0.0.1:${runtime.port}`,headers={'x-dsh-pet-token':runtime.token,'content-type':'application/json'};
  const request=(path,{method='GET',body}={})=>fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(3000)});
  const ai=JSON.parse(await readFile(join(home,'dsh-pet','standalone-ai.json'),'utf8'));
  const internal=body=>fetch(ai.baseUrl+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+ai.apiKey,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
  assert.equal((await request('/dsh-pet-7340/codex-chat',{method:'POST',body:{messages:[]}})).status,400);assert.equal((await internal({messages:[]})).status,400);
  let responseStarted;
  const started=new Promise(resolve=>{responseStarted=resolve;});
  const partial=httpRequest(base+'/dsh-pet-7340/codex-chat',{method:'POST',headers});
  const completed=new Promise((resolve,reject)=>{partial.on('response',response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});partial.on('error',reject);});
  partial.write('{"messages":',responseStarted);await started;await delay(30);await saveActive(true);partial.end('[]}');assert.equal(await completed,409);
  for(const path of ['/dsh-pet-7340/codex-chat','/dsh-pet-7340/codex-tasks']){
   const response=await request(path,{method:'POST',body:{messages:[]}});assert.equal(response.status,409);assert.equal((await response.json()).error.code,'host_unavailable');
  }
  assert.equal((await internal({messages:[]})).status,409);const qq=await request('/dsh-pet-7340/qq-remote');assert.equal(qq.status,200);assert.equal((await qq.json()).application,'codex');
  assert.equal((await request('/dsh-pet-7340/codex-tasks')).status,200);
  const cancellation=await request('/dsh-pet-7340/codex-tasks/cancel',{method:'POST',body:{id:'synthetic-task'}});assert.equal(cancellation.status,409);assert.equal((await cancellation.json()).error.code,'stale_task');
  await saveActive(false);assert.equal((await request('/dsh-pet-7340/codex-chat',{method:'POST',body:{messages:[]}})).status,400);assert.equal((await internal({messages:[]})).status,400);
  await request('/shutdown',{method:'POST'});await once(child,'exit');assert.equal(child.exitCode,0);
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),delay(3000)]);}
  await rm(temp,{recursive:true,force:true});
 }
});
