const one=(source,before,after,label)=>{const old=source.split(before).length-1,next=source.split(after).length-1;if(next===1&&old===after.split(before).length-1)return source;if(old!==1||next!==0)throw Error('0.4.1 '+label+'锚点不匹配。');return source.replace(before,after);};
const region=(source,name,run)=>{const start='//#region src/'+name,a=source.indexOf(start),b=source.indexOf('//#endregion',a);if(a<0||b<0||source.indexOf(start,a+start.length)>=0)throw Error('0.4.1 模块定位失败：'+name);return source.slice(0,a)+run(source.slice(a,b))+source.slice(b);};

/** 新版运行时保留原模块，仅恢复本项目已授权的启用、自动周期和调用上限。 */
export function preserveStandalonePolicy041(input,{version='0.4.1'}={}){
 if(!['0.4.1','0.4.3','0.4.5','0.4.6','0.4.9'].includes(version))throw Error('未知独立宿主策略版本。');
 const connectionVariable=version==='0.4.9'?'current$1':['0.4.5','0.4.6'].includes(version)?'current$3':'current$2';
 let source=input.replaceAll('\r\n','\n');
 source=region(source,'standalone/settings.ts',block=>{
  block=one(block,'\tclearApiKey: z.boolean().optional(),','\tclearApiKey: z.boolean().optional(),\n\tenabled: z.boolean().optional(),','设置启用位');
  return one(block,'\t"balanceProvider",','\t"balanceProvider",\n\t"enabled",','公开启用状态');
 });
 source=region(source,'standalone/ai-config.ts',block=>{
  block=one(block,'\tenabled: true,','\tenabled: false,','默认模型关闭');
  if(version==='0.4.9')block=one(block,'\t\t\tapiKey,\n\t\t\tdeepseekApiKey,\n\t\t\tenabled: true','\t\t\tapiKey,\n\t\t\tdeepseekApiKey: deepseekApiKey','尊重已保存启用位');
  else block=one(block,'\t\t\tapiKey,\n\t\t\tenabled: true','\t\t\tapiKey: apiKey','尊重已保存启用位');
  const conflict=version==='0.4.9'?'\t\tif (patch.clearApiKey && patch.apiKey || patch.clearDeepseekKey && patch.deepseekApiKey) throw new Error("Conflicting key changes");':'\t\tif (patch.clearApiKey && patch.apiKey) throw new Error("Conflicting key changes");';
  block=one(block,conflict,conflict+'\n\t\t// 已保存凭据仅属于原端点，换地址不能默默带走本机桥接令牌。\n\t\tif(previous.apiKey&&patch.baseUrl!==undefined&&patch.baseUrl!==previous.baseUrl&&!patch.apiKey&&!patch.clearApiKey)throw new Error("Endpoint changes require a new API key.");','保存凭据端点隔离');
  const redact=version==='0.4.9'?'apiKey, deepseekApiKey':'apiKey';
  return one(block,`const { ${redact}, enabled,...publicFields } = settings;`,`const { ${redact},...publicFields } = settings;`,'启用位脱敏投影');
 });
 source=region(source,'host/whisper-policy.ts',block=>{
  block=one(block,'\treturn {\n\t\tenabled: petEnabled && policy.isReady(),\n\t\tperiodSec: configuredPeriodSec\n\t};','\tconst period = policy.whisperIntervalSec();\n\treturn {\n\t\tenabled: petEnabled && policy.isReady() && policy.canWhisper(),\n\t\tperiodSec: Number.isFinite(period) ? Math.max(60, period) : 300\n\t};','自动碎念授权');
  return block;
 });
 source=region(source,'standalone/ai-provider/create.ts',block=>{
  block=one(block,'\t\tsaving: false,','\t\tsaving: false,\n\t\trequests: [],\n\t\tnow: dependencies.now ?? Date.now,','调用窗口');
  block=one(block,'!runtime.saving && !!store.current().model','!runtime.saving && store.current().enabled && !!store.current().model','模型启用门控');
  return one(block,'\t\tisReady: () => runtime.ready(),','\t\tisReady: () => runtime.ready(),\n\t\tcanWhisper: () => runtime.ready() && store.current().automaticWhispers,','自动开关');
 });
 source=region(source,'standalone/ai-provider/limits.ts',block=>one(block,'const MAX_EVENTS = 4096;','const MAX_EVENTS = 4096;\nconst REQUESTS_PER_MINUTE = 6;\nconst RATE_WINDOW_MS = 6e4;','原调用上限'));
 source=region(source,'standalone/ai-provider/stream.ts',block=>one(block,'\t\tif (runtime.active) throw new Error("Standalone AI is busy. Please wait.");','\t\tif (runtime.active) throw new Error("Standalone AI is busy. Please wait.");\n\t\tconst recent = runtime.requests.filter((time) => runtime.now() - time < RATE_WINDOW_MS);\n\t\tif (recent.length >= REQUESTS_PER_MINUTE) throw new Error("Standalone AI rate limit reached. Please wait.");\n\t\truntime.requests = [...recent, runtime.now()];','原六次每分钟门控'));
 source=region(source,'standalone/ai-provider/test-connection.ts',block=>one(block,`\tconst apiKey = (input.apiKey !== void 0 && input.apiKey !== "" ? input.apiKey : ${connectionVariable}.apiKey).trim();`,`\tif(input.clearApiKey===true)return {ok:false,message:"请先填写 API 密钥"};\n\tif(${connectionVariable}.apiKey&&input.baseUrl!==undefined&&baseUrl!==${connectionVariable}.baseUrl&&!input.apiKey)return {ok:false,message:"更换接口地址时请同时填写新密钥。"};\n\tconst apiKey = (input.apiKey !== void 0 && input.apiKey !== "" ? input.apiKey : ${connectionVariable}.apiKey).trim();`,'连接测试凭据端点隔离'));
 source=region(source,'standalone/context.ts',block=>{
  block=one(block,'\t\t\tisReady: () => ai.isReady(),','\t\t\tisReady: () => ai.isReady(),\n\t\t\tcanWhisper: () => ai.canWhisper(),\n\t\t\twhisperIntervalSec: () => ai.getSettings().whisperIntervalSec,','宿主自动策略');
  return one(block,'balanceAuth: () => ai.balanceAuth()','balanceAuth: () => undefined','额度仅使用注册宿主来源');
 });
 source=region(source,'standalone/settings-page/script/avatar.ts',block=>one(block,'  if (editable) {','  if (false) { // 自定义头像由本项目现有创作导入链处理。','关闭新上传控件'));
 return source;
}

