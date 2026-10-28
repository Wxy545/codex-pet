'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const C=require('./codex-character.cjs'),L=require('./codex-locale.cjs');
const {createSkinStore}=require('./codex-skins.cjs');
const {pathToFileURL}=require('node:url');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-character-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
  const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1200,16);png.writeUInt32BE(1200,20);
  L.setLocale('zh-CN');return{root,write,png};
}
test('无选择默认原鲸鱼，显式龙娘在素材有效时生效，缺图和无效清单回原鲸',async t=>{
 const f=fixture(t);f.write('skins/white-dragon/sprites.png',f.png);
 assert.equal(C.readCharacter(f.root).id,'bluefish');
 f.write('skins/selection.json',{character:'white-dragon',mode:'q'});
 assert.equal(C.readCharacter(f.root).id,'white-dragon');
 const store=createSkinStore({dataRoot:f.root});assert.deepEqual((await store.readModel()).selection,C.readCharacter(f.root).selection);
 const model=await store.readModel();assert.equal(model.locale,'zh-CN');assert.equal(model.characters.find(c=>c.id==='white-dragon').copy.name,'白龙娘');assert.equal(model.characters.find(c=>c.id==='white-dragon').copy.actionLabels['蓝鲸现世'],'召唤小蓝鲸');
 f.write('skins/white-dragon/manifest.json','{broken');
 assert.equal(C.readCharacter(f.root).id,'bluefish');
 assert.deepEqual((await store.readModel()).selection,C.readCharacter(f.root).selection);
});
test('姐姐和偶尔变身仅在有效对应素材存在时生效，不借用Q版rects',t=>{
 const f=fixture(t);f.write('skins/white-dragon/sprites.png',f.png);f.write('skins/selection.json',{character:'white-dragon',mode:'sister'});
 assert.equal(C.readCharacter(f.root).id,'bluefish');
 f.write('skins/white-dragon/sister.png',f.png);assert.equal(C.readCharacter(f.root).id,'white-dragon');
 f.write('skins/selection.json',{character:'white-dragon',mode:'occasional'});assert.equal(C.readCharacter(f.root).id,'white-dragon');
});
test('已知鱼默认只投影显示，不改自定义昵称、人设或磁盘文件',t=>{
 const f=fixture(t);f.write('skins/white-dragon/sprites.png',f.png);f.write('skins/selection.json',{character:'white-dragon',mode:'q'});
 const file='dsh-pet/main-config.jsonc';f.write(file,{pets:[{id:'main',name:'蓝色大肥鱼',whisperPrompt:'你是王工桌面上的蓝色大肥鱼，爱吃饭也爱摸鱼。不称主人，称王工。'}]});
 const before=fs.readFileSync(path.join(f.root,file),'utf8');const c=C.readCharacter(f.root);assert.equal(c.name,'白龙娘');assert.ok(c.persona.includes(JSON.stringify('你是王工桌面上的蓝色大肥鱼，爱吃饭也爱摸鱼。不称主人，称王工。')));assert.match(c.persona,/称王工/);assert.equal(fs.readFileSync(path.join(f.root,file),'utf8'),before);
 f.write(file,{pets:[{id:'main',name:'小月',whisperPrompt:'喜欢园艺，也爱讲冷笑话。'}]});const custom=C.readCharacter(f.root);assert.equal(custom.name,'小月');assert.match(custom.persona,/喜欢园艺/);assert.match(custom.persona,/白龙娘/);assert.match(custom.persona,/你的名字是小月/);
 assert.deepEqual(Object.keys(C.safeIdentity(custom)).sort(),['id','locale','name']);
});
test('白龙与蓝鱼中英文性格区分，英文显示名与词库一致且不搬中文吃白饭梗',()=>{
 const dragon=C.characterCopy('white-dragon','zh-CN'),blue=C.characterCopy('bluefish','zh-CN');
 assert.match(dragon.persona,/温和聪明.*好奇.*翻书和记事/);assert.match(dragon.persona,/冷幽默/);assert.doesNotMatch(dragon.persona,/爱吃饭|爱偷闲|摸鱼/);
 assert.match(blue.persona,/爱吃饭和零食.*爱偷闲/);assert.match(blue.persona,/俏皮/);assert.doesNotMatch(blue.persona,/翻书和记事/);
 const enDragon=C.characterCopy('white-dragon','en'),enBlue=C.characterCopy('bluefish','en');
 assert.equal(enDragon.name,'Dragon Girl');assert.equal(enBlue.name,'Blue');assert.match(enDragon.persona,/curious and quietly witty/);assert.match(enDragon.persona,/browsing books and keeping notes/);assert.match(enBlue.persona,/snack-loving and playful/);assert.doesNotMatch(enDragon.persona,/snack-loving/);assert.doesNotMatch(enBlue.persona,/rice|freeload/i);
});
test('两份精确旧默认不会残留进白龙人设，类似自定义追加原文仍保留且不写磁盘',t=>{
 const f=fixture(t);f.write('skins/white-dragon/sprites.png',f.png);f.write('skins/selection.json',{character:'white-dragon',mode:'q'});
 const defaults=['你是桌面上的蓝色大肥鱼，爱吃饭也爱摸鱼。说话俏皮自然，偶尔傲娇，不装腔。每次碎碎念20字以内。','你是主人桌面上的Q版蓝发小女仆，会时不时碎碎念一句。说话要自然随意、短短一句（20字以内），温柔乖巧带点俏皮，说人话不啰嗦，不要解释你自己，不要提你是AI。'];
 for(const prompt of defaults){
   const file='dsh-pet/main-config.jsonc';f.write(file,{pets:[{id:'main',name:'蓝色大肥鱼',whisperPrompt:prompt}]});const before=fs.readFileSync(path.join(f.root,file),'utf8');
   const dragon=C.readCharacter(f.root);assert.doesNotMatch(dragon.persona,/蓝色大肥鱼|爱吃饭|爱摸鱼|蓝发小女仆|Custom tone notes|自定义语气资料/);assert.match(dragon.persona,/翻书和记事/);assert.equal(fs.readFileSync(path.join(f.root,file),'utf8'),before);
   const custom=prompt+' 请称呼我为小林，喜欢讲园艺笑话。';f.write(file,{pets:[{id:'main',name:'小月',whisperPrompt:custom}]});const customBefore=fs.readFileSync(path.join(f.root,file),'utf8');
   const projected=C.readCharacter(f.root);assert.ok(projected.persona.includes(JSON.stringify(custom)));assert.equal(projected.name,'小月');assert.equal(fs.readFileSync(path.join(f.root,file),'utf8'),customBefore);
 }
});
test('白龙停用鱼meme；英文还停用中文文字视频，原配置对象与技术ID不改',t=>{
 const f=fixture(t);f.write('skins/white-dragon/sprites.png',f.png);f.write('skins/selection.json',{character:'white-dragon',mode:'q'});
 const config={main:{pets:[{id:'main',name:'蓝色大肥鱼'}],memes:{'哦鲸鲸':'原鱼梗图'},whisperImageEnabled:true,chatImageEnabled:true,animations:{categories:[{id:'文字',actions:['是啊，吃什么']},{id:'小动作',actions:['用鲸鱼尾巴拍打地面']}]}}};
 const next=C.projectConfig(config,{dataRoot:f.root});assert.equal(next.main.pets[0].name,'白龙娘');assert.deepEqual(next.main.memes,{});assert.equal(next.main.chatImageEnabled,false);assert.equal(config.main.chatImageEnabled,true);assert.equal(config.main.pets[0].name,'蓝色大肥鱼');
 L.setLocale('en');const en=C.projectConfig(config,{dataRoot:f.root});assert.equal(en.main.animations.categories.length,1);assert.equal(en.main.animations.categories[0].actions[0],'用鲸鱼尾巴拍打地面');assert.match(en.main.pets[0].whisperPrompt,/English/);
 const copy=C.characterCopy('white-dragon','en');assert.equal(copy.actionLabels['蓝鲸现世'],'Summon a tiny whale');
});
test('Q和姐姐使用同一身份桶，语言和角色变化可使在途回复失效',()=>{
 assert.equal(C.characterKey({id:'white-dragon',locale:'en',mode:'q'}),C.characterKey({id:'white-dragon',locale:'en',mode:'sister'}));
 assert.notEqual(C.characterKey({id:'white-dragon',locale:'en'}),C.characterKey({id:'bluefish',locale:'en'}));
 assert.equal(C.changedResult('en').reason,'character-changed');
});
test('跨角色选择清除旧气泡，Q与姐姐切换保留同身份气泡并通知native回调',async t=>{
 const f=fixture(t);f.write('skins/white-dragon/sprites.png',f.png);f.write('skins/white-dragon/sister.png',f.png);
 const handlers=new Map(),requests=[],changed=[];
 const hostRequest=async(method,route)=>{requests.push([method,route]);return {status:200,body:JSON.stringify(method==='GET'?{main:{pets:[{id:'main'}],animations:{idle:['呼吸'],moves:{actions:[]}}}}:{ok:true})};};
 const electronApi={ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler(){}},BrowserWindow:{getAllWindows:()=>[]},app:{once(){}}};
 require('./codex-skins.cjs').install({dataRoot:f.root,hostRequest,electronApi,onSelectionChanged:model=>changed.push(model.selection.character)});
 const frame={},sender={mainFrame:frame,getURL:()=>pathToFileURL(path.join(__dirname,'index.html')).href},event={sender,senderFrame:frame};
 await handlers.get('codex-skin:select')(event,{character:'white-dragon',mode:'q'});
 await handlers.get('codex-skin:select')(event,{character:'white-dragon',mode:'sister'});
 assert.deepEqual(requests.filter(([method])=>method==='POST'),[['POST','/dsh-pet-7340/bubble/clear?pet=main']]);assert.deepEqual(changed,['white-dragon','white-dragon']);
});
test('系统语言用Windows UI Culture一次查询，中文归一，其他语言使用英文且隐藏PowerShell窗口',()=>{
 let calls=0;const run=(file,args,options)=>{calls++;assert.equal(file,'powershell.exe');assert.ok(args.at(-1).includes('Get-UICulture'));assert.equal(options.windowsHide,true);assert.equal(options.shell,false);return 'zh-TW\r\n';};
 assert.equal(L.detectSystemLocale({platform:'win32',execFileSyncImpl:run}),'zh-CN');assert.equal(calls,1);
 assert.equal(L.detectSystemLocale({platform:'win32',execFileSyncImpl:()=> 'de-DE'}),'en');
 assert.equal(L.detectSystemLocale({platform:'win32',execFileSyncImpl:()=>{throw Error();},fallback:()=> 'zh-CN'}),'zh-CN');
 assert.equal(L.detectSystemLocale({platform:'linux',fallback:()=> 'ja-JP'}),'en');
});
