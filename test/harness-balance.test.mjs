import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,linkSync,statSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {createNativeFooter,localizeBalanceShared,patchNativeWebBalance,prepareHarnessBalance} from '../harness/native-balance.mjs';
const sourceRoot=new URL('../',import.meta.url),read=name=>readFileSync(new URL(name,sourceRoot),'utf8');
const statusContext={module:{exports:{}}};vm.runInNewContext(read('src/pet-status-strip.js'),statusContext);const status=statusContext.module.exports;
const sharedContext={};vm.runInNewContext(read('node_modules/dsh-pet/runtime/electron-helper/shared-core.js'),sharedContext);const shared=sharedContext.PetShared;
const text=node=>node==null||node===false?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
const rt={h:(tag,props)=>({tag,props}),useState:()=>[true,()=>{}],useRef:()=>({current:null}),useEffect:()=>{}};

test('Harness脚下条直接显示原生金额、积分和全部额度窗口，缺失不伪造余额或系统监控',()=>{
 for(const locale of ['zh-CN','en']){
  const Footer=createNativeFooter(rt,status,localizeBalanceShared(shared,locale),locale);
  const money=text(Footer({enabled:true,size:320,balance:{ok:true,shape:'money',provider:'synthetic',wallets:[{currency:'CNY',total:'9.37',granted:'0',toppedUp:'9.37'}]}}));assert.match(money,/9\.37/);
  const points=text(Footer({enabled:true,size:320,balance:{ok:true,shape:'points',provider:'synthetic',points:{total:'800',unit:'积分',full:'1000'}}}));assert.match(points,/800/);assert.doesNotMatch(points,/¥|\$/);
  const windows=text(Footer({enabled:true,size:320,balance:{ok:true,shape:'windows',provider:'synthetic',rolling:20,weekly:65,monthly:10,rollingLabel:'5h'}}));assert.match(windows,/80%/);assert.match(windows,/35%/);assert.match(windows,/90%/);
  const unknown=text(Footer({enabled:true,size:320,balance:{ok:false,provider:'synthetic',reason:'unsupported',message:'secret-not-for-display'}}));assert.doesNotMatch(unknown,/\d|CPU|MEM|GPU|secret-not-for-display/);
  if(locale==='en'){assert.doesNotMatch(money+points+windows+unknown,/[\u3400-\u9fff]/);assert.match(windows,/Week/);assert.match(windows,/Month/);}
  assert.equal(Footer({enabled:false,size:320,balance:null}),null);
 }
});

