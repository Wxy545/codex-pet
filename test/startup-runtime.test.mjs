import {patchHelper049} from '../scripts/prepare-runtime-049.mjs';
import {patchHelper048} from '../scripts/prepare-runtime-048.mjs';
import {patchHelper047} from '../scripts/prepare-runtime-047.mjs';
import {patchHelper046} from '../scripts/prepare-runtime-046.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {patchHelper040} from '../scripts/prepare-runtime-040.mjs';
import {patchHelper041} from '../scripts/prepare-runtime-041.mjs';
import {patchHelper043} from '../scripts/prepare-runtime-043.mjs';
import {patchHelper045} from '../scripts/prepare-runtime-045.mjs';
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
 const packageRoot=resolve(process.env.CODEX_PET_UPSTREAM_FIXTURE||'node_modules/dsh-pet'),meta=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8'));
 if(['0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9'].includes(meta.version)){
  const patchHelper={'0.4.0':patchHelper040,'0.4.1':patchHelper041,'0.4.3':patchHelper043,'0.4.9':patchHelper049,'0.4.8':patchHelper048,'0.4.7':patchHelper047,'0.4.6':patchHelper046,'0.4.5':patchHelper045}[meta.version];
  const files=Object.fromEntries(await Promise.all(['main.js','main/tray.js','main/bridge.js','main/ipc.js','main/dpi.js','main/user-data.js','sprite.js','sprite/motion.js','sprite/menu.js','sprite/playback.js','sprite/bubble.js','sprite/input.js','events.js','shared-core.js','index.html',...(['0.4.3','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9'].includes(meta.version)?['sprite/init.js','sprite/window-fit.js']:[]),...(['0.4.6','0.4.7','0.4.8','0.4.9'].includes(meta.version)?['main/windows.js','preload.js']:[]),...(['0.4.7','0.4.8','0.4.9'].includes(meta.version)?['renderer.js']:[]),...(['0.4.8','0.4.9'].includes(meta.version)?['main/displays.js','pointer-target.js']:[]),...(meta.version==='0.4.9'?['constants.js']:[])].map(async name=>[name,await readFile(join(packageRoot,'runtime/electron-helper',name),'utf8')]))),prepared=patchHelper(files),patched=prepared['main.js'];
  if(['0.4.3','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9'].includes(meta.version)){const scripts=[...prepared['index.html'].matchAll(/<script src="(?:\.\/)?([^"]+)"/g)].map(row=>row[1]);for(const[name,next]of [['sprite.js','sprite/window-fit.js'],['sprite/window-fit.js','sprite/init.js'],['sprite/menu.js','codex-skin-renderer.js']]){assert.ok(scripts.includes(name)&&scripts.includes(next));assert.ok(scripts.indexOf(name)<scripts.indexOf(next));}}
  assert.doesNotThrow(()=>new vm.Script(patched));assert.match(patched,/if\(codexStartup.petEnabled\(\)\)petWindows.create\(\)/);assert.match(patched,/if \(tray.exists\(\) \|\| !codexStartup.petEnabled\(\)\) return/);
  const from=patched.indexOf('onPetEnabled:')+'onPetEnabled:'.length,to=patched.indexOf(',onModeChanged:',from),calls=[],windows=new Map();assert.ok(from>0&&to>from);
  const change=vm.runInNewContext('('+patched.slice(from,to)+')',{windows,petWindows:{create:()=>calls.push('create')}});
  change(true);assert.deepEqual(calls,['create']);windows.set('main',{isDestroyed:()=>false,destroy:()=>calls.push('destroy')});change(true);assert.deepEqual(calls,['create']);change(false);assert.deepEqual(calls,['create','destroy']);
  assert.throws(()=>patchHelper({...files,'main.js':'function renamed() {}'}),/anchor|锚点|定位/);return;
 }
 const main=await readFile(join(packageRoot,'runtime/electron-helper/main.js'),'utf8');
 const patched=patcher.patchStartupMain(main);assert.doesNotThrow(()=>new vm.Script(patched));assert.throws(()=>patcher.patchStartupMain('function renamed() {}'),/启动演出.*定位失败/);
});
