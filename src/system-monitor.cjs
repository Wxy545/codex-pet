'use strict';
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');

// CIM实例名只在worker内解析为适配器/引擎编号；不读取窗口、进程正文或用户文件。
const GPU_SCRIPT=String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# 输出仅包含固定JSON字段、数值和ASCII适配器编号，无需修改宿主控制台编码。
# 使用系统内置模块的绝对路径，避免精简环境触发用户模块发现；路径拼接本身也不依赖模块自动加载。
Import-Module ([System.IO.Path]::Combine($PSHOME, 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
Import-Module ([System.IO.Path]::Combine($PSHOME, 'Modules\CimCmdlets\CimCmdlets.psd1')) -ErrorAction Stop
$warmed = $false
while (($line = [Console]::ReadLine()) -ne $null) {
 if ($line -ne 'sample') { continue }
 $engines = @()
 $memory = @()
 try {
  $engines = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Property Name,UtilizationPercentage -ErrorAction Stop | Group-Object -Property Name | ForEach-Object {
   $values = @($_.Group | Where-Object { $null -ne $_.UtilizationPercentage })
   if ($values.Count -gt 0 -and $_.Name -match '^pid_\d+_luid_(0x[0-9a-f]+_0x[0-9a-f]+_phys_\d+)_eng_(\d+)_engtype_.+$') {
    @{ adapter = $Matches[1].ToLowerInvariant(); engine = [int]$Matches[2]; percent = [double](($values | Measure-Object -Property UtilizationPercentage -Maximum).Maximum) }
   }
  })
 } catch { $engines = @() }
 try {
  $memory = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -Property Name,DedicatedUsage -ErrorAction Stop | ForEach-Object {
   if ($null -ne $_.DedicatedUsage -and $_.Name -match '^luid_(0x[0-9a-f]+_0x[0-9a-f]+_phys_\d+)$') {
    @{ adapter = $Matches[1].ToLowerInvariant(); usedBytes = [double]$_.DedicatedUsage }
   }
  })
 } catch { $memory = @() }
 # 首次/重启后的利用率样本只预热；显存用量是瞬时值，可独立报告。
 if (-not $warmed) { $engines = @(); $warmed = $true }
 [Console]::WriteLine((@{ engines = $engines; memory = $memory } | ConvertTo-Json -Compress -Depth 4))
}
`;
const adapterId=/^0x[0-9a-f]+_0x[0-9a-f]+_phys_\d+$/i;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const percent=value=>Math.round(Math.max(0,Math.min(100,value))*10)/10;

/** 同物理GPU的同一引擎先合并进程计数，最后取最忙引擎；专用显存只报已用量。 */
function aggregateGpuSample(value){
 if(!value||typeof value!=='object'||!Array.isArray(value.engines)||!Array.isArray(value.memory))return null;
 const engines=new Map(),memory=new Map();
 for(const item of value.engines){
  if(!item||!adapterId.test(item.adapter)||!Number.isInteger(item.engine)||item.engine<0||!finite(item.percent)||item.percent<0)continue;
  const key=item.adapter.toLowerCase()+':'+item.engine;engines.set(key,(engines.get(key)||0)+item.percent);
 }
 for(const item of value.memory){
  if(!item||!adapterId.test(item.adapter)||!Number.isSafeInteger(item.usedBytes)||item.usedBytes<0)continue;
  // 同一适配器的重复行不再次累计；从adapter级计数器求和，避免进程共享显存双计。
  const key=item.adapter.toLowerCase();memory.set(key,Math.max(memory.get(key)||0,item.usedBytes));
 }
 if(!engines.size&&!memory.size)return null;
 const dedicated=[...memory.values()].reduce((sum,bytes)=>sum+bytes,0);
 return{percent:engines.size?percent(Math.max(...engines.values())):null,dedicatedUsedBytes:memory.size&&Number.isSafeInteger(dedicated)?dedicated:null};
}

/** 只保留一个PowerShell进程；每次固定sample请求单飞，超时后结束本worker。 */
function createWindowsGpuProbe({platform=process.platform,spawnImpl=spawn,timeoutMs=5000,setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout,systemRoot=process.env.SystemRoot||'C:\\Windows'}={}){
 let worker=null,retiring=null,pending=null,closed=false;
 const clear=()=>{if(pending?.timer)clearTimeoutImpl(pending.timer);};
 function finish(value){const current=pending;if(!current)return;clear();pending=null;current.resolve(value);}
 function discard(value){if(worker===value)worker=null;retiring=value;try{value.stdin?.end();}catch{}try{value.kill();}catch{}}
 function fail(value){finish(null);discard(value);}
 function create(){
  const file=path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const child=spawnImpl(file,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(GPU_SCRIPT,'utf16le').toString('base64')],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{SystemRoot:systemRoot,WINDIR:systemRoot,SystemDrive:path.win32.parse(systemRoot).root.replace(/\\$/,''),TEMP:process.env.TEMP||systemRoot,TMP:process.env.TMP||systemRoot}});
  worker=child;
  child.stdout.on('data',data=>{
   if(worker!==child||!pending)return;
   pending.buffer+=data.toString('utf8');if(Buffer.byteLength(pending.buffer)>1024*1024)return fail(child);
   const newline=pending.buffer.indexOf('\n');if(newline<0)return;
   const text=pending.buffer.slice(0,newline).replace(/^\uFEFF/,'').trim(),extra=pending.buffer.slice(newline+1).trim();
   try{const result=aggregateGpuSample(JSON.parse(text));finish(result);if(extra)discard(child);}catch{fail(child);}
  });
  child.stderr.on('data',()=>{});
  child.stdin.on('error',()=>{if(worker===child)fail(child);});
  child.on('error',()=>{if(worker===child)fail(child);});
  child.on('close',()=>{if(retiring===child)retiring=null;if(worker===child){worker=null;finish(null);}});
  return child;
 }
 function sample(){
  if(closed||platform!=='win32'||retiring)return Promise.resolve(null);
  if(pending)return pending.promise;
  let resolve;const promise=new Promise(done=>{resolve=done;});pending={promise,resolve,buffer:'',timer:null};
  let child;
  try{child=worker||create();pending.timer=setTimeoutImpl(()=>{if(worker===child)fail(child);},timeoutMs);pending.timer?.unref?.();child.stdin.write('sample\n');}catch{finish(null);if(child)discard(child);}
  return promise;
 }
 function close(){if(closed)return;closed=true;finish(null);if(worker)discard(worker);}
 return{sample,close};
}

function readCpu(osImpl){
 try{
  const cores=osImpl.cpus();if(!Array.isArray(cores)||!cores.length)return null;let idle=0,total=0;
  for(const core of cores){const times=core?.times;if(!times||!finite(times.idle))return null;for(const value of Object.values(times)){if(!finite(value)||value<0)return null;total+=value;}idle+=times.idle;}
  return{idle,total,count:cores.length};
 }catch{return null;}
}
function readMemory(osImpl){
 try{const totalBytes=osImpl.totalmem(),freeBytes=osImpl.freemem();if(!finite(totalBytes)||totalBytes<=0||!finite(freeBytes)||freeBytes<0||freeBytes>totalBytes)return null;const usedBytes=totalBytes-freeBytes;return{usedBytes,totalBytes,percent:percent(usedBytes/totalBytes*100)};}catch{return null;}
}

function createSystemMonitor({platform=process.platform,osImpl=os,gpuProbe,spawnImpl=spawn,now=Date.now,setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout,intervalMs=2000,gpuIntervalMs=8000,gpuTimeoutMs=5000}={}){
 let state={sampledAt:null,cpuPercent:null,memory:null,gpu:null},running=false,timer=null,previous=null,probe=null,gpuPending=false,nextGpuAt=0,epoch=0;
 const listeners=new Set(),copy=()=>structuredClone(state);
 const notify=()=>{for(const listener of listeners)try{Promise.resolve(listener(copy())).catch(()=>{});}catch{}};
 function tick(){
  if(!running)return;const cpu=readCpu(osImpl),time=now();let cpuPercent=null;
  if(cpu&&previous&&cpu.count===previous.count){const total=cpu.total-previous.total,idle=cpu.idle-previous.idle;if(total>0&&idle>=0&&idle<=total)cpuPercent=percent((total-idle)/total*100);}
  previous=cpu;state={...state,sampledAt:time,cpuPercent,memory:readMemory(osImpl)};notify();
  if(platform==='win32'&&!gpuPending&&time>=nextGpuAt){
   const version=epoch;gpuPending=true;nextGpuAt=time+gpuIntervalMs;
   let request;try{request=probe.sample();}catch{request=Promise.reject(new Error('gpu-unavailable'));}
   Promise.resolve(request).then(value=>{if(!running||epoch!==version)return;state={...state,gpu:value?{...value,sampledAt:now()}:null};notify();},()=>{if(running&&epoch===version){state={...state,gpu:null};notify();}}).finally(()=>{if(epoch===version)gpuPending=false;});
  }
  timer=setTimeoutImpl(tick,intervalMs);timer?.unref?.();
 }
 function start(){
  if(running)return;running=true;epoch++;previous=null;gpuPending=false;nextGpuAt=0;state={sampledAt:null,cpuPercent:null,memory:null,gpu:null};
  probe=gpuProbe||createWindowsGpuProbe({platform,spawnImpl,timeoutMs:gpuTimeoutMs,setTimeoutImpl,clearTimeoutImpl});tick();
 }
 function stop(){if(!running)return;running=false;epoch++;if(timer)clearTimeoutImpl(timer);timer=null;probe?.close();probe=null;gpuPending=false;previous=null;}
 function subscribe(listener){if(typeof listener!=='function')throw new TypeError('listener required');listeners.add(listener);try{Promise.resolve(listener(copy())).catch(()=>{});}catch{}return()=>listeners.delete(listener);}
 return{start,stop,snapshot:copy,subscribe};
}
module.exports={createSystemMonitor,createWindowsGpuProbe,aggregateGpuSample};
