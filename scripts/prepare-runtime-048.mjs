import {patchStandalone040,prepareRuntime040} from './prepare-runtime-040.mjs';
import {patchHelper043,patchPlayback043} from './prepare-runtime-043.mjs';
import {preserveStandalonePolicy046,protectStandaloneCharacter046} from './prepare-runtime-046.mjs';
import {protectStandaloneVoice047,standaloneHelperVoice047} from './prepare-runtime-047.mjs';
import {protectStandaloneReads041} from './standalone-policy-041.mjs';
import {captureUpstreamSnapshot048} from './upstream-snapshot-048.mjs';
import {patchModularHelper048,validateModularOwnedElectron048} from '../harness/modular-runtime-fix.mjs';

const version='0.4.8';

function replaceExact(source,before,after,label,expected=1){
 const applied=source.split(after).length-1;
 const original=source.replaceAll(after,'').split(before).length-1;
 if(applied===expected&&original===0)return source;
 if(applied!==0||original!==expected)throw Error(version+' '+label+'锚点不匹配或补丁不完整。');
 return source.replaceAll(before,()=>after);
}

const upstreamEnvironment=`async function currentEnvironment(deps = {}) {
	try {
		const located = await locateCity(deps);
		if (located === null) return {};
		const weather = await queryWeather(located.city, deps);
		return {
			...located.region === "" ? {} : { region: located.region },
			city: located.city,
			...weather === null ? {} : { weather }
		};
	} catch {
		return {};
	}
}`;
const inertEnvironment=`async function currentEnvironment() {
	// 独立宿主没有获准查询城市或天气；角色上下文仍使用本机时钟。
	return void 0;
}`;

export function preserveStandalonePolicy048(input){
 let source=preserveStandalonePolicy046(input);
 source=replaceExact(source,upstreamEnvironment,inertEnvironment,'环境查询');
 source=replaceExact(source,'const system = petSystemPrompt(found, { env: await currentEnvironment() });','const system = petSystemPrompt(found);','碎念和梦话上下文',2);
 source=replaceExact(source,'const chatWithPet = async (petId, text, image) => {\n\t\tconst env = await currentEnvironment();','const chatWithPet = async (petId, text, image) => {\n\t\t// 不在角色快照和记忆范围确定前等待环境查询。','聊天异步入口');
 source=replaceExact(source,'const system = petSystemPrompt(found, {\n\t\t\t\thistoryTimes: list.length > 0,\n\t\t\t\tenv\n\t\t\t});','const system = petSystemPrompt(found, { historyTimes: list.length > 0 });','聊天本机时间上下文');
 // 普通图片仍从固定包内目录读取，保留既有表情包和自有创作导入流程。
 return replaceExact(source,'const picFile = resolveExisting(join(userRoot, "pic"), picRel) ?? resolveExisting(join(PACKAGE_ROOT, "assets", "pic"), picRel);',
  'const picFile = resolveExisting(join(PACKAGE_ROOT, "assets", "pic"), picRel);','普通图片目录');
}

function protectStandaloneEnvironment048(input){
 const rest='const rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1));';
 let source=replaceExact(input,rest,rest+'\n\t\tif(rest==="environment"||rest.startsWith("environment/"))return {kind:"json",status:403,obj:{ok:false,reason:"feature-unavailable"}};','环境路由');
 source=replaceExact(source,'(?:config\\/editable|codex-tasks|codex-status|codex-notices|todos|state)(?:\\/|$)',
  '(?:config\\/editable|codex-tasks|codex-status|codex-notices|todos|state|environment)(?:\\/|$)','环境读取鉴权');
 return source;
}

export function patchStandalone048(input){
 const host=patchStandalone040(preserveStandalonePolicy048(validateModularOwnedElectron048(input)),{version});
 return protectStandaloneVoice047(protectStandaloneEnvironment048(protectStandaloneCharacter046(protectStandaloneReads041(host))),{version});
}

export function patchHelper048(input){
 const {raw}=standaloneHelperVoice047(input,{version});
 const shared=patchModularHelper048(raw);
 const fixed=patchHelper043(shared,{version});
 return standaloneHelperVoice047(fixed,{version}).fixed;
}

export const patchPlayback048=patchPlayback043;

export function prepareRuntime048({root,pkg}){
 return prepareRuntime040({root,pkg,version,capture:captureUpstreamSnapshot048,patchHost:patchStandalone048,patchHelper:patchHelper048});
}
