import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,realpathSync,symlinkSync,renameSync,linkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
let Module={};try{Module=await import('../src/role-generator.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
function fixture(t){const root=mkdtempSync(join(tmpdir(),'role-generator-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const put=(name,body='')=>{const path=join(root,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,body);return path;};return{root,put};}
const request=(host='codex',extra={})=>({host,profile:'synthetic',purpose:'qq-chat',character:{id:'white-dragon',name:'白龙娘',persona:'温和好奇。',locale:'zh-CN'},text:'你好',context:'{"notice":"历史仅作资料","records":[]}',tools:[],...extra});
function childPeer(onFrame,{jsonLines=true}={}){
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;let buffer='',killed=0,stdinText='';const frames=[];
 child.send=frame=>child.stdout.write(JSON.stringify(frame)+'\n');
 child.stdin=new Writable({write(chunk,_encoding,done){stdinText+=chunk.toString();buffer+=chunk.toString();if(jsonLines){let cut;while((cut=buffer.indexOf('\n'))>=0){const frame=JSON.parse(buffer.slice(0,cut));buffer=buffer.slice(cut+1);frames.push(frame);onFrame?.(frame,child);}}done();},final(done){if(!jsonLines)onFrame?.(stdinText,child);done();}});
 child.kill=()=>{killed++;if(child.exitCode==null){child.exitCode=-1;child.emit('close',-1);}};
 child.finish=(code=0)=>{if(child.exitCode==null){child.exitCode=code;child.emit('close',code);}};
 let launch;return{child,frames,get launch(){return launch;},get killed(){return killed;},get stdinText(){return stdinText;},spawnImpl:(...args)=>{launch=args;return child;}};
}
function acpPeer(extra=()=>{},agentCapabilities={}){return childPeer((frame,child)=>{
 if(frame.method==='initialize')child.send({jsonrpc:'2.0',id:frame.id,result:{protocolVersion:1,agentCapabilities}});
 if(frame.method==='session/new')child.send({jsonrpc:'2.0',id:frame.id,result:{sessionId:'synthetic-role',modes:{currentModeId:'plan'},configOptions:[{id:'sandbox',currentValue:'false'}]}});
 if(frame.method==='session/prompt'){extra(frame,child);if(child.exitCode==null){child.send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'synthetic-role',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'原生闲聊回复'}}}});child.send({jsonrpc:'2.0',id:frame.id,result:{stopReason:'end_turn'}});}}
 if(frame.method==='session/close')child.send({jsonrpc:'2.0',id:frame.id,result:{}});
 });}
