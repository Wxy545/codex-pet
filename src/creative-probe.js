(()=>{
 'use strict';const api=window.creativeProbe;let nonce,finished=false,media=null;
 function report(value){if(finished||!nonce)return;finished=true;if(media){media.pause();media.removeAttribute('src');media.load();}void api.report({nonce,...value}).catch(()=>{});}
 const image=url=>new Promise((resolve,reject)=>{const value=new Image();value.onload=()=>resolve(value);value.onerror=reject;value.src=url;});
 void api.get().then(async input=>{nonce=input.nonce;
  if(input.kind==='image'){const value=await image(input.urls[0]);report({ok:true,width:value.naturalWidth,height:value.naturalHeight});return;}
  if(input.kind==='sequence'){
   const values=[];for(const url of input.urls)values.push(await image(url));const width=values[0].naturalWidth,height=values[0].naturalHeight;
   if(values.some(x=>x.naturalWidth!==width||x.naturalHeight!==height)||width<1||height<1)throw Error('sequence-dimensions');
   const columns=Math.ceil(Math.sqrt(values.length)),rows=Math.ceil(values.length/columns),canvas=document.createElement('canvas');canvas.width=width*columns;canvas.height=height*rows;if(canvas.width>4096||canvas.height>4096||canvas.width*canvas.height>16*1024*1024)throw Error('sequence-too-large');const context=canvas.getContext('2d');values.forEach((value,index)=>context.drawImage(value,index%columns*width,Math.floor(index/columns)*height));report({ok:true,png:canvas.toDataURL('image/png'),columns,rows,frames:values.map((_v,i)=>[i%columns,Math.floor(i/columns)]),width:canvas.width,height:canvas.height});return;
  }
  media=document.createElement(input.kind==='audio'?'audio':'video');media.muted=true;media.volume=0;media.preload='auto';media.addEventListener('loadedmetadata',()=>{if(media.duration>120||media.videoWidth>4096||media.videoHeight>4096)report({ok:false});});media.addEventListener('loadeddata',()=>report({ok:true,duration:media.duration,...(input.kind==='audio'?{}:{width:media.videoWidth,height:media.videoHeight})}));media.addEventListener('error',()=>report({ok:false}));media.src=input.urls[0];media.load();
 }).catch(()=>report({ok:false}));
})();
