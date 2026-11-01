import {createHash} from 'node:crypto';

export const CONTENT_OPERATIONS=Object.freeze(['read','like','comment','dm','publish','broadcast']);
export const contentError=code=>Object.assign(new Error(code),{code});
const action=(operation,tool=null,args={})=>({operation,tool,args});
const reads={feed:action('read'),search:action('read'),detail:action('read'),comments:action('read')};
// 仅登记有语义的操作；账号登录、文件与任意命令不属于内容工具目录。
const definitions=[
 {id:'weibo',name:'微博',region:'domestic',kind:'posts',domains:['weibo.com','weibo.cn','sinaimg.cn'],actions:{feed:action('read','get_feeds',{uid:'$recipient',limit:'$count'}),trending:action('read','get_trendings',{limit:'$count'}),search:action('read','search_content',{keyword:'$query',limit:'$count',page:1}),comments:action('read','get_comments',{feed_id:'$itemId',page:1})}},
 {id:'tieba',name:'贴吧',region:'domestic',kind:'posts',domains:['tieba.baidu.com'],actions:{...reads}},
 {id:'bilibili',name:'B站',region:'domestic',kind:'video',domains:['bilibili.com','b23.tv','hdslb.com'],actions:{feed:action('read','bili_recommend',{ps:'$count'}),search:action('read','bili_search',{keyword:'$query',num:'$count'}),detail:action('read','bili_video_info',{bvid:'$itemId'}),comments:action('read','bili_comments',{bvid:'$itemId',num:'$count'}),subtitles:action('read','bili_subtitle',{bvid:'$itemId'}),frames:action('read','bili_frames',{bvid:'$itemId',num:'$frames'}),cover:action('read','bili_cover',{bvid:'$itemId'}),comment:action('comment','bili_reply',{bvid:'$itemId',text:'$text'}),dm:action('dm','bili_send_message',{receiver_uid:'$recipient',text:'$text'})}},
 {id:'douyin',name:'抖音',region:'domestic',kind:'short-video',domains:['douyin.com','iesdouyin.com','douyinvod.com','byteimg.com'],actions:{feed:action('read','douyin_feed',{num:'$count',scrolls:2,skip_live:true}),search:action('read','douyin_search',{keyword:'$query',num:'$count'}),detail:action('read','douyin_video',{aweme_id:'$itemId'}),comments:action('read','douyin_comments',{aweme_id:'$itemId',num:'$count'}),watch:action('read','douyin_watch',{aweme_id:'$itemId',seconds:'$mediaSeconds',frames:'$frames'}),like:action('like','douyin_like',{aweme_id:'$itemId',undo:false}),comment:action('comment','douyin_comment',{aweme_id:'$itemId',text:'$text'}),dm:action('dm','douyin_chat_send',{nickname:'$recipient',text:'$text'})}},
 {id:'xiaohongshu',name:'小红书',region:'domestic',kind:'community',domains:['xiaohongshu.com','xhslink.com','xhscdn.com'],actions:{feed:action('read','list_feeds'),search:action('read','search_feeds',{keyword:'$query'}),detail:action('read','get_feed_detail',{feed_id:'$itemId',xsec_token:'$itemToken',load_all_comments:false}),like:action('like','like_feed',{feed_id:'$itemId',xsec_token:'$itemToken',unlike:false}),comment:action('comment','post_comment_to_feed',{feed_id:'$itemId',xsec_token:'$itemToken',content:'$text'})}},
 {id:'bilibili-live',name:'B站直播',region:'domestic',kind:'live',domains:['live.bilibili.com','bilibili.com'],actions:{watch:action('read'),events:action('read'),comment:action('comment')}},
 {id:'douyin-live',name:'抖音直播',region:'domestic',kind:'live',domains:['live.douyin.com','douyin.com'],actions:{watch:action('read'),events:action('read'),comment:action('comment')}},
 {id:'obs',name:'OBS',region:'shared',kind:'broadcast',domains:[],actions:{status:action('read'),start:action('broadcast'),stop:action('broadcast')}},
 ...[
  ['x','X','posts',['x.com','twitter.com','twimg.com']],['reddit','Reddit','posts',['reddit.com','redd.it','redditmedia.com']],
  ['youtube','YouTube','video',['youtube.com','youtu.be','ytimg.com']],['tiktok','TikTok','short-video',['tiktok.com','tiktokcdn.com']],
  ['instagram','Instagram','community',['instagram.com','cdninstagram.com']],['lemon8','Lemon8','community',['lemon8-app.com']],
  ['pinterest','Pinterest','community',['pinterest.com','pinimg.com']],['facebook','Facebook','community',['facebook.com','fbcdn.net']],
  ['twitch','Twitch','live',['twitch.tv','ttvnw.net']],['youtube-live','YouTube Live','live',['youtube.com','youtu.be']],['tiktok-live','TikTok LIVE','live',['tiktok.com','tiktokcdn.com']],
 ].map(([id,name,kind,domains])=>({id,name,region:'overseas',kind,domains,actions:kind==='live'?{feed:action('read'),detail:action('read'),watch:action('read'),events:action('read'),comment:action('comment')}:{...reads,...(kind==='video'||kind==='short-video'?{subtitles:action('read'),watch:action('read')}:{}),...(['x','reddit'].includes(id)?{like:action('like')}:{}),...(['x','reddit','youtube','instagram'].includes(id)?{comment:action('comment')}:{}),...(id==='x'?{dm:action('dm'),publish:action('publish')}:{})}})),
];
const byId=new Map(definitions.map(row=>[row.id,Object.freeze(row)]));
const knownToolOperations=new Map(definitions.flatMap(row=>Object.values(row.actions).filter(action=>action.tool).map(action=>[action.tool,action.operation])));
export const CONTENT_ADAPTER_SOURCES=Object.freeze([
 {platform:'weibo',repository:'qinyuanpei/mcp-server-weibo',commit:'a98f61159004442d342e02099db5c57e4cd24755',license:'MIT',file:'src/mcp_server_weibo/server.py'},
 {platform:'bilibili',repository:'c1overzz/dsh-bili-scroll',commit:'398e4724a481b09b6383a950bcd08723c632da59',license:'MIT',file:'vendor/bilibili-mcp/mcp_server.py'},
 {platform:'douyin',repository:'kdcadmin/dsh_douyin_tools',commit:'aaf9f9a862afafd45a15acf32789da97688de695',license:'MIT',file:'vendor/douyin-mcp/mcp_server.py'},
 {platform:'xiaohongshu',repository:'xpzouying/xiaohongshu-mcp',commit:'7797fd375aba02dcd33afe143f6bee13e5870859',license:'Apache-2.0',file:'mcp_server.go'},
]);
export function contentPlatform(id){const row=byId.get(id);if(!row)throw contentError('platform_unsupported');return row;}
export function contentPlatforms(){return definitions.map(row=>({id:row.id,name:row.name,region:row.region,kind:row.kind,verification:row.region==='overseas'?'not-verified':'not-configured',actions:Object.entries(row.actions).map(([id,value])=>({id,operation:value.operation,defaultTool:value.tool,arguments:structuredClone(value.args)}))}));}
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const parameter=/^(?:query|itemId|itemToken|url|roomId|recipient|text|count|mediaSeconds|frames)$/;
export const contentToolName=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,159}$/.test(value)&&!/(?:^|[_:.\/-])(?:shell|exec|bash|powershell|memory|filesystem|login|cookies?|credentials?|browser|computer|desktop|evaluate|javascript|playwright|cdp|automation|screenshot|click|navigate)(?:[_:.\/-]|$)/i.test(value);
export const contentArgumentName=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)&&!/^(?:command|script|code|expression|file|filename|filepath|file_path|path|cwd|root|env|headers|http_headers)$/i.test(value);