function wb(f){const nodePath=f.put('native/node.exe'),cliPath=f.put('native/cli/bin/codebuddy');f.put('native/cli/package.json',JSON.stringify({name:'@genie/agent-cli',version:'2.165.0'}));f.put('native/cli/product.json',JSON.stringify({productName:'WorkBuddy'}));const configDir=join(f.root,'workbuddy-home');mkdirSync(configDir);return{nodePath,cliPath,configDir};}
function harness(f){const command=f.put('native/dsh.exe'),home=join(f.root,'harness-home');f.put('harness-home/profiles/web/package.json','{}');return{command,home,profile:'web',version:'0.2.1-rc.5'};}
function generator(t,f,options={}){assert.equal(typeof Module.createRoleChatGenerator,'function');const service=Module.createRoleChatGenerator({dataRoot:join(f.root,'data'),projectRoot:f.root,codexPath:f.put('codex.exe'),...options});t.after(()=>service.dispose());return service;}
function shortPath(t,path){const canonical=realpathSync.native(path);assert.equal(/["%&|<>^!\r\n]/.test(canonical),false);const alias=execFileSync(process.env.ComSpec||'cmd.exe',['/d','/u','/c','for %I in ("'+canonical+'") do @echo %~sI'],{windowsHide:true,windowsVerbatimArguments:true,encoding:'utf16le'}).trim();if(resolve(alias).toLowerCase()===canonical.toLowerCase()){t.skip('当前卷未提供测试目录的8.3别名');return null;}assert.match(alias,/~[0-9]/);assert.equal(realpathSync.native(alias),canonical);return alias;}

test('Windows8.3数据根可进入真实Codex无工具生成管线，工作目录采用canonical路径',{skip:process.platform!=='win32'},async t=>{
 const f=fixture(t),data=join(f.root,'data');mkdirSync(data);const alias=shortPath(t,data);if(!alias)return;const peer=childPeer((_input,child)=>{child.send({type:'item.completed',item:{type:'agent_message',phase:'final_answer',text:'别名路径回复'}});child.finish();},{jsonLines:false}),service=generator(t,f,{dataRoot:alias,spawnImpl:peer.spawnImpl});
 assert.equal((await service.generate(request())).text,'别名路径回复');assert.equal(peer.launch[2].cwd,join(realpathSync.native(data),'role-chat','workspace'));assert.ok(peer.launch[1].includes('--ignore-user-config'));assert.ok(peer.launch[1].includes('shell_tool'));
});

test('Windows8.3的Harness根可创建独立禁工具profile，不改变原生profile',{skip:process.platform!=='win32'},async t=>{
 const f=fixture(t),native=harness(f),alias=shortPath(t,native.home);if(!alias)return;const original=readFileSync(join(native.home,'profiles','web','package.json'),'utf8'),peer=acpPeer(),service=generator(t,f,{getNative:async()=>({...native,home:alias}),spawnImpl:peer.spawnImpl});
 assert.equal((await service.generate(request('harness'))).text,'原生闲聊回复');const args=peer.launch[1],profile=args[args.indexOf('--profile')+1],directory=join(realpathSync.native(native.home),'profiles',profile),patch=JSON.parse(readFileSync(join(directory,'cordis.patch.yml'),'utf8'));assert.match(profile,/^codex-pet-chat-/);assert.equal(patch.find(row=>row.id==='tool-bash').disabled,true);assert.equal(patch.find(row=>row.id==='mcp-client').disabled,true);assert.equal(patch.find(row=>row.insert)?.insert[0].name,join(directory,'chat-guard.mjs'));assert.equal(readFileSync(join(native.home,'profiles','web','package.json'),'utf8'),original);
});

test('角色生成数据根或Harness祖先的真实junction仍拒绝，旧guard硬链接也不可用',async t=>{
 const f=fixture(t),outside=join(f.root,'outside'),alias=join(f.root,'linked');mkdirSync(outside);symlinkSync(outside,alias,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>generator(t,f,{dataRoot:alias}),{code:'role_generator_storage_unsafe'});assert.throws(()=>generator(t,f,{dataRoot:join(alias,'new-data')}),{code:'role_generator_storage_unsafe'});assert.equal(existsSync(join(outside,'new-data')),false);
 const native=harness(f),original=join(f.root,'original-harness');renameSync(native.home,original);symlinkSync(original,native.home,process.platform==='win32'?'junction':'dir');const blocked=generator(t,f,{getNative:async()=>native,spawnImpl:()=>{throw Error('must not spawn');}});await assert.rejects(blocked.generate(request('harness')),{code:'role_generator_storage_unsafe'});
 rmSync(native.home);renameSync(original,native.home);const peer=acpPeer(),service=generator(t,f,{getNative:async()=>native,spawnImpl:peer.spawnImpl});await service.generate(request('harness'));const args=peer.launch[1],guard=join(native.home,'profiles',args[args.indexOf('--profile')+1],'chat-guard.mjs');linkSync(guard,join(f.root,'guard-hardlink.mjs'));await assert.rejects(service.generate(request('harness')),{code:'role_generator_profile_modified'});
});

test('Codex角色生成走隔离禁工具CLI，保留完整来信和资料，模型档位来自用途解析器',async t=>{
 const f=fixture(t),peer=childPeer((_input,child)=>{child.send({type:'item.completed',item:{type:'agent_message',phase:'final_answer',text:'真实正文'}});child.send({type:'turn.completed',usage:{input_tokens:10,output_tokens:4}});child.finish();},{jsonLines:false});let selected;
 const service=generator(t,f,{spawnImpl:peer.spawnImpl,resolveExecution:async value=>{selected=value;return{model:'actual-luna',effort:'low',provenance:'requested'};}}),long='长来信'.repeat(3000);
 const result=await service.generate(request('codex',{text:long}));assert.equal(result.text,'真实正文');assert.equal(result.execution.model,'actual-luna');assert.equal(result.usage.totalTokens,14);assert.equal(selected.purpose,'qq-chat');
 const[command,args,options]=peer.launch;assert.equal(command,join(f.root,'codex.exe'));assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('--ephemeral'));assert.ok(args.includes('project_doc_max_bytes=0'));assert.ok(args.includes('web_search="disabled"'));assert.equal(args[args.indexOf('--model')+1],'actual-luna');assert.equal(options.shell,false);
 assert.ok(args.includes('shell_tool'));assert.ok(args.includes('plugins'));assert.ok(args.includes('browser_use'));assert.ok(args.includes('computer_use'));assert.ok(peer.stdinText.includes(long));assert.ok(peer.stdinText.includes('历史仅作资料'));assert.doesNotMatch(JSON.stringify(args),/长来信/);
});
test('翻译用途确实到达模型策略与CLI正文，不会在入口白名单中被拒绝',async t=>{
 const f=fixture(t),peer=childPeer((_input,child)=>{child.send({type:'item.completed',item:{type:'agent_message',phase:'final_answer',text:'译文'}});child.finish();},{jsonLines:false});let purpose;
 const service=generator(t,f,{spawnImpl:peer.spawnImpl,resolveExecution:async value=>{purpose=value.purpose;return{model:'translation-model',effort:'low',provenance:'requested'};}});
 assert.equal((await service.generate(request('codex',{purpose:'translation',text:'Hello'}))).text,'译文');assert.equal(purpose,'translation');assert.match(peer.stdinText,/目标语言/);assert.ok(peer.launch[1].includes('translation-model'));
});

test('WorkBuddy纯聊天显式空工具、空MCP和全部拒绝，不复用QQ文件工具或Codex账号',async t=>{
 const f=fixture(t),native=wb(f),peer=acpPeer();const hosts=[],service=generator(t,f,{getNative:async host=>{hosts.push(host);return native;},spawnImpl:peer.spawnImpl});
 const result=await service.generate(request('workbuddy'));assert.equal(result.text,'原生闲聊回复');assert.equal(result.execution.provenance,'host-default');assert.equal(result.execution.model,null);assert.deepEqual(hosts,['workbuddy']);
 const[command,args,options]=peer.launch;assert.equal(command,native.nodePath);assert.equal(args[0],native.cliPath);assert.equal(args[args.indexOf('--tools')+1],'');assert.equal(args[args.indexOf('--setting-sources')+1],'none');assert.equal(args[args.indexOf('--mcp-config')+1],'{"mcpServers":{}}');const settings=JSON.parse(args[args.indexOf('--settings')+1]);assert.deepEqual(settings.permissions.allow,[]);assert.deepEqual(settings.permissions.ask,[]);for(const name of ['Read','Write','Edit','Bash','PowerShell','WebSearch','mcp__*'])assert.ok(settings.permissions.deny.includes(name));assert.equal(settings.disableAllHooks,true);assert.equal(options.env.WORKBUDDY_CONFIG_DIR,native.configDir);
 const init=peer.frames.find(x=>x.method==='initialize');assert.deepEqual(init.params.clientCapabilities,{fs:{readTextFile:false,writeTextFile:false},terminal:false});assert.deepEqual(peer.frames.find(x=>x.method==='session/new').params.mcpServers,[]);assert.equal(peer.frames.some(x=>/resume|authenticate|load/.test(x.method||'')),false);
});

test('纯聊天拒绝原生任何工具调用、权限与文件回调，即使是Read也不自动放行',async t=>{
 for(const kind of ['permission','file','tool']){
  const f=fixture(t),native=wb(f),peer=acpPeer((_frame,child)=>{
   if(kind==='permission')child.send({jsonrpc:'2.0',id:'native-read',method:'session/request_permission',params:{sessionId:'synthetic-role',toolCall:{title:'Read'},options:[{kind:'allow_once',optionId:'once'}]}});
   if(kind==='file')child.send({jsonrpc:'2.0',id:'native-read',method:'fs/read_text_file',params:{path:'private.txt'}});
   if(kind==='tool')child.send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'synthetic-role',update:{sessionUpdate:'tool_call',toolCallId:'read',title:'Read'}}});
  });
  const service=generator(t,f,{getNative:async()=>native,spawnImpl:peer.spawnImpl});await assert.rejects(service.generate(request('workbuddy')),{code:'role_generator_tools_forbidden'});assert.ok(peer.killed>=1);
  assert.equal(peer.frames.some(x=>x.result?.outcome?.outcome==='selected'),false);
 }
});

