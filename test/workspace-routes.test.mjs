import test from 'node:test';import assert from 'node:assert/strict';
const M=await import('../src/workspace-routes.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
function res(){return{statusCode:0,data:'',setHeader(){},end(s){this.data=s;this.writableEnded=true;}};}
function fixture(){assert.equal(typeof M.createWorkspaceRoutes,'function');let called=0;const workspace={tasks:{list:()=>({items:[{id:'metadata-id',model:null}]}),perform:async()=>{called++;return{ok:true};},attend:async()=>({items:[]})},memoryScopes:async()=>({scopes:[{scopeId:'safe-id',label:'本人的记忆'}]}),memoryAction:async body=>{if(body.scopeId!=='safe-id')throw Object.assign(Error('secret path'),{code:'memory_scope_unavailable'});return{items:[]};},memoryExport:async()=>({records:[]}),models:{snapshot:()=>({hosts:{}}),save:async()=>({})}};const routes=M.createWorkspaceRoutes({workspace,security:{token:'synthetic-token'},requestJson:async req=>req.body,getCatalog:async host=>({state:host==='codex'?'ready':'host-default',items:[]})});return{routes,get called(){return called;}};}
async function call(f,path,body,headers={'x-dsh-pet-token':'synthetic-token'},method='POST'){const r=res(),route=f.routes.find(x=>x.path==='/dsh-pet-7340'+path);assert.ok(route);await route.handler({method,headers,body},r);return{status:r.statusCode,body:JSON.parse(r.data)};}
test('所有新增私有读写入口在读取记忆或执行操作前鉴权，拒绝浏览器origin',async()=>{
 const f=fixture();for(const path of ['/pet-workspace/tasks','/pet-memory/scopes','/pet-memory','/pet-model-policy']){
  const a=await call(f,path,{}, {},path==='/pet-memory/scopes'?'GET':'POST');assert.equal(a.status,403);assert.doesNotMatch(JSON.stringify(a.body),/metadata-id|本人的记忆/);
  assert.equal((await call(f,path,{}, {'x-dsh-pet-token':'synthetic-token',origin:'http://evil.invalid'})).status,403);
 }assert.equal(f.called,0);
});
test('任务操作只接受不透明任务ID和固定动作，未知参数不能进入执行器',async()=>{
 const f=fixture();assert.equal((await call(f,'/pet-workspace/tasks',{action:'cancel',id:'metadata-id',url:'file:///secret'})).status,400);assert.equal(f.called,0);
 assert.equal((await call(f,'/pet-workspace/tasks',{action:'cancel',id:'metadata-id'})).body.ok,true);assert.equal(f.called,1);
});
test('错误只返回固定错误码，不带私有路径，模型目录按宿主分别返回',async()=>{
 const f=fixture();const r=await call(f,'/pet-memory',{action:'query',scopeId:'wrong'});assert.equal(r.body.error.code,'memory_scope_unavailable');assert.doesNotMatch(JSON.stringify(r),/secret path/);
 const native=await call(f,'/pet-model-policy',{action:'catalog',host:'workbuddy'});assert.equal(native.body.state,'host-default');
});
