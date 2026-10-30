import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/app.mjs',import.meta.url),'utf8');
const from=source.indexOf('  function updateDisplay({strict=false}={}) {');
const to=source.indexOf('  receiveTaskChange = view => {',from);
const routeFrom=source.indexOf("  routes.push({kind:'exact',path:`${prefix}/pet-host/presentation`");
const routeTo=source.indexOf("  routes.push({ kind: 'exact', path: `${prefix}/codex-status`",routeFrom);
assert.ok(from>=0&&to>from&&routeFrom>=0&&routeTo>routeFrom,'production presentation anchors must remain explicit');

function fixture(){
 const writes=[],logs=[],responses=[],routes=[];let failing=true;
 const context=vm.createContext({
  routes,prefix:'/dsh-pet-7340',security:{token:'synthetic-capability'},
  HarnessHandoff:{isActive:()=>false},root:'synthetic-project',home:'synthetic-data',
  requestJson:async request=>request.body,json:(_response,status,body)=>{responses.push({status,body});},
  notices:[{id:'synthetic-old-notice'}],activeTaskStates:new Set(['running','cancelling']),terminalTaskStates:new Set(['completed','failed','cancelled','timed_out']),
  manualTaskView:null,manualTerminalUntil:0,mainSnapshot:{state:'working',task:'synthetic task',activeCount:1},qqView:null,
  snapshot:null,projectQQState:value=>value,Locale:{getLocale:()=> 'en'},t:value=>value,
  updateChain:Promise.resolve(),stopping:false,lastState:'',lastQuota:'',
  petRequest:async(method,path)=>{writes.push({method,path});if(failing&&path==='/work-status')throw Error('synthetic-work-status-failed');},
  logger:{warn:value=>logs.push(value)},
 });
 vm.runInContext(source.slice(from,to)+'\n'+source.slice(routeFrom,routeTo),context);
 return{context,writes,logs,responses,resume:()=>routes[0].handler({method:'POST',headers:{'x-dsh-pet-token':'synthetic-capability'},body:{mode:'resume'}},{}),repair:()=>{failing=false;}};
}

test('后台同步失败保持队列可继续，原生恢复严格报告同一次工作状态写入失败',async()=>{
 const f=fixture();
 await vm.runInContext('updateDisplay()',f.context);assert.equal(f.logs.length,1);
 await f.resume();assert.equal(f.responses.at(-1).status,500);assert.equal(f.responses.at(-1).body.error,'presentation_sync_failed');
 assert.equal(f.writes.some(value=>value.path==='/balance'),false);
 f.repair();await f.resume();assert.equal(f.responses.at(-1).status,200);
 assert.deepEqual(f.writes.slice(-2),[{method:'POST',path:'/work-status'},{method:'POST',path:'/balance'}]);
 assert.equal(f.context.snapshot.state,'working');assert.equal(f.context.notices.length,0);
});
