// 保留上游原文件；只生成固定版本的 Codex 宿主入口和额度解析补丁。
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { localizeHost, localizeCore, localizeEvents, localizeIndexHtml } from './runtime-locale-patches.mjs';
import { patchHostAssets, patchBridgeAssets, patchDesktopMotion } from './upstream-fixes.mjs';

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
source=patchOnce(source,'return out;\n}\nfunction flattenPetList','return CodexCharacter.projectConfig(out);\n}\nfunction flattenPetList','角色配置');
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
await writeFile(events,localizeEvents(await readFile(events,'utf8')));
const sprite=resolve(pkg,'runtime/electron-helper/sprite.js');
await writeFile(sprite,patchDesktopMotion(await readFile(sprite,'utf8')));
// 仅向原桌面壳追加通知入口，动画、物理、菜单仍运行原实现。
const main=resolve(pkg,'runtime/electron-helper/main.js');
let mainCode=await readFile(main,'utf8');
mainCode=patchBridgeAssets(mainCode);
await writeFile(main,mainCode);
const noticeHook="require('./codex-notifications.cjs').install({hostRequest});";
if(!mainCode.includes(noticeHook)) await writeFile(main,mainCode+'\n'+noticeHook+'\n');
mainCode=await readFile(main,'utf8');
const extensionHook=`// codex-pet-extensions-v2
const codexPanelRequest = require('./codex-api.cjs').createHostRequest();
const codexTaskPanel = require('./codex-task-window.cjs').install({hostRequest:codexPanelRequest});
const codexChatPanel = require('./codex-chat-window.cjs').install({hostRequest:codexPanelRequest,openTaskPanel:()=>codexTaskPanel.open()});
require('./codex-skins.cjs').install({hostRequest,dataRoot:process.env.DSH_HOME,onSelectionChanged:async model=>{const character=model.characters.find(item=>item.id===model.selection.character);codexChatPanel.onCharacterChanged?.({id:model.selection.character,name:character.copy.name,locale:model.locale});if(tray){tray.destroy();tray=null;}await startTray();}});
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
await writeFile(main,mainCode);
const preload=resolve(pkg,'runtime/electron-helper/preload.js');
let preloadCode=await readFile(preload,'utf8');
const preloadHook=`// codex-pet-preloads-v1
require('./codex-task-window.cjs').installPreload();
require('./codex-chat-window.cjs').installPreload();
require('./codex-skins.cjs').installPreload();`;
if(!preloadCode.includes('// codex-pet-preloads-v1')) await writeFile(preload,preloadCode+'\n'+preloadHook+'\n');
const html=resolve(pkg,'runtime/electron-helper/index.html');
let htmlCode=await readFile(html,'utf8');
htmlCode=localizeIndexHtml(htmlCode);
await writeFile(html,htmlCode);
for(const file of ['codex-notifications.cjs','foreground-codex.ps1','codex-api.cjs',
  'codex-task-window.cjs','task-preload.cjs','task-window.html','task-window.js','task-window.css',
  'codex-chat-window.cjs','chat-preload.cjs','chat-window.html','chat-window.js','chat-window.css',
  'codex-skins.cjs','codex-skin-renderer.js','skin-actions.cjs','codex-character.cjs','codex-locale.cjs','locale-en.cjs','codex-runtime-locale.cjs','panel-locale.js','runtime-range.cjs']){
  await copyFile(resolve(root,'src',file),resolve(pkg,'runtime/electron-helper',file));
}
await mkdir(resolve(root,'data'),{recursive:true});
console.log('dsh-pet 0.3.8 runtime prepared: Codex Pet.');
