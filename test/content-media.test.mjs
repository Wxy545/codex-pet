import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {captureContentFrames} from '../src/platform-media.mjs';

async function setup(t){const dir=await realpath(await mkdtemp(join(tmpdir(),'pet-content-media-')));t.after(()=>rm(dir,{recursive:true,force:true}));const programs={};for(const name of ['streamlink','ffmpeg']){const body=Buffer.from('synthetic-'+name),path=join(dir,name+'.exe');await writeFile(path,body);programs[name]={path,sha256:createHash('sha256').update(body).digest('hex')};}return{dir,programs};}
function spawning({cdn='https://edge.bilivideo.com/live/test.m3u8',hang=false}={}){
 const calls=[],stopped=[];let id=900000;
 function spawn(file,args,options){const child=new EventEmitter();child.pid=++id;child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();calls.push({child,file,args,options});
  const close=()=>{child.exitCode=0;child.emit('close',0);};
  if(args.includes('--stream-url'))queueMicrotask(()=>{child.stdout.end(cdn+'\n');close();});
  else if(args.includes('--stdout')){if(!hang)queueMicrotask(()=>{child.stdout.end(Buffer.from('synthetic transport bytes'));close();});}
  else child.stdin.on('data',()=>{if(hang)return;child.stderr.end('pts_time:0\npts_time:10\npts_time:20\n');child.stdout.end(Buffer.from([255,216,255,0,255,217,255,216,255,1,255,217,255,216,255,2,255,217]));queueMicrotask(close);});
  return child;
 }
 return{spawn,calls,stopped,stop:child=>{stopped.push(child.pid);child.exitCode=-1;child.stdout.destroy();child.stderr.destroy();child.stdin.destroy();}};
}
const dns=async()=>[{address:'8.8.8.8',family:4}];

test('批准摘要的程序走解析→受控CDN→管道解码，真实返回图像材料而不打开网络解码器',async t=>{
 const f=await setup(t),s=spawning();const result=await captureContentFrames({platform:'bilibili-live',url:'https://live.bilibili.com/123',programs:f.programs,dataRoot:f.dir,seconds:30,frames:3,spawnImpl:s.spawn,resolveHost:dns,stopProcess:s.stop});
 assert.equal(result.content.length,3);assert.deepEqual(result.structuredContent.sampleTimestamps,[0,10,20]);assert.equal(result.structuredContent.audioProvided,false);assert.equal(result.structuredContent.frameCount,3);
 assert.equal(s.calls.length,3);assert.ok(s.calls[1].args.includes('hls://https://edge.bilivideo.com/live/test.m3u8'));assert.equal(s.calls[2].args[s.calls[2].args.indexOf('-protocol_whitelist')+1],'pipe');assert.ok(s.calls.every(row=>row.options.shell===false&&row.options.windowsHide===true));assert.equal(s.calls[2].args.includes('-an'),true);
});

test('任意协议、URL用户信息、平台外CDN、私网DNS、无限录制和程序摘要变化均拒绝',async t=>{
 const f=await setup(t);
 for(const url of ['file:///private','https://user:password@live.bilibili.com/123','https://evil.invalid/123'])await assert.rejects(captureContentFrames({platform:'bilibili-live',url,programs:f.programs,dataRoot:f.dir,resolveHost:dns}),{code:'content_media_url_invalid'});
 await assert.rejects(captureContentFrames({platform:'bilibili-live',url:'https://live.bilibili.com/123',programs:f.programs,dataRoot:f.dir,seconds:100000,resolveHost:dns}),{code:'content_media_input_invalid'});
 await assert.rejects(captureContentFrames({platform:'bilibili-live',url:'https://live.bilibili.com/123',programs:f.programs,dataRoot:f.dir,resolveHost:async()=>[{address:'127.0.0.1'}]}),{code:'content_media_url_invalid'});
 const s=spawning({cdn:'https://evil.invalid/feed.m3u8'});await assert.rejects(captureContentFrames({platform:'bilibili-live',url:'https://live.bilibili.com/123',programs:f.programs,dataRoot:f.dir,spawnImpl:s.spawn,resolveHost:dns,stopProcess:s.stop}),{code:'content_media_url_invalid'});assert.equal(s.calls.length,1);
 await writeFile(f.programs.ffmpeg.path,'changed');await assert.rejects(captureContentFrames({platform:'bilibili-live',url:'https://live.bilibili.com/123',programs:f.programs,dataRoot:f.dir,resolveHost:dns}),{code:'content_media_program_changed'});
});

test('取消仅清自有媒体子进程，不保留无限后台采集',async t=>{
 const f=await setup(t),s=spawning({hang:true}),controller=new AbortController();const result=captureContentFrames({platform:'bilibili-live',url:'https://live.bilibili.com/123',programs:f.programs,dataRoot:f.dir,spawnImpl:s.spawn,resolveHost:dns,stopProcess:s.stop,signal:controller.signal});
 const deadline=Date.now()+2000;while(s.calls.length<3&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,2));controller.abort();await assert.rejects(result,{code:'content_cancelled'});assert.ok(s.stopped.includes(s.calls[1].child.pid));assert.ok(s.stopped.includes(s.calls[2].child.pid));assert.ok(s.stopped.every(id=>s.calls.some(call=>call.child.pid===id)));
});
