import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {lstat,realpath,mkdir} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
import {contentError,publicContentUrl} from './platform-catalog.mjs';

export const CONTENT_MEDIA_SOURCES=Object.freeze([
 'https://github.com/streamlink/streamlink/blob/a685512a746a99a429b2678e2718c1ee85ba9f6c/src/streamlink_cli/argparser.py',
 'https://github.com/streamlink/streamlink/blob/a685512a746a99a429b2678e2718c1ee85ba9f6c/docs/cli/protocols.rst',
 'https://github.com/FFmpeg/FFmpeg/blob/n8.0/doc/ffmpeg.texi',
 'https://github.com/FFmpeg/FFmpeg/blob/n8.0/doc/protocols.texi',
]);
const cdns={
 'bilibili-live':['bilivideo.com','bilivideo.cn','bilivideo.net','bilibili.com'],
 'douyin-live':['douyincdn.com','douyinvod.com','byteimg.com','douyin.com'],
 twitch:['ttvnw.net','twitchcdn.net'],
 'youtube-live':['googlevideo.com','youtube.com'],
 'tiktok-live':['tiktokcdn.com','tiktok.com','byteoversea.com'],
};
const failure=code=>{throw contentError(code);};
const private4=value=>{const [a,b]=value.split('.').map(Number);return a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a>=224;};
function publicAddress(value){if(isIP(value)===4)return!private4(value);if(isIP(value)===6){const first=parseInt(value.split(':')[0],16);return(first&0xe000)===0x2000&&!value.toLowerCase().startsWith('2001:db8:');}return false;}
async function networkUrl(value,domains,resolveHost){
 let url;try{if(typeof value!=='string'||/[\u0000-\u0020\u007f]/.test(value))throw Error();url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||url.port&&!['80','443'].includes(url.port)||!domains.some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))throw Error();}catch{failure('content_media_url_invalid');}
 let ips;try{ips=await resolveHost(url.hostname,{all:true});}catch{failure('content_media_source_unavailable');}
 if(!Array.isArray(ips)||!ips.length||ips.some(row=>!publicAddress(row.address)))failure('content_media_url_invalid');return url;
}
async function executable(info,signal){
 if(!info||!isAbsolute(info.path??'')||!/^[a-f0-9]{64}$/.test(info.sha256??'')||process.platform==='win32'&&!/\.exe$/i.test(info.path))failure('content_media_unconfigured');
 const stat=await lstat(info.path).catch(()=>null);if(!stat?.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>512*1024*1024)failure('content_media_unconfigured');
 const canonical=await realpath(info.path),hash=createHash('sha256');for await(const part of createReadStream(canonical)){if(signal?.aborted)failure('content_cancelled');hash.update(part);}
 const next=await lstat(info.path);if(next.ino!==stat.ino||next.dev!==stat.dev||next.size!==stat.size||next.mtimeMs!==stat.mtimeMs||hash.digest('hex')!==info.sha256)failure('content_media_program_changed');return canonical;
}
function childEnvironment(){const env={...process.env};for(const key of Object.keys(env))if(/^(?:OPENAI_|CODEX_|DSH_|WORKBUDDY_|CODEBUDDY_|QQ_|NAPCAT_|AWS_|AZURE_|ANTHROPIC_|GOOGLE_API|GITHUB_TOKEN|GH_TOKEN)/i.test(key))delete env[key];return env;}
function stopOwned(child){
 if(!child||child.exitCode!==null||!Number.isInteger(child.pid))return;
 if(process.platform==='win32'){
  const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore',env:childEnvironment()});killer.on('error',()=>{try{child.kill();}catch{}});
 }else try{child.kill('SIGKILL');}catch{}
}
function extractJpegs(buffer,limit){
 const images=[];let offset=0;while(images.length<limit){const start=buffer.indexOf(Buffer.from([255,216,255]),offset);if(start<0)break;const end=buffer.indexOf(Buffer.from([255,217]),start+3);if(end<0)break;images.push(buffer.subarray(start,end+2));offset=end+2;}return images;
}

/**
 * 可选直播画面采样：仅运行本人选择并固定摘要的Streamlink/FFmpeg。
 * Streamlink独立承担平台网络；FFmpeg只读媒体管道，不具备网络或本机文件输入协议。
 * 这里不下载运行时、不打开浏览器、不启动播放器，也不将有限帧样本称为完整观看。
 */
