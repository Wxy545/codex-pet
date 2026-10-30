(() => {
  'use strict';
  const clamp=x=>Math.max(0,Math.min(1,x));
  const ease=x=>{const t=clamp(x);return t*t*(3-2*t);};
  const mix=(a,b,t)=>a+(b-a)*t;
  // 原创鲸形轮廓；所有流线、星尘与声音均由本页绘制和合成。
  const curves=[[-.95,.04,-.9,-.36,-.55,-.5,-.12,-.38],[-.12,-.38,.08,-.36,.38,-.14,.61,-.1],[.61,-.1,.72,-.25,.91,-.37,1.1,-.29],[1.1,-.29,1.04,-.04,.84,.04,.78,.09],[.78,.09,.98,.19,1.03,.31,.98,.42],[.98,.42,.73,.42,.62,.28,.59,.18],[.59,.18,.26,.52,-.23,.51,-.6,.32],[-.6,.32,-.86,.24,-.98,.17,-.95,.04]];
  const outline=curves.flatMap(c=>Array.from({length:24},(_,i)=>{const t=i/24,u=1-t;return{x:u*u*u*c[0]+3*u*u*t*c[2]+3*u*t*t*c[4]+t*t*t*c[6],y:u*u*u*c[1]+3*u*u*t*c[3]+3*u*t*t*c[5]+t*t*t*c[7]};}));

  function play({api,value={}}){
    const english=value.locale!=='zh-CN',reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
    const brand=typeof value.brand==='string'&&value.brand.trim()?value.brand.trim().slice(0,48):'DeepSeek';
    const timers=new Set(),listeners=[],voices=[],audioNodes=[];
    let finished=false,started=false,frame=null,epoch=0,previous=-Infinity,width=0,height=0,phase=-1;
    let audio=null,master=null,soundOn=false,targetPending=false,targetReady=false;
    function element(tag,className,text){const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;}
    const root=element('main','deepseek-intro');root.setAttribute('aria-label',brand);root.dataset.reduced=String(reduced);
    const canvas=element('canvas','deepseek-field');canvas.setAttribute('aria-hidden','true');
    const horizon=element('div','deepseek-horizon'),grid=element('div','deepseek-grid'),vignette=element('div','deepseek-vignette');
    for(const node of [horizon,grid,vignette])node.setAttribute('aria-hidden','true');
    const orbit=element('div','deepseek-orbit');orbit.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)orbit.appendChild(element('i','deepseek-orbit-ring'));
    const wordmark=element('div','deepseek-wordmark'),name=element('h1','deepseek-name',brand),rule=element('div','deepseek-wordmark-rule');wordmark.append(name,rule);
    const hud=element('div','deepseek-hud');hud.setAttribute('aria-hidden','true');hud.append(element('span','deepseek-product','CODEX PET'),element('span','deepseek-coordinate','D / S'));
    const chapter=element('div','deepseek-chapter'),chapterNumber=element('span','deepseek-chapter-number','01'),status=element('span','deepseek-status');status.setAttribute('role','status');chapter.append(chapterNumber,status);
    const controls=element('div','deepseek-controls'),sound=element('button','deepseek-sound'),skip=element('button','deepseek-skip',english?'Skip':'跳过');sound.type='button';skip.type='button';if(value.reason!=='preview')skip.textContent+=' · Esc';controls.append(sound,skip);
    const shutters=element('div','deepseek-shutters');shutters.setAttribute('aria-hidden','true');shutters.append(element('i','deepseek-shutter-left'),element('i','deepseek-shutter-right'));
    root.append(grid,horizon,canvas,orbit,wordmark,hud,chapter,controls,vignette,shutters);
    document.title='Codex Pet · '+brand;document.documentElement.lang=english?'en':'zh-CN';document.body.classList.add('deepseek-startup-active');document.body.appendChild(root);
    let ctx=null;try{ctx=canvas.getContext('2d',{alpha:true});}catch{/* 画布不可用时直接交还原宿主。 */}
    function listen(node,event,handler){node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));}
    function later(handler,delay){const id=setTimeout(()=>{timers.delete(id);if(!finished)handler();},delay);timers.add(id);return id;}
    function finish(){
      if(finished)return;finished=true;
      if(frame!==null)cancelAnimationFrame(frame);frame=null;
      for(const timer of timers)clearTimeout(timer);timers.clear();listeners.forEach(remove=>remove());listeners.length=0;
      for(const voice of voices){try{voice.stop();}catch{/* 已自然结束的声音不重复停止。 */}}
      for(const node of audioNodes){try{node.disconnect();}catch{/* 节点可能已经释放。 */}}
      voices.length=0;audioNodes.length=0;
      if(audio){const closing=audio;audio=null;master=null;try{void Promise.resolve(closing.close()).catch(()=>{});}catch{/* 关闭音频设备失败不延长演出。 */}}
      root.remove();
      // 只通知既有控制器完成；真实目标、预览焦点与窗口交还仍由控制器决定。
      try{void Promise.resolve(api.finish()).catch(()=>{});}catch{/* 宿主退出时不重新创建窗口。 */}
    }
    function setSound(next){
      soundOn=Boolean(next&&audio&&master);sound.textContent=english?(soundOn?'Sound on':'Sound off'):(soundOn?'声音 开':'声音 关');sound.setAttribute('aria-pressed',String(soundOn));
      if(audio&&master)master.gain.setTargetAtTime(soundOn ? .12 : 0,audio.currentTime,.035);
      if(soundOn)try{void Promise.resolve(audio.resume()).catch(()=>{if(!finished)setSound(false);});}catch{setSound(false);}
    }
    function startAudio(){
      const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
      try{
        audio=new Audio();master=audio.createGain();master.connect(audio.destination);audioNodes.push(master);
        const tone=(offset,duration,hz,volume,type='sine',endHz=hz)=>{
          const source=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime+offset;
          source.type=type;source.frequency.setValueAtTime(hz,at);source.frequency.exponentialRampToValueAtTime(endHz,at+duration);
          gain.gain.setValueAtTime(.0001,at);gain.gain.linearRampToValueAtTime(volume,at+.08);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
          source.connect(gain);gain.connect(master);source.start(at);source.stop(at+duration+.02);voices.push(source);audioNodes.push(source,gain);
        };
        tone(0,3.1,55,.45,'sine',82.4);tone(.8,2.4,110,.12,'triangle',164.8);
        [196,293.66,392,587.33].forEach((hz,i)=>tone(2.55+i*.13,1.8,hz,.22));
        [164.81,246.94,329.63,493.88].forEach((hz,i)=>tone(5.8+i*.06,1.1,hz,.15));
        setSound(true);
      }catch{
        const closing=audio;audio=null;master=null;setSound(false);
        for(const voice of voices){try{voice.stop();}catch{/* 部分构建成功的节点一并释放。 */}}
        for(const node of audioNodes){try{node.disconnect();}catch{/* 设备失败不影响后续画面。 */}}
        if(closing)try{void Promise.resolve(closing.close()).catch(()=>{});}catch{/* 设备已关闭。 */}
      }
    }
    function resize(){
      width=Number(window.innerWidth);height=Number(window.innerHeight);
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1){finish();return;}
      // 4K屏幕限制像素预算，不按设备缩放无限放大粒子画布。
      const reportedRatio=Number(window.devicePixelRatio),ratio=Math.min(Number.isFinite(reportedRatio)&&reportedRatio>0?reportedRatio:1,1.5,Math.sqrt(2800000/(width*height)));
      canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));ctx.setTransform(ratio,0,0,ratio,0,0);
    }
    const particles=Array.from({length:reduced?56:288},(_,i)=>({x:((i*73+19)%293)/293,y:((i*97+31)%307)/307,z:.28+(i%17)/21,size:.65+(i%4)*.4,target:outline[i%outline.length]}));
    function draw(time){
      if(finished||!started)return;
      frame=requestAnimationFrame(draw);if(time-previous<32)return;previous=time;
      try{
        const elapsed=Math.max(0,(time-epoch)/1000),formation=reduced?Number(elapsed>=.7):ease((elapsed-.7)/2.25),reveal=reduced?Number(elapsed>=2.75):ease((elapsed-2.75)/1.15),scale=Math.min(width*.24,height*.3),cx=width*.5,cy=height*(width<height ? .38 : .4);
        ctx.clearRect(0,0,width,height);
        const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,scale*1.7);glow.addColorStop(0,'rgba(55,112,255,.12)');glow.addColorStop(1,'rgba(12,28,70,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
        for(const p of particles){
          const travel=reduced?0:elapsed*(.13+p.z*.12),flightX=((p.x-travel)%1+1)%1*width,flightY=(p.y-.5)*height*.9+height*.48;
          const pulse=reduced?0:Math.sin(elapsed*1.4+p.x*9)*.008;
          const x=mix(flightX,cx+p.target.x*scale*(1+pulse),formation),y=mix(flightY,cy+p.target.y*scale*(1+pulse),formation);
          ctx.strokeStyle=`rgba(104,162,255,${(.1+p.z*.2)*(1-formation)})`;ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(1-formation)*(22+p.z*44),y+(p.y-.5)*(1-formation)*7);ctx.stroke();
          ctx.fillStyle=`rgba(${formation>.8?'180,218,255':'91,143,255'},${.28+p.z*.44})`;ctx.beginPath();ctx.arc(x,y,p.size*(formation>.8 ? .8 : 1),0,Math.PI*2);ctx.fill();
        }
        if(formation>.02){
          ctx.save();ctx.translate(cx,cy);ctx.scale(scale,scale);ctx.lineWidth=1.1/scale;ctx.shadowColor='#4d8bff';ctx.shadowBlur=20;ctx.strokeStyle=`rgba(137,190,255,${formation*.65})`;ctx.beginPath();
          const count=Math.max(2,Math.floor(outline.length*formation));ctx.moveTo(outline[0].x,outline[0].y);for(let i=1;i<count;i++)ctx.lineTo(outline[i].x,outline[i].y);if(count===outline.length)ctx.closePath();ctx.stroke();ctx.shadowBlur=0;
          if(formation>.9){ctx.fillStyle='#d9eeff';ctx.beginPath();ctx.arc(-.59,-.035,.018,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(120,183,255,.4)';ctx.beginPath();ctx.moveTo(-.22,.34);ctx.bezierCurveTo(-.12,.58,.08,.59,.18,.29);ctx.stroke();}
          ctx.restore();
        }
        wordmark.style.opacity=String(reveal);wordmark.style.transform=`translate(-50%,${mix(22,0,reveal)}px)`;name.style.clipPath=`inset(0 ${100-reveal*100}% 0 0)`;orbit.style.opacity=String(formation*.6*(1-ease((elapsed-5.8)/.7)));
        const next=elapsed<.8?0:elapsed<2.95?1:elapsed<6.1?2:3;
        if(next!==phase){phase=next;root.dataset.phase=['signal','forming','identity','reveal'][phase];chapterNumber.textContent='0'+(phase+1);status.textContent=(english?['SIGNAL','CONVERGENCE','BEYOND THE SURFACE',brand]:['深海信号','流光聚合','向更深处',brand])[phase];}
      }catch{finish();}
    }
    async function probe(){
      if(finished||targetPending||targetReady||!['codex','workbuddy'].includes(value.reason)||typeof api.target!=='function')return;
      targetPending=true;
      try{const result=await api.target();if(!finished){targetReady=result?.ready===true;root.dataset.target=targetReady?'ready':'unknown';}}
      catch{if(!finished)root.dataset.target='unknown';}
      finally{targetPending=false;if(!finished&&!targetReady)later(()=>{void probe();},500);}
    }
    setSound(false);listen(skip,'click',finish);listen(sound,'click',()=>setSound(!soundOn));listen(document,'keydown',event=>{if(event.key==='Escape')finish();});listen(window,'beforeunload',finish);listen(window,'resize',()=>{try{resize();}catch{finish();}});listen(canvas,'contextlost',finish);
    // ready/target/RAF三者都不能延长总上限；即使IPC不兑现也独立退场。
    later(finish,8500);
    if(!ctx){finish();return{finish};}
    try{resize();ctx.clearRect(0,0,width,height);}catch{finish();return{finish};}
    if(finished)return{finish};
    void Promise.resolve().then(()=>api.ready()).then(()=>{
      if(finished)return;started=true;epoch=performance.now();root.classList.add('is-playing');startAudio();frame=requestAnimationFrame(draw);
      later(()=>{void probe();},4600);later(()=>{root.classList.add('is-revealing');},6200);later(finish,7000);
    }).catch(finish);
    return{finish};
  }
  window.CodexStartupDeepseek={play};
})();
