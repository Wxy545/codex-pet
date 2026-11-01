import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{patchModelPurpose}from'../scripts/model-purpose-patch.mjs';
test('固定上游只为碎念请求携带用途，不依赖用户文本猜测，锚点失配停止',async()=>{
 const source=await readFile(new URL('../node_modules/dsh-pet/lib/standalone.js',import.meta.url),'utf8');const result=patchModelPurpose(source);
 assert.match(result,/codexPetPurpose: "whisper"/);assert.match(result,/request.codexPetPurpose = options.codexPetPurpose/);assert.match(result,/"codex-pet-whisper" : settings.model/);
 assert.throws(()=>patchModelPurpose('unexpected-version'),/定位失败/);
});
test('实际生成宿主的SDK流保留碎念用途，普通聊天仍使用原模型',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
 const root=await mkdtemp(join(tmpdir(),'pet-purpose-stream-'));t.after(()=>rm(root,{recursive:true,force:true}));const submitted=[];
 const {createStandaloneAi}=await import('../node_modules/dsh-pet/lib/codex-host.js');
 const ai=createStandaloneAi(root,{error(){},warn(){},debug(){}},{fetch:async(_url,init)=>{submitted.push(JSON.parse(init.body));return new Response('data: '+JSON.stringify({id:'synthetic-completion',created:1,object:'chat.completion.chunk',model:'synthetic-model',choices:[{index:0,delta:{content:'合成碎念'},finish_reason:null}]})+'\n\ndata: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});}});t.after(()=>ai.dispose());
 await ai.saveSettings({protocol:'openai-compatible',baseUrl:'http://127.0.0.1:1/v1',model:'codex',apiKey:'synthetic-test-token',enabled:true});
 for(const whisper of [true,false]){let text='';for await(const part of ai.stream({provider:'standalone',model:'codex',messages:[{role:'user',content:'合成输入'}],...(whisper?{codexPetPurpose:'whisper'}:{})}))text+=part.text;assert.equal(text,'合成碎念');}
 assert.deepEqual(submitted.map(x=>x.model),['codex-pet-whisper','codex']);assert.equal(submitted.length,2);
});
