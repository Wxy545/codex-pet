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
test('旧姐姐和偶尔选择在身份读取时归同角色Q，不依赖旧形态文件',t=>{
 const f=fixture(t);f.write('skins/white-dragon/sprites.png',f.png);
 for(const mode of ['sister','occasional']){
  f.write('skins/selection.json',{character:'white-dragon',mode});
  const character=C.readCharacter(f.root);assert.equal(character.id,'white-dragon');assert.equal(character.mode,'q');assert.deepEqual(character.availability['white-dragon'],{q:true});
 }
});
test('Q版透明WebM与身份识别一致，中英文聊天投影保持龙娘而非鱼',async t=>{
 const f=fixture(t);f.write('skins/selection.json',{character:'white-dragon',mode:'q'});
 f.write('skins/white-dragon/manifest.json',{schemaVersion:1,profiles:{idle:{type:'video',file:'q-idle.webm',sisterFile:'sister.png',forms:{sister:{file:'sister.png',columns:4,rows:2,frames:[[0,0],[1,0]],fps:2}}}}});
 f.write('skins/white-dragon/q-idle.webm',Buffer.from('1a45dfa3934282847765626d000000000000','hex'));f.write('skins/white-dragon/sister.png',f.png);
 const store=createSkinStore({dataRoot:f.root}),character=C.readCharacter(f.root);
 assert.equal(character.id,'white-dragon');assert.equal(character.name,'白龙娘');assert.match(character.persona,/白角、龙翼和龙尾/);
 assert.deepEqual((await store.readModel()).selection,character.selection);assert.deepEqual(character.availability['white-dragon'],{q:true});
 const input={main:{pets:[{id:'main',name:'大肥鱼'}]}};const zh=C.projectConfig(input,{dataRoot:f.root});assert.equal(zh.main.pets[0].name,'白龙娘');assert.match(zh.main.pets[0].whisperPrompt,/白龙娘/);assert.doesNotMatch(zh.main.pets[0].whisperPrompt,/鲸鱼娘/);
 L.setLocale('en');const en=C.readCharacter(f.root);assert.equal(en.id,'white-dragon');assert.equal(en.name,'Dragon Girl');assert.match(en.persona,/dragon girl/);
 const english=C.projectConfig(input,{dataRoot:f.root});assert.equal(english.main.pets[0].name,'Dragon Girl');assert.match(english.main.pets[0].whisperPrompt,/dragon girl/);assert.doesNotMatch(english.main.pets[0].whisperPrompt,/whale girl/);
 f.write('skins/white-dragon/q-idle.webm',Buffer.from('1a45dfa3934282846d617472000000000000','hex'));
 const broken=C.readCharacter(f.root);assert.equal(broken.id,'bluefish');assert.equal(broken.availability['white-dragon'].q,false);assert.equal(broken.availability['white-dragon'].sister,undefined);
 f.write('skins/selection.json',{character:'white-dragon',mode:'sister'});assert.equal(C.readCharacter(f.root).id,'bluefish');
});

test('普通走路仅在龙娘菜单显示散步，原鱼动作名保持原映射',()=>{
 assert.equal(C.characterCopy('white-dragon','zh-CN').actionLabels['螃蟹走路'],'散步');
 assert.equal(C.characterCopy('white-dragon','en').actionLabels['螃蟹走路'],'Walk');
 assert.equal(C.characterCopy('bluefish','zh-CN').actionLabels['螃蟹走路'],undefined);
 assert.equal(C.characterCopy('bluefish','en').actionLabels['螃蟹走路'],undefined);
});

test('龙娘五个特色动作使用独立中英文显示名，不改原鱼与核心动作标签',()=>{
 const expected={
  '超大伸懒腰':['整理龙翼','Wing care'],
  '原地小憩沉眠':['抱尾小憩','Curl up for a nap'],
  '凭空生花':['掌心微光','A little magic'],
  '点击回应-害羞惊讶':['害羞卷尾','Shy tail curl'],
  '点击回应-傲娇生气':['叉腰得意','Feeling smug'],
 };
 for(const [locale,index] of [['zh-CN',0],['en',1]]){
  const dragon=C.characterCopy('white-dragon',locale),fish=C.characterCopy('bluefish',locale);
  for(const [id,labels] of Object.entries(expected)){assert.equal(dragon.actionLabels[id],labels[index]);assert.equal(fish.actionLabels[id],undefined);}
  assert.equal(dragon.actionLabels['螃蟹走路'],index?'Walk':'散步');
  assert.equal(dragon.actionLabels['点击回应-开心跃动'],undefined);assert.equal(dragon.actionLabels['东张西望'],undefined);
  assert.equal(fish.actionLabels['用鲸鱼尾巴拍打地面'],index?'Whale tail tap':'用鲸鱼尾巴拍打地面');
  assert.equal(fish.actionLabels['鲸鱼吐泡泡特效'],index?'Whale bubbles':'鲸鱼吐泡泡特效');
 }
});