test('Harness纯聊天创建独立固定版本profile，全工具双重拒绝，用户profile不改',async t=>{
 const f=fixture(t),native=harness(f),peer=acpPeer(),old=readFileSync(join(native.home,'profiles/web/package.json'),'utf8');
 const service=generator(t,f,{getNative:async()=>native,spawnImpl:peer.spawnImpl});await service.generate(request('harness'));
 const[command,args]=peer.launch;assert.equal(command,native.command);const profile=args[args.indexOf('--profile')+1];assert.match(profile,/^codex-pet-chat-/);assert.notEqual(profile,'web');const directory=join(native.home,'profiles',profile),pkg=JSON.parse(readFileSync(join(directory,'package.json'),'utf8')),patch=JSON.parse(readFileSync(join(directory,'cordis.patch.yml'),'utf8'));
 assert.deepEqual(pkg.dsh.profile.bundles,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-acp-app']);assert.equal(pkg.dependencies['@deepseek-ai/dsh-base'],native.version);for(const key of ['tool-fs','tool-bash','tool-pwsh','tool-web','mcp-client','plugin-manager'])assert.equal(patch.find(x=>x.id===key).disabled,true);
 assert.equal(readFileSync(join(native.home,'profiles/web/package.json'),'utf8'),old);const hooks=new Map();Module.createRoleChatGuard({on:(name,callback)=>hooks.set(name,callback)});assert.equal((await hooks.get('tools/pre-execute')({name:'future-tool'},()=>true)).kind,'deny');await assert.rejects(hooks.get('tools/execute')({name:'read'},()=>true),{code:'role_generator_tools_forbidden'});
});

test('用户编辑过的Harness聊天profile不会被覆盖或继续执行',async t=>{
 const f=fixture(t),native=harness(f),peer=acpPeer(),service=generator(t,f,{getNative:async()=>native,spawnImpl:peer.spawnImpl});await service.generate(request('harness'));
 const args=peer.launch[1],profile=args[args.indexOf('--profile')+1],file=join(native.home,'profiles',profile,'cordis.patch.yml');writeFileSync(file,'user-edited');await assert.rejects(service.generate(request('harness')),{code:'role_generator_profile_modified'});assert.equal(readFileSync(file,'utf8'),'user-edited');
});

test('原生宿主未安装、版本不支持或强行传模型时拒绝，不跨宿主回退',async t=>{
 const f=fixture(t),hosts=[],service=generator(t,f,{getNative:async host=>{hosts.push(host);throw Object.assign(Error('synthetic'),{code:'not_installed'});},spawnImpl:()=>{throw Error('must not spawn');}});
 await assert.rejects(service.generate(request('harness')),{code:'not_installed'});assert.deepEqual(hosts,['harness']);
 await assert.rejects(service.generate(request('workbuddy',{execution:{model:'cannot-override',effort:'high'}})),{code:'model_selection_unavailable'});
 const native=wb(f),wrong=generator(t,f,{getNative:async()=>({...native,version:'wrong'}),spawnImpl:()=>{throw Error('must not spawn');}});f.put('native/cli/package.json',JSON.stringify({name:'@genie/agent-cli',version:'9.9.9'}));await assert.rejects(wrong.generate(request('workbuddy')),{code:'native_version_unverified'});
});

test('取消、超时及释放只终止本次原生子进程，迟到正文不返回',async t=>{
 for(const reason of ['abort','timeout','dispose']){
  const f=fixture(t),peer=childPeer(()=>{},{jsonLines:false}),controller=new AbortController(),service=generator(t,f,{spawnImpl:peer.spawnImpl,timeoutMs:reason==='timeout'?20:1000});
  const pending=service.generate(request('codex',{signal:controller.signal})),rejected=assert.rejects(pending,{code:reason==='timeout'?'role_generator_timeout':'role_generator_cancelled'});
  await new Promise(resolve=>setImmediate(resolve));if(reason==='abort')controller.abort();if(reason==='dispose')service.dispose();await rejected;assert.equal(peer.killed,1);
 }
});

test('Codex工具事件和异常执行不返回假聊天正文，模型失败不重试',async t=>{
 const f=fixture(t),peer=childPeer((_input,child)=>child.send({type:'item.started',item:{type:'mcp_tool_call'}}),{jsonLines:false});let calls=0;const service=generator(t,f,{spawnImpl:(...args)=>{calls++;return peer.spawnImpl(...args);}});await assert.rejects(service.generate(request()),{code:'role_generator_tools_forbidden'});assert.equal(calls,1);assert.equal(peer.killed,1);
});

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY4cAAAAASUVORK5CYII=';
test('Codex图片按真实附件传入，走视觉用途并清理私有临时文件，不把图片路径当正文',async t=>{
 const f=fixture(t);let path,chosen;const peer=childPeer((_input,child)=>{const args=peer.launch[1];path=args[args.indexOf('--image')+1];assert.ok(existsSync(path));child.send({type:'item.completed',item:{type:'agent_message',text:'看到了图片 '+path}});child.finish();},{jsonLines:false});
 const service=generator(t,f,{spawnImpl:peer.spawnImpl,resolveExecution:async value=>{chosen=value;return{model:'actual-vision',effort:'low',provenance:'requested'};}});
 const result=await service.generate(request('codex',{images:[{dataUrl:png}]}));assert.equal(chosen.purpose,'image');assert.deepEqual(result.materialsUsed,['text','image']);assert.equal(existsSync(path),false);assert.equal(result.text.includes(path),false);assert.match(result.text,/图片|image/);
});

test('ACP只有原生明确支持图片才发送标准image内容，未知能力不冒充看过',async t=>{
 for(const supported of [false,true]){
  const f=fixture(t),native=wb(f),peer=acpPeer(()=>{},supported?{promptCapabilities:{image:true}}:{}),service=generator(t,f,{getNative:async()=>native,spawnImpl:peer.spawnImpl});
  if(!supported){await assert.rejects(service.generate(request('workbuddy',{images:[{dataUrl:png}]})),{code:'modality_unavailable'});assert.equal(peer.frames.some(x=>x.method==='session/prompt'),false);}
  else{const result=await service.generate(request('workbuddy',{images:[{dataUrl:png}]}));const prompt=peer.frames.find(x=>x.method==='session/prompt').params.prompt;assert.equal(prompt[1].type,'image');assert.equal(prompt[1].mimeType,'image/png');assert.equal(prompt[1].data,png.split(',')[1]);assert.deepEqual(result.materialsUsed,['text','image']);}
 }
});

test('图片只收有限内嵌PNG JPEG WebP，拒绝URL、路径、伪签名和超量输入且不启动进程',async t=>{
 const f=fixture(t),service=generator(t,f,{spawnImpl:()=>{throw Error('must not spawn');}});
 for(const images of [[{dataUrl:'https://example.test/picture.png'}],[{dataUrl:png,path:'C:/private'}],[{dataUrl:'data:image/png;base64,YWJjZA=='}],Array.from({length:5},()=>({dataUrl:png})),[{path:'C:/picture.png'}]])await assert.rejects(service.generate(request('codex',{images})),{code:'invalid_image'});
});
