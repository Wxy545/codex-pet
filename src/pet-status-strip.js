(function(){
 'use strict';
 const validPercent=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
 const validBytes=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 const textPercent=value=>validPercent(value)?Math.round(value)+'%':'—';
 function telemetryView(metrics,locale){
  const en=locale!=='zh-CN',memory=metrics?.memory,gpu=metrics?.gpu;
  return[
   {label:'CPU',value:textPercent(metrics?.cpuPercent),detail:''},
   {label:'MEM',value:textPercent(memory?.percent),detail:validBytes(memory?.usedBytes)&&validBytes(memory?.totalBytes)&&memory.totalBytes>0?`${(memory.usedBytes/1024**3).toFixed(1)} / ${(memory.totalBytes/1024**3).toFixed(1)} GiB`:''},
   {label:'GPU',value:textPercent(gpu?.percent),detail:validBytes(gpu?.dedicatedUsedBytes)?`${Math.round(gpu.dedicatedUsedBytes/1024**2)} MiB ${en?'dedicated':'专用显存已用'}`:''},
  ];
 }
 function quotaView(state,shared,locale){
  const en=locale!=='zh-CN',unknown={text:en?'Usage unavailable':'额度未知',remaining:null,details:[]};
  if(!state||state.ok!==true)return unknown;
  try{
   if(state.shape==='windows'){
    const details=shared.balanceDetailView(state).filter(row=>row.role==='quota'&&typeof row.label==='string'&&validPercent(row.percent)).map(row=>({label:row.label,used:row.percent,remaining:100-row.percent,reset:typeof row.resetText==='string'?row.resetText:''}));
    if(!details.length)return unknown;
    const urgent=details.reduce((best,row)=>row.used>best.used?row:best),remaining=urgent.remaining;
    return{text:en?`${urgent.label} · ${Math.round(remaining)}% left`:`${urgent.label} · 剩余 ${Math.round(remaining)}%`,remaining,details};
   }
   if(!['money','points'].includes(state.shape))return unknown;
   const rows=shared.balanceBubbleView(state),text=rows.filter(row=>typeof row.text==='string').map(row=>row.text).join('');
   const used=shared.balancePercent(state);return{text:text||unknown.text,remaining:validPercent(used)?100-used:null,details:[]};
  }catch{return unknown;}
 }
 function constrainFooterSpace(space,layout,areas){
  if(!layout.footerHeight)return space;
  return{...space,bounds:space.bounds.map((bounds,index)=>{
   const area=areas[index]||space.areas[index];if(!area)return bounds;
   const maxY=Math.max(bounds.minY,Math.min(bounds.maxY,area.y+area.height-Math.max(layout.height,layout.top+layout.footerHeight)-4));
   const halfFooter=(layout.width||0)/2,halfCanvas=(layout.canvasWidth||0)/2;
   const minX=layout.width?Math.max(bounds.minX,area.x+halfFooter-halfCanvas):bounds.minX,maxX=layout.width?Math.min(bounds.maxX,area.x+area.width-halfFooter-halfCanvas):bounds.maxX;
   return{...bounds,minX,maxX:Math.max(minX,maxX),maxY};
  })};
 }
 function install({window,document,PetSprite}){
  if(!PetSprite?.prototype)return{dispose(){}};
  const proto=PetSprite.prototype,controllers=new Map();let closed=false,revision=0,telemetry={enabled:true,metrics:null},unsubscribe=()=>{};
  const originals=new Map(),sending=new Set(),locale=()=>window.CodexLocale?.getLocale?.()==='zh-CN'?'zh-CN':'en';
  const areas=()=>typeof WORK_AREAS!=='undefined'&&Array.isArray(WORK_AREAS)?WORK_AREAS:[];
  function layout(control){return{height:control.sprite.height,canvasWidth:control.sprite.size,top:control.sprite.height+8,footerHeight:control.footerHeight||0,width:control.footerWidth||0};}
  function constrainPosition(sprite,control,x,y){
   const region=areas();if(!control?.footerHeight||!region.length||!Number.isFinite(x)||!Number.isFinite(y))return{x,y};
   const area=window.PetShared?.resolveRect?.(region,x+sprite.size/2,y+sprite.height/2);if(!area)return{x,y};
   const info=layout(control),maxY=Math.max(area.y,area.y+area.height-info.top-info.footerHeight-4),minX=area.x+info.width/2-sprite.size/2,maxX=area.x+area.width-info.width/2-sprite.size/2;
   return{x:Math.max(minX,Math.min(Math.max(minX,maxX),x)),y:Math.min(y,maxY)};
  }
  function measure(control){
   const height=control.root.hidden?0:Number(control.root.offsetHeight)||0,width=control.root.hidden?0:Number(control.root.offsetWidth)||0;
   if(height===control.footerHeight&&width===control.footerWidth)return;control.footerHeight=height;control.footerWidth=width;control.space=null;
   const sprite=control.sprite;if(!sending.has(sprite)&&sprite.pos&&typeof sprite.sendBounds==='function'){
    const point=constrainPosition(sprite,control,sprite.pos.x,sprite.pos.y);if(point.x!==sprite.pos.x||point.y!==sprite.pos.y)sprite.sendBounds(point.x,point.y);
   }
  }
  const element=(tag,name)=>{const node=document.createElement(tag);node.className=name;return node;};
  function sync(sprite){if(sprite.inputRegionElements&&typeof sprite.syncInputBusy==='function')sprite.syncInputBusy();}
  function ensure(sprite){
   if(closed||!sprite.el||!Number.isFinite(sprite.height)||!Number.isFinite(sprite.size))return null;
   if(controllers.has(sprite))return controllers.get(sprite);
   const root=element('div','pet-status-footer'),quota=element('div','pet-status-quota'),button=element('button','pet-status-quota-toggle'),summary=element('span','pet-status-quota-label'),bar=element('span','pet-status-quota-track'),fill=element('span','pet-status-quota-fill'),details=element('div','pet-status-quota-details'),strip=element('div','pet-status-strip');
   button.type='button';bar.setAttribute('role','progressbar');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.appendChild(fill);button.append(summary,bar);details.hidden=true;quota.append(button,details);root.append(quota,strip);sprite.el.appendChild(root);
   const control={sprite,root,quota,button,summary,bar,fill,details,strip,expanded:false,balance:sprite.balanceState||null,view:null};controllers.set(sprite,control);
   button.addEventListener('click',event=>{if(!control.view?.details.length)return;event.preventDefault();event.stopPropagation();control.expanded=!control.expanded;render(control);});
   render(control);return control;
  }
  function render(control){
   const {sprite,root,quota,button,summary,bar,fill,details,strip}=control,language=locale();
   // bottomPad=(360-FEET_Y)/360*height，因此height就是舞台330基准的脚底锚点。
   const info=layout(control);root.style.left=sprite.size/2+'px';root.style.top=info.top+'px';root.style.width=Math.min(260,Math.max(180,sprite.size*.42))+'px';
   const enabled=sprite.pet?.balanceEnabled===true,view=quotaView(control.balance,window.PetShared||{},language);control.view=view;
   const signature=JSON.stringify([enabled,language,view,telemetry,control.expanded]);if(control.signature===signature){measure(control);return;}control.signature=signature;
   quota.hidden=!enabled;sprite.el.classList.toggle('has-status-quota',enabled);summary.textContent=view.text;button.disabled=!view.details.length;button.setAttribute('aria-expanded',String(control.expanded&&view.details.length>0));
   quota.classList.toggle('is-interactive',enabled&&view.details.length>0);bar.hidden=view.remaining===null;
   if(view.remaining===null){bar.removeAttribute('aria-valuenow');fill.style.width='';}else{bar.setAttribute('aria-label',language==='zh-CN'?'剩余额度':'Usage remaining');bar.setAttribute('aria-valuenow',String(view.remaining));fill.style.width=view.remaining+'%';}
   if(!view.details.length)control.expanded=false;details.hidden=!control.expanded;details.replaceChildren();
   if(control.expanded)for(const row of view.details){const line=element('div','pet-status-quota-row'),label=element('span','pet-status-quota-window'),value=element('span','pet-status-quota-value'),reset=element('span','pet-status-quota-reset');label.textContent=row.label;value.textContent=language==='zh-CN'?`剩余 ${Math.round(row.remaining)}%`:`${Math.round(row.remaining)}% left`;reset.textContent=row.reset;line.append(label,value,reset);details.appendChild(line);}
   strip.hidden=telemetry.enabled===false;strip.replaceChildren();
   for(const item of telemetryView(telemetry.metrics,language)){const cell=element('span','pet-status-metric'),label=element('span','pet-status-metric-label'),value=element('span','pet-status-metric-value');label.textContent=item.label;value.textContent=item.value;cell.setAttribute('title',item.detail);cell.append(label,value);strip.appendChild(cell);}
   root.hidden=quota.hidden&&strip.hidden;measure(control);sync(sprite);
  }
  function update(value){if(closed||!value||typeof value!=='object')return;revision++;telemetry={enabled:value.enabled!==false,metrics:value.metrics||null};for(const control of controllers.values())render(control);}
  function wrap(name,fn){if(typeof proto[name]!=='function')return;const original=proto[name];originals.set(name,original);proto[name]=fn(original);}
  wrap('sendBounds',original=>function(x,y){
   sending.add(this);try{const control=ensure(this),point=constrainPosition(this,control,x,y);return original.call(this,point.x,point.y);}finally{sending.delete(this);}
  });
  wrap('throwSpaceOf',original=>function(){
   const base=original.apply(this,arguments),control=ensure(this);if(!control?.footerHeight)return base;const region=areas();
   if(control.space&&control.spaceBase===base&&control.spaceAreas===region)return control.space;
   control.spaceBase=base;control.spaceAreas=region;control.space=constrainFooterSpace(base,layout(control),region);return control.space;
  });
  wrap('position',original=>function(){const result=original.apply(this,arguments);const control=ensure(this);if(control)render(control);return result;});
  wrap('renderBubble',original=>function(){
   const balanceOn=this.bubbleOn;let result;
   // 余额已有脚下常驻入口，不再占用头顶槽；原timer和档位动画状态仍完整保留。
   if(this.pet?.balanceEnabled===true)this.bubbleOn=false;
   try{result=original.apply(this,arguments);}finally{this.bubbleOn=balanceOn;}
   const control=ensure(this);if(control)render(control);return result;
  });
  for(const name of ['onBalanceTick','showBalanceNow','showBalanceNotice'])wrap(name,original=>function(state){const control=ensure(this);if(control)control.balance=state||null;const result=original.apply(this,arguments);if(control)render(control);return result;});
  wrap('inputBusy',original=>function(){const control=controllers.get(this);return original.apply(this,arguments)||Boolean(control&&!control.quota.hidden&&control.view?.details.length);});
  wrap('dispose',original=>function(){const control=controllers.get(this);if(control){control.root.remove();this.el.classList.remove('has-status-quota');controllers.delete(this);}return original.apply(this,arguments);});
  const bridge=window.petTelemetry;
  if(bridge){try{unsubscribe=bridge.onState(update)||(()=>{});}catch{}const initial=revision;try{Promise.resolve(bridge.getState()).then(value=>{if(revision===initial)update(value);},()=>{});}catch{}}
  function dispose(){if(closed)return;closed=true;try{unsubscribe();}catch{}for(const control of controllers.values()){control.root.remove();control.sprite.el.classList.remove('has-status-quota');}controllers.clear();for(const[name,original]of originals)proto[name]=original;}
  window.addEventListener('beforeunload',dispose,{once:true});return{dispose};
 }
 if(typeof module==='object'&&module.exports){module.exports={telemetryView,quotaView,constrainFooterSpace,install};return;}
 if(typeof window==='object'&&typeof document==='object'&&typeof PetSprite==='function')install({window,document,PetSprite});
})();
