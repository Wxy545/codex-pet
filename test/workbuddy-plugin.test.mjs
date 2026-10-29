import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, writeFile, rm, cp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
let Report={};try{Report=await import('../workbuddy/plugin/hooks/report.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'codex-workbuddy-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const plugin=join(dir,'plugin'),app=join(dir,'app');await mkdir(plugin);await mkdir(join(app,'data/dsh-pet'),{recursive:true});return{dir,plugin,app};}
test('真实本机HTTP仅收到白名单元数据和本机能力token，Hook不输出正文',async t=>{
  assert.equal(typeof Report.reportHook,'function','WorkBuddy Hook报告器尚未实现');const f=await fixture(t),received=[];
  const server=createServer(async(req,res)=>{let b='';for await(const part of req)b+=part;received.push({url:req.url,token:req.headers['x-dsh-pet-token'],data:JSON.parse(b)});res.end('{"ok":true}');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  await writeFile(join(f.plugin,'connection.json'),JSON.stringify({schemaVersion:1,appRoot:f.app,nodePath:process.execPath}));
  await writeFile(join(f.app,'data/dsh-pet/standalone-runtime.json'),JSON.stringify({port:server.address().port,token:'a'.repeat(43)}));
  assert.equal(await Report.reportHook({pluginRoot:f.plugin,input:{hook_event_name:'UserPromptSubmit',session_id:'synthetic-session',prompt:'PRIVATE'},env:{CODEBUDDY_SESSION_ID:'synthetic-session',CODEBUDDY_CONVERSATION_REQUEST_ID:'synthetic-request'}}),true);
  assert.equal(received[0].url,'/dsh-pet-7340/workbuddy-events');assert.equal(received[0].token,'a'.repeat(43));assert.doesNotMatch(JSON.stringify(received[0].data),/PRIVATE|token|appRoot/);
});
test('离线、非法runtime、过大或坏stdin均静默退出0，不产生审批输出或上下文',async t=>{
  assert.equal(typeof Report.reportHook,'function');const f=await fixture(t);await cp(join(root,'workbuddy/plugin'),f.plugin,{recursive:true});
  for(const input of ['{bad',JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:'synthetic-session',prompt:'PRIVATE'}),'x'.repeat(1024*1024+1)]){
    const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(f.plugin,'hooks/report.mjs')],{windowsHide:true,env:{...process.env,CODEBUDDY_SESSION_ID:'synthetic-session',CODEBUDDY_CONVERSATION_REQUEST_ID:'synthetic-request'}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.stdin.on('error',()=>{});child.on('close',code=>resolve({code,out,err}));child.stdin.end(input);});
    assert.deepEqual(result,{code:0,out:'',err:''});
  }
});
test('Windows原生PowerShell执行安装后的Hook，完整保留request元数据但不泄露中文正文', {skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);await cp(join(root,'workbuddy/plugin'),f.plugin,{recursive:true});let received;
 const server=createServer(async(req,res)=>{let text='';for await(const p of req)text+=p;received=JSON.parse(text);res.end('{}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 await writeFile(join(f.plugin,'connection.json'),JSON.stringify({schemaVersion:1,appRoot:f.app,nodePath:process.execPath}));
 await writeFile(join(f.app,'data/dsh-pet/standalone-runtime.json'),JSON.stringify({port:server.address().port,token:'b'.repeat(43)}));
 const result=await new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',join(f.plugin,'hooks/report.ps1')],{windowsHide:true,env:{...process.env,CODEBUDDY_SESSION_ID:'synthetic-session',CODEBUDDY_CONVERSATION_REQUEST_ID:'synthetic-request'}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>resolve({code,out,err}));child.stdin.end(JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:'synthetic-session',prompt:'这是不可传输的正文'}));});
 assert.deepEqual(result,{code:0,out:'',err:''});assert.equal(received.requestId,'synthetic-request');assert.doesNotMatch(JSON.stringify(received),/正文|prompt/);
});
