import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createWorkBuddyBalance,parseWorkBuddyBalance} from '../src/workbuddy-balance.mjs';

const packet=value=>JSON.stringify(value)+'\n';
function proof(ticket,side,endpoint,clientNonce,serverNonce){
 const parts=[side==='server'?'wbipc-s':'wbipc-c','1',endpoint,clientNonce,serverNonce].map(value=>{const bytes=Buffer.from(value),length=Buffer.alloc(4);length.writeUInt32BE(bytes.length);return Buffer.concat([length,bytes]);});
 return createHmac('sha256',ticket).update(Buffer.concat(parts)).digest('base64url');
}
async function fixture(t,{badProof=false,channel='c:wb.request',body={code:0,data:{Packages:[{CycleRemainCapacity:'12.5'},{CycleRemainCapacity:7.25}]}},status=200,hang=false,huge=false,malformed=false}={}){
 const configDir=await mkdtemp(join(tmpdir(),'wb-balance-')),ticket=randomBytes(32).toString('base64url'),endpoint='\\\\.\\pipe\\wbipc-'+randomBytes(8).toString('hex'),frames=[],sockets=new Set();
 await mkdir(join(configDir,'wbipc'));await writeFile(join(configDir,'wbipc','endpoint.json'),JSON.stringify({endpoint,ticket}));
 const server=createServer(socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));let buffer='',clientNonce,serverNonce=randomBytes(16).toString('base64url');
  socket.on('data',bytes=>{buffer+=bytes;while(buffer.includes('\n')){const at=buffer.indexOf('\n'),frame=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);frames.push(frame);
   if(hang)continue;
   if(huge){socket.write('x'.repeat(1024*1024+1));continue;}
   if(malformed){socket.write('{invalid}\n');continue;}
   if(frame.type==='session_hello'){
    assert.equal(frame.protocol_min,1);assert.equal(frame.protocol_max,1);assert.equal(frame.ticket_id,createHash('sha256').update(ticket).digest('hex').slice(0,16));assert.equal(JSON.stringify(frame).includes(ticket),false);clientNonce=frame.client_nonce;
    const response=packet({type:'session_challenge',protocol:1,server_nonce:serverNonce,server_proof:badProof?'x'.repeat(43):proof(ticket,'server',endpoint,clientNonce,serverNonce)});socket.write(response.slice(0,15));socket.write(response.slice(15));
   }else if(frame.type==='session_prove'){
    assert.equal(frame.client_proof,proof(ticket,'client',endpoint,clientNonce,serverNonce));socket.write(packet({type:'session_hello_ack',protocol:1,connection_epoch:'ce-1234567812345678',max_inflight:8,pipes:[]}));
   }else if(frame.method==='broker/GetPipe'){
    assert.deepEqual(frame.params,{pipe:'wb.request'});socket.write(packet({jsonrpc:'2.0',id:frame.id,result:{channel,methods:['http.fetch']}}));
   }else{
    assert.equal(frame.method,'c:wb.request/http.fetch');assert.equal(frame.mode,'call');assert.deepEqual(frame.params,{method:'POST',path:'/billing/meter/get-user-resource-summary',headers:{'content-type':'application/json'},body_b64:'e30='});
    socket.write(packet({jsonrpc:'2.0',id:frame.id,result:{status,headers:{'content-type':'application/json'},body_b64:Buffer.from(JSON.stringify(body)).toString('base64')}}));
   }
  }});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});
 const balance=createWorkBuddyBalance({configDir,timeoutMs:500,platform:'win32',locale:'en'});
 t.after(async()=>{balance.dispose();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await rm(configDir,{recursive:true,force:true});});
 return{balance,frames,ticket,configDir,sockets};
}

test('官方WBIPC双向认证后仅调用固定账单读接口，分片回包并合并并发查询，不暴露ticket或伪造full',async t=>{
 const f=await fixture(t),results=await Promise.all([f.balance.fetch(),f.balance.fetch()]);
 for(const value of results){assert.deepEqual(value,{ok:true,provider:'workbuddy',shape:'points',data:{unit:'credits',total:'19.75'}});assert.doesNotMatch(JSON.stringify(value),new RegExp(f.ticket));assert.equal(value.data.full,undefined);}
 assert.equal(f.frames.filter(frame=>frame.method==='c:wb.request/http.fetch').length,1);
 await Promise.all([...f.sockets].map(socket=>once(socket,'close')));assert.equal(f.sockets.size,0);
});

