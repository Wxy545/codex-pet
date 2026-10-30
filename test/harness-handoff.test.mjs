import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),Harness=require('../src/harness-handoff.cjs');
const L=require('../src/codex-locale.cjs');
function fixture(t,options={}){
 const dir=mkdtempSync(join(tmpdir(),'native-harness-link-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const projectRoot=join(dir,'pet'),dataRoot=join(projectRoot,'data'),home=join(dir,'native-home'),command=join(dir,'installed','dsh.cmd');
 for(const folder of [projectRoot,dataRoot,join(home,'profiles','web'),join(dir,'installed')])mkdirSync(folder,{recursive:true});
 writeFileSync(command,'@echo off\r\n');writeFileSync(join(home,'profiles','web','package.json'),JSON.stringify({dependencies:{other:'1.0.0'},dsh:{profile:{bundles:['other']}}}));
 const calls=[],dialogs=[],links=[],handoffs=[],restores=[];let answers=options.answers||[0,0,0];
 if(options.beforeCreate)options.beforeCreate({projectRoot,dataRoot,home,command});
 function install(profile){const root=join(home,'profiles',profile);const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));pkg.dependencies['dsh-pet']='0.3.8';pkg.dependencies['codex-pet-harness']='link:synthetic-plugin';pkg.dsh.profile.bundles.push('dsh-pet','codex-pet-harness');writeFileSync(join(root,'package.json'),JSON.stringify(pkg));mkdirSync(join(root,'node_modules','codex-pet-harness'),{recursive:true});writeFileSync(join(root,'node_modules','codex-pet-harness','package.json'),'{"name":"codex-pet-harness","version":"0.8.0"}');}
 const app=new EventEmitter();
 const controller=Harness.createController({electron:{app,dialog:{showMessageBox:async details=>{dialogs.push(details);return{response:answers.shift()??0};},showOpenDialog:async()=>({canceled:false,filePaths:[command]})},shell:{openExternal:async url=>links.push(url)}},projectRoot,dataRoot,home,env:{PATH:''},runCommand:async(action,args)=>{calls.push({action,args});if(options.runCommand)return options.runCommand(action,args,{install});if(action==='install')install(args.profile);return{ok:true,version:options.version||'0.2.1-rc.5'};},onHandoff:async state=>handoffs.push(state),onRestore:async()=>restores.push(true)});
 t.after(()=>controller.dispose());return{controller,projectRoot,dataRoot,home,command,calls,dialogs,links,handoffs,restores,install,setAnswers:value=>{answers=value;}};
}

test('未安装Harness只打开官方安装入口，不保存选择、不隐藏当前宠物或运行CLI',async t=>{
 const f=fixture(t,{answers:[1]});assert.equal((await f.controller.open()).cancelled,true);
 assert.deepEqual(f.links,[Harness.OFFICIAL_URL]);assert.deepEqual(f.calls,[]);assert.deepEqual(f.handoffs,[]);assert.equal(existsSync(join(f.dataRoot,'harness-link.json')),false);
 assert.deepEqual(f.controller.state(),{active:false,installed:false,profile:null});
});

test('正式CLI安装仅接入选中profile，独立home不继承Codex宿主data，成功后才移交',async t=>{
 const f=fixture(t);mkdirSync(join(f.home,'profiles','other'),{recursive:true});writeFileSync(join(f.home,'profiles','other','package.json'),'{"keep":"other profile"}');
 const previous=readFileSync(join(f.home,'profiles','other','package.json'),'utf8');
 f.setAnswers([0,1,0]);const result=await f.controller.open();
 assert.equal(result.external,true);assert.equal(result.active,true);assert.equal(result.installed,true);assert.equal(result.profile,'web');
 assert.deepEqual(f.calls.map(call=>call.action),['inspect','install']);assert.equal(f.calls[1].args.home,f.home);assert.equal(f.calls[1].args.command,f.command);
 assert.equal(readFileSync(join(f.home,'profiles','other','package.json'),'utf8'),previous);assert.equal(f.handoffs.length,1);
 const saved=JSON.parse(readFileSync(join(f.dataRoot,'harness-link.json'),'utf8'));assert.equal(saved.home,f.home);assert.equal(saved.active,true);
 await f.controller.deactivate();assert.equal(f.controller.state().active,false);assert.equal(f.restores.length,1);assert.equal(JSON.parse(readFileSync(join(f.dataRoot,'harness-link.json'),'utf8')).active,false);
});

