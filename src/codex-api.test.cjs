'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHostRequest } = require('./codex-api.cjs');
const settings = { baseUrl: 'http://127.0.0.1:3080/', token: 'x'.repeat(43) };
test('面板请求固定到本机白名单接口，能力令牌只在主进程请求头', async () => {
  let received;
  const request = createHostRequest({ ...settings, fetchImpl: async (url, options) => { received={url,options}; return {status:202,text:async()=>'{"state":"running"}'}; } });
  assert.deepEqual(await request('POST','/dsh-pet-7340/codex-tasks','{}'), {status:202,body:'{"state":"running"}'});
  assert.equal(String(received.url),'http://127.0.0.1:3080/dsh-pet-7340/codex-tasks');
  assert.equal(received.options.headers['x-dsh-pet-token'], settings.token);
  assert.equal(received.options.redirect,'error');
  await request('GET','/dsh-pet-7340/codex-character');
  assert.equal(received.options.headers['x-dsh-pet-token'],settings.token);
  await request('GET','/dsh-pet-7340/config/editable');
  await assert.rejects(request('POST','/dsh-pet-7340/config/editable','{}'));
  await request('PUT','/dsh-pet-7340/config','{}');
  assert.equal(received.options.headers['x-codex-pet-control'],'1');
  await request('POST','/dsh-pet-7340/reload');
  assert.equal(received.options.headers['x-codex-pet-control'],'1');
  await request('POST','/dsh-pet-7340/control-resume');
  assert.equal(received.options.headers['x-codex-pet-control'],undefined);
  await assert.rejects(request('GET','/dsh-pet-7340/control-resume'));
  await request('POST','/dsh-pet-7340/pet-host/presentation','{"mode":"resume"}');
  assert.equal(String(received.url),'http://127.0.0.1:3080/dsh-pet-7340/pet-host/presentation');
  assert.equal(received.options.headers['x-dsh-pet-token'],settings.token);
  for(const method of ['GET','PUT','DELETE'])await assert.rejects(request(method,'/dsh-pet-7340/pet-host/presentation'));
  await request('GET','/dsh-pet-7340/qq-remote');
  await request('POST','/dsh-pet-7340/qq-remote','{"action":"pair"}');
  assert.equal(String(received.url),'http://127.0.0.1:3080/dsh-pet-7340/qq-remote');
  assert.equal(received.options.headers['x-dsh-pet-token'],settings.token);
  await assert.rejects(request('PUT','/dsh-pet-7340/qq-remote'));
  await request('POST','/dsh-pet-7340/codex-startup/pending');
  assert.equal(String(received.url),'http://127.0.0.1:3080/dsh-pet-7340/codex-startup/pending');
  await assert.rejects(request('GET','/dsh-pet-7340/codex-startup/pending'));
  await assert.rejects(request('POST','/dsh-pet-7340/codex-character'));
  await assert.rejects(request('GET','/dsh-pet-7340/codex-chat'));
  await assert.rejects(request('POST','https://example.com/'));
  await assert.rejects(request('POST','/shutdown'));
  await assert.rejects(request('POST','/dsh-pet-7340/codex-chat','x'.repeat(17*1024*1024+1)));
});
test('拒绝远程服务、带凭据URL和无效令牌', () => {
  for(const baseUrl of ['https://127.0.0.1:3080/','http://localhost:3080/','http://example.com:3080/','http://u:p@127.0.0.1:3080/','http://127.0.0.1:3080/path','http://127.0.0.1:3080/?x=1']) assert.throws(()=>createHostRequest({...settings,baseUrl}));
  assert.throws(()=>createHostRequest({...settings,token:'bad'}));
});

test('新增GUI全部读写通过真实本机HTTP桥，未知路径与错方法在请求前拒绝',async t=>{
 const{createServer}=require('node:http'),received=[];
 const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;received.push({method:req.method,url:req.url,token:req.headers['x-dsh-pet-token'],body:raw});res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const request=createHostRequest({...settings,baseUrl:`http://127.0.0.1:${server.address().port}/`});
 const routes=[['/pet-workspace/tasks',['GET','POST']],['/pet-memory/scopes',['GET']],['/pet-memory',['POST']],['/pet-memory/export',['POST']],['/pet-model-policy',['GET','POST']],['/pet-role/settings',['GET','POST']],['/pet-content',['GET','POST']],['/international-chat',['GET','POST']],['/pet-local-control',['POST']]];
 for(const[route,methods]of routes)for(const method of methods){const result=await request(method,'/dsh-pet-7340'+route,method==='GET'?undefined:'{}');assert.equal(result.status,200);assert.equal(JSON.parse(result.body).ok,true);}
 assert.equal(received.length,14);assert.ok(received.every(item=>item.token===settings.token));const count=received.length;
 for(const[route,methods]of routes)for(const method of ['GET','POST','PUT','DELETE','PATCH'])if(!methods.includes(method))await assert.rejects(request(method,'/dsh-pet-7340'+route,method==='GET'?undefined:'{}'),/unsupported local request/);
 for(const route of ['/dsh-pet-7340/pet-memory/private','/dsh-pet-7340/pet-content?path=elsewhere','/dsh-pet-7340/international-chat/','http://127.0.0.1:3080/dsh-pet-7340/pet-content','/dsh-pet-7340/pet-local-control/webhook'])await assert.rejects(request('POST',route,'{}'),/unsupported local request/);
 assert.equal(received.length,count);
});

