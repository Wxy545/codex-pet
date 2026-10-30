import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const settle=()=>new Promise(resolve=>setImmediate(resolve));

function rendererFixture(page, api) {
  const elements=new Map(), events=new Map(), intervals=[];
  function element(id) {
    if(elements.has(id)) return elements.get(id);
    const listeners=new Map(); let scrollTop=0;
    let content='';
    const node={id,value:'',hidden:false,disabled:false,dataset:{},children:[],style:{},replacements:0,textWrites:0,
      clientHeight:200,scrollHeight:1200,className:'',
      setAttribute(name,value){this[name]=value;},
      addEventListener(name,handler){listeners.set(name,handler);},
      append(...children){this.children.push(...children);},
      replaceChildren(...children){this.children=children;this.replacements++;},
      focus(){},
      fire(name,event={}){return listeners.get(name)?.({preventDefault(){},...event});},
    };
    Object.defineProperty(node,'scrollTop',{get:()=>scrollTop,set:value=>{scrollTop=Math.max(0,Math.min(value,node.scrollHeight-node.clientHeight));}});
    Object.defineProperty(node,'textContent',{get:()=>content,set:value=>{content=value;node.textWrites++;}});
    elements.set(id,node);return node;
  }
  element('task-form').elements={permission:{value:'read-only'}};
  const document={title:'',documentElement:{lang:'en'},getElementById:element,createElement:tag=>element(Symbol(tag))};
  const window={CodexLocale:{t:value=>value},CodexPanelLocale:{apply(){}},addEventListener:(name,fn)=>events.set(name,fn),[page==='chat'?'chatPanel':'taskPanel']:api};
  vm.runInNewContext(readFileSync(new URL(`../src/${page}-window.js`,import.meta.url),'utf8'),{document,window,setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{intervals.push(fn);return 1;},clearInterval(){}});
  return{element,intervals,close:()=>events.get('beforeunload')?.()};
}

function chatFixture() {
  let push;
  const state={locale:'en',character:{id:'white-dragon',name:'Dragon'},revision:1,busy:false,selecting:false,attachments:[],messages:[{role:'user',text:'Question'},{role:'assistant',text:'A long answer'}]};
  const api={getState:async()=>({ok:true,state:structuredClone(state)}),onState:fn=>{push=fn;return()=>{};},sendMessage:async({text})=>({ok:true,state:{...structuredClone(state),messages:[...state.messages,{role:'user',text}]}})};
  const f=rendererFixture('chat',api);
  return{...f,state,push:patch=>push(structuredClone({...state,...patch}))};
}

test('聊天状态与附件变化保留历史阅读位置，不重建相同消息',async t=>{
  const f=chatFixture();t.after(f.close);await settle();const log=f.element('messages');
  assert.equal(log.scrollTop,1000);
  log.scrollTop=120;log.fire('scroll');const replacements=log.replacements;
  f.push({selecting:true});
  f.push({attachments:[{id:'image-1',name:'Reference.png',dataUrl:'data:image/png;base64,c3ludGhldGlj'}]});
  assert.equal(log.scrollTop,120);assert.equal(log.replacements,replacements);
});

test('新回复尊重历史阅读，接近底部时才自动跟随',async t=>{
  const f=chatFixture();t.after(f.close);await settle();const log=f.element('messages');
  log.scrollTop=200;log.fire('scroll');
  f.push({messages:[...f.state.messages,{role:'assistant',text:'A later reply'}]});
  assert.equal(log.scrollTop,200);
  log.scrollTop=980;log.fire('scroll');log.scrollHeight=1400;
  f.push({messages:[...f.state.messages,{role:'assistant',text:'Another reply'}]});
  assert.equal(log.scrollTop,1200);
});

test('用户主动发送新消息后回到对话底部',async t=>{
  const f=chatFixture();t.after(f.close);await settle();const log=f.element('messages');
  log.scrollTop=120;log.fire('scroll');f.element('message-input').value='Follow up';f.element('message-input').fire('input');
  await f.element('chat-form').fire('submit');await settle();
  assert.equal(log.scrollTop,1000);
});

test('任务轮询不重建相同结果或进度，保留正在阅读的滚动位置',async t=>{
  const snapshot={id:'synthetic-task-1',locale:'en',state:'completed',cwd:'C:/synthetic-project',permission:'read-only',progress:[{text:'Finished'}],summary:'A long result'};
  const f=rendererFixture('task',{getState:async()=>({ok:true,snapshot:structuredClone(snapshot)})});t.after(f.close);await settle();
  const output=f.element('result-content'),progress=f.element('progress'),result=f.element('result-text');
  output.scrollTop=150;output.fire('scroll');const replacements=progress.replacements,writes=result.textWrites;
  f.intervals[0]();await settle();
  assert.equal(progress.replacements,replacements);assert.equal(result.textWrites,writes);assert.equal(output.scrollTop,150);
  snapshot.summary+='\nA later result detail';f.intervals[0]();await settle();
  assert.equal(output.scrollTop,150);assert.equal(result.textContent,snapshot.summary);
  snapshot.id='synthetic-task-2';snapshot.summary='A new task result';f.intervals[0]();await settle();
  assert.equal(output.scrollTop,1000);
});
