import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import {basename,delimiter,dirname,isAbsolute,join,resolve,relative,sep} from 'node:path';
import {createAcpRemote,remoteError,reviewRemoteTool as reviewGuard,terminateRemoteChild} from './acp-remote.mjs';

const VERSIONS=new Set(['0.2.1-rc.2','0.2.1-rc.5']);
const profileName=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const file=path=>{try{const s=lstatSync(path);return s.isFile()&&!s.isSymbolicLink();}catch{return false;}};
const inside=(root,target)=>{const r=relative(root,target);return !isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);};
function json(path,limit=65536){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>limit)throw remoteError('invalid_native_registration');return JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));}
function validateNative(native){
  if(!native||!isAbsolute(native.command??'')||!isAbsolute(native.home??'')||!file(native.command)||!/^dsh(?:\.cmd|\.exe)?$/i.test(basename(native.command))||!profileName.test(native.profile??'')||!VERSIONS.has(native.version))throw remoteError('not_installed');
  if(native.args!==undefined&&(!Array.isArray(native.args)||native.args.length))throw remoteError('invalid_native_options');
  try{const s=lstatSync(native.home);if(!s.isDirectory()||s.isSymbolicLink())throw Error();if(!file(join(native.home,'profiles',native.profile,'package.json')))throw Error();}catch{throw remoteError('not_installed');}
  return{command:realpathSync(native.command),home:realpathSync(native.home),profile:native.profile,version:native.version};
}

/** Harness 的正式移交记录与审计目录分开；不读取任何凭据或会话日志。 */
export function resolveHarnessNative({dataRoot,projectRoot}={}){
  if(!isAbsolute(dataRoot??'')||!isAbsolute(projectRoot??''))throw remoteError('not_installed');
  try{
    const record=json(join(dataRoot,'harness-link.json'),8192);
    if(record.schemaVersion!==1||!isAbsolute(record.command??'')||inside(projectRoot,record.command)||!isAbsolute(record.home??'')||inside(dataRoot,record.home))throw Error();
    const native=validateNative(record),profile=json(join(native.home,'profiles',native.profile,'package.json'));
    const plugin=json(join(native.home,'profiles',native.profile,'node_modules/codex-pet-harness/package.json'));
    if(profile.dependencies?.['dsh-pet']!=='0.3.8'||!profile.dsh?.profile?.bundles?.includes('codex-pet-harness')||plugin.name!=='codex-pet-harness')throw Error();return native;
  }catch{throw remoteError('not_installed');}
}

