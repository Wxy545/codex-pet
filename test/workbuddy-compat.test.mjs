import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
let Checker={};try{Checker=await import('../scripts/check-workbuddy-compat.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=['hook-event.mjs','hooks/hooks.json','hooks/report.mjs','hooks/report.ps1'];
const metadata={status:'known',version:'5.9.3',productMatched:true,publisherMatched:true,signatureValid:true,signerMatched:true};
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'codex-workbuddy-compat-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const appRoot=join(root,'app'),home=join(root,'home'),exe=join(root,'client/WorkBuddy.exe'),cli=join(root,'client/resources/app.asar.unpacked/cli'),managed=join(appRoot,'data/workbuddy-plugin/marketplace'),cache=join(home,'plugins/cache/codex-pet-workbuddy/codex-pet-companion/0.1.0');
 for(const directory of [join(appRoot,'workbuddy/plugin'),join(cli,'bin'),managed,cache])await mkdir(directory,{recursive:true});
 await writeFile(exe,'synthetic executable');await writeFile(join(cli,'bin/codebuddy'),'synthetic CLI');
 await writeFile(join(cli,'package.json'),JSON.stringify({name:'@genie/agent-cli',version:'2.165.0',private:'PRIVATE_PACKAGE'}));
 // 实机product.json还含产品功能清单，约387KiB；只取身份字段，但不能误用小配置上限。
 await writeFile(join(cli,'product.json'),JSON.stringify({productName:'WorkBuddy',dataFolderName:'.workbuddy',features:'x'.repeat(387000)}));
 const hashes={};
 for(const name of files){const bytes='synthetic '+name;hashes['plugin/'+name]=digest(bytes);for(const base of [join(appRoot,'workbuddy/plugin'),join(managed,'plugin'),cache]){await mkdir(join(base,name,'..'),{recursive:true});await writeFile(join(base,name),bytes);}}
 await mkdir(join(appRoot,'workbuddy/plugin/.codebuddy-plugin'));await writeFile(join(appRoot,'workbuddy/plugin/.codebuddy-plugin/plugin.json'),'{"version":"0.1.0"}');
 const stampFile=join(appRoot,'data/workbuddy-plugin/.codex-pet-workbuddy.json');
 await writeFile(stampFile,JSON.stringify({schemaVersion:1,appRoot,workBuddyHome:home,workBuddyExe:exe,marketplaceRoot:managed,files:hashes,cacheFiles:hashes,private:'PRIVATE_STAMP'}));
 await writeFile(join(home,'plugins/known_marketplaces.json'),JSON.stringify({'codex-pet-workbuddy':{source:{source:'directory',path:managed},installLocation:managed},other:{private:'PRIVATE_MARKET'}}));
 await writeFile(join(home,'plugins/installed_plugins.json'),JSON.stringify({plugins:{'codex-pet-companion@codex-pet-workbuddy':[{scope:'user',version:'0.1.0',installPath:cache}],other:[{private:'PRIVATE_PLUGIN'}]}}));
 const calls=[];const runCommand=async(file,args)=>{calls.push({file,args});return{code:0,stdout:JSON.stringify(metadata)};};
 return{root:appRoot,home,cli,cache,managed,stampFile,calls,runCommand,reportFile:join(appRoot,'data/workbuddy-compatibility-report.json')};
}
test('只读已登记安装：首次记录已验版本和Hook摘要，报告不含本机路径或其它元数据',async t=>{
 assert.equal(typeof Checker.checkWorkBuddyCompatibility,'function');const f=await fixture(t);const report=await Checker.checkWorkBuddyCompatibility({...f,platform:'win32'});
 assert.equal(report.status,'passed');assert.equal(report.changed,true);assert.equal(report.needsReview,false);assert.equal(report.observed.desktopVersion,'5.9.3');assert.equal(report.observed.cliVersion,'2.165.0');assert.equal(report.observed.hookFileCount,4);assert.equal(report.lastSuccessfulObservation.desktopVersion,'5.9.3');assert.equal(report.candidate,null);
 const output=await readFile(f.reportFile,'utf8');for(const privateValue of [f.root,f.home,f.cli,'PRIVATE_'])assert.equal(output.includes(privateValue),false);
 assert.equal(f.calls.length,1);assert.ok(f.calls[0].file.endsWith('powershell.exe'));assert.ok(f.calls[0].args.includes('-EncodedCommand'));
});
test('相同已缓存版本和Hook立即结束，不执行CLI、测试或模型',async t=>{
 const f=await fixture(t);await Checker.checkWorkBuddyCompatibility({...f,platform:'win32'});f.calls.length=0;const report=await Checker.checkWorkBuddyCompatibility({...f,platform:'win32'});
 assert.equal(report.status,'passed');assert.equal(report.changed,false);assert.equal(f.calls.length,1);assert.ok(f.calls.every(call=>!call.args.includes('--test')&&!call.args.includes('--version')));
});
test('没有本项目登记为not-installed，不查全机、不执行命令',async t=>{
 const root=await mkdtemp(join(tmpdir(),'codex-workbuddy-unregistered-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;
 const report=await Checker.checkWorkBuddyCompatibility({root,platform:'win32',runCommand:async()=>{calls++;throw Error('must not run');}});
 assert.equal(report.status,'not-installed');assert.equal(report.reason,'managed-installation-unregistered');assert.equal(report.needsReview,false);assert.equal(calls,0);
});
test('新客户端/随包CLI只记录candidate，不提升已验声明或成功基线',async t=>{
 const f=await fixture(t);const original=await Checker.checkWorkBuddyCompatibility({...f,platform:'win32'});
 await writeFile(join(f.cli,'package.json'),'{"name":"@genie/agent-cli","version":"2.166.0"}');const changed=await Checker.checkWorkBuddyCompatibility({...f,platform:'win32',runCommand:async()=>({code:0,stdout:JSON.stringify({...metadata,version:'5.9.4'})})});
 assert.equal(changed.status,'candidate');assert.equal(changed.needsReview,true);assert.equal(changed.candidate.desktopVersion,'5.9.4');assert.deepEqual(changed.verified,{desktopVersion:'5.9.3',cliVersion:'2.165.0'});assert.deepEqual(changed.lastSuccessfulObservation,original.lastSuccessfulObservation);
});
test('产品/签名未知或失败不成为成功，保留上次成功记录且不保留原始诊断',async t=>{
 const f=await fixture(t);const original=await Checker.checkWorkBuddyCompatibility({...f,platform:'win32'});
 for(const value of [{...metadata,signatureValid:false},{...metadata,publisherMatched:false}]){const report=await Checker.checkWorkBuddyCompatibility({...f,platform:'win32',runCommand:async()=>({code:0,stdout:JSON.stringify(value)})});assert.equal(report.status,'unknown');assert.deepEqual(report.lastSuccessfulObservation,original.lastSuccessfulObservation);}
 const report=await Checker.checkWorkBuddyCompatibility({...f,platform:'win32',runCommand:async()=>({code:1,stdout:'PRIVATE_DIAGNOSTIC'})});assert.equal(report.status,'unknown');assert.equal(JSON.stringify(report).includes('PRIVATE_'),false);assert.deepEqual(report.lastSuccessfulObservation,original.lastSuccessfulObservation);
});
test('自有缓存或登记摘要不一致需要复查，不写回Hook或覆盖成功基线',async t=>{
 const f=await fixture(t);const original=await Checker.checkWorkBuddyCompatibility({...f,platform:'win32'});const file=join(f.cache,'hooks/report.mjs');await writeFile(file,'user modified hook');
 const report=await Checker.checkWorkBuddyCompatibility({...f,platform:'win32'});assert.equal(report.status,'unknown');assert.equal(report.reason,'hook-digest-mismatch');assert.equal(report.needsReview,true);assert.deepEqual(report.lastSuccessfulObservation,original.lastSuccessfulObservation);assert.equal(await readFile(file,'utf8'),'user modified hook');
});
test('插件已移除或stamp不属于本项目时不读取其它安装或运行客户端',async t=>{
 const f=await fixture(t);await writeFile(join(f.home,'plugins/installed_plugins.json'),'{"plugins":{}}');const removed=await Checker.checkWorkBuddyCompatibility({...f,platform:'win32'});assert.equal(removed.status,'unknown');assert.equal(removed.reason,'managed-hook-not-installed');
 const stamp=JSON.parse(await readFile(f.stampFile,'utf8'));stamp.appRoot=join(f.root,'other');await writeFile(f.stampFile,JSON.stringify(stamp));f.calls.length=0;const wrong=await Checker.checkWorkBuddyCompatibility({...f,platform:'win32'});assert.equal(wrong.reason,'managed-registration-invalid');assert.equal(f.calls.length,0);
});
test('data根junction拒绝读写，检查器不向被链接的外部目录落报告',async t=>{
 const root=await mkdtemp(join(tmpdir(),'codex-workbuddy-linked-data-'));t.after(()=>rm(root,{recursive:true,force:true}));const outside=join(root,'outside'),app=join(root,'app');await mkdir(outside);await mkdir(app);await symlink(outside,join(app,'data'),'junction');
 await assert.rejects(Checker.checkWorkBuddyCompatibility({root:app,platform:'win32'}),/unsafe-report-directory/);await assert.rejects(readFile(join(outside,'workbuddy-compatibility-report.json')),/ENOENT/);
});
