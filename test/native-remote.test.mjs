import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkBuddyRemote,resolveWorkBuddyNative} from '../src/workbuddy-remote.mjs';
import {createHarnessRemote,prepareHarnessRemoteProfile,createRemoteGuard,resolveHarnessNative} from '../src/harness-remote.mjs';
import {readNativeMcpCatalog,selectNativeMcp} from '../src/native-mcp.mjs';
import {remoteToolScope} from '../src/remote-tool-policy.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';

function tree(t){const root=mkdtempSync(join(tmpdir(),'pet-native-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const put=(path,body='')=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),body);return join(root,path);};return{root,put};}
function fakePeer(mode='default'){
  const child=new EventEmitter(),frames=[];child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();let launch,buffer='';const send=(id,result)=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
    child.stdin=new Writable({write(chunk,encoding,done){buffer+=chunk.toString();let cut;while((cut=buffer.indexOf('\n'))>=0){const frame=JSON.parse(buffer.slice(0,cut));buffer=buffer.slice(cut+1);frames.push(frame);if(frame.method==='initialize')send(frame.id,{protocolVersion:1,agentCapabilities:{}});if(frame.method==='session/new')send(frame.id,{sessionId:'owned',modes:{currentModeId:mode},configOptions:[{id:'sandbox',currentValue:'false'}]});}done();},final(done){child.exitCode=0;child.emit('close',0);done();}});child.kill=()=>{child.exitCode=-1;child.emit('close',-1);};return{frames,spawnImpl:(...args)=>{launch=args;return child;},get launch(){return launch;}};
}
function wb(t){const {root,put}=tree(t),cliPath=put('install/resources/app.asar.unpacked/cli/bin/codebuddy'),nodePath=put('node.exe'),configDir=join(root,'workbuddy-home');mkdirSync(configDir);put('install/WorkBuddy.exe');put('install/resources/app.asar.unpacked/cli/package.json',JSON.stringify({name:'@genie/agent-cli',version:'2.165.0'}));put('install/resources/app.asar.unpacked/cli/product.json',JSON.stringify({productName:'WorkBuddy'}));return{root,put,native:{nodePath,cliPath,configDir}};}
function harness(t){const {root,put}=tree(t),command=put('installed/dsh.cmd'),home=join(root,'harness-home');put('harness-home/profiles/web/package.json','{}');const cwd=join(root,'workspace');mkdirSync(cwd);return{root,put,cwd,native:{command,home,profile:'web',version:'0.2.1-rc.5'}};}

test('WorkBuddy launch is native ACP, process permission only, no saved allows, shell or auth calls',async t=>{
  const {root,native}=wb(t),peer=fakePeer('default'),adapter=createWorkBuddyRemote({cwd:root,native,permission:'workspace-write',spawnImpl:peer.spawnImpl});t.after(()=>adapter.close());await adapter.createThread({title:'native files'});
  const [command,args,options]=peer.launch;assert.equal(command,native.nodePath);assert.equal(args[0],native.cliPath);assert.ok(args.includes('--acp'));assert.ok(args.includes('--serve'));assert.equal(args[args.indexOf('--host')+1],'127.0.0.1');assert.equal(args[args.indexOf('--port')+1],'0');assert.equal(args[args.indexOf('--auth')+1],'password');assert.ok(options.env.CODEBUDDY_GATEWAY_PASSWORD.length>=32);assert.equal(args[args.indexOf('--permission-mode')+1],'default');assert.equal(args[args.indexOf('--setting-sources')+1],'none');assert.equal(args[args.indexOf('--tools')+1],'Read,Write,Edit');assert.equal(options.shell,false);assert.equal(options.env.WORKBUDDY_CONFIG_DIR,native.configDir);
  const settings=JSON.parse(args[args.indexOf('--settings')+1]);assert.deepEqual(settings.permissions.allow,[]);assert.deepEqual(settings.permissions.ask,['Read','Write','Edit']);assert.equal(settings.disableAllHooks,true);assert.ok(!args.includes('--dangerously-skip-permissions'));
});

test('WorkBuddy readonly requires the native plan mode and rejects unexpected restored permissions',async t=>{
  const {root,native}=wb(t),peer=fakePeer('default'),adapter=createWorkBuddyRemote({cwd:root,native,permission:'read-only',spawnImpl:peer.spawnImpl});t.after(()=>adapter.close());await assert.rejects(adapter.createThread(),{code:'permission_profile_mismatch'});assert.equal(peer.launch[1][peer.launch[1].indexOf('--tools')+1],'Read');
});

test('WorkBuddy resolver reads the managed install stamp, not credential files',t=>{
  const {root,native,put}=wb(t),projectRoot=join(root,'project'),dataRoot=join(projectRoot,'data');put('project/data/workbuddy-plugin/.codex-pet-workbuddy.json',JSON.stringify({schemaVersion:1,appRoot:projectRoot,workBuddyExe:join(root,'install/WorkBuddy.exe'),workBuddyHome:native.configDir}));
  assert.equal(resolveWorkBuddyNative({dataRoot,projectRoot,nodePath:native.nodePath}).cliPath,native.cliPath);assert.throws(()=>resolveWorkBuddyNative({dataRoot:join(root,'absent'),projectRoot}),{code:'not_installed'});
});

test('Harness prepare creates only an owned permission-isolated profile and preserves original profile',async t=>{
  const {native,cwd}=harness(t),original=readFileSync(join(native.home,'profiles/web/package.json'),'utf8');
  const readonly=await prepareHarnessRemoteProfile({native,cwd,permission:'read-only',runtimeAvailable:()=>true}),writable=await prepareHarnessRemoteProfile({native,cwd,permission:'workspace-write',runtimeAvailable:()=>true});
  assert.notEqual(readonly.profile,writable.profile);assert.equal(readFileSync(join(native.home,'profiles/web/package.json'),'utf8'),original);
  const profile=join(native.home,'profiles',readonly.profile),pkg=JSON.parse(readFileSync(join(profile,'package.json'),'utf8')),patch=JSON.parse(readFileSync(join(profile,'cordis.patch.yml'),'utf8'));
  assert.equal(pkg.dependencies['@deepseek-ai/dsh-acp-app'],native.version);assert.deepEqual(pkg.dsh.profile.bundles,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-acp-app']);assert.equal(patch.find(item=>item.id==='sandbox-policy').config.mode,'read-only');assert.equal(patch.find(item=>item.id==='tool-pwsh').disabled,true);assert.equal(patch.find(item=>item.id==='tool-web').disabled,true);
  writeFileSync(join(profile,'remote-guard.mjs'),'user edit');await assert.rejects(prepareHarnessRemoteProfile({native,cwd,permission:'read-only',runtimeAvailable:()=>true}),{code:'remote_profile_modified'});
});

test('Harness rejects missing native installation or absent managed preparation',async t=>{
  const {native,cwd}=harness(t);assert.throws(()=>createHarnessRemote({cwd,native:{...native,command:join(cwd,'missing')}}),{code:'not_installed'});
  const adapter=createHarnessRemote({cwd,native});t.after(()=>adapter.close());assert.equal((await adapter.probe()).reason,'remote_profile_unavailable');assert.throws(()=>resolveHarnessNative({dataRoot:cwd,projectRoot:cwd}),{code:'not_installed'});
});

test('Harness actual execution guard enforces same root, readonly, no Shell and an approval for each write',async t=>{
  const {cwd}=harness(t);writeFileSync(join(cwd,'a.txt'),'ok');const hooks=new Map(),ctx={on:(name,fn)=>hooks.set(name,fn)},agent={session:{header:{cwd}}};
  createRemoteGuard(ctx,{root:cwd,permission:'read-only'});const read={name:'read',arguments:{file_path:'a.txt'},agent},write={name:'write',arguments:{file_path:'a.txt',content:'new'},agent};
  assert.equal(await hooks.get('tools/pre-execute')(read,async()=>({kind:'allow'})).then(value=>value.kind),'allow');assert.equal((await hooks.get('tools/pre-execute')(write,async()=>({kind:'allow'}))).kind,'deny');
  await assert.rejects(hooks.get('tools/execute')(write,async()=>true),{code:'outside_remote_scope'});assert.equal((await hooks.get('tools/pre-execute')({...read,name:'pwsh',arguments:{command:'Get-Content a.txt'}},async()=>({kind:'allow'}))).kind,'deny');
  createRemoteGuard(ctx,{root:cwd,permission:'workspace-write'});assert.equal((await hooks.get('tools/pre-execute')(write,async()=>({kind:'allow'}))).kind,'ask');assert.equal(await hooks.get('tools/execute')(write,async()=>true),true);
  const outside={...read,agent:{session:{header:{cwd:join(cwd,'..')}}}};assert.equal((await hooks.get('tools/pre-execute')(outside,async()=>({kind:'allow'}))).kind,'deny');
});

test('Harness dependency preparation aborts only its own child promptly',async t=>{
  const {native,cwd}=harness(t),controller=new AbortController();let killed=0,launched=false;
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.kill=()=>{killed++;child.exitCode=-1;child.emit('close',-1);};
  const pending=prepareHarnessRemoteProfile({native,cwd,runtimeAvailable:()=>false,signal:controller.signal,spawnImpl:()=>{launched=true;return child;}});
  controller.abort();await assert.rejects(pending,{code:'profile_prepare_aborted'});assert.equal(launched,true);assert.equal(killed,1);
  await assert.rejects(prepareHarnessRemoteProfile({native,cwd,signal:controller.signal,runtimeAvailable:()=>false,spawnImpl:()=>{throw Error('must not spawn');}}),{code:'profile_prepare_aborted'});
});

test('WorkBuddy Shell显式default逐次Bash审批，不开放会自动放行的PowerShell工具',async t=>{
  const {root,native}=wb(t),peer=fakePeer(),toolPolicy={shell:true,mcp:false,mcpServerIds:[]},adapter=createWorkBuddyRemote({cwd:root,native,permission:'read-only',toolPolicy,spawnImpl:peer.spawnImpl});t.after(()=>adapter.close());await adapter.createThread();
  const [,args,options]=peer.launch,settings=JSON.parse(args[args.indexOf('--settings')+1]);assert.equal(args[args.indexOf('--permission-mode')+1],'default');assert.equal(args[args.indexOf('--tools')+1],'Read,Bash');assert.equal(settings.sandbox.enabled,false);assert.ok(settings.permissions.ask.includes('Bash'));assert.ok(settings.permissions.deny.includes('PowerShell'));assert.equal(settings.permissions.allow.length,0);assert.equal(options.env.CODEBUDDY_CODE_SHELL,'bash');
});

test('MCP仅公开元数据、中文名映射稳定ASCII ID，选定版本改变必须重新本机保存',t=>{
  const {root,native,put}=wb(t),sourcePath=put('workbuddy-home/mcp.json',JSON.stringify({mcpServers:{'本地资料库':{type:'http',url:'http://127.0.0.1:18800/mcp',headers:{Authorization:'Bearer synthetic-private-token'}},docs:{command:native.nodePath,args:['synthetic-server.js'],env:{PRIVATE_TOKEN:'synthetic-env-value'}}}}));
  const catalog=readNativeMcpCatalog({host:'workbuddy',native,cwd:root});assert.equal(catalog.state,'ready');assert.equal(catalog.servers[0].label,'本地资料库');assert.match(catalog.servers[0].id,/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);assert.doesNotMatch(JSON.stringify(catalog.servers),/18800|Bearer|synthetic-env|node.exe/);
  const chosen=selectNativeMcp({host:'workbuddy',native,cwd:root,sourcePath,revision:catalog.revision,serverIds:['docs']});assert.equal(chosen.length,1);assert.equal(chosen[0].name,'docs');assert.equal(chosen[0].env[0].value,'synthetic-env-value');
  writeFileSync(sourcePath,JSON.stringify({mcpServers:{docs:{type:'http',url:'http://127.0.0.1:18801/mcp'}}}));assert.throws(()=>selectNativeMcp({host:'workbuddy',native,cwd:root,sourcePath,revision:catalog.revision,serverIds:['docs']}),{code:'mcp_config_changed'});
  assert.equal(readNativeMcpCatalog({host:'workbuddy',native,cwd:root,sourcePath:put('auth.json','not JSON')}).state,'unknown');
});

test('Harness Shell和MCP按scope另建profile，真实工具执行围栏每条先ask',async t=>{
  const {native,cwd,put}=harness(t),sourcePath=put('harness-home/profiles/web/mcp.json',JSON.stringify({mcpServers:{docs:{type:'http',url:'http://127.0.0.1:18800/mcp'}}})),catalog=readNativeMcpCatalog({host:'harness',native,cwd,sourcePath});assert.equal(catalog.state,'ready');
  const toolPolicy={shell:true,mcp:true,mcpServerIds:['docs']},toolScope=remoteToolScope(toolPolicy,catalog.revision),options={native,cwd,permission:'read-only',toolPolicy,mcpSourcePath:sourcePath,mcpRevision:catalog.revision,toolScope,runtimeAvailable:()=>true};
  const prepared=await prepareHarnessRemoteProfile(options),files=await prepareHarnessRemoteProfile({native,cwd,runtimeAvailable:()=>true});assert.notEqual(prepared.profile,files.profile);
  const patch=JSON.parse(readFileSync(join(native.home,'profiles',prepared.profile,'cordis.patch.yml'),'utf8'));assert.equal(patch.find(item=>item.id==='tool-pwsh').disabled,process.platform!=='win32');assert.equal(patch.find(item=>item.id==='tool-pwsh').config.promoteOnTimeout,false);
  const hooks=new Map(),ctx={on:(name,fn)=>hooks.set(name,fn)},agent={session:{header:{cwd}}};createRemoteGuard(ctx,{root:cwd,permission:'read-only',toolPolicy,native,mcpSourcePath:sourcePath,mcpRevision:catalog.revision});
  for(const exec of [{name:'pwsh',arguments:{command:'Get-Location'},agent},{name:'mcp__docs__search',arguments:{query:'README'},agent}])assert.equal((await hooks.get('tools/pre-execute')(exec,async()=>({kind:'allow'}))).kind,'ask');
  assert.equal((await hooks.get('tools/pre-execute')({name:'mcp__foreign__search',arguments:{},agent},async()=>({kind:'allow'}))).kind,'deny');
  writeFileSync(sourcePath,JSON.stringify({mcpServers:{docs:{type:'http',url:'http://127.0.0.1:19999/mcp'}}}));await assert.rejects(hooks.get('tools/execute')({name:'mcp__docs__search',arguments:{},agent},async()=>true),{code:'outside_remote_scope'});
});

test('原生MCP专用JSONC/TOML可读，注释和尾逗号不执行代码，长服务名只公开短标签',t=>{
  const {root,native,put}=wb(t),jsonPath=put('workbuddy-home/mcp.jsonc','{ // native configuration\n"mcpServers": {"'+ 'x'.repeat(150)+'": {"type":"http", "url":"http://127.0.0.1:18800/mcp", /* tail */ }, }, }');
  const json=readNativeMcpCatalog({host:'workbuddy',native,cwd:root,sourcePath:jsonPath});assert.equal(json.state,'ready');assert.ok(json.servers[0].label.length<=80);assert.match(json.servers[0].id,/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
  const tomlPath=put('workbuddy-home/mcp.toml','[mcp_servers.notes]\nurl = "http://127.0.0.1:18800/mcp"\n[mcp_servers.notes.http_headers]\nAuthorization = "Bearer synthetic-private"\n');
  const toml=readNativeMcpCatalog({host:'workbuddy',native,cwd:root,sourcePath:tomlPath});assert.equal(toml.state,'ready');assert.equal(toml.servers[0].id,'notes');assert.equal(toml.descriptors[0].headers[0].value,'Bearer synthetic-private');assert.doesNotMatch(JSON.stringify(toml.servers),/synthetic-private|18800/);
  const empty=readNativeMcpCatalog({host:'workbuddy',native:{...native,configDir:join(root,'empty-home')},cwd:join(root,'empty-project')});assert.equal(empty.state,'ready');assert.deepEqual(empty.servers,[]);assert.ok(empty.revision.length>20);
});

test('WorkBuddy只把所选MCP私有描述通过协议传入，命令行不带服务凭据',async t=>{
  const {root,native,put}=wb(t),sourcePath=put('workbuddy-home/mcp.json',JSON.stringify({mcpServers:{docs:{type:'http',url:'http://127.0.0.1:18800/mcp',headers:{Authorization:'Bearer synthetic-private'}},unselected:{type:'http',url:'http://127.0.0.1:18801/mcp'}}})),catalog=readNativeMcpCatalog({host:'workbuddy',native,cwd:root,sourcePath});
  const peer=fakePeer(),toolPolicy={shell:false,mcp:true,mcpServerIds:['docs']},adapter=createWorkBuddyRemote({cwd:root,native,permission:'read-only',toolPolicy,mcpSourcePath:sourcePath,mcpRevision:catalog.revision,spawnImpl:peer.spawnImpl});t.after(()=>adapter.close());await adapter.createThread();
  const request=peer.frames.find(frame=>frame.method==='session/new');assert.deepEqual(request.params.mcpServers.map(server=>server.name),['docs']);assert.equal(request.params.mcpServers[0].headers[0].value,'Bearer synthetic-private');assert.doesNotMatch(JSON.stringify(peer.launch[1]),/18800|18801|synthetic-private/);
  writeFileSync(sourcePath,JSON.stringify({mcpServers:{docs:{type:'http',url:'http://127.0.0.1:19999/mcp'}}}));await assert.rejects(adapter.prompt({text:'hi',threadId:'owned'}),{code:'mcp_config_changed'});
});

test('原生MCP不丢弃源中的工具限制或认证env扩展，无法等价转发的字段明确拒收',t=>{
  const {root,native,put}=wb(t),sourcePath=put('workbuddy-home/mcp.json','{}');
  for(const [key,value]of Object.entries({enabled_tools:['read_only'],disabled_tools:['delete'],env_vars:['PRIVATE_TOKEN'],env_http_headers:{Authorization:'PRIVATE_TOKEN'},bearer_token_env_var:'PRIVATE_TOKEN',oauth:{enabled:true},tool_timeout_sec:1,cwd:root,unknown_future_limit:{enabled:true}})){
    writeFileSync(sourcePath,JSON.stringify({mcpServers:{docs:{type:'http',url:'http://127.0.0.1:18800/mcp',[key]:value}}}));
    const catalog=readNativeMcpCatalog({host:'workbuddy',native,cwd:root,sourcePath});assert.equal(catalog.state,'unknown',key);assert.equal(catalog.reason,'mcp_fields_unsupported',key);assert.deepEqual(catalog.servers,[]);assert.deepEqual(catalog.descriptors,[]);
  }
});
