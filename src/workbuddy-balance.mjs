import {connect as connectSocket} from 'node:net';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute,join} from 'node:path';

const LIMIT=1024*1024,DISCOVERY_LIMIT=16384,PIPE=/^\\\\\.\\pipe\\wbipc-[0-9a-f]{16}$/i;
const fail=()=>{throw Error('invalid_balance');};

/** 只投影正式账单摘要中的剩余积分；没有已核准总额，不派生full、百分比或额度窗口。 */
export function parseWorkBuddyBalance(body,locale='zh-CN'){
 if(!body||typeof body!=='object'||(body.code!==undefined&&body.code!==0&&body.code!=='0')||!Array.isArray(body.data?.Packages)||body.data.Packages.length>1000)fail();
 let total=0;
 for(const item of body.data.Packages){
  const raw=item?.CycleRemainCapacity;
  if(typeof raw!=='number'&&typeof raw!=='string'||typeof raw==='string'&&!/^\d+(?:\.\d{1,9})?$/.test(raw))fail();
  const value=Number(raw);if(!Number.isFinite(value)||value<0||value>1e12)fail();total+=value;
 }
 if(!Number.isFinite(total)||total>1e12)fail();
 return{ok:true,provider:'workbuddy',shape:'points',data:{unit:locale==='zh-CN'?'积分':'credits',total:String(Number(total.toFixed(9)))}};
}

async function readDiscovery(configDir,io){
 if(!isAbsolute(configDir||''))fail();
 for(const path of [configDir,join(configDir,'wbipc')]){const info=await io.lstat(path);if(!info.isDirectory()||info.isSymbolicLink())fail();}
 const file=join(configDir,'wbipc','endpoint.json'),before=await io.lstat(file);
 if(!before.isFile()||before.isSymbolicLink()||before.size>DISCOVERY_LIMIT||before.nlink!==1)fail();
 const handle=await io.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0)),buffer=Buffer.alloc(DISCOVERY_LIMIT+1);
 try{
  const current=await handle.stat();if(!current.isFile()||current.dev!==before.dev||current.ino!==before.ino||current.nlink!==1||current.size>DISCOVERY_LIMIT)fail();
  const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>DISCOVERY_LIMIT)fail();
  const value=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
  if(!value||!PIPE.test(value.endpoint)||typeof value.ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.ticket))fail();
  return{endpoint:value.endpoint,ticket:value.ticket};
 }finally{buffer.fill(0);await handle.close();}
}

function authenticate(ticket,side,endpoint,clientNonce,serverNonce){
 const hash=createHmac('sha256',ticket);
 for(const value of [side==='server'?'wbipc-s':'wbipc-c','1',endpoint,clientNonce,serverNonce]){
  const bytes=Buffer.from(value,'utf8'),size=Buffer.alloc(4);size.writeUInt32BE(bytes.length);hash.update(size);hash.update(bytes);
 }
 return hash.digest('base64url');
}

