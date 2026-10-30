import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const patcher=await import('../scripts/startup-runtime-patch.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return{};throw error;});
const fixture=`const windows=new Map();let tray=null;const codexPanelRequest=()=>{};const DPI_PROBE=false;
function createPetWindows() { calls.push('pet'); }
async function startTray(){tray={destroy(){calls.push('tray-destroy')}};tray.setContextMenu=menu=>calls.push(menu);const pets=[{id:'main',name:'Dragon Girl',display:'desktop'}];
tray.setContextMenu(Menu.buildFromTemplate(
        pets.map((pet) => ({
          label: pet.name || pet.id,
          type: 'checkbox',
          checked: isDesktopDisplay(pet.display),
          click: () => traySetPetDisplay(pet.id, toggleDisplay(pet.display)),
        })),
      ));}
app.whenReady().then(()=>{createPetWindows();void startTray();});
app.on('window-all-closed', () => {
  if (tray) return;
  app.quit();
});`;
test('运行时实际入口按模式门控宠物，原托盘项保留且模式切换可恢复窗口',async()=>{
 assert.equal(typeof patcher.patchStartupMain,'function');
 const calls=[];let ready,options;const controller={petEnabled:()=>false,trayItems:()=>[{label:'Startup scene'}]};
 let preview;const media={setPreview:fn=>{preview=fn;}};
 const context={calls,__dirname:'synthetic-helper',electronApi:{},codexPetHost:{get:()=>({host:'codex'})},process:{env:{DSH_HOME:'test-data'}},app:{whenReady:()=>({then:fn=>{ready=fn;}}),on(){},quit(){}},Menu:{buildFromTemplate:items=>items},isDesktopDisplay:()=>true,traySetPetDisplay(){},toggleDisplay(){},require:name=>{if(name==='./startup-media.cjs')return{install:value=>{assert.equal(value.electron,context.electronApi);assert.equal(value.host(),'codex');return media;}};assert.equal(name,'./codex-startup.cjs');return{install:value=>{options=value;return controller;}};}};
 const once=patcher.patchStartupMain(fixture);assert.equal(patcher.patchStartupMain(once),once);vm.runInNewContext(once,context);await ready();
 assert.equal(options.media,media);assert.equal(typeof preview,'function');
 assert.equal(calls.includes('pet'),false);const menu=calls.find(Array.isArray);assert.equal(menu[0].label,'Dragon Girl');assert.equal(menu.at(-1).label,'Startup scene');
 controller.petEnabled=()=>true;options.onPetEnabled(true);assert.equal(calls.filter(value=>value==='pet').length,1);
 vm.runInNewContext('windows.set("main",{isDestroyed(){return false;},destroy(){calls.push("destroy-pet")}})',context);options.onPetEnabled(false);assert.equal(calls.at(-1),'destroy-pet');
 await options.onModeChanged();assert.ok(calls.includes('tray-destroy'));
});

test('仅演出模式在托盘异步重建期间关闭最后窗口仍常驻，桌宠模式保留原退出语义',()=>{
 const calls=[],events=new Map();let enabled=false;
 const controller={petEnabled:()=>enabled,trayItems:()=>[]};
 const media={setPreview(){}};
 const context={calls,__dirname:'synthetic-helper',electronApi:{},codexPetHost:{get:()=>({host:'codex'})},process:{env:{DSH_HOME:'test-data'}},app:{whenReady:()=>({then(){}}),on:(event,fn)=>events.set(event,fn),quit:()=>calls.push('quit')},require:name=>({install:()=>name==='./startup-media.cjs'?media:controller})};
 vm.runInNewContext(patcher.patchStartupMain(fixture),context);
 events.get('window-all-closed')();assert.deepEqual(calls,[]);
 enabled=true;events.get('window-all-closed')();assert.deepEqual(calls,['quit']);
});
test('固定上游main可安全补丁与编译，锚点升级不能静默漏接',async()=>{
 assert.equal(typeof patcher.patchStartupMain,'function');
 const main=await readFile(new URL('../node_modules/dsh-pet/runtime/electron-helper/main.js',import.meta.url),'utf8');
 const patched=patcher.patchStartupMain(main);assert.doesNotThrow(()=>new vm.Script(patched));assert.throws(()=>patcher.patchStartupMain('function renamed() {}'),/启动演出.*定位失败/);
});
