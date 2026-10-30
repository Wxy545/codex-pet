(() => {
 'use strict';
 const api=window.controlCenter;if(!api)return;
 const $=id=>document.getElementById(id),zh=(navigator.language||'en').startsWith('zh');
 let locale=zh?'zh-CN':'en',section='character',revision=0,busy=false,disposed=false,host=window.petPanels?.host||'codex',petState=null,characters=null;
 const sectionNames=['character','interaction','chatter','startup'],sectionStorage='codex-pet:settings-section';
 let pendingHostRefresh=null,unsubscribeHost=()=>{};
 const visibility=window.petVisibility;let visibilityRevision=0;
 const startupMedia=window.startupMedia;let mediaRevision=0,mediaState=null;
 function rememberedSection(){if(host==='harness')return'startup';try{const value=window.localStorage.getItem(sectionStorage);if(sectionNames.includes(value)&&!(host==='workbuddy'&&value==='chatter'))return value;}catch{/* 存储不可用时仍能打开设置。 */}return'character';}
 function rememberSection(value){try{window.localStorage.setItem(sectionStorage,value);}catch{/* 分区偏好不是配置保存的前置条件。 */}}
 const COPY={character:['角色','Characters'],interaction:['互动','Interactions'],chatter:['碎念','Chatter'],startup:['启动与联动','Startup & app'],loading:['正在读取…','Loading…'],pet:['桌宠','Pet'],size:['大小','Size'],roaming:['桌面漫游','Wander around the desktop'],confine:['限制在当前屏幕','Stay on the current screen'],'work-status':['工作状态联动','React to task status'],balance:['额度气泡与动作','Usage bubbles and reactions'],'pet-chatter':['显示自动碎念','Show automatic chatter'],corner:['初始角落','Starting corner'],'bottom-right':['右下角','Bottom right'],'bottom-left':['左下角','Bottom left'],'top-right':['右上角','Top right'],'top-left':['左上角','Top left'],'margin-x':['水平边距（px）','Horizontal offset (px)'],'margin-y':['垂直边距（px）','Vertical offset (px)'],physics:['拖拽与抛掷','Drag & toss'],'throw-power':['抛掷力度','Throw strength'],gravity:['重力','Gravity'],restitution:['反弹强度','Bounce'],friction:['地面摩擦','Ground friction'],ceiling:['碰到屏幕顶部反弹','Bounce off the top edge'],collision:['桌宠相互碰撞','Pets can collide'],save:['保存更改','Save changes'],reload:['重载配置','Reload settings'],'automatic-chatter':['自动碎念','Automatic chatter'],interval:['间隔（分钟）','Interval (minutes)'],'startup-mode':['启动方式','On launch'],'pet-only':['仅桌宠','Pet only'],'scene-only':['仅启动演出','Startup scene only'],both:['桌宠与启动演出','Pet and startup scene'],preview:['预览演出','Preview scene'],companion:['联动应用','Companion app'],retry:['重试','Try again'],use:['选用','Select'],selected:['已选用','Selected'],missing:['素材不可用','Assets unavailable'],saved:['已保存。','Saved.'],saving:['正在保存…','Saving…'],reloading:['已保存，桌宠正在重载。','Saved. The pet is reloading.'],switching:['正在切换联动应用…','Switching companion app…'],failed:['操作未完成，请重试。','That did not finish. Try again.'],unavailable:['设置暂时无法读取。','Settings are unavailable.'],label:['设置分区','Settings sections']};
 Object.assign(COPY,{harness:['DeepSeek Harness（原生插件）','DeepSeek Harness (native plugin)'],'harness-pending':['正在接入 Harness…','Connecting to Harness…'],'harness-ready':['已接入 Harness 原生桌宠。','Connected to the native Harness pet.']});
 const text=key=>(COPY[key]||[key,key])[locale==='zh-CN'?0:1];
 Object.assign(COPY,{visible:['显示桌宠','Show pet'],'auto-hide':['全屏时自动隐藏','Hide during fullscreen apps'],'auto-hidden':['自动隐藏中','Automatically hidden'],'manually-hidden':['已手动隐藏','Hidden manually'],'visibility-unavailable':['显示状态暂时无法读取。','Pet visibility is unavailable.']});
 Object.assign(COPY,{appearance:['主题与视频','Theme & video'],theme:['主题','Theme'],video:['视频','Video'],'theme-auto':['跟随联动应用','Follow companion app'],builtin:['内置演出','Built-in scene'],'media-limits':['MP4 / WebM · 最长60秒 · 最高4K · 256 MiB','MP4 / WebM · Up to 60 seconds · 4K · 256 MiB'],'import-video':['导入视频','Import video'],'remove-video':['移除','Remove'],'media-unavailable':['视频库暂时无法读取。','The video library is unavailable.'],'media-pending':['正在验证并导入视频…','Checking and importing the video…']});
 function renderStartupMedia(value){
  if(!value||!Array.isArray(value.items))return;mediaState=value;const selected=$('startup-video');selected.replaceChildren();const builtin=document.createElement('option');builtin.value='builtin';builtin.textContent=text('builtin');selected.appendChild(builtin);
  for(const item of value.items){const option=document.createElement('option');option.value=item.id;option.textContent=item.name+' · '+(item.durationMs/1000).toFixed(1)+'s · '+item.width+'×'+item.height+(item.available?'':' · '+text('missing'));selected.appendChild(option);}selected.value=value.selectedVideo;$('startup-theme').value=value.theme;
  for(const theme of ['chatgpt','deepseek','workbuddy']){const option=$('startup-theme').querySelector('option[value="'+theme+'"]');if(option)option.textContent=theme==='chatgpt'?(locale==='zh-CN'?'ChatGPT · 白龙娘':'ChatGPT · White Dragon Girl'):theme==='workbuddy'?(locale==='zh-CN'?'WorkBuddy · 卷卷':'WorkBuddy · Curly'):'DeepSeek Harness';}
  const enabled=!value.error&&host!=='harness';for(const id of ['startup-theme','startup-video','import-startup-video','remove-startup-video']){const control=$(id);const disabled=!enabled||id==='import-startup-video'&&value.items.length>=value.limits.maxItems||id==='remove-startup-video'&&value.selectedVideo==='builtin';if(busy)control.dataset.wasDisabled=String(disabled);else control.disabled=disabled;}$('startup-media-status').textContent=value.error?text('media-unavailable'):'';
 }
 async function refreshStartupMedia(token){const current=mediaRevision;try{if(!startupMedia)throw new Error();const result=await startupMedia.getState();if(disposed||token!==revision||section!=='startup'||current!==mediaRevision)return;if(!result?.ok)throw new Error();renderStartupMedia(result.state);}catch{if(!disposed&&token===revision&&section==='startup'&&host!=='harness')$('startup-media-status').textContent=text('media-unavailable');}}
 const unsubscribeMedia=startupMedia?.onChanged?.(value=>{mediaRevision++;if(section==='startup'&&host!=='harness')renderStartupMedia(value);});
 function renderVisibility(value){if(!value||typeof value.hidden!=='boolean'||typeof value.autoHide!=='boolean')return;$('pet-visible').checked=!value.hidden;$('auto-hide').checked=value.autoHide;if(!busy){$('pet-visible').disabled=false;$('auto-hide').disabled=false;}$('visibility-state').textContent=value.manualHidden?text('manually-hidden'):value.automaticHidden?text('auto-hidden'):'';}
 async function refreshVisibility(token){const current=visibilityRevision;try{if(!visibility)throw new Error();const result=await visibility.getState();if(disposed||token!==revision||section!=='interaction'||current!==visibilityRevision)return;if(!result?.ok)throw new Error();renderVisibility(result.state);}catch{if(!disposed&&token===revision&&section==='interaction')$('visibility-state').textContent=text('visibility-unavailable');}}
 const unsubscribeVisibility=visibility?.onChanged?.(value=>{visibilityRevision++;if(section==='interaction')renderVisibility(value);});
 function localize(){document.documentElement.lang=locale;document.title=locale==='zh-CN'?'Codex Pet · 设置':'Codex Pet · Settings';for(const node of document.querySelectorAll('[data-copy]'))node.textContent=text(node.dataset.copy);document.querySelector('[role=tablist]').setAttribute('aria-label',text('label'));$('size-range').setAttribute('aria-label',text('size'));}
 function message(value='',error=false,retry=false){$('feedback').textContent=value;$('feedback').dataset.error=String(error);$('retry').hidden=!retry;}
 function capabilities(){const allowed=host==='codex',native=host==='harness';$('tab-chatter').hidden=!allowed;$('tab-character').hidden=native;$('tab-interaction').hidden=native;$('startup-modes').hidden=native;$('startup-appearance').hidden=native;for(const element of document.querySelectorAll('.codex-only'))element.hidden=!allowed;}
 function hostButtons(){for(const button of document.querySelectorAll('[data-host]'))button.setAttribute('aria-pressed',String(button.dataset.host===host));}
 function hostChanged(value){
  if(disposed||!['codex','workbuddy','harness'].includes(value?.host)||value.host===host)return;
  // 宿主事件比在途表单读取更新；旧响应不再有权恢复原宿主的入口和配置。
  host=value.host;revision++;stopPreviews();capabilities();hostButtons();
  const next=host==='harness'||host==='workbuddy'&&section==='chatter'?'startup':section;
  if(next!==section){section=next;rememberSection(section);for(const name of sectionNames){const active=name===section;$('tab-'+name).setAttribute('aria-selected',String(active));$('tab-'+name).tabIndex=active?0:-1;$('section-'+name).hidden=!active;}}
  if(busy){pendingHostRefresh=next;$('loading').hidden=true;}else void load(next);
 }
 function lock(value){busy=value;for(const control of document.querySelectorAll('main button,main input,main select')){if(value){control.dataset.wasDisabled=String(control.disabled);control.disabled=true;}else if(Object.hasOwn(control.dataset,'wasDisabled')){control.disabled=control.dataset.wasDisabled==='true';delete control.dataset.wasDisabled;}}}
 function physicsValue(){return{gravity:Number($('gravity').value),restitution:Number($('restitution').value),groundFriction:Number($('ground-friction').value),ceilingBounce:$('ceiling').checked,throwPower:Number($('throw-power').value),petCollision:$('collision').checked};}
 function selectedPet(){return petState?.pets.find(p=>p.id===$('pet').value);}
 function fillPet(){const p=selectedPet();if(!p)return;$('pet-size').value=p.size;$('size-range').value=p.size;$('roaming').checked=!p.fixedEnabled;$('work-status').checked=p.workStatusEnabled;$('balance').checked=p.balanceEnabled;$('pet-chatter').checked=p.whisperEnabled;$('corner').value=p.position.corner;$('margin-x').value=p.position.marginX;$('margin-y').value=p.position.marginY;}
 function stopPreviews(){for(const video of document.querySelectorAll('.character-preview video'))video.pause();}
 function renderCharacters(state){
  characters=state;const container=$('character-cards');stopPreviews();container.replaceChildren();
  for(const item of state.characters){
   const card=document.createElement('article');card.dataset.character=item.id;card.className='character-card'+(item.id===state.selection?.character?' selected':'');const preview=document.createElement('div');preview.className='character-preview';
   if(item.preview?.type==='video'){
    const video=document.createElement('video');video.src=item.preview.url;video.muted=true;video.loop=true;video.playsInline=true;video.preload='metadata';video.setAttribute('aria-label',item.name);preview.appendChild(video);
    if(item.id===state.selection?.character&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)void video.play().catch(()=>{});
   }else{const initial=document.createElement('span');initial.className='character-initial';initial.textContent=item.name;preview.appendChild(initial);}
   const info=document.createElement('div');info.className='character-info';const name=document.createElement('span');name.className='character-name';name.textContent=item.name;const button=document.createElement('button');button.type='button';button.disabled=!item.available||item.id===state.selection?.character;button.textContent=text(!item.available?'missing':item.id===state.selection?.character?'selected':'use');button.addEventListener('click',()=>void action(()=>api.selectCharacter(item.id),result=>{if(result.state)renderCharacters(result.state);}));info.append(name,button);card.append(preview,info);container.appendChild(card);
  }
 }
 function renderInteraction(state){
  petState=state;const selector=$('pet');selector.replaceChildren();for(const pet of state.pets){const option=document.createElement('option');option.value=pet.id;option.textContent=pet.id==='main'?(characters?.characters.find(item=>item.id===characters.selection?.character)?.name||pet.name):pet.name;selector.appendChild(option);}$('pet-field').hidden=state.pets.length<2;$('confine').checked=state.confineToScreen;fillPet();
  const p=state.physics;for(const[id,key]of [['gravity','gravity'],['restitution','restitution'],['ground-friction','groundFriction'],['throw-power','throwPower']])$(id).value=p[key];$('ceiling').checked=p.ceilingBounce;$('collision').checked=p.petCollision;
 }
 function renderChatter(value){$('automatic-chatter').checked=value.automaticWhispers;$('chatter-interval').value=value.whisperIntervalSec/60;}
 function renderStartup(state){const input=document.querySelector(`input[name="startup-mode"][value="${['pet','startup','both'].includes(state.startup.mode)?state.startup.mode:'both'}"]`);input.checked=true;for(const button of document.querySelectorAll('[data-host]'))button.setAttribute('aria-pressed',String(button.dataset.host===state.host.host));}
 async function load(next){
  if(host==='harness')next='startup';
  if(disposed||busy||!sectionNames.includes(next)||host==='workbuddy'&&next==='chatter')return;section=next;rememberSection(next);const token=++revision;stopPreviews();message();$('loading').hidden=false;
  for(const button of document.querySelectorAll('[data-section]')){const active=button.dataset.section===section;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
  for(const panel of document.querySelectorAll('[role=tabpanel]'))panel.hidden=true;
  try{const result=await api.get(section);if(disposed||token!==revision)return;if(!result?.ok)throw new Error(result?.message||text('unavailable'));const state=result.state;locale=state.locale==='zh-CN'?'zh-CN':'en';host=state.host.host;if(host==='harness'){section='startup';rememberSection(section);for(const button of document.querySelectorAll('[data-section]')){const active=button.dataset.section===section;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}}localize();capabilities();if(section==='character')renderCharacters(state);else if(section==='interaction'){renderInteraction(state);void refreshVisibility(token);}else if(section==='chatter')renderChatter(state.chatter);else renderStartup(state);$('section-'+section).hidden=false;}
  catch(error){if(!disposed&&token===revision)message(error.message||text('unavailable'),true,true);}
  finally{if(token===revision)$('loading').hidden=true;}
  if(!disposed&&token===revision&&section==='startup'&&host!=='harness'&&!$('section-startup').hidden)void refreshStartupMedia(token);
 }
 async function action(fn,apply,pending='saving'){if(busy||disposed)return;const token=revision;lock(true);message(text(pending));try{const result=await fn();if(disposed||token!==revision)return;if(!result?.ok)throw new Error(result?.message||text('failed'));apply?.(result);message(result.cancelled?'':text(result.reloading?'reloading':result.host?.restarting?'switching':result.host?.external?'harness-ready':'saved'));}catch(error){if(!disposed&&token===revision)message(error.message||text('failed'),true);}finally{if(!disposed){lock(false);if(pendingHostRefresh!==null){const next=pendingHostRefresh;pendingHostRefresh=null;void load(next);}}}}
 for(const button of document.querySelectorAll('[data-section]'))button.addEventListener('click',()=>void load(button.dataset.section));
 document.querySelector('[role=tablist]').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=[...document.querySelectorAll('[data-section]')].filter(node=>!node.hidden),index=tabs.indexOf(document.activeElement);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].focus();tabs[next].click();});
 $('retry').addEventListener('click',()=>void load(section));$('pet').addEventListener('change',fillPet);
 $('pet-visible').addEventListener('change',()=>{if(visibility)void action(()=>visibility.setManualHidden(!$('pet-visible').checked),result=>renderVisibility(result.state));});
 $('auto-hide').addEventListener('change',()=>{if(visibility)void action(()=>visibility.setAutoHide($('auto-hide').checked),result=>renderVisibility(result.state));});
 $('size-range').addEventListener('input',()=>{$('pet-size').value=$('size-range').value;});$('pet-size').addEventListener('input',()=>{$('size-range').value=$('pet-size').value;});
 $('interaction-form').addEventListener('submit',event=>{event.preventDefault();if(!$('interaction-form').reportValidity()||!selectedPet())return;const value={petId:selectedPet().id,size:Number($('pet-size').value),fixedEnabled:!$('roaming').checked,workStatusEnabled:$('work-status').checked,confineToScreen:$('confine').checked,position:{corner:$('corner').value,marginX:Number($('margin-x').value),marginY:Number($('margin-y').value)},physics:physicsValue()};if(host==='codex'){value.balanceEnabled=$('balance').checked;value.whisperEnabled=$('pet-chatter').checked;}void action(()=>api.saveInteraction(value));});
 $('reload').addEventListener('click',()=>void action(()=>api.reload()));
 $('chatter-form').addEventListener('submit',event=>{event.preventDefault();if(!$('chatter-form').reportValidity())return;void action(()=>api.saveChatter({automaticWhispers:$('automatic-chatter').checked,whisperIntervalSec:Math.round(Number($('chatter-interval').value)*60)}),result=>renderChatter(result.chatter));});
 $('startup-form').addEventListener('submit',event=>{event.preventDefault();const mode=document.querySelector('input[name="startup-mode"]:checked')?.value;if(mode)void action(()=>api.setStartup(mode));});
 $('preview').addEventListener('click',()=>void action(()=>startupMedia?startupMedia.preview():api.previewStartup()));
 $('startup-theme').addEventListener('change',()=>{if(startupMedia)void action(()=>startupMedia.preferences({theme:$('startup-theme').value}),result=>renderStartupMedia(result.state));});
 $('startup-video').addEventListener('change',()=>{if(startupMedia)void action(()=>startupMedia.preferences({selectedVideo:$('startup-video').value}),result=>renderStartupMedia(result.state));});
 $('import-startup-video').addEventListener('click',()=>{if(startupMedia)void action(()=>startupMedia.importVideo(),result=>renderStartupMedia(result.state),'media-pending');});
 $('remove-startup-video').addEventListener('click',()=>{if(startupMedia&&mediaState?.selectedVideo!=='builtin')void action(()=>startupMedia.remove(mediaState.selectedVideo),result=>renderStartupMedia(result.state));});
 for(const button of document.querySelectorAll('[data-host]'))button.addEventListener('click',()=>{if(button.dataset.host===host)return;void action(()=>api.selectHost(button.dataset.host),result=>{if(result.host)hostChanged(result.host);},button.dataset.host==='harness'?'harness-pending':'saving');});
 try{unsubscribeHost=window.petPanels?.onChanged?.(hostChanged)||(()=>{});}catch{/* 旧运行时没有订阅时仍保留原分区读取。 */}
 window.addEventListener('beforeunload',()=>{disposed=true;revision++;pendingHostRefresh=null;unsubscribeHost();unsubscribeVisibility?.();unsubscribeMedia?.();stopPreviews();},{once:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPreviews();else if(section==='character'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)for(const video of document.querySelectorAll('.character-card.selected video'))void video.play().catch(()=>{});});
 localize();capabilities();void load(rememberedSection());
})();

