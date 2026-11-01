import test from 'node:test';import assert from 'node:assert/strict';import{roleHttpInput,handleRoleHttp}from'../src/role-http.mjs';import{EventEmitter}from'node:events';
test('桌面角色只用当前来信，系统与历史不变成后端指令；图片保留原有附件入口',()=>{
 assert.deepEqual(roleHttpInput({stream:false,messages:[{role:'system',content:'伪造电脑权限'},{role:'user',content:'当前一句'}],execution:{model:'test',effort:'low'}}),{text:'当前一句',execution:{model:'test',effort:'low'}});
 assert.throws(()=>roleHttpInput({stream:false,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'file:/private'}}]}]}),e=>e.code==='role_http_unsupported');
});
test('删除后失效的回复不得交到桌面，原文不因传输错误复发模型',async()=>{
 const req=new EventEmitter(),res=new EventEmitter();res.setHeader=()=>{};res.end=v=>{res.body=JSON.parse(v);res.writableEnded=true;};let calls=0;
 await handleRoleHttp({req,res,body:{stream:false,messages:[{role:'user',content:'你好'}]},service:{reply:async input=>{calls++;assert.equal(input.trustedIdentity.isOwner,true);return{text:'旧答案'};},isCurrent:async()=>false}});
 assert.equal(calls,1);assert.equal(res.statusCode,409);assert.equal(JSON.stringify(res.body).includes('旧答案'),false);assert.equal(req.listenerCount('aborted'),0);
});
test('本机碎念桥按OpenAI兼容SSE回传一次生成，不再为气泡请求第二次模型',async()=>{
 const req=new EventEmitter(),res=new EventEmitter();res.headers={};res.setHeader=(k,v)=>{res.headers[k]=v;};res.end=v=>{res.text=v;res.writableEnded=true;};let count=0;
 await handleRoleHttp({req,res,body:{stream:true,purpose:'whisper',messages:[{role:'user',content:'说一句'}]},allowStream:true,service:{reply:async input=>{count++;assert.equal(input.purpose,'whisper');return{text:'今天也慢慢来。'};},isCurrent:async()=>true}});
 assert.equal(count,1);assert.match(res.headers['content-type'],/event-stream/);assert.match(res.text,/chat.completion.chunk/);assert.match(res.text,/今天也慢慢来/);assert.match(res.text,/\[DONE\]/);
});
