import {patchStandalone040,prepareRuntime040} from './prepare-runtime-040.mjs';
import {patchHelper043,patchPlayback043} from './prepare-runtime-043.mjs';
import {protectStandaloneMemory045} from './prepare-runtime-045.mjs';
import {captureUpstreamSnapshot046} from './upstream-snapshot-046.mjs';
import {preserveStandalonePolicy041,protectStandaloneReads041} from './standalone-policy-041.mjs';
import {validateModularOwnedElectron045,validateModularHelper046} from '../harness/modular-runtime-fix.mjs';

const characterAnchor='const rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1));';
const characterGuard=characterAnchor+`\n\t\t// codex-pet-character-route-gate-046：角色参考图尚未接入独立宿主的原生授权导入链。
\t\tif(rest==="character"||rest.startsWith("character/"))return {kind:"json",status:403,obj:{ok:false,reason:"feature-unavailable"}};`;

/** 规范化后的整个参考图路由均拒绝，不让 GET、HEAD 或编码路径落到原生文件读取。 */
export function protectStandaloneCharacter046(input){
 if(typeof input!=='string')throw Error('0.4.6 角色参考图路由锚点不匹配。');
 const source=input.replaceAll('\r\n','\n');
 if(source.split('async function handleCharacterRoutes(deps, input) {').length!==2||source.split('if (input.rest !== "character") return void 0;').length!==2||source.split(characterAnchor).length!==2)throw Error('0.4.6 角色参考图路由锚点不匹配。');
 if(source.split(characterGuard).length===2&&source.split('codex-pet-character-route-gate-046').length===2)return source;
 if(source.includes('codex-pet-character-route-gate-046')||source.includes('rest.startsWith("character/")'))throw Error('0.4.6 角色参考图路由补丁不完整。');
 return source.replace(characterAnchor,characterGuard);
}

/** 046仍使用实际核验的current$3与原记忆模块，保留换端点换钥和独立记忆范围。 */
export function preserveStandalonePolicy046(input){
 if(typeof input!=='string'||input.split('async function testAiConnection(fetcher, current$3, input) {').length!==2)throw Error('0.4.6 连接测试编译符号锚点不匹配。');
 return protectStandaloneMemory045(preserveStandalonePolicy041(input,{version:'0.4.6'}));
}

export function patchStandalone046(input){
 const host=patchStandalone040(preserveStandalonePolicy046(validateModularOwnedElectron045(input)),{version:'0.4.6'});
 return protectStandaloneCharacter046(protectStandaloneReads041(host));
}

/** 046切屏、飞行广播与语音链均先核验；只沿用已核对的局部stage/once/loop补丁。 */
export function patchHelper046(input){
 validateModularHelper046(input);
 const fixed=patchHelper043(input);
 validateModularHelper046(fixed);
 return fixed;
}
export const patchPlayback046=patchPlayback043;
export function prepareRuntime046({root,pkg}){
 return prepareRuntime040({root,pkg,version:'0.4.6',capture:captureUpstreamSnapshot046,patchHost:patchStandalone046,patchHelper:patchHelper046});
}
