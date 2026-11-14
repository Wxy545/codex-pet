import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {patchStandalone049,preserveStandalonePolicy049} from '../scripts/prepare-runtime-049.mjs';
import {readVerifiedUpstream049} from '../scripts/upstream-snapshot-049.mjs';

const root=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet');
const options={skip:JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version!=='0.4.9'};
const original=()=>readVerifiedUpstream049(root,'lib/standalone.js');

function section(source,start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,start);
 return source.slice(a,b);
}

test('049 独立宿主拒绝编码环境、录音和气泡清除，保留普通配置路由',options,async()=>{
 const host=patchStandalone049(original());
 const route=section(host,'const runPetRoute = async','const dispatchPetRoute = createPetRouter(deps);');
 const auth=section(host,'function publicRead(req) {','const TOKEN_COOKIE');
 let dispatches=0;
 const scope={URL,ROUTE_SEGMENT:'/dsh-pet-7340',configQueue:Promise.resolve(),upstreamCapabilityResult040:()=>undefined,dispatchPetRoute:()=>{dispatches++;return {status:200};}};
 runInNewContext(`${route}\n${auth}\nglobalThis.api={route:runPetRoute,publicRead};`,scope);
 for(const method of ['GET','HEAD','POST','PUT','DELETE']){
  for(const path of ['%65nvironment','environment%2Ffresh','voice%2Fhear','voice/hear-providers','voice%2Fhear-providers%2Fextra','bubble%2Fclear','bubble%2Fclear%2Fextra']){
   const url='/dsh-pet-7340/'+path;
   assert.equal(scope.api.publicRead({url,method}),false);
   assert.equal((await scope.api.route(url,method,'{}')).status,403);
  }
 }
 assert.equal(dispatches,0);
 assert.equal((await scope.api.route('/dsh-pet-7340/config','GET','')).status,200);
});

test('049 独立声音只选 Edge、兼容旧音色，原始设置强制拒绝语音密钥写入',options,async()=>{
 const host=patchStandalone049(original());
 const voices=section(host,'//#region src/host/voice/voices.ts','//#endregion');
 const store=section(host,'function createAiConfig(home) {','//#endregion');
 const loaded={deepseekApiKey:'synthetic-only',enabled:false};
 let validations=0,writes=0;
 const context={DEFAULT_AI_SETTINGS:{},readAiSettings:()=>loaded,persistedSchema:{parse:value=>value},validateSettings:value=>{validations++;return value;},redact:value=>({enabled:value.enabled}),writeAiSettings:()=>{writes++;}};
 runInNewContext(`${voices}\n${store}\nglobalThis.api={standaloneEdgeVoice,createAiConfig};`,context);
 assert.equal(context.api.standaloneEdgeVoice('zh-CN-XiaoyiNeural'),'edge/zh-CN-XiaoyiNeural');
 assert.equal(context.api.standaloneEdgeVoice('edge/zh-CN-XiaoyiNeural'),'edge/zh-CN-XiaoyiNeural');
 assert.equal(context.api.standaloneEdgeVoice('deepseek/zh-CN-XiaoyiNeural'),undefined);
 assert.equal(context.api.standaloneEdgeVoice('edge/unknown'),undefined);
 const cfg=context.api.createAiConfig('synthetic-home');
 assert.equal(validations,1);
 assert.equal(cfg.current().deepseekApiKey,loaded.deepseekApiKey);
 await assert.rejects(cfg.save({deepseekApiKey:'synthetic-change'}),/feature-unavailable/);
 await assert.rejects(cfg.save({clearDeepseekKey:true}),/feature-unavailable/);
 assert.equal(writes,0);
 assert.equal(validations,1);
 const registration=section(host,'function apply(ctx) {','\n\tconst deps = {');
 assert.match(registration,/ensureEdgeProvider\(\)/);
 assert.doesNotMatch(registration,/ensureDeepseek|ensureDshSpeech|credentials\.resolve/);
 assert.doesNotMatch(host,/id="deepseekApiKey"|callApi\('POST', '\/environment/);
});

test('049 独立天气不使用公网，原件局部被改动时停止适配',options,async()=>{
 const source=original();
 const fixed=preserveStandalonePolicy049(source);
 assert.equal(preserveStandalonePolicy049(fixed),fixed);
 assert.throws(()=>preserveStandalonePolicy049(source.replace('await fetchUapiWeather(city === "" ? deps','await fetchUapiWeather(city === " " ? deps')),/环境查询.*锚点/);
 const env=section(fixed,'//#region src/host/environment.ts','//#endregion');
 const get=runInNewContext(`${env}\ncurrentEnvironment`,{fetchUapiWeather(){assert.fail('独立宿主不查询天气');}});
 assert.equal(await get({city:'synthetic',force:true}),undefined);
 assert.doesNotMatch(fixed,/env: await currentEnvironment\(\)/);
});
