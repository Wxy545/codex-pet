import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQQThreadGuard} from '../src/qq-thread-guard.mjs';

const line=(type,payload)=>JSON.stringify({timestamp:'2026-01-01T00:00:00Z',type,payload})+'\n';
const event=(type,fields={})=>line('event_msg',{type,...fields});
const header=(id,cwd)=>line('session_meta',{id,cwd});
async function fixture(t,body=''){
 const root=await fs.mkdtemp(join(tmpdir(),'qq-thread-guard-')),codexHome=join(root,'codex'),cwd=join(root,'project'),sessions=join(codexHome,'sessions'),folder=join(sessions,'2026','01','01'),file=join(folder,'synthetic.jsonl');
 await fs.mkdir(folder,{recursive:true});await fs.mkdir(cwd);const canonicalCwd=await fs.realpath(cwd),threadId='synthetic-thread';
 await fs.writeFile(file,header(threadId,canonicalCwd)+body);
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const guard=createQQThreadGuard({codexHome}),input={threadId,logPath:file,cwd,status:{type:'idle'}};
 return{root,codexHome,cwd:canonicalCwd,sessions,folder,file,guard,input,check:overrides=>guard({...input,...overrides})};
}

test('官方活动状态直接拒绝，不需要读取日志；未知官方状态不放行',async t=>{
 const f=await fixture(t,event('task_complete'));
 assert.equal(await f.guard({status:{type:'active',activeFlags:['waitingOnApproval']}}),false);
 assert.equal(await f.check({status:'active'}),false);
 for(const status of [undefined,null,'error',{type:'systemError'},{type:'unknown'}])assert.equal(await f.check({status}),undefined);
});

test('完整新会话及确定终态可用，活动、工具、最终答复和等待均保持占用',async t=>{
 const f=await fixture(t);assert.equal(await f.check(),true);assert.equal(await f.check({status:{type:'notLoaded'}}),true);
 for(const body of [event('task_started'),event('request_user_input'),line('response_item',{type:'function_call',name:'exec_command',arguments:'SYNTHETIC_PRIVATE_TEXT'}),line('response_item',{type:'message',role:'assistant',phase:'final_answer'})]){
  await fs.writeFile(f.file,header(f.input.threadId,f.cwd)+body);assert.equal(await f.check(),false);
 }
 for(const terminal of ['task_complete','turn_aborted','turn_failed']){
  await fs.writeFile(f.file,header(f.input.threadId,f.cwd)+event('task_started')+event(terminal));assert.equal(await f.check(),true);
 }
 await fs.appendFile(f.file,event('task_started'));assert.equal(await f.check(),false);
});

test('只按实际记录顺序归约，不按日志年龄或最终答复推断任务完成',async t=>{
 const f=await fixture(t,event('task_complete')+event('task_started'));
 await fs.utimes(f.file,new Date('2000-01-01'),new Date('2000-01-01'));assert.equal(await f.check(),false);
 await fs.appendFile(f.file,line('response_item',{type:'message',role:'assistant',phase:'final_answer'}));assert.equal(await f.check(),false);
 await fs.appendFile(f.file,event('task_complete'));assert.equal(await f.check(),true);
});

test('首行必须绑定同一个会话和规范项目，冒名、坏头、空文件均未知',async t=>{
 const f=await fixture(t,event('task_complete'));
 for(const first of [header('different-thread',f.cwd),header(f.input.threadId,join(f.root,'other')),line('session_meta',{id:f.input.threadId}),line('event_msg',{type:'task_complete'}),'not-json\n','']){
  await fs.writeFile(f.file,first);assert.equal(await f.check(),undefined);
 }
 await fs.writeFile(f.file,header(f.input.threadId,f.cwd)+header('other-thread',f.cwd)+event('task_complete'));assert.equal(await f.check(),undefined);
});

test('越出sessions、错误后缀、目录和硬链接均未知，不读取其它文件',async t=>{
 const f=await fixture(t,event('task_complete')),outside=join(f.root,'outside.jsonl');await fs.writeFile(outside,header(f.input.threadId,f.cwd)+event('task_complete'));
 assert.equal(await f.check({logPath:outside}),undefined);assert.equal(await f.check({logPath:join(f.folder,'not-json.txt')}),undefined);
 assert.equal(await f.check({logPath:f.folder+'.jsonl'}),undefined);assert.equal(await f.check({logPath:'relative.jsonl'}),undefined);
 const linked=join(f.folder,'hard.jsonl');await fs.link(outside,linked);assert.equal(await f.check({logPath:linked}),undefined);
});

