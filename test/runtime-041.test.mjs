import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import vm from 'node:vm';
import {z} from 'zod';
import {patchStandalone041 as legacyStandalone,patchHelper041 as legacyHelper} from '../scripts/prepare-runtime-041.mjs';
import {patchStandalone043,patchHelper043} from '../scripts/prepare-runtime-043.mjs';
import {patchStandalone045,patchHelper045,preserveStandalonePolicy045} from '../scripts/prepare-runtime-045.mjs';
import {preserveStandalonePolicy041} from '../scripts/standalone-policy-041.mjs';
const require=createRequire(import.meta.url),Locale=require('../src/codex-runtime-locale.cjs');
const root=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet'),meta=JSON.parse(await readFile(join(root,'package.json'),'utf8')),supported=['0.4.1','0.4.3','0.4.5'].includes(meta.version);
const patchStandalone041=meta.version==='0.4.5'?patchStandalone045:meta.version==='0.4.3'?patchStandalone043:legacyStandalone,patchHelper041=meta.version==='0.4.5'?patchHelper045:meta.version==='0.4.3'?patchHelper043:legacyHelper;
const preservePolicy=meta.version==='0.4.5'?preserveStandalonePolicy045:preserveStandalonePolicy041;
const raw=supported?await readFile(join(root,'lib/standalone.js'),'utf8'):null,fixed=supported?patchStandalone041(raw):null;
const options={skip:!supported};
function region(source,name){const a=source.indexOf('//#region src/'+name),b=source.indexOf('//#endregion',a);assert.ok(a>=0&&b>a,name);return source.slice(a,b);}
function declaration(source,name){const value=source.match(new RegExp('(?:async )?function '+name+'\\([^)]*\\) \\{[\\s\\S]*?^\\}','m'))?.[0];assert.ok(value,name);return value;}

test('041实际新模块生成可编译宿主，未知或半补丁锚点明确停止',options,()=>{
 const syntax=spawnSync(process.execPath,['--check','--input-type=module'],{input:fixed,encoding:'utf8',windowsHide:true});assert.equal(syntax.status,0,syntax.stderr);
 assert.match(fixed,/historyTimes: list.length > 0/);assert.match(fixed,/createDesktopChangeGuard/);assert.match(fixed,/desktopSettled: sync.desktopSettled/);
 assert.throws(()=>patchStandalone041(raw+raw),/锚点|定位|anchor/);assert.throws(()=>patchStandalone041(raw.replace('const settingsScript = [','const renamedSettings = [')),/锚点|定位|anchor/);
 assert.equal(preservePolicy(preservePolicy(raw)),preservePolicy(raw));
});

