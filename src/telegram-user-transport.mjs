import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {chatError,chatChunks,chatId,decimal} from './international-http.mjs';
const require=createRequire(import.meta.url);
async function sdk(){
 const pkg=JSON.parse(readFileSync(join(dirname(require.resolve('teleproto')),'package.json'),'utf8'));if(pkg.name!=='teleproto'||pkg.version!=='1.232.1')throw chatError('chat_runtime_unverified');
 const [main,sessions,events,extensions]=await Promise.all([import('teleproto'),import('teleproto/sessions'),import('teleproto/events'),import('teleproto/extensions')]);return{TelegramClient:main.TelegramClient,StringSession:sessions.StringSession,NewMessage:events.NewMessage,Logger:extensions.Logger};
}
/** MTProto普通号独立登录；session仅交给本机密钥存储，验证码与二步密码只活在当前回调。 */
export function createTelegramUserTransport({apiId,apiHash,session='',expectedSelfId,onSession=async()=>{},onChallenge=async()=>{throw chatError('chat_login_required');},onMessage=async()=>{},onStatus=()=>{},loadSdk=sdk}={}){
 if(!Number.isSafeInteger(apiId)||apiId<1||apiId>2147483647||typeof apiHash!=='string'||!/^[a-fA-F0-9]{32}$/.test(apiHash)||typeof session!=='string'||session.length>8192||expectedSelfId!==undefined&&!chatId(expectedSelfId))throw chatError('chat_invalid_options');
 let active=false,connected=false,selfId=null,client,handler,generation=0,startPromise;const peers=new Map();
 const status=(state,code)=>{try{onStatus({state,...(code?{code}:{}),...(selfId?{selfId}:{})});}catch{}};
 const check=run=>{if(!active||generation!==run)throw chatError('chat_not_connected');};
 async function challenge(kind,run){check(run);status('login-required');let value;try{value=await onChallenge({kind});}catch{throw Error('AUTH_USER_CANCEL');}check(run);if(typeof value!=='string'||!value||value.length>512||/[\x00-\x1f\x7f]/.test(value))throw Error('AUTH_USER_CANCEL');return value;}
 async function start(){if(startPromise)return startPromise;if(connected)return;active=true;const run=++generation;status('connecting');startPromise=(async()=>{
  try{const{TelegramClient,StringSession,NewMessage,Logger}=await loadSdk();check(run);client=new TelegramClient(new StringSession(session),apiId,apiHash,{connectionRetries:3,requestRetries:0,floodSleepThreshold:0,autoReconnect:true,deviceModel:'Codex Pet',appVersion:'1.0.0',...(Logger?{baseLogger:new Logger('none')}:{})});client.setLogLevel?.('none');
   await client.start({phoneNumber:()=>challenge('phone',run),phoneCode:()=>challenge('code',run),password:()=>challenge('password',run),emailAddress:()=>challenge('email',run),emailVerification:async()=>({code:await challenge('email-code',run)}),reCaptchaCallback:async()=>{throw Error('AUTH_USER_CANCEL');},firstAndLastNames:async()=>{throw Error('AUTH_USER_CANCEL');},acceptTermsOfService:async()=>false,onError:async()=>true});check(run);
   const me=await client.getMe();selfId=decimal(me?.id);if(!chatId(selfId)||me?.bot===true)throw chatError('chat_account_invalid');if(expectedSelfId&&expectedSelfId!==selfId)throw chatError('chat_account_changed');await onSession(client.session.save());check(run);
   handler=async event=>{try{check(run);const value=event.message,userId=decimal(value?.senderId);if(event.isPrivate!==true||!value||value.out||value.fwdFrom||value.media||value.viaBotId||!chatId(userId)||userId===selfId||typeof value.text!=='string'||!value.text.trim()||value.text.length>12000||!Number.isSafeInteger(value.id)||value.id<1)return;const sender=await value.getSender();check(run);if(!sender||sender.bot===true)return;const peer=await value.getInputChat();if(!peer)return;while(peers.size>=128&&!peers.has(userId))peers.delete(peers.keys().next().value);peers.set(userId,peer);await onMessage({userId,id:'tg-'+value.id,text:value.text,private:true,self:false});}catch{/* 断线、非文字或未知身份不进入任务引擎。 */}};
   client.addEventHandler(handler,new NewMessage({incoming:true,forwards:false}));connected=true;status('connected');
  }catch(error){stop();const safe=error?.code?.startsWith('chat_')?error:chatError('chat_login_failed');status('error',safe.code);throw safe;}finally{startPromise=null;}
 })();return startPromise;}
 function stop(){active=false;connected=false;generation++;if(handler)client?.removeEventHandler?.(handler);handler=null;peers.clear();Promise.resolve(client?.disconnect?.()).catch(()=>{});status('stopped');}
 async function send({userId,text,msgId}={}){if(!active||!connected||client?.connected===false)throw chatError('chat_not_connected');if(!chatId(userId)||!peers.has(userId)||msgId!==undefined&&!/^tg-[1-9][0-9]{0,12}$/.test(msgId))throw chatError('chat_invalid_send');const chunks=chatChunks(text,4096),ids=[],run=generation;for(let index=0;index<chunks.length;index++){try{check(run);const result=await client.sendMessage(peers.get(userId),{message:chunks[index],parseMode:undefined,...(msgId?{replyTo:Number(msgId.slice(3))}:{})});check(run);ids.push(decimal(result?.id));}catch{throw chatError('chat_send_failed',{deliveryUnknown:true,unsentText:chunks.slice(index).join(''),sentCount:ids.length});}}return{messageIds:ids,sentCount:ids.length};}
 return{start,stop,send,state:()=>({state:connected&&client?.connected!==false?'connected':active?'connecting':'stopped',selfId})};
}
