import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,symlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {createContentActivityService} from '../src/content-activity.mjs';
import {contentToolRequest,normalizeContentMaterials,contentPlatforms} from '../src/platform-catalog.mjs';
import {createContentMcpClient} from '../src/platform-mcp.mjs';
import {callContentObs} from '../src/platform-obs.mjs';

const video={bvid:'BV1uNk1YxEJQ',title:'测试素材',url:'https://www.bilibili.com/video/BV1uNk1YxEJQ',text:'这是一段来源正文',transcript:'这里是字幕',comments:[{text:'合成评论'}]};
async function fixture(t,options={}){
 const root=await mkdtemp(join(tmpdir(),'pet-content-'));let calls=[];
 const service=await createContentActivityService({dataRoot:root,scheduler:false,callPlatformTool:async request=>{calls.push(request);return{structuredContent:{videos:[video]}};},...options});
 t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true});});
 const save=async(value={})=>{await service.configure({action:'save-profile',profile:{platform:'bilibili',host:'codex',label:'内容活动',enabled:true,serverId:'mcp-synthetic',revision:'revision-1',...value}});return service.state().profiles.at(-1);};
 return{root,service,save,calls};
}

test('未绑定保持unconfigured；默认调度和对外写关闭，状态不包含原文或执行器URL',async t=>{
 const f=await fixture(t),profile=await f.save({serverId:null,revision:null});
 assert.equal(profile.state,'unconfigured');assert.equal(profile.schedule.enabled,false);assert.equal(profile.allowedOperations.read,true);assert.equal(profile.allowedOperations.comment,false);
 await assert.rejects(f.service.start({profileId:profile.id}),{code:'content_tool_unconfigured'});assert.equal(f.calls.length,0);
});

test('真实语义工具参数、受限分析及私有产物闭环，模型事实只采信宿主来源',async t=>{
 let received;
 const f=await fixture(t,{analyze:async value=>{received=value;return{text:'合成分析',actualModel:{id:'gpt-synthetic',source:'host-response'},requestedModel:'requested',materialIdsUsed:value.materials.map(x=>x.id)};}}),p=await f.save();
 const job=await f.service.start({profileId:p.id,action:'feed',requestId:'message-1'});await f.service.idle();
 assert.equal(f.calls[0].tool,'bili_recommend');assert.deepEqual(f.calls[0].arguments,{ps:5});assert.equal(received.constraints.tools,false);assert.equal(received.constraints.computerAccess,false);
 const summary=await f.service.result(job.id);assert.equal(summary.state,'completed');assert.equal(summary.analysis.actualModel.id,'gpt-synthetic');assert.equal(summary.sourceCount,1);assert.equal(JSON.stringify(summary).includes(video.text),false);
 const artifact=await f.service.result(job.id,{includeContent:true});assert.equal(artifact.artifact.analysis.text,'合成分析');assert.ok(artifact.artifact.materials.some(x=>x.kind==='transcript'));assert.ok(artifact.artifact.materials.some(x=>x.kind==='comments'));
 assert.equal(f.service.state().jobs[0].artifact,undefined);
 const repeated=await f.service.start({profileId:p.id,requestId:'message-1'});assert.equal(repeated.id,job.id);assert.equal(f.calls.length,1);
});

test('读工具不能借配置打开电脑工具，URL与参数不接受任意地址或事件字段',()=>{
 const profile={platform:'bilibili',bindings:{},budget:{maxItems:5,mediaSeconds:30,maxFrames:3}};
 assert.throws(()=>contentToolRequest(profile,'detail',{itemId:'file:///private'}),{code:'content_input_invalid'});
 assert.throws(()=>contentToolRequest(profile,'search',{query:'q',url:'http://127.0.0.1/private'}),{code:'content_url_invalid'});
 assert.throws(()=>contentToolRequest({...profile,bindings:{feed:{tool:'shell_exec',arguments:{command:'read secret'}}}},'feed'),{code:'content_tool_unconfigured'});
 assert.throws(()=>contentToolRequest({...profile,bindings:{feed:{tool:'browser_evaluate',arguments:{expression:'read secret'}}}},'feed'),{code:'content_tool_unconfigured'});
 assert.throws(()=>contentToolRequest({...profile,bindings:{feed:{tool:'read_feed',arguments:{command:'read secret'}}}},'feed'),{code:'content_binding_invalid'});
 assert.throws(()=>contentToolRequest({...profile,bindings:{feed:{tool:'bili_reply',arguments:{bvid:video.bvid,text:'unconfirmed'}}}},'feed'),{code:'content_binding_invalid'});
 assert.throws(()=>contentToolRequest(profile,'feed',{command:'x'}),{code:'content_action_invalid'});
});

