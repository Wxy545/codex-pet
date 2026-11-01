import {contentError} from './platform-catalog.mjs';

// 以下为独立协议实现，不复制SDK；真实账号/网络返回均未验证。
export const OVERSEAS_CONTENT_SOURCES=Object.freeze([
 'https://github.com/tweepy/tweepy/blob/c1978d643ecce491929084e4290b35f57e4921ad/tweepy/client.py',
 'https://github.com/praw-dev/praw/blob/b04c9fbc872f03846b117e4a3b055cdf4e12c457/praw/endpoints.py',
 'https://github.com/googleapis/google-api-python-client/blob/c1bdb24533614d6fcffeb7b9a93b2fc836c4e4e0/googleapiclient/discovery_cache/documents/youtube.v3.json',
 'https://developers.tiktok.com/doc/tiktok-api-v2-video-list/',
 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started/',
 'https://dev.twitch.tv/docs/chat/send-receive-messages/',
 'https://github.com/pinterest/api-description/blob/51aca009f10a90283ccdf3956d509fc995ebac23/v5/openapi.json',
]);
export const OVERSEAS_API_CAPABILITIES=Object.freeze({
 x:{actions:['feed','search','detail','comments','like','comment','publish','dm'],scope:'following-timeline',gaps:['algorithmic-recommendations','media-playback']},
 reddit:{actions:['feed','search','detail','comments','like','comment'],scope:'authorized-community',gaps:['media-playback']},
 youtube:{actions:['feed','search','detail','comments','subtitles','comment'],scope:'public-data-and-authorized-captions',gaps:['personalized-home-feed','media-playback']},
 tiktok:{actions:['feed','detail'],scope:'own-public-media',gaps:['personalized-recommendations','search','comments','media-playback']},
 instagram:{actions:['feed','detail','comments','comment'],scope:'own-professional-media',gaps:['personal-home-feed','reels-recommendations','media-playback']},
 pinterest:{actions:['feed','search','detail'],scope:'own-or-shared-board-pins',gaps:['personalized-recommendations','comments','save-pin','media-playback']},
 'youtube-live':{actions:['detail','events','comment'],scope:'authorized-live-chat',gaps:['media-playback','broadcast']},
 twitch:{actions:['feed','detail','events','comment'],scope:'authorized-live-channel',gaps:['media-playback','broadcast']},
});
const failure=code=>{throw contentError(code);},record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const itemId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value);
const numeric=value=>typeof value==='string'&&/^\d{1,32}$/.test(value);
const required=(value,rule=itemId)=>rule(value)?value:failure('content_parameter_missing');
const count=input=>Math.max(1,Math.min(Number.isInteger(input.count)?input.count:5,50));
const plain=value=>typeof value==='string'?value.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').slice(0,24000):'';
async function bodyOf(response,{signal,maxBytes=2*1024*1024}={}){if(Number(response.headers.get('content-length')||0)>maxBytes)failure('content_response_too_large');const reader=response.body?.getReader();if(!reader)return'';let size=0;const parts=[];try{for(;;){if(signal.aborted)failure('content_cancelled');const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>maxBytes)failure('content_response_too_large');parts.push(part.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}return Buffer.concat(parts).toString('utf8');}

/** 固定官方源与参数路由；外部返回的URL、正文和分页地址从不成为下一次任意请求。 */
export async function callOverseasContent({platform,action,input={},account={},signal,fetchImpl=globalThis.fetch,webSocketFactory=url=>new WebSocket(url)}={}){
 const capability=OVERSEAS_API_CAPABILITIES[platform];if(!capability?.actions.includes(action))failure('content_action_unsupported');
 const joined=AbortSignal.any([AbortSignal.timeout(120000),...(signal?[signal]:[])]);let requests=0;
 for(const key of ['accessToken','apiKey','clientId','userId','boardId','subreddit','apiVersion'])if(account[key]!==undefined&&(typeof account[key]!=='string'||account[key].length>8192||/[\u0000-\u0020\u007f]/.test(account[key])))failure('content_account_invalid');
 const bearer=()=>{if(!account.accessToken)failure('content_auth_required');return{Authorization:'Bearer '+account.accessToken};};
 async function request(origin,path,{query={},method='GET',body,form,headers={},text=false}={}){
  if(joined.aborted)failure(signal?.aborted?'content_cancelled':'content_timeout');if(++requests>8)failure('content_tool_budget');
  const url=new URL(path,origin);if(url.origin!==origin||url.username||url.password)failure('content_url_invalid');for(const[key,value]of Object.entries(query))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));
  let response;try{response=await fetchImpl(url,{method,redirect:'error',credentials:'omit',signal:joined,headers:{accept:text?'text/vtt':'application/json',...headers,...(body?{'content-type':'application/json'}:{}),...(form?{'content-type':'application/x-www-form-urlencoded'}:{})},...(body?{body:JSON.stringify(body)}:form?{body:new URLSearchParams(form).toString()}:{})});}catch{failure(joined.aborted?(signal?.aborted?'content_cancelled':'content_timeout'):'content_platform_unavailable');}
  if(!response.ok)failure(response.status===401||response.status===403?'content_auth_required':response.status===429?'content_platform_limited':'content_platform_unavailable');
  const raw=await bodyOf(response,{signal:joined});if(text)return raw;let parsed;try{parsed=JSON.parse(raw);}catch{failure('content_response_invalid');}if(parsed?.error&&parsed.error.code!=='ok'||parsed?.errors?.length&&!parsed.data)failure('content_platform_unavailable');return parsed;
 }
 const items=value=>({structuredContent:{items:value,scope:capability.scope,personalized:false,verification:'not-verified',apiRequests:requests}});
 const acknowledged=(value,valid)=>{if(!valid)failure('content_delivery_uncertain');return{structuredContent:{confirmed:true,operation:action,verification:'not-verified',apiRequests:requests}};};
 if(platform==='x'){
  const auth=bearer(),origin='https://api.x.com';let response;
  if(action==='feed')response=await request(origin,'/2/users/'+required(account.userId,numeric)+'/timelines/reverse_chronological',{headers:auth,query:{max_results:Math.max(10,count(input)),'tweet.fields':'text,author_id,created_at'}});
  else if(['search','comments'].includes(action))response=await request(origin,'/2/tweets/search/recent',{headers:auth,query:{query:action==='comments'?'conversation_id:'+required(input.itemId,numeric)+' -is:retweet':required(input.query,value=>typeof value==='string'&&value.length>0&&value.length<=512),max_results:Math.max(10,count(input)),'tweet.fields':'text,author_id,created_at'}});
  else if(action==='detail')response=await request(origin,'/2/tweets/'+required(input.itemId,numeric),{headers:auth,query:{'tweet.fields':'text,author_id,created_at'}});
  else if(action==='like'){response=await request(origin,'/2/users/'+required(account.userId,numeric)+'/likes',{method:'POST',headers:auth,body:{tweet_id:required(input.itemId,numeric)}});return acknowledged(response,response.data?.liked===true);}
  else if(action==='comment'||action==='publish'){response=await request(origin,'/2/tweets',{method:'POST',headers:auth,body:{text:required(input.text,value=>typeof value==='string'&&value.length>0&&value.length<=280),...(action==='comment'?{reply:{in_reply_to_tweet_id:required(input.itemId,numeric)}}:{})}});const result=acknowledged(response,numeric(response.data?.id));result.structuredContent.items=[{id:response.data.id,url:'https://x.com/i/web/status/'+response.data.id,text:input.text}];return result;}
  else{response=await request(origin,'/2/dm_conversations/with/'+required(input.recipient,numeric)+'/messages',{method:'POST',headers:auth,body:{text:required(input.text,value=>typeof value==='string'&&value.length>0&&value.length<=10000)}});return acknowledged(response,!!response.data?.dm_event_id);}
  return items((Array.isArray(response.data)?response.data:response.data?[response.data]:[]).slice(0,count(input)).map(row=>({id:row.id,text:row.text,url:'https://x.com/i/web/status/'+row.id})));
 }
 if(platform==='reddit'){
  const auth={...bearer(),'User-Agent':'desktop:codex-pet-content:1.0 (local user application)'},origin='https://oauth.reddit.com',subreddit=account.subreddit||'all';required(subreddit,value=>/^[A-Za-z0-9_]{2,32}$/.test(value));let response;
  if(action==='feed')response=await request(origin,'/r/'+subreddit+'/hot',{headers:auth,query:{limit:count(input),raw_json:1}});
  else if(action==='search')response=await request(origin,'/r/'+subreddit+'/search',{headers:auth,query:{q:required(input.query,value=>typeof value==='string'&&value.length>0&&value.length<=512),restrict_sr:true,limit:count(input),raw_json:1}});
  else if(action==='like'){response=await request(origin,'/api/vote',{method:'POST',headers:auth,form:{id:'t3_'+required(input.itemId,value=>/^[a-z0-9]{1,16}$/.test(value)),dir:'1'}});return acknowledged(response,record(response)&&!response.error);}
  else if(action==='comment'){response=await request(origin,'/api/comment',{method:'POST',headers:auth,form:{api_type:'json',thing_id:'t3_'+required(input.itemId,value=>/^[a-z0-9]{1,16}$/.test(value)),text:required(input.text,value=>typeof value==='string'&&value.length>0&&value.length<=10000)}});return acknowledged(response,Array.isArray(response.json?.errors)&&!response.json.errors.length&&response.json?.data?.things?.length>0);}
  else response=await request(origin,'/comments/'+required(input.itemId,value=>/^[a-z0-9]{1,16}$/.test(value)),{headers:auth,query:{limit:count(input),depth:1,raw_json:1}});
  const listings=Array.isArray(response)?response:[response],rows=listings.flatMap(list=>list.data?.children||[]).filter(row=>['t1','t3'].includes(row.kind)).slice(0,count(input));
  return items(rows.map(({data:row,kind})=>({id:row.id,title:row.title,text:plain(row.selftext??row.body),url:row.permalink?'https://www.reddit.com'+row.permalink:input.url,...(kind==='t1'?{comments:[plain(row.body)]}:{})})));
 }
 if(platform==='youtube'||platform==='youtube-live'){
  const origin='https://youtube.googleapis.com',auth=account.accessToken?bearer():{},query=account.apiKey?{key:account.apiKey}:{};if(!account.apiKey&&!account.accessToken)failure('content_auth_required');const api=(path,options={})=>request(origin,'/youtube/v3/'+path,{...options,query:{...query,...options.query},headers:auth});
  const videoId=()=>required(input.itemId,value=>typeof value==='string'&&/^[A-Za-z0-9_-]{11}$/.test(value)),shape=rows=>rows.map(row=>({id:typeof row.id==='string'?row.id:row.id?.videoId,title:row.snippet?.title,text:row.snippet?.description,url:'https://www.youtube.com/watch?v='+(typeof row.id==='string'?row.id:row.id?.videoId),images:[row.snippet?.thumbnails?.medium?.url].filter(Boolean)}));let response;
  if(action==='feed'){response=await api('videos',{query:{part:'snippet,contentDetails',chart:'mostPopular',maxResults:count(input)}});return items(shape(response.items||[]));}
  if(action==='search'){response=await api('search',{query:{part:'snippet',type:'video',q:required(input.query,value=>typeof value==='string'&&value.length>0&&value.length<=512),maxResults:count(input)}});return items(shape(response.items||[]));}
  if(action==='detail'){response=await api('videos',{query:{part:'snippet,contentDetails,liveStreamingDetails',id:videoId()}});return items(shape(response.items||[]));}
  if(action==='comments'){response=await api('commentThreads',{query:{part:'snippet',videoId:videoId(),maxResults:count(input),textFormat:'plainText'}});return items([{url:'https://www.youtube.com/watch?v='+input.itemId,comments:(response.items||[]).map(row=>row.snippet?.topLevelComment?.snippet?.textDisplay||'')}]);}
  if(action==='subtitles'){if(!account.accessToken)failure('content_auth_required');response=await api('captions',{query:{part:'snippet',videoId:videoId()}});const track=(response.items||[]).find(row=>row.snippet?.status==='serving'&&!row.snippet?.isDraft);if(!track)return items([]);const captions=await api('captions/'+required(track.id),{query:{tfmt:'vtt'},text:true});return items([{id:input.itemId,url:'https://www.youtube.com/watch?v='+input.itemId,subtitles:captions}]);}
  if(action==='comment'&&platform==='youtube'){response=await api('commentThreads',{method:'POST',query:{part:'snippet'},body:{snippet:{videoId:videoId(),topLevelComment:{snippet:{textOriginal:required(input.text,value=>typeof value==='string'&&value.length>0&&value.length<=10000)}}}}});return acknowledged(response,!!response.id);}
  let chatId=input.roomId;if(!chatId){response=await api('videos',{query:{part:'liveStreamingDetails',id:videoId()}});chatId=response.items?.[0]?.liveStreamingDetails?.activeLiveChatId;}required(chatId);
  if(action==='events'){response=await api('liveChat/messages',{query:{part:'snippet,authorDetails',liveChatId:chatId,maxResults:200}});return items([{url:input.url||(input.itemId?'https://www.youtube.com/watch?v='+input.itemId:undefined),comments:(response.items||[]).slice(0,count(input)).map(row=>row.snippet?.displayMessage||''),pollingIntervalMillis:response.pollingIntervalMillis}]);}
  response=await api('liveChat/messages',{method:'POST',query:{part:'snippet'},body:{snippet:{liveChatId:chatId,type:'textMessageEvent',textMessageDetails:{messageText:required(input.text,value=>typeof value==='string'&&value.length>0&&value.length<=200)}}}});return acknowledged(response,!!response.id);
 }
 if(platform==='tiktok'){
  const fields='id,title,video_description,duration,cover_image_url,share_url',response=await request('https://open.tiktokapis.com',action==='feed'?'/v2/video/list/':'/v2/video/query/',{method:'POST',headers:bearer(),query:{fields},body:action==='feed'?{max_count:Math.min(20,count(input))}:{filters:{video_ids:[required(input.itemId,numeric)]}}});
  if(response.error?.code&&response.error.code!=='ok')failure('content_platform_unavailable');return items((response.data?.videos||[]).slice(0,count(input)).map(row=>({id:row.id,title:row.title,text:row.video_description,url:row.share_url,images:[row.cover_image_url].filter(Boolean),duration:row.duration})));
 }
 if(platform==='instagram'){
  const version=account.apiVersion||'v26.0';required(version,value=>/^v\d{2}\.0$/.test(value));const selected=action==='feed'?required(account.userId,numeric)+'/media':required(input.itemId,numeric)+(action==='comments'||action==='comment'?'/comments':'');
  bearer();const response=await request('https://graph.instagram.com','/'+version+'/'+selected,{...(action==='comment'?{method:'POST',query:{access_token:account.accessToken},form:{message:required(input.text,value=>typeof value==='string'&&value.length>0&&value.length<=2200)}}:{query:{access_token:account.accessToken,fields:action==='comments'?'id,text,timestamp':'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',limit:count(input)}})});
  if(action==='comment')return acknowledged(response,numeric(response.id));return items((Array.isArray(response.data)?response.data:[response]).slice(0,count(input)).map(row=>({id:row.id,text:row.caption??row.text,url:row.permalink??input.url,images:[row.media_type==='IMAGE'?row.media_url:row.thumbnail_url].filter(Boolean)})));
 }
 if(platform==='pinterest'){
  const response=await request('https://api.pinterest.com',action==='feed'?'/v5/boards/'+required(account.boardId,numeric)+'/pins':action==='detail'?'/v5/pins/'+required(input.itemId,numeric):'/v5/search/pins',{headers:bearer(),query:action==='feed'?{page_size:count(input)}:action==='search'?{query:required(input.query,value=>typeof value==='string'&&value.length>0&&value.length<=512)}:{}});
  return items((Array.isArray(response.items)?response.items:[response]).slice(0,count(input)).map(row=>({id:row.id,title:row.title,text:row.description,url:numeric(row.id)?'https://www.pinterest.com/pin/'+row.id+'/':input.url,images:[row.media?.images?.['600x']?.url??row.media?.images?.['400x300']?.url].filter(Boolean)})));
 }
 if(platform==='twitch'){
  const auth={...bearer(),'Client-Id':required(account.clientId)},origin='https://api.twitch.tv',room=()=>required(input.roomId||account.userId,numeric);let response;
  if(action==='feed'||action==='detail'){response=await request(origin,'/helix/streams',{headers:auth,query:{...(action==='detail'?{user_id:room()}:{}),first:count(input)}});return items((response.data||[]).map(row=>({id:row.id,title:row.title,text:row.game_name,url:'https://www.twitch.tv/'+row.user_login})));}
  if(action==='comment'){response=await request(origin,'/helix/chat/messages',{method:'POST',headers:auth,body:{broadcaster_id:room(),sender_id:required(account.userId,numeric),message:required(input.text,value=>typeof value==='string'&&value.length>0&&value.length<=500)}});return acknowledged(response,response.data?.[0]?.is_sent===true);}
  const events=await twitchEvents({roomId:room(),userId:required(account.userId,numeric),count:count(input),seconds:Math.min(120,input.mediaSeconds||30),signal:joined,request:body=>request(origin,'/helix/eventsub/subscriptions',{method:'POST',headers:auth,body}),webSocketFactory});return items([{url:input.url,comments:events}]);
 }
 failure('content_action_unsupported');
}

