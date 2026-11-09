import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import vm from 'node:vm';
import {preserveRuntimeDefaults040} from '../scripts/runtime-defaults-040.mjs';

const stock=()=>JSON.stringify({chatMemoryRounds:10,chatImageLimit:20,clickSoundEnabled:true,chatAnimationEnabled:true,trayEnabled:true,physics:{gravity:1400,restitution:0.78,groundFriction:2.5,ceilingBounce:true,throwPower:1,petCollision:true,hapticEnabled:true,tiltGravity:true,shakeThrow:true},unrelated:'keep // strings /* intact */'});
const expected={chatMemoryRounds:5,chatImageLimit:10,clickSoundEnabled:false,chatAnimationEnabled:true,trayEnabled:true};
const flags=['petCollision','hapticEnabled','tiltGravity','shakeThrow'];
const installed=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet');
const meta=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));
if(!['0.3.8','0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7'].includes(meta.version))throw Error('unreviewed-upstream-version');
const real040=['0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7'].includes(meta.version);
const previous=process.env.CODEX_PET_PREVIOUS_UPSTREAM_FIXTURE;
function declaration(source,name){const value=source.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?^\\}','m'))?.[0];assert.ok(value,name);return value;}
async function actualConfig(){
 const source=await readFile(join(installed,'lib/standalone.js'),'utf8');
 const context={warnOnce(){throw Error('合法用户覆盖不应告警');}};
 // 执行官方实际去注释/校验/合并函数；不导入宿主、不创建服务或查询账号。
 vm.runInNewContext(['stripJsonc','physicsValid','topFieldValid','mergeEntry','packBase'].map(name=>declaration(source,name)).join('\n')+'\nconst GLOBAL_DEFAULT_KEYS='+source.match(/const GLOBAL_DEFAULT_KEYS = (\[[\s\S]*?\]);/)?.[1]+';\nthis.api={parse:text=>JSON.parse(stripJsonc(text)),mergeEntry,packBase};',context);
 return context.api;
}

test('0.4默认模板延续原成本与物理行为，已开启的聊天动作和托盘保留',()=>{
 const result=JSON.parse(preserveRuntimeDefaults040(stock()));
 for(const[key,value]of Object.entries(expected))assert.equal(result[key],value,key);
 for(const key of flags)assert.equal(result.physics[key],false,key);
 assert.equal(result.physics.gravity,1400);assert.equal(result.unrelated,'keep // strings /* intact */');
});

test('模板补丁幂等，注释中的同名示例不算锚点，除目标数字和布尔值外逐字保留',()=>{
 const source='// "chatMemoryRounds": 999\r\n/* "clickSoundEnabled": false */\r\n'+stock();
 const result=preserveRuntimeDefaults040(source);assert.equal(preserveRuntimeDefaults040(result),result);
 const untouched=result.replace('"chatMemoryRounds":5','"chatMemoryRounds":10').replace('"chatImageLimit":10','"chatImageLimit":20').replace('"clickSoundEnabled":false','"clickSoundEnabled":true');
 let restored=untouched;for(const key of flags)restored=restored.replace('"'+key+'":false','"'+key+'":true');assert.equal(restored,source);
});

test('缺失、重复、错误位置、未知值和半应用模板明确失败，不当作用户偏好修复',()=>{
 const corrupt=[
  stock().replace('"chatMemoryRounds":10,',''),
  stock().replace('"chatMemoryRounds":10','"chatMemoryRounds":10,"chatMemoryRounds":10'),
  stock().replace('"physics":{','"physics":{},"physics":{'),
  stock().replace('"chatMemoryRounds":10','"renamed":10'),
  stock().replace('"chatMemoryRounds":10','"chatMemoryRounds":11'),
  stock().replace('"chatMemoryRounds":10','"chatMemoryRounds":5'),
  stock().replace('"trayEnabled":true','"trayEnabled":false'),
  stock().replace('"chatAnimationEnabled":true','"chatAnimationEnabled":false'),
  stock().replace('"chatMemoryRounds":10,','').replace('"gravity":1400','"gravity":1400,"chatMemoryRounds":10'),
  stock().replace('"shakeThrow":true','"shakeThrow":"true"'),
  stock()+'/* truncated',stock().slice(0,-1),'unexpected-runtime',null
 ];
 for(const source of corrupt)assert.throws(()=>preserveRuntimeDefaults040(source),/0\.4\.0.*(?:锚点|模板)/);
});

