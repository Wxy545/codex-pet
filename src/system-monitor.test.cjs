'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {spawn}=require('node:child_process');
const {createSystemMonitor,createWindowsGpuProbe,aggregateGpuSample}=require('./system-monitor.cjs');

function clock(){let time=0,id=0;const tasks=new Map();return{now:()=>time,setTimeout(fn,ms){const token={id:++id,unref(){}};tasks.set(token,{fn,at:time+ms});return token;},clearTimeout(token){tasks.delete(token);},advance(ms){const end=time+ms;for(;;){const next=[...tasks].filter(([,value])=>value.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;tasks.delete(next[0]);next[1].fn();}time=end;},pending:()=>tasks.size};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function child(){const value=new EventEmitter();value.stdout=new PassThrough();value.stderr=new PassThrough();value.stdin=new PassThrough();value.commands='';value.stdin.on('data',data=>{value.commands+=data;});value.kills=0;value.kill=()=>{value.kills++;value.emit('close',null);return true;};return value;}
const adapter='0x00000000_0x0000abcd_phys_0',other='0x00000000_0x00001234_phys_0';

test('CPU使用所有逻辑核两次差分，首样本未知，物理内存按真实总量和空闲量计算',async()=>{
 const c=clock();let tick=0;const cpu=()=>[{times:{user:100+tick*30,nice:0,sys:100+tick*20,idle:800+tick*50,irq:0}},{times:{user:200+tick*10,nice:0,sys:100+tick*10,idle:700+tick*80,irq:0}}];
 const monitor=createSystemMonitor({platform:'linux',osImpl:{cpus:cpu,totalmem:()=>8*1024**3,freemem:()=>2*1024**3},now:c.now,setTimeoutImpl:c.setTimeout,clearTimeoutImpl:c.clearTimeout});
 monitor.start();assert.equal(monitor.snapshot().cpuPercent,null);assert.equal(monitor.snapshot().memory.percent,75);assert.equal(monitor.snapshot().memory.usedBytes,6*1024**3);
 tick=1;c.advance(2000);assert.equal(monitor.snapshot().cpuPercent,35);assert.equal(monitor.snapshot().gpu,null);monitor.stop();assert.equal(c.pending(),0);
});

test('CPU计数回退或内存读取失败是unknown，下一次有效采样能恢复，调用者不能改缓存',()=>{
 const c=clock();let total=100,idle=50,bad=false;const monitor=createSystemMonitor({platform:'linux',osImpl:{cpus:()=>[{times:{user:total-idle,idle}}],totalmem:()=>1000,freemem:()=>{if(bad)throw Error('private detail');return 250;}},now:c.now,setTimeoutImpl:c.setTimeout,clearTimeoutImpl:c.clearTimeout});
 monitor.start();total=50;idle=30;bad=true;c.advance(2000);assert.equal(monitor.snapshot().cpuPercent,null);assert.equal(monitor.snapshot().memory,null);
 total=150;idle=70;bad=false;c.advance(2000);assert.equal(monitor.snapshot().cpuPercent,60);const view=monitor.snapshot();view.memory.percent=0;assert.equal(monitor.snapshot().memory.percent,75);monitor.stop();
});

test('GPU同物理引擎跨进程累加，然后选最忙引擎而非跨引擎或跨GPU求和',()=>{
 const value=aggregateGpuSample({engines:[{adapter,engine:0,percent:25},{adapter,engine:0,percent:35},{adapter,engine:1,percent:45},{adapter:other,engine:0,percent:80}],memory:[{adapter,usedBytes:1024**3},{adapter:other,usedBytes:2*1024**3}]});
 assert.deepEqual(value,{percent:80,dedicatedUsedBytes:3*1024**3});
 assert.equal(aggregateGpuSample({engines:[{adapter,engine:0,percent:70},{adapter,engine:0,percent:50}],memory:[]}).percent,100);
});

test('不支持和非法GPU数据不伪造0，真实零计数可显示0，显存重复实例不重复累计',()=>{
 assert.equal(aggregateGpuSample(null),null);assert.equal(aggregateGpuSample({engines:[],memory:[]}),null);
 assert.equal(aggregateGpuSample({engines:[{adapter:'unknown',engine:0,percent:0}],memory:[]}),null);
 assert.deepEqual(aggregateGpuSample({engines:[{adapter,engine:0,percent:0}],memory:[]}),{percent:0,dedicatedUsedBytes:null});
 assert.deepEqual(aggregateGpuSample({engines:[],memory:[{adapter,usedBytes:100},{adapter,usedBytes:100},{adapter:other,usedBytes:200}]}),{percent:null,dedicatedUsedBytes:300});
});

test('GPU worker长驻复用且单飞，固定stdin协议，结果不透传实例身份',async()=>{
 const c=clock(),children=[],starts=[];const probe=createWindowsGpuProbe({platform:'win32',now:c.now,setTimeoutImpl:c.setTimeout,clearTimeoutImpl:c.clearTimeout,spawnImpl:(file,args,options)=>{const value=child();children.push(value);starts.push({file,args,options});return value;}});
 const first=probe.sample(),same=probe.sample();assert.strictEqual(first,same);assert.equal(children.length,1);assert.equal(children[0].commands,'sample\n');
 children[0].stdout.write(JSON.stringify({engines:[{adapter,engine:0,percent:42}],memory:[]})+'\n');assert.deepEqual(await first,{percent:42,dedicatedUsedBytes:null});
 const second=probe.sample();assert.equal(children.length,1);children[0].stdout.write('{"engines":[],"memory":[]}\n');assert.equal(await second,null);
 assert.equal(starts[0].options.shell,false);assert.equal(starts[0].options.windowsHide,true);assert.ok(starts[0].args.includes('-NoProfile'));assert.ok(starts[0].args.includes('-NonInteractive'));
 probe.close();assert.equal(children[0].kills,1);assert.equal(c.pending(),0);
});

test('GPU超时、进程退出和超量输出都清理自有worker，迟到数据不能恢复旧请求',async()=>{
 for(const kind of ['timeout','exit','oversize','invalid']){
  const c=clock(),children=[];const probe=createWindowsGpuProbe({platform:'win32',timeoutMs:5000,setTimeoutImpl:c.setTimeout,clearTimeoutImpl:c.clearTimeout,spawnImpl:()=>{const value=child();children.push(value);return value;}});
  const pending=probe.sample();if(kind==='timeout')c.advance(5000);if(kind==='exit')children[0].emit('close',1);if(kind==='oversize')children[0].stdout.write('x'.repeat(1024*1024+1));if(kind==='invalid')children[0].stdout.write('not-json\n');
  assert.equal(await pending,null,kind);assert.equal(c.pending(),0,kind);children[0].stdout.write(JSON.stringify({engines:[{adapter,engine:0,percent:99}]})+'\n');probe.close();
 }
});

test('超时worker尚未退出时不再创建进程，收到close后才能恢复探测',async()=>{
 const c=clock(),children=[];const probe=createWindowsGpuProbe({platform:'win32',setTimeoutImpl:c.setTimeout,clearTimeoutImpl:c.clearTimeout,spawnImpl:()=>{const value=child();value.kill=()=>{value.kills++;return true;};children.push(value);return value;}});
 const first=probe.sample();c.advance(5000);assert.equal(await first,null);const blocked=probe.sample();assert.equal(children.length,1);assert.equal(await blocked,null);
 children[0].emit('close',null);const next=probe.sample();assert.equal(children.length,2);children[1].stdout.write('{"engines":[],"memory":[]}\n');assert.equal(await next,null);probe.close();
});

test('原生PowerShell worker不把CIM缺失读数强转0，保留实际零值',{skip:process.platform!=='win32',timeout:30000},async t=>{
 const fake=String.raw`
$script:phase = 0
function Get-CimInstance {
 [CmdletBinding()] param([string]$ClassName,[string[]]$Property)
 if ($ClassName -like '*_GPUEngine') {
  $script:phase++
  $value = $null
  if ($script:phase -ge 3) { $value = 0 }
  [pscustomobject]@{ Name = 'pid_1_luid_0x00000000_0x0000abcd_phys_0_eng_0_engtype_3D'; UtilizationPercentage = $value }
 } else {
  $value = $null
  if ($script:phase -ge 3) { $value = 0 }
  [pscustomobject]@{ Name = 'luid_0x00000000_0x0000abcd_phys_0'; DedicatedUsage = $value }
 }
}
`;
 // 本例验证真实PowerShell的空值/零值转换；CIM已替身，不加载无关模块或测宿主冷启动速度。
 // 生产5秒采样上限另有虚拟时钟回归，这里只给原生测试进程独立的启动余量。
 let frames=0;
 const probe=createWindowsGpuProbe({timeoutMs:15000,spawnImpl:(file,args,options)=>{
  const values=[...args],index=values.indexOf('-EncodedCommand')+1,script=Buffer.from(values[index],'base64').toString('utf16le');
  const moduleLine="Import-Module (Join-Path $PSHOME 'Modules\\CimCmdlets\\CimCmdlets.psd1') -ErrorAction Stop";
  assert.equal(script.split(moduleLine).length,2);values[index]=Buffer.from(script.replace(moduleLine,fake),'utf16le').toString('base64');
  const worker=spawn(file,values,options);worker.stdout.on('data',data=>{frames+=data.toString('utf8').split('\n').length-1;});return worker;
 }});t.after(()=>probe.close());
 assert.equal(await probe.sample(),null);assert.equal(frames,1,'首个空值必须来自worker回复，不能把超时算作空值样本');
 assert.equal(await probe.sample(),null);assert.equal(frames,2);
 assert.deepEqual(await probe.sample(),{percent:0,dedicatedUsedBytes:0});assert.equal(frames,3);
});

test('监控GPU约8秒采一次、不阻塞2秒CPU；关闭阻止迟到结果，监听器异步异常被吸收',async()=>{
 const c=clock();let gpuCalls=0,resolveGpu,closed=0;const probe={sample(){gpuCalls++;return new Promise(resolve=>{resolveGpu=resolve;});},close(){closed++;}};
 const monitor=createSystemMonitor({platform:'win32',gpuProbe:probe,osImpl:{cpus:()=>[{times:{idle:100,user:100}}],totalmem:()=>1000,freemem:()=>500},now:c.now,setTimeoutImpl:c.setTimeout,clearTimeoutImpl:c.clearTimeout});
 const values=[];const unsubscribe=monitor.subscribe(value=>{values.push(value);return Promise.reject(Error('synthetic listener failure'));});monitor.start();assert.equal(gpuCalls,1);
 c.advance(10000);assert.equal(gpuCalls,1);assert.equal(monitor.snapshot().sampledAt,10000);resolveGpu({percent:20,dedicatedUsedBytes:0});await flush();assert.equal(monitor.snapshot().gpu.percent,20);
 c.advance(6000);assert.equal(gpuCalls,2);monitor.stop();resolveGpu({percent:99,dedicatedUsedBytes:0});await flush();assert.equal(monitor.snapshot().gpu.percent,20);assert.equal(closed,1);unsubscribe();assert.equal(c.pending(),0);assert.ok(values.length>=6);
});
