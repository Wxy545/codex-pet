import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
import {readUpstream,upstreamVersion} from './support/harness-upstream.mjs';
import {prepareHarnessDependency} from '../harness/motion-fix.mjs';
import {patchModularMain,patchModularMouseRelease,patchModularSandbox,patchModularUserData,validateModularDpi,validateModularMain,validateModularMotion} from '../harness/modular-runtime-fix.mjs';
const files=['lib/client.js','lib/index.js','runtime/electron-helper/shared-core.js','runtime/electron-helper/sprite/motion.js','runtime/electron-helper/main.js','runtime/electron-helper/main/dpi.js','runtime/electron-helper/main/user-data.js'];
if(upstreamVersion==='0.4.1')files.push('runtime/electron-helper/sprite/input.js','runtime/electron-helper/index.html');
if(['0.4.3','0.4.5','0.4.6'].includes(upstreamVersion))files.push(...['sprite.js','sprite/input.js','sprite/window-fit.js','sprite/playback.js','index.html'].map(name=>'runtime/electron-helper/'+name));
if(upstreamVersion==='0.4.6')files.push(...['events.js','preload.js','main/ipc.js','main/windows.js','sprite/init.js'].map(name=>'runtime/electron-helper/'+name));
function fixture(t){
 const root=fs.mkdtempSync(join(tmpdir(),'harness-runtime-fixes-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const profile=join(root,'profile'),pkg=join(profile,'node_modules/dsh-pet');fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(join(profile,'package.json'),'{}');fs.writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'dsh-pet',version:upstreamVersion,exports:{'./package.json':'./package.json'}}));const original={};for(const name of files){fs.mkdirSync(dirname(join(pkg,name)),{recursive:true});original[name]=readUpstream(name);fs.writeFileSync(join(pkg,name),original[name]);}return{root,profile,pkg,original};
}
test('0.4真实新模块的目标插值和DPI保护均显式核验，不替换旧整份runtime',()=>{
 for(const [name,fn,options]of[['lib/client.js',validateModularMotion,{browser:true}],['runtime/electron-helper/sprite/motion.js',validateModularMotion],['runtime/electron-helper/main/dpi.js',validateModularDpi],['runtime/electron-helper/main.js',validateModularMain]]){const s=readUpstream(name);assert.equal(fn(s,options),s);assert.throws(()=>fn(s+s,options),/anchor/);assert.throws(()=>fn('unknown',options),/anchor/);}
});
function mouseHarness(){
 const patched=patchModularMouseRelease(readUpstream('lib/client.js')),listeners=new Set(),calls={settled:0,stopped:0,removed:0};
 const start=patched.indexOf('let mousePressHit = null;'),end=patched.indexOf('/** 触屏长按',start),releaseStart=patched.indexOf('const endPress = (c, point) => {',end),releaseEnd=patched.indexOf('\n\tconst onClick =',releaseStart);
 assert.ok(start>0&&releaseEnd>releaseStart);const press={active:true,dragging:true},hit={classList:{remove(){calls.removed++;}}};const card=()=>({setDragging(){},stage:()=>null,resumeWork:()=>true});
 const api=new Function('window','card','press','follow','touchPress','performance','JUST_DRAGGED_MS','settleRelease','restoreTip',patched.slice(start,end)+ '\nlet justDraggedUntil=0;\n'+patched.slice(releaseStart,releaseEnd)+'\nreturn{arm:armMouseFallback,up:onPointerUp,clear:clearMouseFallback};')({addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)},card,press,{stop(){calls.stopped++;}},{cancel(){}},{now:()=>1},100,()=>calls.settled++,()=>{});
 return{...api,press,hit,listeners,calls,mouseup:buttons=>[...listeners].forEach(fn=>fn({button:0,buttons,clientX:40,clientY:50}))};
}
test('0.4鼠标兜底保留正常/丢失up、左右键组合及卸载清理，不重复结算运动',()=>{
 const f=mouseHarness();f.arm(f.hit);f.mouseup(1);assert.equal(f.press.active,true);f.mouseup(2);assert.equal(f.press.active,false);assert.equal(f.calls.settled,1);assert.equal(f.listeners.size,0);f.up({currentTarget:f.hit,clientX:40,clientY:50});assert.equal(f.calls.settled,1);
 const g=mouseHarness();g.arm(g.hit);g.clear();g.mouseup(0);assert.equal(g.calls.settled,0);assert.equal(g.listeners.size,0);
 const s=readUpstream('lib/client.js'),p=patchModularMouseRelease(s);assert.equal(patchModularMouseRelease(p),p);assert.throws(()=>patchModularMouseRelease(s+s),/anchor/);
});
test('0.4 userData探测只清自有随机文件，探测失败保留原文件且不能假报可写',t=>{
 const root=fs.mkdtempSync(join(tmpdir(),'harness-probe-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const existing=join(root,'.dsh-pet-write-probe');fs.writeFileSync(existing,'user content');const src=patchModularUserData(readUpstream('runtime/electron-helper/main/user-data.js'));
 const context={module:{exports:{}},require};vm.runInNewContext(src,context);assert.equal(context.module.exports.isWritableDir(root),true);assert.equal(fs.readFileSync(existing,'utf8'),'user content');assert.deepEqual(fs.readdirSync(root),['.dsh-pet-write-probe']);
 let unlinks=0;const failed={mkdirSync(){},openSync(){throw Error('denied');},unlinkSync(){unlinks++;}};assert.equal(context.module.exports.isWritableDir(root,{fs:failed}),false);assert.equal(unlinks,0);assert.equal(patchModularUserData(src),src);assert.throws(()=>patchModularUserData(src.replace('0o600','0o644')),/anchor/);
});
test('0.4 helper失败不自动关闭沙箱，两处实际函数行为及幂等核验',()=>{
 const src=readUpstream('lib/index.js'),patched=patchModularSandbox(src);assert.equal(patchModularSandbox(patched),patched);assert.throws(()=>patchModularSandbox(src+src),/anchor/);
 const f=/function shouldFallbackToNoSandbox\(input\) \{[\s\S]*?\n\}/.exec(patched)[0];const decide=new Function(f+';return shouldFallbackToNoSandbox;')();assert.equal(decide({code:0xc0000005,ranMs:0}),false);
 const launch=patched.slice(patched.indexOf('function helperLaunchArgs('),patched.indexOf('\n}',patched.indexOf('function helperLaunchArgs('))+2);assert.ok(launch);const args=new Function(launch+';return helperLaunchArgs;')();assert.deepEqual(args(['file.js'],{sandboxFallback:true}),['file.js']);
});
test('Harness全部模块锚点通过后才落盘，坏DPI不会留下client、host或profile半补丁',t=>{const f=fixture(t),name='runtime/electron-helper/main/dpi.js';fs.writeFileSync(join(f.pkg,name),'unfamiliar');assert.throws(()=>prepareHarnessDependency({profileDir:f.profile}),/anchor/);for(const n of files.filter(n=>n!==name))assert.equal(fs.readFileSync(join(f.pkg,n),'utf8'),f.original[n]);});
test('Harness原子更新断开已改文件硬链接，保留共享store及其它profile，二次不写',t=>{
 const f=fixture(t),store=join(f.root,'store');fs.mkdirSync(store);for(const[i,n]of files.entries())fs.linkSync(join(f.pkg,n),join(store,String(i)));const first=prepareHarnessDependency({profileDir:f.profile});assert.equal(first.status,'updated');assert.ok(first.files.includes('lib/client.js'));assert.ok(first.files.includes('lib/index.js'));assert.ok(first.files.includes('runtime/electron-helper/shared-core.js'));assert.ok(first.files.includes('runtime/electron-helper/main/user-data.js'));
 for(const[i,n]of files.entries()){assert.equal(fs.readFileSync(join(store,String(i)),'utf8'),f.original[n]);if(first.files.includes(n))assert.notEqual(fs.statSync(join(f.pkg,n)).ino,fs.statSync(join(store,String(i))).ino);}const snapshots=files.map(n=>fs.statSync(join(f.pkg,n)).ino);assert.equal(prepareHarnessDependency({profileDir:f.profile}).status,'current');files.forEach((n,i)=>assert.equal(fs.statSync(join(f.pkg,n)).ino,snapshots[i]));
});

test('0.4实际main的getPath抛错仍进入原生私有目录fallback，不启动Electron',t=>{
 const root=fs.mkdtempSync(join(tmpdir(),'harness-main-fallback-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const user={module:{exports:{}},require};vm.runInNewContext(patchModularUserData(readUpstream('runtime/electron-helper/main/user-data.js')),user);const src=patchModularMain(readUpstream('runtime/electron-helper/main.js')),start=src.indexOf('const userDataDecision = resolveUserDataDir({'),end=src.indexOf('\n});',start)+4;const context={app:{getPath(){throw Error('unavailable');}},resolveUserDataDir:user.module.exports.resolveUserDataDir,dshHomeDir:()=>root,APP_MODE:false};vm.runInNewContext(src.slice(start,end)+';globalThis.result=userDataDecision;',context);assert.equal(context.result.fallback,true);assert.equal(context.result.dir,join(root,'dsh-pet','electron-profile'));assert.equal(patchModularMain(src),src);
});
