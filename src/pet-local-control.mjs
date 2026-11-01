import{randomUUID}from'node:crypto';
const fail=code=>{throw Object.assign(Error(code),{code});};
/** 手机只提交固定桌宠动作；短期队列一次领取、不重放，不产生模型或电脑任务。 */
export function createPetLocalControl({host,now=Date.now,timeoutMs=5000}={}){
 let disposed=false;const pending=new Map();
 function request(application,action,value){
  if(disposed||application!==host||!['catalog','play','hide','show','select'].includes(action))fail('local_action_unavailable');
  if(action==='play'&&(!value||Object.keys(value).some(k=>!['petId','revision','anim'].includes(k))))fail('invalid_input');
  if(action==='select'&&(typeof value!=='string'||!['white-dragon','bluefish','curly-sheep'].includes(value)&&!/^custom-[a-f0-9-]{36}$/.test(value)))fail('invalid_input');
  if(pending.size>=8)fail('busy');const id=randomUUID();return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(Error('local_action_timeout'),{code:'local_action_timeout'}));},timeoutMs);timer.unref?.();pending.set(id,{view:{id,action,value,expiresAt:now()+timeoutMs},timer,resolve,reject,taken:false});
  });
 }
 function take(){if(disposed)return[];const items=[];for(const item of pending.values())if(!item.taken&&item.view.expiresAt>now()){item.taken=true;items.push(structuredClone(item.view));}return items;}
 function settle(body){const item=pending.get(body?.id);if(!item||!item.taken||now()>=item.view.expiresAt)return false;pending.delete(body.id);clearTimeout(item.timer);if(body.ok===true)item.resolve(body.value??{ok:true});else item.reject(Object.assign(Error('local_action_unavailable'),{code:'local_action_unavailable'}));return true;}
 return{request,take,settle,dispose(){disposed=true;for(const item of pending.values()){clearTimeout(item.timer);item.reject(Object.assign(Error('local_action_unavailable'),{code:'local_action_unavailable'}));}pending.clear();}};
}
