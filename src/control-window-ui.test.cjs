'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'control-window.js'),'utf8');
function run({saved,host='codex',blocked=false,response,get,selectHost}={}){
 const calls=[],stored=[],elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{dataset:{},attributes:{},addEventListener(type,fn){this[type]=fn;},setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name];},focus(){},hidden:false});return elements.get(id);};
 const tabs=['character','actions','interaction','chatter','startup'].map(id=>{const node=element('tab-'+id);node.dataset.section=id;return node;});
 const hosts=['codex','workbuddy','harness'].map(id=>{const node=element('host-'+id);node.dataset.host=id;return node;});
 const tablist=element('tabs');
 const document={documentElement:{lang:'en'},getElementById:element,querySelector:()=>tablist,querySelectorAll:selector=>selector==='[data-section]'?tabs:selector==='[data-host]'?hosts:selector==='[data-copy="balance"]'?[element('balance-label')]:[],addEventListener(){}};
 let hostListener=null,unsubscribed=0;const events=new Map();
 const window={controlCenter:{get:section=>{calls.push(section);return get?get(section):response?Promise.resolve(response):new Promise(()=>{});},selectHost},petPanels:{host,onChanged:handler=>{hostListener=handler;return()=>{hostListener=null;unsubscribed++;};}},localStorage:{getItem(){if(blocked)throw new Error('disabled');return saved;},setItem(key,value){if(blocked)throw new Error('disabled');stored.push({key,value});}},addEventListener:(name,handler)=>events.set(name,handler)};
 vm.runInNewContext(source,{window,document,navigator:{language:'en'}});
 return{calls,stored,tabs,element,hosts,hostChanged:host=>hostListener?.({host}),close:()=>events.get('beforeunload')?.(),unsubscribed:()=>unsubscribed};
}
test('新helper恢复最近合法分区，WorkBuddy过滤碎念，存储被禁用仍可打开',()=>{
 assert.deepEqual(run({saved:'interaction'}).calls,['interaction']);assert.deepEqual(run({saved:'actions'}).calls,['actions']);assert.deepEqual(run({saved:'actions',host:'workbuddy'}).calls,['actions']);assert.deepEqual(run({saved:'startup'}).calls,['startup']);assert.deepEqual(run({saved:'chatter',host:'workbuddy'}).calls,['character']);assert.deepEqual(run({saved:'not-a-page'}).calls,['character']);assert.deepEqual(run({saved:'interaction',blocked:true}).calls,['character']);
});
test('切换分区记录最近位置，只保存固定分区名',()=>{const f=run();f.tabs.find(tab=>tab.dataset.section==='interaction').click();assert.equal(f.stored.at(-1).value,'interaction');assert.deepEqual(f.calls,['character','interaction']);});

test('额度开关明确归属当前应用，切换后不保留上一宿主的额度名称',()=>{
 const f=run({host:'codex'});assert.equal(f.element('balance-label').textContent,'Codex usage display and reactions');
 f.hostChanged('workbuddy');assert.equal(f.element('balance-label').textContent,'WorkBuddy credits display and reactions');
 f.hostChanged('codex');assert.equal(f.element('balance-label').textContent,'Codex usage display and reactions');
});

test('Harness接管时转到宿主选择，隐藏独立版设置和启动电影',async()=>{
 const f=run({saved:'interaction',response:{ok:true,state:{section:'startup',host:{host:'harness',external:true},locale:'en',startup:{mode:'both'}}}});
 await new Promise(setImmediate);
 for(const id of ['tab-character','tab-actions','tab-interaction','tab-chatter','startup-modes'])assert.equal(f.element(id).hidden,true);
 assert.equal(f.element('section-startup').hidden,false);assert.equal(f.stored.at(-1).value,'startup');
 assert.deepEqual(run({host:'harness',saved:'character'}).calls,['startup']);
});

test('托盘变更宿主立即同步能力与选择，迟到旧读取不能覆盖，卸载解除监听',async()=>{
 const waiting=[];const f=run({saved:'interaction',get:section=>new Promise(resolve=>waiting.push({section,resolve}))});
 f.hostChanged('harness');assert.deepEqual(f.calls,['interaction','startup']);assert.equal(f.element('tab-interaction').hidden,true);assert.equal(f.element('host-harness').getAttribute('aria-pressed'),'true');
 waiting[0].resolve({ok:true,state:{host:{host:'codex'},section:'interaction'}});await new Promise(setImmediate);assert.equal(f.element('tab-interaction').hidden,true);
 waiting[1].resolve({ok:true,state:{host:{host:'harness',external:true},section:'startup',startup:{mode:'both'},locale:'en'}});await new Promise(setImmediate);assert.equal(f.element('section-startup').hidden,false);
 f.hostChanged('codex');assert.equal(f.element('tab-interaction').hidden,false);assert.equal(f.element('host-codex').getAttribute('aria-pressed'),'true');
 waiting[2].resolve({ok:true,state:{host:{host:'codex'},section:'startup',startup:{mode:'both'},locale:'en'}});await new Promise(setImmediate);
 f.close();assert.equal(f.unsubscribed(),1);const calls=f.calls.length;f.hostChanged('harness');assert.equal(f.calls.length,calls);
});

test('保存等待期间的宿主事件失效旧响应，操作收尾后按新宿主重读',async()=>{
 let finish;const changed=new Promise(resolve=>{finish=resolve;});const pending=[];
 const f=run({saved:'startup',get:section=>new Promise(resolve=>pending.push({section,resolve})),selectHost:()=>changed});
 pending[0].resolve({ok:true,state:{host:{host:'codex'},startup:{mode:'both'},locale:'en'}});await new Promise(setImmediate);
 f.element('host-workbuddy').click();f.hostChanged('harness');finish({ok:true,host:{host:'workbuddy'}});await new Promise(setImmediate);
 assert.equal(f.element('host-harness').getAttribute('aria-pressed'),'true');assert.equal(f.element('tab-character').hidden,true);assert.equal(pending.at(-1).section,'startup');assert.equal(f.calls.length,2);
 f.close();
});
