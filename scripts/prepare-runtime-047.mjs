import {patchStandalone040,prepareRuntime040} from './prepare-runtime-040.mjs';
import {patchHelper043,patchPlayback043} from './prepare-runtime-043.mjs';
import {preserveStandalonePolicy046,protectStandaloneCharacter046} from './prepare-runtime-046.mjs';
import {captureUpstreamSnapshot047} from './upstream-snapshot-047.mjs';
import {protectStandaloneReads041} from './standalone-policy-041.mjs';
import {patchModularCanvas047,patchModularMenu047,patchModularTooltip047,validateModularOwnedElectron045,validateModularHelper047} from '../harness/modular-runtime-fix.mjs';

function exactBlocks(input,changes,label,version='0.4.7'){
 if(typeof input!=='string')throw Error(version+' '+label+'锚点不匹配。');
 const source=input.replaceAll('\r\n','\n');
 const matches=side=>changes.every(pair=>{
  const own=pair[side],other=pair[1-side];
  return source.split(own).length===2&&source.split(other).length===own.split(other).length;
 });
 const before=matches(0),after=matches(1);
 if(before===after)throw Error(version+' '+label+'锚点不匹配或补丁不完整。');
 const replace=side=>changes.reduce((result,pair)=>result.replace(pair[side],()=>pair[1-side]),source);
 return before?{raw:source,fixed:replace(0),applied:false}:{raw:replace(1),fixed:source,applied:true};
}

const voiceCard047=[
 "  return card('语音', '四类语音各一个开关，互不从属；音色与音量共用。', [",
 "    toggleRow('g-voice', '手动播报', '右键菜单与斜杠命令触发的碎碎念、对话回复念出来。', g.voiceEnabled, (value) => setGlobal('voiceEnabled', value)),"
].join('\n');
const voiceCardMain=[
 "  return card('语音', '桌宠开口说话用的音色与音量。', [",
 "    toggleRow('g-voice', '语音播报', '关闭后所有语音都静音，文字气泡不受影响。', g.voiceEnabled, (value) => setGlobal('voiceEnabled', value)),"
].join('\n');
const voiceCardParts047=[
 "    toggleRow('g-voice-whisper', '周期碎碎念也念出来', '定时生成的那句碎碎念念出来。', g.voiceWhisperEnabled, (value) => setGlobal('voiceWhisperEnabled', value)),",
 "    toggleRow('g-voice-todo', '待办提醒也念出来', '到点的待办提醒念出来。', g.voiceTodoEnabled, (value) => setGlobal('voiceTodoEnabled', value)),",
 "    toggleRow('g-voice-notify', '通知播报', '任务完成、出错、等你确认时念一句配置的工作状态文案；页面被藏起来也照样念。', g.voiceNotifyEnabled, (value) => setGlobal('voiceNotifyEnabled', value)),"
].join('\n');
const voiceCardParts=[
 "    toggleRow('g-voice-whisper', '周期碎碎念也念出来', '关掉只影响周期碎碎念，手动对话照常发声。', g.voiceWhisperEnabled, (value) => setGlobal('voiceWhisperEnabled', value)),",
 "    toggleRow('g-voice-todo', '待办提醒也念出来', '关掉只影响待办提醒的朗读。', g.voiceTodoEnabled, (value) => setGlobal('voiceTodoEnabled', value)),"
].join('\n');
const voiceProjection='function readAllConfig(paths) { return CodexCharacter.projectConfig(readEditableConfig(paths)); }';
const voiceConfigChanges=[
 [voiceProjection,[
  'function readAllConfig(paths) {',
  '\tconst projected = CodexCharacter.projectConfig(readEditableConfig(paths));',
  '\t// 关闭新增通知朗读，仅改运行时投影，保留原始偏好及磁盘值。',
  '\treturn { ...projected, main: { ...projected.main, voiceNotifyEnabled: false } };',
  '}'
 ].join('\n')],
 ['\t\tconst whisperVoiceOn = cfg.main?.voiceWhisperEnabled === true;','\t\tconst whisperVoiceOn = cfg.main?.voiceEnabled === true && cfg.main.voiceWhisperEnabled === true;'],
 ['\t\tisVoiceTodoEnabled: () => readAllConfig(configPaths).main?.voiceTodoEnabled === true,',[
  '\t\tisVoiceTodoEnabled: () => {',
  '\t\t\tconst config = readAllConfig(configPaths).main;',
  '\t\t\treturn config?.voiceEnabled === true && config.voiceTodoEnabled === true;',
  '\t\t},'
 ].join('\n')],
 ['\t\tconst anim = normalizeBroadcastAnim(o.anim);\n\t\tconst speak = normalizeBroadcastVoice(o.speak);','\t\tconst anim = normalizeBroadcastAnim(o.anim);\n\t\t// 项目广播仍仅写入文字气泡，主播语音走单独授权的系统入口。'],
 [[
  '\t\t\tconst pic = d.url !== void 0 ? { url: d.url } : d.image !== void 0 ? { image: d.image } : {};',
  '\t\t\tconst want = normalizeSurface(url.searchParams.get("surface"));',
  '\t\t\tconst voiceTo = want === null ? void 0 : voiceTargetOfSurface(want);',
  '\t\t\tstate.writePet(d.petId, "say", {',
  '\t\t\t\ttext: d.text,',
  '\t\t\t\t...pic,',
  '\t\t\t\tduration: d.duration,',
  '\t\t\t\tanim: d.anim,',
  '\t\t\t\t...speak && voiceTo ? { voiceTo } : {}',
  '\t\t\t});'
 ].join('\n'),[
  '\t\t\tconst pic = d.url !== void 0 ? { url: d.url } : d.image !== void 0 ? { image: d.image } : {};',
  '\t\t\tstate.writePet(d.petId, "say", { text: d.text, ...pic, duration: d.duration, anim: d.anim });'
 ].join('\n')],
 ['function normalizeBroadcastVoice(speak) {\n\treturn speak === true;\n}','// 独立广播不接入新语音选项。'],
 [voiceCard047,voiceCardMain],
 [voiceCardParts047,voiceCardParts],
 ['    // 与 voiceTodo/voiceWhisper 的 !== false 写法不同：本项默认关，字段缺失时不能显示成已勾选，\n    // 否则设置页显示「开」而播放端拿到 undefined 当成「关」，两边打架。\n    voiceNotifyEnabled: source.voiceNotifyEnabled === true,','    // 通知语音由独立宿主保持关闭。'],
 ['    voiceNotifyEnabled: state.globals.voiceNotifyEnabled,\n    physics: physicsBody(),','    // 保存原有语音配置时保留不支持的通知字段。\n    physics: physicsBody(),'],
 ['\tconst vne = o.voiceNotifyEnabled;\n\tif (vne !== void 0 && !topFieldValid("voiceNotifyEnabled", vne)) return null;','\t// 忽略新通知语音写入，由下方的原配置合并保留既有值。'],
 ['\tif (vne !== void 0) outConfig.voiceNotifyEnabled = vne;\n\tif (te !== void 0) outConfig.trayEnabled = te;','\t// 不通过独立宿主写入通知语音。\n\tif (te !== void 0) outConfig.trayEnabled = te;'],
 ['\tif (vne !== void 0) bodyOwned.add("voiceNotifyEnabled");\n\tif (te !== void 0) bodyOwned.add("trayEnabled");','\t// 通知语音不属于本次设置保存。\n\tif (te !== void 0) bodyOwned.add("trayEnabled");']
];