test('写动作独立开关、一次确认，拒绝和重复消息都不执行写入',async t=>{
 let approvals=0;const f=await fixture(t,{confirmWrite:async()=>{approvals++;return false;}}),p=await f.save();
 await assert.rejects(f.service.start({profileId:p.id,action:'comment',input:{itemId:video.bvid,text:'测试'}}),{code:'content_operation_denied'});
 await f.service.configure({action:'save-profile',profile:{id:p.id,allowedOperations:{read:true,comment:true}}});
 const job=await f.service.start({profileId:p.id,action:'comment',input:{itemId:video.bvid,text:'测试'},requestId:'write-1'});await f.service.idle();
 assert.equal((await f.service.result(job.id)).state,'declined');assert.equal(approvals,1);assert.equal(f.calls.length,0);
 await f.service.start({profileId:p.id,action:'comment',input:{itemId:video.bvid,text:'测试'},requestId:'write-1'});assert.equal(approvals,1);
});

test('取消等待和在途读取会清场并释放共享活动锁，不调用分析或重试',async t=>{
 let calls=0,analysis=0,released=0,started;const pending=new Promise(resolve=>{started=resolve;});
 const f=await fixture(t,{activityGate:{acquire:()=>()=>released++},callPlatformTool:request=>{calls++;started();return new Promise((_,reject)=>request.signal.addEventListener('abort',()=>reject(Object.assign(Error('cancel'),{code:'content_cancelled'})),{once:true}));},analyze:async()=>{analysis++;return'x';}}),p=await f.save();
 released=0;const job=await f.service.start({profileId:p.id});await pending;await f.service.cancel(job.id);await f.service.idle();
 assert.equal((await f.service.result(job.id)).state,'cancelled');assert.equal(released,1);assert.equal(calls,1);assert.equal(analysis,0);
});

test('每日预算、定时窗口与去重持久保存；重启不重复执行已发消息',async t=>{
 let at=Date.parse('2026-11-02T01:00:00Z');const f=await fixture(t,{now:()=>at}),p=await f.save({budget:{dailyRuns:2},schedule:{enabled:true,intervalMinutes:5,timeZone:'Asia/Shanghai'}});
 await f.service.tick();assert.equal(f.calls.length,0);at+=5*60000;await f.service.tick();await f.service.idle();assert.equal(f.calls.length,1);
 const next=await f.service.start({profileId:p.id,requestId:'next'});await f.service.idle();assert.equal((await f.service.result(next.id)).counts.skippedSources,1);
 await assert.rejects(f.service.start({profileId:p.id}),{code:'content_daily_budget'});const disk=JSON.parse(await readFile(join(f.root,'content-activities/state.json'),'utf8'));assert.equal(disk.daily[p.id].runs,2);assert.equal(disk.jobs.length,2);
});

test('海外无工具绑定仍为unconfigured，能绑定的实际执行结果始终显示未验证',async t=>{
 const f=await fixture(t),p=await f.save({platform:'youtube',readAction:'search',bindings:{search:{tool:'youtube_search',arguments:{q:'$query'}}}});
 const job=await f.service.start({profileId:p.id,input:{query:'synthetic'},analyze:false});await f.service.idle();
 assert.equal((await f.service.result(job.id)).verification,'not-verified');assert.equal(f.calls[0].tool,'youtube_search');assert.equal(f.calls[0].arguments.q,'synthetic');assert.equal(contentPlatforms().find(x=>x.id==='youtube').verification,'not-verified');
});

