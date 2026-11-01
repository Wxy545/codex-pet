'use strict';
/** 复用当前宠物实时目录和显示控制器，远程动作没有URL、脚本或电脑工具入口。 */
function install({electron=require('electron'),hostRequest,skins,actions,visibility,canUse=()=>true}){
 let disposed=false,polling=false;const call=async body=>{const r=await hostRequest('POST','/dsh-pet-7340/pet-local-control',JSON.stringify(body));if(r.status!==200)throw Error('unavailable');return JSON.parse(r.body);};
 const timer=setInterval(async()=>{if(disposed||polling)return;polling=true;try{const rows=(await call({action:'take'})).items;for(const item of rows){let value,ok=false;try{
  if(!canUse())throw Error('unavailable');
  if(item.action==='catalog'){const model=await skins.readModel();value={pets:actions.state().pets,characters:model.characters.filter(c=>c.available?.q).map(c=>({id:c.id,name:c.copy?.name||c.label})),selection:model.selection};}
  else if(item.action==='play'){await actions.play(item.value);value={ok:true};}
  else if(item.action==='hide'||item.action==='show'){await visibility.setManualHidden(item.action==='hide');value={ok:true};}
  else if(item.action==='select'){await skins.select({character:item.value,mode:'q'});value={ok:true};}
  else throw Error('invalid');ok=true;
 }catch{}await call({action:'settle',id:item.id,ok,...(ok?{value}:{})});}}catch{}finally{polling=false;}},750);timer.unref?.();
 const dispose=()=>{disposed=true;clearInterval(timer);electron.app.removeListener('before-quit',dispose);};electron.app.once('before-quit',dispose);return{dispose};
}
module.exports={install};
