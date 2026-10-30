import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {patchStandaloneResponses} from '../scripts/standalone-responses-patch.mjs';

const root=new URL('../',import.meta.url);
const runtime=new URL('../node_modules/dsh-pet/lib/codex-host.js',import.meta.url);
const logger={debug(){},info(){},warn(){},error(){}};

test('独立AI补丁固定加入Responses、模型按钮和API密钥下方的模型输入',async()=>{
 const upstream=await readFile(new URL('../node_modules/dsh-pet/lib/standalone.js',import.meta.url),'utf8');
 const patched=patchStandaloneResponses(upstream);
 assert.equal(patchStandaloneResponses(patched),patched);
 assert.match(patched,/openai-responses/);
 assert.match(patched,/client\.responses\.create/);
 assert.match(patched,/response\.output_text\.delta/);
 assert.match(patched,/\/standalone-ai\/models/);
 const html=patched.match(/const settingsPage = `([\s\S]*?)`;\nconst settingsStyle/)?.[1]??'';
 assert.ok(html.indexOf('id="key-note"')<html.indexOf('id="model"'));
 assert.match(html,/id="models-btn"/);
 assert.match(html,/id="model-options"/);
});

test('准备好的独立AI能通过OpenAI Responses流式返回文本并发现可选模型',{timeout:10000},async()=>{
 const host=await import(runtime.href);
 const home=await mkdtemp(join(tmpdir(),'codex-pet-responses-'));
 try{
  const config=host.createAiConfig(home);
  await config.save({
   protocol:'openai-responses',baseUrl:'http://127.0.0.1:43210/v1',model:'gpt-test',apiKey:'synthetic-key',
   enabled:true,automaticWhispers:false,whisperIntervalSec:300,maxTokens:512,timeoutMs:5000,
  });
  const calls=[];
  const fetcher=async(url,init)=>{
   calls.push({url:String(url),init});
   if(String(url).includes('/models')){
    return new Response(JSON.stringify({data:[{id:'gpt-test'},{id:'gpt-other',name:'Other'}]}),{
     status:200,headers:{'content-type':'application/json'},
    });
   }
   const sse=[
    'data: {"type":"response.output_text.delta","item_id":"msg_synthetic","output_index":0,"content_index":0,"delta":"你好","logprobs":[],"sequence_number":1}',
    '',
    'data: [DONE]',
    '',
   ].join('\n');
   return new Response(sse,{status:200,headers:{'content-type':'text/event-stream'}});
  };
  const ai=host.createStandaloneAi(home,logger,{fetch:fetcher});
  let reply='';
  for await(const part of ai.stream({provider:'standalone',model:'gpt-test',system:'测试',messages:[{role:'user',content:'hi'}]}))
   reply+=part.text;
  assert.equal(reply,'你好');
  const streamCall=calls.find(call=>call.url.endsWith('/responses'));
  assert.ok(streamCall);
  assert.equal(new Headers(streamCall.init.headers).get('authorization'),'Bearer synthetic-key');
  assert.equal(new Headers(streamCall.init.headers).get('accept'),'text/event-stream');
  const body=JSON.parse(streamCall.init.body);
  assert.equal(body.instructions,'测试');
  assert.equal(body.max_output_tokens,512);
  assert.equal(body.store,false);
  assert.deepEqual(body.input,[{role:'user',content:'hi'}]);

  const discovered=await ai.discoverModels({protocol:'openai-responses',baseUrl:'http://127.0.0.1:43210/v1',apiKey:''});
  assert.deepEqual(discovered,{ok:true,models:[{id:'gpt-test'},{id:'gpt-other',name:'Other'}]});
  const modelCall=calls.find(call=>call.url.endsWith('/models'));
  assert.equal(new Headers(modelCall.init.headers).get('authorization'),'Bearer synthetic-key');
  const anthropic=await ai.discoverModels({protocol:'anthropic',baseUrl:'https://api.anthropic.com/v1',apiKey:'anthropic-key'});
  assert.equal(anthropic.ok,true);
  const anthropicCall=calls.find(call=>call.url.endsWith('/models?limit=1000'));
  assert.ok(anthropicCall);
  assert.equal(new Headers(anthropicCall.init.headers).get('x-api-key'),'anthropic-key');
  assert.equal(new Headers(anthropicCall.init.headers).get('anthropic-version'),'2023-06-01');

  const security=host.createRequestSecurity();
  const listener=await host.listenStandaloneServer({ai,routes:[],logger,security,port:0,bodyTimeoutMs:5000});
  try{
   const response=await fetch(`http://127.0.0.1:${listener.port}/standalone-ai/models`,{
    method:'POST',headers:{'content-type':'application/json','x-dsh-pet-token':security.token},
    body:JSON.stringify({protocol:'openai-responses',baseUrl:'http://127.0.0.1:43210/v1',apiKey:''}),
   });
   assert.equal(response.status,200);
   assert.deepEqual(await response.json(),{ok:true,models:[{id:'gpt-test'},{id:'gpt-other',name:'Other'}]});
  }finally{
   await listener.close();
  }
 }finally{
  await rm(home,{recursive:true,force:true});
 }
});
