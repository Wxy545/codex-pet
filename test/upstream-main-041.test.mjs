import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {patchDrag041,patchAlpha041,patchTurn041} from '../harness/main-fixes-041.mjs';
import {patchHelper041} from '../scripts/prepare-runtime-041.mjs';
import {prepareHarnessDependency} from '../harness/motion-fix.mjs';
import {readUpstream,upstreamVersion} from './support/harness-upstream.mjs';

const helperNames=['main.js','main/tray.js','main/bridge.js','main/ipc.js','main/dpi.js','main/user-data.js','sprite.js','sprite/motion.js','sprite/menu.js','sprite/playback.js','sprite/bubble.js','sprite/input.js','events.js','shared-core.js','index.html'];
const upstream=name=>readUpstream(name).replaceAll('\r\n','\n');
const only041={skip:upstreamVersion!=='0.4.1'};

function desktop(source){
 class PetSprite{}
 const window={__dshPetDebug:{}};
 vm.runInNewContext(source,{PetSprite,window,toLocal:x=>x,performance:{now:()=>100},setTimeout(){},VIEW:{w:1920,h:1080},S:{DRAG_THRESHOLD:4,trimTrail:a=>a,estimateReleaseVelocity:()=>null},config:{}});
 let writes=0,value='translateY(30px)',follows=0;
 const style={};Object.defineProperty(style,'transform',{get:()=>value,set:v=>{writes++;value=v;}});
 const sprite=Object.assign(Object.create(PetSprite.prototype),{stage:{style},bottomPad:30,pos:{x:80,y:90},halfW:160,halfH:90,dragState:{active:true,dragging:false,sx:100,sy:100,petX:80,petY:90,sling:false},dragTrail:[],animations:{drag:[],idle:[]},hit:{classList:{remove(){}}},physics:{},syncInputBusy(){},startDragFollow(){follows++;Object.assign(this.pos,this.dragTarget);},stopDragFollow(){},resumeWorkStatusAnim:()=>true,position(){}});
 return{sprite,window,transform:()=>value,writes:()=>writes,follows:()=>follows};
}

test('041真实PetSprite拖拽越阈值及松手保留30px脚垫，原屏幕位移和最终落点不变',only041,()=>{
 const original=upstream('runtime/electron-helper/sprite/input.js'),legacy=desktop(original);
 legacy.sprite.onPointerMove({screenX:140,screenY:120});assert.equal(legacy.transform(),'none','官方原件可重现起手跳动');
 const f=desktop(patchDrag041(original));f.sprite.onPointerMove({screenX:102,screenY:101});assert.equal(f.sprite.dragState.dragging,false);assert.equal(f.writes(),0);
 f.sprite.onPointerMove({screenX:140,screenY:120});assert.equal(f.sprite.dragState.dragging,true);assert.equal(f.follows(),1);assert.deepEqual({...f.sprite.pos},{x:120,y:110});assert.equal(f.transform(),'translateY(30px)');
 f.sprite.onPointerUp({screenX:140,screenY:120});assert.equal(f.sprite.dragState.active,false);assert.equal(f.writes(),0);assert.equal(f.transform(),'translateY(30px)');assert.deepEqual({...f.window.__dshPetDebug.lastDragRelease},{x:120,y:110});
});

test('041网页真实几何在两种拖拽状态中保持相同位移，补丁幂等且拒绝半补丁',only041,()=>{
 const raw=upstream('lib/client.js'),fixed=patchDrag041(raw,{browser:true});
 const block=fixed.match(/function petStageStyle\(dragging, bottomPad\) \{[\s\S]*?^\}/m)?.[0];assert.ok(block);
 const fn=new Function(block+';return petStageStyle;')();assert.equal(fn(false,30).transform,'translateY(30px)');assert.equal(fn(true,30).transform,'translateY(30px)');
 for(const[b,s]of[[true,raw],[false,upstream('runtime/electron-helper/sprite/input.js')]]){
  const patched=patchDrag041(s,{browser:b});assert.equal(patchDrag041(patched,{browser:b}),patched);assert.throws(()=>patchDrag041(s+s,{browser:b}),/anchor/);assert.throws(()=>patchDrag041('unfamiliar',{browser:b}),/anchor/);
  assert.throws(()=>patchDrag041(patched.replace('codex-pet-drag-pad-start-041','changed'),{browser:b}),/anchor/);
 }
});

