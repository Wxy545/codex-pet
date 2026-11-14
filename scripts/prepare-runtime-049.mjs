import {createHash} from 'node:crypto';
import {patchStandalone040,prepareRuntime040} from './prepare-runtime-040.mjs';
import {patchHelper043,patchPlayback043} from './prepare-runtime-043.mjs';
import {protectStandaloneMemory045} from './prepare-runtime-045.mjs';
import {protectStandaloneCharacter046} from './prepare-runtime-046.mjs';
import {protectStandaloneVoice047,standaloneHelperVoice047} from './prepare-runtime-047.mjs';
import {preserveStandalonePolicy041,protectStandaloneReads041} from './standalone-policy-041.mjs';
import {captureUpstreamSnapshot049} from './upstream-snapshot-049.mjs';
import * as modularRuntime from '../harness/modular-runtime-fix.mjs';

const version='0.4.9';
const routeRest='const rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1));';

function exact(source,before,after,label,count=1){
 const already=source.split(after).length-1;
 const original=source.replaceAll(after,'').split(before).length-1;
 if(already===count&&original===0)return source;
 if(already!==0||original!==count)throw Error(`${version} ${label}锚点不匹配或补丁不完整。`);
 return source.replaceAll(before,()=>after);
}

function block(source,start,sha256,replacement,label){
 const begin=source.indexOf(start),end=source.indexOf('\n}',begin);
 if(begin<0||end<0||source.indexOf(start,begin+start.length)>=0)throw Error(`${version} ${label}锚点不匹配。`);
 const original=source.slice(begin,end+2);
 if(original===replacement)return source;
 if(createHash('sha256').update(original).digest('hex')!==sha256)throw Error(`${version} ${label}锚点不匹配。`);
 return source.slice(0,begin)+replacement+source.slice(end+2);
}

const environmentDisabled=`async function currentEnvironment() {
	// 独立宿主保留本机时间，不查询位置或天气。
	return void 0;
}`;
const defaultVoicePatch=`const DEFAULT_VOICE = "zh-CN-XiaoyiNeural";
// 旧版配置使用裸音色 ID。只在合成时解析新限定名，磁盘内容继续由原配置保存流程处理。
function standaloneEdgeVoice(value) {
	if (typeof value !== "string") return void 0;
	const voice = value.startsWith("edge/") ? value.slice(5) : value;
	return VOICES.some((item) => item.id === voice) ? "edge/" + voice : void 0;
}`;
const providerRegistration=`	ensureEdgeProvider();
	ensureDshSpeechProvider({ speechToText: () => setup.optionalService("speechToText") });
	const resolveDeepseekKey = async () => {
		const dedicated = setup.standaloneDeepseekKey();
		if (dedicated) return dedicated;
		const standalone = setup.standaloneAiBalance();
		if (standalone?.provider === DEEPSEEK_OFFICIAL_PROVIDER_ID && standalone.apiKey) return standalone.apiKey;
		const resolved = await ctx.credentials.resolve(credentialRef("DEEPSEEK_API_KEY"));
		return resolved?.value;
	};
	ensureDeepseekTtsProvider({ resolveKey: resolveDeepseekKey });
	ensureDeepseekAsrProvider({ resolveKey: resolveDeepseekKey });`;

function protectProviders(source){
 source=exact(source,providerRegistration,'\tensureEdgeProvider();\n\t// 独立宿主沿用 Edge 播放，不注册录音或联网语音服务。','独立语音注册');
 source=exact(source,'const DEFAULT_VOICE = "zh-CN-XiaoyiNeural";',defaultVoicePatch,'Edge 音色兼容');
 source=exact(source,'case "voiceName": return typeof value === "string" && VOICE_ID_PATTERN.test(value);','case "voiceName": return standaloneEdgeVoice(value) !== void 0;','独立音色范围');
 source=exact(source,'const limitedId = parsed.value.voice ?? configuredVoice?.();','const limitedId = standaloneEdgeVoice(parsed.value.voice ?? configuredVoice?.() ?? DEFAULT_VOICE);','仅用 Edge 合成');
 source=exact(source,'\t\t\tregister: registerVoiceProvider,\n\t\t\tlist: listCatalog','\t\t\tregister: () => { throw new Error("feature-unavailable"); },\n\t\t\tlist: listCatalog','独立外部合成注册');
 return exact(source,'\t\t\tregister: registerSpeechProvider,\n\t\t\tlist: listSpeechCatalog','\t\t\tregister: () => { throw new Error("feature-unavailable"); },\n\t\t\tlist: listSpeechCatalog','独立外部识别注册');
}

