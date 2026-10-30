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
