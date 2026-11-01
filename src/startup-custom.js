(() => {
 'use strict';
 function play({api,value}){
  const english=value.locale!=='zh-CN',reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  const clips=Array.isArray(value.clips)&&value.clips.length?value.clips:[{url:value.video,startMs:0,endMs:value.durationMs,durationMs:value.durationMs}];
  const valid=clips.length<=8&&clips.every(c=>typeof c.url==='string'&&c.url.startsWith('file:')&&Number.isFinite(c.startMs)&&c.startMs>=0&&Number.isFinite(c.endMs)&&c.endMs-c.startMs>=250&&c.endMs<=60000)&&clips.reduce((sum,c)=>sum+c.endMs-c.startMs,0)<=60000;
  const root=document.createElement('main');root.className='custom-startup';root.dataset.theme=value.theme;root.setAttribute('aria-label',value.brand||'Startup video');
  const video=document.createElement('video');video.className='custom-startup-video';video.playsInline=true;video.loop=false;video.preload='auto';
  const controls=document.createElement('div');controls.className='custom-startup-controls';const sound=document.createElement('button'),skip=document.createElement('button');sound.type='button';skip.type='button';skip.textContent=(value.copy?.skip||(english?'Skip':'跳过'))+(value.reason==='preview'?'':' · Esc');controls.appendChild(sound);controls.appendChild(skip);root.appendChild(video);root.appendChild(controls);document.body.classList.add('custom-startup-active');document.body.appendChild(root);document.documentElement.lang=english?'en':'zh-CN';document.title='Codex Pet · '+(value.brand||'Startup video');
  const listeners=[],timers=new Set();let finished=false,starting=false,started=false,clipStarted=false,seeking=false,index=0,generation=0,soundOn=true,frame=null,loadTimer=null,lastTime=0,lastProgress=performance.now(),endedAt=null,exitAt=null,targetPending=false,targetReady=!['codex','workbuddy'].includes(value.reason),nextProbe=0;
  const clip=()=>clips[index];
  function listen(element,name,fn){element.addEventListener(name,fn);listeners.push(()=>element.removeEventListener(name,fn));}
  function later(fn,delay){const id=setTimeout(()=>{timers.delete(id);if(!finished)fn();},delay);timers.add(id);return id;}
  function clearLoad(){if(loadTimer!==null){clearTimeout(loadTimer);timers.delete(loadTimer);loadTimer=null;}}
  function silence(){video.pause();video.muted=true;video.volume=0;}
  function finish(){
   if(finished)return;finished=true;generation++;if(frame!==null)cancelAnimationFrame(frame);for(const timer of timers)clearTimeout(timer);timers.clear();listeners.forEach(remove=>remove());silence();video.removeAttribute('src');video.load();root.remove();void api.finish().catch(()=>{});
  }
  function gain(){const remaining=clip()?Math.max(0,clip().endMs/1000-video.currentTime):0;video.muted=!soundOn||!clipStarted||endedAt!==null;video.volume=soundOn&&clipStarted&&endedAt===null?.75*Math.min(1,remaining/(index===clips.length-1?.6:.15)):0;}
  function soundState(on){soundOn=on;sound.textContent=english?(soundOn?'Sound on':'Sound off'):(soundOn?'声音 开':'声音 关');sound.setAttribute('aria-pressed',String(soundOn));gain();}
  function probe(now){if(targetReady||targetPending||now<nextProbe||typeof api.target!=='function')return;targetPending=true;nextProbe=now+500;Promise.resolve().then(()=>api.target()).then(result=>{if(!finished)targetReady=result?.ready===true;}).catch(()=>{}).finally(()=>{targetPending=false;});}
  // 每次接片先静音和重载，片外画面不显示；seeked到达裁剪起点才允许解码页交接。
  function loadClip(){generation++;starting=false;clipStarted=false;seeking=false;lastTime=clip().startMs/1000;lastProgress=performance.now();silence();video.style.visibility='hidden';clearLoad();loadTimer=later(finish,8000);video.src=clip().url;video.load();void begin();}
  function endClip(){if(finished||!clipStarted||endedAt!==null)return;clipStarted=false;silence();if(index+1<clips.length){index++;loadClip();}else endedAt=performance.now();}
  function draw(now){
   if(finished)return;frame=null;const time=Number(video.currentTime)||0;if(Math.abs(time-lastTime)>.01){lastTime=time;lastProgress=now;}
   if(clipStarted&&time>=clip().endMs/1000-.015)endClip();gain();
   if(endedAt===null&&now-lastProgress>=8000){finish();return;}
   if(endedAt!==null){probe(now);if(exitAt===null&&(targetReady||now-endedAt>=5000))exitAt=now;if(exitAt!==null){const progress=reduced?1:Math.min(1,(now-exitAt)/350);root.style.opacity=String(1-progress);if(progress>=1){finish();return;}}}
   frame=requestAnimationFrame(draw);
  }
  async function begin(){
   if(finished||starting||clipStarted||video.readyState<2||seeking)return;
   const item=clip(),token=generation;
   if(!Number.isFinite(video.duration)||video.duration<.25||video.duration>60||item.endMs>video.duration*1000+25||video.videoWidth<16||video.videoHeight<16||video.videoWidth>4096||video.videoHeight>4096||video.videoWidth*video.videoHeight>8847360){finish();return;}
   if(Math.abs(video.currentTime-item.startMs/1000)>.015){seeking=true;video.currentTime=item.startMs/1000;return;}
   starting=true;
   try{try{await video.play();}catch{if(finished||token!==generation)return;soundState(false);await video.play();}if(finished||token!==generation)return;if(!started)await api.ready();}catch{finish();return;}
   if(finished||token!==generation){silence();return;}started=true;clipStarted=true;starting=false;lastProgress=performance.now();clearLoad();video.style.visibility='visible';root.style.opacity='1';gain();if(frame===null)frame=requestAnimationFrame(draw);
  }
  soundState(true);listen(sound,'click',()=>soundState(!soundOn));listen(skip,'click',finish);listen(document,'keydown',event=>{if(event.key==='Escape')finish();});listen(window,'beforeunload',finish);listen(video,'loadeddata',()=>{void begin();});listen(video,'seeked',()=>{seeking=false;void begin();});listen(video,'error',finish);listen(video,'ended',endClip);listen(video,'timeupdate',()=>{if(clipStarted&&video.currentTime>=clip().endMs/1000-.015)endClip();});
  if(!valid){finish();return{finish};}later(finish,Math.min(90000,Math.max(1000,Number(value.durationMs)||60000)+15000+clips.length*1000));loadClip();return{finish};
 }
 window.CodexStartupCustom={play};
})();