test('服务端证明不匹配时不发送客户端证明或任何账单请求',async t=>{
 const f=await fixture(t,{badProof:true}),value=await f.balance.fetch();assert.equal(value.ok,false);assert.equal(value.reason,'fetch-error');assert.equal(f.frames.length,1);assert.doesNotMatch(JSON.stringify(value),new RegExp(f.ticket));
});

test('不接受服务端替换通道、HTTP错误或业务错误，全部显示未知且不重试其他API',async t=>{
 for(const options of [{channel:'c:other'},{status:401},{body:{code:1001,data:{Packages:[{CycleRemainCapacity:999}]}}}]){
  const f=await fixture(t,options),value=await f.balance.fetch();assert.equal(value.ok,false);assert.equal(f.frames.filter(frame=>frame.method==='c:wb.request/http.fetch').length,options.channel?0:1);
 }
});

test('超长或坏帧、超时和dispose均关闭连接，不把原始错误或账单正文回传',async t=>{
 for(const options of [{huge:true},{malformed:true},{hang:true}]){
  const f=await fixture(t,options),value=await f.balance.fetch();assert.equal(value.ok,false);assert.doesNotMatch(JSON.stringify(value),/invalid|wbipc-|Packages|[\u3400-\u9fff]/);
 }
 const f=await fixture(t,{hang:true}),pending=f.balance.fetch();await new Promise(resolve=>setTimeout(resolve,20));f.balance.dispose();assert.equal((await pending).ok,false);assert.equal((await f.balance.fetch()).ok,false);
});

test('发现文件缺失、目录链接或端点指向TCP和远程管道时不建立连接',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'wb-balance-untrusted-'));t.after(()=>rm(dir,{recursive:true,force:true}));let connected=0;
 const run=()=>createWorkBuddyBalance({configDir:dir,platform:'win32',connect:()=>{connected++;throw Error('must not connect');},locale:'en'}).fetch();assert.equal((await run()).ok,false);
 await mkdir(join(dir,'wbipc'));for(const endpoint of ['127.0.0.1:8080','\\\\server\\pipe\\wbipc-1234567812345678','\\\\.\\pipe\\other-1234567812345678']){await writeFile(join(dir,'wbipc','endpoint.json'),JSON.stringify({endpoint,ticket:'a'.repeat(43)}));assert.equal((await run()).ok,false);}assert.equal(connected,0);
 const outside=await mkdtemp(join(tmpdir(),'wb-balance-linked-'));t.after(()=>rm(outside,{recursive:true,force:true}));await rm(join(dir,'wbipc'),{recursive:true});await symlink(outside,join(dir,'wbipc'),process.platform==='win32'?'junction':'dir');assert.equal((await run()).ok,false);assert.equal(connected,0);
});

test('积分只累加明示的个人剩余，零值保留，缺项和异常数值不转成0或百分比',()=>{
 assert.deepEqual(parseWorkBuddyBalance({code:0,data:{Packages:[{CycleRemainCapacity:0}] }},'zh-CN'),{ok:true,provider:'workbuddy',shape:'points',data:{unit:'积分',total:'0'}});
 assert.equal(parseWorkBuddyBalance({code:0,data:{Packages:[]}},'en').data.total,'0');
 for(const value of [{}, {code:1,data:{Packages:[]}}, {data:{Packages:[{}]}}, {data:{Packages:[{CycleRemainCapacity:null}]}}, {data:{Packages:[{CycleRemainCapacity:-1}]}}, {data:{Packages:[{CycleRemainCapacity:'NaN'}]}}])assert.throws(()=>parseWorkBuddyBalance(value,'en'),/invalid_balance/);
 assert.equal(parseWorkBuddyBalance({data:{Packages:[{CycleRemainCapacity:'0.1'},{CycleRemainCapacity:'0.2',CycleTotalCapacity:100000}] }},'en').data.total,'0.3');
});