test('抱书和坐垫两项只替换龙娘日常槽显示名，原鱼保持原动作语义',()=>{
 for(const [locale,reading,rest] of [['zh-CN','抱书阅读','坐垫歇息'],['en','Reading a spellbook','Cushion break']]){
  const dragon=C.characterCopy('white-dragon',locale),fish=C.characterCopy('bluefish',locale);
  assert.equal(dragon.actionLabels['轻快记录'],reading);assert.equal(dragon.actionLabels['悠闲哼歌'],rest);
  assert.equal(fish.actionLabels['轻快记录'],undefined);assert.equal(fish.actionLabels['悠闲哼歌'],undefined);
 }
});
test('无选择优先就绪Q龙娘，显式选择保留，缺图和无效清单回原鲸',async t=>{
 const f=fixture(t);f.write('skins/white-dragon/sprites.png',f.png);
 assert.equal(C.readCharacter(f.root).id,'white-dragon');
 f.write('skins/selection.json',{character:'bluefish',mode:'q'});assert.equal(C.readCharacter(f.root).id,'bluefish');
 f.write('skins/selection.json',{character:'white-dragon',mode:'q'});
 assert.equal(C.readCharacter(f.root).id,'white-dragon');
 const store=createSkinStore({dataRoot:f.root});assert.deepEqual((await store.readModel()).selection,C.readCharacter(f.root).selection);
 const model=await store.readModel();assert.equal(model.locale,'zh-CN');assert.equal(model.characters.find(c=>c.id==='white-dragon').copy.name,'白龙娘');assert.equal(model.characters.find(c=>c.id==='white-dragon').copy.actionLabels['蓝鲸现世'],'召唤小蓝鲸');
 f.write('skins/white-dragon/manifest.json','{broken');
 assert.equal(C.readCharacter(f.root).id,'bluefish');
 assert.deepEqual((await store.readModel()).selection,C.readCharacter(f.root).selection);
});
test('旧选择缺少Q素材时回原鱼且保留请求角色，旧形态图片不能代替Q',t=>{
 const f=fixture(t);f.write('skins/white-dragon/sister.png',f.png);
 for(const mode of ['sister','occasional']){
  f.write('skins/selection.json',{character:'white-dragon',mode});const character=C.readCharacter(f.root);
  assert.equal(character.id,'bluefish');assert.deepEqual(character.requestedSelection,{character:'white-dragon',mode:'q'});
 }
 f.write('skins/white-dragon/sprites.png',f.png);assert.equal(C.readCharacter(f.root).id,'white-dragon');
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
test('白龙停用鱼meme，英文投影保留完整动作供切角色运行期筛选，原配置与技术ID不改',t=>{
 const f=fixture(t);f.write('skins/white-dragon/sprites.png',f.png);f.write('skins/selection.json',{character:'white-dragon',mode:'q'});
 const config={main:{pets:[{id:'main',name:'蓝色大肥鱼'}],memes:{'哦鲸鲸':'原鱼梗图'},whisperImageEnabled:true,chatImageEnabled:true,animations:{categories:[{id:'文字',actions:['是啊，吃什么']},{id:'小动作',actions:['用鲸鱼尾巴拍打地面']}]}}};
 const next=C.projectConfig(config,{dataRoot:f.root});assert.equal(next.main.pets[0].name,'白龙娘');assert.deepEqual(next.main.memes,{});assert.equal(next.main.chatImageEnabled,false);assert.equal(config.main.chatImageEnabled,true);assert.equal(config.main.pets[0].name,'蓝色大肥鱼');
 L.setLocale('en');const en=C.projectConfig(config,{dataRoot:f.root});assert.equal(en.main.animations,config.main.animations);assert.equal(en.main.animations.categories.length,2);assert.equal(en.main.animations.categories[0].actions[0],'是啊，吃什么');assert.match(en.main.pets[0].whisperPrompt,/English/);
 const copy=C.characterCopy('white-dragon','en');assert.equal(copy.actionLabels['蓝鲸现世'],'Summon a tiny whale');
});
test('新增Q版代表动作与事件显示名跟随龙娘身份，英语没有残留原鱼的中文动作名',()=>{
 const pairs={
  '大口吃零食':['吃星形饼干','Star-cookie snack'],'被落叶淹没':['扇翼纳凉','Wing fan'],
  '深度思考碎碎念':['招手眨眼','A little wave'],'点击回应-元气挥手':['招手眨眼','A little wave'],
  '点击回应-挠痒咯咯笑':['怕痒缩肩','Ticklish shrug'],'原地漂浮踏步':['振翼踏步','Wing-assisted steps'],
 };
 for(const [locale,index] of [['zh-CN',0],['en',1]]){
  const dragon=C.characterCopy('white-dragon',locale),fish=C.characterCopy('bluefish',locale);
  for(const [id,labels]of Object.entries(pairs)){assert.equal(dragon.actionLabels[id],labels[index]);assert.equal(fish.actionLabels[id],undefined);}
  assert.equal(dragon.menuLabels['文字'],index?'Greetings':'招呼');assert.equal(fish.menuLabels['文字'],undefined);assert.equal(dragon.sharedAnimationHint,index?'Shared animation':'共用动作');
  const eventIds=require('./skin-action-catalog.json').actions.filter(entry=>['event:balance','event:whisper'].includes(entry.group)).map(entry=>entry.id);
  assert.equal(eventIds.length,9);for(const id of eventIds){assert.ok(dragon.actionLabels[id]);if(index)assert.doesNotMatch(dragon.actionLabels[id],/[\u3400-\u9fff]/);assert.equal(fish.actionLabels[id],undefined);}
 }
});
test('身份桶只按角色和语言区分，角色变化可使在途回复失效',()=>{
 assert.equal(C.characterKey({id:'white-dragon',locale:'en'}),'white-dragon/en');
 assert.notEqual(C.characterKey({id:'white-dragon',locale:'en'}),C.characterKey({id:'bluefish',locale:'en'}));
 assert.equal(C.changedResult('en').reason,'character-changed');
});
test('跨角色选择清除旧气泡，同角色Q选择保留身份且IPC拒绝旧形态',async t=>{
 const f=fixture(t);f.write('skins/white-dragon/sprites.png',f.png);f.write('skins/white-dragon/sister.png',f.png);
 f.write('skins/selection.json',{character:'bluefish',mode:'q'});
 const handlers=new Map(),requests=[],changed=[];
 const hostRequest=async(method,route)=>{requests.push([method,route]);return {status:200,body:JSON.stringify(method==='GET'?{main:{pets:[{id:'main'}],animations:{idle:['呼吸'],moves:{actions:[]}}}}:{ok:true})};};
 const electronApi={ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler(){}},BrowserWindow:{getAllWindows:()=>[]},app:{once(){}}};
 require('./codex-skins.cjs').install({dataRoot:f.root,hostRequest,electronApi,onSelectionChanged:model=>changed.push(model.selection.character)});
 const frame={},sender={mainFrame:frame,getURL:()=>pathToFileURL(path.join(__dirname,'index.html')).href},event={sender,senderFrame:frame};
 await handlers.get('codex-skin:select')(event,{character:'white-dragon',mode:'q'});
 await assert.rejects(handlers.get('codex-skin:select')(event,{character:'white-dragon',mode:'sister'}),/invalid-skin-selection/);
 await handlers.get('codex-skin:select')(event,{character:'white-dragon',mode:'q'});
 assert.deepEqual(requests.filter(([method])=>method==='POST'),[['POST','/dsh-pet-7340/bubble/clear?pet=main']]);assert.deepEqual(changed,['white-dragon','white-dragon']);
});
test('系统语言用Windows UI Culture一次查询，中文归一，其他语言使用英文且隐藏PowerShell窗口',()=>{
 let calls=0;const run=(file,args,options)=>{calls++;assert.equal(file,'powershell.exe');assert.ok(args.at(-1).includes('Get-UICulture'));assert.equal(options.windowsHide,true);assert.equal(options.shell,false);return 'zh-TW\r\n';};
 assert.equal(L.detectSystemLocale({platform:'win32',execFileSyncImpl:run}),'zh-CN');assert.equal(calls,1);
 assert.equal(L.detectSystemLocale({platform:'win32',execFileSyncImpl:()=> 'de-DE'}),'en');
 assert.equal(L.detectSystemLocale({platform:'win32',execFileSyncImpl:()=>{throw Error();},fallback:()=> 'zh-CN'}),'zh-CN');
 assert.equal(L.detectSystemLocale({platform:'linux',fallback:()=> 'ja-JP'}),'en');
});
