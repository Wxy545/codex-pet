import test from 'node:test';
import assert from 'node:assert/strict';
import{createRequestSecurity,listenStandaloneServer}from'../node_modules/dsh-pet/lib/codex-host.js';
test('私有读取及其编码形式必须有本机能力令牌，公共动画配置保持可读',async t=>{
 const security=createRequestSecurity(),logger={debug(){},info(){},warn(){},error(){}},routes=[{kind:'prefix',path:'/dsh-pet-7340',handler:(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"source":"synthetic-private-view"}');}}];
 const server=await listenStandaloneServer({port:0,security,logger,routes});t.after(()=>server.close());
 const request=(path,authorized=false)=>fetch('http://127.0.0.1:'+server.port+'/dsh-pet-7340/'+path,{headers:{connection:'close',...(authorized?{'x-dsh-pet-token':security.token}:{})},signal:AbortSignal.timeout(3000)});
 for(const path of ['config/editable','config%2Feditable','%63onfig/editable','chat','%63hat','whisper','%77hisper','codex-tasks','%63odex-tasks','codex-status','codex-notices']){const denied=await request(path);assert.equal(denied.status,403,path);await denied.text();const accepted=await request(path,true);assert.equal(accepted.status,200,path);assert.equal((await accepted.json()).source,'synthetic-private-view');}
 const publicConfig=await request('config');assert.equal(publicConfig.status,200);await publicConfig.text();
});