function protectSettings(source){
 source=exact(source,'\tdeepseekApiKey: z.string().max(4096).optional(),\n\tclearDeepseekKey: z.boolean().optional(),','\t// 独立设置不接收语音凭据。','语音密钥请求');
 source=exact(source,'\t"hasKey",\n\t"hasDeepseekKey"','\t"hasKey"\n\t// 独立设置不报告语音密钥。','语音密钥公开字段');
 source=exact(source,'\t\tasync save(input) {\n\t\t\tconst next = validateSettings(input, settings);','\t\tasync save(input) {\n\t\t\t// 已保存数据仍走原读取校验，只有设置写入入口拒绝新语音密钥。\n\t\t\tif (input && (Object.hasOwn(input, "deepseekApiKey") || Object.hasOwn(input, "clearDeepseekKey"))) throw new Error("feature-unavailable");\n\t\t\tconst next = validateSettings(input, settings);','语音密钥写入门控');
 source=exact(source,'\t\thasKey: apiKey.length > 0,\n\t\thasDeepseekKey: deepseekApiKey.length > 0','\t\thasKey: apiKey.length > 0\n\t\t// 语音密钥保持在本机原始配置。','语音密钥投影');
 for(const [before,after,label] of [
  ['\tconst nwf = o.notifyWhenFocused;','\tconst nwf = void 0; // 独立通知使用自身前后台规则。','前台提醒设置'],
  ['\tconst sp = o.speechProvider;','\tconst sp = void 0; // 独立输入窗不接受原生录音。','语音识别设置'],
  ['\tconst ec = o.environmentCity;','\tconst ec = void 0; // 独立设置不保存天气城市。','环境设置'],
 ])source=exact(source,before,after,label);
 return source;
}

function protectSettingsUi(source){
 source=block(source,'function environmentCard() {','37acdb944359aaff19fd6c2d6016a0a30ead1970960dc257f80f25fa91c818dc','function environmentCard() {\n  return null; // 独立设置不显示天气或定位。\n}','设置天气卡片');
 source=block(source,'function wireDeepseekKeyDelete(status) {','cb608fd4e577adb81bbcfc954bccc082d618c8c82d810f3d066df6e1cdea84ae','function wireDeepseekKeyDelete(status) {\n  // 独立设置没有语音密钥控件。\n}','语音密钥删除控件');
 source=block(source,'async function loadVoiceCatalog() {','15ecc7af2bee441bde2e1b310ac8576426a6e07f49d4b0d212c4389ef370a7fa','async function loadVoiceCatalog() {\n  // 使用成品中已有的 Edge 音色列表。\n}','设置语音目录');
 const lines=[
  ["    toggleRow('g-notify-focused',", '    // 前台通知由独立宿主管理。','设置前台通知控件'],
  ["    selectField('g-speech-provider',", '    // 独立输入窗不显示录音识别。','设置录音控件'],
  ['<div class="field"><label for="deepseekApiKey">','<!-- codex-pet-disabled-voice-credentials -->','语音密钥控件'],
 ];
 for(const [start,replacement,label] of lines){
  const found=source.split('\n').filter(line=>line.startsWith(start));
  if(found.length===1)source=exact(source,found[0],replacement,label);
  else if(found.length!==0||source.split(replacement).length!==2)throw Error(`${version} ${label}锚点不匹配。`);
 }
 source=exact(source,'modelCard, environmentCard, advancedCard];','modelCard, advancedCard]; // 独立设置卡片','设置卡片列表');
 source=exact(source,"  byId('deepseek-key-state').textContent = data.hasDeepseekKey ? '已保存 · 不回显' : '尚未设置';\n  byId('deepseek-key-actions').hidden = data.hasDeepseekKey !== true;\n  byId('deepseekApiKey').value = '';\n  byId('deepseekApiKey').disabled = false;",'  // 独立 AI 面板只刷新对话设置。','语音密钥读取控件');
 source=exact(source,"      deepseekApiKey: byId('deepseekApiKey').value,",'      // 独立 AI 面板只提交对话设置。','语音密钥保存控件');
 source=exact(source,"    byId('deepseekApiKey').value = '';",'    // 无语音密钥输入。','语音密钥输入清理');
 source=exact(source,'    notifyWhenFocused: state.globals.notifyWhenFocused,','    // 前台通知偏好由独立宿主保存。','设置保存前台通知');
 source=exact(source,[
  '    // 空串 = 还没读到成品值：不提交，免得用一个本地猜的实现覆盖配置',
  '    ...(state.globals.speechProvider ? { speechProvider: state.globals.speechProvider } : {}),',
  '    // 城市覆盖与上面不同：空串是有效值（= 恢复自动定位），必须照常提交',
  "    environmentCity: state.globals.environmentCity || '',",
 ].join('\n'),'    // 新语音和环境设置不属于独立宿主。','设置保存语音和环境');
 // 旧值在选单内显示对应音色，只有用户主动改选才提交新 ID。
 source=exact(source,"    voiceName: typeof source.voiceName === 'string' && source.voiceName ? source.voiceName : DEFAULT_VOICE_ID,",[
  "    voiceName: typeof source.voiceName !== 'string' || !source.voiceName ? DEFAULT_VOICE_ID : source.voiceName.includes('/') ? source.voiceName : 'edge/' + source.voiceName,",
  '    voiceNameChanged: false,',
 ].join('\n'),'设置历史音色展示');
 source=exact(source,"(value) => setGlobal('voiceName', value)),","(value) => { setGlobal('voiceName', value); g.voiceNameChanged = true; }),",'设置显式选择音色');
 return exact(source,'    voiceName: state.globals.voiceName,','    ...(state.globals.voiceNameChanged ? { voiceName: state.globals.voiceName } : {}),','设置保存保留原音色');
}

