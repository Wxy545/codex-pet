import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let Creative={};try{Creative=require('../src/creative-store.cjs');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'pet-creative-'));t.after(()=>rm(root,{recursive:true,force:true}));const dataRoot=join(root,'data'),source=join(root,'source.png');await writeFile(source,png);assert.equal(typeof Creative.createCreativeStore,'function','作品包服务尚未实现');const probe=async()=>({width:1,height:1,decoded:true});return{root,dataRoot,source,store:Creative.createCreativeStore({dataRoot,probe})};}
const metadata={name:'测试角色',persona:'喜欢看书的纸片朋友。',author:'Author',source:'Original AI drawing',license:'CC0-1.0'};
test('新建角色、实际导入PNG、保存绑定、导出后在干净目录回导，保留来源且不改变已选角色',async t=>{
 const f=await fixture(t);await mkdir(join(f.dataRoot,'skins'),{recursive:true});await writeFile(join(f.dataRoot,'skins','selection.json'),'initial-choice');
 const role=await f.store.create(metadata);assert.match(role.id,/^custom-/);
 const asset=await f.store.importMedia(role.id,f.source,{kind:'image'});
 const manifest={schemaVersion:1,profiles:{idle:{file:asset.file,columns:1,rows:1,frames:[[0,0]],fps:1,layout:{scale:1.2,anchorX:.4,anchorY:1}}},actions:{}};
 await f.store.save(role.id,{manifest});const saved=await f.store.read(role.id);assert.equal(saved.manifest.profiles.idle.layout.scale,1.2);
 const exported=await f.store.exportPackage(role.id,join(f.root,'work.pet.zip'));assert.equal(exported.report.ok,true);assert.match(exported.sha256,/^[a-f0-9]{64}$/);
 const clean=Creative.createCreativeStore({dataRoot:join(f.root,'clean'),probe:async()=>({width:1,height:1,decoded:true})});const imported=await clean.importPackage(exported.file);
 assert.notEqual(imported.id,role.id);assert.equal(imported.name,metadata.name);assert.deepEqual(imported.manifest,saved.manifest);assert.equal(imported.assets[0].sha256,asset.sha256);assert.equal(imported.license,metadata.license);
 assert.equal(await readFile(join(f.dataRoot,'skins','selection.json'),'utf8'),'initial-choice');
 const archive=await readFile(exported.file);for(const text of ['initial-choice','AppSecret','auth.json',f.dataRoot])assert.equal(archive.includes(Buffer.from(text)),false);
});
test('坏媒体、越界名称、符号链接及未绑定待机不能进入可用角色或导出',async t=>{
 const f=await fixture(t),role=await f.store.create(metadata),bad=join(f.root,'bad.png');await writeFile(bad,'not-png');
 await assert.rejects(f.store.importMedia(role.id,bad,{kind:'image'}),/invalid.media/);
 await assert.rejects(f.store.save(role.id,{manifest:{schemaVersion:1,profiles:{idle:{file:'../x.png',columns:1,rows:1,frames:[[0,0]]}},actions:{}}}),/manifest|invalid/);
 await assert.rejects(f.store.exportPackage(role.id,join(f.root,'empty.zip')),/idle|unavailable|incomplete/);
 const linked=join(f.root,'linked-dir');await symlink(f.root,linked,process.platform==='win32'?'junction':'dir');await assert.rejects(f.store.importMedia(role.id,join(linked,'source.png'),{kind:'image'}),/linked|unsafe|invalid/);
});
test('新角色被运行时目录、身份和选择真实识别；内置角色与用户偏好保持不变',async t=>{
 const f=await fixture(t),role=await f.store.create(metadata),asset=await f.store.importMedia(role.id,f.source,{kind:'image'});await f.store.save(role.id,{manifest:{schemaVersion:1,profiles:{idle:{file:asset.file,columns:1,rows:1,frames:[[0,0]],fps:1}},actions:{}}});
 const {createSkinStore}=require('../src/codex-skins.cjs'),C=require('../src/codex-character.cjs');const skins=createSkinStore({dataRoot:f.dataRoot});const model=await skins.readModel();assert.equal(model.characters.find(c=>c.id===role.id).available.q,true);
 await skins.select({character:role.id,mode:'q'});const identity=C.readCharacter(f.dataRoot);assert.equal(identity.id,role.id);assert.equal(identity.name,metadata.name);assert.match(identity.persona,/纸片朋友/);assert.doesNotMatch(identity.persona,/鲸鱼娘|白龙娘|小羊/);
 assert.equal(model.characters.some(c=>c.id==='bluefish'),true);
});
