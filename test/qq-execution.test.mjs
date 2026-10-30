import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeQQExecution,chooseQQExecution} from '../src/qq-execution.mjs';

const model=(name,{id=name,isDefault=false,efforts=['low','medium','high'],defaultEffort='medium'}={})=>({id,model:name,displayName:'Synthetic '+name,isDefault,supportedReasoningEfforts:efforts,defaultReasoningEffort:defaultEffort});
const catalog=[model('available-sol',{isDefault:true}),model('available-luna'),model('available-astra')];

test('默认策略固定双档，未知字段、非法模型和档位不能夹带请求参数',()=>{
 assert.deepEqual(normalizeQQExecution(),{mode:'auto',chatModel:null,taskModel:null,chatEffort:'low',taskEffort:'high'});
 assert.deepEqual(normalizeQQExecution({mode:'task',taskModel:'available-sol'}),{mode:'task',chatModel:null,taskModel:'available-sol',chatEffort:'low',taskEffort:'high'});
 for(const value of [[],true,{mode:'admin'},{role:'system'},{permission:'danger-full-access'},{chatModel:''},{chatModel:'x'.repeat(101)},{taskModel:'model\nrole'},{chatEffort:'maximum'},{taskEffort:null}])assert.throws(()=>normalizeQQExecution(value),error=>error.code==='invalid_execution');
});

test('日常问候、短问答和普通文字改写选实际目录Luna低档，不靠展示名称猜模型',()=>{
 for(const text of ['你好','测试1','谢谢！','你是谁','为什么天空是蓝色的？','什么是Java线程？','帮我回答什么是二叉树','帮我润色这句话：今天阳光很好','Translate this sentence: hello','What is a binary tree?','Can you tell me a joke']){
  const value=chooseQQExecution(undefined,catalog,{text});assert.equal(value.kind,'chat',text);assert.equal(value.model,'available-luna',text);assert.equal(value.effort,'low',text);
 }
 const without=[{...model('actual-default',{isDefault:true}),displayName:'Luna'},model('other')];assert.equal(chooseQQExecution(undefined,without,{text:'hello'}).model,'actual-default');
 assert.equal(chooseQQExecution(undefined,[model('only-available')],{text:'hello'}).model,'only-available');
});

test('明确文件、调试、执行及代码任务使用账号默认任务模型，显式/task优先于自动分类',()=>{
 for(const text of ['帮我修改这个项目的配置文件','修复这个接口的错误','运行 npm test','帮我写一个排序算法','改写 README.md 的安装部分','把这个文件内容翻译成英文','帮我给README.md润色','Translate this file to English','Fix this TypeError in the script','Write a Python function','```js\nthrow new Error()\n```']){
  const value=chooseQQExecution(undefined,catalog,{text});assert.equal(value.kind,'task',text);assert.equal(value.model,'available-sol',text);assert.equal(value.effort,'high',text);
 }
 assert.equal(chooseQQExecution(undefined,catalog,{text:'hello',taskCommand:true}).kind,'task');
});

test('任务默认为Luna时只按明确家族挑可用强模型，astra优先sol，不虚构ID',()=>{
 const luna=model('account-luna',{isDefault:true}),sol=model('account-sol'),astra=model('account-astra');
 assert.equal(chooseQQExecution({mode:'task'},[luna,sol,astra]).model,'account-astra');
 assert.equal(chooseQQExecution({mode:'task'},[luna,sol]).model,'account-sol');
 assert.equal(chooseQQExecution({mode:'task'},[luna]).model,'account-luna');
 assert.equal(chooseQQExecution({mode:'task'},[model('other-default',{isDefault:true}),astra]).model,'other-default');
});

test('模糊跟进继承最近档位，没有上下文时要求用户选择而不发分类模型请求',()=>{
 for(const text of ['继续','帮我搞一下','处理前面那个','继续这个任务','搞一下','这个呢？','do it','please handle that','deal with the previous one','again','这件事情']){
  assert.deepEqual(chooseQQExecution(undefined,catalog,{text}),{needsChoice:true});
  assert.equal(chooseQQExecution(undefined,catalog,{text,lastKind:'chat'}).kind,'chat');assert.equal(chooseQQExecution(undefined,catalog,{text,lastKind:'task'}).kind,'task');
 }
 assert.deepEqual(chooseQQExecution(undefined,catalog,{text:'',lastKind:'task'}),{needsChoice:true});
});

