import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {installControlResume} from '../src/control-resume.mjs';

function fixture() {
 let clock=1000,status=200,exception=false,body='',delegated=null;
 const upstream={kind:'prefix',path:'/dsh-pet-7340',handler:async(req,res)=>{delegated=req;for await(const chunk of req)body+=chunk;if(exception)throw new Error('synthetic');res.statusCode=status;res.end('{}');}};
 const routes=[{kind:'exact',path:'/unrelated',handler(){}},upstream],installed=installControlResume({routes,now:()=>clock});
 async function invoke(url,method='POST',headers={},content=''){
  const req=Readable.from(content?[content]:[]);Object.assign(req,{url,method,headers});
  const res=new EventEmitter();Object.assign(res,{statusCode:200,writableEnded:false,headersSent:false});
  res.writeHead=(code,headers)=>{res.statusCode=code;res.headers=headers;res.headersSent=true;return res;};res.end=text=>{res.text=text;res.writableEnded=true;res.emit('finish');};
  const route=routes.find(r=>r.kind==='exact'?r.path===url:r.kind==='prefix'&&(url===r.path||url.startsWith(r.path+'/')));assert.ok(route);
  await route.handler(req,res);return{req,res,json:res.text?JSON.parse(res.text):undefined};
 }
 return{routes,upstream,installed,invoke,clock:value=>{clock=value;},status:value=>{status=value;},exception:value=>{exception=value;},observed:()=>({body,delegated})};
}
test('控制保存只委托原上游读取一次正文，成功恢复标记单次消费',async t=>{
 const f=fixture();t.after(()=>f.installed.dispose());
 const saved=await f.invoke('/dsh-pet-7340/config','PUT',{'x-codex-pet-control':'1'},'{"pets":[]}');assert.equal(saved.res.statusCode,200);assert.equal(f.observed().body,'{"pets":[]}');assert.equal(f.observed().delegated,saved.req);
 assert.deepEqual((await f.invoke('/dsh-pet-7340/control-resume')).json,{resumeSettings:true});assert.deepEqual((await f.invoke('/dsh-pet-7340/control-resume')).json,{resumeSettings:false});
});
test('重载可恢复但15秒到期，普通操作、错误方法与带Origin操作不设置标记',async t=>{
 const f=fixture();t.after(()=>f.installed.dispose());
 for(const[url,method,headers]of [['/dsh-pet-7340/config','PUT',{}],['/dsh-pet-7340/config','GET',{'x-codex-pet-control':'1'}],['/dsh-pet-7340/reload','GET',{'x-codex-pet-control':'1'}],['/dsh-pet-7340/reload','POST',{'x-codex-pet-control':'1',origin:'http://127.0.0.1:3080'}]]){await f.invoke(url,method,headers);assert.equal((await f.invoke('/dsh-pet-7340/control-resume')).json.resumeSettings,false);}
 await f.invoke('/dsh-pet-7340/reload','POST',{'x-codex-pet-control':'1'});f.clock(16000);assert.equal((await f.invoke('/dsh-pet-7340/control-resume')).json.resumeSettings,false);
 await f.invoke('/dsh-pet-7340/reload','POST',{'x-codex-pet-control':'1'});f.clock(30999);assert.equal((await f.invoke('/dsh-pet-7340/control-resume')).json.resumeSettings,true);
});
test('400+完成与handler异常撤销本轮标记，不自动重试保存',async t=>{
 const f=fixture();t.after(()=>f.installed.dispose());
 for(const status of [400,409,500]){f.status(status);await f.invoke('/dsh-pet-7340/config','PUT',{'x-codex-pet-control':'1'});assert.equal((await f.invoke('/dsh-pet-7340/control-resume')).json.resumeSettings,false);}
 f.exception(true);await assert.rejects(f.invoke('/dsh-pet-7340/reload','POST',{'x-codex-pet-control':'1'}),/synthetic/);assert.equal((await f.invoke('/dsh-pet-7340/control-resume')).json.resumeSettings,false);
});
test('消费仅限无Origin的POST，拒绝的消费不会取走有效标记，dispose还原路由',async()=>{
 const f=fixture();await f.invoke('/dsh-pet-7340/reload','POST',{'x-codex-pet-control':'1'});
 assert.equal((await f.invoke('/dsh-pet-7340/control-resume','POST',{origin:'null'})).res.statusCode,403);assert.equal((await f.invoke('/dsh-pet-7340/control-resume','GET')).res.statusCode,405);assert.equal((await f.invoke('/dsh-pet-7340/control-resume')).json.resumeSettings,true);
 f.installed.dispose();f.installed.dispose();assert.equal(f.routes.length,2);assert.equal(f.routes[1],f.upstream);
});
test('重建Helper关闭旧HTTP连接仍可恢复，旧请求随后失败不能清掉新标记',async t=>{
 let rejectOld;
 const routes=[{kind:'prefix',path:'/dsh-pet-7340',handler:(req,res)=>{
  if(req.url.endsWith('/config'))return new Promise((_resolve,reject)=>{rejectOld=reject;});
  res.end('{}');
 }}];
 const installed=installControlResume({routes,now:()=>1000});t.after(()=>installed.dispose());
 const response=()=>{const res=new EventEmitter();res.statusCode=200;res.writableEnded=false;res.writeHead=code=>{res.statusCode=code;};res.end=text=>{res.text=text;res.writableEnded=true;res.emit('finish');};return res;};
 const invoke=(url,headers={},res=response(),method='POST')=>{const route=routes.find(r=>r.kind==='exact'&&r.path===url);return{res,result:route.handler({url,method,headers},res)};};
 const closed=response(),old=invoke('/dsh-pet-7340/config',{'x-codex-pet-control':'1'},closed,'PUT');const rejected=assert.rejects(old.result,/late failure/);
 closed.emit('close');assert.equal(closed.writableEnded,false);assert.equal(JSON.parse(invoke('/dsh-pet-7340/control-resume').res.text).resumeSettings,true);
 await invoke('/dsh-pet-7340/reload',{'x-codex-pet-control':'1'}).result;rejectOld(new Error('late failure'));await rejected;
 assert.equal(JSON.parse(invoke('/dsh-pet-7340/control-resume').res.text).resumeSettings,true);assert.equal(JSON.parse(invoke('/dsh-pet-7340/control-resume').res.text).resumeSettings,false);
});
test('找不到唯一真实prefix时停止，不变更路由表',()=>{
 const empty=[];assert.throws(()=>installControlResume({routes:empty}),/upstream/);assert.deepEqual(empty,[]);
 const routes=[{kind:'prefix',path:'/dsh-pet-7340',handler(){}},{kind:'prefix',path:'/dsh-pet-7340',handler(){}}];assert.throws(()=>installControlResume({routes}),/upstream/);assert.equal(routes.length,2);
});
