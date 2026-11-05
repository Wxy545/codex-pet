import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {readUpstream,upstreamVersion} from './support/harness-upstream.mjs';
import {patchModularPlayback043,validateModularClient043,validateModularHelper043} from '../harness/modular-runtime-fix.mjs';
import {prepareHarnessDependency} from '../harness/motion-fix.mjs';
const only043={skip:upstreamVersion!=='0.4.3'};
const helperNames=['index.html','sprite.js','sprite/input.js','sprite/window-fit.js','sprite/playback.js'];
const helper=()=>Object.fromEntries(helperNames.map(name=>[name,readUpstream('runtime/electron-helper/'+name)]));

test('043原生drag/alpha/turn及窗口落位模块完整，未知或缺模块不静默走041补丁',only043,()=>{
 const client=readUpstream('lib/client.js'),files=helper();assert.equal(validateModularClient043(client),client);assert.equal(validateModularHelper043(files),files);
 assert.throws(()=>validateModularClient043(client.replace('card.facingRef.current = next;','card.facingRef.current = stale;')),/anchor/);
 assert.throws(()=>validateModularHelper043({...files,'sprite/window-fit.js':undefined}),/anchor/);
 assert.throws(()=>validateModularHelper043({...files,'index.html':files['index.html'].replace('<script src="./sprite/window-fit.js"></script>','')}),/anchor/);
 assert.throws(()=>validateModularHelper043({...files,'sprite/input.js':files['sprite/input.js'].replace('const px = e.clientX - this.winOffset.x;','const px = e.clientX - this.margin.l;')}),/anchor/);
});

test('043实际switchTo同步单次语义，循环ended只原地续播而单次仍进入结束链',only043,async()=>{
 const raw=readUpstream('runtime/electron-helper/sprite/playback.js'),patched=patchModularPlayback043(raw);
 class Sprite{}vm.runInNewContext(patched,{PetSprite:Sprite});
 const p=new Sprite();p.pending={anim:'native-once',once:true};p.switchTo('native-once',true);assert.equal(p.anim,'native-once');assert.equal(p.once,true);
 p.pending={anim:'native-loop',once:false};p.switchTo('native-loop',false);assert.equal(p.anim,'native-loop');assert.equal(p.once,false);
 let played=0,ended=0;const video={currentTime:4,play:()=>{played++;return Promise.resolve();}},owner={handleEnded:()=>ended++,restartLoop:Sprite.prototype.restartLoop};
 const assignment=patched.match(/^    el\.onended = nextOnce[^\n]+;/m)?.[0];assert.ok(assignment);const bind=new Function('el','nextOnce',assignment);
 bind.call(owner,video,false);video.onended();await Promise.resolve();assert.equal(video.currentTime,0);assert.equal(played,1);assert.equal(ended,0);
 bind.call(owner,video,true);video.onended();assert.equal(played,1);assert.equal(ended,1);
 assert.equal(patchModularPlayback043(patched),patched);assert.throws(()=>patchModularPlayback043(raw+raw),/anchor/);assert.throws(()=>patchModularPlayback043(patched.replace('codex-pet-once-contract-043','tampered')),/anchor/);
});

test('043原生菜单唯一label平铺、重名按owner分枝且点击元组保持原文',only043,()=>{
 const context={};vm.runInNewContext(readUpstream('runtime/electron-helper/shared-core.js'),context);
 const tree=context.PetShared.buildMoreBranch([{owner:'插件甲',label:'弹弓'},{owner:'插件甲',label:'钓鱼'},{owner:'插件乙',label:'弹弓'},{owner:'插件乙',label:'看星星'}]);
 const nodes=JSON.parse(JSON.stringify(tree.children));assert.deepEqual(nodes.map(n=>n.label),['插件甲','钓鱼','插件乙','看星星']);
 const leaves=nodes.flatMap(n=>n.children||[n]);assert.deepEqual(leaves.map(n=>[n.owner,n.label,n.action]),[['插件甲','弹弓','third-party'],['插件甲','钓鱼','third-party'],['插件乙','弹弓','third-party'],['插件乙','看星星','third-party']]);
});

test('043窗口落位未知时预检拒绝，任何其它依赖文件都不留下半补丁',only043,t=>{
 const root=fs.mkdtempSync(join(tmpdir(),'harness-043-layout-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const profile=join(root,'profile'),pkg=join(profile,'node_modules/dsh-pet');fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(join(profile,'package.json'),'{}');fs.writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'dsh-pet',version:'0.4.3',exports:{'./package.json':'./package.json'}}));
 const names=['lib/client.js','lib/index.js','runtime/electron-helper/shared-core.js','runtime/electron-helper/sprite/motion.js','runtime/electron-helper/main.js','runtime/electron-helper/main/dpi.js','runtime/electron-helper/main/user-data.js',...helperNames.map(n=>'runtime/electron-helper/'+n)];
 for(const n of names){fs.mkdirSync(dirname(join(pkg,n)),{recursive:true});fs.writeFileSync(join(pkg,n),readUpstream(n));}
 const broken='runtime/electron-helper/sprite/window-fit.js';fs.writeFileSync(join(pkg,broken),'unfamiliar-window-fit');assert.throws(()=>prepareHarnessDependency({profileDir:profile}),/anchor/);
 for(const n of names.filter(n=>n!==broken))assert.equal(fs.readFileSync(join(pkg,n),'utf8'),readUpstream(n));
});
