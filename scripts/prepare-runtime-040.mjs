import {readFile,writeFile,copyFile,readdir,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {localizeHost,localizeCore,localizeEvents,localizeIndexHtml} from './runtime-locale-patches.mjs';
import {patchDesktopBalanceEvents,patchDesktopWorkEvents} from './upstream-fixes.mjs';
import {captureUpstreamSnapshot040} from './upstream-snapshot-040.mjs';
import {patchHostOpenTarget} from './runtime-host-patch.mjs';
import {patchModelPurpose} from './model-purpose-patch.mjs';
import {seedBundledWhiteDragon} from './bundled-skins.mjs';
import {seedBundledSheep} from './bundled-sheep.mjs';
import {seedBundledStartup} from './bundled-startup.mjs';
import {preserveRuntimeDefaults040} from './runtime-defaults-040.mjs';
import {patchPhysicsDefaults040} from '../harness/physics-defaults-fix.mjs';
import {patchModularUserData,patchModularSandbox,patchModularMain,validateModularDpi,validateModularMotion} from '../harness/modular-runtime-fix.mjs';

const once=(source,before,after,label)=>{const old=source.split(before).length-1,next=source.split(after).length-1;if(next===1&&old===after.split(before).length-1)return source;if(old!==1||next!==0)throw Error('0.4.0 '+label+'锚点不匹配。');return source.replace(before,after);};
const verify=(source,anchors,label)=>{for(const anchor of anchors)if(source.split(anchor).length!==2)throw Error('0.4.0 '+label+'锚点不匹配。');return source;};
function region(source,start,end,run,label){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);if(a<0||b<0||source.indexOf(start,a+start.length)>=0)throw Error('0.4.0 '+label+'定位失败。');return source.slice(0,a)+run(source.slice(a,b))+source.slice(b);}
const capabilityGuard040=`let codexUpstreamCapabilityGate;
export function setUpstreamCapabilityGate(value) {
 if(typeof value!=="function"){codexUpstreamCapabilityGate=undefined;throw Error("upstream-capability-gate-required");}
 codexUpstreamCapabilityGate=value;
}
function upstreamCapabilityResult040(rest, method) {
 if(method!=="POST"||!["voice/speak","voice/hear"].includes(rest))return undefined;
 let capability;try{capability=codexUpstreamCapabilityGate?.();}catch{}
 // 此处同时保护HTTP及原生helper管道；未知宿主状态不能直接调用外部语音服务。
 if(capability?.host==="codex"&&capability.available===true)return undefined;
 return {kind:"json",status:capability?.host==="workbuddy"?403:409,obj:{ok:false,reason:"host-unavailable"}};
}
`;