export function protectStandaloneVoice047(input,{version='0.4.7'}={}){
 // 手动碎念和聊天回复已在047宿主以总闸判定，确认这两个原生门控完整后再适配其它来源。
 const chatIndent=['0.4.8','0.4.9'].includes(version)?'\t\t\t':'\t\t';
 for(const anchor of [
  '\t\tconst manualVoiceOn = cfg.main?.voiceEnabled === true;\n\t\tconst voiceOff = kind === "whisper" ? !whisperVoiceOn : !manualVoiceOn;\n\t\tconst target = voiceOff ? void 0 : voiceTo ?? voiceTargetFor(found.pet);',
  chatIndent+'const replyVoiceTo = cfg.main?.voiceEnabled === true ? voiceTargetFor(found.pet) : void 0;\n'+chatIndent+'if (generated.text !== "") state.writePet(petId, "say", {'
 ])if(typeof input!=='string'||input.replaceAll('\r\n','\n').split(anchor).length!==2)throw Error(version+' 原生手动播报锚点不匹配。');
 const changes=version==='0.4.9'?voiceConfigChanges.map(([before,after])=>{
  before=before.replace('音色与音量共用。','音色、识别实现与音量共用。')
   .replace('    voiceNotifyEnabled: state.globals.voiceNotifyEnabled,\n    physics: physicsBody(),','    voiceNotifyEnabled: state.globals.voiceNotifyEnabled,\n    // 新语音和环境设置不属于独立宿主。\n    physics: physicsBody(),');
  for(const [anchor,added] of [
   ['\n\tif (te !== void 0) outConfig.trayEnabled = te;','\n\tif (sp !== void 0) outConfig.speechProvider = sp;\n\tif (ec !== void 0) outConfig.environmentCity = String(ec).trim();'],
   ['\n\tif (te !== void 0) bodyOwned.add("trayEnabled");','\n\tif (sp !== void 0) bodyOwned.add("speechProvider");\n\tif (ec !== void 0) bodyOwned.add("environmentCity");'],
  ]){
   before=before.replace(anchor,added+anchor);
   after=after.replace(anchor,added+anchor);
  }
  return [before,after];
 }):voiceConfigChanges;
 return exactBlocks(input,changes,'独立语音来源',version).fixed;
}

