(() => {
 'use strict';
 const api=window.mediaProbe,video=document.getElementById('video');let nonce,finished=false;
 function report(ok){if(finished||!nonce)return;finished=true;video.pause();void api.report({nonce,ok,...(ok?{duration:video.duration,width:video.videoWidth,height:video.videoHeight}:{})}).catch(()=>{});video.removeAttribute('src');video.load();}
 video.addEventListener('loadeddata',()=>report(true));video.addEventListener('error',()=>report(false));
 void api.get().then(value=>{nonce=value.nonce;video.muted=true;video.volume=0;video.src=value.url;video.load();if(video.readyState>=2)report(true);}).catch(()=>{});
})();
