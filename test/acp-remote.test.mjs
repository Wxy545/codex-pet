import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdtempSync,writeFileSync,mkdirSync,symlinkSync,linkSync,unlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAcpRemote,reviewRemoteTool} from '../src/acp-remote.mjs';
import {remoteToolScope} from '../src/remote-tool-policy.mjs';

function fixture(t){const cwd=mkdtempSync(join(tmpdir(),'pet-acp-'));writeFileSync(join(cwd,'a.txt'),'original');t.after(()=>rmSync(cwd,{recursive:true,force:true}));return cwd;}
function peer(handler=()=>{}){
  const child=new EventEmitter(),frames=[];child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();child.send=frame=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',...frame})+'\n');
  let buffer='';child.stdin=new Writable({write(chunk,encoding,done){buffer+=chunk.toString();let cut;while((cut=buffer.indexOf('\n'))>=0){const frame=JSON.parse(buffer.slice(0,cut));buffer=buffer.slice(cut+1);frames.push(frame);if(frame.method==='initialize')child.send({id:frame.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});else handler(frame,child);}done();},final(done){child.exitCode=0;child.emit('close',0);done();}});
  child.kill=()=>{child.exitCode=-1;child.emit('close',-1);};return{child,frames,spawnImpl:()=>child};
}
const next=()=>new Promise(resolve=>setImmediate(resolve));
function remote(cwd,connection,options={}){return createAcpRemote({host:'harness',cwd,launch:async()=>({command:'synthetic',args:[],env:{}}),spawnImpl:connection.spawnImpl,requestTimeoutMs:150,approvalTimeoutMs:150,turnTimeoutMs:1000,...options});}

