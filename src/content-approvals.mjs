import {randomUUID} from 'node:crypto';
import {contentError,publicContentUrl} from './platform-catalog.mjs';
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const writes=new Set(['like','comment','dm','publish','broadcast']);
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);

/** 审批仅限本人当前原生窗口；一次消费、超时拒绝，不在磁盘保存待审正文。 */
export function createContentApprovals({now=Date.now,timeoutMs=120000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw contentError('content_approval_invalid');
 let disposed=false;const entries=new Map(),seen=new Set();
 function request(details){
  if(disposed||!record(details)||!identifier(details.job?.id)||!identifier(details.tool)||!writes.has(details.operation)||!record(details.arguments)||details.signal?.aborted)return Promise.resolve(false);
  const key=details.job.id;if(seen.has(key))return Promise.resolve(false);seen.add(key);while(seen.size>1024)seen.delete(seen.values().next().value);
  const args={};for(const[name,value]of Object.entries(details.arguments)){
   if(/token|secret|password|cookie|authorization|api_key|headers|env/i.test(name))continue;
   if(typeof value==='string'){if(value.length>12000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))return Promise.resolve(false);args[name]=/url|link/i.test(name)?publicContentUrl(value,details.platform)||'[unavailable]':value;}
   else if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))args[name]=value;else return Promise.resolve(false);
  }
  if(Buffer.byteLength(JSON.stringify(args))>64000)return Promise.resolve(false);
  const id=randomUUID(),createdAt=now(),view={id,jobId:key,operation:details.operation,platform:details.platform,host:details.host,tool:details.tool,arguments:args,createdAt,expiresAt:createdAt+timeoutMs};
  return new Promise(resolve=>{let done=false;const finish=accepted=>{if(done)return;done=true;clearTimeout(timer);details.signal?.removeEventListener('abort',abort);entries.delete(id);resolve(accepted===true);};const abort=()=>finish(false),timer=setTimeout(abort,timeoutMs);timer.unref?.();entries.set(id,{view,finish});details.signal?.addEventListener('abort',abort,{once:true});if(details.signal?.aborted)abort();});
 }
 function pending(){for(const entry of entries.values())if(now()>=entry.view.expiresAt)entry.finish(false);return[...entries.values()].map(entry=>structuredClone(entry.view));}
 function decide(body){if(!record(body)||Object.keys(body).some(key=>!['id','approved'].includes(key))||!identifier(body.id)||typeof body.approved!=='boolean')throw contentError('content_approval_invalid');const entry=entries.get(body.id);if(!entry)return false;const valid=now()<entry.view.expiresAt;entry.finish(valid&&body.approved);return valid;}
 function cancel(id){const entry=entries.get(id);if(!entry)return false;entry.finish(false);return true;}
 return{request,pending,decide,cancel,dispose(){disposed=true;for(const entry of entries.values())entry.finish(false);entries.clear();seen.clear();}};
}
