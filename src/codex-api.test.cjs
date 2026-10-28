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
