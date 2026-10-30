'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs'),{join}=require('node:path');

function fixture({locale='en',host='codex',deferInitial=false}={}) {
 let mounted,changed,initialResolve,unsubscribed=0,closed=0;const calls=[],events=new Map();
 const shared={mountContextMenu:options=>{mounted=options;return{close(){}};},displayMenuBranch:()=>({action:'display'}),buildMoreBranch:()=>null,buildMenuTree:()=>[{label:'Actions',children:[{anim:'idle',label:'Idle'}]}]};
 const state={mode:'both',locale},bridge={getState:()=>deferInitial?new Promise(resolve=>{initialResolve=resolve;}):Promise.resolve(state),onChanged:handler=>{changed=handler;return()=>{unsubscribed++;};},setMode:async mode=>{calls.push(['mode',mode]);return{mode,locale};},preview:async()=>calls.push(['preview'])};
 const window={PetShared:shared,__dshPetDebug:{},codexStartup:bridge,addEventListener:(name,fn)=>events.set(name,fn)};
 const context=vm.createContext({window,S:shared,OPEN_TARGET:'web',navigator:{language:locale},console});
 // 不伪造不存在的原型mount：执行上游实际onContextMenu以及onMenuAction调用链。
 vm.runInContext(readFileSync(join(__dirname,'../node_modules/dsh-pet/runtime/electron-helper/sprite.js'),'utf8'),context);
 if(host==='workbuddy'){
  window.petHost={initialHost:host,getState:async()=>({host}),selectHost:async()=>{}};window.CodexLocale={getLocale:()=>locale};
  window.codexControl={open(){}};window.CodexPetActions={quickMenu:()=>[{label:'Idle',anim:'idle'}]};
  vm.runInContext(readFileSync(join(__dirname,'pet-host-menu.js'),'utf8'),context);
 }
 vm.runInContext(readFileSync(join(__dirname,'startup-menu.js'),'utf8'),context);
 const sprite=vm.runInContext('Object.create(PetSprite.prototype)',context);
 Object.assign(sprite,{dragState:{},animations:{},menuItems:[],stopThrow(){},stopMove(){},setInteractive(){},syncInputBusy(){},syncInputRegions(){},visibleClampRect:()=>null,closeMenu(){closed++;this.menuOpen=false;}});
 const flush=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
 const open=()=>{sprite.menuOpen=false;sprite.onContextMenu({preventDefault(){},clientX:20,clientY:30});return mounted;};
 return{window,shared,sprite,open,flush,calls,events,change:value=>changed(value),initial:value=>initialResolve(value),get mounted(){return mounted;},get unsubscribed(){return unsubscribed;},get closed(){return closed;}};
}

test('原sprite真实右键出现启动演出菜单，中英文模式及预览沿原onMenuAction接到桥',async()=>{
 for(const [locale,label]of [['en','Startup scene'],['zh-CN','启动演出']]){
  const f=fixture({locale});await f.flush();const menu=f.open(),entry=menu.tree.find(node=>node.label===label);assert.ok(entry);assert.equal(entry.children.length,4);assert.equal(entry.children[2].label.startsWith('✓ '),true);
  menu.onAction(entry.children[0]);await f.flush();assert.deepEqual(f.calls,[['mode','pet']]);assert.equal(f.closed,1);
  f.open().onAction(entry.children[3]);await f.flush();assert.deepEqual(f.calls.at(-1),['preview']);assert.equal(f.closed,2);
  assert.equal(f.open().tree.find(node=>node.label===label).children[0].label.startsWith('✓ '),true);
 }
});

test('WorkBuddy完整装饰链将启动与长动作管理项收进控制中心，保留余额和快捷互动',async()=>{
 const f=fixture({host:'workbuddy'});await f.flush();const tree=f.open().tree;
 assert.ok(tree.find(node=>node.action==='pet-control-center'));assert.ok(!tree.some(node=>['Startup scene','Companion app','Actions'].includes(node.label)));assert.ok(tree.find(node=>node.anim==='idle'));
 assert.equal(tree.find(node=>node.action==='open-site')?.label,'Open WorkBuddy');
 assert.ok(tree.some(node=>node.action==='show-balance'));assert.ok(!tree.some(node=>['chat','whisper','codex-task-panel'].includes(node.action)));
 // 即使只剩稳定工具ID，最后一层仍移除后来追加的管理菜单。
 f.shared.mountContextMenu({tree:[{action:'home'},{action:'reload'}]});
 assert.ok(f.mounted.tree.find(node=>node.action==='pet-control-center'));assert.ok(!f.mounted.tree.some(node=>node.label==='Startup scene'));
});

test('启动偏好广播优先于迟到初始GET，卸载释放订阅，第三方小菜单不追加启动项',async()=>{
 const f=fixture({deferInitial:true});f.change({mode:'startup',locale:'en'});f.initial({mode:'pet',locale:'zh-CN'});await f.flush();
 const entry=f.open().tree.find(node=>node.label==='Startup scene');assert.equal(entry.children[1].label.startsWith('✓ '),true);
 const foreign={tree:[{action:'third-party',label:'Custom'}]};f.shared.mountContextMenu(foreign);assert.equal(f.mounted,foreign);assert.equal(f.mounted.tree.length,1);
 f.events.get('beforeunload')();assert.equal(f.unsubscribed,1);
});
