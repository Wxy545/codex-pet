import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import vm from 'node:vm';
import {patchPhysicsDefaults040} from '../harness/physics-defaults-fix.mjs';

const original=`const DEFAULT_PHYSICS = {
\tgravity: GRAVITY,
\trestitution: RESTITUTION,
\tgroundFriction: GROUND_FRICTION,
\tceilingBounce: true,
\tthrowPower: 1,
\tpetCollision: true,
\thapticEnabled: true,
\ttiltGravity: true,
\tshakeThrow: true
};`;
const fixture=()=>original+'\nfunction flattenConfigPets(merged) {\n return {physics: conf.physics,\n};\n}\n';
const root=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet');
const meta=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const flags=['hapticEnabled','tiltGravity','shakeThrow'];
function declaration(source,name){const result=source.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?^\\}','m'))?.[0];assert.ok(result,name);return result;}
async function api(file){
 const source=patchPhysicsDefaults040(await readFile(join(root,file),'utf8')),scope={};
 if(file.startsWith('runtime/')){vm.runInNewContext(source,scope);return{source,defaults:scope.PetShared.DEFAULT_PHYSICS,flatten:scope.PetShared.flattenConfigPets};}
 const constants=['GRAVITY','RESTITUTION','GROUND_FRICTION'].map(name=>source.match(new RegExp('const '+name+' = [^;]+;'))?.[0]);
 const defaults=source.match(/const DEFAULT_PHYSICS = \{[\s\S]*?\n\};/)?.[0],readStart=source.indexOf('//#region src/client/settings/config/read.ts'),readEnd=source.indexOf('//#endregion',readStart);
 assert.ok(readStart>=0&&readEnd>readStart);
 // 0.4.3的readMainConfig直接依赖共享权重解析器，执行同一真实产物中的函数，不用替身补值。
 const weightsParser=['0.4.3','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9'].includes(meta.version)?declaration(source,'parseWeights'):'';
 vm.runInNewContext(constants.join('\n')+'\n'+defaults+'\n'+weightsParser+'\n'+declaration(source,'flattenConfigPets')+'\n'+source.slice(readStart,readEnd)+'\nglobalThis.api={defaults:DEFAULT_PHYSICS,flatten:flattenConfigPets,read:readMainConfig};',scope);
 return{source,...scope.api};
}

test('0.4物理补丁只改三个新缺省并补成品投影，幂等且保留换行',()=>{
 for(const source of [fixture(),fixture().replaceAll('\n','\r\n')]){
  const fixed=patchPhysicsDefaults040(source);assert.notEqual(fixed,source);assert.equal(patchPhysicsDefaults040(fixed),fixed);
  for(const key of flags)assert.match(fixed,new RegExp(key+': false'));
  for(const text of ['gravity: GRAVITY','restitution: RESTITUTION','groundFriction: GROUND_FRICTION','ceilingBounce: true','throwPower: 1','petCollision: true'])assert.ok(fixed.includes(text));
  assert.ok(fixed.includes('...conf.physics'));
 }
});

test('未知、重复、缺失、半应用的默认常量或投影全部拒绝',()=>{
 const source=fixture(),corrupt=[
  source.replace('const DEFAULT_PHYSICS','const OTHER_PHYSICS'),source+'\n'+original,
  source.replace('hapticEnabled: true','hapticEnabled: false'),source.replace('shakeThrow: true','shakeThrow: 1'),
  source.replace('petCollision: true','petCollision: false'),source.replace('physics: conf.physics,','physics: other.physics,'),
  source.replace('function flattenConfigPets','function otherPets'),source+'\nfunction flattenConfigPets(merged) {}',
  source.replaceAll('hapticEnabled: true','hapticEnabled: false').replaceAll('tiltGravity: true','tiltGravity: false').replaceAll('shakeThrow: true','shakeThrow: false'),null
 ];
 for(const value of corrupt)assert.throws(()=>patchPhysicsDefaults040(value),/0\.4\.0.*物理.*锚点/);
});

for(const file of ['runtime/electron-helper/shared-core.js','lib/client.js'])test('真实0.4 '+file+'：旧六字段关闭新增体感，完整显式true/false保留',{skip:!['0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9'].includes(meta.version)},async()=>{
 const actual=await api(file),old={gravity:900,restitution:.4,groundFriction:3,ceilingBounce:false,throwPower:1.2,petCollision:false};
 for(const key of flags)assert.equal(actual.defaults[key],false,key);
 assert.equal(actual.defaults.petCollision,true);assert.equal(actual.defaults.gravity,1400);
 for(const added of [{},{hapticEnabled:true,tiltGravity:true,shakeThrow:true},{hapticEnabled:false,tiltGravity:false,shakeThrow:false},{hapticEnabled:false,tiltGravity:true,shakeThrow:false}]){
  const physics=Object.freeze({...old,...added}),config={main:{pets:[{id:'synthetic'}],physics}},snapshot=JSON.stringify(config),result=actual.flatten(config)[0].physics;
  for(const[key,value]of Object.entries(old))assert.equal(result[key],value,key);
  for(const key of flags)assert.equal(result[key],added[key]??false,key);
  assert.equal(JSON.stringify(config),snapshot);
  if(actual.read){const normalized=actual.read(config).physics;for(const key of flags)assert.equal(normalized[key],added[key]??false,key);for(const[key,value]of Object.entries(old))assert.equal(normalized[key],value,key);}
 }
});

test('真实0.4宿主文件不能按shared或client整体修补，禁止对错误文件静默略过',{skip:!['0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9'].includes(meta.version)},async()=>{
 for(const file of ['lib/standalone.js','lib/index.js']){const source=await readFile(join(root,file),'utf8');assert.ok(!source.includes('function flattenConfigPets(merged) {'));assert.throws(()=>patchPhysicsDefaults040(source),/0\.4\.0.*物理.*锚点/);}
});