export function preserveStandalonePolicy049(input){
 let source=protectStandaloneMemory045(preserveStandalonePolicy041(input,{version}));
 source=block(source,'async function currentEnvironment(','637163c921607db7cad40752b5573b275c4fe05c4aa884c39ec2b0faf4a95fbd',environmentDisabled,'环境查询');
 source=exact(source,'const system = petSystemPrompt(found, { env: await currentEnvironment() });','const system = petSystemPrompt(found);','碎念和梦话上下文',2);
 source=exact(source,'const chatWithPet = async (petId, text, image) => {\n\t\tconst env = await currentEnvironment();','const chatWithPet = async (petId, text, image) => {\n\t\t// 先固定角色与记忆范围。','聊天异步入口');
 source=exact(source,'const system = petSystemPrompt(found, {\n\t\t\t\thistoryTimes: list.length > 0,\n\t\t\t\tenv\n\t\t\t});','const system = petSystemPrompt(found, { historyTimes: list.length > 0 });','聊天本机时间上下文');
 source=exact(source,'const picFile = resolveExisting(join(userRoot, "pic"), picRel) ?? resolveExisting(join(PACKAGE_ROOT, "assets", "pic"), picRel);','const picFile = resolveExisting(join(PACKAGE_ROOT, "assets", "pic"), picRel);','普通图片目录');
 return protectSettingsUi(protectSettings(protectProviders(source)));
}

function protectRoutes(source){
 source=exact(source,routeRest,routeRest+`
		if (["environment", "voice/hear", "voice/hear-providers", "bubble/clear"].some(path => rest === path || rest.startsWith(path + "/"))) return {kind:"json",status:403,obj:{ok:false,reason:"feature-unavailable"}};`,'独立环境、录音和气泡路由');
 return exact(source,'(?:config\\/editable|codex-tasks|codex-status|codex-notices|todos|state)(?:\\/|$)','(?:config\\/editable|codex-tasks|codex-status|codex-notices|todos|state|environment|voice\\/hear(?:-providers)?|bubble\\/clear)(?:\\/|$)','独立环境、录音和气泡鉴权');
}

export function patchStandalone049(input){
 const host=patchStandalone040(preserveStandalonePolicy049(modularRuntime.validateModularOwnedElectron049(input)),{version});
 return protectRoutes(protectStandaloneVoice047(protectStandaloneCharacter046(protectStandaloneReads041(host)),{version}));
}

export function patchHelper049(input){
 const {raw}=standaloneHelperVoice047(input,{version});
 const shared=modularRuntime.patchModularHelper049(raw);
 const fixed=patchHelper043(shared,{version});
 return standaloneHelperVoice047(fixed,{version}).fixed;
}

export const patchPlayback049=patchPlayback043;

export function prepareRuntime049({root,pkg}){
 return prepareRuntime040({root,pkg,version,capture:captureUpstreamSnapshot049,patchHost:patchStandalone049,patchHelper:patchHelper049});
}
