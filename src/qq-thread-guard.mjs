import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,join,relative,resolve,sep,extname} from 'node:path';
import {transitionFor} from './codex-events.mjs';

const HEADER_BYTES=64*1024,TAIL_BYTES=512*1024;
const key=value=>process.platform==='win32'?value.toLowerCase():value;
const samePath=(left,right)=>key(left)===key(right);
const inside=(root,file)=>{const value=relative(root,file);return value!==''&&!isAbsolute(value)&&value!=='..'&&!value.startsWith('..'+sep);};
const sameStat=(left,right)=>['dev','ino','size','mtimeNs','ctimeNs','nlink'].every(field=>left[field]===right[field]);
const regular=value=>value.isFile()&&!value.isSymbolicLink()&&value.nlink===1n;
const stateType=value=>typeof value==='string'?value:value&&typeof value==='object'&&!Array.isArray(value)?value.type:undefined;

async function directory(path){const info=await fs.lstat(path);return info.isDirectory()&&!info.isSymbolicLink();}
async function safePath(home,sessions,file){
 if(!await directory(home)||!await directory(sessions)||!inside(sessions,file))return false;
 const parts=relative(sessions,file).split(sep);let current=sessions;
 for(const part of parts.slice(0,-1)){current=join(current,part);if(!await directory(current))return false;}
 const actualHome=await fs.realpath(home),actualSessions=await fs.realpath(sessions),actualFile=await fs.realpath(file);
 return inside(actualHome,actualSessions)&&samePath(actualSessions,join(actualHome,'sessions'))&&inside(actualSessions,actualFile)&&samePath(actualFile,join(actualSessions,...parts));
}
async function readBytes(handle,position,length){
 const bytes=Buffer.alloc(length);let offset=0;
 while(offset<length){const read=await handle.read(bytes,offset,length-offset,position+offset);if(!read.bytesRead)break;offset+=read.bytesRead;}
 return offset===length?bytes:undefined;
}
function metadata(record,threadId,cwd){
 return record&&record.type==='session_meta'&&record.payload&&record.payload.id===threadId&&typeof record.payload.cwd==='string'&&isAbsolute(record.payload.cwd)&&samePath(resolve(record.payload.cwd),cwd);
}

/** 只读取官方线程路径的有界首尾；返回值仅表示本次观测，不充当跨进程锁。 */
export function createQQThreadGuard({codexHome}={}){
 if(typeof codexHome!=='string'||!isAbsolute(codexHome))throw new TypeError('absolute-codex-home-required');
 const home=resolve(codexHome),sessions=join(home,'sessions');
 return async function canUseThread({threadId,logPath,cwd,status}={}){
  const official=stateType(status);if(official==='active')return false;
  if(!['idle','notLoaded'].includes(official)||typeof threadId!=='string'||! /^[A-Za-z0-9_-]{1,256}$/.test(threadId)||typeof logPath!=='string'||!isAbsolute(logPath)||extname(logPath).toLowerCase()!=='.jsonl'||typeof cwd!=='string'||!isAbsolute(cwd))return undefined;
  const file=resolve(logPath);let handle;
  try{
   if(!await safePath(home,sessions,file))return undefined;
   const project=await fs.realpath(cwd);if(!(await fs.stat(project)).isDirectory())return undefined;
   const before=await fs.lstat(file,{bigint:true});if(!regular(before)||before.size<1n||before.size>BigInt(Number.MAX_SAFE_INTEGER))return undefined;
   handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
   const opened=await handle.stat({bigint:true});if(!regular(opened)||!sameStat(before,opened))return undefined;
   const size=Number(opened.size),header=await readBytes(handle,0,Math.min(size,HEADER_BYTES));if(!header)return undefined;
   const headerEnd=header.indexOf(10);if(headerEnd<0)return undefined;
   let first;try{first=JSON.parse(header.subarray(0,headerEnd).toString('utf8').replace(/^\uFEFF/,''));}catch{return undefined;}
   // 不按日志中自报的任意路径做文件查询；它必须与已核实项目的规范路径完全对应。
   if(!metadata(first,threadId,project)||await fs.realpath(first.payload.cwd)!==project)return undefined;
   const start=Math.max(0,size-TAIL_BYTES),tail=await readBytes(handle,start,size-start);if(!tail)return undefined;
   let offset=start===0?0:tail.indexOf(10)+1,latest,uncertain=false;
   if(start>0&&offset===0)return undefined;
   for(;;){
    const end=tail.indexOf(10,offset);if(end<0)break;
    const lineStart=offset,line=tail.subarray(offset,end);offset=end+1;if(!line.length)continue;
    let record;try{const text=line.toString('utf8');record=JSON.parse(start===0&&lineStart===0?text.replace(/^\uFEFF/,''):text);}catch{uncertain=true;continue;}
    if(!record||typeof record!=='object'||Array.isArray(record)){uncertain=true;continue;}
    if(record.type==='session_meta'&&(!metadata(record,threadId,project)||record.payload.cwd!==first.payload.cwd))return undefined;
    const next=record&&typeof record==='object'?transitionFor(record):undefined;
    if(typeof next?.active==='boolean'){latest=next.active;uncertain=false;}
   }
   const incomplete=offset<tail.length;
   const after=await handle.stat({bigint:true}),current=await fs.lstat(file,{bigint:true});
   if(!regular(after)||!regular(current)||!sameStat(opened,after)||!sameStat(opened,current)||!await safePath(home,sessions,file))return undefined;
   // 活动证据足以拒绝；完成证据后的坏行或半行不能被当作空闲。
   if(latest===true)return false;
   if(uncertain||incomplete)return undefined;
   if(latest===false)return true;
   return start===0?true:undefined;
  }catch{return undefined;}finally{await handle?.close().catch(()=>{});}
 };
}
