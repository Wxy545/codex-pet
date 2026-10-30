// 保留上游原文件；只生成固定版本的 Codex 宿主入口和额度解析补丁。
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { localizeHost, localizeCore, localizeEvents, localizeIndexHtml } from './runtime-locale-patches.mjs';
import { patchHostAssets, patchBridgeAssets, patchDesktopMotion, patchDesktopBalanceEvents, patchDesktopWorkEvents, patchDesktopWorkResume } from './upstream-fixes.mjs';
import { seedBundledWhiteDragon } from './bundled-skins.mjs';
import { seedBundledSheep } from './bundled-sheep.mjs';
import { seedBundledStartup } from './bundled-startup.mjs';
import { patchStartupMain } from './startup-runtime-patch.mjs';
import { patchHostOpenTarget } from './runtime-host-patch.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pkg=resolve(root,'node_modules/dsh-pet');
const meta=JSON.parse(await readFile(resolve(pkg,'package.json'),'utf8'));
if(meta.version!=='0.3.8') throw new Error('运行时版本必须是 dsh-pet 0.3.8，请按锁文件安装。');

const oldGate='if (monthly === void 0 || monthly === null) return null;';
const newGate='if (monthly === null || (monthly === void 0 && rolling === void 0 && weekly === void 0)) return null;';
function quotaPatch(text){
  if(text.includes(newGate)) return text;
  if(text.split(oldGate).length!==2) throw new Error('额度补丁定位失败，停止使用不匹配的运行时。');
  return text.replace(oldGate,newGate);
}
let source=await readFile(resolve(pkg,'lib/standalone.js'),'utf8');
source=patchHostAssets(source);
function patchOnce(text,anchor,replacement,label){
  if(text.split(anchor).length!==2) throw new Error(`${label}补丁定位失败。`);
  return text.replace(anchor,replacement);
}
// 同一只角色的配置、碎念和旧聊天使用同一可信身份投影，原用户配置不落盘改写。
source=source.replace(/^(#![^\n]*\n)?/,'$1import CodexCharacter from "../runtime/electron-helper/codex-character.cjs";\n');
source=source.replace(/^(#![^\n]*\n)?/,'$1import { createDesktopChangeGuard } from "../../../src/control-config.mjs";\nlet codexDesktopActivity;\nexport function setDesktopActivityGate(value) { codexDesktopActivity=value; }\n');
const petRouteAnchor='const handlePetRoute = async (rawUrl, method, body, signal) => {';
source=patchOnce(source,petRouteAnchor,'const handlePetRoute = createDesktopChangeGuard({gate:()=>codexDesktopActivity,run:(...args)=>runPetRoute(...args),settled:()=>desktopSyncQueue});\n\tconst runPetRoute = async (rawUrl, method, body, signal) => {','桌面重建事务');
source=patchOnce(source,'function readAllConfig(paths) {','function readEditableConfig(paths) {','原始配置读取');
source=patchOnce(source,'return out;\n}\nfunction flattenPetList','return out;\n}\nfunction readAllConfig(paths) { return CodexCharacter.projectConfig(readEditableConfig(paths)); }\nfunction flattenPetList','角色配置');
source=patchOnce(source,'\t\tif (rest === "config") {','\t\tif (rest === "config/editable" && method === "GET") {\n\t\t\ttry { return {kind:"json",status:200,obj:{merged:readEditableConfig(configPaths).main,user:readUserConfig(configPaths)},headers:{"cache-control":"no-store"}}; }\n\t\t\tcatch { return {kind:"json",status:503,obj:{error:"preferences_unavailable"}}; }\n\t\t}\n\t\tif (rest === "config") {','控制中心原始偏好');
source=patchOnce(source,'if (["/standalone-ai/settings", "/shutdown"].includes(path)) return false;','let preferencePath; try { preferencePath=decodeURIComponent(path); } catch { return false; }\n\tif (/^\\/dsh-pet-\\d+\\/(?:config\\/editable|codex-tasks|codex-status|codex-notices)(?:\\/|$)/.test(preferencePath)) return false;\n\tif (["/standalone-ai/settings", "/shutdown"].includes(path)) return false;','原始偏好访问保护');
source=patchOnce(source,'(?:whisper|chat)(?:\\/|$)/.test(path)) return false;','(?:whisper|chat)(?:\\/|$)/.test(preferencePath)) return false;','私有读取路径规范化');
source=patchOnce(source,'prompt: petPersona(found.conf, found.pet),','prompt: CodexCharacter.hostPersona(found.conf, found.pet),','角色人设');
const systemAnchor='const system = petSystemPrompt(found);';
if(source.split(systemAnchor).length!==3) throw new Error('角色请求快照补丁定位失败。');
source=source.replaceAll(systemAnchor,'const characterAtStart = CodexCharacter.readCharacter();\n\t\tconst system = petSystemPrompt(found);');
source=patchOnce(source,'const bucket = mem[found.entry] ??= {};','const bucket = mem[found.entry + ":" + characterAtStart.id] ??= {};','角色记忆隔离');
source=patchOnce(source,'const bucket = mem[who.entry] ?? {};','const bucket = mem[who.entry + ":" + CodexCharacter.readCharacter().id] ?? {};','角色历史读取');
source=patchOnce(source,'\t\tstate.writePet(petId, "say", result.image ?', '\t\tif (CodexCharacter.characterKey(CodexCharacter.readCharacter()) !== CodexCharacter.characterKey(characterAtStart)) return CodexCharacter.changedResult();\n\t\tstate.writePet(petId, "say", result.image ?','碎念过期回复');
source=patchOnce(source,'\t\tif (!generated.ok) return generated;\n\t\tconst now = Date.now();','\t\tif (!generated.ok) return generated;\n\t\tif (CodexCharacter.characterKey(CodexCharacter.readCharacter()) !== CodexCharacter.characterKey(characterAtStart)) return CodexCharacter.changedResult();\n\t\tconst now = Date.now();','聊天过期回复');
source=patchOnce(source,'const USER_TEXT = "随便说一句日常碎碎念，一句就好，20 字以内。";','const USER_TEXT = process.env.CODEX_PET_LOCALE === "en" ? "Say one short, natural everyday thought in English, under 20 words." : "随便说一句日常碎碎念，一句就好，20 字以内。";','碎念语言');
source=localizeHost(source);
// 只有独立的图文入口接收大图片，原配置/命令路由继续保留上游请求体上限。
const bodyLimitAnchor='const limit = pathname === "/standalone-ai/settings" ? MAX_SETTINGS_BYTES : MAX_REQUEST_BYTES;';
if(source.split(bodyLimitAnchor).length!==2) throw new Error('图文请求大小补丁定位失败。');
source=source.replace(bodyLimitAnchor,'const limit = pathname === "/dsh-pet-7340/codex-chat" ? 17 * 1024 * 1024 : pathname === "/standalone-ai/settings" ? MAX_SETTINGS_BYTES : MAX_REQUEST_BYTES;');
const invocation='main().then((code) => {';
const index=source.lastIndexOf(invocation);
if(index<0 || source.indexOf(invocation)!==index) throw new Error('宿主入口定位失败。');
const host=source.slice(0,index)+`\nexport { apply, createStandaloneContext, createStandaloneLogger, createStandaloneAi, createAiConfig, createRequestSecurity, listenStandaloneServer, writeStandaloneRuntime, packageRoot };\n`;
await writeFile(resolve(pkg,'lib/codex-host.js'),host);
const core=resolve(pkg,'runtime/electron-helper/shared-core.js');
await writeFile(core,localizeCore(quotaPatch(await readFile(core,'utf8'))));
const events=resolve(pkg,'runtime/electron-helper/events.js');
await writeFile(events,localizeEvents(patchDesktopWorkEvents(patchDesktopBalanceEvents(await readFile(events,'utf8')))));
const sprite=resolve(pkg,'runtime/electron-helper/sprite.js');
let spriteCode=patchDesktopWorkResume(patchDesktopMotion(await readFile(sprite,'utf8')));
const footerMargin='this.margin = { t: Math.max(m, S.bubbleTopMarginPx(fontConf, this.size)), r: m, b: Math.max(m, 132), l: m };';
if(!spriteCode.includes(footerMargin))spriteCode=patchOnce(spriteCode,'this.margin = { t: Math.max(m, S.bubbleTopMarginPx(fontConf, this.size)), r: m, b: m, l: m };',footerMargin,'底部状态余量');
const slotMarker="this.bubble.dataset.slot = slot;";
if(!spriteCode.includes(slotMarker))spriteCode=patchOnce(spriteCode,"workTerminal && workOn ? 'work' : whisperOn ? 'whisper' : balanceOn ? 'balance' : workOn ? 'work' : 'none';","workTerminal && workOn ? 'work' : whisperOn ? 'whisper' : balanceOn ? 'balance' : workOn ? 'work' : 'none';\n    "+slotMarker,'气泡槽标记');
const controls=".dsh-pet-menu-column, .dsh-pet-chat, .pet-bubble.is-clickable";
if(!spriteCode.includes(controls+', .pet-status-quota.is-interactive'))spriteCode=patchOnce(spriteCode,controls,controls+', .pet-status-quota.is-interactive','额度条命中区');
await writeFile(sprite,spriteCode);
// 仅向原桌面壳追加通知入口，动画、物理、菜单仍运行原实现。
const main=resolve(pkg,'runtime/electron-helper/main.js');
let mainCode=await readFile(main,'utf8');
mainCode=patchBridgeAssets(mainCode);
mainCode=patchHostOpenTarget(mainCode);
await writeFile(main,mainCode);
const oldNoticeHook="require('./codex-notifications.cjs').install({hostRequest});";
const noticeHook="require(process.env.CODEX_PET_HOST === 'workbuddy' ? './workbuddy-notifications.cjs' : './codex-notifications.cjs').install({hostRequest});";
if(mainCode.includes(oldNoticeHook)){mainCode=mainCode.replaceAll(oldNoticeHook,noticeHook);await writeFile(main,mainCode);}
if(!mainCode.includes(noticeHook)) await writeFile(main,mainCode+'\n'+noticeHook+'\n');
mainCode=await readFile(main,'utf8');
const extensionHook=`// codex-pet-extensions-v2
const codexVisibility = require('./pet-visibility.cjs').install({getPetWindows:()=>windows.values(),dataRoot:process.env.DSH_HOME,disabled:DPI_PROBE,onChange:state=>codexTelemetry.setSuspended(state.hidden||!windows.size)});
const codexTelemetry = require('./pet-telemetry.cjs').install({dataRoot:process.env.DSH_HOME,disabled:DPI_PROBE});
const nativeHarness = require('./harness-handoff.cjs').install({dataRoot:process.env.DSH_HOME,onHandoff:async()=>{codexVisibility.setExternalHidden(true);codexStartup.setSuspended(true);codexChatPanel.hide();codexTaskPanel.hide();codexQQSettings?.hide();},onRestore:async()=>{codexVisibility.setExternalHidden(false);codexStartup.setSuspended(false);}});
codexVisibility.setExternalHidden(nativeHarness.state().active===true);
codexStartup.setSuspended(nativeHarness.state().active===true);
const codexPetHost = require('./pet-host-menu.cjs').install({hostRequest:codexPanelRequest,harness:nativeHarness,onChanged:async()=>{if(tray){tray.destroy();tray=null;}await startTray();}});
const codexQQSettings = process.env.CODEX_PET_HOST === 'workbuddy' ? null : require('./qq-window.cjs').install({hostRequest:codexPanelRequest,canUse:()=>codexPetHost.get().host==='codex'});
const codexTaskPanel = require('./codex-task-window.cjs').install({hostRequest:codexPanelRequest,canUse:()=>codexPetHost.get().host==='codex'});
const codexChatPanel = require('./codex-chat-window.cjs').install({hostRequest:codexPanelRequest,openTaskPanel:()=>codexTaskPanel.open(),canUse:()=>codexPetHost.get().host==='codex'});
const codexSkinStore = require('./codex-skins.cjs').install({hostRequest,dataRoot:process.env.DSH_HOME,onSelectionChanged:async model=>{const character=model.characters.find(item=>item.id===model.selection.character);codexChatPanel.onCharacterChanged?.({id:model.selection.character,name:character.copy.name,locale:model.locale});if(tray){tray.destroy();tray=null;}await startTray();}});
const codexControl = require('./control-window.cjs').install({hostRequest,apiRequest:codexPanelRequest,skins:codexSkinStore,startup:codexStartup,petHost:codexPetHost});
require('./panel-navigation.cjs').install({host:()=>codexPetHost.get().host,openPanel:name=>({settings:()=>codexControl.open(),chat:()=>codexChatPanel.open(),tasks:()=>codexTaskPanel.open(),qq:()=>codexQQSettings?.open()}[name])()});
void codexPanelRequest('POST','/dsh-pet-7340/control-resume').then(response=>{if(response.status===200&&JSON.parse(response.body).resumeSettings===true)return codexControl.open();}).catch(()=>{});
// codex-pet-extensions-end`;
if(mainCode.includes('// codex-pet-extensions-v2')){
  mainCode=mainCode.replace(/\/\/ codex-pet-extensions-v2[\s\S]*?\/\/ codex-pet-extensions-end/,extensionHook);
}else if(mainCode.includes('// codex-pet-extensions-v1')){
  const old="// codex-pet-extensions-v1\nconst codexPanelRequest = require('./codex-api.cjs').createHostRequest();\nconst codexTaskPanel = require('./codex-task-window.cjs').install({hostRequest:codexPanelRequest});\nrequire('./codex-chat-window.cjs').install({hostRequest:codexPanelRequest,openTaskPanel:()=>codexTaskPanel.open()});\nrequire('./codex-skins.cjs').install({hostRequest,dataRoot:process.env.DSH_HOME});";
  mainCode=patchOnce(mainCode,old,extensionHook,'身份窗口联动');
}else mainCode+='\n'+extensionHook+'\n';
await writeFile(main,mainCode);
mainCode=await readFile(main,'utf8');
const oldTray="tray.setToolTip('dsh-pet 桌面宠物');";
mainCode=mainCode.replace(oldTray,"tray.setToolTip('Codex Pet');").replace("tray.setToolTip('龙娘桌宠');","tray.setToolTip('Codex Pet');");
mainCode=patchStartupMain(mainCode);
const panelRequestHook="// codex-pet-panel-request-v1\nconst codexPanelRequest = require('./codex-api.cjs').createHostRequest();\n// codex-pet-panel-request-end";
mainCode=mainCode.replace(/\/\/ codex-pet-panel-request-v1[\s\S]*?\/\/ codex-pet-panel-request-end\s*/, '');
mainCode=patchOnce(mainCode,'// codex-startup-main-v1',panelRequestHook+'\n// codex-startup-main-v1','窗口请求初始化');
// 控制中心依赖启动控制器；统一排在启动块之后，重复准备也维持同一初始化顺序。
mainCode=mainCode.replace(/\/\/ codex-pet-extensions-v2[\s\S]*?\/\/ codex-pet-extensions-end\s*/, '');
mainCode+='\n'+extensionHook+'\n';
const hostTray='...codexStartup.trayItems(), ...codexPetHost.trayItems()]';
const qqTray='...codexStartup.trayItems(), ...codexPetHost.trayItems(), ...(codexQQSettings?.trayItems() || [])]';
const oldControlTray='...codexStartup.trayItems(), ...codexPetHost.trayItems(), ...codexControl.trayItems(), ...(codexQQSettings?.trayItems() || [])]';
const visibilityTray='...codexStartup.trayItems(), ...codexPetHost.trayItems(), ...codexControl.trayItems(), ...codexVisibility.trayItems(), ...(codexQQSettings?.trayItems() || [])]';
const controlTray='...codexStartup.trayItems(), ...codexPetHost.trayItems(), ...codexControl.trayItems(), ...(nativeHarness.state().active?[]:codexVisibility.trayItems()), ...(codexQQSettings?.trayItems() || [])]';
if(!mainCode.includes(controlTray)) {
  if(!mainCode.includes(hostTray)&&!mainCode.includes(qqTray)&&!mainCode.includes(oldControlTray)&&!mainCode.includes(visibilityTray)) mainCode=patchOnce(mainCode,'...codexStartup.trayItems()]',hostTray,'联动应用托盘');
  mainCode=patchOnce(mainCode,mainCode.includes(visibilityTray)?visibilityTray:mainCode.includes(oldControlTray)?oldControlTray:mainCode.includes(qqTray)?qqTray:hostTray,controlTray,'控制中心托盘');
}
await writeFile(main,mainCode);
const preload=resolve(pkg,'runtime/electron-helper/preload.js');
let preloadCode=await readFile(preload,'utf8');
const preloadHook=`// codex-pet-preloads-v1
require('./codex-task-window.cjs').installPreload();
require('./codex-chat-window.cjs').installPreload();
require('./codex-skins.cjs').installPreload();`;
if(!preloadCode.includes('// codex-pet-preloads-v1')) await writeFile(preload,preloadCode+'\n'+preloadHook+'\n');
preloadCode=await readFile(preload,'utf8');
const startupPreload="require('./codex-startup.cjs').installPreload();";
if(!preloadCode.includes(startupPreload)) await writeFile(preload,preloadCode+'\n'+startupPreload+'\n');
preloadCode=await readFile(preload,'utf8');
const hostPreload="require('./pet-host-menu.cjs').installPreload();";
if(!preloadCode.includes(hostPreload)) await writeFile(preload,preloadCode+'\n'+hostPreload+'\n');
preloadCode=await readFile(preload,'utf8');
const qqPreload="require('./qq-window.cjs').installPreload();";
if(!preloadCode.includes(qqPreload))await writeFile(preload,preloadCode+'\n'+qqPreload+'\n');
preloadCode=await readFile(preload,'utf8');
const controlPreload="require('./control-window.cjs').installPreload();\nrequire('./panel-navigation.cjs').installPreload();";
if(!preloadCode.includes("require('./control-window.cjs').installPreload();"))await writeFile(preload,preloadCode+'\n'+controlPreload+'\n');
preloadCode=await readFile(preload,'utf8');
for(const module of ['pet-visibility.cjs','pet-telemetry.cjs']){const hook="require('./"+module+"').installPreload();";if(!preloadCode.includes(hook)){preloadCode+='\n'+hook+'\n';await writeFile(preload,preloadCode);}}
const html=resolve(pkg,'runtime/electron-helper/index.html');
let htmlCode=await readFile(html,'utf8');
htmlCode=localizeIndexHtml(htmlCode);
if(!htmlCode.includes('src="startup-menu.js"')) htmlCode=patchOnce(htmlCode,'<script src="./events.js"></script>','<script src="startup-menu.js"></script>\n    <script src="./events.js"></script>','启动演出菜单');
if(!htmlCode.includes('src="pet-host-menu.js"')) htmlCode=patchOnce(htmlCode,'<script src="./events.js"></script>','<script src="pet-host-menu.js"></script>\n    <script src="./events.js"></script>','联动应用菜单');
if(!htmlCode.includes('href="pet-status-strip.css"'))htmlCode=patchOnce(htmlCode,'</head>','<link rel="stylesheet" href="pet-status-strip.css">\n</head>','底部状态样式');
if(!htmlCode.includes('src="pet-status-strip.js"'))htmlCode=patchOnce(htmlCode,'<script src="./renderer.js"></script>','<script src="pet-status-strip.js"></script>\n<script src="./renderer.js"></script>','底部状态脚本');
await writeFile(html,htmlCode);
for(const file of ['codex-notifications.cjs','foreground-codex.ps1','codex-api.cjs','pet-host.cjs','pet-host-menu.cjs','pet-host-menu.js',
  'panel-theme.css','panel-navigation.cjs','panel-navigation.js','control-window.cjs','control-preload.cjs','control-window.html','control-window.css','control-window.js',
  'pet-visibility.cjs','foreground-fullscreen.ps1','system-monitor.cjs','pet-telemetry.cjs','pet-status-strip.js','pet-status-strip.css','harness-handoff.cjs',
  'qq-window.cjs','qq-preload.cjs','qq-window.html','qq-window.js','qq-window.css',
  'workbuddy-notifications.cjs','foreground-workbuddy.ps1','workbuddy-target.ps1',
  'codex-task-window.cjs','task-preload.cjs','task-window.html','task-window.js','task-window.css',
  'codex-chat-window.cjs','chat-preload.cjs','chat-window.html','chat-window.js','chat-window.css',
  'codex-skins.cjs','codex-skin-renderer.js','skin-actions.cjs','codex-character.cjs','codex-locale.cjs','locale-en.cjs','codex-runtime-locale.cjs','panel-locale.js','runtime-range.cjs']){
  await copyFile(resolve(root,'src',file),resolve(pkg,'runtime/electron-helper',file));
}
for(const file of ['codex-startup.cjs','startup-target.ps1','startup-preload.cjs','startup-menu.js','startup-window.html','startup-window.js','startup-window.css','startup-cinema.js','startup-cinema.css','startup-sheep.js','startup-sheep.css','startup-media.cjs','startup-media-probe.html','startup-media-probe.js','startup-media-probe-preload.cjs','startup-custom.js','startup-custom.css','startup-deepseek.js','startup-deepseek.css']){
  await copyFile(resolve(root,'src',file),resolve(pkg,'runtime/electron-helper',file));
}
await mkdir(resolve(root,'data'),{recursive:true});
await seedBundledWhiteDragon({projectRoot:root});
await seedBundledSheep({projectRoot:root});
await seedBundledStartup({projectRoot:root});
console.log('dsh-pet 0.3.8 runtime prepared: Codex Pet.');
