import {createHash} from 'node:crypto';

const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const fail=()=>{throw Object.assign(Error('invalid_tool_policy'),{code:'invalid_tool_policy'});};

/** 文件权限、命令和外部工具分开授权；只接受本机保存的开关及服务标识。 */
export function normalizeRemoteToolPolicy(value){
 if(value===undefined||value===null)return{shell:false,mcp:false,mcpServerIds:[]};
 if(!record(value)||Object.keys(value).some(key=>!['shell','mcp','mcpServerIds'].includes(key))||typeof value.shell!=='boolean'||typeof value.mcp!=='boolean'||!Array.isArray(value.mcpServerIds)||value.mcpServerIds.length>32||value.mcpServerIds.some(item=>!id(item))||new Set(value.mcpServerIds).size!==value.mcpServerIds.length)fail();
 if(!value.mcp&&value.mcpServerIds.length||value.mcp&&!value.mcpServerIds.length)fail();
 return{shell:value.shell,mcp:value.mcp,mcpServerIds:[...value.mcpServerIds].sort()};
}

/** 默认档保持旧会话兼容；启用工具后，配置指纹变更会形成独立会话范围。 */
export function remoteToolScope(value,revision){
 const policy=normalizeRemoteToolPolicy(value);
 if(!policy.shell&&!policy.mcp)return'files';
 if(policy.mcp&&(typeof revision!=='string'||!revision||revision.length>256))fail();
 return'tools-'+createHash('sha256').update(JSON.stringify({policy,revision:policy.mcp?revision:null})).digest('hex').slice(0,32);
}