/** 在共用补丁之后收紧新状态和用户头像读取，包内固定logo仍公开。 */
export function protectStandaloneReads041(source){
 // 独立宿主不接入新增的原生头像写入和原生会话聚焦；Harness自有适配不走这里。
 source=one(source,'const rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1));','const rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1));\n\t\tif(method==="POST"&&["pet-avatar","focus-session"].includes(rest))return {kind:"json",status:403,obj:{ok:false,reason:"feature-unavailable"}};','未接入写入口');
 source=one(source,'(?:config\\/editable|codex-tasks|codex-status|codex-notices|todos)(?:\\/|$)','(?:config\\/editable|codex-tasks|codex-status|codex-notices|todos|state)(?:\\/|$)','状态私有读取');
 for(const route of ['balance','models'])source=one(source,`if (pathname === "/standalone-ai/${route}") {`,`if (pathname === "/standalone-ai/${route}") {\n\t\t\trejectRequest(res,403,"feature-unavailable");return;`,'未授权外部'+route+'入口');
 return one(source,'if (["/standalone-ai/settings", "/shutdown"].includes(path)) return false;','if (/^\\/dsh-pet-\\d+\\/logo(?:\\/|$)/.test(preferencePath)) { const root=new URL(req.url??"/","http://127.0.0.1").searchParams.get("root")?.trim(); if(root&&root!=="main")return false; }\n\tif (path === "/standalone-ai/chat-panel.js") return false;\n\tif (["/standalone-ai/settings", "/shutdown"].includes(path)) return false;','用户头像及新聊天资源');
}