test('真实官方0.4.0模板只更改约定字段，实际合并仍由用户和种类显式值覆盖',{skip:!real040},async()=>{
 const api=await actualConfig(),source=await readFile(join(installed,'assets/config.jsonc'),'utf8'),before=api.parse(source),after=api.parse(preserveRuntimeDefaults040(source));
 const unchanged=structuredClone(after);for(const key of Object.keys(expected))unchanged[key]=before[key];for(const key of flags)unchanged.physics[key]=before.physics[key];assert.equal(JSON.stringify(unchanged),JSON.stringify(before));
 for(const[key,value]of Object.entries(expected))assert.equal(after[key],value,key);for(const key of flags)assert.equal(after.physics[key],false,key);
 assert.equal(preserveRuntimeDefaults040(preserveRuntimeDefaults040(source)),preserveRuntimeDefaults040(source));
 const overlay={chatMemoryRounds:17,chatImageLimit:3,clickSoundEnabled:true,chatAnimationEnabled:false,trayEnabled:false,physics:{...after.physics,petCollision:true,hapticEnabled:true,tiltGravity:true,shakeThrow:true}},snapshot=JSON.stringify(overlay);
 // 此回归只覆盖默认值分层，不执行与本次无关的宠物实例生成。
 const {pets:unused,...base}=after;
 const main=api.mergeEntry(base,overlay,'合成用户覆盖',[],new Set());for(const[key,value]of Object.entries(overlay))assert.equal(JSON.stringify(main[key]),JSON.stringify(value),key);
 const fileBase=api.packBase(base,overlay);assert.equal(fileBase.chatMemoryRounds,17);assert.equal(fileBase.chatImageLimit,3);assert.equal(fileBase.physics,overlay.physics);
 const pack=api.mergeEntry(fileBase,{chatMemoryRounds:2,physics:{...overlay.physics,petCollision:false}},'合成种类覆盖',[],new Set());assert.equal(pack.chatMemoryRounds,2);assert.equal(pack.chatImageLimit,3);assert.equal(pack.physics.petCollision,false);assert.equal(JSON.stringify(overlay),snapshot);
});

test('真实0.3.8与0.4.0包核对：成本和碰撞保留旧值，新增能力关且不改旧模板',{skip:!real040||!previous},async()=>{
 assert.equal(JSON.parse(await readFile(join(previous,'package.json'),'utf8')).version,'0.3.8');
 const api=await actualConfig(),oldSource=await readFile(join(previous,'assets/config.jsonc'),'utf8'),old=api.parse(oldSource),fresh=api.parse(await readFile(join(installed,'assets/config.jsonc'),'utf8')),fixed=api.parse(preserveRuntimeDefaults040(await readFile(join(installed,'assets/config.jsonc'),'utf8')));
 assert.equal(old.chatMemoryRounds,5);assert.equal(old.chatImageLimit,10);assert.equal(old.physics.petCollision,false);assert.equal(fresh.chatMemoryRounds,10);assert.equal(fresh.chatImageLimit,20);assert.equal(fresh.physics.petCollision,true);
 for(const key of ['chatMemoryRounds','chatImageLimit'])assert.equal(fixed[key],old[key]);assert.equal(fixed.physics.petCollision,old.physics.petCollision);
 for(const key of ['hapticEnabled','tiltGravity','shakeThrow']){assert.equal(old.physics[key],undefined);assert.equal(fresh.physics[key],true);assert.equal(fixed.physics[key],false);}
 assert.throws(()=>preserveRuntimeDefaults040(oldSource),/0\.4\.0.*锚点/);assert.equal(await readFile(join(previous,'assets/config.jsonc'),'utf8'),oldSource);
});