test('ACP streams only its active managed session, persists it, and continues without fork or history load',async t=>{
  const cwd=fixture(t),threads=[],turns=[],events=[];let newCount=0;
  const connection=peer((frame,child)=>{
    if(frame.method==='session/new')child.send({id:frame.id,result:{sessionId:'native-'+(++newCount)}});
    if(frame.method==='session/prompt'){
      child.send({method:'session/update',params:{sessionId:'unrelated',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'wrong'}}}});
      child.send({method:'session/update',params:{sessionId:frame.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello'}}}});
      child.send({id:frame.id,result:{stopReason:'end_turn'}});
    }
    if(frame.method==='session/close')child.send({id:frame.id,result:{}});
  });
  const adapter=remote(cwd,connection,{onThread:(id,metadata)=>threads.push({id,...metadata}),onTurn:(...args)=>turns.push(args),onEvent:event=>events.push(event)});t.after(()=>adapter.close());
  const first=await adapter.prompt({text:'hi'}),second=await adapter.prompt({text:'again',threadId:first.threadId});
  assert.equal(first.text,'hello');assert.equal(second.threadId,first.threadId);assert.equal(newCount,1);assert.equal(threads.length,2);assert.equal(turns.length,2);
  assert.ok(events.some(event=>event.type==='delta'&&event.text==='hello'));assert.ok(!connection.frames.some(frame=>/authenticate|load|fork|takeWriter/.test(frame.method??'')));
  assert.equal((await adapter.listThreads()).items[0].id,'native-1');assert.equal(adapter.capabilities.desktopSessions,false);assert.equal(adapter.capabilities.shell,false);
  await assert.rejects(adapter.listModels(),{code:'model_selection_unavailable'});await assert.rejects(adapter.prompt({text:'hi',model:'invented'}),{code:'model_selection_unavailable'});
});

test('ACP resumes only trusted metadata for this exact workspace, host and permission',async t=>{
  const cwd=fixture(t),other=join(cwd,'other');mkdirSync(other);const connection=peer((frame,child)=>{if(frame.method==='session/resume')child.send({id:frame.id,result:{}});if(frame.method==='session/prompt'){child.send({method:'session/update',params:{sessionId:frame.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ok'}}}});child.send({id:frame.id,result:{stopReason:'end_turn'}});}if(frame.method==='session/close')child.send({id:frame.id,result:{}});});
  const adapter=remote(cwd,connection,{managedThreads:[{id:'ok',cwd,permission:'read-only',host:'harness'},{id:'wrong-permission',cwd,permission:'workspace-write'},{id:'wrong-host',cwd,permission:'read-only',host:'workbuddy'},{id:'wrong-cwd',cwd:other,permission:'read-only'}]});t.after(()=>adapter.close());
  assert.deepEqual((await adapter.listThreads()).items.map(item=>item.id),['ok']);
  await assert.rejects(adapter.prompt({text:'resume',threadId:'wrong-permission'}),{code:'thread_not_managed'});assert.equal(connection.frames.filter(frame=>frame.method==='session/resume').length,0);
  assert.equal((await adapter.prompt({text:'resume',threadId:'ok'})).text,'ok');assert.equal(connection.frames.find(frame=>frame.method==='session/resume').params.sessionId,'ok');
});

test('ACP rejects busy or unknown owner state before native resume',async t=>{
  const cwd=fixture(t),connection=peer(),adapter=remote(cwd,connection,{managedThreads:[{id:'owned',cwd,permission:'read-only'}],beforeResume:()=>false});t.after(()=>adapter.close());
  await assert.rejects(adapter.prompt({text:'go',threadId:'owned'}),{code:'thread_busy'});assert.equal(connection.frames.some(frame=>frame.method==='session/resume'),false);
});

test('file review refuses secrets, out-of-root, unsupported tools, readonly writes and partial operation details',t=>{
  const cwd=fixture(t),read=path=>({title:'read',rawInput:{file_path:path}}),write=path=>({title:'write',rawInput:{file_path:path,content:'new'}});
  assert.equal(reviewRemoteTool(cwd,'read-only',read('a.txt')).kind,'read');assert.equal(reviewRemoteTool(cwd,'workspace-write',write('new.txt')).kind,'file');
  for(const tool of [read('../foreign.txt'),read('.env'),read('.git/config'),{title:'bash',rawInput:{command:'echo hi'}},{title:'write',rawInput:{file_path:'a.txt'}},{title:'write',rawInput:{file_path:'a.txt',content:'api_key=abc'}},{title:'read',rawInput:{file_path:'a.txt',sandbox_permissions:'require_escalated'}}])assert.equal(reviewRemoteTool(cwd,'workspace-write',tool),null);
  assert.equal(reviewRemoteTool(cwd,'read-only',write('a.txt')),null);
});

test('file review rejects a hardlinked external file for both reads and writes',t=>{
  const cwd=fixture(t),outside=mkdtempSync(join(tmpdir(),'pet-hardlink-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));
  writeFileSync(join(outside,'external.txt'),'private');linkSync(join(outside,'external.txt'),join(cwd,'alias.txt'));
  assert.equal(reviewRemoteTool(cwd,'read-only',{title:'read',rawInput:{file_path:'alias.txt'}}),null);
  assert.equal(reviewRemoteTool(cwd,'workspace-write',{title:'write',rawInput:{file_path:'alias.txt',content:'changed'}}),null);
  assert.equal(reviewRemoteTool(cwd,'workspace-write',{title:'write',rawInput:{file_path:'new.txt',content:'new'}}).kind,'file');
});

test('ACP one-time write approval is scoped and rechecks a changed junction before allowing',async t=>{
  const cwd=fixture(t),external=mkdtempSync(join(tmpdir(),'pet-acp-outside-'));t.after(()=>rmSync(external,{recursive:true,force:true}));mkdirSync(join(cwd,'nested'));let promptId,approval;
  const connection=peer((frame,child)=>{
    if(frame.method==='session/new')child.send({id:frame.id,result:{sessionId:'owned'}});
    if(frame.method==='session/prompt'){promptId=frame.id;child.send({method:'session/update',params:{sessionId:'owned',update:{sessionUpdate:'tool_call',toolCallId:'file-call',title:'write',rawInput:{file_path:'nested/a.txt',content:'new'}}}});child.send({id:'approval-native',method:'session/request_permission',params:{sessionId:'owned',toolCall:{toolCallId:'file-call'},options:[{kind:'allow_always',optionId:'always'},{kind:'allow_once',optionId:'once'}]}});}
    if(frame.id==='approval-native'&&frame.result){child.send({method:'session/update',params:{sessionId:'owned',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'done'}}}});child.send({id:promptId,result:{stopReason:'end_turn'}});}
    if(frame.method==='session/close')child.send({id:frame.id,result:{}});
  });
  const adapter=remote(cwd,connection,{permission:'workspace-write',onEvent:event=>{if(event.type==='approval')approval=event;}});t.after(()=>adapter.close());const result=adapter.prompt({text:'write'});
  while(!approval)await next();rmSync(join(cwd,'nested'),{recursive:true});symlinkSync(external,join(cwd,'nested'),process.platform==='win32'?'junction':'dir');
  await adapter.approve({approvalId:approval.id,decision:'accept'});assert.equal((await result).text,'done');assert.deepEqual(connection.frames.find(frame=>frame.id==='approval-native').result,{outcome:{outcome:'cancelled'}});
  await assert.rejects(adapter.approve({approvalId:approval.id,decision:'accept'}),{code:'stale_approval'});unlinkSync(join(cwd,'nested'));
});

test('ACP approval picks only allow_once, never always, and cancels through the owned session',async t=>{
  const cwd=fixture(t);let approval,promptId;const connection=peer((frame,child)=>{
    if(frame.method==='session/new')child.send({id:frame.id,result:{sessionId:'owned'}});
    if(frame.method==='session/prompt'){promptId=frame.id;child.send({id:'native-approval',method:'session/request_permission',params:{sessionId:'owned',toolCall:{toolCallId:'file-call',title:'write',rawInput:{file_path:'new.txt',content:'new'}},options:[{kind:'allow_always',optionId:'always'},{kind:'allow_once',optionId:'once'}]}});}
    if(frame.method==='session/cancel')child.send({id:promptId,result:{stopReason:'cancelled'}});
    if(frame.method==='session/close')child.send({id:frame.id,result:{}});
  });
  const adapter=remote(cwd,connection,{permission:'workspace-write',onEvent:event=>{if(event.type==='approval')approval=event;}});t.after(()=>adapter.close());const result=adapter.prompt({text:'go'});while(!approval)await next();
  await adapter.approve({approvalId:approval.id,decision:'accept'});assert.equal(connection.frames.find(frame=>frame.id==='native-approval').result.outcome.optionId,'once');assert.equal(await adapter.cancel(),true);assert.equal((await result).status,'cancelled');assert.equal(connection.frames.find(frame=>frame.method==='session/cancel').params.sessionId,'owned');
});

test('ACP denies unknown server callbacks and native tool approvals outside the active session',async t=>{
  const cwd=fixture(t),connection=peer((frame,child)=>{if(frame.method==='session/new')child.send({id:frame.id,result:{sessionId:'owned'}});if(frame.method==='session/prompt'){
    child.send({id:'fs-write',method:'fs/write_text_file',params:{path:join(cwd,'a.txt'),content:'wrong'}});child.send({id:'foreign',method:'session/request_permission',params:{sessionId:'foreign',toolCall:{toolCallId:'file-call'}}});
    child.send({method:'session/update',params:{sessionId:'owned',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ok'}}}});child.send({id:frame.id,result:{stopReason:'end_turn'}});
  }if(frame.method==='session/close')child.send({id:frame.id,result:{}});});
  const adapter=remote(cwd,connection);t.after(()=>adapter.close());await adapter.prompt({text:'go'});assert.equal(connection.frames.find(frame=>frame.id==='fs-write').error.code,-32601);assert.equal(connection.frames.find(frame=>frame.id==='foreign').result.outcome.outcome,'cancelled');
});

test('ACP incomplete output and storage failure do not become success or launch unauthorized prompts',async t=>{
  const cwd=fixture(t),connection=peer((frame,child)=>{if(frame.method==='session/new')child.send({id:frame.id,result:{sessionId:'owned'}});});const adapter=remote(cwd,connection,{onThread:()=>{throw Error('no persistence');}});t.after(()=>adapter.close());
  await assert.rejects(adapter.prompt({text:'go'}),{code:'thread_storage_failed'});assert.equal(connection.frames.some(frame=>frame.method==='session/prompt'),false);
});

test('startup banners are discarded only before the first protocol frame',async t=>{
  const cwd=fixture(t),connection=peer();const original=connection.spawnImpl;
  connection.spawnImpl=(...args)=>{const child=original(...args);child.stdout.write('native startup banner\n');return child;};
  const adapter=remote(cwd,connection,{allowStartupPreamble:true});t.after(()=>adapter.close());await adapter.ready();
  connection.child.stdout.write('unexpected protocol output\n');assert.equal(connection.child.exitCode,-1);
});

test('Shell与MCP默认关闭，启用后完整展示且拒绝扩权、后台、秘密和未选服务',t=>{
  const cwd=fixture(t),shell={title:'Bash',rawInput:{command:'printf hello',timeout:1000}},mcp={title:'mcp__docs__search',rawInput:{query:'README'}};
  assert.equal(reviewRemoteTool(cwd,'workspace-write',shell),null);assert.equal(reviewRemoteTool(cwd,'workspace-write',mcp),null);
  const toolPolicy={shell:true,mcp:true,mcpServerIds:['docs']},command=reviewRemoteTool(cwd,'read-only',shell,{toolPolicy});
  assert.equal(command.kind,'command');assert.match(command.summary,/printf hello/);assert.ok(command.summary.includes(cwd));assert.match(command.summary,/1000/);assert.equal(reviewRemoteTool(cwd,'read-only',mcp,{toolPolicy}).kind,'mcp');
  for(const rawInput of [{command:'echo hidden',dangerouslyDisableSandbox:true},{command:'echo hidden',run_in_background:true},{command:'echo hidden',sandbox_permissions:'require_escalated'},{command:'echo hidden',cwd:'../'},{command:'echo hidden',extra:true},{command:'echo '+ 'x'.repeat(3000)}])assert.equal(reviewRemoteTool(cwd,'workspace-write',{title:'Bash',rawInput},{toolPolicy}),null);
  assert.equal(reviewRemoteTool(cwd,'workspace-write',{title:'mcp__foreign__search',rawInput:{}},{toolPolicy}),null);
  assert.equal(reviewRemoteTool(cwd,'workspace-write',{title:'mcp__docs__search',rawInput:{nested:{accessToken:'do-not-display'}}},{toolPolicy}),null);
});

test('启用工具的会话只恢复同一toolScope，旧files会话不会跟着提权',async t=>{
  const cwd=fixture(t),toolPolicy={shell:true,mcp:false,mcpServerIds:[]},scope=remoteToolScope(toolPolicy),connection=peer();
  const adapter=remote(cwd,connection,{toolPolicy,managedThreads:[{id:'old-files',cwd,permission:'read-only'},{id:'tool-session',cwd,permission:'read-only',toolScope:scope}]});t.after(()=>adapter.close());
  assert.deepEqual((await adapter.listThreads()).items.map(item=>item.id),['tool-session']);assert.equal(adapter.toolScope,scope);assert.equal(adapter.capabilities.shell,true);await assert.rejects(adapter.prompt({text:'continue',threadId:'old-files'}),{code:'thread_not_managed'});
});

for(const tool of [{title:'Bash',rawInput:{command:'printf synthetic'}},{title:'mcp__docs__search',rawInput:{query:'synthetic'}}]){
  test(tool.title+' 执行前必须逐次确认，拒绝/取消/超时不会调用工具',async t=>{
    for(const action of ['accept','decline','cancel','timeout']){
      const cwd=fixture(t);let approval,promptId,executions=0;
      const connection=peer((frame,child)=>{
        if(frame.method==='session/new')child.send({id:frame.id,result:{sessionId:'owned'}});
        if(frame.method==='session/prompt'){promptId=frame.id;child.send({method:'session/update',params:{sessionId:'owned',update:{sessionUpdate:'tool_call',toolCallId:'tool-call',...tool}}});child.send({id:'tool-permission',method:'session/request_permission',params:{sessionId:'owned',toolCall:{toolCallId:'tool-call'},options:[{kind:'allow_always',optionId:'always'},{kind:'allow_once',optionId:'once'}]}});}
        if(frame.id==='tool-permission'&&frame.result){if(frame.result.outcome.outcome==='selected')executions++;if(['accept','decline'].includes(action)){child.send({method:'session/update',params:{sessionId:'owned',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:executions?'executed':'declined'}}}});child.send({id:promptId,result:{stopReason:'end_turn'}});}}
        if(frame.method==='session/cancel')child.send({id:promptId,result:{stopReason:'cancelled'}});if(frame.method==='session/close')child.send({id:frame.id,result:{}});
      });
      const adapter=remote(cwd,connection,{toolPolicy:{shell:true,mcp:true,mcpServerIds:['docs']},mcpRevision:'synthetic-revision',approvalTimeoutMs:30,onEvent:event=>{if(event.type==='approval')approval=event;}});t.after(()=>adapter.close());
      const result=adapter.prompt({text:'run'});while(!approval)await next();assert.equal(executions,0,'no execution before approval');assert.equal(approval.kind,tool.title==='Bash'?'command':'mcp');
      if(action==='accept'||action==='decline')await adapter.approve({approvalId:approval.id,decision:action});else if(action==='cancel')await adapter.cancel();
      if(action==='timeout')await assert.rejects(result,{code:'approval_timeout'});else await result;
      assert.equal(executions,action==='accept'?1:0);await assert.rejects(adapter.approve({approvalId:approval.id,decision:'accept'}),{code:'stale_approval'});
    }
  });
}
