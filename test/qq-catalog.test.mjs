import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,parse,relative,isAbsolute} from 'node:path';
import {createQQCatalog,cleanTitle} from '../src/qq-catalog.mjs';

async function fixture(t){
 // Windows运行器的TEMP可能是8.3别名；持久项目路径与生产登记一样使用真实路径。
 const parent=await realpath(tmpdir()),root=await realpath(await mkdtemp(join(parent,'pet-qq-catalog-')));
 t.after(async()=>{const rel=relative(parent,root);assert.ok(rel&&!isAbsolute(rel)&&!rel.startsWith('..'));await rm(root,{recursive:true,force:true});});
 const a=join(root,'alpha'),b=join(root,'beta');await mkdir(a);await mkdir(b);
 return{root,a,b};
}
const empty=()=>({cwd:'',permission:'read-only',threadId:null,threads:[]});
const project=(cwd,extra={})=>({id:'project-a',label:'Alpha',cwd,maxPermission:'read-only',permission:'read-only',threadId:null,...extra});
const session=(extra={})=>({id:'thread-a',projectId:'project-a',title:'Session A',permission:'read-only',source:'qq',...extra});

test('旧单项目和自产会话迁移保留原权限、当前会话及历史映射，不复制重复线程',async t=>{
 const f=await fixture(t),config={cwd:f.a,permission:'workspace-write',threadId:'current-thread',threads:['old-thread','current-thread','old-thread']};
 const catalog=createQQCatalog(config),active=catalog.current();
 assert.equal(config.projects.length,1);assert.equal(active.cwd,f.a);assert.equal(active.permission,'workspace-write');assert.equal(active.maxPermission,'workspace-write');
 assert.equal(config.activeProjectId,active.id);assert.equal(config.threadId,'current-thread');assert.equal(catalog.selected().id,'current-thread');
 assert.deepEqual(config.sessions.map(item=>item.id),['old-thread','current-thread']);assert.ok(config.sessions.every(item=>item.projectId===active.id&&item.source==='qq'));
 const id=active.id;const reopened=createQQCatalog(config);assert.equal(reopened.current().id,id);assert.equal(config.sessions.length,2);await reopened.check();
});

test('本机添加项目保留已有登记，各自会话和权限在切换及重建后保持独立',async t=>{
 const f=await fixture(t),config=empty(),catalog=createQQCatalog(config);
 const a=await catalog.register(f.a,'workspace-write');catalog.remember('alpha-thread',{title:'Alpha work'});catalog.setPermission('read-only');
 const b=await catalog.register(f.b,'read-only');catalog.remember('beta-thread',{title:'Beta review'});
 assert.equal(catalog.list().length,2);assert.equal(config.threadId,'beta-thread');assert.equal(config.cwd,f.b);
 await catalog.select(a.id);assert.equal(config.cwd,f.a);assert.equal(config.threadId,'alpha-thread');assert.equal(config.permission,'read-only');assert.equal(catalog.selected().title,'Alpha work');
 const reopened=createQQCatalog(config);assert.equal(reopened.current().id,a.id);await reopened.select(b.id);assert.equal(reopened.selected().id,'beta-thread');
 reopened.newSelection();assert.equal(config.threadId,null);assert.equal(config.projects.find(item=>item.id===a.id).threadId,'alpha-thread');assert.equal(config.sessions.length,2);
});

test('会话目录超过上限时保留各项目当前选择，序列化重建后仍能切回原会话',async t=>{
 const f=await fixture(t),config=empty(),catalog=createQQCatalog(config);
 const a=await catalog.register(f.a,'workspace-write');catalog.remember('alpha-selected',{title:'Pinned alpha'});
 const b=await catalog.register(f.b,'read-only');
 for(let index=0;index<270;index++)catalog.remember('beta-'+index,{title:'Synthetic '+index});
 assert.equal(config.sessions.length,256);assert.equal(config.projects.find(p=>p.id===a.id).threadId,'alpha-selected');
 assert.ok(config.sessions.some(s=>s.id==='alpha-selected'&&s.projectId===a.id));assert.equal(config.sessions.some(s=>s.id==='beta-0'),false);
 assert.equal(catalog.selected().id,'beta-269');
 const saved=JSON.parse(JSON.stringify(config)),reopened=createQQCatalog(saved);
 await reopened.select(a.id);assert.equal(reopened.selected().id,'alpha-selected');assert.equal(saved.permission,'workspace-write');
 await reopened.select(b.id);assert.equal(reopened.selected().id,'beta-269');assert.equal(saved.permission,'read-only');assert.equal(saved.sessions.length,256);
});

test('QQ只可在本机上限内切权限，降低上限立即收紧当前执行范围',async t=>{
 const f=await fixture(t),config=empty(),catalog=createQQCatalog(config);
 await catalog.register(f.a,'read-only');assert.throws(()=>catalog.setPermission('workspace-write'),error=>error.code==='permission_limit');assert.equal(config.permission,'read-only');
 for(const value of ['danger-full-access','network','',undefined])assert.throws(()=>catalog.setPermission(value),error=>error.code==='invalid_input');
 const first=catalog.current().id;await catalog.register(f.a,'workspace-write');assert.equal(catalog.current().id,first);assert.equal(config.projects.length,1);
 catalog.setPermission('workspace-write');catalog.remember('edit-thread');await catalog.register(f.a,'read-only');assert.equal(catalog.current().maxPermission,'read-only');assert.equal(config.permission,'read-only');
 assert.throws(()=>catalog.setPermission('workspace-write'),error=>error.code==='permission_limit');
});

