import {createServer} from 'node:http';

const PREFIX='/dsh-pet-7340/international-chat/webhook/',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=code=>{throw Object.assign(Error(code),{code});};
/** 独立回环收件口不接设置、目录或模型请求；每条消息仍须平台原始字节验签。 */
export function createInternationalWebhookServer({service,port=17640,now=Date.now,maxRequestsPerMinute=120,maxConcurrent=8}={}){
 if(typeof service?.state!=='function'||typeof service?.handleWebhook!=='function'||!Number.isInteger(port)||port<0||port>65535||!Number.isInteger(maxRequestsPerMinute)||maxRequestsPerMinute<1||maxRequestsPerMinute>1000||!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>32)fail('webhook_invalid_options');
 let server=null,disposed=false,queue=Promise.resolve(),view={state:'off',host:'127.0.0.1',port:null,pathPrefix:PREFIX},active=0,windowStart=now(),windowCount=0;
 const state=()=>({...view});
 const enabled=()=>new Set((service.state().connections||[]).filter(row=>row.enabled&&['line','whatsapp'].includes(row.platform)&&UUID.test(row.id)).map(row=>row.id));
 function send(res,status,body='',headers={}){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','connection':'close',...(headers['content-type']?{'content-type':headers['content-type']}: {})});res.end(body);}
 async function body(req){
  if(Number(req.headers['content-length'])>262144)fail('webhook_body_large');
  return new Promise((resolve,reject)=>{const chunks=[];let bytes=0,done=false;const cleanup=()=>{clearTimeout(timer);req.removeListener('data',data);req.removeListener('end',end);req.removeListener('error',error);req.removeListener('aborted',aborted);};const finish=(code,value)=>{if(done)return;done=true;cleanup();code?reject(Object.assign(Error(code),{code})):resolve(value);};const data=chunk=>{bytes+=chunk.length;if(bytes>262144){finish('webhook_body_large');req.resume();}else chunks.push(chunk);};const end=()=>finish(null,Buffer.concat(chunks,bytes)),error=()=>finish('webhook_body_invalid'),aborted=()=>finish('webhook_body_invalid');const timer=setTimeout(()=>{finish('webhook_body_timeout');req.resume();},5000);req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',aborted);});
 }
 async function handle(req,res){
  if(disposed){send(res,503);req.resume();return;}
  if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){send(res,403);req.resume();return;}
  const expectedHost='127.0.0.1:'+server?.address()?.port;if(req.headers.host!==expectedHost||req.headers.origin!==undefined){send(res,403);req.resume();return;}
  if(now()-windowStart>=60000){windowStart=now();windowCount=0;}if(++windowCount>maxRequestsPerMinute||active>=maxConcurrent){send(res,429);req.resume();return;}
  if(typeof req.url!=='string'||req.url.length>8192||!req.url.startsWith(PREFIX)){send(res,404);req.resume();return;}let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{send(res,400);req.resume();return;}
  const id=url.pathname.slice(PREFIX.length);if(url.origin!=='http://127.0.0.1'||!UUID.test(id)||!enabled().has(id)){send(res,404);req.resume();return;}
  if(!['GET','POST'].includes(req.method)){send(res,405);req.resume();return;}
  if(req.method==='POST'&&(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')||req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')){send(res,415);req.resume();return;}
  const query={};for(const [key,value]of url.searchParams){if(!['hub.mode','hub.verify_token','hub.challenge'].includes(key)||Object.hasOwn(query,key)){send(res,400);req.resume();return;}query[key]=value;}
  active++;let timer;
  try{
   const rawBody=req.method==='POST'?await body(req):Buffer.alloc(0);if(req.method==='GET')req.resume();
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('webhook_handler_timeout'),{code:'webhook_handler_timeout'})),10000);});
   const result=await Promise.race([service.handleWebhook(id,{method:req.method,query,headers:req.headers,rawBody}),timeout]);
   if(![200,400,401,403,404,405,413,415,429,503].includes(result?.status)||typeof result.body!=='string'||Buffer.byteLength(result.body)>8192){send(res,502);return;}send(res,result.status,result.body,result.headers||{});
  }catch(error){const status=({chat_signature_invalid:403,chat_account_changed:403,chat_response_invalid:400,chat_not_connected:503,international_not_connected:503,international_connection_missing:404,webhook_body_large:413,webhook_body_timeout:408,webhook_body_invalid:400,webhook_handler_timeout:504})[error?.code]||500;send(res,status);req.resume();}
  finally{clearTimeout(timer);active--;}
 }
 async function close(){const previous=server;server=null;if(previous){await new Promise(resolve=>{previous.close(()=>resolve());previous.closeAllConnections?.();});}view={state:'off',host:'127.0.0.1',port:null,pathPrefix:PREFIX};}
 async function sync(){
  if(disposed)return state();if(enabled().size===0){await close();return state();}if(server?.listening)return state();
  const candidate=createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:5000,keepAliveTimeout:1000},(req,res)=>{void handle(req,res).catch(()=>send(res,500));});candidate.on('clientError',(_error,socket)=>socket.destroy());server=candidate;
  const result=await new Promise(resolve=>{const failed=error=>resolve({error});candidate.once('error',failed);candidate.listen(port,'127.0.0.1',()=>{candidate.removeListener('error',failed);resolve({port:candidate.address().port});});});
  if(result.error){if(server===candidate)server=null;view={state:'error',code:result.error.code==='EADDRINUSE'?'webhook_port_in_use':'webhook_listen_failed',host:'127.0.0.1',port:null,pathPrefix:PREFIX};return state();}
  candidate.on('error',()=>{view={state:'error',code:'webhook_listen_failed',host:'127.0.0.1',port:null,pathPrefix:PREFIX};});view={state:'listening',host:'127.0.0.1',port:result.port,pathPrefix:PREFIX};if(disposed||enabled().size===0)await close();return state();
 }
 return{state,sync:()=>{const next=queue.then(sync);queue=next.catch(()=>{});return next;},dispose:async()=>{if(disposed)return;disposed=true;await queue;await close();}};
}
