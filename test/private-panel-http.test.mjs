import test from 'node:test';
import assert from 'node:assert/strict';
import{resolve,join}from'node:path';import{pathToFileURL}from'node:url';import{readFile}from'node:fs/promises';
const packageRoot=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet'),version=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8')).version,modern=['0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7'].includes(version);
if(!['0.3.8','0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7'].includes(version))throw Error('unreviewed-upstream-version');
const {createRequestSecurity,listenStandaloneServer}=await import(pathToFileURL(join(packageRoot,'lib/codex-host.js')).href);
test('私有读取及其编码形式必须有本机能力令牌，公共动画配置保持可读',async t=>{
 const security=createRequestSecurity(),logger={debug(){},info(){},warn(){},error(){}},routes=[{kind:'prefix',path:'/dsh-pet-7340',handler:(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"source":"synthetic-private-view"}');}}];
 const server=await listenStandaloneServer({port:0,security,logger,routes});t.after(()=>server.close());
 const request=(path,authorized=false,method='GET')=>fetch('http://127.0.0.1:'+server.port+'/dsh-pet-7340/'+path,{method,headers:{connection:'close',...(authorized?{'x-dsh-pet-token':security.token}:{})},signal:AbortSignal.timeout(3000)});
 for(const path of ['config/editable','config%2Feditable','%63onfig/editable','chat','%63hat','whisper','%77hisper','codex-tasks','%63odex-tasks','codex-status','codex-notices']){const denied=await request(path);assert.equal(denied.status,403,path);await denied.text();const accepted=await request(path,true);assert.equal(accepted.status,200,path);assert.equal((await accepted.json()).source,'synthetic-private-view');}
 const publicConfig=await request('config');assert.equal(publicConfig.status,200);await publicConfig.text();
 if(['0.4.1','0.4.3','0.4.5','0.4.6','0.4.7'].includes(version))for(const path of ['state','%73tate','logo?root=synthetic-custom','%6cogo?root=synthetic-custom'])for(const method of ['GET','HEAD']){const denied=await request(path,false,method);assert.equal(denied.status,403,method+' '+path);await denied.text();const accepted=await request(path,true,method);assert.equal(accepted.status,200,method+' '+path);await accepted.text();}
 if(modern)for(const path of ['todos','%74odos','todos%2Fsynthetic-todo-id','%74odos/synthetic-todo-id'])for(const method of ['GET','HEAD']){const denied=await request(path,false,method);assert.equal(denied.status,403,method+' '+path);assert.doesNotMatch(await denied.text(),/synthetic-private-view/);const accepted=await request(path,true,method);assert.equal(accepted.status,200,method+' '+path);if(method==='HEAD')assert.equal(await accepted.text(),'');else assert.equal((await accepted.json()).source,'synthetic-private-view');}
});
