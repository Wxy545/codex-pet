import{randomUUID}from'node:crypto';
const fail=code=>{throw Object.assign(Error(code),{code});};
/** 桌面闲聊只取本次用户消息，历史由本人可管理的记忆服务提供。 */
export function roleHttpInput(body){
 if(!body||typeof body!=='object'||!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>64||body.stream!==false)fail('role_http_unsupported');
 const last=body.messages.at(-1);if(last?.role!=='user')fail('invalid_input');
 let text=last.content;if(Array.isArray(text)){if(text.some(p=>p?.type!=='text'))fail('role_http_unsupported');text=text.map(p=>p.text).join('\n');}
 if(typeof text!=='string'||!text.trim()||text.length>16384||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))fail('invalid_input');
 if(body.purpose!==undefined&&!['chat','translation','summary','whisper'].includes(body.purpose))fail('invalid_input');
 return{text,execution:body.execution,...(body.purpose?{purpose:body.purpose}:{})};
}
export async function handleRoleHttp({req,res,body,service,host='codex',locale='zh-CN',allowStream=false}){
 const streamed=allowStream&&body.stream===true,input=roleHttpInput(streamed?{...body,stream:false}:body),controller=new AbortController(),abort=()=>controller.abort(),close=()=>{if(!res.writableEnded)controller.abort();};req.once('aborted',abort);res.once('close',close);
 try{
  const answer=await service.reply({...input,signal:controller.signal,trustedIdentity:{host,profile:'standalone',channel:'desktop',account:'local',audience:'owner',actor:'owner',isOwner:true}});
  if(!await service.isCurrent(answer))fail('role_chat_stale');if(res.destroyed||res.writableEnded)return;
  const metadata={id:'pet-role-'+randomUUID(),created:Math.floor(Date.now()/1000),model:answer.execution?.model||'unknown',...(Number.isFinite(answer.usage?.inputTokens)&&Number.isFinite(answer.usage?.outputTokens)?{usage:{prompt_tokens:answer.usage.inputTokens,completion_tokens:answer.usage.outputTokens,total_tokens:answer.usage.inputTokens+answer.usage.outputTokens}}:{})};
  res.statusCode=200;res.setHeader('content-type',streamed?'text/event-stream; charset=utf-8':'application/json; charset=utf-8');res.setHeader('cache-control','no-store');
  if(streamed)res.end('data: '+JSON.stringify({...metadata,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:answer.text},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  else res.end(JSON.stringify({...metadata,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:answer.text},finish_reason:'stop'}],execution:answer.execution,memory:answer.memory}));
 }catch(error){if(res.destroyed||res.writableEnded)return;res.statusCode=409;res.setHeader('content-type','application/json; charset=utf-8');res.end(JSON.stringify({error:{code:/^(?:role_chat_|memory_|model_|catalog_|unsupported_|modality_)/.test(error.code)?error.code:'process_failed',message:locale==='zh-CN'?'本次没有返回有效回复，请重试。':'This request did not return a valid reply. Try again.'}}));}
 finally{req.removeListener('aborted',abort);res.removeListener('close',close);}
}