test('拒绝目录链接，即使目标日志的元数据与项目完全相同',async t=>{
 const f=await fixture(t,event('task_complete')),outside=join(f.root,'outside');await fs.mkdir(outside);await fs.writeFile(join(outside,'linked.jsonl'),header(f.input.threadId,f.cwd)+event('task_complete'));
 const linked=join(f.sessions,'linked');await fs.symlink(outside,linked,process.platform==='win32'?'junction':'dir');assert.equal(await f.check({logPath:join(linked,'linked.jsonl')}),undefined);
});

test('拒绝文件符号链接',async t=>{
 const f=await fixture(t,event('task_complete')),link=join(f.folder,'symbolic.jsonl');
 try{await fs.symlink(f.file,link,'file');}catch(error){if(process.platform==='win32'&&['EPERM','EACCES'].includes(error.code)){t.skip('Windows未授予创建文件符号链接权限，目录junction另有实际检查');return;}throw error;}
 assert.equal(await f.check({logPath:link}),undefined);
});

test('尾部截断时必须找到确定状态，首行和尾部读取有固定上限',async t=>{
 const f=await fixture(t),padding=line('response_item',{type:'message',role:'user',content:'x'.repeat(700*1024)}),reads=[],open=fs.open;
 await fs.writeFile(f.file,header(f.input.threadId,f.cwd)+padding);
 t.mock.method(fs,'open',async(...args)=>{const handle=await open(...args),read=handle.read.bind(handle);handle.read=async(buffer,offset,length,position)=>{reads.push({length,position});return read(buffer,offset,length,position);};return handle;});
 assert.equal(await f.check(),undefined);assert.ok(reads.every(item=>item.position===0?item.length<=64*1024:item.length<=512*1024));
 await fs.appendFile(f.file,event('task_started'));assert.equal(await f.check(),false);
 await fs.appendFile(f.file,event('task_complete'));assert.equal(await f.check(),true);
});

test('不完整尾或终态之后的坏行不误放行，已知活动证据仍可拒绝',async t=>{
 const f=await fixture(t,event('task_complete'));await fs.appendFile(f.file,'{"type":"event_msg","payload":{"type":"task_');assert.equal(await f.check(),undefined);
 await fs.writeFile(f.file,header(f.input.threadId,f.cwd)+event('task_started')+'{"unfinished":');assert.equal(await f.check(),false);
 await fs.writeFile(f.file,header(f.input.threadId,f.cwd)+event('task_complete')+'not-json\n');assert.equal(await f.check(),undefined);
 await fs.appendFile(f.file,event('task_complete'));assert.equal(await f.check(),true);
 await fs.writeFile(f.file,header(f.input.threadId,f.cwd).trimEnd());assert.equal(await f.check(),undefined);
});

test('读到一半追加、变更mtime或替换日志时返回未知，不接受混合快照',async t=>{
 for(const mutation of ['append','mtime','replace']){
  const f=await fixture(t,event('task_complete')),open=fs.open;let mutated=false;
  const mock=t.mock.method(fs,'open',async(...args)=>{
   const handle=await open(...args),read=handle.read.bind(handle);handle.read=async(...values)=>{
    const result=await read(...values);if(!mutated){mutated=true;if(mutation==='append')await fs.appendFile(f.file,event('task_started'));if(mutation==='mtime')await fs.utimes(f.file,new Date(),new Date(Date.now()+60000));if(mutation==='replace'){await fs.rename(f.file,f.file+'.old');await fs.writeFile(f.file,header(f.input.threadId,f.cwd)+event('task_complete'));}}return result;
   };return handle;
  });
  try{assert.equal(await f.check(),undefined,mutation);}finally{mock.mock.restore();}
 }
});

test('超长首行、发现文件缺失和非法工厂目录不泄漏错误正文',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file,line('session_meta',{id:f.input.threadId,cwd:f.cwd,padding:'x'.repeat(64*1024)}));assert.equal(await f.check(),undefined);
 await fs.unlink(f.file);assert.equal(await f.check(),undefined);
 assert.throws(()=>createQQThreadGuard({codexHome:'relative'}),/^TypeError: absolute-codex-home-required$/);
});
