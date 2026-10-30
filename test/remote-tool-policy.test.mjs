import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRemoteToolPolicy,remoteToolScope} from '../src/remote-tool-policy.mjs';

test('旧配置默认关闭命令和MCP，工具策略不能夹带执行参数或重复服务',()=>{
 assert.deepEqual(normalizeRemoteToolPolicy(),{shell:false,mcp:false,mcpServerIds:[]});assert.equal(remoteToolScope(),'files');
 for(const value of [{shell:true,mcp:false,mcpServerIds:['x']},{shell:false,mcp:true,mcpServerIds:[]},{shell:false,mcp:true,mcpServerIds:['x','x']},{shell:false,mcp:true,mcpServerIds:['https://outside.invalid']},{shell:true,mcp:false,mcpServerIds:[],command:'whoami'}])assert.throws(()=>normalizeRemoteToolPolicy(value),{code:'invalid_tool_policy'});
});

test('工具会话范围绑定开启项、服务和配置修订，编号排序不会制造不同范围',()=>{
 const a={shell:false,mcp:true,mcpServerIds:['b','a']},b={shell:false,mcp:true,mcpServerIds:['a','b']};
 assert.equal(remoteToolScope(a,'rev1'),remoteToolScope(b,'rev1'));
 assert.notEqual(remoteToolScope(a,'rev1'),remoteToolScope(a,'rev2'));
 assert.notEqual(remoteToolScope(a,'rev1'),remoteToolScope({...a,shell:true},'rev1'));
 assert.throws(()=>remoteToolScope(a),{code:'invalid_tool_policy'});
});
