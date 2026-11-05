import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {patchStandalone043,patchHelper043} from '../scripts/prepare-runtime-043.mjs';
import {readVerifiedUpstream043} from '../scripts/upstream-snapshot-043.mjs';

const root=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet');
const supported=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version==='0.4.3',options={skip:!supported};
const read=name=>readVerifiedUpstream043(root,name),helperNames=['main.js','main/tray.js','main/bridge.js','main/ipc.js','main/dpi.js','main/user-data.js','sprite.js','sprite/init.js','sprite/window-fit.js','sprite/motion.js','sprite/menu.js','sprite/playback.js','sprite/bubble.js','sprite/input.js','events.js','shared-core.js','index.html'];
const helper=()=>Object.fromEntries(helperNames.map(name=>[name,read('runtime/electron-helper/'+name)]));
function buildDom(source){
 class Element{constructor(){this.style={setProperty(){}};this.children=[];}appendChild(value){this.children.push(value);value.parentNode=this;}setAttribute(){}addEventListener(){}}
 class PetSprite{}
 const document={createElement:()=>new Element()},rootEl=new Element(),S={resolveFontPx:()=>({bubble:14,tip:12}),HIT_BOX:{x0:10,x1:630,y0:5,y1:355},TOOLTIP_CLASS:'tip'};
 vm.runInNewContext(source,{PetSprite,document,rootEl,S});
 const p=Object.assign(Object.create(PetSprite.prototype),{winOffset:{x:160,y:180},size:320,height:180,winH:200,bottomPad:20,pet:{name:'synthetic'},position(){}});p.buildDom();return p;
}

test('043实际init保留同一stage供自有透明角色覆盖层使用，原生脚垫与offset不变',options,()=>{
 const raw=helper(),fixed=patchHelper043(raw),p=buildDom(fixed['sprite/init.js']);
 assert.equal(p.stage,p.el.children.find(el=>el.className==='pet-stage'));
 assert.equal(p.stage.style.transform,'translateY(20px)');assert.equal(p.el.style.left,'160px');assert.equal(p.el.style.top,'180px');
 const customLayer={className:'codex-skin-layer'};p.stage.appendChild(customLayer);assert.equal(customLayer.parentNode,p.stage);
 assert.deepEqual(p.stage.children.slice(0,3),[p.videoA,p.videoB,p.hit]);
});

test('043真实宿主完整策略可编译，新原生window-fit/滤镜/循环链不叠旧补丁且半补丁拒绝',options,()=>{
 const source=read('lib/standalone.js'),fixed=patchStandalone043(source),parsed=spawnSync(process.execPath,['--check','--input-type=module'],{input:fixed,encoding:'utf8',windowsHide:true});
 assert.equal(parsed.status,0,parsed.stderr);assert.match(fixed,/canWhisper: \(\) => runtime.ready\(\) && store.current\(\).automaticWhispers/);assert.match(fixed,/Endpoint changes require a new API key/);assert.match(fixed,/REQUESTS_PER_MINUTE = 6/);
 assert.ok(fixed.indexOf('const characterAtStart = CodexCharacter.readCharacter();',fixed.indexOf('const chatWithPet = async'))<fixed.indexOf('const memoryEntry = found.entry'));
 const original=helper(),result=patchHelper043(original);assert.deepEqual(patchHelper043(result),result);
 assert.match(result['sprite/playback.js'],/this.once = nextOnce; \/\/ codex-pet-once-contract-043/);assert.match(result['sprite/playback.js'],/el.onended = nextOnce \? \(\) => this.handleEnded\(\) : \(\) => this.restartLoop\(el\)/);
 assert.match(result['index.html'],/sprite\/window-fit.js/);assert.equal(result['index.html'].split('<filter id="dsh-pet-alpha-fix">').length,2);assert.doesNotMatch(result['sprite/input.js'],/this.stage.style.transform = 'none'/);
 assert.throws(()=>patchHelper043({...original,'sprite/init.js':'unknown'}),/锚点|anchor/);assert.throws(()=>patchHelper043({...original,'sprite/window-fit.js':'unknown'}),/锚点|anchor/);assert.throws(()=>patchStandalone043(source+source),/锚点|定位/);
});

const require=createRequire(import.meta.url),Locale=require('../src/codex-runtime-locale.cjs');
function region(source,name){const a=source.indexOf('//#region src/'+name),b=source.indexOf('//#endregion',a);assert.ok(a>=0&&b>a,name);return source.slice(a,b);}
function settings(){
 const fixed=patchStandalone043(read('lib/standalone.js'));let code='';for(const row of fixed.matchAll(/\/\/#region src\/standalone\/settings-page\/script\/[^\n]+\n([\s\S]*?)\/\/#endregion/g))code+=row[1]+'\n';
 code+=region(fixed,'standalone/settings-page/chrome.ts')+'\n'+region(fixed,'standalone/settings-page.ts')+'\nglobalThis.result={html:settingsPage,script:settingsScript};';
 const scope={CodexRuntimeLocale:{settingsHtml:v=>Locale.settingsHtml(v,'en'),settingsScript:v=>Locale.settingsScript(v,'en')},ROUTE_SEGMENT:'/dsh-pet-7340',VOICES:[],FONT_PRESETS:[],PET_DISPLAYS:[],CORNER_SET:[],DEFAULT_PHYSICS:{},DEFAULT_FONT:{},DEFAULT_WEIGHTS:{idle:10,turn:5,move:5},LOGO_URL:''};vm.runInNewContext(code,scope);return{...scope.result,globals:Locale.settingsScript(scope.globalsScript(),'en')};
}

test('043新增动作频率使用实际设置builder，英文标签完整并沿用真实保存字段',options,()=>{
 const en=settings();assert.doesNotThrow(()=>new vm.Script(en.script));assert.doesNotMatch(en.html,/[\u3400-\u9fff]/u);
 const scope={state:{globals:{animationWeights:{idle:10,turn:5,move:5}}}};
 vm.runInNewContext(en.globals+'\nglobalThis.result=motionCard();',Object.assign(scope,{card:(title,detail,fields)=>({title,detail,fields}),numberField:(id,label)=>({id,label}),make:(_tag,_attrs,fields)=>fields}));
 assert.doesNotMatch(JSON.stringify(scope.result),/[\u3400-\u9fff]/u);assert.equal(scope.result.title,'Action frequency');
 assert.match(en.script,/animationWeights: pickWeights\(source.animationWeights\)/);assert.match(en.script,/animationWeights: state.globals.animationWeights/);
});
