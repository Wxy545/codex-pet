import{mkdir,lstat,writeFile,rename,unlink}from'node:fs/promises';import{join}from'node:path';import{randomUUID}from'node:crypto';
const active=new Set(['thinking','working','waiting','result']),priority={waiting:4,working:3,result:2,thinking:1};
/** 多条远程连接分别占槽；原生Harness只观察自己的远程任务，不混入其它宿主或正文。 */
export async function createRemoteActivity({dataRoot,onChange=()=>{},now=Date.now,terminalMs=5000,heartbeatMs=10000}={}){
 await mkdir(dataRoot,{recursive:true});const rows=new Map(),file=join(dataRoot,'qq-activity.json');let disposed=false,writes=Promise.resolve(),terminalTimer;
 const select=values=>{const busy=values.filter(v=>active.has(v.state));const chosen=(busy.length?busy:values).sort((a,b)=>(priority[b.state]||0)-(priority[a.state]||0)||b.at-a.at)[0];return chosen?{state:chosen.state,application:chosen.application,channel:chosen.channel,activeCount:busy.reduce((sum,v)=>sum+v.activeCount,0)}:null;};
 const snapshot=()=>select([...rows.values()]);
 async function writeNative(){const native=select([...rows.values()].filter(v=>v.application==='harness')),record={schemaVersion:1,application:'harness',state:native?.state||'idle',activeCount:Math.min(32,native?.activeCount||0),at:now()};
  try{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('unsafe-activity-file');}catch(e){if(e.code!=='ENOENT')throw e;}
  const temporary=file+'.tmp-'+randomUUID();try{await writeFile(temporary,JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});await rename(temporary,file);}finally{await unlink(temporary).catch(()=>{});}
 }
 const persist=()=>{const next=writes.then(writeNative);writes=next.catch(()=>{});return next;};
 function changed(){try{onChange(snapshot());}catch{}void persist().catch(()=>{});clearTimeout(terminalTimer);const deadlines=[...rows.values()].filter(v=>!active.has(v.state)).map(v=>v.at+terminalMs-now());if(deadlines.length){terminalTimer=setTimeout(()=>{for(const[k,v]of rows)if(!active.has(v.state)&&now()-v.at>=terminalMs)rows.delete(k);changed();},Math.max(1,Math.min(...deadlines)));terminalTimer.unref?.();}}
 function observe(key,value){if(disposed||typeof key!=='string'||!value||!['codex','workbuddy','harness'].includes(value.application))return;if(value.state==='idle'){rows.delete(key);changed();return;}if(!active.has(value.state)&&!['success','error'].includes(value.state))return;
  rows.set(key,{state:value.state,application:value.application,channel:typeof value.channel==='string'?value.channel.split('-')[0]:'qq',activeCount:active.has(value.state)?Math.max(1,Math.min(32,Number(value.activeCount)||1)):0,at:now()});changed();
 }
 const heartbeat=setInterval(()=>{if(!disposed)void persist().catch(()=>{});},heartbeatMs);heartbeat.unref?.();await persist();
 return{observe,snapshot,async dispose(){if(disposed)return;disposed=true;clearInterval(heartbeat);clearTimeout(terminalTimer);rows.clear();await persist();await writes;}};
}