export async function captureContentFrames({platform,url,seconds=20,frames=3,maxBytes=16*1024*1024,maxImageBytes=8*1024*1024,programs,dataRoot,signal,spawnImpl=spawn,resolveHost=lookup,stopProcess=stopOwned}={}){
 if(!Object.hasOwn(cdns,platform)||!Number.isInteger(seconds)||seconds<1||seconds>120||!Number.isInteger(frames)||frames<1||frames>12||!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>64*1024*1024||!Number.isInteger(maxImageBytes)||maxImageBytes<1024||maxImageBytes>16*1024*1024||!isAbsolute(dataRoot??''))failure('content_media_input_invalid');
 const canonical=publicContentUrl(url,platform);if(!canonical)failure('content_media_url_invalid');
 const domains=platform==='bilibili-live'?['live.bilibili.com']:platform==='douyin-live'?['live.douyin.com']:platform==='twitch'?['twitch.tv']:platform==='youtube-live'?['youtube.com','youtu.be']:['tiktok.com'];
 await networkUrl(url,domains,resolveHost);if(signal?.aborted)failure('content_cancelled');
 const streamlink=await executable(programs?.streamlink,signal),ffmpeg=await executable(programs?.ffmpeg,signal);if(signal?.aborted)failure('content_cancelled');
 const work=join(dataRoot,'content-activities','media-work');for(const dir of [dataRoot,join(dataRoot,'content-activities'),work]){await mkdir(dir,{recursive:true,mode:0o700});const directory=await lstat(dir);if(!directory.isDirectory()||directory.isSymbolicLink())failure('content_store_invalid');}
 const env=childEnvironment(),children=new Set();let resolved='';
 async function resolveStream(){if(signal?.aborted)failure('content_cancelled');return new Promise((resolve,reject)=>{
  let done=false,bytes=0,body='';const child=spawnImpl(streamlink,['--no-config','--loglevel','none','--http-timeout','15','--stream-url',url,'best'],{cwd:work,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(child);
  const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);children.delete(child);if(error){stopProcess(child);reject(contentError(error));}else resolve(body.trim());};
  const abort=()=>finish('content_cancelled'),timer=setTimeout(()=>finish('content_media_timeout'),20000);signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',part=>{bytes+=part.length;if(bytes>8192){finish('content_media_response_invalid');return;}body+=part.toString('utf8');});child.stderr.on('data',()=>{});child.once('error',()=>finish('content_media_unconfigured'));child.once('close',code=>finish(code===0?null:'content_media_source_unavailable'));
 });}
 try{
  resolved=await resolveStream();const mediaUrl=await networkUrl(resolved,cdns[platform],resolveHost);if(signal?.aborted)failure('content_cancelled');
  // 只将已核对的CDN结果交给固定协议解析器，避免第二次按原网页重解析到另一地址。
  const protocol=mediaUrl.pathname.endsWith('.m3u8')?'hls':mediaUrl.pathname.endsWith('.mpd')?'dash':'httpstream';
  return await new Promise((resolve,reject)=>{
   let done=false,streamBytes=0,imageBytes=0,diagnostic='',producerDone=false;const images=[];
   const producer=spawnImpl(streamlink,['--no-config','--loglevel','none','--http-timeout','15','--stdout',protocol+'://'+mediaUrl.href,'best'],{cwd:work,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});children.add(producer);
   const decoder=spawnImpl(ffmpeg,['-hide_banner','-nostdin','-loglevel','info','-protocol_whitelist','pipe','-threads','1','-filter_threads','1','-i','pipe:0','-t',String(seconds),'-an','-sn','-dn','-vf','fps='+frames+'/'+seconds+',scale=640:640:force_original_aspect_ratio=decrease,showinfo','-frames:v',String(frames),'-c:v','mjpeg','-q:v','4','-f','image2pipe','pipe:1'],{cwd:work,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});children.add(decoder);
   const finish=(error)=>{
    if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);for(const child of [producer,decoder]){stopProcess(child);children.delete(child);}try{producer.stdout.unpipe(decoder.stdin);decoder.stdin.destroy();}catch{}
    if(error){reject(contentError(error));return;}const captured=extractJpegs(Buffer.concat(images),frames);if(!captured.length){reject(contentError('content_media_empty'));return;}
    const rawTimes=[...diagnostic.matchAll(/pts_time:\s*(-?\d+(?:\.\d+)?)/g)].map(row=>Number(row[1])).filter(Number.isFinite),base=rawTimes[0]??0,timestamps=rawTimes.slice(0,captured.length).map(value=>Math.max(0,value-base));
    resolve({structuredContent:{url:canonical,requestedSeconds:seconds,sampleTimestamps:timestamps,frameCount:captured.length,partial:captured.length<frames,audioProvided:false},content:captured.map(image=>({type:'image',mimeType:'image/jpeg',data:image.toString('base64')}))});
   };
   const abort=()=>finish('content_cancelled'),timer=setTimeout(()=>finish('content_media_timeout'),(seconds+30)*1000);signal?.addEventListener('abort',abort,{once:true});
   producer.stdout.on('data',part=>{streamBytes+=part.length;if(streamBytes>maxBytes)finish('content_media_limit');});producer.stdout.pipe(decoder.stdin);producer.stderr.on('data',()=>{});producer.once('error',()=>finish('content_media_unconfigured'));producer.once('close',code=>{producerDone=true;if(code!==0&&!done)finish('content_media_source_unavailable');});
   decoder.stdin.on('error',()=>{if(!done&&producerDone)finish('content_media_empty');});decoder.stdout.on('data',part=>{imageBytes+=part.length;if(imageBytes>maxImageBytes){finish('content_media_limit');return;}images.push(part);});decoder.stderr.on('data',part=>{if(diagnostic.length<65536)diagnostic+=part.toString('utf8').slice(0,65536-diagnostic.length);});decoder.once('error',()=>finish('content_media_unconfigured'));decoder.once('close',code=>finish(code===0?null:'content_media_decode_failed'));
  });
 }finally{for(const child of children)stopProcess(child);children.clear();}
}
