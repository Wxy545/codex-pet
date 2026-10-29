import {readFile,lstat} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeHookInput} from '../hook-event.mjs';

async function jsonFile(file,max){const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw Error('invalid-hook-file');return JSON.parse(await readFile(file,'utf8'));}
/** 只使用桌宠自产的本机能力令牌；不查找WorkBuddy账号、会话正文或任何登录文件。 */
export async function reportHook({input,env=process.env,pluginRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),fetchImpl=fetch}={}){
  try{
    const event=normalizeHookInput(input,{env});if(!event||event.subagent)return false;
    const config=await jsonFile(join(pluginRoot,'connection.json'),16*1024);
    if(config.schemaVersion!==1||typeof config.appRoot!=='string'||!isAbsolute(config.appRoot))return false;
    const runtime=await jsonFile(join(config.appRoot,'data','dsh-pet','standalone-runtime.json'),16*1024);
    if(!Number.isInteger(runtime.port)||runtime.port<1||runtime.port>65535||typeof runtime.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(runtime.token))return false;
    const response=await fetchImpl(`http://127.0.0.1:${runtime.port}/dsh-pet-7340/workbuddy-events`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(750),headers:{'content-type':'application/json','x-dsh-pet-token':runtime.token},body:JSON.stringify(event)});
    await response.body?.cancel();return response.ok;
  }catch{return false;}
}
async function main(){
  let size=0,parts=[];
  try{for await(const part of process.stdin){size+=part.length;if(size>1024*1024)return;parts.push(part);}await reportHook({input:JSON.parse(Buffer.concat(parts).toString('utf8'))});}catch{/* 所有分支静默成功退出，不参与审批、不向模型注入上下文。 */}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
