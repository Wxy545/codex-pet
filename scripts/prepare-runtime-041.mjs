import {patchStandalone040,patchHelper040,patchPlayback040,prepareRuntime040} from './prepare-runtime-040.mjs';
import {captureUpstreamSnapshot041} from './upstream-snapshot-041.mjs';
import {preserveStandalonePolicy041,protectStandaloneReads041} from './standalone-policy-041.mjs';
import {patchDrag041,patchAlpha041} from '../harness/main-fixes-041.mjs';

/** 固定0.4.1走真实新宿主和模块；共用部分只复用已核对的局部补丁。 */
export function patchStandalone041(source){return protectStandaloneReads041(patchStandalone040(preserveStandalonePolicy041(source),{version:'0.4.1'}));}
const chatGuard=`\n// codex-pet-controlled-chat-041\nObject.assign(PetSprite.prototype, {
  // 快捷键与拖图也只能打开本项目受控小窗；附件仍由该窗口的原生选择器和IPC授权。
  showChatFromMenu() { void Promise.resolve(window.codexChatPanel?.open?.()).catch(()=>{}); },
  onPasteImage() {},
  screenshotFromShortcut() {},
  startHearChat() {},
  stopHearChat() {},
});\n`;
export function patchHelper041(input,{version='0.4.1'}={}){
 if(!['0.4.1','0.4.3','0.4.8'].includes(version))throw Error('未知受控Helper运行时版本。');
 const fixed=patchHelper040(input,{version}),source=fixed['sprite/menu.js'];
 const focusBefore="  ipcMain.on('pet:focus-host', () => {\n    if (openTarget !== 'desktop') return;\n    focusDesktopApp().catch((error) => {\n      console.warn('[dsh-pet-desktop-helper] focus host failed:', error && error.message);\n    });\n  });";
 const focusAfter="  ipcMain.on('pet:focus-host', () => {\n    // 独立宿主不接受新的原生DSH聚焦捷径；本项目已有入口按真实应用核验去向。\n  });";
 const oldFocus=fixed['main/ipc.js'].split(focusBefore).length-1,newFocus=fixed['main/ipc.js'].split(focusAfter).length-1;
 if(oldFocus===1&&newFocus===0)fixed['main/ipc.js']=fixed['main/ipc.js'].replace(focusBefore,focusAfter);else if(oldFocus!==0||newFocus!==1)throw Error('0.4.1原生聚焦IPC锚点不匹配。');
 const patched=source.includes('// codex-pet-controlled-chat-041');
 if(patched&&source.split(chatGuard).length!==2)throw Error('0.4.1受控聊天补丁不完整。');
 const original=patched?source.replace(chatGuard,''):source;
 for(const anchor of ['  showChatFromMenu(image, encoded) {','  onPasteImage(e) {','  async screenshotFromShortcut() {','  startHearChat() {','  stopHearChat() {'])if(original.split(anchor).length!==2)throw Error('0.4.1受控聊天锚点不匹配。');
 if(!patched)fixed['sprite/menu.js']+=chatGuard;
 if(version==='0.4.1'){
  fixed['sprite/input.js']=patchDrag041(fixed['sprite/input.js']);
  fixed['index.html']=patchAlpha041(fixed['index.html']);
 }
 return fixed;
}
export const patchPlayback041=patchPlayback040;
export function prepareRuntime041({root,pkg}){return prepareRuntime040({root,pkg,version:'0.4.1',capture:captureUpstreamSnapshot041,patchHost:patchStandalone041,patchHelper:patchHelper041});}
