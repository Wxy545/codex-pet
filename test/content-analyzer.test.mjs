import test from'node:test';import assert from'node:assert/strict';import{createContentAnalyzer}from'../src/content-analyzer.mjs';
test('内容理解仅记录预算内实际送入的素材，链接和音轨引用不冒充看过',async()=>{
 let submitted;const analyze=createContentAnalyzer({getCharacter:()=>({id:'white-dragon',name:'Dragon Girl'}),generate:async input=>{submitted=input;return{text:'Actual summary',materialsUsed:['text'],execution:{model:'requested-model',provenance:'requested'}};}});
 const materials=Array.from({length:12},(_,i)=>({id:'text-'+i,kind:'text',text:'x'.repeat(4500)}));materials.push({id:'audio-reference',kind:'audio',url:'https://example.com/audio'});
 const result=await analyze({host:'codex',profileId:'synthetic-profile',job:{id:'synthetic-job'},sources:[],materials});assert.ok(submitted.context.length<=8192);assert.equal(submitted.tools.length,0);assert.deepEqual(result.materialIdsUsed,['text-0']);assert.equal(result.actualModel,null);assert.equal(result.requestedModel,'requested-model');
});
test('公开主播只提交独立公开人设，不获取桌面私有人设或私人记忆',async()=>{
 let submitted;const analyze=createContentAnalyzer({getCharacter:()=>{throw Error('must not read private persona');},generate:async input=>{submitted=input;return{text:'一条可直接朗读的回应',materialsUsed:['text']};}});
 const result=await analyze({host:'workbuddy',profileId:'synthetic-live',job:{id:'public-live'},intent:'broadcast-reply',publicPersona:'喜欢讲星星的公开龙娘',materials:[{id:'chat-line',kind:'comments',text:'观众：今天讲什么？'}],sources:[]});
 assert.equal(submitted.character.persona,'喜欢讲星星的公开龙娘');assert.equal(submitted.intent,'broadcast-reply');assert.equal(submitted.tools.length,0);assert.equal(submitted.context.includes('观众：今天讲什么？'),true);assert.equal(result.text,'一条可直接朗读的回应');
});
