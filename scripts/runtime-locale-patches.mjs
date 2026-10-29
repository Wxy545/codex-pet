// 固定dsh-pet@0.3.8的可见模板补丁。仅处理源码字符串；不扫描或改写运行数据。
const chinese=value=>/[\u3400-\u9fff]/u.test(value);
const quotePattern=/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;
function one(text,anchor,next,label){if(text.split(anchor).length!==2)throw Error(`${label}本地化锚点不匹配。`);return text.replace(anchor,next);}
function region(text,start,end,transform,label){const a=text.indexOf(start),b=text.indexOf(end,a+start.length);if(a<0||b<0||text.indexOf(start,a+start.length)>=0)throw Error(`${label}本地化范围不匹配。`);return text.slice(0,a)+transform(text.slice(a,b))+text.slice(b);}
const literals=code=>code.replace(quotePattern,token=>chinese(token)?`codexFixedText(${token})`:token);

export function localizeIndexHtml(source){
  // 装饰器后安装者先执行：启动菜单→角色菜单→宿主能力过滤→原生菜单，避免加回不可用入口。
  const scripts=['locale-en.cjs','codex-locale.cjs','skin-actions.cjs','pet-host-menu.js','codex-skin-renderer.js','startup-menu.js'];
  // 先移除自己管理的标签，再一次插入；干净安装与旧helper必须有相同的依赖顺序。
  for(const file of scripts){const escaped=file.replaceAll('.','\\.');source=source.replace(new RegExp('[\\t ]*<script\\s+src=["\\\'](?:\\./)?'+escaped+'["\\\']><\\/script>[\\t ]*\\r?\\n?','g'),'');}
  const anchor='<script src="./sprite.js"></script>';
  source=one(source,anchor,anchor+'\n'+scripts.map(file=>'    <script src="'+file+'"></script>').join('\n'),'主窗口脚本顺序');
  return source.replace('<title>dsh-pet 桌宠（桌面模式）</title>','<title>Codex Pet</title>').replace('<title>龙娘桌宠</title>','<title>Codex Pet</title>');
}

export function localizeHost(source){
  source=source.replace(/^(#![^\n]*\n)?/,'$1import CodexRuntimeLocale from "../runtime/electron-helper/codex-runtime-locale.cjs";\nimport CodexLocale from "../runtime/electron-helper/codex-locale.cjs";\nconst codexFixedText=(value,values)=>CodexLocale.t(value,values);\n');
  source=region(source,'//#region src/standalone/settings.ts','//#region src/standalone/settings-page.ts',literals,'AI设置校验');
  source=one(source,'const settingsPage = `','const settingsPage = CodexRuntimeLocale.settingsHtml(`','AI设置HTML');
  source=one(source,'</noscript></main></body></html>`;','</noscript></main></body></html>`);','AI设置HTML结束');
  source=one(source,'const settingsScript = `','const settingsScript = CodexRuntimeLocale.settingsScript(`','AI设置脚本');
  source=one(source,"})();\n`;\n\n//#endregion\n//#region src/standalone/server.ts","})();\n`);\n\n//#endregion\n//#region src/standalone/server.ts",'AI设置脚本结束');
  // 只翻译设置HTTP接口/连接测试的固定错误，不翻译reply或任何配置字符串。
  source=region(source,'function settingsHandler(ai)','function dispatch(options, shutdownSecurity)',literals,'AI设置请求');
  source=region(source,'async testConnection(', '\n\t\tcanWhisper:',code=>{
    code=literals(code);
    return one(code,'message: `连接失败：${rawMsg}`','message: codexFixedText("连接失败：{message}",{message:rawMsg})','AI连接错误');
  },'AI连接测试');
  return source;
}

export function localizeCore(source){
  if(source.includes('// codex-runtime-locale-v2'))return source;
  // 已安装的v1 helper也须修正；缺少时间与已过重置点不能混成同一结果。
  const resetTemplate='reset ? reset !== codexFixedText("已重置") ? codexFixedText("{time}后重置",{time:reset}) : codexFixedText("已重置") : codexFixedText("重置时间未知")';
  if(source.includes('// codex-runtime-locale-v1')){
    const previous='reset && reset !== codexFixedText("已重置") ? codexFixedText("{time}后重置",{time:reset}) : codexFixedText("已重置")';
    source=one(source,'text: '+previous,'text: '+resetTemplate,'旧额度重置主行升级');
    source=one(source,'const resetText = '+previous+';','const resetText = '+resetTemplate+';','旧额度重置详情升级');
    return source.replace('// codex-runtime-locale-v1','// codex-runtime-locale-v2');
  }
  // helper在调用时读locale：shared-core早于locale脚本加载，不能在常量初始化时锁定中文。
  source='// codex-runtime-locale-v2\nfunction codexFixedText(value,values){const locale=globalThis.CodexLocale||(typeof require==="function"?require("./codex-locale.cjs"):null);return locale?locale.t(value,values):value;}\n'+source;
  source=one(source,'return WINDOW_LABELS[w];','return codexFixedText(WINDOW_LABELS[w]);','额度窗口名');
  const start='function resetInText(iso)',end='const windowsHandler =';
  source=region(source,start,end,code=>{
    code=one(code,'text: w.label + "额度已用 " + Math.round(w.percent) + "%"','text: codexFixedText("{label}额度已用 {percent}%",{label:w.label,percent:Math.round(w.percent)})','额度主行');
    code=one(code,'text: reset ? reset + "重置" : "已重置"','text: '+resetTemplate,'额度重置主行');
    code=one(code,'const resetText = reset === "" ? "已重置" : reset + "重置";','const resetText = '+resetTemplate+';','额度重置详情');
    // 新模板已经包裹；只处理尚未包裹的固定单位和空数据提示。
    for(const value of ['已重置',' 天',' 小时','额度数据不可用'])code=code.replaceAll('"'+value+'"',(token,index,whole)=>whole.slice(Math.max(0,index-15),index).endsWith('codexFixedText(')?token:'codexFixedText('+token+')');
    return code;
  },'额度窗口模板');
  // 非windows的余额提示为固定开发者文案，数值、币种和提供方message保持原样。
  for(const value of ['当前服务商暂不支持余额查询','缺少余额查询凭证','余额查询失败'])source=source.replaceAll('text: "'+value+'"','text: codexFixedText("'+value+'")');
  return source;
}

export function localizeEvents(source){
  if(source.includes('// codex-events-locale-v1'))return source;
  source='// codex-events-locale-v1\n'+source;
  // 仅固定诊断，text/image/任务内容不进入翻译器。
  const values=['[dsh-pet] 配置缺少 animations.events.whisper，无法播放碎碎念动画',' （不联动动画）','[dsh-pet] 配置缺少 animations.events.balance，无法播放余额事件动画','[dsh-pet] balance 档位索引越界：p=','[dsh-pet] 余额查询失败 reason='];
  for(const value of values){const token=JSON.stringify(value),single="'"+value+"'";if(!source.includes(token)&&!source.includes(single))throw Error('事件诊断本地化锚点缺失。');source=source.replaceAll(token,'codexFixedText('+token+')').replaceAll(single,'codexFixedText('+single+')');}
  return source;
}