export function patchStandalone047(input){
 const host=patchStandalone040(preserveStandalonePolicy046(validateModularOwnedElectron045(input)),{version:'0.4.7'});
 return protectStandaloneVoice047(protectStandaloneCharacter046(protectStandaloneReads041(host)));
}

const rendererVoiceChanges=[
 ["    // 语音：音色与音量（缺省由共享层按默认音色 / 最大音量处理）\n    voiceName: (merged && merged.main && merged.main.voiceName) || '',",
  "    // 语音总闸沿用已有偏好，缺省时关闭自动播放。\n    voiceName: (merged && merged.main && merged.main.voiceName) || '',\n    voiceEnabled: (merged && merged.main && merged.main.voiceEnabled) === true,"],
 ['    S.setVoiceConfig(cfg.voiceName, cfg.voiceVolume);','    S.setVoiceConfig(cfg.voiceName, cfg.voiceEnabled, cfg.voiceVolume);']
];
const coreVoiceChanges=[
 ['/** 工作状态播报开关；只有成品配置明确为 true 才念。 */\nlet notifyEnabled = false;','/** 自动播放总闸；用户已有语音授权未开启时不播。 */\nlet voiceEnabled = false;'],
 ['function setVoiceConfig(name, volume) {\n\tvoiceName = typeof name === "string" ? name : "";\n\tvoiceVolume = clampVolume(volume);\n\tconfigLoaded = true;\n}',[
  'function setVoiceConfig(name, enabled, volume) {',
  '\tvoiceName = typeof name === "string" ? name : "";',
  '\tvoiceEnabled = enabled === true;',
  '\tvoiceVolume = clampVolume(volume);',
  '\tconfigLoaded = true;',
  '}'
 ].join('\n')],
 ['function setVoiceNotifyEnabled(on) {\n\tnotifyEnabled = on === true;\n}\nfunction isVoiceNotifyEnabled() {\n\treturn notifyEnabled;\n}','// 共享模块保留接口形状，独立版不接入后台通知播报。\nfunction setVoiceNotifyEnabled() {}\nfunction isVoiceNotifyEnabled() {\n\treturn false;\n}'],
 ['\t\tvoiceVolume = clampVolume(main?.voiceVolume);\n\t\tsetVoiceNotifyEnabled(main?.voiceNotifyEnabled);','\t\tvoiceEnabled = main?.voiceEnabled === true;\n\t\tvoiceVolume = clampVolume(main?.voiceVolume);'],
 ['async function speakWhenReady(text, canPlayHidden = false) {\n\tawait loadConfigOnce();\n\tconst seq = ++utteranceSeq;','async function speakWhenReady(text, canPlayHidden = false) {\n\tawait loadConfigOnce();\n\tif (!voiceEnabled) {\n\t\tsetVoiceState("idle");\n\t\treturn;\n\t}\n\tconst seq = ++utteranceSeq;'],
 ['function speakNotice(text) {\n\tif (text === "") return;\n\tspeakWhenReady(text, true);\n}','function speakNotice() { /* 独立版不自动合成通知语音。 */ }']
];

/** 新版沿用已核对的语音块，先还原临时视图核验原生锚点，再保留其它运行时补丁。 */
export function standaloneHelperVoice047(input,{version='0.4.7'}={}){
 const renderer=exactBlocks(input?.['renderer.js'],rendererVoiceChanges,'独立语音渲染',version);
 const core=exactBlocks(input?.['shared-core.js'],coreVoiceChanges,'独立语音播放',version);
 if(renderer.applied!==core.applied)throw Error(version+' 独立语音补丁不完整。');
 return {
  raw:{...input,'renderer.js':renderer.raw,'shared-core.js':core.raw},
  fixed:{...input,'renderer.js':renderer.fixed,'shared-core.js':core.fixed}
 };
}

/** 仅为独立Helper恢复自动语音总闸，手动点播保持原来的用户入口和宿主鉴权。 */
export function patchHelper047(input){
 const {raw:original,fixed:voice}=standaloneHelperVoice047(input);
 validateModularHelper047(original);
 const fixed=patchHelper043(original);
 validateModularHelper047(fixed);
 fixed['renderer.js']=voice['renderer.js'];
 fixed['shared-core.js']=patchModularMenu047(exactBlocks(fixed['shared-core.js'],coreVoiceChanges,'独立语音播放').fixed);
 fixed['index.html']=patchModularCanvas047(fixed['index.html']);
 return patchModularTooltip047(fixed);
}

export const patchPlayback047=patchPlayback043;
export function prepareRuntime047({root,pkg}){
 return prepareRuntime040({root,pkg,version:'0.4.7',capture:captureUpstreamSnapshot047,patchHost:patchStandalone047,patchHelper:patchHelper047});
}
