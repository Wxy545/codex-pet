'use strict';
const L=require('./codex-locale.cjs');
const english=require('./locale-en.cjs');
const settingsEnglish=require('./settings-en.cjs');
const chinese=value=>/[\u3400-\u9fff]/u.test(value);

// 只接收上游无用户插值的静态HTML模板；表单值仍由原populate函数从本机接口填充。
function settingsHtml(html,locale=L.getLocale()) {
  const translate=key=>locale==='zh-CN'?key:settingsEnglish[key]??L.t(key,{},locale);
  return html.replace('<html lang="zh-CN">',`<html lang="${locale==='zh-CN'?'zh-CN':'en'}">`)
    .replace(/>([^<>]*)</g,(all,text)=>{
      const key=text.trim();return chinese(key)?'>'+text.replace(key,translate(key))+'<':all;
    })
    .replace(/(placeholder|aria-label|data-title|title)="([^"]*)"/g,(all,attribute,key)=>chinese(key)?`${attribute}="${translate(key).replaceAll('&','&amp;').replaceAll('"','&quot;')}"`:all);
}

// 替换的仅是设置页开发者写下的固定JS字符串，API返回值、用户输入和模型回复不进入替换器。
function settingsScript(script,locale=L.getLocale()) {
  const prefix=`'use strict';\nconst codexSettingsDictionary=${JSON.stringify(locale==='zh-CN'?{}:{...english,...settingsEnglish})};function codexSettingsText(value){return codexSettingsDictionary[value]||value;}\n`;
  const localized=script.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g,token=>{
    if(!chinese(token))return token;
    return `codexSettingsText(${token})`;
  });
  return prefix+localized;
}
module.exports={settingsHtml,settingsScript};