/** 参数模板仅替换固定语义字段，不执行脚本、路径、表达式或模型生成的工具名。 */
export function contentToolRequest(profile,name,input={}){
 const platform=contentPlatform(profile.platform),definition=platform.actions[name];
 if(!definition||!plain(input)||Object.keys(input).some(key=>!parameter.test(key)))throw contentError('content_action_invalid');
 if(input.url!==undefined&&!publicContentUrl(input.url,profile.platform))throw contentError('content_url_invalid');
 if(input.itemId!==undefined&&({bilibili:/^BV[A-Za-z0-9]{10}$/,douyin:/^\d{8,24}$/,xiaohongshu:/^[a-f0-9]{24}$/}[profile.platform])&&!({bilibili:/^BV[A-Za-z0-9]{10}$/,douyin:/^\d{8,24}$/,xiaohongshu:/^[a-f0-9]{24}$/}[profile.platform]).test(String(input.itemId)))throw contentError('content_input_invalid');
 const binding=profile.bindings?.[name],tool=binding?.tool??definition.tool,args=binding?.arguments??definition.args;
 if(!contentToolName(tool))throw contentError('content_tool_unconfigured');
 if(knownToolOperations.has(tool)&&knownToolOperations.get(tool)!==definition.operation)throw contentError('content_binding_invalid');
 if(!plain(args)||Object.keys(args).length>32)throw contentError('content_binding_invalid');
 const values={...input,count:Math.min(Number.isInteger(input.count)?input.count:profile.budget.maxItems,profile.budget.maxItems),mediaSeconds:Math.min(Number.isInteger(input.mediaSeconds)?input.mediaSeconds:profile.budget.mediaSeconds,profile.budget.mediaSeconds),frames:Math.min(Number.isInteger(input.frames)?input.frames:profile.budget.maxFrames,profile.budget.maxFrames)};
 if(values.count<1||values.mediaSeconds<1||values.frames<1)throw contentError('content_input_invalid');
 const mapped={};for(const [key,value]of Object.entries(args)){
  if(!contentArgumentName(key))throw contentError('content_binding_invalid');
  if(typeof value==='string'&&value.startsWith('$')){const field=value.slice(1);if(!parameter.test(field)||values[field]===undefined||values[field]==='')throw contentError('content_parameter_missing');mapped[key]=values[field];}
  else if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=2048)mapped[key]=value;
  else throw contentError('content_binding_invalid');
 }
 if(Object.values(mapped).some(value=>typeof value==='string'&&(value.length>12000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))))throw contentError('content_input_invalid');
 return{operation:definition.operation,tool,arguments:mapped};
}

