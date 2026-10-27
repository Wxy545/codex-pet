// 保留上游原文件；只生成固定版本的 Codex 宿主入口和额度解析补丁。
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

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
await writeFile(core,quotaPatch(await readFile(core,'utf8')));
// 仅向原桌面壳追加通知入口，动画、物理、菜单仍运行原实现。
const main=resolve(pkg,'runtime/electron-helper/main.js');
let mainCode=await readFile(main,'utf8');
const noticeHook="require('./codex-notifications.cjs').install({hostRequest});";
if(!mainCode.includes(noticeHook)) await writeFile(main,mainCode+'\n'+noticeHook+'\n');
mainCode=await readFile(main,'utf8');
const extensionHook=`// codex-pet-extensions-v1
const codexPanelRequest = require('./codex-api.cjs').createHostRequest();
const codexTaskPanel = require('./codex-task-window.cjs').install({hostRequest:codexPanelRequest});
require('./codex-chat-window.cjs').install({hostRequest:codexPanelRequest,openTaskPanel:()=>codexTaskPanel.open()});
require('./codex-skins.cjs').install({hostRequest,dataRoot:process.env.DSH_HOME});`;
if(!mainCode.includes('// codex-pet-extensions-v1')) await writeFile(main,mainCode+'\n'+extensionHook+'\n');
mainCode=await readFile(main,'utf8');
const oldTray="tray.setToolTip('dsh-pet 桌面宠物');";
if(mainCode.includes(oldTray)) await writeFile(main,mainCode.replace(oldTray,"tray.setToolTip('龙娘桌宠');"));
const preload=resolve(pkg,'runtime/electron-helper/preload.js');
let preloadCode=await readFile(preload,'utf8');
const preloadHook=`// codex-pet-preloads-v1
require('./codex-task-window.cjs').installPreload();
require('./codex-chat-window.cjs').installPreload();
require('./codex-skins.cjs').installPreload();`;
if(!preloadCode.includes('// codex-pet-preloads-v1')) await writeFile(preload,preloadCode+'\n'+preloadHook+'\n');
const html=resolve(pkg,'runtime/electron-helper/index.html');
let htmlCode=await readFile(html,'utf8');
htmlCode=htmlCode.replace('<title>dsh-pet 桌宠（桌面模式）</title>','<title>龙娘桌宠</title>');
if(!htmlCode.includes('codex-skin-renderer.js')){
  const anchor='<script src="./sprite.js"></script>';
  if(htmlCode.split(anchor).length!==2) throw new Error('形象渲染入口定位失败。');
  htmlCode=htmlCode.replace(anchor,anchor+'\n    <script src="skin-actions.cjs"></script>\n    <script src="codex-skin-renderer.js"></script>');
}
await writeFile(html,htmlCode);
for(const file of ['codex-notifications.cjs','foreground-codex.ps1','codex-api.cjs',
  'codex-task-window.cjs','task-preload.cjs','task-window.html','task-window.js','task-window.css',
  'codex-chat-window.cjs','chat-preload.cjs','chat-window.html','chat-window.js','chat-window.css',
  'codex-skins.cjs','codex-skin-renderer.js','skin-actions.cjs']){
  await copyFile(resolve(root,'src',file),resolve(pkg,'runtime/electron-helper',file));
}
await mkdir(resolve(root,'data'),{recursive:true});
console.log('dsh-pet 0.3.8 运行时已准备：龙娘桌宠、图文对话、目录操作任务与系统通知。');
