import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
let Manager={};try{Manager=await import('../workbuddy/manage.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'codex-workbuddy-install-'));t.after(()=>rm(dir,{recursive:true,force:true}));const appRoot=join(dir,'app'),workBuddyHome=join(dir,'workbuddy-home'),exe=join(dir,'WorkBuddy','WorkBuddy.exe'),cli=join(dir,'WorkBuddy/resources/app.asar.unpacked/cli');await mkdir(appRoot);await mkdir(workBuddyHome);await mkdir(join(cli,'bin'),{recursive:true});await writeFile(exe,'owned fixture');await writeFile(join(cli,'bin/codebuddy'),'owned fixture');await writeFile(join(cli,'product.json'),'{"productName":"WorkBuddy","dataFolderName":".workbuddy"}');await writeFile(join(cli,'package.json'),'{"name":"@genie/agent-cli","version":"2.165.0"}');return{dir,appRoot,workBuddyHome,workBuddyExe:exe,nodePath:process.execPath};}
test('安装使用实际WorkBuddy自带CLI和user scope，插件地址写入自有连接文件',async t=>{
 assert.equal(typeof Manager.installWorkBuddyPlugin,'function','WorkBuddy安装器尚未实现');const f=await fixture(t),calls=[];
 const result=await Manager.installWorkBuddyPlugin({...f,runCli:async(args,context)=>{calls.push({args,context});}});
 assert.equal(result.plugin,'codex-pet-companion@codex-pet-workbuddy');
 assert.ok(calls.some(x=>JSON.stringify(x.args).includes('"--scope","user"')));
 assert.ok(calls.every(x=>x.context.cliPath.includes('WorkBuddy/resources/app.asar.unpacked/cli/bin/codebuddy')||x.context.cliPath.includes('WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy')));
 const config=JSON.parse(await readFile(join(result.marketplaceRoot,'plugin/connection.json'),'utf8'));assert.equal(config.appRoot,f.appRoot);assert.equal(config.nodePath,process.execPath);
 const stamp=JSON.parse(await readFile(join(f.appRoot,'data/workbuddy-plugin/.codex-pet-workbuddy.json'),'utf8'));assert.equal(stamp.workBuddyExe,f.workBuddyExe);
});
test('自有marketplace名称已被别的目录占用时在任何写入/CLI操作之前停止',async t=>{
 assert.equal(typeof Manager.installWorkBuddyPlugin,'function');const f=await fixture(t);await mkdir(join(f.workBuddyHome,'plugins'));
 const registry=join(f.workBuddyHome,'plugins/known_marketplaces.json');const original=JSON.stringify({'codex-pet-workbuddy':{source:{source:'directory',path:join(f.dir,'unrelated')},installLocation:join(f.dir,'unrelated')}});await writeFile(registry,original);
 let calls=0;await assert.rejects(Manager.installWorkBuddyPlugin({...f,runCli:async()=>calls++}),/marketplace-name-in-use/);assert.equal(calls,0);assert.equal(await readFile(registry,'utf8'),original);
});
test('卸载只调用自有plugin/marketplace且保留data，不prune其它依赖',async t=>{
 assert.equal(typeof Manager.uninstallWorkBuddyPlugin,'function');const f=await fixture(t),calls=[];
 await Manager.installWorkBuddyPlugin({...f,runCli:async()=>{}});
 await Manager.uninstallWorkBuddyPlugin({...f,runCli:async(args)=>calls.push(args)});
 assert.deepEqual(calls,[['plugin','uninstall','codex-pet-companion@codex-pet-workbuddy','--scope','user','--keep-data'],['plugin','marketplace','remove','codex-pet-workbuddy']]);
});
test('再次安装刷新自有缓存，已装同名其它scope不误作用户scope',async t=>{
 assert.equal(typeof Manager.installWorkBuddyPlugin,'function');const f=await fixture(t),calls=[];
 await Manager.installWorkBuddyPlugin({...f,runCli:async()=>{}});await mkdir(join(f.workBuddyHome,'plugins'),{recursive:true});
 const cache=join(f.workBuddyHome,'plugins/cache/codex-pet-workbuddy/codex-pet-companion/0.1.0');await mkdir(join(cache,'hooks'),{recursive:true});await writeFile(join(cache,'hooks/report.ps1'),'managed old fixture');
 const stampFile=join(f.appRoot,'data/workbuddy-plugin/.codex-pet-workbuddy.json'),stamp=JSON.parse(await readFile(stampFile,'utf8'));stamp.cacheFiles={'plugin/hooks/report.ps1':createHash('sha256').update('managed old fixture').digest('hex')};await writeFile(stampFile,JSON.stringify(stamp));
 await writeFile(join(f.workBuddyHome,'plugins/installed_plugins.json'),JSON.stringify({version:2,plugins:{'codex-pet-companion@codex-pet-workbuddy':[{scope:'user',version:'0.1.0',installPath:cache}]}}));
 await Manager.installWorkBuddyPlugin({...f,runCli:async(args)=>calls.push(args)});
 assert.ok(calls.some(args=>args[0]==='plugin'&&args[1]==='update'&&args.at(-1)==='user'));
 assert.ok(!calls.some(args=>args[0]==='plugin'&&args[1]==='uninstall'));
 assert.notEqual(await readFile(join(cache,'hooks/report.ps1'),'utf8'),'managed old fixture');
});
test('来源被换成其它目录的同名marketplace，即使installLocation相同也拒绝接管',async t=>{
 const f=await fixture(t);await Manager.installWorkBuddyPlugin({...f,runCli:async()=>{}});await mkdir(join(f.workBuddyHome,'plugins'),{recursive:true});
 await writeFile(join(f.workBuddyHome,'plugins/known_marketplaces.json'),JSON.stringify({'codex-pet-workbuddy':{source:{source:'directory',path:join(f.dir,'other')},installLocation:join(f.appRoot,'data/workbuddy-plugin/marketplace')}}));
 await assert.rejects(Manager.installWorkBuddyPlugin({...f,runCli:async()=>{}}),/marketplace-name-in-use/);
});
test('用户在同一marketplace另装插件时卸载只移除本插件，不移除marketplace',async t=>{
 const f=await fixture(t);await Manager.installWorkBuddyPlugin({...f,runCli:async()=>{}});await mkdir(join(f.workBuddyHome,'plugins'),{recursive:true});
 await writeFile(join(f.workBuddyHome,'plugins/installed_plugins.json'),JSON.stringify({version:2,plugins:{'other-plugin@codex-pet-workbuddy':[{scope:'user'}]}}));
 const calls=[];await Manager.uninstallWorkBuddyPlugin({...f,runCli:async args=>calls.push(args)});
 assert.equal(calls.length,1);assert.equal(calls[0][1],'uninstall');
});
test('旧登记可补客户端路径，非法已存路径在刷新或卸载前停止且保留原登记',async t=>{
 const f=await fixture(t);await Manager.installWorkBuddyPlugin({...f,runCli:async()=>{}});
 const file=join(f.appRoot,'data/workbuddy-plugin/.codex-pet-workbuddy.json'),old=JSON.parse(await readFile(file,'utf8'));delete old.workBuddyExe;await writeFile(file,JSON.stringify(old));
 await Manager.installWorkBuddyPlugin({...f,runCli:async()=>{}});assert.equal(JSON.parse(await readFile(file,'utf8')).workBuddyExe,f.workBuddyExe);
 const invalid={...old,workBuddyExe:join(f.dir,'unrelated.exe')};await writeFile(file,JSON.stringify(invalid));let calls=0;
 for(const action of [Manager.installWorkBuddyPlugin,Manager.uninstallWorkBuddyPlugin])await assert.rejects(action({...f,runCli:async()=>calls++}),/workbuddy-plugin-owner-mismatch/);
 assert.equal(calls,0);assert.equal(await readFile(file,'utf8'),JSON.stringify(invalid));
});
test('卸载拒绝另一客户端安装路径，即使它同样名为WorkBuddy.exe',async t=>{
 const f=await fixture(t);await Manager.installWorkBuddyPlugin({...f,runCli:async()=>{}});
 const file=join(f.appRoot,'data/workbuddy-plugin/.codex-pet-workbuddy.json'),stamp=JSON.parse(await readFile(file,'utf8'));stamp.workBuddyExe=join(f.dir,'other-client/WorkBuddy.exe');await writeFile(file,JSON.stringify(stamp));let calls=0;
 await assert.rejects(Manager.uninstallWorkBuddyPlugin({...f,runCli:async()=>calls++}),/workbuddy-plugin-owner-mismatch/);assert.equal(calls,0);
});