export function publicContentUrl(value,platformId){
 if(typeof value!=='string'||value.length>8192)return null;
 try{const url=new URL(value),row=contentPlatform(platformId);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!row.domains.some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain)))return null;url.hash='';for(const key of [...url.searchParams.keys()])if(/token|key|auth|signature|sign|cookie|credential|password|session/i.test(key))url.searchParams.delete(key);return url.href;}catch{return null;}
}
const text=value=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,100000):'';
const digest=value=>createHash('sha256').update(value).digest('hex');
function unpack(response){
 const envelope=response?.result??response,content=Array.isArray(envelope?.content)?envelope.content:[];let parsed=envelope?.structuredContent??envelope;
 const blocks=content.filter(value=>value?.type==='text'&&typeof value.text==='string').map(value=>value.text);
 if(blocks.length){const raw=blocks.join('\n');try{parsed=JSON.parse(raw);}catch{parsed={text:raw};}}
 if(typeof parsed==='string')try{parsed=JSON.parse(parsed);}catch{parsed={text:parsed};}
 if(envelope?.isError===true||parsed?.ok===false||parsed?.error)throw contentError('content_tool_failed');
 if(parsed?.data&&typeof parsed.data==='object')parsed=parsed.data;
 return{content,parsed};
}
const candidateItems=parsed=>Array.isArray(parsed)?parsed:['items','videos','feeds','Feeds','posts','entries'].map(key=>parsed?.[key]).find(Array.isArray)??[parsed];
/** 仅在当前读取回合内保留后续取详情所需的ID与短期令牌，不进入状态、索引或产物。 */
export function contentTargets(response,platform,maxItems=5){
 const {parsed}=unpack(response),rows=candidateItems(parsed),result=[];
 for(const row of (Array.isArray(rows)?rows:[]).slice(0,maxItems)){
  const item=row?.note??row?.note_card??row?.noteCard??row,id=row?.bvid??row?.aweme_id??row?.feed_id??row?.id??item?.id;
  const rule={weibo:/^\d{8,24}$/,bilibili:/^BV[A-Za-z0-9]{10}$/,douyin:/^\d{8,24}$/,xiaohongshu:/^[a-f0-9]{24}$/,x:/^\d{1,32}$/,reddit:/^[a-z0-9]{1,16}$/,youtube:/^[A-Za-z0-9_-]{11}$/,tiktok:/^\d{1,32}$/,instagram:/^\d{1,32}$/,pinterest:/^\d{1,32}$/}[platform];
  if(!rule||!rule.test(String(id??'')))continue;
  const token=row?.xsecToken??row?.xsec_token,itemToken=typeof token==='string'&&token.length<2048&&!/[\u0000-\u001f]/.test(token)?token:undefined;
  const url=sourceUrl(row,platform,{itemId:id});result.push({itemId:String(id),sourceId:url?'source-'+digest(url).slice(0,24):null,...(url?{url}:{}),...(itemToken?{itemToken}:{})});
 }
 return result;
}
function sourceUrl(item,platform,input){
 for(const key of ['url','link','permalink','share_url','shareUrl']){const found=publicContentUrl(item?.[key],platform);if(found)return found;}
 const id=item?.bvid??item?.aweme_id??item?.feed_id??item?.id??item?.note?.id??input?.itemId;
 if(platform==='weibo'&&/^\d{8,24}$/.test(String(id??'')))return'https://m.weibo.cn/status/'+id;
 if(platform==='bilibili'&&/^BV[A-Za-z0-9]{10}$/.test(String(id??'')))return'https://www.bilibili.com/video/'+id;
 if(platform==='douyin'&&/^\d{8,24}$/.test(String(id??'')))return'https://www.douyin.com/video/'+id;
 if(platform==='xiaohongshu'&&/^[a-f0-9]{24}$/.test(String(id??'')))return'https://www.xiaohongshu.com/explore/'+id;
 return publicContentUrl(input?.url,platform);
}

