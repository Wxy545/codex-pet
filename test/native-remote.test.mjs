import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkBuddyRemote,resolveWorkBuddyNative} from '../src/workbuddy-remote.mjs';
import {createHarnessRemote,prepareHarnessRemoteProfile,createRemoteGuard,resolveHarnessNative} from '../src/harness-remote.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';

function tree(t){const root=mkdtempSync(join(tmpdir(),'pet-native-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const put=(path,body='')=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),body);return join(root,path);};return{root,put};}
function fakePeer(mode='default'){
  const child=new EventEmitter();child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();let launch,buffer='';const send=(id,result)=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
  child.stdin=new Writable({write(chunk,encoding,done){buffer+=chunk.toString();let cut;while((cut=buffer.indexOf('\n'))>=0){const frame=JSON.parse(buffer.slice(0,cut));buffer=buffer.slice(cut+1);if(frame.method==='initialize')send(frame.id,{protocolVersion:1,agentCapabilities:{}});if(frame.method==='session/new')send(frame.id,{sessionId:'owned',modes:{currentModeId:mode}});}done();},final(done){child.exitCode=0;child.emit('close',0);done();}});child.kill=()=>{child.exitCode=-1;child.emit('close',-1);};return{spawnImpl:(...args)=>{launch=args;return child;},get launch(){return launch;}};
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
