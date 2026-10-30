(() => {
 'use strict';
 function play({api,value}){
  const english=value.locale!=='zh-CN',reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  const root=document.createElement('main');root.className='custom-startup';root.dataset.theme=value.theme;root.setAttribute('aria-label',value.brand||'Startup video');
  const video=document.createElement('video');video.className='custom-startup-video';video.playsInline=true;video.loop=false;video.preload='auto';
  const controls=document.createElement('div');controls.className='custom-startup-controls';const sound=document.createElement('button'),skip=document.createElement('button');sound.type='button';skip.type='button';skip.textContent=(value.copy?.skip||(english?'Skip':'跳过'))+(value.reason==='preview'?'':' · Esc');controls.appendChild(sound);controls.appendChild(skip);root.appendChild(video);root.appendChild(controls);document.body.classList.add('custom-startup-active');document.body.appendChild(root);document.documentElement.lang=english?'en':'zh-CN';document.title='Codex Pet · '+(value.brand||'Startup video');
  const listeners=[],timers=new Set();let finished=false,starting=false,started=false,soundOn=true,frame=null,loadTimer=null,lastTime=0,lastProgress=performance.now(),endedAt=null,exitAt=null,targetPending=false,targetReady=!['codex','workbuddy'].includes(value.reason),nextProbe=0;
  function listen(element,name,fn){element.addEventListener(name,fn);listeners.push(()=>element.removeEventListener(name,fn));}
  function later(fn,delay){const id=setTimeout(()=>{timers.delete(id);if(!finished)fn();},delay);timers.add(id);return id;}
  function finish(){
   if(finished)return;finished=true;if(frame!==null)cancelAnimationFrame(frame);for(const timer of timers)clearTimeout(timer);timers.clear();listeners.forEach(remove=>remove());video.pause();video.muted=true;video.volume=0;video.removeAttribute('src');video.load();root.remove();void api.finish().catch(()=>{});
  }
  function gain(){const remaining=Number.isFinite(video.duration)?Math.max(0,video.duration-video.currentTime):1;video.muted=!soundOn;video.volume=soundOn ? .75*Math.min(1,remaining/.6) : 0;}
  function soundState(value){soundOn=value;sound.textContent=english?(soundOn?'Sound on':'Sound off'):(soundOn?'声音 开':'声音 关');sound.setAttribute('aria-pressed',String(soundOn));gain();}
  function probe(now){if(targetReady||targetPending||now<nextProbe||typeof api.target!=='function')return;targetPending=true;nextProbe=now+500;Promise.resolve().then(()=>api.target()).then(result=>{if(!finished)targetReady=result?.ready===true;}).catch(()=>{}).finally(()=>{targetPending=false;});}
  function draw(now){
   if(finished)return;const time=Number(video.currentTime)||0;if(Math.abs(time-lastTime)>.01){lastTime=time;lastProgress=now;}gain();
   if(endedAt===null&&now-lastProgress>=8000){finish();return;}
   if(endedAt!==null){probe(now);if(exitAt===null&&(targetReady||now-endedAt>=5000))exitAt=now;if(exitAt!==null){const progress=reduced?1:Math.min(1,(now-exitAt)/350);root.style.opacity=String(1-progress);if(progress>=1){finish();return;}}}
   frame=requestAnimationFrame(draw);
  }
  async function begin(){
   if(finished||starting||started||video.readyState<2)return;starting=true;
   if(!Number.isFinite(video.duration)||video.duration<.25||video.duration>60||video.videoWidth<16||video.videoHeight<16||video.videoWidth>4096||video.videoHeight>4096||video.videoWidth*video.videoHeight>8847360){finish();return;}
   try{try{await video.play();}catch{if(finished)return;soundState(false);await video.play();}if(finished)return;await api.ready();}catch{finish();return;}
   if(finished)return;started=true;lastProgress=performance.now();clearTimeout(loadTimer);timers.delete(loadTimer);root.style.opacity='1';frame=requestAnimationFrame(draw);
  }
  soundState(true);listen(sound,'click',()=>soundState(!soundOn));listen(skip,'click',finish);listen(document,'keydown',event=>{if(event.key==='Escape')finish();});listen(window,'beforeunload',finish);listen(video,'loadeddata',()=>{void begin();});listen(video,'error',finish);listen(video,'ended',()=>{if(!finished&&endedAt===null)endedAt=performance.now();});
  loadTimer=later(finish,8000);later(finish,Math.min(70000,Math.max(1000,Number(value.durationMs)||60000)+10000));video.src=value.video;video.load();void begin();return{finish};
 }
 window.CodexStartupCustom={play};
})();
