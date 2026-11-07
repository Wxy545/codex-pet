import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {tmpdir} from 'node:os';
import {readUpstream,upstreamVersion} from './support/harness-upstream.mjs';
import {validateModularOwnedElectron045,validateModularAlphaLayout045} from '../harness/modular-runtime-fix.mjs';
import {prepareHarnessDependency} from '../harness/motion-fix.mjs';

const only045={skip:upstreamVersion!=='0.4.5'};
function declaration(source,name){const matches=[...source.matchAll(new RegExp('^function '+name+'\\([^)]*\\) \\{[\\s\\S]*?^\\}','gm'))];assert.equal(matches.length,1);return matches[0][0];}
function fixture(t){
 const base=fs.realpathSync(tmpdir()),root=fs.mkdtempSync(path.join(base,'harness-contract-045-'));
 t.after(()=>{const real=fs.realpathSync(root),rel=path.relative(base,real);assert.ok(rel&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep));fs.rmSync(real,{recursive:true,force:true});});
 const profile=path.join(root,'profile'),pkg=path.join(profile,'node_modules/dsh-pet');fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(path.join(profile,'package.json'),'{}');fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'dsh-pet',version:'0.4.5',exports:{'./package.json':'./package.json'}}));
 const files=['lib/client.js','lib/index.js',...['shared-core.js','sprite/motion.js','main.js','main/dpi.js','main/user-data.js','sprite/playback.js','sprite.js','sprite/input.js','sprite/window-fit.js','index.html'].map(name=>'runtime/electron-helper/'+name)];
 const original={};for(const name of files){fs.mkdirSync(path.dirname(path.join(pkg,name)),{recursive:true});original[name]=readUpstream(name);fs.writeFileSync(path.join(pkg,name),original[name]);}
 return{root,profile,pkg,files,original,read:name=>fs.readFileSync(path.join(pkg,name),'utf8')};
}

test('045原生Electron解析完整核验，显式候选和环境优先、缺失不会借宿主npm包',only045,()=>{
 for(const file of ['lib/standalone.js','lib/index.js']){
  const source=readUpstream(file);assert.equal(validateModularOwnedElectron045(source),source);assert.equal(validateModularOwnedElectron045(source),source);
  let requireCalls=0;const env={},existing=new Set(['own.exe']);
  const resolve=vm.runInNewContext('('+declaration(source,'resolveElectronPath')+')',{process:{env},defaultElectronExe:()=> 'own.exe',isNonEmptyFile:name=>existing.has(name),require(){requireCalls++;return 'borrowed.exe';}});
  assert.equal(resolve([]),'own.exe');existing.clear();existing.add('borrowed.exe');assert.equal(resolve([]),undefined);env.DSH_PET_ELECTRON_PATH='env.exe';existing.add('env.exe');assert.equal(resolve(['missing.exe']),'env.exe');existing.add('explicit.exe');assert.equal(resolve(['explicit.exe']),'explicit.exe');assert.equal(requireCalls,0);
  assert.throws(()=>validateModularOwnedElectron045(source.replace('push(defaultElectronExe());','push("borrowed.exe");')),/anchor/);assert.throws(()=>validateModularOwnedElectron045(source+source),/anchor/);
 }
});

test('045原生SVG保持同文档绝对定位与透明参数，禁止叠加043旧补丁或接受半改函数',only045,()=>{
 const source=readUpstream('lib/client.js');assert.equal(validateModularAlphaLayout045(source),source);
 const nodes=[],element=tag=>({tag,style:{},attributes:{},children:[],setAttribute(k,v){this.attributes[k]=v;},appendChild(node){this.children.push(node);}}),document={querySelector:()=>nodes[0]||null,createElementNS:(_ns,tag)=>element(tag),body:{appendChild:node=>nodes.push(node)}};
 const ensure=vm.runInNewContext('('+declaration(source,'ensureAlphaFilter')+')',{document,ALPHA_FIX_ID:'dsh-pet-alpha-fix'});ensure();ensure();assert.equal(nodes.length,1);const svg=nodes[0];assert.equal(svg.style.position,'absolute');assert.equal(svg.attributes.width,'0');assert.equal(svg.attributes.height,'0');assert.equal(svg.children[0].children[0].id,'dsh-pet-alpha-fix');assert.equal(svg.children[0].children[0].children[0].children[0].attributes.intercept,'-0.0039215686');
 assert.ok(!declaration(source,'ensureAlphaFilter').includes('codex-pet-alpha-layout-043'));assert.throws(()=>validateModularAlphaLayout045(source.replace('svg.style.position = "absolute";','svg.style.position = "fixed";')),/anchor/);assert.throws(()=>validateModularAlphaLayout045(source+source),/anchor/);
});

test('045实际Harness准备不改原生Electron与alpha函数，保留once/loop/window-fit并先拒绝未知锚点',only045,t=>{
 const f=fixture(t),native=declaration(f.original['lib/index.js'],'resolveElectronPath'),alpha=declaration(f.original['lib/client.js'],'ensureAlphaFilter');
 const bad=f.original['lib/index.js'].replace('push(defaultElectronExe());','push("unverified.exe");');fs.writeFileSync(path.join(f.pkg,'lib/index.js'),bad);assert.throws(()=>prepareHarnessDependency({profileDir:f.profile}),/anchor/);for(const name of f.files)assert.equal(f.read(name),name==='lib/index.js'?bad:f.original[name]);
 fs.writeFileSync(path.join(f.pkg,'lib/index.js'),f.original['lib/index.js']);const first=prepareHarnessDependency({profileDir:f.profile});assert.equal(first.status,'updated');assert.equal(first.version,'0.4.5');assert.equal(declaration(f.read('lib/index.js'),'resolveElectronPath'),native);assert.equal(declaration(f.read('lib/client.js'),'ensureAlphaFilter'),alpha);const playback=f.read('runtime/electron-helper/sprite/playback.js');assert.ok(playback.includes('this.once = nextOnce;'));assert.ok(playback.includes('this.restartLoop(el)'));assert.equal(f.read('runtime/electron-helper/sprite/window-fit.js'),f.original['runtime/electron-helper/sprite/window-fit.js']);assert.equal(prepareHarnessDependency({profileDir:f.profile}).status,'current');
});