/** 固定WBIPC读接口：ticket只驻留本次连接内存，既不记录也不传给渲染端。 */
export function createWorkBuddyBalance({configDir=process.env.WORKBUDDY_CONFIG_DIR?.trim()||join(homedir(),'.workbuddy'),platform=process.platform,locale='zh-CN',timeoutMs=8000,connect=connectSocket,fsImpl={}}={}){
 const io={lstat,open,...fsImpl};let disposed=false,pending=null,abort=()=>{};
 const unknown=()=>({ok:false,provider:'workbuddy',reason:'fetch-error',message:locale==='zh-CN'?'WorkBuddy 积分暂不可用，请确认客户端已启动并登录。':'WorkBuddy credits are unavailable. Check that WorkBuddy is running and signed in.'});
 async function query(){
  if(disposed||platform!=='win32')return unknown();
  let discovery;
  try{
   discovery=await readDiscovery(configDir,io);if(disposed)return unknown();
   return await new Promise((resolve,reject)=>{
    let socket,stage='challenge',buffer=Buffer.alloc(0),settled=false,timer;
    const clientNonce=randomBytes(16).toString('base64url');let serverNonce;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);abort=()=>{};buffer.fill(0);buffer=Buffer.alloc(0);socket?.destroy();error?reject(Error('balance_unavailable')):resolve(value);};
    const send=frame=>{if(!settled)socket.write(JSON.stringify(frame)+'\n');};
    const receive=frame=>{
     if(!frame||typeof frame!=='object'||Array.isArray(frame))return finish(true);
     if(stage==='challenge'){
      if(frame.type!=='session_challenge'||frame.protocol!==1||typeof frame.server_nonce!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(frame.server_nonce)||typeof frame.server_proof!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(frame.server_proof))return finish(true);
      serverNonce=frame.server_nonce;const expected=Buffer.from(authenticate(discovery.ticket,'server',discovery.endpoint,clientNonce,serverNonce)),actual=Buffer.from(frame.server_proof);
      if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return finish(true);
      stage='ack';send({type:'session_prove',client_proof:authenticate(discovery.ticket,'client',discovery.endpoint,clientNonce,serverNonce)});return;
     }
     if(stage==='ack'){
      if(frame.type!=='session_hello_ack'||frame.protocol!==1||typeof frame.connection_epoch!=='string'||!/^ce-[0-9a-f]{16}$/.test(frame.connection_epoch))return finish(true);
      stage='pipe';send({jsonrpc:'2.0',id:1,method:'broker/GetPipe',params:{pipe:'wb.request'}});return;
     }
     if(frame.jsonrpc!=='2.0'||frame.error||frame.id!==(stage==='pipe'?1:2))return finish(true);
     if(stage==='pipe'){
      if(frame.result?.channel!=='c:wb.request'||!Array.isArray(frame.result.methods)||!frame.result.methods.includes('http.fetch'))return finish(true);
      stage='balance';send({jsonrpc:'2.0',id:2,method:'c:wb.request/http.fetch',mode:'call',params:{method:'POST',path:'/billing/meter/get-user-resource-summary',headers:{'content-type':'application/json'},body_b64:'e30='}});return;
     }
     const response=frame.result,encoded=response?.body_b64;
     if(response?.status!==200||typeof encoded!=='string'||encoded.length>900000||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))return finish(true);
     const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded)return finish(true);
     try{finish(false,parseWorkBuddyBalance(JSON.parse(bytes.toString('utf8')),locale));}catch{finish(true);}finally{bytes.fill(0);}
    };
    try{
     socket=connect({path:discovery.endpoint});abort=()=>finish(true);timer=setTimeout(()=>finish(true),Math.max(100,Math.min(30000,timeoutMs)));
     socket.once('connect',()=>send({type:'session_hello',protocol_min:1,protocol_max:1,client_nonce:clientNonce,ticket_id:createHash('sha256').update(discovery.ticket).digest('hex').slice(0,16),client:{kind:'desktop-pet',id:'codex-pet',version:'1'}}));
     socket.on('data',chunk=>{
      if(settled)return;if(buffer.length+chunk.length>LIMIT)return finish(true);buffer=Buffer.concat([buffer,chunk]);
      while(!settled){const line=buffer.indexOf(10);if(line<0)break;const bytes=buffer.subarray(0,line);buffer=buffer.subarray(line+1);if(!bytes.length)continue;
       try{receive(JSON.parse(bytes.toString('utf8')));}catch{return finish(true);}
      }
     });
     socket.on('error',()=>finish(true));socket.once('close',()=>finish(true));
    }catch{finish(true);}
   });
  }catch{return unknown();}finally{if(discovery){discovery.ticket='';discovery=null;}}
 }
 function fetch(){if(disposed)return Promise.resolve(unknown());if(pending)return pending;pending=query().finally(()=>{pending=null;});return pending;}
 function dispose(){if(disposed)return;disposed=true;abort();}
 return{fetch,dispose};
}
