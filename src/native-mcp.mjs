import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,fstatSync,closeSync,constants} from 'node:fs';
import {createRequire} from 'node:module';
import {basename,delimiter,dirname,isAbsolute,join,resolve} from 'node:path';
import {remoteError,isRecord,safeRemoteText} from './acp-remote.mjs';
import {parse as parseToml} from 'smol-toml';

const serverId=/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const privateName=/(?:auth|credential|account|session|token|secret)/i;
const plainFile=path=>{try{const info=lstatSync(path);return info.isFile()&&!info.isSymbolicLink()&&info.nlink===1;}catch{return false;}};
const string=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const pairs=value=>{
  if(value===undefined)return[];if(!isRecord(value)||Object.keys(value).length>64)throw remoteError('mcp_config_invalid');
  return Object.entries(value).map(([name,value])=>{if(!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(name)||!string(value,8192))throw remoteError('mcp_config_invalid');return{name,value};});
};
function commandPath(value){
  if(!string(value,4096)||!value)throw remoteError('mcp_config_invalid');if(isAbsolute(value)){if(!plainFile(value))throw remoteError('mcp_command_unavailable');return realpathSync(value);}
  if(/[\\/]/.test(value))throw remoteError('mcp_command_unavailable');
  const names=process.platform==='win32'&&!/\.[a-z]+$/i.test(value)?[value+'.exe',value+'.cmd',value+'.bat',value]:[value];
  for(const directory of String(process.env.PATH??process.env.Path??'').split(delimiter).filter(isAbsolute))for(const name of names){const path=join(directory,name);if(plainFile(path))return realpathSync(path);}
  throw remoteError('mcp_command_unavailable');
}
function descriptor(id,entry,originalName){
  if(!serverId.test(id)||!isRecord(entry)||entry.disabled===true)throw remoteError('mcp_config_invalid');
  // ACP 不能等价承载的限制和认证扩展必须拒收，不能丢掉源配置的限制后暴露全部工具。
  const supported=new Set(['command','args','env','type','transport','url','headers','http_headers','label','enabled','disabled','serverName']);
  if(Object.keys(entry).some(key=>!supported.has(key)))throw remoteError('mcp_fields_unsupported');
  if(entry.enabled!==undefined&&typeof entry.enabled!=='boolean'||entry.disabled!==undefined&&typeof entry.disabled!=='boolean'||entry.serverName!==undefined&&entry.serverName!==originalName)throw remoteError('mcp_config_invalid');
  if(entry.command&&entry.url)throw remoteError('mcp_config_invalid');
  const type=entry.type??entry.transport??(entry.command?'stdio':'http');
  if(entry.type!==undefined&&entry.transport!==undefined&&entry.type!==entry.transport&&![entry.type,entry.transport].every(value=>['http','streamable-http'].includes(value)))throw remoteError('mcp_config_invalid');
  if(type==='stdio'){
    if(entry.url!==undefined||entry.headers!==undefined||entry.http_headers!==undefined)throw remoteError('mcp_config_invalid');
    const command=commandPath(entry.command),args=entry.args??[];if(!Array.isArray(args)||args.length>64||args.some(value=>!string(value,8192)))throw remoteError('mcp_config_invalid');
    return{name:id,command,args:[...args],env:pairs(entry.env)};
  }
  if(entry.command!==undefined||entry.args!==undefined||entry.env!==undefined||entry.headers!==undefined&&entry.http_headers!==undefined)throw remoteError('mcp_config_invalid');
  if(!['http','streamable-http'].includes(type)||!string(entry.url,8192))throw remoteError('mcp_transport_unsupported');
  const url=new URL(entry.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw remoteError('mcp_config_invalid');
  return{type:'http',name:id,url:url.href,headers:pairs(entry.headers??entry.http_headers)};
}
function jsonc(source){
  let clean='',quoted=false,escaped=false;
  for(let index=0;index<source.length;index++){const char=source[index],next=source[index+1];
    if(quoted){clean+=char;if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"'){quoted=true;clean+=char;continue;}if(char==='/'&&next==='/'){while(index<source.length&&source[index]!=='\n')index++;clean+='\n';continue;}
    if(char==='/'&&next==='*'){const end=source.indexOf('*/',index+2);if(end<0)throw remoteError('mcp_config_invalid');index=end+1;clean+=' ';continue;}clean+=char;
  }
  let output='';quoted=false;escaped=false;
  for(let index=0;index<clean.length;index++){const char=clean[index];if(quoted){output+=char;if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}if(char==='"')quoted=true;
    if(char===','){let next=index+1;while(/\s/.test(clean[next]??'x'))next++;if(clean[next]==='}'||clean[next]===']')continue;}output+=char;
  }return JSON.parse(output);
}
function sourceRecord(path,validatePath){
  const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>1048576)throw remoteError('mcp_config_invalid');
  const canonical=realpathSync(path);validatePath(canonical);const handle=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const opened=fstatSync(handle);if(opened.ino!==before.ino||opened.dev!==before.dev||opened.nlink!==1)throw remoteError('mcp_config_changed');const source=readFileSync(handle,'utf8'),after=fstatSync(handle),current=lstatSync(path);
    if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||current.isSymbolicLink()||current.ino!==opened.ino||current.dev!==opened.dev||current.nlink!==1||current.size!==opened.size||current.mtimeMs!==opened.mtimeMs)throw remoteError('mcp_config_changed');return{canonical,source};
  }finally{closeSync(handle);}
}
function yamlParser(native){
  const anchors=[join(dirname(native.command),'../node_modules/@deepseek-ai/dsh/package.json'),join(dirname(native.command),'../@deepseek-ai/dsh/package.json'),join(dirname(native.command),'../package.json')];
  for(const anchor of anchors)try{const pkg=JSON.parse(readFileSync(anchor,'utf8'));if(pkg.name!=='@deepseek-ai/dsh'||pkg.version!==native.version)continue;return createRequire(anchor)('yaml');}catch{}
  throw remoteError('mcp_config_format_unsupported');
}
function readEntries(source,path,host,native){
  if(/\.(?:jsonc?|toml)$/i.test(path)){const value=/\.toml$/i.test(path)?parseToml(source):jsonc(source.replace(/^\uFEFF/,'')),entries=value?.mcpServers??value?.mcp_servers;if(!isRecord(value)||!isRecord(entries))throw remoteError('mcp_config_invalid');return Object.entries(entries).filter(([,entry])=>entry?.disabled!==true&&entry?.enabled!==false);}
  if(host!=='harness'||!/^cordis\.patch\.ya?ml$/i.test(basename(path)))throw remoteError('mcp_config_format_unsupported');
  // 仅使用原生发行包携带的 YAML 数据解析器；不加载 Cordis、不执行 !!js 或其它自定义 tag。
  if(/!!js|!<|!\w/.test(source))throw remoteError('mcp_config_expression_unsupported');
  const parser=yamlParser(native),document=parser.parseDocument(source,{maxAliasCount:0});if(document.errors.length)throw remoteError('mcp_config_invalid');const value=document.toJS({maxAliasCount:0});if(!Array.isArray(value)||value.length>500)throw remoteError('mcp_config_invalid');
  const rows=[];for(const entry of value){const nested=Array.isArray(entry?.insert)?entry.insert:[entry];for(const row of nested)if(row?.name==='@deepseek-ai/dsh-mcp-client'&&row.disabled!==true){if(!isRecord(row.config))throw remoteError('mcp_config_invalid');rows.push([row.config.serverName,row.config]);}}
  return rows;
}

