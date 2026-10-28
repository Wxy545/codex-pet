'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const L=require('./codex-locale.cjs');
const {settingsHtml,settingsScript}=require('./codex-runtime-locale.cjs');
test('设置页只翻译静态标题/标签/placeholder，不改输入value或用户配置',()=>{
 const input='<html lang="zh-CN"><title>桌宠 AI 设置</title><label>模型名称</label><input value="用户自填中文" placeholder="留空保留已保存的密钥"></html>';
 const output=settingsHtml(input,'en');assert.match(output,/<html lang="en">/);assert.doesNotMatch(output,/桌宠 AI 设置|模型名称|留空保留/);assert.match(output,/value="用户自填中文"/);
 assert.equal(settingsHtml(input,'zh-CN'),input);
});
test('原设置JS固定文案英文，populate接收的配置和模型回复保持原值',()=>{
 const script="const label='保存到本机'; function populate(data){return {label,model:data.model,reply:data.reply};}";
 const context={input:{model:'用户模型名',reply:'模型自己的原始回复'}};
 vm.runInNewContext(settingsScript(script,'en')+';globalThis.result=populate(input);',context);
 assert.notEqual(context.result.label,'保存到本机');assert.equal(context.result.model,context.input.model);assert.equal(context.result.reply,context.input.reply);
});
test('prepare实际生成的AI设置页与脚本显示英文，GET回填中文自定义模型名保持原样',async()=>{
 L.setLocale('en');
 const source=fs.readFileSync(path.join(__dirname,'../node_modules/dsh-pet/lib/codex-host.js'),'utf8');
 const helper={settingsHtml,settingsScript};
 const htmlExpression=source.match(/const settingsPage = ([\s\S]*?);\nconst settingsStyle/)[1];
 const scriptExpression=source.match(/const settingsScript = ([\s\S]*?);\n\n\/\/#endregion/)[1];
 const html=vm.runInNewContext('('+htmlExpression+')',{CodexRuntimeLocale:helper});
 assert.doesNotMatch(html,/[\u3400-\u9fff]/u);assert.match(html,/<html lang="en">/);
 const script=vm.runInNewContext('('+scriptExpression+')',{CodexRuntimeLocale:helper});
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',dataset:{},addEventListener(){}});return nodes.get(id);};
 const context={URLSearchParams,location:{hash:'#token=fixture-only',pathname:'/standalone-ai'},history:{replaceState(){}},document:{getElementById:get},fetch:async()=>({ok:true,json:async()=>({protocol:'openai-compatible',baseUrl:'http://127.0.0.1:1234/v1',model:'用户自己的模型名',hasKey:true})})};
 vm.runInNewContext(script,context);await new Promise(setImmediate);
 assert.equal(get('model').value,'用户自己的模型名');assert.doesNotMatch(get('status').textContent,/[\u3400-\u9fff]/u);assert.doesNotMatch(get('key-state').textContent,/[\u3400-\u9fff]/u);
});
test('原额度气泡使用英文窗口/已用/重置模板，已过期不重复拼接Reset',()=>{
 process.env.CODEX_PET_LOCALE='en';L.setLocale('en');
 const context={CodexLocale:L};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../node_modules/dsh-pet/runtime/electron-helper/shared-core.js'),'utf8'),context);const S=context.PetShared;
 const future=new Date(Date.now()+2*3600000).toISOString();
 const state={ok:true,shape:'windows',weekly:37,weeklyResetsAt:future};
 const rows=S.balanceBubbleView(state);const text=rows.map(row=>row.text).join(' ');
 assert.doesNotMatch(text,/[\u3400-\u9fff]/u);assert.match(text,/37%/);assert.match(text,/reset/i);
 const expired=S.balanceBubbleView({...state,weeklyResetsAt:new Date(Date.now()-1).toISOString()});
 assert.doesNotMatch(expired.map(row=>row.text).join(' '),/Reset.*Reset|已重置重置/);
});
