import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,lstat,mkdir,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const VERIFIED=Object.freeze({desktopVersion:'5.9.3',cliVersion:'2.165.0'});
const MARKET='codex-pet-workbuddy',PLUGIN='codex-pet-companion@'+MARKET;
const HOOK_FILES=['hook-event.mjs','hooks/hooks.json','hooks/report.mjs','hooks/report.ps1'];
const execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&resolve(a).toLowerCase()===resolve(b).toLowerCase();
const version=value=>typeof value==='string'&&/^\d+\.\d+\.\d+(?:[.+-][A-Za-z0-9.-]+)?$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=reason=>{throw Error(reason);};
async function info(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}

/** 只沿已登记的有限路径读取；不跟随junction或symlink，不遍历用户目录。 */
async function scopedFile(file,boundary,maxBytes=1024*1024){
 const rel=relative(boundary,file);
 if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))fail('managed-registration-invalid');
 let cursor=boundary;
 for(const part of ['',...rel.split(sep).slice(0,-1).filter(Boolean)]){
  if(part)cursor=join(cursor,part);
  const item=await info(cursor);if(!item)throw Object.assign(Error('missing-file'),{code:'ENOENT'});
  if(!item.isDirectory()||item.isSymbolicLink())fail('managed-path-unavailable');
 }
 const item=await info(file);if(!item)throw Object.assign(Error('missing-file'),{code:'ENOENT'});
 if(!item.isFile()||item.isSymbolicLink()||item.size>maxBytes)fail('managed-file-unavailable');
 return item;
}
async function bytes(file,boundary,maxBytes){await scopedFile(file,boundary,maxBytes);return readFile(file);}
async function json(file,boundary,maxBytes=65536){return JSON.parse((await bytes(file,boundary,maxBytes)).toString('utf8'));}

