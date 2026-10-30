'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs');
const source=readFileSync(require('node:path').join(__dirname,'pet-status-strip.js'),'utf8');
function load(){const module={exports:{}};vm.runInNewContext(source,{module,structuredClone,console,Promise});return module.exports;}
const json=value=>JSON.parse(JSON.stringify(value));

test('监控只显示有限真实百分比，unknown不转0，显存只显示已用MiB',()=>{
 const {telemetryView}=load();assert.deepEqual(json(telemetryView(null,'en')),[{label:'CPU',value:'—',detail:''},{label:'MEM',value:'—',detail:''},{label:'GPU',value:'—',detail:''}]);
 const values=telemetryView({cpuPercent:0,memory:{percent:75,usedBytes:6*1024**3,totalBytes:8*1024**3},gpu:{percent:null,dedicatedUsedBytes:256*1024**2}},'en');
 assert.equal(values[0].value,'0%');assert.equal(values[1].value,'75%');assert.equal(values[1].detail,'6.0 / 8.0 GiB');assert.equal(values[2].value,'—');assert.equal(values[2].detail,'256 MiB dedicated');
 assert.equal(telemetryView({cpuPercent:NaN,memory:{percent:101},gpu:{percent:-1}},'en').every(value=>value.value==='—'),true);
});

test('额度使用实际已用百分比推剩余，缺少读数未知，窗口缺项不补0',()=>{
 const {quotaView}=load(),shared={balanceDetailView:()=>[{role:'quota',label:'5h',percent:25,resetText:'in 2h'},{role:'quota',label:'Week',percent:80,resetText:'in 1d'}]};
 const value=quotaView({ok:true,shape:'windows'},shared,'en');assert.equal(value.text,'Week · 20% left');assert.equal(value.remaining,20);assert.equal(value.details.length,2);
 assert.equal(quotaView(null,shared,'en').remaining,null);assert.equal(quotaView({ok:false},shared,'zh-CN').text,'额度未知');assert.equal(quotaView({ok:true,shape:'windows'},{balanceDetailView:()=>[]},'en').remaining,null);
});

test('脚下完整footer为物理地面预留实际高度，保留各屏原横向和顶部边界',()=>{
 const {constrainFooterSpace}=load(),space={size:320,areas:[{x:0,y:0,width:1200,height:800},{x:1200,y:-200,width:1200,height:900}],panels:[{x:0,y:0,width:1200,height:840},{x:1200,y:-200,width:1200,height:940}],bounds:[{minX:0,maxX:880,minY:0,maxY:620},{minX:1200,maxX:2080,minY:-200,maxY:520}]};
 const value=constrainFooterSpace(space,{height:180,top:188,footerHeight:52},[{x:0,y:0,width:1200,height:800},{x:1200,y:-200,width:1200,height:900}]);assert.equal(value.bounds[0].maxY,556);assert.equal(value.bounds[1].maxY,456);assert.equal(value.bounds[0].minX,0);assert.equal(value.bounds[1].minY,-200);assert.equal(space.bounds[0].maxY,620);assert.strictEqual(value.panels,space.panels);
 const expanded=constrainFooterSpace(space,{height:180,top:188,footerHeight:120},[{x:0,y:0,width:1200,height:800}]);assert.equal(expanded.bounds[0].maxY,488);assert.strictEqual(constrainFooterSpace(space,{height:180,top:188,footerHeight:0},[]),space);
});

test('原版甩抛积分在预留footer的新地面反弹，原舞台尺寸和比例不变',()=>{
 const {constrainFooterSpace}=load(),context={};vm.runInNewContext(readFileSync(require('node:path').join(__dirname,'../node_modules/dsh-pet/runtime/electron-helper/shared-core.js'),'utf8'),context);const S=context.PetShared;
 const area={x:0,y:0,width:1000,height:600},base=S.throwSpace({areas:[area],panels:[area],size:320,sideAllow:70}),space=constrainFooterSpace(base,{height:180,top:188,footerHeight:52,width:243,canvasWidth:320},[area]);
 const result=S.throwStepRegion({x:400,y:355,vx:50,vy:800},.1,space,S.DEFAULT_PHYSICS,0);assert.equal(result.y,356);assert.equal(result.bounced,true);assert.ok(result.vy<=0);assert.equal(space.size,320);assert.equal(base.bounds[0].maxY,420);assert.ok(result.y+188+52<=600);
});