test('耗时操作只按固定方法与路由延长超时，读取和未知请求不能借用执行预算',async t=>{
 const original=AbortSignal.timeout,calls=[];AbortSignal.timeout=ms=>{calls.push(ms);return new AbortController().signal;};t.after(()=>{AbortSignal.timeout=original;});
 const request=createHostRequest({...settings,fetchImpl:async()=>({status:200,text:async()=>'{}'})});
 for(const[route,action,timeout]of [['/codex-chat',null,130000],['/qq-remote','save',400000],['/international-chat','save',200000],['/international-chat','login-input',10000],['/pet-memory','summarize',130000],['/pet-memory','query',10000],['/pet-memory','correct',10000],['/pet-model-policy','catalog',35000],['/pet-model-policy','save',35000],['/pet-content','broadcast-voices',100000],['/pet-content','save-profile',35000],['/pet-content','start',10000],['/pet-workspace/tasks','cancel',20000],['/pet-workspace/tasks','read',10000],['/pet-role/settings','save',10000],['/pet-local-control','take',10000]]){await request('POST','/dsh-pet-7340'+route,JSON.stringify({action}));assert.equal(calls.at(-1),timeout,route+' '+action);}
 for(const body of ['{}','null','[]','bad-json','{"action":"unknown","timeout":999999}']){await request('POST','/dsh-pet-7340/pet-memory',body);assert.equal(calls.at(-1),10000);}
 for(const route of ['/qq-remote','/international-chat','/pet-model-policy','/pet-content','/pet-workspace/tasks']){await request('GET','/dsh-pet-7340'+route);assert.equal(calls.at(-1),10000,route+' read');}
 const count=calls.length;await assert.rejects(request('POST','/dsh-pet-7340/pet-memory?timeout=999999','{}'));assert.equal(calls.length,count);
});
test('真实菜单经过生产HTTP桥可双向切换宿主，只开放精确GET/POST且保留能力令牌', async t => {
  const {createServer}=require('node:http'),{EventEmitter}=require('node:events');
  const Menu=require('./pet-host-menu.cjs'),received=[];
  const server=createServer(async(req,res)=>{
    let text='';for await(const part of req)text+=part;
    received.push({method:req.method,url:req.url,token:req.headers['x-dsh-pet-token'],body:text?JSON.parse(text):null});
    res.setHeader('content-type','application/json');res.end(JSON.stringify({schemaVersion:1,host:text?JSON.parse(text).host:'codex'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request=createHostRequest({...settings,baseUrl:`http://127.0.0.1:${server.address().port}/`});
  assert.equal(JSON.parse((await request('GET','/dsh-pet-7340/pet-host')).body).host,'codex');
  for(const host of ['workbuddy','codex']){
    const menu=Menu.createController({host:host==='codex'?'workbuddy':'codex',hostRequest:request,
      electron:{app:new EventEmitter(),ipcMain:{handle(){},removeHandler(){}},BrowserWindow:{}}});
    try{assert.equal((await menu.select(host)).host,host);}finally{menu.dispose();}
  }
  assert.deepEqual(received.map(x=>({method:x.method,url:x.url,body:x.body})),[
    {method:'GET',url:'/dsh-pet-7340/pet-host',body:null},
    {method:'POST',url:'/dsh-pet-7340/pet-host',body:{host:'workbuddy'}},
    {method:'POST',url:'/dsh-pet-7340/pet-host',body:{host:'codex'}},
  ]);
  assert.ok(received.every(x=>x.token===settings.token));
  for(const method of ['PUT','DELETE','PATCH'])await assert.rejects(request(method,'/dsh-pet-7340/pet-host','{}'),/unsupported local request/);
  await assert.rejects(request('POST','/dsh-pet-7340/pet-host',{host:'codex'}),/unsupported local request/);
  assert.equal(received.length,3);
});