test('每次检查和切换重新核对目录，登记后换成junction不能沿用旧路径权限',async t=>{
 const f=await fixture(t),config=empty(),catalog=createQQCatalog(config);
 const a=await catalog.register(f.a,'workspace-write');await catalog.register(f.b,'read-only');
 await rename(f.a,join(f.root,'original-alpha'));await symlink(f.b,f.a,process.platform==='win32'?'junction':'dir');
 await assert.rejects(catalog.check(a),error=>error.code==='invalid_directory');await assert.rejects(catalog.select(a.id),error=>error.code==='invalid_directory');
 assert.equal(config.cwd,f.b);assert.equal(config.permission,'read-only');
 await rm(f.a);await mkdir(f.a);await catalog.select(a.id);await catalog.check();
});

test('未知项目和跨项目会话不能被选择或重绑，切换失败保留当前范围',async t=>{
 const f=await fixture(t),config=empty(),catalog=createQQCatalog(config),a=await catalog.register(f.a,'read-only');
 catalog.remember('shared-thread',{title:'Alpha'});await catalog.register(f.b,'read-only');
 await assert.rejects(catalog.select('unknown-project'),error=>error.code==='invalid_input');assert.throws(()=>catalog.remove('unknown-project'),error=>error.code==='invalid_input');
 assert.equal(catalog.session('shared-thread'),undefined);assert.equal(catalog.session('unknown-thread'),undefined);
 assert.throws(()=>catalog.remember('shared-thread',{title:'Hijack'}),error=>error.code==='thread_scope_mismatch');assert.equal(config.cwd,f.b);assert.equal(config.threadId,null);
 for(const threadId of ['../thread','a/b','',null])assert.throws(()=>catalog.remember(threadId),error=>error.code==='invalid_thread');
 await catalog.select(a.id);assert.equal(catalog.selected().title,'Alpha');
});

test('移除仅撤回项目登记和所属会话，不删除项目文件，最后一项移除后清空选择',async t=>{
 const f=await fixture(t),config=empty(),catalog=createQQCatalog(config),a=await catalog.register(f.a,'workspace-write');
 await writeFile(join(f.a,'keep.txt'),'user project file');catalog.remember('alpha-thread');const b=await catalog.register(f.b,'read-only');catalog.remember('beta-thread');
 catalog.remove(a.id);assert.equal(await readFile(join(f.a,'keep.txt'),'utf8'),'user project file');assert.deepEqual(config.sessions.map(item=>item.id),['beta-thread']);assert.equal(config.cwd,f.b);
 catalog.remove(b.id);assert.equal(config.cwd,'');assert.equal(config.threadId,null);assert.equal(config.activeProjectId,null);assert.equal(config.projects.length,0);assert.equal(config.sessions.length,0);
 await assert.rejects(catalog.check(),error=>error.code==='invalid_directory');
});

test('损坏项目配置、越限列表和无效会话记录拒绝载入，标题输出有界',async t=>{
 const f=await fixture(t),a=project(f.a);
 const invalid=[
  {...empty(),projects:{}},
  {...empty(),projects:Array.from({length:33},(_,index)=>({...a,id:'p'+index}))},
  {...empty(),sessions:Array.from({length:257},(_,index)=>session({id:'t'+index}))},
  {...empty(),projects:[a,{...a}]},
  {...empty(),projects:[a],activeProjectId:'unknown-project'},
  {...empty(),projects:[{...a,cwd:'relative-project'}]},
  {...empty(),projects:[{...a,cwd:parse(f.a).root}]},
  {...empty(),projects:[{...a,maxPermission:'danger-full-access'}]},
  {...empty(),projects:[{...a,permission:'workspace-write'}]},
  {...empty(),projects:[a],sessions:[session({projectId:'missing'})]},
  {...empty(),projects:[a],sessions:[session({source:'untrusted'})]},
  {...empty(),projects:[a],sessions:[session({title:42})]},
  {...empty(),projects:[a],sessions:[session(),session()]},
  {...empty(),projects:[a],sessions:[session({title:'x'.repeat(1000)})]},
  {...empty(),projects:[{...a,threadId:'missing-thread'}],sessions:[session()]},
  {...empty(),projects:[{...a,threadId:'foreign-thread'},{...a,id:'project-b',cwd:f.b}],sessions:[session({id:'foreign-thread',projectId:'project-b'})]},
 ];
 for(const config of invalid)assert.throws(()=>createQQCatalog(structuredClone(config)),error=>error.code==='invalid_settings');
 const catalog=createQQCatalog({...empty(),projects:[a],sessions:[session({title:'Title\nwith\u0000controls'})]});assert.doesNotMatch(catalog.session('thread-a').title,/[\n\u0000]/);
 assert.equal(cleanTitle(' line\nwith\u0000controls ').includes('\n'),false);assert.equal(cleanTitle('x'.repeat(1000)).length,80);
 catalog.remember('bounded-title',{title:'x'.repeat(1000)});assert.equal(catalog.selected().title.length,80);
});
