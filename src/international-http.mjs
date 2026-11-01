export const chatError=(code,details={})=>Object.assign(Error(code),{code,...details});
export const chatId=value=>typeof value==='string'&&/^[0-9]{1,22}$/.test(value);
export const decimal=value=>typeof value==='string'?value:typeof value==='bigint'?String(value):Number.isSafeInteger(value)?String(value):'';
export function chatChunks(value,max){if(typeof value!=='string'||!value.trim()||value.length>16000)throw chatError('chat_invalid_send');const chunks=[];let part='';for(const char of value){if(part.length+char.length>max){chunks.push(part);part='';}part+=char;}if(part)chunks.push(part);return chunks;}
/** 平台地址由适配器固定；错误只带代码，不能把含token的URL或原响应正文送到面板。 */
export async function chatHttp(fetchImpl,url,{method='POST',body,headers={},signal,timeoutMs=15000,sending=false,maxBytes=524288}={}){
 const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();const timer=setTimeout(abort,timeoutMs);
 try{const response=await fetchImpl(url,{method,headers:{'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal,redirect:'error'});const raw=await response.text();if(raw.length>maxBytes)throw chatError('chat_response_invalid',{deliveryUnknown:sending});let result;try{result=JSON.parse(raw);}catch{throw chatError('chat_response_invalid',{deliveryUnknown:sending});}if(!response.ok)throw chatError(response.status===401||response.status===403?'chat_auth_failed':response.status===429?'chat_rate_limited':'chat_http_failed',{terminal:[400,401,403].includes(response.status),deliveryUnknown:sending&&response.status>=500,retryAfterMs:Number.isFinite(result?.retry_after)?Math.min(60000,result.retry_after*1000):undefined});return result;}
 catch(error){if(error?.code?.startsWith('chat_'))throw error;throw chatError(controller.signal.aborted?'chat_request_aborted':'chat_network_failed',{deliveryUnknown:sending});}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
