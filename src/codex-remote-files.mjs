import {realpathSync,statSync,lstatSync,openSync,fstatSync,readSync,closeSync,opendirSync} from 'node:fs';
import {relative,resolve} from 'node:path';
import {remoteFile,remoteDirectory} from './acp-remote.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const output=value=>({success:true,contentItems:[{type:'inputText',text:JSON.stringify(value)}]});
const number=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;

/** Shell 关闭时仍能读取项目；目录与文件在准备、打开和返回前分别核对。 */
export function createCodexRemoteFiles({cwd}={}){
  const root=realpathSync(cwd);if(!statSync(root).isDirectory())fail('invalid_cwd');
  const specs=[
    {type:'function',name:'qq_read_file',description:'Read UTF-8 text from an authorized project file without Shell. Offset and limit are bytes. Sensitive files and links are excluded.',inputSchema:{type:'object',properties:{path:{type:'string'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:65536}},required:['path'],additionalProperties:false}},
    {type:'function',name:'qq_list_files',description:'List one authorized project directory without Shell. Offset counts directory entries; excluded private files and links are omitted.',inputSchema:{type:'object',properties:{path:{type:'string'},offset:{type:'integer',minimum:0,maximum:10000},limit:{type:'integer',minimum:1,maximum:200}},additionalProperties:false}},
  ];
  function rootReady(){if(realpathSync(root)!==root||!statSync(root).isDirectory())fail('invalid_tool_directory');}
  function check(name,input){
    rootReady();if(!object(input)||Object.keys(input).some(key=>!['path','offset','limit'].includes(key)))fail('invalid_tool_arguments');
    const value=input.path??(name==='qq_list_files'?'.':undefined);
    if(typeof value!=='string'||!value||value.length>4096||/[\u0000-\u001f\u007f*?]/.test(value))fail('invalid_tool_arguments');
    const path=resolve(root,value),offset=input.offset??0,limit=input.limit??(name==='qq_read_file'?32768:100);
    if(!number(offset,name==='qq_read_file'?Number.MAX_SAFE_INTEGER:10000)||!number(limit,name==='qq_read_file'?65536:200)||!limit)fail('invalid_tool_arguments');
    if(name==='qq_read_file'?!remoteFile(root,path,{mustExist:true}):!remoteDirectory(root,path)||realpathSync(path)!==path)fail('outside_remote_scope');
    return{path,offset,limit};
  }
  function prepare(name,input){if(!specs.some(spec=>spec.name===name))return null;return{kind:'read',name,input:check(name,input)};}
  function execute(call){
    if(!call||!specs.some(spec=>spec.name===call.name))fail('tool_not_authorized');
    const input=check(call.name,call.input),path=relative(root,input.path)||'.';
    if(call.name==='qq_list_files'){
      const directory=opendirSync(input.path),entries=[];let count=0,item,more=false;
      try{
        while((item=directory.readSync())){
          if(count++<input.offset)continue;
          if(count>input.offset+input.limit){more=true;break;}
          const candidate=resolve(input.path,item.name);
          // 不将敏感名称、链接或硬链接通过目录输出交给模型。
          if(item.isFile()&&remoteFile(root,candidate,{mustExist:true}))entries.push({name:item.name,type:'file'});
          else if(item.isDirectory()&&remoteDirectory(root,candidate)&&realpathSync(candidate)===candidate)entries.push({name:item.name,type:'directory'});
        }
        check(call.name,input);return output({path,entries,...(more?{nextOffset:input.offset+input.limit}:{})});
      }finally{directory.closeSync();}
    }
    const before=lstatSync(input.path),handle=openSync(input.path,'r');
    try{
      const opened=fstatSync(handle);if(!opened.isFile()||opened.nlink!==1||opened.ino!==before.ino||opened.dev!==before.dev)fail('outside_remote_scope');
      const buffer=Buffer.alloc(input.limit),bytes=readSync(handle,buffer,0,input.limit,input.offset),chunk=buffer.subarray(0,bytes);
      if(chunk.includes(0))fail('binary_file_unsupported');
      const after=fstatSync(handle),current=lstatSync(input.path);check(call.name,input);
      if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||current.ino!==opened.ino||current.dev!==opened.dev||current.nlink!==1||current.isSymbolicLink())fail('file_changed');
      return output({path,offset:input.offset,bytes,text:chunk.toString('utf8'),...(input.offset+bytes<opened.size?{nextOffset:input.offset+bytes}:{})});
    }finally{closeSync(handle);}
  }
  return{specs,prepare,execute};
}
