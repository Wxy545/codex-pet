import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {readUpstream,upstreamVersion} from './support/harness-upstream.mjs';
import {patchStandalone043} from '../scripts/prepare-runtime-043.mjs';
import {prepareHarnessDependency} from '../harness/motion-fix.mjs';
import {patchModularOwnedElectron043,patchModularAlphaLayout043} from '../harness/modular-runtime-fix.mjs';

const only043={skip:upstreamVersion!=='0.4.3'};
const declaration=(source,name)=>{const value=source.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?^\\}','m'))?.[0];assert.ok(value,name);return value;};
function resolver(source,{candidates=[],env={},existing=['owned.exe','borrowed.exe']}={}){
 let borrowed=0;const call=vm.runInNewContext('('+declaration(source,'resolveElectronPath')+')',{process:{env},defaultElectronExe:()=> 'owned.exe',isNonEmptyFile:file=>existing.includes(file),require:()=>{borrowed++;return 'borrowed.exe';}});
 return{file:call(candidates),borrowed};
}
function harness(t){
 const root=fs.mkdtempSync(join(tmpdir(),'harness-main-043-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const profile=join(root,'profile'),pkg=join(profile,'node_modules/dsh-pet');
 fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(join(profile,'package.json'),'{}');fs.writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'dsh-pet',version:'0.4.3',exports:{'./package.json':'./package.json'}}));
 const names=['lib/client.js','lib/index.js',...['shared-core.js','sprite/motion.js','main.js','main/dpi.js','main/user-data.js','sprite/playback.js','sprite.js','sprite/input.js','sprite/window-fit.js','index.html'].map(name=>'runtime/electron-helper/'+name)];
 for(const name of names){fs.mkdirSync(dirname(join(pkg,name)),{recursive:true});fs.writeFileSync(join(pkg,name),readUpstream(name));}
 return{profile,pkg,names,read:name=>fs.readFileSync(join(pkg,name),'utf8')};
}
function alpha(source){
 const nodes=[],element=tag=>({tag,style:{},attributes:{},children:[],setAttribute(name,value){this.attributes[name]=value;},appendChild(child){this.children.push(child);}});
 const document={querySelector:()=>nodes[0]||null,createElementNS:(_ns,tag)=>element(tag),body:{appendChild:node=>nodes.push(node)}};
 const ensure=vm.runInNewContext('('+declaration(source,'ensureAlphaFilter')+')',{document,ALPHA_FIX_ID:'dsh-pet-alpha-fix'});ensure();ensure();return nodes;
}

test('043独立宿主优先显式与环境配置，否则只用自有Electron，不借宿主npm包',only043,()=>{
 const source=patchStandalone043(readUpstream('lib/standalone.js'));
 assert.deepEqual(resolver(source),{file:'owned.exe',borrowed:0});
 assert.deepEqual(resolver(source,{existing:['borrowed.exe']}),{file:undefined,borrowed:0});
 assert.deepEqual(resolver(source,{candidates:['missing.exe','explicit.exe'],env:{DSH_PET_ELECTRON_PATH:'env.exe'},existing:['explicit.exe','env.exe','owned.exe']}),{file:'explicit.exe',borrowed:0});
 assert.deepEqual(resolver(source,{candidates:['missing.exe'],env:{DSH_PET_ELECTRON_PATH:'env.exe'},existing:['env.exe','owned.exe']}),{file:'env.exe',borrowed:0});
});

test('043原生Harness宿主同样不借用Electron，坏锚点在所有文件落盘前拒绝',only043,t=>{
 const f=harness(t),bad=readUpstream('lib/index.js').replace('const resolved = require("electron");','const renamedResolver = require("electron");');
 fs.writeFileSync(join(f.pkg,'lib/index.js'),bad);assert.throws(()=>prepareHarnessDependency({profileDir:f.profile}),/anchor/);
 for(const name of f.names)assert.equal(f.read(name),name==='lib/index.js'?bad:readUpstream(name),name);
 fs.writeFileSync(join(f.pkg,'lib/index.js'),readUpstream('lib/index.js'));
 prepareHarnessDependency({profileDir:f.profile});const native=f.read('lib/index.js');assert.deepEqual(resolver(native),{file:'owned.exe',borrowed:0});
 assert.deepEqual(resolver(native,{candidates:['native-cli-electron.exe'],env:{DSH_PET_ELECTRON_PATH:'env.exe'},existing:['native-cli-electron.exe','env.exe','owned.exe']}),{file:'native-cli-electron.exe',borrowed:0});
 assert.deepEqual(resolver(native,{env:{DSH_PET_ELECTRON_PATH:'env.exe'},existing:['env.exe','owned.exe']}),{file:'env.exe',borrowed:0});
 assert.equal(prepareHarnessDependency({profileDir:f.profile}).status,'current');
});

test('043真实网页滤镜留在同文档且不参与普通流，保留零尺寸和alpha参数并只注入一次',only043,t=>{
 const f=harness(t);prepareHarnessDependency({profileDir:f.profile});const nodes=alpha(f.read('lib/client.js'));assert.equal(nodes.length,1);
 const svg=nodes[0];assert.equal(svg.style.position,'absolute');assert.equal(svg.style.display,undefined);assert.equal(svg.attributes.width,'0');assert.equal(svg.attributes.height,'0');assert.equal(svg.attributes['aria-hidden'],'true');
 const filter=svg.children[0].children[0],func=filter.children[0].children[0];assert.equal(filter.id,'dsh-pet-alpha-fix');assert.deepEqual(func.attributes,{type:'linear',slope:'1',intercept:'-0.0039215686'});
});

test('043修复只改已核验函数，重复调用不叠加，未知或半补丁明确停止',only043,()=>{
 for(const[file,patch,name,marker]of [['lib/standalone.js',patchModularOwnedElectron043,'resolveElectronPath','codex-pet-owned-electron-043'],['lib/index.js',patchModularOwnedElectron043,'resolveElectronPath','codex-pet-owned-electron-043'],['lib/client.js',patchModularAlphaLayout043,'ensureAlphaFilter','codex-pet-alpha-layout-043']]){
  const raw=readUpstream(file),fixed=patch(raw);assert.equal(patch(fixed),fixed);assert.equal(fixed.replace(declaration(fixed,name),'FUNCTION'),raw.replace(declaration(raw,name),'FUNCTION'));
  assert.throws(()=>patch(raw+raw),/anchor/);assert.throws(()=>patch(raw+fixed),/anchor/);assert.throws(()=>patch(fixed+fixed.replace(marker,'tampered')),/anchor/);assert.throws(()=>patch(fixed.replace(marker,'tampered')),/anchor/);assert.throws(()=>patch('unfamiliar'),/anchor/);
 }
});
