import test from'node:test';import assert from'node:assert/strict';import{createPetLocalControl}from'../src/pet-local-control.mjs';
test('QQ零模型动作按当前宿主固定白名单领取一次，不支持命令与跨宿主',async()=>{
 const service=createPetLocalControl({host:'codex'});assert.throws(()=>service.request('workbuddy','hide'));assert.throws(()=>service.request('codex','shell','whoami'));
 const answer=service.request('codex','catalog'),rows=service.take();assert.equal(rows.length,1);assert.equal(service.take().length,0);assert.equal(service.settle({id:rows[0].id,ok:true,value:{characters:[]}}),true);assert.deepEqual(await answer,{characters:[]});assert.equal(service.settle({id:rows[0].id,ok:true}),false);service.dispose();
});