test('RSS以真实订阅语义读取，不宣称账号推荐；禁用XML实体和重定向',async t=>{
 let options;const f=await fixture(t,{fetchImpl:async(url,init)=>{options=init;return new Response('<rss><channel><item><title>订阅文章</title><link>https://weibo.com/123/456</link><description>正文</description></item></channel></rss>',{headers:{'content-type':'application/rss+xml'}});}}),p=await f.save({platform:'weibo',serverId:null,revision:null,connection:{type:'rss',url:'https://rss.example.invalid/feed'}});
 const job=await f.service.start({profileId:p.id,analyze:false});await f.service.idle();const result=await f.service.result(job.id,{includeContent:true});
 assert.equal(result.state,'completed');assert.equal(result.artifact.sourceType,'subscription');assert.equal(result.artifact.personalized,false);assert.equal(options.redirect,'error');assert.equal(f.calls.length,0);
});

test('MCP真实loopback HTTP握手与调用，session清理且参数不被网络返回覆盖',async t=>{
 const received=[];const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};received.push({method:req.method,body,session:req.headers['mcp-session-id']});
  if(req.method==='DELETE'){res.writeHead(204);res.end();return;}if(body.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
  const result=body.method==='initialize'?{protocolVersion:'2025-03-26',serverInfo:{name:'synthetic',version:'1'},capabilities:{tools:{}}}:{content:[{type:'text',text:JSON.stringify({items:[video]})}]};res.writeHead(200,{'content-type':'application/json','mcp-session-id':'synthetic-session'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const client=createContentMcpClient({endpoint:'http://127.0.0.1:'+server.address().port+'/mcp'});const result=await client.call('bili_recommend',{ps:2});await client.close();
 assert.equal(result.content.length,1);assert.deepEqual(received.find(x=>x.body.method==='tools/call').body.params,{name:'bili_recommend',arguments:{ps:2}});assert.equal(received.at(-1).method,'DELETE');assert.equal(received[1].session,'synthetic-session');
 assert.throws(()=>createContentMcpClient({endpoint:'http://evil.invalid/mcp'}),{code:'content_endpoint_invalid'});
});

test('OBS只发真实白名单流请求，鉴权不发送原密码，响应以requestId关联',async()=>{
 const sent=[];class Socket extends EventEmitter{
  constructor(){super();queueMicrotask(()=>this.emit('message',{data:JSON.stringify({op:0,d:{rpcVersion:1,authentication:{salt:'salt',challenge:'challenge'}}})}));}
  addEventListener(type,fn){this.on(type,fn);}close(){}send(raw){const p=JSON.parse(raw);sent.push(p);if(p.op===1)queueMicrotask(()=>this.emit('message',{data:JSON.stringify({op:2,d:{negotiatedRpcVersion:1}})}));if(p.op===6)queueMicrotask(()=>this.emit('message',{data:JSON.stringify({op:7,d:{...p.d,requestStatus:{result:true,code:100},responseData:{outputActive:true,streamKey:'must-not-leave'}}})}));}
 }
 const result=await callContentObs({action:'start',password:'private-password',webSocketFactory:()=>new Socket()});assert.equal(result.confirmed,true);assert.equal(sent[1].d.requestType,'StartStream');assert.equal(JSON.stringify(sent).includes('private-password'),false);assert.equal(result.status.streamKey,undefined);
});

test('正文、字幕和像素材料分开登记，签名与cookie不进入来源清单',()=>{
 const r=normalizeContentMaterials({structuredContent:{items:[{...video,url:video.url+'?auth=secret&ok=1',cookie:'private'}]},content:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='}]},{platform:'bilibili',action:'detail',input:{itemId:video.bvid}});
 assert.ok(r.materialKinds.includes('image'));assert.ok(r.materialKinds.includes('transcript'));assert.equal(r.sources[0].url.includes('secret'),false);assert.equal(JSON.stringify(r).includes('private'),false);
});

test('B站多步详情和字幕在工具预算内执行，缺失或预算耗尽明确记partial',async t=>{
 const tools=[];const f=await fixture(t,{callPlatformTool:async request=>{tools.push(request.tool);return{structuredContent:request.tool==='bili_recommend'?{videos:[video]}:{bvid:video.bvid,title:video.title,text:request.tool==='bili_subtitle'?'真实字幕样本':'完整详情'}};}}),p=await f.save({enrichment:['detail','subtitles','comments'],budget:{maxToolCalls:3}});
 const job=await f.service.start({profileId:p.id,analyze:false});await f.service.idle();const result=await f.service.result(job.id,{includeContent:true});
 assert.deepEqual(tools,['bili_recommend','bili_video_info','bili_subtitle']);assert.equal(result.partial,true);assert.ok(result.materialKinds.includes('subtitles'));assert.equal(result.counts.toolCalls,3);assert.ok(result.artifact.enrichmentErrors.some(x=>x.code==='content_tool_budget'));
});

test('小红书详情临时令牌只用于同轮精准工具参数，不进状态或产物',async t=>{
 const feedId='abcdef0123456789abcdef01',calls=[];const f=await fixture(t,{callPlatformTool:async request=>{calls.push(request);return{structuredContent:request.tool==='list_feeds'?{feeds:[{id:feedId,xsecToken:'ephemeral-private-token',noteCard:{displayTitle:'合成笔记'}}]}:{note:{id:feedId,title:'详情',desc:'正文',imageList:[{urlDefault:'https://sns-webpic.xhscdn.com/sample.jpg'}]},comments:{list:[{content:'评论'}]}}};}}),p=await f.save({platform:'xiaohongshu',enrichment:['detail']});
 const job=await f.service.start({profileId:p.id,analyze:false});await f.service.idle();const result=await f.service.result(job.id,{includeContent:true});
 assert.equal(calls[1].tool,'get_feed_detail');assert.equal(calls[1].arguments.xsec_token,'ephemeral-private-token');assert.equal(JSON.stringify(result).includes('ephemeral-private-token'),false);assert.equal(JSON.stringify(f.service.state()).includes('ephemeral-private-token'),false);assert.ok(result.materialKinds.includes('image-reference'));assert.ok(result.materialKinds.includes('comments'));
});

test('持久配置在重开后仍准确，已完成任务不重放，状态文件硬链接拒写',async t=>{
 const f=await fixture(t),p=await f.save();const job=await f.service.start({profileId:p.id,requestId:'persisted',analyze:false});await f.service.idle();await f.service.dispose();
 let calls=0;const reopened=await createContentActivityService({dataRoot:f.root,scheduler:false,callPlatformTool:async()=>{calls++;return{};}});t.after(()=>reopened.dispose());
 assert.equal((await reopened.start({profileId:p.id,requestId:'persisted'})).id,job.id);assert.equal(calls,0);assert.equal(reopened.state().profiles[0].state,'configured');
 const outside=join(f.root,'outside-state.json');const {link}=await import('node:fs/promises');await link(join(f.root,'content-activities/state.json'),outside);
 await assert.rejects(reopened.configure({action:'save-profile',profile:{id:p.id,label:'changed'}}),{code:'content_store_invalid'});assert.equal(JSON.parse(await readFile(outside,'utf8')).profiles[0].label,p.label);
});

test('微博读取按已核对的用户动态、热搜和评论工具调用，不把热搜冒充账号推荐',async t=>{
 const calls=[];const f=await fixture(t,{callPlatformTool:async request=>{calls.push(request);return{structuredContent:{Feeds:[{id:'5123456789012345',text:'微博正文',videos:{},pics:[{large:'https://wx1.sinaimg.cn/large/example.jpg'}]}]}};}}),p=await f.save({platform:'weibo',input:{recipient:'1234567890'},enrichment:['comments']});
 const job=await f.service.start({profileId:p.id,analyze:false});await f.service.idle();const result=await f.service.result(job.id,{includeContent:true});
 assert.equal(calls[0].tool,'get_feeds');assert.deepEqual(calls[0].arguments,{uid:'1234567890',limit:5});assert.equal(calls[1].tool,'get_comments');assert.equal(calls[1].arguments.feed_id,'5123456789012345');assert.equal(result.sourceCount,1);assert.equal(result.artifact.sources[0].url,'https://m.weibo.cn/status/5123456789012345');assert.ok(result.materialKinds.includes('image-reference'));
 const trending=contentToolRequest({platform:'weibo',budget:p.budget},'trending');assert.deepEqual(trending,{operation:'read',tool:'get_trendings',arguments:{limit:5}});
});

test('画面只有引用或媒体预算裁剪时明确partial，不声称已看画面',async t=>{
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
 const f=await fixture(t,{callPlatformTool:async()=>({structuredContent:{url:'https://live.bilibili.com/1',frames:['https://live.bilibili.com/frame.jpg']},content:[{type:'image',mimeType:'image/png',data:png},{type:'image',mimeType:'image/png',data:png}]})}),p=await f.save({platform:'bilibili-live',readAction:'watch',bindings:{watch:{tool:'live_frames',arguments:{url:'$url'}}},budget:{maxFrames:1},input:{url:'https://live.bilibili.com/1'}});
 const job=await f.service.start({profileId:p.id,analyze:false});await f.service.idle();const result=await f.service.result(job.id,{includeContent:true});assert.equal(result.partial,true);assert.equal(result.artifact.materials.filter(row=>row.kind==='image').length,1);assert.equal(result.artifact.materials.filter(row=>row.kind==='image-reference').length,0);
});

test('历史产物只按持久索引清理本服务UUID普通文件，保留人工文件和当前结果',async t=>{
 const f=await fixture(t),p=await f.save(),job=await f.service.start({profileId:p.id,analyze:false});await f.service.idle();await f.service.dispose();
 const old=join(f.root,'content-activities/artifacts/11111111-1111-4111-8111-111111111111.json'),manual=join(f.root,'content-activities/artifacts/manual.json');await writeFile(old,'{}');await writeFile(manual,'{}');
 const reopened=await createContentActivityService({dataRoot:f.root,scheduler:false});t.after(()=>reopened.dispose());await assert.rejects(lstat(old),{code:'ENOENT'});assert.equal((await lstat(manual)).isFile(),true);assert.equal((await reopened.result(job.id,{includeContent:true})).artifact.jobId,job.id);
});

test('本机MCP取消会发送对应请求的取消通知，写入不明结果保持uncertain且不重试',async t=>{
 const sent=[];let toolStarted;const started=new Promise(resolve=>{toolStarted=resolve;});
 const fetchImpl=async(url,init)=>{const body=init.body?JSON.parse(init.body):{};sent.push(body);if(body.method==='tools/call'){toolStarted();return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('abort')),{once:true}));}if(body.method?.startsWith('notifications/'))return new Response(null,{status:202});if(init.method==='DELETE')return new Response(null,{status:204});return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-03-26',serverInfo:{name:'mock'},capabilities:{}}}),{headers:{'mcp-session-id':'synthetic-session'}});};
 const controller=new AbortController(),client=createContentMcpClient({endpoint:'http://127.0.0.1:12345/mcp',fetchImpl}),call=client.call('read_feed',{}, {signal:controller.signal});await started;controller.abort();await assert.rejects(call,{code:'content_cancelled'});await client.close();assert.equal(sent.find(x=>x.method==='notifications/cancelled').params.requestId,sent.find(x=>x.method==='tools/call').id);
 const f=await fixture(t,{confirmWrite:async()=>true,callPlatformTool:async()=>{throw Object.assign(Error('bad response'),{code:'content_mcp_protocol'});}}),p=await f.save({allowedOperations:{comment:true}});const job=await f.service.start({profileId:p.id,action:'comment',input:{itemId:video.bvid,text:'测试'},requestId:'uncertain'});await f.service.idle();assert.equal((await f.service.result(job.id)).state,'uncertain');assert.equal((await f.service.start({profileId:p.id,requestId:'uncertain'})).id,job.id);
});