test('041透明修正只作用原视频，0/255背景保持透明，滤镜每页去重',only041,()=>{
 const html=patchAlpha041(upstream('runtime/electron-helper/index.html'));
 assert.match(html,/video\.pet-video \{[^}]*filter: url\(#dsh-pet-alpha-fix\)/);assert.equal((html.match(/id="dsh-pet-alpha-fix"/g)||[]).length,1);
 const renderer=readFileSync(new URL('../src/codex-skin-renderer.js',import.meta.url),'utf8');assert.match(renderer,/frame\.className = 'codex-skin-frame'/);assert.doesNotMatch(renderer,/className\s*=\s*['"]pet-video['"]|filter:\s*url\(#dsh-pet-alpha-fix\)/);
 const client=patchAlpha041(upstream('lib/client.js'),{browser:true});
 const body=[],node=tag=>({tag,children:[],attributes:{},setAttribute(k,v){this.attributes[k]=v;},appendChild(child){this.children.push(child);}});
 const document={querySelector:()=>body.length?body[0]:null,createElementNS:(_,tag)=>node(tag),body:{appendChild:n=>body.push(n)}};
 const ensure=vm.runInNewContext(client.match(/function ensureAlphaFilter041\(\) \{[\s\S]*?^\}/m)[0]+';ensureAlphaFilter041;',{document});ensure();ensure();assert.equal(body.length,1);
 const func=body[0].children[0].children[0].children[0].children[0];assert.equal(func.tag,'feFuncA');assert.equal(func.attributes.type,'linear');assert.equal(Number(func.attributes.slope),1);
 const alpha=a=>Math.max(0,Math.min(1,a+Number(func.attributes.intercept)));assert.equal(alpha(0),0);assert.ok(alpha(1/255)<1e-10);assert.ok(Math.abs(alpha(128/255)-127/255)<1e-10);
 for(const[b,s]of[[true,upstream('lib/client.js')],[false,upstream('runtime/electron-helper/index.html')]]){const p=patchAlpha041(s,{browser:b});assert.equal(patchAlpha041(p,{browser:b}),p);assert.throws(()=>patchAlpha041(s+s,{browser:b}),/anchor/);assert.throws(()=>patchAlpha041(p.replace('-0.0039215686','-0.03'),{browser:b}),/anchor/);}
});

test('041独立prepare与Harness均安装两项修复，Harness坏HTML在任何落盘之前拒绝',only041,t=>{
 const originals=Object.fromEntries(helperNames.map(name=>[name,upstream('runtime/electron-helper/'+name)]));
 const fixed=patchHelper041(originals);assert.match(fixed['sprite/input.js'],/codex-pet-drag-pad-start-041/);assert.match(fixed['index.html'],/dsh-pet-alpha-fix/);assert.ok(fixed['sprite/init.js']===undefined,'不改写stage引用');assert.deepEqual(patchHelper041(fixed),fixed);
 const root=mkdtempSync(join(tmpdir(),'harness-main-041-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const profile=join(root,'profile'),pkg=join(profile,'node_modules/dsh-pet');mkdirSync(pkg,{recursive:true});writeFileSync(join(profile,'package.json'),'{}');writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'dsh-pet',version:'0.4.1',exports:{'./package.json':'./package.json'}}));
 const names=['lib/client.js','lib/index.js',...['shared-core.js','sprite/motion.js','sprite/input.js','index.html','main.js','main/dpi.js','main/user-data.js'].map(n=>'runtime/electron-helper/'+n)];
 for(const n of names){mkdirSync(dirname(join(pkg,n)),{recursive:true});writeFileSync(join(pkg,n),upstream(n));}
 const bad='runtime/electron-helper/index.html';writeFileSync(join(pkg,bad),'unfamiliar');assert.throws(()=>prepareHarnessDependency({profileDir:profile}),/anchor/);for(const n of names.filter(n=>n!==bad))assert.equal(readFileSync(join(pkg,n),'utf8'),upstream(n));writeFileSync(join(pkg,bad),upstream(bad));
 const result=prepareHarnessDependency({profileDir:profile});assert.ok(result.files.includes(bad));assert.match(readFileSync(join(pkg,'runtime/electron-helper/sprite/input.js'),'utf8'),/codex-pet-drag-pad-start-041/);assert.match(readFileSync(join(pkg,'lib/client.js'),'utf8'),/ensureAlphaFilter041/);assert.match(readFileSync(join(pkg,'lib/client.js'),'utf8'),/codex-pet-turn-chain-041/);assert.equal(prepareHarnessDependency({profileDir:profile}).status,'current');
});

test('041浏览器实际转向结束后继续换源，冻结和睡眠仍交原状态机处理',only041,()=>{
 const raw=upstream('lib/client.js'),patched=patchTurn041(raw);
 function flow(source,{frozen=false}={}){
  // 运行原pick/roll/decision/sleep/flow闭包；只提供React ref与宿主动作观察器，不重写结束分支。
  const names=['pick','rollKind'],parts=names.map(name=>source.match(new RegExp('const '+name+' = \\([\\s\\S]*?^\\};','m'))?.[0]);
  for(const name of ['decideNextAnimation','createSleepMachine','createAnimationFlow'])parts.push(source.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?^\\}','m'))?.[0]);
  assert.ok(parts.every(Boolean));const calls=[],card={state:{facing:'left'},facingRef:{current:'left'},animRef:{current:'turn'},actions:{setFacing(value){calls.push(['facing',value]);card.state.facing=value;},setAnim(value){calls.push(['anim',value,card.facingRef.current]);card.animRef.current=value;},setOnce(value){calls.push(['once',value]);},bumpSeq(){calls.push(['seq']);}}};
  const hub={card,ownAnim:{isFrozen:()=>frozen},cfg:()=>({id:'synthetic-turn-pet',animationWeights:{idle:100,turn:0,move:0},fixedEnabled:false}),anims:()=>({idle:['idle'],turn:['turn'],categories:[]}),stopMotion(){},bubbles:{hideWork(){}}};
  const create=vm.runInNewContext(parts.join('\n')+'\ncreateAnimationFlow;',{log$2(){}});const api=create({useRef:value=>({current:value})})(hub,null);return{api,card,calls};
 }
 const original=flow(raw);original.api.applyEndedCue({kind:'turn'});assert.deepEqual(original.calls,[['facing','right']],'官方041原件只翻面，不续换源');
 const current=flow(patched);current.api.applyEndedCue({kind:'turn'});assert.deepEqual(current.calls,[['facing','right'],['anim','idle','right'],['once',true],['seq']]);current.api.applyEndedCue({kind:'next'});assert.equal(current.calls.filter(c=>c[0]==='seq').length,2);
 const frozen=flow(patched,{frozen:true});frozen.api.applyEndedCue({kind:'turn'});assert.deepEqual(frozen.calls,[['facing','right']]);
 const asleep=flow(patched);asleep.api.applySleep({sleeping:true,start:'sleep-start',loop:'sleep-loop',end:'sleep-end'});asleep.calls.length=0;asleep.api.applyEndedCue({kind:'turn'});assert.equal(asleep.card.state.facing,'left');assert.deepEqual(asleep.calls,[['once',false],['anim','sleep-loop','left'],['seq']]);
 assert.equal(patchTurn041(patched),patched);assert.throws(()=>patchTurn041(raw+raw),/anchor/);assert.throws(()=>patchTurn041('unknown'),/anchor/);assert.throws(()=>patchTurn041(patched.replace('codex-pet-turn-chain-041','tampered')),/anchor/);
});
