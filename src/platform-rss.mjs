import {contentError} from './platform-catalog.mjs';
const unescape=value=>value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos);/g,value=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[value])).replace(/\s+/g,' ').trim();
const field=(source,name)=>{const found=source.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'));return found?unescape(found[1]):'';};
/** 订阅是真实RSS/Atom读取，不冒充本人账号推荐流；源地址只取本机保存配置。 */
export async function readContentSubscription(profile,{signal,fetchImpl=globalThis.fetch,maxBytes=1024*1024}={}){
 let url;try{url=new URL(profile.connection?.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash)throw Error();}catch{throw contentError('content_subscription_invalid');}
 const joined=AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])]);let response;
 try{response=await fetchImpl(url,{redirect:'error',credentials:'omit',headers:{accept:'application/rss+xml, application/atom+xml, application/xml, text/xml'},signal:joined});}catch{throw contentError(signal?.aborted?'content_cancelled':'content_subscription_unavailable');}
 if(!response.ok||Number(response.headers.get('content-length')||0)>maxBytes)throw contentError('content_subscription_unavailable');
 const reader=response.body?.getReader(),chunks=[];let length=0;
 if(!reader)throw contentError('content_subscription_invalid');
 try{for(;;){const value=await reader.read();if(value.done)break;length+=value.value.byteLength;if(length>maxBytes)throw contentError('content_response_too_large');chunks.push(value.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const xml=Buffer.concat(chunks).toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!/<(?:rss|feed)(?:\s|>)/i.test(xml))throw contentError('content_subscription_invalid');
 const items=[];for(const match of xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)){
  const body=match[2],link=field(body,'link')||body.match(/<link\s[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1]||'';
  items.push({title:field(body,'title'),url:link,text:field(body,'description')||field(body,'content')||field(body,'summary'),publishedAt:field(body,'pubDate')||field(body,'published')});
  if(items.length>=profile.budget.maxItems)break;
 }
 return{items,sourceType:'subscription',personalized:false};
}