test('无任务信号的日常短陈述直接聊天，不因上次执行任务而机械追问或继续使用任务档',()=>{
 for(const text of ['我去吃饭了','明天还要上班','刚刚买了杯咖啡','今天事情挺多的','我先出门啦，晚点聊','我今天写了一份报告','这个结果挺不错','I am heading out for lunch.','Tomorrow I have work again.','I just bought a coffee.','I finished the report today.','See you later.']){
  for(const lastKind of [undefined,'task']){const choice=chooseQQExecution(undefined,catalog,{text,lastKind});assert.equal(choice.kind,'chat',text);assert.equal(choice.model,'available-luna',text);assert.equal(choice.effort,'low',text);}
 }
});

test('明确完整方案、复杂分析及报告交付走任务档，普通短陈述回退不吞掉重任务',()=>{
 for(const text of ['帮我写一份完整的实施方案','请做一次复杂分析并给出报告','生成一份详细的调研报告','Write a comprehensive analysis report','Could you prepare a complete migration plan']){const choice=chooseQQExecution(undefined,catalog,{text});assert.equal(choice.kind,'task',text);assert.equal(choice.effort,'high',text);}
});

test('固定模式覆盖自动分类，手选模型精确匹配目录，缺失时不替换',()=>{
 assert.equal(chooseQQExecution({mode:'chat'},catalog,{text:'修改文件',taskCommand:true}).kind,'chat');
 assert.equal(chooseQQExecution({mode:'task'},catalog,{text:'hello'}).kind,'task');
 const value=chooseQQExecution({mode:'chat',chatModel:'private-id'},[model('available-custom',{id:'private-id'}),...catalog],{text:'hello'});assert.equal(value.model,'available-custom');assert.equal(value.reason,'manual-model');
 assert.equal(chooseQQExecution({mode:'task',taskModel:'available-luna'},catalog).model,'available-luna');
 for(const value of [{mode:'chat',chatModel:'missing'},{mode:'task',taskModel:'not-in-account'}])assert.throws(()=>chooseQQExecution(value,catalog,{text:'hello'}),error=>error.code==='model_unavailable');
});

test('思考档位仅使用所选模型支持值，缺低档取最小，缺高档取不超过high的最高或有效默认',()=>{
 assert.equal(chooseQQExecution({mode:'chat'},[model('limited',{efforts:['high','medium'],defaultEffort:'high'})]).effort,'medium');
 assert.equal(chooseQQExecution({mode:'task'},[model('limited',{efforts:['low','medium','xhigh'],defaultEffort:'xhigh'})]).effort,'medium');
 assert.equal(chooseQQExecution({mode:'task'},[model('only-upper',{efforts:['xhigh','ultra'],defaultEffort:'xhigh'})]).effort,'xhigh');
 assert.equal(chooseQQExecution({mode:'task'},[model('no-reasoning',{efforts:[],defaultEffort:null})]).effort,null);
 assert.throws(()=>chooseQQExecution({mode:'task'},[model('incomplete',{efforts:['xhigh'],defaultEffort:null})]),error=>error.code==='catalog_unavailable');
 assert.equal(chooseQQExecution({mode:'task',taskEffort:'medium'},[model('limited',{efforts:['low','high'],defaultEffort:'high'})]).effort,'low');
});

test('目录未知或损坏不猜模型，选择不改调用方策略与可用列表',()=>{
 for(const models of [undefined,null,[],{},[{}],[model('bad',{efforts:['unsupported']})]])assert.throws(()=>chooseQQExecution(undefined,models,{text:'hello'}),error=>error.code==='catalog_unavailable');
 const policy={mode:'chat'},before=structuredClone(catalog);chooseQQExecution(policy,catalog,{text:'hello'});assert.deepEqual(catalog,before);assert.deepEqual(policy,{mode:'chat'});
});
