import {patchStandalone040,patchPlayback040,prepareRuntime040} from './prepare-runtime-040.mjs';
import {patchHelper041} from './prepare-runtime-041.mjs';
import {captureUpstreamSnapshot043} from './upstream-snapshot-043.mjs';
import {preserveStandalonePolicy041,protectStandaloneReads041} from './standalone-policy-041.mjs';
import {patchModularPlayback043,validateModularHelper043} from '../harness/modular-runtime-fix.mjs';

/** 0.4.3沿用逐项核对过的宿主策略，不改变已保存的账号、周期和权限。 */
export function patchStandalone043(source){return protectStandaloneReads041(patchStandalone040(preserveStandalonePolicy041(source),{version:'0.4.3'}));}

/** 原循环续播留给043状态机；只纠正单次标记并保留本项目解冻后的状态同步。 */
export function patchPlayback043(input){return patchPlayback040(patchModularPlayback043(input));}

export function patchHelper043(input){
 validateModularHelper043(input);
 const fixed=patchHelper041({...input,'sprite/playback.js':patchModularPlayback043(input['sprite/playback.js'])},{version:'0.4.3'});
 const source=fixed['sprite/init.js'],before="    stage.className = 'pet-stage';",after=before+'\n    this.stage = stage; // codex-pet-stage-reference-043';
 if(typeof source!=='string'||source.split(before).length!==2)throw Error('0.4.3角色覆盖层锚点不匹配。');
 // 上游不再保存stage引用；本项目的透明覆盖层仍须挂在同一DOM，不能另建舞台。
 if(source.split(after).length===2&&(source.match(/this\.stage\s*=/g)||[]).length===1)return fixed;
 if(source.includes('codex-pet-stage-reference-043')||/this\.stage\s*=/.test(source))throw Error('0.4.3角色覆盖层补丁不完整。');
 fixed['sprite/init.js']=source.replace(before,after);
 return fixed;
}

export function prepareRuntime043({root,pkg}){return prepareRuntime040({root,pkg,version:'0.4.3',capture:captureUpstreamSnapshot043,patchHost:patchStandalone043,patchHelper:patchHelper043});}