function commandSpec(native,args,env){
  if(process.platform!=='win32'||!native.command.toLowerCase().endsWith('.cmd'))return{command:native.command,args,env};
  // cmd shim 由 PowerShell 逐个引号保护调用；不启用 shell，也不把用户正文放到命令行。
  const literal=value=>"'"+value.replaceAll("'","''")+"'";
  const source='& '+[native.command,...args].map(literal).join(' ')+'\nexit $LASTEXITCODE';
  return{command:join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),args:['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],env};
}

function location(native,cwd,permission){
  if(!['read-only','workspace-write'].includes(permission)||!isAbsolute(cwd??''))throw remoteError('invalid_permission');
  let root;try{root=realpathSync(cwd);if(!lstatSync(root).isDirectory())throw Error();}catch{throw remoteError('invalid_cwd');}
  const hash=createHash('sha256').update(root+'\0'+permission+'\0'+native.version).digest('hex').slice(0,18),profile='codex-pet-qq-'+hash;
  return{root,profile,directory:join(native.home,'profiles',profile)};
}
const disabled=['plugin-manager','tool-plugin-manager','hmr','config-editor','tool-working-directory','tool-fs-search','tool-bash','tool-pwsh','tool-jobs','tool-skill','tool-subagent-control','tool-subagent-list-agents','tool-subagent','tool-subagent-fork','workflow-ptc','tool-workflow','tool-web','tool-todo','tool-goal','command-goal','goal-round-driver','mcp-resources','session-title-llm'];
function profileFiles(native,where,permission){
  const guardPath=join(where.directory,'remote-guard.mjs');
  // 中间件既在审批前检查，又在实际文件工具执行前检查，拒绝旧权限事实和越界路径。
  const guard=`import {createRemoteGuard} from ${JSON.stringify(new URL('./harness-remote.mjs',import.meta.url).href)};\nexport const name='codex-pet-remote-guard';\nexport const inject=['tools'];\nexport function apply(ctx){createRemoteGuard(ctx,${JSON.stringify({root:where.root,permission})});}\n`;
  const patch=[...disabled.map(id=>({id,disabled:true})),{id:'sandbox-policy',config:{mode:permission,workspaceRoot:where.root}},{id:'approval',config:{policy:'ask'}},{id:'permission',config:{presets:{[permission]:{sandbox:permission,approval:'ask'}},defaultPreset:permission}},{insert:[{id:'codex-pet-remote-guard',name:guardPath}]}];
  return{
    'package.json':JSON.stringify({name:where.profile,private:true,dependencies:{'@deepseek-ai/dsh-base':native.version,'@deepseek-ai/dsh-acp-app':native.version},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-acp-app']}}},null,2)+'\n',
    'cordis.patch.yml':JSON.stringify(patch,null,2)+'\n','remote-guard.mjs':guard,
    '.codex-pet-remote.json':JSON.stringify({schemaVersion:1,root:where.root,permission,version:native.version},null,2)+'\n'
  };
}
function assertOwnProfile(where,expected,{create=false}={}){
  const parent=dirname(where.directory);let parentStat;try{parentStat=lstatSync(parent);}catch{throw remoteError('remote_profile_unavailable');}
  if(!parentStat.isDirectory()||parentStat.isSymbolicLink()||realpathSync(parent)!==parent)throw remoteError('remote_profile_modified');
  if(existsSync(where.directory)){const s=lstatSync(where.directory);if(!s.isDirectory()||s.isSymbolicLink())throw remoteError('remote_profile_modified');}
  else if(create)mkdirSync(where.directory,{recursive:true});else throw remoteError('remote_profile_unavailable');
  for(const [name,body]of Object.entries(expected)){
    const target=join(where.directory,name);
    if(existsSync(target)){if(!file(target)||lstatSync(target).size!==Buffer.byteLength(body)||readFileSync(target,'utf8')!==body)throw remoteError('remote_profile_modified');}
    else if(create){const temporary=target+'.tmp-'+randomUUID();try{writeFileSync(temporary,body,{flag:'wx',mode:0o600});renameSync(temporary,target);}finally{try{unlinkSync(temporary);}catch{}}}
    else throw remoteError('remote_profile_unavailable');
  }
}
function carriesAcp(native){
  // 官方 dsh 本身携带 ACP bundle。只解析安装元数据，不 import/执行原生模块。
  const bases=[join(dirname(native.command),'..','node_modules/@deepseek-ai/dsh/package.json'),join(dirname(native.command),'..','@deepseek-ai/dsh/package.json'),join(dirname(native.command),'..','package.json'),join(dirname(native.command),'node_modules/@deepseek-ai/dsh/package.json')];
  for(const base of bases)try{
    const pkg=json(base);if(pkg.name!=='@deepseek-ai/dsh'||pkg.version!==native.version)continue;
    const require=createRequire(base),entry=require.resolve('@deepseek-ai/dsh-acp-app');let directory=dirname(entry);
    for(let i=0;i<4;i++,directory=dirname(directory)){try{const item=json(join(directory,'package.json'));if(item.name==='@deepseek-ai/dsh-acp-app'&&item.version===native.version)return true;}catch{}}
  }catch{}return false;
}
function runPreparation(spec,{spawnImpl=spawn,timeoutMs=180000,signal}={}){
  if(signal?.aborted)return Promise.reject(remoteError('profile_prepare_aborted'));
  return new Promise((accept,reject)=>{let child;try{child=spawnImpl(spec.command,spec.args,{env:spec.env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});}catch{reject(remoteError('profile_prepare_failed'));return;}
    let settled=false,bytes=0;const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const settle=(error)=>{if(settled)return;settled=true;cleanup();error?reject(remoteError(error)):accept();};
    const abort=()=>{settle('profile_prepare_aborted');terminateRemoteChild(child);};
    const timer=setTimeout(()=>{settle('profile_prepare_timeout');terminateRemoteChild(child);},timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    const consume=chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>1048576){settle('profile_prepare_failed');terminateRemoteChild(child);}};
    child.stdout.on('data',consume);child.stderr.on('data',consume);child.once('error',()=>settle('profile_prepare_failed'));child.once('close',code=>settle(code===0?undefined:'profile_prepare_failed'));
  });
}

/** 本机保存时准备一次；仅创建本项目按目录和权限隔离的原生 ACP profile。 */
export async function prepareHarnessRemoteProfile({native,cwd,permission='read-only',spawnImpl=spawn,pnpmDirectory,onStage=()=>{},runtimeAvailable=carriesAcp,signal}={}){
  if(signal?.aborted)throw remoteError('profile_prepare_aborted');
  native=validateNative(native);const where=location(native,cwd,permission),expected=profileFiles(native,where,permission);assertOwnProfile(where,expected,{create:true});
  const env={...process.env,DSH_HOME:native.home,DSH_PERMISSION_MODE:permission,DSH_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'',NODE_PATH:''};
  if(pnpmDirectory!==undefined){if(!isAbsolute(pnpmDirectory)||!lstatSync(pnpmDirectory).isDirectory())throw remoteError('pnpm_unavailable');env.PATH=pnpmDirectory+delimiter+(env.PATH??env.Path??'');}
  if(!runtimeAvailable(native)){
    onStage('preparing');await runPreparation(commandSpec(native,['plugin','--profile',where.profile,'add','@deepseek-ai/dsh-base@'+native.version,'@deepseek-ai/dsh-acp-app@'+native.version,'--save-exact','--ignore-scripts','--store-dir',join(where.directory,'.pnpm-store')],env),{spawnImpl,signal});
    // 原生安装器可以规范化 manifest；必须保留本项目的固定依赖与唯一 bundle。
    const pkg=json(join(where.directory,'package.json'));if(pkg.dependencies?.['@deepseek-ai/dsh-acp-app']!==native.version||pkg.dependencies?.['@deepseek-ai/dsh-base']!==native.version||JSON.stringify(pkg.dsh?.profile?.bundles)!=='["@deepseek-ai/dsh-base","@deepseek-ai/dsh-acp-app"]')throw remoteError('remote_profile_modified');
    writeFileSync(join(where.directory,'package.json'),expected['package.json']);
  }
  if(signal?.aborted)throw remoteError('profile_prepare_aborted');assertOwnProfile(where,expected);onStage('ready');return{profile:where.profile,stage:'ready',ready:true};
}

/** 执行层围栏不依赖提示词：只支持本项目真实目录中的 read/write/edit。 */
export function createRemoteGuard(ctx,{root,permission}){
  const valid=exec=>{
    try{if(realpathSync(exec.agent?.session?.header?.cwd)!==root)return false;}catch{return false;}
    const tool={title:exec.name,rawInput:exec.arguments};
    // 使用与手机端审批完全相同的路径和权限核验，执行前再次检查 junction。
    return reviewGuard(root,permission,tool);
  };
  ctx.on('tools/pre-execute',async(exec,next)=>{const result=valid(exec);return!result?{kind:'deny',reason:'Outside paired remote scope'}:result.kind==='read'?next():{kind:'ask',reason:'One-time remote file approval required'};},true);
  ctx.on('tools/execute',async(exec,next)=>{if(!valid(exec))throw remoteError('outside_remote_scope');return next();},true);
}
export function createHarnessRemote(options={}){
  const native=validateNative(options.native),permission=options.permission??'read-only',where=location(native,options.cwd,permission),expected=profileFiles(native,where,permission);
  return createAcpRemote({...options,host:'harness',permission,launch:async()=>{
    assertOwnProfile(where,expected);
    return commandSpec(native,['--profile',where.profile],{...process.env,DSH_HOME:native.home,DSH_PERMISSION_MODE:permission,DSH_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'',NODE_PATH:''});
  }});
}