// 监控只控制独立数字条，不触发配置重载，也不改变任务或额度。
(() => {
 const api=window.petTelemetry,input=document.getElementById('system-monitor'),label=document.querySelector('[data-system-monitor-label]');
 if(!api||!input)return;let pending=false,closed=false,revision=0;
 const localize=()=>{label.textContent=/^zh/i.test(document.documentElement.lang)?'系统监控（CPU / 内存 / GPU）':'System monitor (CPU / memory / GPU)';};
 const apply=value=>{if(!closed&&!pending&&typeof value?.enabled==='boolean'){input.checked=value.enabled;input.disabled=false;}};
 const notify=()=>{const feedback=document.getElementById('feedback');if(feedback){feedback.textContent=/^zh/i.test(document.documentElement.lang)?'监控设置未能保存，请重试。':'Monitor settings could not be saved. Try again.';feedback.dataset.error='true';}};
 let off=()=>{};try{off=api.onState(value=>{revision++;apply(value);})||off;const initial=revision;Promise.resolve(api.getState()).then(value=>{if(initial===revision&&value?.ok)apply(value);},()=>{});}catch{}
 input.addEventListener('change',async()=>{if(pending)return;pending=true;input.disabled=true;const previous=!input.checked;try{const value=await api.setEnabled(input.checked);pending=false;if(!value?.ok){input.checked=previous;notify();}else apply(value);}catch{input.checked=previous;notify();}finally{pending=false;if(!closed)input.disabled=false;}});
 const observer=new MutationObserver(localize);observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});localize();window.addEventListener('beforeunload',()=>{closed=true;observer.disconnect();off();},{once:true});
})();