/** 只读本宿主专用 MCP 声明；headers/env 等私有描述只交给原生 ACP，不用于公开状态。 */
export function readNativeMcpCatalog({host,native,cwd,sourcePath}={}){
  if(!['workbuddy','harness'].includes(host)||!native)return{state:'not-installed',revision:null,sourcePath:null,servers:[],descriptors:[]};
  let selected;
  try{
    if(sourcePath!==undefined&&sourcePath!==null){if(!isAbsolute(sourcePath)||privateName.test(basename(sourcePath)))throw remoteError('mcp_config_invalid');selected=sourcePath;}
    else{
      const home=host==='workbuddy'?native.configDir:native.home;if(!isAbsolute(home??''))throw remoteError('mcp_config_invalid');
      const candidates=host==='workbuddy'?[join(home,'mcp.json'),join(home,'.mcp.json'),...(isAbsolute(cwd??'')?[join(cwd,'.mcp.json')]:[])]:[join(home,'profiles',native.profile,'mcp.json'),join(home,'profiles',native.profile,'.mcp.json'),join(home,'profiles',native.profile,'cordis.patch.yml')];
      selected=candidates.find(plainFile);if(!selected)return{state:'ready',revision:createHash('sha256').update(host+'\0'+home+'\0'+(native.profile??'')+'\0no-mcp-config').digest('hex'),sourcePath:null,servers:[],descriptors:[]};
    }
    if(!plainFile(selected)||lstatSync(selected).size>1048576)throw remoteError('mcp_config_invalid');
    const forbidden=host==='workbuddy'?/(?:^|[\\/])\.(?:codex|dsh)(?:[\\/]|$)/i:/(?:^|[\\/])\.(?:codex|workbuddy)(?:[\\/]|$)/i;
    const record=sourceRecord(selected,canonical=>{if(forbidden.test(canonical)||privateName.test(basename(canonical)))throw remoteError('mcp_wrong_application');});selected=record.canonical;
    const source=record.source,entries=readEntries(source,selected,host,native);if(entries.length>32)throw remoteError('mcp_config_invalid');
    const seen=new Set(),descriptors=[],servers=[];for(const [original,entry]of entries){
      if(!safeRemoteText(original,160)||!original||seen.has(original))throw remoteError('mcp_config_invalid');seen.add(original);
      const id=serverId.test(original)?original:'server-'+createHash('sha256').update(host+'\0'+selected+'\0'+original).digest('hex').slice(0,20);
      const acp=descriptor(id,entry,original),label=(safeRemoteText(entry.label,80)?entry.label:original).slice(0,80);descriptors.push(acp);servers.push({id,label,transport:'type'in acp?'http':'stdio'});
    }
    return{state:'ready',revision:createHash('sha256').update(host+'\0'+selected+'\0'+source).digest('hex'),sourcePath:selected,servers,descriptors};
  }catch(error){return{state:'unknown',reason:error.code??'mcp_config_invalid',revision:null,sourcePath:selected??null,servers:[],descriptors:[]};}
}

export function selectNativeMcp({host,native,cwd,sourcePath,revision,serverIds}={}){
  const catalog=readNativeMcpCatalog({host,native,cwd,sourcePath});if(catalog.state!=='ready')throw remoteError('mcp_catalog_unavailable');if(typeof revision!=='string'||catalog.revision!==revision)throw remoteError('mcp_config_changed');
  if(!Array.isArray(serverIds)||!serverIds.length||serverIds.some(id=>!catalog.servers.some(server=>server.id===id)))throw remoteError('mcp_server_unavailable');
  return catalog.descriptors.filter(server=>serverIds.includes(server.name));
}
