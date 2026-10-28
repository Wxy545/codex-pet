import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import Character from '../src/codex-character.cjs';

// 执行prepare实际生成的上游闭包，避免用改变契约的替身绕过请求完成后的身份检查。
const source=readFileSync(new URL('../node_modules/dsh-pet/lib/codex-host.js',import.meta.url),'utf8');
function fixture(kind){
 let character={id:'white-dragon',locale:'zh-CN'},disk={},resolveGeneration;
 const writes=[];const inputs=[];
 const context={CodexCharacter:{...Character,readCharacter:()=>({...character})},configPaths:{},readAllConfig:()=>({}),findPetInstance:()=>({entry:'main',pet:{id:'main'},conf:{}}),petSystemPrompt:()=>character.id,configuredModel:()=>null,ctx:{},state:{writePet:(...args)=>writes.push(args)},withMemoryLock:fn=>fn(),memoryRounds:()=>5,sliceMemoryRounds:list=>list,readMemory:async()=>structuredClone(disk),writeMemory:async value=>{disk=structuredClone(value);}};
 const generate=async(...args)=>{inputs.push(args);return new Promise(ok=>{resolveGeneration=ok;});};context.generateWhisper=generate;context.generateChat=generate;
 const expression=source.match(kind==='whisper'?/const publishWhisper = ([\s\S]*?)^\t\};/m:/const chatWithPet = ([\s\S]*?)^\t\}\);/m);
 assert.ok(expression,'prepared host closure not found');
 const code=kind==='whisper'?'('+expression[1]+'\n})':'('+expression[1]+'\n}))';
 const fn=vm.runInNewContext(code,context);
 return{fn,writes,inputs,get disk(){return disk;},set character(next){character=next;},resolve:value=>resolveGeneration(value)};
}
test('上游碎念在生成期间切换角色后不写入新角色say槽',async()=>{
 const f=fixture('whisper');const pending=f.fn('main');await Promise.resolve();
 f.character={id:'bluefish',locale:'zh-CN'};f.resolve({ok:true,text:'旧龙娘回复'});
 assert.equal((await pending).reason,'character-changed');assert.equal(f.writes.length,0);
});
test('上游旧chat记忆按角色分桶，并在生成期间切换后不写历史或气泡',async()=>{
 const f=fixture('chat');const old=f.fn('main','hello');await new Promise(setImmediate);
 f.character={id:'bluefish',locale:'zh-CN'};f.resolve({ok:true,text:'旧龙娘回复'});
 assert.equal((await old).reason,'character-changed');assert.deepEqual(f.disk,{});assert.equal(f.writes.length,0);
 const current=f.fn('main','fish');await new Promise(setImmediate);f.resolve({ok:true,text:'当前鱼回复'});await current;
 assert.equal(f.disk['main:bluefish'].main.messages.length,2);assert.equal(f.disk['main:white-dragon'],undefined);assert.equal(f.writes.length,1);
 assert.match(source,/mem\[who\.entry \+ ":" \+ CodexCharacter\.readCharacter\(\)\.id\]/);
});
