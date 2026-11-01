import {createHash,randomUUID} from 'node:crypto';
import {contentError} from './platform-catalog.mjs';

export const OBS_PROTOCOL_SOURCE='https://github.com/obsproject/obs-websocket/blob/e28f84975984340e84fc4879cfc05741cc0afde1/docs/generated/protocol.md';
const requests={status:'GetStreamStatus',start:'StartStream',stop:'StopStream'};
/** 仅实现OBS 5固定的流与文字源请求；不提供任意RPC、场景脚本或推流密钥查询。 */
export function callContentObs({endpoint='ws://127.0.0.1:4455',password='',action,signal,timeoutMs=15000,webSocketFactory=url=>new WebSocket(url,'obswebsocket.json'),sourceName,text}={}){
 let url;try{url=new URL(endpoint);if(url.protocol!=='ws:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||!url.port||url.pathname!=='/')throw Error();}catch{throw contentError('content_endpoint_invalid');}
 const inputAction=['text-sources','text-read','text-write'].includes(action);if(!Object.hasOwn(requests,action)&&!inputAction||typeof password!=='string'||password.length>1024||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw contentError('content_obs_invalid');
 if(['text-read','text-write'].includes(action)&&(typeof sourceName!=='string'||!sourceName||sourceName.length>160||/[\u0000-\u001f\u007f]/.test(sourceName)))throw contentError('content_obs_invalid');
 if(action==='text-write'&&(typeof text!=='string'||!text.trim()||text.length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)))throw contentError('content_obs_invalid');
 const requestType=inputAction?{'text-sources':'GetInputList','text-read':'GetInputSettings','text-write':'SetInputSettings'}[action]:requests[action],requestData=action==='text-sources'?{}:action==='text-read'?{inputName:sourceName}:action==='text-write'?{inputName:sourceName,inputSettings:{text},overlay:true}:{};
 return new Promise((resolve,reject)=>{
  let socket,done=false,identified=false,sent=false;const requestId=randomUUID();
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);try{socket?.close();}catch{}error?reject(contentError(error)):resolve(result);};
  const uncertain=()=>sent&&['start','stop','text-write'].includes(action);
  const abort=()=>finish(uncertain()?'content_delivery_uncertain':'content_cancelled');
  const timer=setTimeout(()=>finish(uncertain()?'content_delivery_uncertain':'content_timeout'),timeoutMs);
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
  try{socket=webSocketFactory(url.href);}catch{finish('content_obs_unavailable');return;}
  socket.addEventListener('error',()=>finish(uncertain()?'content_delivery_uncertain':'content_obs_unavailable'));
  socket.addEventListener('close',()=>finish(uncertain()?'content_delivery_uncertain':'content_obs_unavailable'));
  socket.addEventListener('message',event=>{
   if(done||typeof event.data!=='string'||event.data.length>131072){if(!done)finish('content_obs_protocol');return;}
   let frame;try{frame=JSON.parse(event.data);}catch{finish('content_obs_protocol');return;}
   try{
    if(frame.op===0&&!identified){
     if(frame.d?.rpcVersion<1)throw Error();let authentication;
     if(frame.d.authentication){const {salt,challenge}=frame.d.authentication;if(typeof salt!=='string'||typeof challenge!=='string'||salt.length>512||challenge.length>512)throw Error();if(!password){finish('content_auth_required');return;}const secret=createHash('sha256').update(password+salt).digest('base64');authentication=createHash('sha256').update(secret+challenge).digest('base64');}
     socket.send(JSON.stringify({op:1,d:{rpcVersion:1,eventSubscriptions:0,...(authentication?{authentication}:{})}}));
    }else if(frame.op===2&&!identified){
     if(frame.d?.negotiatedRpcVersion!==1)throw Error();identified=true;sent=true;socket.send(JSON.stringify({op:6,d:{requestType,requestId,requestData}}));
    }else if(frame.op===7&&identified&&frame.d?.requestId===requestId){
     if(frame.d.requestType!==requestType||frame.d.requestStatus?.result!==true){finish('content_obs_request_failed');return;}
     const raw=frame.d.responseData??{},status={};
     if(action==='text-sources'){if(!Array.isArray(raw.inputs)||raw.inputs.length>512)throw Error();finish(null,{sources:raw.inputs.filter(row=>textKind(row.inputKind)&&typeof row.inputName==='string'&&row.inputName.length<=160&&!/[\u0000-\u001f]/.test(row.inputName)).map(row=>({name:row.inputName,kind:row.inputKind}))});return;}
     if(action==='text-read'){if(!textKind(raw.inputKind)){finish('content_obs_source_invalid');return;}if(raw.inputSettings?.read_from_file===true||raw.inputSettings?.from_file===true){finish('content_obs_source_file');return;}finish(null,{kind:raw.inputKind});return;}
     for(const name of ['outputActive','outputReconnecting'])if(typeof raw[name]==='boolean')status[name]=raw[name];
     for(const name of ['outputDuration','outputCongestion','outputBytes','outputSkippedFrames','outputTotalFrames'])if(Number.isFinite(raw[name])&&raw[name]>=0)status[name]=raw[name];
     finish(null,{confirmed:true,operation:action,status});
    }
   }catch{finish(uncertain()?'content_delivery_uncertain':'content_obs_protocol');}
  });
 });
}
const textKind=value=>typeof value==='string'&&/^text_(?:gdiplus|ft2_source)(?:_v\d+)?$/.test(value);
/** 仅本人选中的既有文字源；先核实类型，再只覆盖text，不接浏览器源或媒体路径。 */
export const listContentObsTextSources=async options=>(await callContentObs({...options,action:'text-sources'})).sources;
export async function writeContentObsCaption(options){await callContentObs({...options,action:'text-read'});return callContentObs({...options,action:'text-write'});}
