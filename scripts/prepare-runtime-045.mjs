import {patchStandalone040,prepareRuntime040} from './prepare-runtime-040.mjs';
import {patchHelper043,patchPlayback043} from './prepare-runtime-043.mjs';
import {captureUpstreamSnapshot045} from './upstream-snapshot-045.mjs';
import {preserveStandalonePolicy041,protectStandaloneReads041} from './standalone-policy-041.mjs';
import {validateModularOwnedElectron045} from '../harness/modular-runtime-fix.mjs';

const memoryBefore = "//#region src/host/chat-memory-provider.ts\nconst NATIVE_MEMORY_ID = \"native\";\n/** 当前生效的第三方实现；null = 没注册，走原生路径。 */\nlet current = null;\nfunction registerChatMemoryProvider(def) {\n\tif (!def || typeof def !== \"object\") throw new TypeError(\"memory provider 定义必须是对象\");\n\tif (typeof def.id !== \"string\" || def.id.length === 0) throw new TypeError(\"id 必须是非空字符串\");\n\tif (def.id === NATIVE_MEMORY_ID) throw new TypeError(\"不能占用原生实现标识: \" + NATIVE_MEMORY_ID);\n\tif (typeof def.recall !== \"function\" && typeof def.capture !== \"function\") throw new TypeError(\"recall 与 capture 至少要有一个是函数\");\n\tcurrent = def;\n\treturn () => {\n\t\tif (current === def) current = null;\n\t};\n}\nfunction activeChatMemoryProvider() {\n\treturn current;\n}\nfunction listChatMemoryProviders() {\n\treturn {\n\t\tbuiltin: [NATIVE_MEMORY_ID],\n\t\texternal: current ? [current.id] : []\n\t};\n}\n\n";
const memoryAfter = `//#region src/host/chat-memory-provider.ts
const NATIVE_MEMORY_ID = "native";
// codex-pet-memory-provider-gate-045：独立宿主未接入外部记忆，不交出角色、账户或上下文票据范围。
function registerChatMemoryProvider() {
\tthrow new Error("feature-unavailable");
}
function activeChatMemoryProvider() {
\treturn null;
}
function listChatMemoryProviders() {
\treturn { builtin: [NATIVE_MEMORY_ID], external: [] };
}

`;

/** 拒绝新第三方注册并切断内部召回/接收路径；本项目授权记忆与原生磁盘记忆不变。 */
export function protectStandaloneMemory045(input){
 if(typeof input!=='string')throw Error('0.4.5 独立记忆锚点不匹配。');
 const source=input.replaceAll('\r\n','\n'),marker='//#region src/host/chat-memory-provider.ts';
 const old=source.split(memoryBefore).length-1,current=source.split(memoryAfter).length-1;
 if(source.split(marker).length!==2)throw Error('0.4.5 独立记忆模块不唯一。');
 if(old===0&&current===1)return source;
 if(old!==1||current!==0)throw Error('0.4.5 独立记忆锚点不匹配。');
 return source.replace(memoryBefore,memoryAfter);
}

/** 045的新编译符号单独核验，保留既有模型授权、限流与端点凭据隔离。 */
export function preserveStandalonePolicy045(input){
 return protectStandaloneMemory045(preserveStandalonePolicy041(input,{version:'0.4.5'}));
}

export function patchStandalone045(input){
 return protectStandaloneReads041(patchStandalone040(preserveStandalonePolicy045(validateModularOwnedElectron045(input)),{version:'0.4.5'}));
}

// 官方045整个helper目录与043逐文件同摘要，继续使用其完整模块/once/loop/舞台契约。
export const patchHelper045=patchHelper043;
export const patchPlayback045=patchPlayback043;
export function prepareRuntime045({root,pkg}){
 return prepareRuntime040({root,pkg,version:'0.4.5',capture:captureUpstreamSnapshot045,patchHost:patchStandalone045,patchHelper:patchHelper045});
}
