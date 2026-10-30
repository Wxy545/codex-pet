import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readCodexMcpCatalog,createCodexMcpProxy} from '../src/codex-mcp.mjs';
import {createCodexRemoteTools} from '../src/codex-remote-tools.mjs';

async function fixture(t){const root=await mkdtemp(join(tmpdir(),'pet-codex-mcp-test-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const entry=extra=>({command:'synthetic-command',args:['synthetic-argument'],env:{SYNTHETIC_API_TOKEN:'not-for-display'},...extra});
const tool={name:'echo',description:'Echo synthetic input',inputSchema:{type:'object',properties:{text:{type:'string',default:'not-for-display'}},additionalProperties:false}};
function serverFixture(){const calls=[];let closes=0;const server={async ready(){calls.push({method:'initialize'});},async request(method,params){calls.push({method,params});if(method==='thread/start')return{thread:{id:'owned-mcp-thread'}};if(method==='mcpServerStatus/list')return{data:[{name:params.serverName,tools:{echo:tool}}],nextCursor:null};if(method==='mcpServer/tool/call')return{result:{content:[{type:'text',text:'synthetic-result'}]}};},async close(){closes++;}};return{server,calls,get closes(){return closes;}};}

test('JSON/JSONC/TOML目录纯离线白名单投影，停用项过滤且不回传配置和环境值',async t=>{
 const root=await fixture(t),json=join(root,'mcp.jsonc');await writeFile(json,'// local only\n'+JSON.stringify({mcpServers:{chosen:entry(),off:entry({enabled:false}),disabled:entry({disabled:true}),http:{url:'https://example.invalid/private?secret=not-for-display'}}}));
 const result=await readCodexMcpCatalog({sourcePath:json});assert.equal(result.state,'ready');assert.deepEqual(result.servers.map(s=>s.label),['chosen','http']);assert.doesNotMatch(JSON.stringify(result),/not-for-display|synthetic-command|SYNTHETIC_API_TOKEN|https:/);assert.deepEqual(Object.keys(result.servers[0]).sort(),['id','label','transport']);
 const toml=join(root,'config.toml');await writeFile(toml,'[mcp_servers.chosen]\ncommand="synthetic-command"\n[mcp_servers.chosen.env]\nSYNTHETIC_API_TOKEN="not-for-display"\n');const catalog=await readCodexMcpCatalog({sourcePath:toml});assert.equal(catalog.state,'ready');assert.equal(catalog.servers.length,1);assert.doesNotMatch(JSON.stringify(catalog),/not-for-display|synthetic-command/);
});

test('无MCP配置是稳定空目录，换来源即使内容相同也产生不同指纹，auth和硬链源拒绝',async t=>{
 const root=await fixture(t),first=join(root,'a.toml'),second=join(root,'b.toml');await writeFile(first,'model="synthetic"\n');await writeFile(second,'model="synthetic"\n');
 const a=await readCodexMcpCatalog({sourcePath:first}),again=await readCodexMcpCatalog({sourcePath:first}),b=await readCodexMcpCatalog({sourcePath:second});assert.equal(a.state,'ready');assert.deepEqual(a.servers,[]);assert.equal(a.revision,again.revision);assert.notEqual(a.revision,b.revision);
 assert.equal((await readCodexMcpCatalog({sourcePath:join(root,'auth.json')})).code,'invalid_mcp_source');const linked=join(root,'linked.toml');await link(first,linked);assert.equal((await readCodexMcpCatalog({sourcePath:linked})).state,'unknown');
});

test('授权后原生thread仅传selected配置，主模型spec不含transport密钥，源改变后0工具调用',async t=>{
 const root=await fixture(t),source=join(root,'mcp.json');await writeFile(source,JSON.stringify({mcpServers:{chosen:entry(),other:entry()}}));const catalog=await readCodexMcpCatalog({sourcePath:source}),f=serverFixture();
 const proxy=await createCodexMcpProxy({catalog,selectedIds:[catalog.servers[0].id],cwd:root,createServer:()=>f.server});t.after(()=>proxy.close());
 const start=f.calls.find(call=>call.method==='thread/start');assert.deepEqual(Object.keys(start.params.config.mcp_servers),['chosen']);assert.equal(f.calls.some(call=>call.method==='turn/start'),false);assert.doesNotMatch(JSON.stringify(proxy.specs),/not-for-display|SYNTHETIC_API_TOKEN|synthetic-command|default/);
 const response=await proxy.call(proxy.specs[0].name,{text:'hi'});assert.equal(response.content[0].text,'synthetic-result');assert.equal(f.calls.filter(call=>call.method==='mcpServer/tool/call').length,1);
 await writeFile(source,(await readFile(source,'utf8'))+'\n');await assert.rejects(proxy.call(proxy.specs[0].name,{text:'again'}),{code:'mcp_source_changed'});assert.equal(f.calls.filter(call=>call.method==='mcpServer/tool/call').length,1);
});

test('初始化ready或目录分页未返回时取消立即关闭自有server，迟到回复不继续初始化',async t=>{
 for(const held of ['ready','catalog']){
  const root=await fixture(t),source=join(root,'mcp.json');await writeFile(source,JSON.stringify({mcpServers:{chosen:entry(),other:entry()}}));const catalog=await readCodexMcpCatalog({sourcePath:source}),controller=new AbortController(),calls=[];let release,rejectHeld,closes=0;
  const hold=()=>new Promise((resolve,reject)=>{release=resolve;rejectHeld=reject;});
  const server={ready(){calls.push('ready');return held==='ready'?hold():Promise.resolve();},async request(method,params){calls.push(method);if(method==='thread/start')return{thread:{id:'owned'}};if(method==='mcpServerStatus/list')return hold();},async close(){closes++;rejectHeld?.(Object.assign(Error('closed'),{code:'mcp_proxy_closed'}));}};
  const promise=createCodexMcpProxy({catalog,selectedIds:catalog.servers.map(s=>s.id),cwd:root,createServer:()=>server,signal:controller.signal});promise.catch(()=>{});
  while(!release)await new Promise(done=>setImmediate(done));controller.abort();await assert.rejects(promise);const count=calls.length;release({data:[]});await new Promise(done=>setImmediate(done));assert.ok(closes>=1);assert.equal(calls.length,count);assert.equal(calls.includes('mcpServer/tool/call'),false);
 }
});

test('Shell执行前再次核实cwd，审批期间变成junction时不发送任何command RPC',async t=>{
 const root=await fixture(t),cwd=join(root,'project'),sub=join(cwd,'sub'),outside=join(root,'outside');await mkdir(sub,{recursive:true});await mkdir(outside);const tools=await createCodexRemoteTools({cwd,permission:'workspace-write',toolPolicy:{shell:true,mcp:false,mcpServerIds:[]}});t.after(()=>tools.close());
 const call=tools.prepare('qq_shell',{command:'echo synthetic',cwd:sub});await rm(sub,{recursive:true});const{symlink}=await import('node:fs/promises');await symlink(outside,sub,'junction');let requests=0;
 await assert.rejects(tools.execute(call,async()=>{requests++;},{cancelRequested:false}),{code:'invalid_tool_directory'});assert.equal(requests,0);
});

test('Shell使用原生受限command/exec，拒绝隐藏参数、越根和疑似凭据，取消仅终止自有processId',async t=>{
 const root=await fixture(t),tools=await createCodexRemoteTools({cwd:root,permission:'read-only',toolPolicy:{shell:true,mcp:false,mcpServerIds:[]}});t.after(()=>tools.close());
 for(const args of [{command:'echo ok',extra:true},{command:'api_key=synthetic-secret'},{command:'echo ok',cwd:'..'}])assert.throws(()=>tools.prepare('qq_shell',args));
 let resolveCommand;const calls=[],run={cancelRequested:false},call=tools.prepare('qq_shell',{command:'echo synthetic'});
 const request=(method,params)=>{calls.push({method,params});if(method==='command/exec')return new Promise(resolve=>{resolveCommand=resolve;});return Promise.resolve({});};
 const execution=tools.execute(call,request,run);await new Promise(done=>setImmediate(done));assert.equal(calls[0].method,'command/exec');assert.equal(calls[0].params.permissionProfile,':read-only');assert.equal(calls[0].params.tty,false);assert.equal(calls.some(c=>c.method==='thread/shellCommand'),false);
 run.cancelRequested=true;await tools.cancel(run);assert.equal(calls.at(-1).method,'command/exec/terminate');assert.equal(calls.at(-1).params.processId,calls[0].params.processId);resolveCommand({exitCode:0,stdout:'late'});assert.equal((await execution).success,false);
});