/** 只适配0.4.0实际宿主；Range和调度使用新包原生实现，核验失败即停止。 */
export function patchStandalone040(input,{version='0.4.0'}={}){
 if(!['0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9'].includes(version))throw Error('未知独立运行时版本。');
 let source=input.replaceAll('\r\n','\n');
 verify(source,['const decision = parseRange(req.headers.range, totalBytes);','if (!isDisplayed(display)) {','else sendFile(req, res, result.file, result.contentType);'],'原生Range及隐藏碎念');
 source=patchModularSandbox(source);
 source=once(source,'\t\t\t\t\tconst sec = sleepTalkPeriodSec(found.conf);\n\t\t\t\t\tmin = Math.min(min, sec);\n\t\t\t\t\tif (now - (lastTalkAt.get(petId) ?? 0) < sec * 1e3) continue;\n\t\t\t\t\tlastTalkAt.set(petId, now);',`\t\t\t\t\t// 梦话没有独立的自动调用授权：沿用原自动碎念策略、显示面及周期。
\t\t\t\t\tconst policy=standaloneAiPolicy();
\t\t\t\t\tif(!policy||typeof policy.isReady!=="function"||typeof policy.canWhisper!=="function"||typeof policy.whisperIntervalSec!=="function")continue;
\t\t\t\t\tconst configuredPeriod=policy.whisperIntervalSec();if(!Number.isFinite(configuredPeriod)||configuredPeriod<=0||policy.isReady()!==true||policy.canWhisper()!==true)continue;
\t\t\t\t\tconst schedule=automaticWhisperSchedule(policy,found.pet.whisperEnabled===true,whisperPeriodSec(found.conf));
\t\t\t\t\tif(!schedule.enabled||!Number.isFinite(schedule.periodSec)||!isDisplayed(String(found.pet.display??"")))continue;
\t\t\t\t\tconst sec=Math.max(60,schedule.periodSec,sleepTalkPeriodSec(found.conf));
\t\t\t\t\tmin=Math.min(min,sec);
\t\t\t\t\tif(now-Math.max(lastTalkAt.get(petId)??0,lastWhisperAt.get(petId)??0)<sec*1e3)continue;
\t\t\t\t\tlastTalkAt.set(petId,now);lastWhisperAt.set(petId,now);`,'梦话自动授权和共享周期');
 source=patchModelPurpose(source);
 source=source.replace(/^(#![^\n]*\n)?/,'$1import CodexCharacter from "../runtime/electron-helper/codex-character.cjs";\nimport { createDesktopChangeGuard } from "../../../src/control-config.mjs";\nlet codexDesktopActivity;\nexport function setDesktopActivityGate(value) { codexDesktopActivity=value; }\n'+capabilityGuard040);
 source=once(source,'const handlePetRoute = async (rawUrl, method, body, signal) => {','const handlePetRoute = createDesktopChangeGuard({gate:()=>codexDesktopActivity,run:(...args)=>runPetRoute(...args),settled:()=>deps.desktopSettled()});\n\tconst runPetRoute = async (rawUrl, method, body, signal) => {','桌面重建事务');
 source=once(source,'return { requestRestart: restartDesktop };','return { requestRestart: restartDesktop, desktopSettled:()=>desktopSyncQueue };','原生重建队列观察');
 source=once(source,'requestRestart: sync.requestRestart,','requestRestart: sync.requestRestart,\n\t\tdesktopSettled: sync.desktopSettled,','拆分Helper队列依赖');
 source=once(source,'const rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1));\n\t\tconst run$1 = () => dispatchPetRoute(url, rest, method, body, signal);','const rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1));\n\t\tconst capabilityDenied=upstreamCapabilityResult040(rest,method);if(capabilityDenied)return capabilityDenied;\n\t\tconst run$1 = () => dispatchPetRoute(url, rest, method, body, signal);','原生语音宿主能力边界');
 source=once(source,'function readAllConfig(paths) {','function readEditableConfig(paths) {','原始配置');
 source=once(source,'return out;\n}\nfunction flattenPetList','return out;\n}\nfunction readAllConfig(paths) { return CodexCharacter.projectConfig(readEditableConfig(paths)); }\nfunction flattenPetList','角色配置');
 source=once(source,'async function handleConfigRoutes(deps, input) {','async function handleConfigRoutes(deps, input) {\n\tif (input.rest === "config/editable" && input.method === "GET") {\n\t\ttry { return okResult({merged:readEditableConfig(deps.configPaths).main,user:readUserConfig(deps.configPaths)},{"cache-control":"no-store"}); }\n\t\tcatch { return {kind:"json",status:503,obj:{error:"preferences_unavailable"}}; }\n\t}','原始偏好');
 source=once(source,'if (["/standalone-ai/settings", "/shutdown"].includes(path)) return false;','let preferencePath; try { preferencePath=decodeURIComponent(path); } catch { return false; }\n\tif (/^\\/dsh-pet-\\d+\\/(?:config\\/editable|codex-tasks|codex-status|codex-notices|todos)(?:\\/|$)/.test(preferencePath)) return false;\n\tif (["/standalone-ai/settings", "/shutdown"].includes(path)) return false;','私有偏好鉴权');
 source=once(source,'(?:whisper|chat)(?:\\/|$)/.test(path)) return false;','(?:whisper|chat)(?:\\/|$)/.test(preferencePath)) return false;','私有读取规范化');
 source=once(source,'prompt: petPersona(found.conf, found.pet),','prompt: CodexCharacter.hostPersona(found.conf, found.pet),','角色人设');
 const system='const system = petSystemPrompt(found);',expected=version==='0.4.0'?3:2;
 if(source.split(system).length-1!==expected)throw Error(version+' 三路角色快照锚点不匹配。');
 source=source.replaceAll(system,'const characterAtStart = CodexCharacter.readCharacter();\n\t\t'+system);
 const chatIndent=['0.4.8','0.4.9'].includes(version)?'\t\t\t':'\t\t';
 if(version!=='0.4.0'){
  verify(source,['const system = petSystemPrompt(found, { historyTimes: list.length > 0 });'],'聊天历史人设');
  // 新版先读取记忆再组装人设；角色快照必须位于首次异步读取和分桶之前。
  source=region(source,'const chatWithPet = async','const deleteHistory = async',block=>once(block,'const rounds = memoryRounds(found.conf);','const characterAtStart = CodexCharacter.readCharacter();\n'+chatIndent+'const rounds = memoryRounds(found.conf);','聊天异步前角色快照'),'聊天区域');
 }
 const guard='CodexCharacter.characterKey(CodexCharacter.readCharacter()) !== CodexCharacter.characterKey(characterAtStart)';
 source=region(source,'const publishWhisper = async','const publishSleepTalk = async',block=>once(block,'\t\tstate.writePet(petId, "say", {','\t\tif ('+guard+') return CodexCharacter.changedResult();\n\t\tstate.writePet(petId, "say", {','碎念过期回复'),'碎念区域');
 source=region(source,'const publishSleepTalk = async','const chatWithPet = async',block=>once(block,'\t\tstate.writePet(petId, "say", {','\t\tif ('+guard+') return false;\n\t\tstate.writePet(petId, "say", {','梦话过期回复'),'梦话区域');
 const bucket='const bucket = mem[found.entry] && typeof mem[found.entry] === "object" && !Array.isArray(mem[found.entry]) ? mem[found.entry] : mem[found.entry] = {};';
 source=once(source,bucket,'const memoryEntry = found.entry + ":" + characterAtStart.id;\n'+chatIndent+'const bucket = mem[memoryEntry] && typeof mem[memoryEntry] === "object" && !Array.isArray(mem[memoryEntry]) ? mem[memoryEntry] : mem[memoryEntry] = {};','聊天记忆隔离');
 source=once(source,'const rawMessages = mem[who.entry]?.[petId]?.messages;','const rawMessages = mem[who.entry + ":" + CodexCharacter.readCharacter().id]?.[petId]?.messages;','历史记忆隔离');
 source=once(source,'const byPet = mem[found.entry];','const memoryEntry = found.entry + ":" + CodexCharacter.readCharacter().id;\n\t\tconst byPet = mem[memoryEntry];','删除记忆隔离');
 source=once(source,'delete mem[found.entry];','delete mem[memoryEntry];','删除空角色范围');
 source=once(source,'if (!generated.ok) return generated;\n'+chatIndent+'const now = Date.now();','if (!generated.ok) return generated;\n'+chatIndent+'if ('+guard+') return CodexCharacter.changedResult();\n'+chatIndent+'const now = Date.now();','聊天过期回复');
 source=once(source,'const USER_TEXT = "随便说一句日常碎碎念，一句就好，20 字以内。";','const USER_TEXT = process.env.CODEX_PET_LOCALE === "en" ? "Say one short, natural everyday thought in English, under 20 words." : "随便说一句日常碎碎念，一句就好，20 字以内。";','碎念语言');
 source=localizeHost(source);
 source=once(source,'const limit = pathname === "/standalone-ai/settings" ? MAX_SETTINGS_BYTES : MAX_REQUEST_BYTES;','const limit = pathname === "/dsh-pet-7340/codex-chat" ? 17 * 1024 * 1024 : pathname === "/standalone-ai/settings" ? MAX_SETTINGS_BYTES : MAX_REQUEST_BYTES;','图文正文上限');
 const invocation='main().then((code) => {';verify(source,[invocation],'宿主主入口');
 return source.slice(0,source.indexOf(invocation))+'\nexport { apply, createStandaloneContext, createStandaloneLogger, createStandaloneAi, createAiConfig, createRequestSecurity, listenStandaloneServer, writeStandaloneRuntime, packageRoot };\n';
}

/** 角色选择只清本机主种类的睡眠，不触碰任务锁、其它种类或原生Harness。 */
export function createSkinChangeHandler040({initialCharacter,isNative,hostRequest,showCharacter,refreshTray}){
 let current=initialCharacter;
 return async model=>{
  const next=model?.selection?.character;
  if(typeof next!=='string'||!next)throw Error('character-sleep-reset-unavailable');
  if(next!==current&&next!=='bluefish'&&!isNative()){
   const response=await hostRequest('GET','/dsh-pet-7340/config');
   if(response.status!==200)throw Error('character-sleep-reset-unavailable');
   let pets;try{pets=JSON.parse(response.body).main.pets;}catch{throw Error('character-sleep-reset-unavailable');}
   if(!Array.isArray(pets)||pets.some(pet=>typeof pet?.id!=='string'||!pet.id||pet.id.length>64||pet.id==='.'||pet.id==='..'||/[\\/:\x00-\x1f]/.test(pet.id)))throw Error('character-sleep-reset-unavailable');
   // ID仅取宿主返回的配置；固定wake路由不接收渲染器URL或任意命令。
   for(const id of new Set(pets.map(pet=>pet.id))){
    const cleared=await hostRequest('POST','/dsh-pet-7340/wake?pet='+encodeURIComponent(id));
    let body;try{body=JSON.parse(cleared.body);}catch{throw Error('character-sleep-reset-unavailable');}
    if(cleared.status!==200||body.ok!==true||body.sleeping!==false)throw Error('character-sleep-reset-unavailable');
   }
  }
  current=next;
  showCharacter(model);
  await refreshTray();
 };
}

const extensions=`
// codex-pet-extensions-v040
if(app.getMaxListeners()>0&&app.getMaxListeners()<24)app.setMaxListeners(24);
const hostRequest=bridge.hostRequest,windows=petWindows.state.windows;
const codexPanelRequest=require('./codex-api.cjs').createHostRequest();
const startupMedia=require('./startup-media.cjs').install({electron:electronApi,dataRoot:process.env.DSH_HOME,fileRoot:__dirname,host:()=>codexPetHost.get().host});
const codexStartup=require('./codex-startup.cjs').install({hostRequest:codexPanelRequest,dataRoot:process.env.DSH_HOME,media:startupMedia,disabled:DPI_PROBE,onPetEnabled:enabled=>{if(enabled){if(!windows.size)petWindows.create();}else for(const win of [...windows.values()])if(!win.isDestroyed())win.destroy();},onModeChanged:async()=>{tray.destroy();await tray.start();}});
startupMedia.setPreview(()=>codexStartup.open('preview'));
const codexTelemetry=require('./pet-telemetry.cjs').install({dataRoot:process.env.DSH_HOME,disabled:DPI_PROBE});
const codexVisibility=require('./pet-visibility.cjs').install({getPetWindows:()=>windows.values(),dataRoot:process.env.DSH_HOME,disabled:DPI_PROBE,onChange:state=>codexTelemetry.setSuspended(state.hidden||!windows.size)});
const nativeHarness=require('./harness-handoff.cjs').install({dataRoot:process.env.DSH_HOME,onHandoff:async()=>{const r=await codexPanelRequest('POST','/dsh-pet-7340/pet-host/presentation',JSON.stringify({mode:'pause'}));if(r.status!==200)throw Error('host-presentation-pause-failed');codexVisibility.setExternalHidden(true);codexStartup.setSuspended(true);codexChatPanel.hide();codexTaskPanel.hide();codexQQSettings.hide();},onRestore:async()=>{const r=await codexPanelRequest('POST','/dsh-pet-7340/pet-host/presentation',JSON.stringify({mode:'resume'}));if(r.status!==200)throw Error('host-presentation-resume-failed');codexVisibility.setExternalHidden(false);codexStartup.setSuspended(false);}});
codexVisibility.setExternalHidden(nativeHarness.state().active===true);codexStartup.setSuspended(nativeHarness.state().active===true);
const refreshTray=async()=>{tray.destroy();await tray.start();};
const codexPetHost=require('./pet-host-menu.cjs').install({hostRequest:codexPanelRequest,harness:nativeHarness,onChanged:refreshTray});
const codexQQSettings=require('./qq-window.cjs').install({hostRequest:codexPanelRequest});
const codexTaskPanel=require('./codex-task-window.cjs').install({hostRequest:codexPanelRequest,canUse:()=>codexPetHost.get().host==='codex'});
const codexChatPanel=require('./codex-chat-window.cjs').install({hostRequest:codexPanelRequest,openTaskPanel:()=>codexTaskPanel.open(),canUse:()=>codexPetHost.get().host==='codex'});
const codexSkinChanged=(${createSkinChangeHandler040.toString()})({initialCharacter:require('./codex-character.cjs').readCharacter().id,isNative:()=>nativeHarness.state().active===true,hostRequest,showCharacter:model=>{const character=model.characters.find(c=>c.id===model.selection.character);codexChatPanel.onCharacterChanged?.({id:model.selection.character,name:character.copy.name,locale:model.locale});},refreshTray});
const codexSkinStore=require('./codex-skins.cjs').install({hostRequest,dataRoot:process.env.DSH_HOME,onSelectionChanged:codexSkinChanged});
const codexActions=require('./pet-actions.cjs').install({host:()=>codexPetHost.get().host});
require('./execution-picker.cjs').install({hostRequest:codexPanelRequest,canUse:()=>codexPetHost.get().host==='codex'&&!nativeHarness.state().active});
const codexWorkbench=require('./workbench-window.cjs').install({hostRequest:codexPanelRequest,host:()=>codexPetHost.get().host,canUse:()=>!nativeHarness.state().active});
const codexMemory=require('./memory-window.cjs').install({hostRequest:codexPanelRequest});
const codexCreative=require('./creative-window.cjs').install({dataRoot:process.env.DSH_HOME,skins:codexSkinStore,actions:codexActions,host:()=>codexPetHost.get().host,fileRoot:__dirname,startupMedia});
const codexContent=require('./content-window.cjs').install({hostRequest:codexPanelRequest,fileRoot:__dirname});
const codexConnections=require('./chat-connections-window.cjs').install({hostRequest:codexPanelRequest,fileRoot:__dirname});
require('./pet-local-control.cjs').install({hostRequest:codexPanelRequest,skins:codexSkinStore,actions:codexActions,visibility:codexVisibility,canUse:()=>!nativeHarness.state().active});
const codexControl=require('./control-window.cjs').install({hostRequest,apiRequest:codexPanelRequest,skins:codexSkinStore,startup:codexStartup,petHost:codexPetHost,actions:codexActions});
require('./panel-navigation.cjs').install({host:()=>codexPetHost.get().host,openPanel:name=>({settings:()=>codexControl.open(),chat:()=>codexChatPanel.open(),tasks:()=>codexTaskPanel.open(),qq:()=>codexQQSettings.open(),workbench:()=>codexWorkbench.open(),memory:()=>codexMemory.open(),creative:()=>codexCreative.open(),content:()=>codexContent.open(),connections:()=>codexConnections.open()}[name])()});
require(process.env.CODEX_PET_HOST==='workbuddy'?'./workbuddy-notifications.cjs':'./codex-notifications.cjs').install({hostRequest,openQQ:()=>codexQQSettings.open()});
void codexPanelRequest('POST','/dsh-pet-7340/control-resume').then(r=>{if(r.status===200&&JSON.parse(r.body).resumeSettings===true)return codexControl.open();}).catch(()=>{});
// codex-pet-extensions-end
`;

/** 0.4模块各保留原文件和职责；原物理/菜单/Range不拼回旧整文件。 */
export function patchPlayback040(input){
 return once(input.replaceAll('\r\n','\n'),'    if (this.resumeSleepAnim()) return;\n    if (this.resumeWorkStatusAnim()) return;\n    if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));\n  },',`    const pendingWork=this.codexPendingWorkSnapshot;this.codexPendingWorkSnapshot=null;
    if(pendingWork&&this.pet.workStatusEnabled){const ongoing=['thinking','working','result','waiting'].includes(pendingWork.snapshot.state);if(ongoing)this.prevWorkState=null;this.onWorkTick(ongoing?pendingWork.snapshot:{state:null,task:null},pendingWork.tick);if(ongoing&&!this.sleeping)return;}
    if (this.resumeSleepAnim()) return;
    if (this.resumeWorkStatusAnim()) return;
    if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));
  },`,'解冻最新状态');
}

export function patchHelper040(input,{version='0.4.0'}={}){
 if(!['0.4.0','0.4.1','0.4.3','0.4.8','0.4.9'].includes(version))throw Error('未知Helper运行时版本。');
 const files=Object.fromEntries(Object.entries(input).map(([name,text])=>[name,text.replaceAll('\r\n','\n')]));
 verify(files['main/bridge.js'],["const decision = parseRange(request.headers.get('range'), data.length);"],'原生bridge Range');
 validateModularMotion(files['sprite/motion.js']);
 verify(files['sprite/menu.js'],["const OPEN_LABEL = { desktop: '打开软件', standalone: '打开 AI 设置', web: '打开网站' };"],'原生首项菜单');
 validateModularDpi(files['main/dpi.js']);
 let main=patchModularMain(files['main.js'].replace('dshHome: dshHomeDir(),\n  appMode: true,','dshHome: dshHomeDir(),\n  appMode: APP_MODE,'));verify(main,['const petWindows = createWindows({','const tray = createTray({','void tray.start();'],'模块入口');
 main=once(main,'dshHome: dshHomeDir(),\n  appMode: APP_MODE,','dshHome: dshHomeDir(),\n  appMode: true,','独立宿主既有profile类型');
 if(version!=='0.4.0'){
  const before='  petWindows.create();',after='  if(codexStartup.petEnabled())petWindows.create();',old=main.split(before).length-1,current=main.split(after).length-1;
  // 新版另有同进程重建钩子，两条创建路径都须保留本项目的启动模式门控。
  if(old===2&&current===0)main=main.replaceAll(before,after);else if(old!==0||current!==2)throw Error('0.4.1 两条桌面创建锚点不匹配。');
 }else main=once(main,'  petWindows.create();','  if(codexStartup.petEnabled())petWindows.create();','启动门控');
 main=once(main,'  if (tray.exists()) return;','  if (tray.exists() || !codexStartup.petEnabled()) return;','仅演出空窗');
 main=once(main,'  hostRequest: bridge.hostRequest,','  hostRequest: bridge.hostRequest,\n  extraItems:()=>[...(nativeHarness.state().active?[]:codexStartup.trayItems()),...codexPetHost.trayItems(),...codexControl.trayItems(),...(nativeHarness.state().active?[]:codexVisibility.trayItems()),...codexQQSettings.trayItems()],','托盘扩展');if(main.includes('// codex-pet-extensions-v040'))verify(main,[extensions],'既有扩展块');else main+=extensions;files['main.js']=main;
 let tray=files['main/tray.js'];tray=once(tray,'  helperDir,\n}) {','  helperDir,\n  extraItems=()=>[],\n}) {','托盘依赖');tray=once(tray,"tray.setToolTip('dsh-pet 桌面宠物');","tray.setToolTip('Codex Pet');",'托盘名称');
 const indent=version==='0.4.0'?'          ':'      ',quit="...(canQuit ? [{ type: 'separator' }, { label: '退出', click: quitApp }] : []),";
 tray=once(tray,indent+quit,indent+"{type:'separator'},...extraItems(),\n"+indent+quit,'托盘菜单');files['main/tray.js']=tray;
 files['main/ipc.js']=patchHostOpenTarget(files['main/ipc.js'],{startupModule:'../codex-startup.cjs'});
 files['main/user-data.js']=patchModularUserData(files['main/user-data.js']);
 files['sprite.js']=once(files['sprite.js'],'      b: m,','      b: Math.max(m,184),','脚下状态余量');
 const bubbleSlot=['0.4.8','0.4.9'].includes(version)?'    this.bubbleSlot = slot;':"workTerminal && workOn ? 'work' : whisperOn ? 'whisper' : balanceOn ? 'balance' : workOn ? 'work' : 'none';";
 files['sprite/bubble.js']=once(files['sprite/bubble.js'],bubbleSlot,bubbleSlot+'\n    this.bubble.dataset.slot=slot;','气泡槽标记');
 files['sprite/input.js']=once(files['sprite/input.js'],'.dsh-pet-menu-column, .dsh-pet-chat, .dsh-pet-todo, .pet-bubble.is-clickable','.dsh-pet-menu-column, .dsh-pet-chat, .dsh-pet-todo, .pet-bubble.is-clickable, .pet-status-quota.is-interactive','脚下控件命中');
 files['events.js']=localizeEvents(patchDesktopWorkEvents(patchDesktopBalanceEvents(files['events.js'],{version})));
 files['sprite/playback.js']=patchPlayback040(files['sprite/playback.js']);
 const quotaOld='if (monthly === void 0 || monthly === null) return null;',quotaNew='if (monthly === null || (monthly === void 0 && rolling === void 0 && weekly === void 0)) return null;';files['shared-core.js']=localizeCore(once(patchPhysicsDefaults040(files['shared-core.js']),quotaOld,quotaNew,'无月额度窗口'));
 let html=localizeIndexHtml(files['index.html']);html=once(html,'</head>','<link rel="stylesheet" href="pet-status-strip.css">\n</head>','脚下状态样式');html=once(html,'<script src="./renderer.js"></script>','<script src="pet-status-strip.js"></script>\n<script src="pet-actions-renderer.js"></script>\n<script src="./renderer.js"></script>','脚下状态及点播');files['index.html']=html;
 return files;
}

export async function prepareRuntime040({root,pkg,version='0.4.0',capture=captureUpstreamSnapshot040,patchHost=patchStandalone040,patchHelper=patchHelper040}={}){
 if(!['0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9'].includes(version)||JSON.parse(await readFile(join(pkg,'package.json'),'utf8')).version!==version)throw Error('独立运行时版本不匹配。');
 await capture({pkg});
 const helper=join(pkg,'runtime/electron-helper'),names=['main.js','main/tray.js','main/bridge.js','main/ipc.js','main/dpi.js','main/user-data.js','sprite.js','sprite/motion.js','sprite/menu.js','sprite/playback.js','sprite/bubble.js','sprite/input.js','events.js','shared-core.js','index.html',...(['0.4.3','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9'].includes(version)?['sprite/init.js','sprite/window-fit.js']:[]),...(['0.4.6','0.4.7','0.4.8','0.4.9'].includes(version)?['main/windows.js','preload.js']:[]),...(['0.4.7','0.4.8','0.4.9'].includes(version)?['renderer.js']:[]),...(['0.4.8','0.4.9'].includes(version)?['main/displays.js','pointer-target.js']:[]),...(version==='0.4.9'?['constants.js']:[])];
 // 直接核验当前已安装文件；未知改动不使用旧快照掩盖，也不覆盖成旧整份runtime。
 const originals=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(join(helper,name),'utf8')])));originals['standalone.js']=await readFile(join(pkg,'lib/standalone.js'),'utf8');originals['preload.js']=await readFile(join(helper,'preload.js'),'utf8');
 const fixed=patchHelper(Object.fromEntries(names.map(name=>[name,originals[name]]))),host=patchHost(originals['standalone.js'],{version});
 const configFile=join(pkg,'assets/config.jsonc'),defaults=preserveRuntimeDefaults040(await readFile(configFile,'utf8'));
 const preloads=['codex-task-window.cjs','codex-chat-window.cjs','codex-skins.cjs','codex-startup.cjs','pet-host-menu.cjs','qq-window.cjs','control-window.cjs','panel-navigation.cjs','pet-visibility.cjs','pet-telemetry.cjs','pet-actions.cjs','workbench-window.cjs','memory-window.cjs'];
 const preloadHook='\n// codex-pet-preloads-v040\n'+preloads.map(name=>"require('./"+name+"').installPreload();").join('\n')+'\n';
 const preload=fixed['preload.js']??originals['preload.js'];
 if(preload.includes('// codex-pet-preloads-v040')){
  verify(preload,[preloadHook],'既有预加载');
  fixed['preload.js']=preload;
 }else fixed['preload.js']=preload+preloadHook;
 // 模板全部锚点通过后才写依赖文件；不改变用户data中的覆盖值。
 await writeFile(configFile,defaults);
 for(const[name,source]of Object.entries(fixed))await writeFile(join(helper,name),source);await writeFile(join(pkg,'lib/codex-host.js'),host);
 // 只复制公开src的桌面脚本、样式与页面；后端mjs、测试、配置和运行数据不进Electron目录。
 for(const entry of await readdir(join(root,'src'),{withFileTypes:true}))if(entry.isFile()&&/\.(?:cjs|js|css|html|ps1)$/.test(entry.name)&&!/\.test\.(?:cjs|js)$/.test(entry.name))await copyFile(join(root,'src',entry.name),join(helper,entry.name));
 await mkdir(join(root,'data'),{recursive:true});await seedBundledWhiteDragon({projectRoot:root});await seedBundledSheep({projectRoot:root});await seedBundledStartup({projectRoot:root});
 console.log('dsh-pet '+version+' runtime prepared: Codex Pet.');
}
