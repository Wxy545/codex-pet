import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rename,symlink,link,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodexRemoteFiles} from '../src/codex-remote-files.mjs';

async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'pet-qq-files-')));t.after(()=>rm(root,{recursive:true,force:true}));const project=join(root,'project'),outside=join(root,'outside');await mkdir(project);await mkdir(outside);return{root,project,outside,files:createCodexRemoteFiles({cwd:project})};}
const result=response=>JSON.parse(response.contentItems[0].text);

test('关闭Shell仍可有界读取及列目录，不执行命令，默认参数和分页有效',async t=>{
 const f=await fixture(t);await writeFile(join(f.project,'hello.txt'),'hello world');await writeFile(join(f.project,'.env'),'synthetic-local-only');await mkdir(join(f.project,'folder'));await mkdir(join(f.project,'.git'));
 assert.deepEqual(f.files.specs.map(s=>s.name),['qq_read_file','qq_list_files']);assert.equal(f.files.prepare('qq_shell',{}),null);
 const read=result(f.files.execute(f.files.prepare('qq_read_file',{path:'hello.txt',offset:6,limit:3})));assert.equal(read.text,'wor');assert.equal(read.nextOffset,9);
 const listing=result(f.files.execute(f.files.prepare('qq_list_files',{})));assert.deepEqual(listing.entries.map(e=>e.name).sort(),['folder','hello.txt']);assert.equal(await readFile(join(f.project,'.env'),'utf8'),'synthetic-local-only');
 const page=result(f.files.execute(f.files.prepare('qq_list_files',{limit:1})));assert.equal(page.nextOffset,1);
});

test('私有路径、越界、未知参数、二进制及硬链接均不能读取',async t=>{
 const f=await fixture(t);await writeFile(join(f.project,'auth.json'),'synthetic-private');await writeFile(join(f.outside,'hidden.txt'),'outside');await writeFile(join(f.project,'binary.bin'),Buffer.from([0,1,2]));await link(join(f.outside,'hidden.txt'),join(f.project,'hard.txt'));
 for(const path of ['auth.json','auth.json::$DATA','.env::$DATA','../outside/hidden.txt','hard.txt'])assert.throws(()=>f.files.prepare('qq_read_file',{path}),{code:'outside_remote_scope'});
 for(const input of [{path:'.',command:'pwd'},{path:'.',offset:-1},{path:'.',limit:201}])assert.throws(()=>f.files.prepare('qq_list_files',input),{code:'invalid_tool_arguments'});
 assert.throws(()=>f.files.execute(f.files.prepare('qq_read_file',{path:'binary.bin'})),{code:'binary_file_unsupported'});
 const listing=result(f.files.execute(f.files.prepare('qq_list_files',{})));assert.equal(listing.entries.some(e=>['auth.json','hard.txt'].includes(e.name)),false);
});

test('准备后项目子目录或根被换成junction时拒绝执行，外部内容不返回',async t=>{
 const f=await fixture(t),sub=join(f.project,'sub');await mkdir(sub);await writeFile(join(sub,'file.txt'),'inside');await writeFile(join(f.outside,'file.txt'),'outside');
 const call=f.files.prepare('qq_read_file',{path:'sub/file.txt'}),list=f.files.prepare('qq_list_files',{path:'sub'});
 await rename(sub,join(f.project,'original-sub'));await symlink(f.outside,sub,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>f.files.execute(call),{code:'outside_remote_scope'});assert.throws(()=>f.files.execute(list),{code:'outside_remote_scope'});
 await rename(f.project,join(f.root,'original-project'));await symlink(f.outside,f.project,process.platform==='win32'?'junction':'dir');assert.throws(()=>f.files.prepare('qq_list_files',{}),{code:'invalid_tool_directory'});
});