async function runCommand(file,args){
 try{return{code:0,stdout:(await execute(file,args,{windowsHide:true,shell:false,encoding:'utf8',timeout:8000,maxBuffer:8192})).stdout};}
 catch{return{code:1,stdout:''};}
}
async function desktopMetadata(executable,run,env){
 // 使用固定布尔结果和文件版本；证书正文、路径、账号配置不进入报告。
 const literal="'"+executable.replaceAll("'","''")+"'";
 const source=`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
try {
 # 桌面宿主可能继承PS7的模块路径，证书读取明确使用系统PS5.1自带模块。
 Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
 $p=${literal}; $v=[Diagnostics.FileVersionInfo]::GetVersionInfo($p); $s=Get-AuthenticodeSignature -LiteralPath $p
 $signer=$false; if($s.SignerCertificate){$signer=$s.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) -ieq 'Tencent Technology (Shenzhen) Company Limited'}
 @{status='known';version=[string]$v.FileVersion;productMatched=($v.ProductName -ieq 'WorkBuddy');publisherMatched=($v.CompanyName -ieq 'Tencent Technology (Shenzhen) Company Limited');signatureValid=([string]$s.Status -eq 'Valid');signerMatched=$signer} | ConvertTo-Json -Compress
} catch { @{status='unknown'} | ConvertTo-Json -Compress }`;
 const powershell=join(env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const result=await run(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')]);
 if(result.code!==0)fail('desktop-metadata-unavailable');
 let value;try{value=JSON.parse(result.stdout);}catch{fail('desktop-metadata-unavailable');}
 if(value.status!=='known'||!version(value.version))fail('desktop-metadata-unavailable');
 if(![value.productMatched,value.publisherMatched,value.signatureValid,value.signerMatched].every(item=>item===true))fail('desktop-identity-unconfirmed');
 return value.version;
}
function safeObservation(value){
 if(!value||!version(value.desktopVersion)||!version(value.cliVersion)||!version(value.hookVersion)||!sha(value.hookDigest)||value.hookFileCount!==HOOK_FILES.length||typeof value.observedAt!=='string'||!Number.isFinite(Date.parse(value.observedAt)))return null;
 return{desktopVersion:value.desktopVersion,cliVersion:value.cliVersion,hookVersion:value.hookVersion,hookDigest:value.hookDigest,hookFileCount:HOOK_FILES.length,observedAt:value.observedAt};
}
const fingerprint=value=>value?JSON.stringify([value.desktopVersion,value.cliVersion,value.hookVersion,value.hookDigest]):null;

async function inspect(root,{platform,run,env,at}){
 const managed=join(root,'data/workbuddy-plugin'),stampFile=join(managed,'.codex-pet-workbuddy.json');
 if(!await info(stampFile))return{status:'not-installed',reason:'managed-installation-unregistered',observed:null};
 const stamp=await json(stampFile,root);
 const target=join(managed,'marketplace');
 if(stamp.schemaVersion!==1||!same(stamp.appRoot,root)||!same(stamp.marketplaceRoot,target)||typeof stamp.workBuddyHome!=='string'||!isAbsolute(stamp.workBuddyHome)||typeof stamp.workBuddyExe!=='string'||!isAbsolute(stamp.workBuddyExe)||basename(stamp.workBuddyExe).toLowerCase()!=='workbuddy.exe')fail('managed-registration-invalid');
 const executable=stamp.workBuddyExe,clientRoot=dirname(executable),home=stamp.workBuddyHome;
 if(!await info(executable))return{status:'not-installed',reason:'registered-executable-missing',observed:null};
 await scopedFile(executable,clientRoot,1024*1024*1024);
 if(platform!=='win32')fail('windows-metadata-unavailable');
 const desktopVersion=await desktopMetadata(executable,run,env);
 const cliRoot=join(clientRoot,'resources/app.asar.unpacked/cli');
 const cli=await json(join(cliRoot,'package.json'),clientRoot),product=await json(join(cliRoot,'product.json'),clientRoot,1024*1024);
 if(cli.name!=='@genie/agent-cli'||!version(cli.version)||product.productName!=='WorkBuddy')fail('bundled-cli-unconfirmed');
 await scopedFile(join(cliRoot,'bin/codebuddy'),clientRoot);
 const registry=await json(join(home,'plugins/known_marketplaces.json'),home,1024*1024),entry=registry[MARKET];
 if(entry?.source?.source!=='directory'||!same(entry.source.path,target)||!same(entry.installLocation,target))fail('managed-marketplace-unconfirmed');
 const installed=await json(join(home,'plugins/installed_plugins.json'),home,1024*1024);
 const records=installed?.plugins?.[PLUGIN];
 const users=Array.isArray(records)?records.filter(item=>item.scope==='user'):[];
 if(!users.length)fail('managed-hook-not-installed');
 if(users.length!==1||!version(users[0].version))fail('managed-hook-registration-invalid');
 const record=users[0],cache=join(home,'plugins/cache',MARKET,'codex-pet-companion',record.version);
 if(!same(record.installPath,cache))fail('managed-hook-registration-invalid');
 const manifest=await json(join(root,'workbuddy/plugin/.codebuddy-plugin/plugin.json'),root);
 if(record.version!==manifest.version)fail('managed-hook-version-mismatch');
 const digests=[];
 for(const name of HOOK_FILES){
  const sourceHash=hash(await bytes(join(root,'workbuddy/plugin',name),root));
  const managedHash=hash(await bytes(join(target,'plugin',name),root));
  const cacheHash=hash(await bytes(join(cache,name),home));
  if(![managedHash,cacheHash,stamp.files?.['plugin/'+name],stamp.cacheFiles?.['plugin/'+name]].every(value=>value===sourceHash))fail('hook-digest-mismatch');
  digests.push(name+':'+sourceHash);
 }
 const observed={desktopVersion,cliVersion:cli.version,hookVersion:record.version,hookDigest:hash(digests.join('\n')),hookFileCount:HOOK_FILES.length,observedAt:at};
 const matched=desktopVersion===VERIFIED.desktopVersion&&cli.version===VERIFIED.cliVersion;
 return{status:matched?'passed':'candidate',reason:matched?'verified-versions-and-hooks-match':'unreviewed-version',observed};
}

/** 日检只收集版本和自有Hook摘要；新版本仅列候选，不执行测试、CLI、模型或升级接受。 */
export async function checkWorkBuddyCompatibility({root=ROOT,platform=process.platform,env=process.env,runCommand:run=runCommand,now=()=>new Date()}={}){
 root=resolve(root);const data=join(root,'data'),reportFile=join(data,'workbuddy-compatibility-report.json');
 const directory=await info(data);
 if(directory&&(!directory.isDirectory()||directory.isSymbolicLink()))fail('unsafe-report-directory');
 if(!directory)await mkdir(data);
 let previous=null;
 try{previous=await json(reportFile,root);}catch(error){if(error.message==='managed-file-unavailable'||error.message==='managed-path-unavailable')throw error;}
 const checkedAt=now().toISOString();let result;
 try{result=await inspect(root,{platform,run,env,at:checkedAt});}
 catch(error){
  const reasons=new Set(['managed-registration-invalid','managed-path-unavailable','managed-file-unavailable','windows-metadata-unavailable','desktop-metadata-unavailable','desktop-identity-unconfirmed','bundled-cli-unconfirmed','managed-marketplace-unconfirmed','managed-hook-not-installed','managed-hook-registration-invalid','managed-hook-version-mismatch','hook-digest-mismatch']);
  result={status:'unknown',reason:reasons.has(error.message)?error.message:'registered-installation-unavailable',observed:null};
 }
 const observed=result.observed,lastSuccessful=safeObservation(previous?.lastSuccessfulObservation),oldObserved=safeObservation(previous?.observed);
 const passed=result.status==='passed',candidate=result.status==='candidate'?observed:safeObservation(previous?.candidate);
 const report={schemaVersion:1,checkedAt,status:result.status,reason:result.reason,changed:previous?.status!==result.status||previous?.reason!==result.reason||fingerprint(oldObserved)!==fingerprint(observed),needsReview:['unknown','candidate'].includes(result.status),verified:{...VERIFIED},observed,candidate:passed?null:candidate,lastSuccessfulObservation:passed?(fingerprint(lastSuccessful)===fingerprint(observed)?lastSuccessful:observed):lastSuccessful};
 // 输出仅由固定字段重建，不沿用登记/旧报告中的未知字段或本机路径。
 const existing=await info(reportFile);if(existing&&(!existing.isFile()||existing.isSymbolicLink()))fail('unsafe-report-file');
 const temporary=reportFile+'.tmp-'+randomUUID();await writeFile(temporary,JSON.stringify(report,null,2)+'\n',{flag:'wx'});await rename(temporary,reportFile);
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.slice(2).length){console.error('unsupported-argument');process.exitCode=1;}
 else try{const report=await checkWorkBuddyCompatibility();console.log(JSON.stringify({status:report.status,changed:report.changed,needsReview:report.needsReview,reason:report.reason,verified:report.verified,observed:report.observed}));if(report.status==='unknown')process.exitCode=1;}
 catch{console.error('workbuddy-compatibility-report-unavailable');process.exitCode=1;}
}