function settings(locale){
 let code='';for(const row of fixed.matchAll(/\/\/#region src\/standalone\/settings-page\/script\/[^\n]+\n([\s\S]*?)\/\/#endregion/g))code+=row[1]+'\n';
 code+=region(fixed,'standalone/settings-page/chrome.ts')+'\n'+region(fixed,'standalone/settings-page.ts')+'\nglobalThis.result={html:settingsPage,script:settingsScript};';
 const scope={CodexRuntimeLocale:{settingsHtml:value=>Locale.settingsHtml(value,locale),settingsScript:value=>Locale.settingsScript(value,locale)},ROUTE_SEGMENT:'/dsh-pet-7340',VOICES:[],FONT_PRESETS:[],PET_DISPLAYS:[],CORNER_SET:[],DEFAULT_PHYSICS:{},DEFAULT_FONT:{},DEFAULT_WEIGHTS:{},LOGO_URL:''};vm.runInNewContext(code,scope);return scope.result;
}
test('041十个设置builder先组装再本地化，英文配置页不混中文且不启用新聊天/上传/云额度',options,()=>{
 const en=settings('en'),zh=settings('zh-CN');assert.doesNotThrow(()=>new vm.Script(en.script));assert.doesNotThrow(()=>new vm.Script(zh.script));
 assert.doesNotMatch(en.html,/[\u3400-\u9fff]/u);assert.match(zh.html,/桌宠设置/);assert.doesNotMatch(en.html,/chat-panel\.js|pet-chat-root|id="tab-chat"/);
 assert.match(en.html,/id="model-toggle" hidden/);assert.match(en.html,/<div class="field" hidden><span class="fieldLabel" id="balance-provider-label">/);assert.match(en.script,/selectTab\('config'\)/);
 const nodes=new Map(),byId=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},prefix=en.script.slice(0,en.script.indexOf('(function () {'));
 const populate=declaration(en.script,'populateAi'),input={model:'用户模型名',reply:'模型原始回复',hasKey:true};
 vm.runInNewContext(prefix+'\n'+populate+'\npopulateAi(input);',{byId,input,protocolSelect:null,balanceSelect:null});
 assert.equal(byId('model').value,input.model);assert.doesNotMatch(byId('key-state').textContent,/[\u3400-\u9fff]/u);assert.equal(input.reply,'模型原始回复');
});

test('041旧enabled:false确实保持禁用，保存其他项不重开且公开值无密钥',options,()=>{
 const saved={protocol:'openai-compatible',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic',apiKey:'synthetic-only',enabled:false,automaticWhispers:false,whisperIntervalSec:660};
 const scope={z,Object,URL,BALANCE_PROVIDERS:['','deepseek-official','opencode-go','commandcode'],readAiSettings:()=>saved,writeAiSettings:async()=>{},globalThis:null};scope.globalThis=scope;
 vm.runInNewContext(region(fixed,'standalone/ai-config.ts')+'\nglobalThis.store=createAiConfig("synthetic");',scope);
 assert.equal(scope.store.current().enabled,false);assert.equal(scope.store.publicSettings().enabled,false);assert.equal(scope.store.publicSettings().apiKey,undefined);
 return scope.store.save({maxTokens:256}).then(()=>{assert.equal(scope.store.current().enabled,false);assert.equal(scope.store.current().whisperIntervalSec,660);});
});

test('041自动碎念必须同时就绪、开关开启并遵守原间隔，未知策略不增加调用',options,()=>{
 const scope={};vm.runInNewContext(region(fixed,'host/whisper-policy.ts')+'\nglobalThis.schedule=automaticWhisperSchedule;',scope);
 for(const ready of [true,false])for(const enabled of [true,false])for(const pet of [true,false]){
  const result=scope.schedule({isReady:()=>ready,canWhisper:()=>enabled,whisperIntervalSec:()=>660},pet,1);assert.equal(result.enabled,ready&&enabled&&pet);assert.equal(result.periodSec,660);
 }
 assert.match(region(fixed,'standalone/context.ts'),/balanceAuth: \(\) => undefined/);assert.match(region(fixed,'standalone/context.ts'),/canWhisper: \(\) => ai\.canWhisper\(\)/);
});

test('041更换端点不携带旧key，拒绝草稿和保存后绕过；新key或清空须显式',options,async()=>{
 let writes=0,calls=0;const seen=[],saved={protocol:'openai-compatible',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic',apiKey:'synthetic-bridge-key',enabled:true};
 const scope={z,Object,URL,BALANCE_PROVIDERS:['','deepseek-official','opencode-go','commandcode'],readAiSettings:()=>saved,writeAiSettings:()=>{writes++;}};
 vm.runInNewContext(region(fixed,'standalone/ai-config.ts')+'\nglobalThis.store=createAiConfig("synthetic");',scope);
 const probe={AbortController,setTimeout:()=>1,clearTimeout(){},DEFAULT_AI_SETTINGS:{},PROBE_TIMEOUT_MS:15000,PROBE_MAX_CHARS:96,missingField:(_u,_m,key)=>key?null:'missing-key',codexFixedText:value=>value,sdkTextStream:async function*(settings,_request,_signal,fetcher){await fetcher(settings.baseUrl,settings.apiKey);yield{text:'ok'};},describeFailure:()=> 'failed'};
 vm.runInNewContext(declaration(fixed,'testAiConnection')+'\nglobalThis.test=testAiConnection;',probe);
 const fetcher=async(url,key)=>{calls++;seen.push({url,key});};
 const endpoint='https://synthetic.invalid/v1';
 for(const input of [{baseUrl:endpoint},{baseUrl:endpoint,apiKey:''},{baseUrl:endpoint,clearApiKey:true}])assert.equal((await probe.test(fetcher,scope.store.current(),input)).ok,false);
 assert.equal(calls,0);await assert.rejects(scope.store.save({baseUrl:endpoint}),/Invalid standalone/);assert.equal(writes,0);assert.equal(scope.store.current().baseUrl,saved.baseUrl);
 assert.equal((await probe.test(fetcher,scope.store.current(),{baseUrl:endpoint})).ok,false);assert.equal(calls,0);
 assert.equal((await probe.test(fetcher,scope.store.current(),{})).ok,true);assert.deepEqual(seen[0],{url:saved.baseUrl,key:saved.apiKey});
 assert.equal((await probe.test(fetcher,scope.store.current(),{baseUrl:endpoint,apiKey:'synthetic-new-key'})).ok,true);assert.equal(seen[1].key,'synthetic-new-key');
 await scope.store.save({baseUrl:endpoint,clearApiKey:true});assert.equal(scope.store.current().apiKey,'');assert.equal(writes,1);assert.equal((await probe.test(fetcher,scope.store.current(),{})).ok,false);assert.equal(calls,2);
});

test('041实际流保留每分钟六次，失败前不启动第七次SDK且窗口后恢复',options,async()=>{
 let clock=0,calls=0;const runtime={ready:()=>true,store:{current:()=>({model:'synthetic',timeoutMs:1000})},requests:[],now:()=>clock,logger:{warn(){}}};
 const scope={AbortController,parseRequest:()=>({request:{}}),sdkTextStream:async function*(){calls++;yield{text:'synthetic'};},abortable:promise=>promise,setTimeout:()=>1,clearTimeout(){},MAX_EVENTS:4096,MAX_OUTPUT_CHARS:16384,REQUESTS_PER_MINUTE:6,RATE_WINDOW_MS:60000};
 vm.runInNewContext(declaration(fixed,'createTextStream')+'\nglobalThis.make=createTextStream;',scope);const stream=scope.make(runtime),run=async()=>{for await(const _part of stream({})){};};
 for(let i=0;i<6;i++)await run();assert.equal(calls,6);await assert.rejects(run(),/rate limit/);assert.equal(calls,6);clock=60001;await run();assert.equal(calls,7);
});

test('041真实鉴权函数对state/自定义logo含编码与HEAD拒绝无令牌，旧Cookie与helper头可读',options,async t=>{
 const scope={URL,Buffer,randomBytes,timingSafeEqual,codexFixedText:value=>value};vm.runInNewContext(region(fixed,'standalone/request-security.ts')+'\nglobalThis.security=createRequestSecurity();',scope);
 const security=scope.security,server=createServer((req,res)=>{if(!security.authorize(req,res))return;res.writeHead(200);res.end('synthetic-only');});await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
 const request=(path,method,headers={})=>fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{connection:'close',...headers}});
 for(const path of ['/dsh-pet-7340/state','/dsh-pet-7340/%73tate','/dsh-pet-7340/logo?root=synthetic-custom','/dsh-pet-7340/%6cogo?root=synthetic-custom'])for(const method of ['GET','HEAD']){
  const denied=await request(path,method);assert.equal(denied.status,403);await denied.text();
  for(const headers of [{'x-dsh-pet-token':security.token},{cookie:'dsh_pet_token='+security.token}]){const accepted=await request(path,method,headers);assert.equal(accepted.status,200);await accepted.text();}
 }
 for(const path of ['/dsh-pet-7340/logo','/dsh-pet-7340/logo?root=main','/standalone-ai/icon.png']){const response=await request(path,'GET');assert.equal(response.status,200);await response.text();}
});

test('041未接入头像/会话写和原生余额模型聊天入口在分发前明确拒绝',options,()=>{
 assert.match(fixed,/\["pet-avatar","focus-session"\]\.includes\(rest\)\)return \{kind:"json",status:403/);
 for(const path of ['balance','models','chat-panel.js'])assert.match(fixed,new RegExp('if \\(pathname === "/standalone-ai/'+path.replace('.','\\.')+'"\\) \\{\\n\\t\\t\\trejectRequest\\(res,403,"feature-unavailable"\\);return;'));
});

test('041原生菜单键盘/拖图只经自有主进程gate开小窗，截图和原生录音不绕过',options,async()=>{
 const names=['main.js','main/tray.js','main/bridge.js','main/ipc.js','main/dpi.js','main/user-data.js','sprite.js','sprite/motion.js','sprite/menu.js','sprite/playback.js','sprite/bubble.js','sprite/input.js','events.js','shared-core.js','index.html'];
 if(['0.4.3','0.4.5'].includes(meta.version))names.push('sprite/init.js','sprite/window-fit.js');
 const files=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(join(root,'runtime/electron-helper',name),'utf8')]))),patched=patchHelper041(files);
 assert.deepEqual(patchHelper041(patched),patched);for(const[name,source]of Object.entries(patched))if(name.endsWith('.js'))assert.doesNotThrow(()=>new vm.Script(source,{filename:name}));
 let opened=0;const scope={PetSprite:function(){},window:{codexChatPanel:{open:()=>{opened++;}}},Promise};vm.runInNewContext(patched['sprite/menu.js'].slice(patched['sprite/menu.js'].indexOf('// codex-pet-controlled-chat-041')),scope);
 const p=new scope.PetSprite();p.showChatFromMenu({name:'renderer-file'});assert.equal(opened,1);p.startHearChat();p.stopHearChat();p.screenshotFromShortcut();p.onPasteImage();assert.equal(opened,1);
 let focus;vm.runInNewContext(patched['main/ipc.js'].match(/  ipcMain\.on\('pet:focus-host',[\s\S]*?\n  \}\);/)[0],{ipcMain:{on:(_name,handler)=>{focus=handler;}}});assert.doesNotThrow(()=>focus());
});