const webFixture='function makePetUI(rt) {\n\tconst { h, useState, useEffect, useRef } = rt;\n\tinjectCss$1();\nfunction PetCard() {\n\t\tconst [size, setSize] = useState(cfg.size);\nconst rootStyle={top: ry * window.innerHeight - halfH + "px"};\nconst anchor={"--dsh-pet-my": margin.y + "px"};\nconst bounds = throwBounds({\n\t\t\t\tW: window.innerWidth,\n\t\t\t\tH: window.innerHeight,\n});\nif (bubbleOn && balance && (cfg.balanceEnabled || balanceManual)) return h(BalanceBubble, {});\nreturn h("div", {children: [\n\t\t\t\tbubbleNode,\n]});}}';
test('原生web补丁保留工作与碎念气泡及原余额档位事件，只移走头顶余额，幂等且锚点异常停止',()=>{
 const options={statusScript:read('src/pet-status-strip.js'),statusCss:read('src/pet-status-strip.css'),locale:'en'};
 const source=patchNativeWebBalance(webFixture,options);assert.match(source,/h\(CodexNativeBalanceFooter/);assert.match(source,/!cfg\.balanceEnabled && bubbleOn/);assert.match(source,/nativeFooterSpace/);assert.doesNotMatch(source,/fetch\(|credentials|CODEX_HOME/);
 assert.equal(patchNativeWebBalance(source,options),source);assert.throws(()=>patchNativeWebBalance(webFixture.replace('bubbleNode,','differentNode,'),options),/anchor/);new vm.Script(source);
});

function profileFixture(t){
 const dir=mkdtempSync(join(tmpdir(),'native-balance-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const profileDir=join(dir,'profile'),pkg=join(profileDir,'node_modules','dsh-pet'),bundle=join(dir,'bundle');
 mkdirSync(join(pkg,'runtime','electron-helper'),{recursive:true});mkdirSync(join(pkg,'lib'));mkdirSync(join(bundle,'runtime'),{recursive:true});
 writeFileSync(join(profileDir,'package.json'),'{"private":true}');writeFileSync(join(pkg,'package.json'),'{"name":"dsh-pet","version":"0.3.8","exports":{"./package.json":"./package.json"}}');
 writeFileSync(join(pkg,'lib','client.js'),webFixture);writeFileSync(join(pkg,'runtime','electron-helper','sprite.js'),'this.margin = { t: Math.max(m, S.bubbleTopMarginPx(fontConf, this.size)), r: m, b: m, l: m };\nconst controls=".dsh-pet-menu-column, .dsh-pet-chat, .pet-bubble.is-clickable";');
 writeFileSync(join(pkg,'runtime','electron-helper','index.html'),'<head></head><body><script src="./renderer.js"></script></body>');
 for(const name of ['pet-status-strip.js','pet-status-strip.css'])writeFileSync(join(bundle,'runtime',name),read('src/'+name));
 return{dir,profileDir,pkg,bundle};
}
test('适配只原子替换选中profile依赖，复制共用footer并在renderer前加载，重复执行不改文件',t=>{
 const f=profileFixture(t),client=join(f.pkg,'lib','client.js'),outside=join(f.dir,'shared-store-client.js');linkSync(client,outside);const before=readFileSync(outside,'utf8');
 const first=prepareHarnessBalance({profileDir:f.profileDir,sourceRoot:f.bundle,locale:'en'});assert.equal(first.status,'updated');assert.ok(first.files.includes('lib/client.js'));assert.equal(readFileSync(outside,'utf8'),before);assert.notEqual(statSync(client).ino,statSync(outside).ino);
 const html=readFileSync(join(f.pkg,'runtime','electron-helper','index.html'),'utf8');assert.ok(html.indexOf('codex-pet-status-strip.js')<html.indexOf('./renderer.js'));const helper=readFileSync(join(f.pkg,'runtime','electron-helper','codex-pet-status-strip.js'),'utf8');assert.match(helper,/getLocale/);assert.doesNotMatch(helper,/fetch\(|127\.0\.0\.1|codex-character/);new vm.Script(helper);
 assert.equal(prepareHarnessBalance({profileDir:f.profileDir,sourceRoot:f.bundle,locale:'en'}).status,'current');
});

test('任何原生余额补丁锚点不符时，所有文件均不落盘',t=>{
 const f=profileFixture(t),file=join(f.pkg,'runtime','electron-helper','sprite.js'),client=join(f.pkg,'lib','client.js'),before=readFileSync(client,'utf8');writeFileSync(file,'unknown sprite');
 assert.throws(()=>prepareHarnessBalance({profileDir:f.profileDir,sourceRoot:f.bundle,locale:'en'}),/anchor/);assert.equal(readFileSync(client,'utf8'),before);
});

test('原生包内部目录链接到profile外时拒绝写入，保留外部文件与其余原生文件',t=>{
 const f=profileFixture(t),outside=join(f.dir,'outside'),client=join(f.pkg,'lib','client.js'),before=readFileSync(client,'utf8');mkdirSync(outside);writeFileSync(join(outside,'client.js'),before);rmSync(join(f.pkg,'lib'),{recursive:true});symlinkSync(outside,join(f.pkg,'lib'),process.platform==='win32'?'junction':'dir');
 assert.throws(()=>prepareHarnessBalance({profileDir:f.profileDir,sourceRoot:f.bundle,locale:'en'}),/outside-profile/);assert.equal(readFileSync(join(outside,'client.js'),'utf8'),before);assert.doesNotMatch(readFileSync(join(f.pkg,'runtime','electron-helper','index.html'),'utf8'),/codex-pet-status/);
});