test('版本未验证或安装未落入原生profile时不宣称成功，错误不泄露命令或路径',async t=>{
 L.setLocale('en');t.after(()=>L.setLocale('zh-CN'));
 for(const options of [{version:'0.9.0'},{runCommand:async()=>({ok:true,version:'0.2.1-rc.5'})}]){
  const f=fixture(t,options);await assert.rejects(f.controller.open(),/harness-unavailable/);assert.equal(f.handoffs.length,0);assert.equal(existsSync(join(f.dataRoot,'harness-link.json')),false);
  assert.doesNotMatch(JSON.stringify(f.dialogs.at(-1)),/[\u3400-\u9fff]|native-harness-link-/);
 }
});

test('profile取消及安装途中窗口退出均不写移交状态',async t=>{
 const cancelled=fixture(t,{answers:[0,2]});assert.equal((await cancelled.controller.open()).cancelled,true);assert.deepEqual(cancelled.calls.map(call=>call.action),['inspect']);
 let finish;const waiting=new Promise(resolve=>{finish=resolve;});
 const f=fixture(t,{runCommand:async(action,args,{install})=>{if(action==='install'){await waiting;install(args.profile);}return{ok:true,version:'0.2.1-rc.5'};}});
 const pending=f.controller.open();await new Promise(setImmediate);f.controller.dispose();finish();await assert.rejects(pending,/harness-unavailable/);assert.equal(f.handoffs.length,0);assert.equal(existsSync(join(f.dataRoot,'harness-link.json')),false);
});

test('不把项目隔离验收CLI发现为正式安装，npm CLI不列出desktop profile',t=>{
 const f=fixture(t),isolated=join(f.projectRoot,'data','isolated-cli');mkdirSync(isolated,{recursive:true});writeFileSync(join(isolated,'dsh.cmd'),'synthetic');
 assert.deepEqual(Harness.candidates({projectRoot:f.projectRoot,env:{PATH:isolated}}),[]);
 mkdirSync(join(f.home,'profiles','desktop'),{recursive:true});writeFileSync(join(f.home,'profiles','desktop','package.json'),'{}');
 assert.deepEqual(Harness.profiles(f.home,false),['web']);assert.deepEqual(Harness.profiles(f.home,true),['desktop','web']);
 assert.equal(Harness.nativeHome({DSH_HOME:f.dataRoot,CODEX_PET_NATIVE_DSH_HOME:f.home}),f.home);
});

test('损坏的本机移交记录保持原样，不自动覆盖',async t=>{
 const f=fixture(t,{beforeCreate:({dataRoot})=>writeFileSync(join(dataRoot,'harness-link.json'),'{broken')});
 await assert.rejects(f.controller.open(),/harness-unavailable/);assert.deepEqual(f.calls,[]);assert.equal(readFileSync(join(f.dataRoot,'harness-link.json'),'utf8'),'{broken');
});

test('后端实时核对已验证的原生移交记录，弱active或项目内隔离CLI都不能冒充Harness',async t=>{
 const f=fixture(t);const selected=()=>Harness.isActive({dataRoot:f.dataRoot,projectRoot:f.projectRoot});assert.equal(selected(),false);
 await f.controller.open();assert.equal(selected(),true);await f.controller.deactivate();assert.equal(selected(),false);
 const file=join(f.dataRoot,'harness-link.json'),record=JSON.parse(readFileSync(file,'utf8'));
 writeFileSync(file,JSON.stringify({...record,active:true,command:join(f.projectRoot,'fake-dsh.cmd')}));writeFileSync(join(f.projectRoot,'fake-dsh.cmd'),'synthetic');assert.equal(selected(),false);
 writeFileSync(file,'{"active":true}');assert.equal(selected(),false);
 writeFileSync(file,JSON.stringify({...record,active:true}));assert.equal(selected(),true);
 writeFileSync(join(f.home,'profiles','web','node_modules','codex-pet-harness','package.json'),'{}');assert.equal(selected(),false);
});