class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.parentNode=null;this.style={};this.dataset={};this.attributes={};this.hidden=false;this.listeners=new Map();this.className='';this._text='';this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');},remove:name=>{this.className=this.className.split(' ').filter(value=>value!==name).join(' ');},contains:name=>this.className.split(' ').includes(name),toggle:(name,on)=>{if(on)this.classList.add(name);else this.classList.remove(name);}};}
 append(...nodes){for(const node of nodes)this.appendChild(node);}appendChild(node){node.parentNode=this;this.children.push(node);return node;}replaceChildren(...nodes){this.children=[];this.append(...nodes);}remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
 setAttribute(key,value){this.attributes[key]=String(value);}removeAttribute(key){delete this.attributes[key];}addEventListener(name,fn){this.listeners.set(name,fn);}click(){if(!this.disabled)this.listeners.get('click')?.({preventDefault(){},stopPropagation(){}});}set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
 find(name){return this.classList.contains(name)?this:this.children.map(node=>node.find(name)).find(Boolean);}
}
function fixture({actualBubble=false}={}){
 const {install}=load();let push,initialResolve,locale='en',unsubscribed=0;const events=new Map();
 class Sprite{constructor(){this.size=320;this.height=180;this.bottomPad=15;this.pet={balanceEnabled:true};this.el=new Element();this.stage=new Element();this.el.append(this.stage);this.bubble=new Element();this.bubble.dataset.slot='work';this.el.append(this.bubble);this.nativePosition=0;this.nativeRender=0;this.regionSyncs=0;this.inputRegionElements=new Set();}position(){this.nativePosition++;return'original-position';}renderBubble(){this.nativeRender++;}onBalanceTick(state){this.balanceState=state;this.renderBubble();}showBalanceNow(state){this.balanceState=state;this.renderBubble();}showBalanceNotice(state){this.balanceState=state;this.renderBubble();}inputBusy(){return false;}syncInputBusy(){this.regionSyncs++;}dispose(){this.disposed=true;}}
 const window={CodexLocale:{getLocale:()=>locale},PetShared:{balanceDetailView:state=>state.rows||[]},petTelemetry:{getState:()=>new Promise(resolve=>{initialResolve=resolve;}),onState:fn=>{push=fn;return()=>{unsubscribed++;};}},addEventListener:(name,fn)=>events.set(name,fn)};
 const document={createElement:tag=>new Element(tag)};
 if(actualBubble){window.__dshPetDebug={};const actual=vm.runInNewContext(readFileSync(require('node:path').join(__dirname,'../node_modules/dsh-pet/runtime/electron-helper/sprite.js'),'utf8')+'\nPetSprite.prototype',{window,document,navigator:{platform:'Win32'},S:{...window.PetShared,MEME_BUBBLE_CLASS:'has-img'}});Sprite.prototype.renderBubble=actual.renderBubble;Sprite.prototype.balanceClickable=actual.balanceClickable;}
 const installed=install({window,document,PetSprite:Sprite});
 return{Sprite,window,push:value=>push(value),initial:value=>initialResolve(value),setLocale:value=>{locale=value;},unsubscribed:()=>unsubscribed,close:()=>{events.get('beforeunload')?.();installed.dispose();}};
}

test('常驻额度与监控位于脚下，不改变stage/本体，余额状态更新沿用原事件，停监控保留额度',async()=>{
 const f=fixture(),p=new f.Sprite();assert.equal(p.position(),'original-position');const footer=p.el.find('pet-status-footer');assert.equal(p.nativePosition,1);assert.equal(footer.style.top,'188px');assert.equal(p.stage.parentNode,p.el);assert.ok(footer.textContent.includes('Usage unavailable'));
 p.onBalanceTick({ok:true,shape:'windows',rows:[{role:'quota',label:'5h',percent:40,resetText:'in 2h'}]});assert.equal(p.nativeRender,1);assert.ok(footer.textContent.includes('5h · 60% left'));assert.equal(p.bubble.dataset.slot,'work');
 f.push({enabled:true,metrics:{cpuPercent:25,memory:{percent:50},gpu:null}});assert.ok(footer.textContent.includes('CPU25%'));assert.ok(footer.textContent.includes('GPU—'));f.push({enabled:false,metrics:null});assert.equal(footer.find('pet-status-strip').hidden,true);assert.equal(footer.find('pet-status-quota').hidden,false);p.dispose();assert.equal(p.disposed,true);assert.equal(p.el.find('pet-status-footer'),undefined);f.close();
});

test('只有已知windows额度详情接收点击，收起和工作气泡互不抢占',()=>{
 const f=fixture(),p=new f.Sprite();p.position();assert.equal(p.inputBusy(),false);const quota=p.el.find('pet-status-quota');assert.equal(quota.classList.contains('is-interactive'),false);
 p.showBalanceNow({ok:true,shape:'windows',rows:[{role:'quota',label:'5h',percent:10,resetText:'in 1h'}]});assert.equal(p.inputBusy(),true);quota.find('pet-status-quota-toggle').click();assert.equal(quota.find('pet-status-quota-details').hidden,false);assert.equal(p.bubble.dataset.slot,'work');assert.ok(p.regionSyncs>0);quota.find('pet-status-quota-toggle').click();assert.equal(quota.find('pet-status-quota-details').hidden,true);
 p.showBalanceNotice({ok:false});assert.equal(p.inputBusy(),false);assert.equal(quota.classList.contains('is-interactive'),false);assert.equal(quota.find('pet-status-quota-details').hidden,true);f.close();
});

test('先到推送不会被迟到初始状态覆盖，卸载只退订一次',async()=>{
 const f=fixture(),p=new f.Sprite();p.position();f.push({enabled:true,metrics:{cpuPercent:44}});f.initial({enabled:false,metrics:null});await Promise.resolve();await Promise.resolve();assert.equal(p.el.find('pet-status-strip').hidden,false);assert.ok(p.el.find('pet-status-strip').textContent.includes('44%'));f.close();assert.equal(f.unsubscribed(),1);
});

test('常驻footer余额不占头顶槽，真实上游renderBubble仍显示普通工作状态',()=>{
 const f=fixture({actualBubble:true}),p=new f.Sprite();p.position();Object.assign(p,{bubbleOn:true,balanceView:[{role:'label',text:'5h usage'}],balanceState:{ok:true,shape:'windows',rows:[{role:'quota',label:'5h',percent:20}]},workOn:true,workText:'Working fixture',workState:'working',whisperOn:false});p.renderBubble();assert.equal(p.bubble.textContent,'Working fixture');assert.equal(p.bubbleOn,true);f.close();
});