async function twitchEvents({roomId,userId,count,seconds,signal,request,webSocketFactory}){
 return new Promise((resolve,reject)=>{let done=false,ready=false,subscribing=false;const messages=[],seen=new Set(),socket=webSocketFactory('wss://eventsub.wss.twitch.tv/ws');
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);try{socket.close();}catch{}error?reject(contentError(error)):resolve(messages);};
  const abort=()=>finish('content_cancelled'),timer=setTimeout(()=>finish(ready?null:'content_platform_unavailable'),seconds*1000);signal.addEventListener('abort',abort,{once:true});
  const listen=(name,handler)=>typeof socket.addEventListener==='function'?socket.addEventListener(name,handler):socket.on(name,handler);
  listen('message',async event=>{if(done)return;const raw=typeof event?.data==='string'?event.data:Buffer.isBuffer(event?.data)?event.data.toString('utf8'):typeof event==='string'?event:'';if(Buffer.byteLength(raw)>256*1024){finish('content_response_too_large');return;}let frame;try{frame=JSON.parse(raw);}catch{finish('content_response_invalid');return;}
   const type=frame.metadata?.message_type;if(type==='session_welcome'&&!subscribing){subscribing=true;const session=frame.payload?.session?.id;if(!itemId(session)){finish('content_response_invalid');return;}try{const response=await request({type:'channel.chat.message',version:'1',condition:{broadcaster_user_id:roomId,user_id:userId},transport:{method:'websocket',session_id:session}});if(!response.data?.length){finish('content_auth_required');return;}ready=true;}catch(error){finish(error.code||'content_platform_unavailable');}}
   else if(type==='notification'){const id=frame.metadata?.message_id,text=frame.payload?.event?.message?.text;if(!ready||frame.payload?.subscription?.type!=='channel.chat.message'||frame.payload?.event?.broadcaster_user_id!==roomId||typeof id!=='string'||seen.has(id)||typeof text!=='string')return;seen.add(id);messages.push(text.slice(0,2000));if(messages.length>=count)finish();}
   else if(['revocation','session_reconnect'].includes(type))finish('content_platform_unavailable');
  });listen('error',()=>finish('content_platform_unavailable'));listen('close',()=>{if(!done)finish('content_platform_unavailable');});if(signal.aborted)abort();
 });
}
