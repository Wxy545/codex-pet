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
const source=await readFile(resolve(pkg,'lib/standalone.js'),'utf8');
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
for(const file of ['codex-notifications.cjs','foreground-codex.ps1']){
  await copyFile(resolve(root,'src',file),resolve(pkg,'runtime/electron-helper',file));
}
await mkdir(resolve(root,'data'),{recursive:true});
console.log('dsh-pet 0.3.8 运行时已准备：Codex 宿主、真实额度窗口与系统通知。');
