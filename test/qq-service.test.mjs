import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQQService} from '../src/qq-service.mjs';

async function fixture(t,overrides={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'pet-qq-service-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const sent=[],calls=[],states=[];let count=0,failTarget=null,hold;
 const native={state:()=>({state:'ready',endpoint:'ws://127.0.0.1:17630/',canLogin:false}),prepare(){calls.push('prepare');},start(){calls.push('start-runtime');},async connection(){return{url:'ws://127.0.0.1:17630/',accessToken:'synthetic-onebot-secret'};},async getLoginUrl(){return'http://127.0.0.1:17631/webui?token=synthetic-local-login-token';},async dispose(){calls.push('dispose-runtime');}};
 const options={dataRoot:root,projectRoot:root,codexPath:'synthetic-codex',locale:'zh-CN',onState:s=>states.push(s),createRuntimeImpl:async()=>native,
  resolveTargetImpl:async(application,input)=>{calls.push({resolve:application,...input});if(failTarget===application)throw Object.assign(Error('host_not_installed'),{code:'host_not_installed'});return{application};},
  bridgeOptions:{seal:async s=>Buffer.from(s).toString('base64'),unseal:async s=>Buffer.from(s,'base64').toString(),createTransport:o=>({async start(){await o.onStatus({state:'connected',selfId:'12345678'});},stop(){},async send(packet){sent.push(packet.text);}})},
  createRemoteImpl:async(application,o)=>({async listModels(){return[{id:'sol',model:'gpt-6.1-sol',displayName:'Sol',isDefault:true,supportedReasoningEfforts:['low','high'],defaultReasoningEffort:'low'}];},async createThread({title}={}){const id=application+'-new-'+(++count);await o.onThread?.(id,{created:true,title});return{id,title,cwd:o.cwd,status:'idle',updatedAt:Date.now()};},async readThread({threadId}){const saved=o.managedThreads.find(s=>s.id===threadId);return saved?{...saved,status:'idle'}:null;},async listThreads(){return{items:[],nextCursor:null};},async prompt(p){calls.push({application,prompt:p,permission:o.permission});const id=p.threadId||application+'-thread-'+(++count);await o.onThread(id,{created:!p.threadId});await o.onTurn(id,application+'-turn-'+count);if(p.text==='hold')return new Promise(r=>{hold=()=>r({status:'completed',text:'done'});});return{status:'completed',threadId:id,text:application+':'+p.text};},async close(){},async cancel(){hold?.();},async approve(){}})};
 Object.assign(options,overrides);
 const service=await createQQService(options);t.after(()=>service.dispose());
 const save=(application='codex',provider='official')=>service.configure({action:'save',application,provider,cwd:root,permission:'read-only',enabled:true,...(provider==='official'?{appId:'123456',appSecret:'synthetic-official-secret'}:{})});
 async function pair(id){const s=await service.configure({action:'pair'});await service.receive({userId:'owner',id:'pair-'+id,text:'/配对 '+s.pairing.code});}
 const message=(text,id)=>service.receive({userId:'owner',id,text});
 return{service,root,sent,calls,states,save,pair,message,options,setFail(value){failTarget=value;},async waitHeld(){for(let i=0;i<200&&!hold;i++)await new Promise(r=>setTimeout(r,5));assert.ok(hold,'native prompt must be running');},finish(){hold?.();}};
}

test('旧Codex官方连接保留，六种配置独立保存配对、会话、权限与结果',async t=>{
 const f=await fixture(t);await f.save();await f.pair('codex-official');await f.message('你好','c1');await f.service.idle();const first=f.calls.find(c=>c.prompt);assert.equal(first.application,'codex');assert.equal(first.prompt.effort,'low');
 await f.save('workbuddy','onebot');assert.equal(f.service.state().paired,false);await f.pair('wb-onebot');await f.message('你好','w1');await f.service.idle();const wb=f.calls.filter(c=>c.prompt).at(-1);assert.equal(wb.application,'workbuddy');assert.equal(wb.prompt.model,undefined);assert.equal(wb.prompt.threadId,undefined);assert.equal(wb.permission,'read-only');
 await f.save('harness','official');assert.equal(f.service.state().paired,false);await f.pair('harness-official');await f.message('你好','h1');await f.service.idle();assert.equal(f.calls.filter(c=>c.prompt).at(-1).application,'harness');
 await f.save('codex','official');assert.equal(f.service.state().paired,true);await f.message('你好','c2');await f.service.idle();assert.equal(f.calls.filter(c=>c.prompt).at(-1).prompt.threadId,first.prompt.threadId||'codex-thread-1');
 const state=f.service.state();assert.equal(state.profiles.length,6);assert.equal(state.application,'codex');assert.equal(state.provider,'official');assert.doesNotMatch(JSON.stringify(state),/synthetic-onebot-secret|synthetic-official-secret|synthetic-local-login-token|owner/);
 assert.equal(JSON.parse(await readFile(join(f.root,'qq-service.json'),'utf8')).application,'codex');
});

test('运行中拒绝切应用和通道，未安装目标失败不打断原连接或配对',async t=>{
 const f=await fixture(t);await f.save();await f.pair('owner');await f.message('hold','running');await f.waitHeld();
 await assert.rejects(f.save('workbuddy','onebot'),{code:'busy'});assert.equal(f.service.state().application,'codex');assert.equal(f.service.state().paired,true);f.finish();await f.service.idle();
 f.setFail('workbuddy');await assert.rejects(f.save('workbuddy','onebot'),{code:'host_not_installed'});assert.equal(f.service.state().application,'codex');assert.equal(f.service.state().paired,true);
});

test('NapCat准备与登录不切换活动配置，登录链接不属于公开状态',async t=>{
 const f=await fixture(t);await f.save();await f.pair('owner');await f.service.configure({action:'napcat-prepare'});assert.equal(f.service.state().provider,'official');assert.equal(f.service.state().paired,true);
 const login=await f.service.configure({action:'napcat-login'});assert.match(login.localLoginUrl,/^http:\/\/127\.0\.0\.1:17631\/webui\?token=/);assert.equal(f.service.state().localLoginUrl,undefined);assert.equal(f.service.state().provider,'official');
 await assert.rejects(f.service.configure({action:'napcat-prepare',url:'http://bad.invalid'}),{code:'invalid_input'});
});

test('活动配置文件无法提交时目标资料完整回滚，旧机器人配对与连接保留',async t=>{
 const f=await fixture(t);await f.save();await f.pair('old-owner');
 const before=f.service.state().profiles.find(p=>p.application==='workbuddy'&&p.provider==='onebot');
 await mkdir(join(f.root,'qq-service.json'));
 await assert.rejects(f.save('workbuddy','onebot'));
 const after=f.service.state();assert.equal(after.application,'codex');assert.equal(after.paired,true);
 assert.deepEqual(after.profiles.find(p=>p.application==='workbuddy'&&p.provider==='onebot'),before);
 await f.message('你好','after-failure');await f.service.idle();assert.equal(f.calls.filter(c=>c.prompt).at(-1).application,'codex');
});

test('原生应用变更权限后不复用旧权限会话，模型命令不借Codex目录',async t=>{
 const f=await fixture(t);await f.service.configure({action:'save',application:'workbuddy',provider:'official',cwd:f.root,permission:'workspace-write',enabled:true,appId:'123456',appSecret:'synthetic-official-secret'});await f.pair('wb');await f.message('/模式 任务','mode');await f.message('你好','write');await f.service.idle();
 await f.message('/权限 只读','lower');await f.message('你好','read');await f.service.idle();const prompts=f.calls.filter(c=>c.prompt);assert.equal(prompts.length,2);assert.equal(prompts[1].prompt.threadId,undefined);assert.equal(prompts[1].permission,'read-only');
 await f.message('/模型','models');assert.match(f.sent.at(-1),/WorkBuddy 自己的设置/);assert.equal(f.calls.filter(c=>c.prompt).length,2);
});

test('MCP目录离线投影不泄露传输配置，保存重新读取同一来源并按应用与项目绑定',async t=>{
 const reads=[];let revision='synthetic-revision-1';
 const f=await fixture(t,{readMcpCatalogImpl:async(application,input)=>{reads.push({application,...input});return{state:'ready',revision,sourcePath:input.sourcePath||join(input.cwd,'selected.toml'),servers:[{id:'notes',label:'笔记',transport:'stdio',command:'synthetic-command',env:{SECRET:'synthetic-mcp-secret'}},{id:'search',label:'Search',transport:'http',url:'https://synthetic.invalid',headers:{Authorization:'synthetic-header-secret'}}]};}});
 const request={action:'mcp-catalog',application:'workbuddy',provider:'official',cwd:f.root,sourcePath:join(f.root,'native-picked.toml')};
 const listed=(await f.service.configure(request)).mcpCatalog;
 assert.equal(listed.state,'ready');assert.equal(listed.sourceName,'native-picked.toml');assert.equal(listed.items.length,2);
 assert.doesNotMatch(JSON.stringify(listed),/synthetic-command|synthetic-mcp-secret|synthetic-header-secret|synthetic\.invalid|sourcePath/);
 assert.equal(f.calls.filter(c=>c.prompt).length,0);
 const save={action:'save',application:'workbuddy',provider:'official',cwd:f.root,permission:'read-only',enabled:true,appId:'123456',appSecret:'synthetic-official-secret',toolPolicy:{shell:true,mcp:true,mcpServerIds:['notes']},mcpSourceId:listed.sourceId,mcpRevision:listed.revision};
 const state=await f.service.configure(save);
 assert.deepEqual(state.project.toolPolicy,{shell:true,mcp:true,mcpServerIds:['notes']});assert.equal(state.project.mcpSourceName,'native-picked.toml');
 assert.equal(reads.at(-1).sourcePath,request.sourcePath);assert.equal(f.calls.filter(c=>c.resolve).at(-1).mcpSourcePath,request.sourcePath);
 assert.doesNotMatch(JSON.stringify(state),/native-picked\.toml[^\"]*\\|synthetic-mcp-secret|sourcePath|mcpSourcePath/);
 for(const changed of [{application:'harness'},{provider:'onebot'},{cwd:join(f.root,'another-project')}]){
  if(changed.cwd)await mkdir(changed.cwd);
  await assert.rejects(f.service.configure({...save,...changed}),{code:'stale_mcp_catalog'});
 }
 revision='synthetic-revision-2';await assert.rejects(f.service.configure(save),{code:'mcp_config_changed'});
 assert.equal(f.service.state().application,'workbuddy');assert.equal(f.service.state().project.mcpRevision,'synthetic-revision-1');
 await f.service.configure({...request,sourcePath:undefined});assert.equal(reads.at(-1).sourcePath,request.sourcePath);
 await assert.rejects(f.service.configure(save),{code:'stale_mcp_catalog'});
 const replacement=(await f.service.configure({...request,sourcePath:join(f.root,'replacement.toml')})).mcpCatalog;
 assert.equal(replacement.sourceName,'replacement.toml');await assert.rejects(f.service.configure(save),{code:'stale_mcp_catalog'});
});

test('MCP目录过期、未知、服务移除和伪造选项都不能启动配置或提高权限',async t=>{
 let clock=1000,mode='ready',servers=[{id:'notes',label:'Notes',transport:'stdio'}],revision='rev-one';
 const f=await fixture(t,{now:()=>clock,readMcpCatalogImpl:async()=>({state:mode,revision,servers})});
 await f.save();await f.pair('original');
 const req={action:'mcp-catalog',application:'codex',provider:'official',cwd:f.root};
 const listed=(await f.service.configure(req)).mcpCatalog;
 const save={action:'save',application:'codex',provider:'official',cwd:f.root,permission:'read-only',enabled:true,appId:'123456',toolPolicy:{shell:false,mcp:true,mcpServerIds:['notes']},mcpSourceId:listed.sourceId,mcpRevision:listed.revision};
 await assert.rejects(f.service.configure({...save,mcpSourceId:'synthetic-forged-source'}),{code:'stale_mcp_catalog'});
 await assert.rejects(f.service.configure({...save,toolPolicy:{...save.toolPolicy,mcpServerIds:['not-in-local-catalog']}}),{code:'mcp_config_changed'});
 servers=[];await assert.rejects(f.service.configure(save),{code:'mcp_config_changed'});servers=[{id:'notes',label:'Notes',transport:'stdio'}];
 clock+=300000;await assert.rejects(f.service.configure(save),{code:'stale_mcp_catalog'});
 mode='unknown';const unknown=(await f.service.configure(req)).mcpCatalog;assert.deepEqual(unknown,{state:'unknown',items:[]});
 assert.equal(f.service.state().paired,true);assert.deepEqual(f.service.state().project.toolPolicy,{shell:false,mcp:false,mcpServerIds:[]});
 assert.equal(f.calls.filter(c=>c.resolve&&c.prepare).length,1);
});

test('目录票据过期后刷新仍读取本机所选草稿文件，不换回应用默认源',async t=>{
 let clock=1000;const paths=[];
 const f=await fixture(t,{now:()=>clock,readMcpCatalogImpl:async(_,input)=>{paths.push(input.sourcePath);return{state:'ready',revision:'stable',sourcePath:input.sourcePath||join(input.cwd,'default.json'),servers:[{id:'notes',label:'Notes',transport:'stdio'}]};}});
 const request={action:'mcp-catalog',application:'workbuddy',provider:'official',cwd:f.root},picked=join(f.root,'picked.json');
 await f.service.configure({...request,sourcePath:picked});clock+=300001;
 await f.service.configure(request);assert.deepEqual(paths,[picked,picked]);
});

test('三应用工具开关分别保存，权限变更清空旧会话，QQ权限命令不能开启Shell或MCP',async t=>{
 const f=await fixture(t);
 const save=(application,toolPolicy)=>f.service.configure({action:'save',application,provider:'official',cwd:f.root,permission:'workspace-write',enabled:true,appId:'123456',appSecret:'synthetic-official-secret',toolPolicy});
 await save('codex',{shell:true,mcp:false,mcpServerIds:[]});await f.pair('codex');await f.message('/模式 任务','codex-mode');await f.message('你好','codex-tools');await f.service.idle();
 const selected=async()=>JSON.parse(await readFile(join(f.root,'qq-remote','settings.json'),'utf8')).threadId;
 const original=await selected();assert.ok(original);assert.equal(f.calls.filter(c=>c.prompt).at(-1).application,'codex');
 await save('workbuddy',{shell:false,mcp:false,mcpServerIds:[]});await f.pair('wb');await f.message('/权限 编辑','wb-permission');
 assert.deepEqual(f.service.state().project.toolPolicy,{shell:false,mcp:false,mcpServerIds:[]});
 await save('harness',{shell:true,mcp:false,mcpServerIds:[]});assert.equal(f.service.state().project.toolPolicy.shell,true);
 await save('codex',{shell:true,mcp:false,mcpServerIds:[]});assert.equal(await selected(),original);
 await save('codex',{shell:false,mcp:false,mcpServerIds:[]});assert.equal(await selected(),null);
 await f.message('你好','codex-files');await f.service.idle();assert.equal(f.calls.filter(c=>c.prompt).at(-1).prompt.threadId,undefined);
 const profiles=f.service.state().profiles;assert.equal(profiles.find(p=>p.application==='workbuddy'&&p.provider==='official').project.toolPolicy.shell,false);assert.equal(profiles.find(p=>p.application==='harness'&&p.provider==='official').project.toolPolicy.shell,true);
});
