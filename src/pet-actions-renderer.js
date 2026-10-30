(function(){
 'use strict';
 function groupsFromTree(tree){
  const groups=[];
  function leaves(nodes){return(nodes||[]).flatMap(node=>node.action==='third-party'?[]:typeof node.anim==='string'?[{anim:node.anim,label:String(node.label||node.anim),...(node.hint?{hint:String(node.hint)}:{})}]:leaves(node.children));}
  for(const branch of tree||[])if(branch.action!=='third-party')for(const group of branch.children||[]){const items=leaves(group.children);if(items.length)groups.push({label:String(group.label),items});}
  return groups;
 }
 function install({window,PetSprite,shared=window.PetShared,menu=window.CodexSkinMenu,bridge=window.petActions}){
  if(!bridge||!shared||!PetSprite?.prototype)return{dispose(){}};
  const entries=new Map(),proto=PetSprite.prototype,position=proto.position,originalDispose=proto.dispose;let closed=false;
  const groups=sprite=>groupsFromTree(menu?.getTree?menu.getTree(sprite.animations):shared.buildMenuTree(sprite.animations));
  const identity=()=>menu?.identity?.()||'';
  const displayName=sprite=>String(sprite.__codexSkinController?.displayName||sprite.pet.name||sprite.pet.id).replace(/[\u0000-\u001f]/g,' ').trim().slice(0,80)||String(sprite.pet.id).slice(0,80);
  function publish(sprite){
   if(closed)return;let entry=entries.get(sprite);if(!entry){entry={version:0,revision:null,signature:null,groups:[]};entries.set(sprite,entry);}
   const value={petId:sprite.pet.id,name:displayName(sprite),groups:groups(sprite)},signature=JSON.stringify([identity(),value]);
   if(signature===entry.signature)return;entry.signature=signature;entry.groups=value.groups;entry.revision=null;const version=++entry.version;
   Promise.resolve(bridge.publish(value)).then(result=>{if(!closed&&entries.get(sprite)===entry&&entry.version===version&&result?.ok)entry.revision=result.revision;},()=>{});
  }
  // 位置每帧会更新；目录只在首次登记和角色模型变化时重建，避免移动时反复遍历整张动作表。
  proto.position=function(){const result=position.apply(this,arguments);if(!entries.has(this))publish(this);return result;};
  proto.dispose=function(){const entry=entries.get(this);entries.delete(this);if(entry&&!closed)void Promise.resolve(bridge.publish({petId:this.pet.id,name:displayName(this),groups:[]})).catch(()=>{});return originalDispose.apply(this,arguments);};
  const unsubscribe=menu?.subscribe?.(()=>{for(const sprite of entries.keys())publish(sprite);})||(()=>{});
  const stop=bridge.onPlay(value=>{
   if(closed||typeof value?.petId!=='string'||typeof value.anim!=='string')return false;
   const match=[...entries].find(([sprite])=>sprite.pet.id===value.petId);if(!match)return false;const[sprite,entry]=match;
   // 角色更新会立刻撤销旧revision；同名原动画也不能让旧面板串到新角色。
   if(!entry.revision||value.revision!==entry.revision||sprite.dragState?.active||sprite.dragState?.dragging||!groups(sprite).some(group=>group.items.some(item=>item.anim===value.anim)))return false;
   sprite.stopThrow();sprite.stopMove();sprite.onMenuAction({anim:value.anim});return true;
  });
  function quickMenu(){
   const match=[...entries][0];if(!match||closed)return[];const[sprite]=match,items=groups(sprite).flatMap(group=>group.items),allowed=new Map(items.map(item=>[item.anim,item])),en=window.CodexLocale?.getLocale?.()!=='zh-CN',out=[];
   const add=(anim,label)=>{if(anim&&allowed.has(anim)&&!out.some(item=>item.anim===anim))out.push({anim,label});};
   add(sprite.animations.idle.find(anim=>allowed.has(anim)),en?'Idle':'待机');add(sprite.animations.moves.actions.find(item=>allowed.has(item.name))?.name,en?'Take a walk':'走动');
   add(items.find(item=>/招呼|招手|挥手|wave|greet/i.test(item.label))?.anim,en?'Say hello':'打招呼');return out;
  }
  window.CodexPetActions=Object.freeze({quickMenu});
  function dispose(){if(closed)return;closed=true;unsubscribe();stop?.();entries.clear();proto.position=position;proto.dispose=originalDispose;}
  window.addEventListener('beforeunload',dispose,{once:true});return{dispose};
 }
 if(typeof module==='object'&&module.exports){module.exports={install,groupsFromTree};return;}
 if(typeof window==='object'&&typeof PetSprite==='function')install({window,PetSprite});
})();
