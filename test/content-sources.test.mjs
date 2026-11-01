import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createContentSources} from '../src/content-sources.mjs';

async function directory(t){const root=await mkdtemp(join(tmpdir(),'pet-content-source-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('内容服务离线目录不启动执行器，绑定票据按宿主/修订校验并持久保存',async t=>{
 const root=await directory(t);let starts=0,revision='revision-1';const parameters={dataRoot:root,projectRoot:root,resolveTarget:async()=>({codexPath:'synthetic-codex'}),readCatalog:async()=>({state:'ready',revision,sourcePath:join(root,'mcp.json'),servers:[{id:'safe-server',label:'合成服务',transport:'stdio'}]}),createCodexProxy:async()=>{starts++;return{specs:[{name:'hashed-tool'}],describe:()=>({tool:'bili_recommend'}),call:async(name,args)=>({structuredContent:{items:[{text:'合成读取',args}]}}),close:async()=>{}};}};
 const sources=await createContentSources(parameters);t.after(()=>sources.dispose());const first=await sources.catalog({host:'codex'});assert.equal(starts,0);assert.equal(JSON.stringify(first).includes(root),false);
 await assert.rejects(sources.bind({...first,host:'workbuddy',serverId:'safe-server'}),{code:'content_source_invalid'});
 const selection={host:'codex',sourceId:first.sourceId,revision:first.revision,serverId:'safe-server'};const second=await sources.catalog({host:'codex'});await assert.rejects(sources.bind(selection),{code:'content_source_stale'});
 const saved=await sources.bind({...selection,sourceId:second.sourceId});const response=await sources.callPlatformTool({...saved,host:'codex',tool:'bili_recommend',arguments:{ps:2}});assert.equal(starts,1);assert.equal(response.structuredContent.items[0].text,'合成读取');await sources.dispose();
 const reopened=await createContentSources(parameters);t.after(()=>reopened.dispose());await reopened.callPlatformTool({...saved,host:'codex',tool:'bili_recommend',arguments:{ps:2}});assert.equal(starts,2);revision='revision-2';await assert.rejects(reopened.callPlatformTool({...saved,host:'codex',tool:'bili_recommend',arguments:{ps:2}}),{code:'content_scope_changed'});assert.equal(starts,2);
});

test('WorkBuddy来源使用本宿主配置启动真实合成stdio MCP，不借Codex模型或账号',async t=>{
 const root=await directory(t),script=join(root,'synthetic-mcp.cjs'),config=join(root,'mcp.json');
 await writeFile(script,`const readline=require('node:readline');const r=readline.createInterface({input:process.stdin});r.on('line',line=>{const p=JSON.parse(line);if(!p.id)return;const result=p.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}}:p.method==='tools/list'?{tools:[{name:'bili_recommend',inputSchema:{type:'object',properties:{ps:{type:'integer'}}}}]}:{content:[{type:'text',text:JSON.stringify({items:[{text:'合成协议结果',count:p.params.arguments.ps}]})}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:p.id,result})+'\\n');});`);
 await writeFile(config,JSON.stringify({mcpServers:{content:{command:process.execPath,args:[script],env:{SYNTHETIC_CONTENT:'1'}}}}));
 const sources=await createContentSources({dataRoot:root,projectRoot:root,resolveTarget:async host=>{assert.equal(host,'workbuddy');return{configDir:root};}});t.after(()=>sources.dispose());const catalog=await sources.catalog({host:'workbuddy',sourcePath:config});assert.equal(catalog.state,'ready');const saved=await sources.bind({host:'workbuddy',sourceId:catalog.sourceId,revision:catalog.revision,serverId:catalog.items[0].id});const response=await sources.callPlatformTool({...saved,host:'workbuddy',tool:'bili_recommend',arguments:{ps:3}});assert.equal(JSON.parse(response.content[0].text).items[0].count,3);
 await assert.rejects(sources.callPlatformTool({...saved,host:'workbuddy',tool:'shell_exec',arguments:{}}),{code:'content_tool_unconfigured'});
});