/** 所有正文均为不可信素材；不保留工具端的cookie、登录状态、header或本机路径字段。 */
export function normalizeContentMaterials(response,{platform,action:operation,input={},maxItems=10,maxChars=24000}={}){
 const {content,parsed}=unpack(response),materials=[],sources=[],candidates=candidateItems(parsed);
 let available=Math.max(0,maxChars);
 const add=(kind,value,sourceId=null)=>{const body=text(value).slice(0,available);if(!body)return;available-=body.length;materials.push({id:'material-'+digest(kind+'\0'+body).slice(0,24),kind,text:body,sourceId,untrusted:true});};
 for(const row of (Array.isArray(candidates)?candidates:[candidates]).slice(0,maxItems)){
  if(!row||typeof row!=='object')continue;const item=row.note??row.note_card??row.noteCard??row;
  const url=sourceUrl(row,platform,input),title=text(item.title??item.display_title??item.displayTitle??item.desc??'').slice(0,300),id=url?'source-'+digest(url).slice(0,24):null;
  if(url&&!sources.some(value=>value.id===id))sources.push({id,url,title,platform});
  const body=[title,text(item.text??item.description??item.content??item.body??item.desc)].filter(Boolean).join('\n');
  if(body)add(operation==='subtitles'?'subtitles':operation==='comments'||operation==='events'?'comments':'text',body,id);
  for(const key of ['transcript','subtitle','subtitles','captions'])if(typeof item[key]==='string')add(key==='transcript'?'transcript':'subtitles',item[key],id);else if(Array.isArray(item[key]))add(key==='transcript'?'transcript':'subtitles',item[key].map(row=>typeof row==='string'?row:text(row?.text??row?.content??row?.caption)).join('\n'),id);
  const comments=Array.isArray(row.comments)?row.comments:row.comments?.list??item.comments;
  if(Array.isArray(comments))add('comments',comments.slice(0,maxItems).map(row=>typeof row==='string'?row:text(row.content??row.text??row.message)).join('\n'),id);
  for(const key of ['images','frames','covers','imageList','image_list','pics'])if(Array.isArray(item[key]))for(const image of item[key].slice(0,12)){const imageUrl=publicContentUrl(typeof image==='string'?image:image?.url??image?.urlDefault??image?.url_default??image?.large,platform);if(imageUrl)materials.push({id:'material-'+digest(imageUrl).slice(0,24),kind:'image-reference',url:imageUrl,sourceId:id,untrusted:true});}
 }
 // MCP图片携带真实像素；URL引用与已交给模型的图像要分开登记。
 for(const block of content)if(['image','audio'].includes(block?.type)&&typeof block.data==='string'&&block.data.length<=2*1024*1024&&/^[A-Za-z0-9+/]*={0,2}$/.test(block.data)&&typeof block.mimeType==='string'&&/^(?:image\/(?:png|jpeg|webp)|audio\/(?:wav|mpeg|ogg))$/.test(block.mimeType)){
  const bytes=Buffer.from(block.data,'base64'),magic=block.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):block.mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:block.mimeType==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':block.mimeType==='audio/wav'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE':block.mimeType==='audio/ogg'?bytes.toString('ascii',0,4)==='OggS':bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224;
  if(magic)materials.push({id:'material-'+digest(block.data).slice(0,24),kind:block.type,data:block.data,mimeType:block.mimeType,sourceId:sources[0]?.id??null,untrusted:true});
 }
 if(!sources.length){const url=publicContentUrl(input.url,platform);if(url)sources.push({id:'source-'+digest(url).slice(0,24),url,title:'',platform});}
 const ranges=Array.isArray(parsed?.sampledRanges)?parsed.sampledRanges.filter(row=>Array.isArray(row)&&row.length===2&&row.every(Number.isFinite)&&row[0]>=0&&row[1]>=row[0]).slice(0,20):[];
 const timestamps=Array.isArray(parsed?.sampleTimestamps)?parsed.sampleTimestamps.filter(value=>Number.isFinite(value)&&value>=0).slice(0,40):[];
 return{sources,materials:materials.slice(0,40),sourceState:sources.length?'available':'unavailable',materialKinds:[...new Set(materials.map(value=>value.kind))],action:operation,mediaEvidence:{durationSeconds:Number.isFinite(parsed?.duration)&&parsed.duration>=0?parsed.duration:null,requestedSeconds:Number.isFinite(parsed?.requestedSeconds)&&parsed.requestedSeconds>=0?parsed.requestedSeconds:null,sampledRanges:ranges,sampleTimestamps:timestamps,frameCount:Number.isInteger(parsed?.frameCount)&&parsed.frameCount>=0?parsed.frameCount:null,audioProvided:typeof parsed?.audioProvided==='boolean'?parsed.audioProvided:null,partial:typeof parsed?.partial==='boolean'?parsed.partial:null}};
}
