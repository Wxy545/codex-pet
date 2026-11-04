import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {join} from 'node:path';
const source=await readFile(new URL('../src/app.mjs',import.meta.url),'utf8');
const start=source.indexOf('const firstAi = '),end=source.indexOf('writeFileSync(',start);assert.ok(start>=0&&end>start);
const assembly=source.slice(start,end);
for(const [firstAi,enabled,expected]of [[false,false,false],[false,true,true],[true,false,true]])test('实际AI启动装配保留已有启用偏好 '+JSON.stringify({firstAi,enabled}),async()=>{
 let saved;await vm.runInNewContext('(async()=>{'+assembly+'})()', {existsSync:()=>!firstAi,join,home:'synthetic-home',chatPort:31313,chatToken:'synthetic-local-bridge',aiConfig:{publicSettings:()=>({enabled,automaticWhispers:false,whisperIntervalSec:900}),save:async v=>{saved=v;}}});
 assert.equal(saved.enabled,expected);assert.equal(saved.automaticWhispers,firstAi);assert.equal(saved.whisperIntervalSec,firstAi?600:900);
});
