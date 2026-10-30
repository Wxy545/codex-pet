import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {basename,delimiter,dirname,isAbsolute,join,resolve} from 'node:path';
import {createAcpRemote,remoteError} from './acp-remote.mjs';
import {normalizeRemoteToolPolicy,remoteToolScope} from './remote-tool-policy.mjs';
import {selectNativeMcp} from './native-mcp.mjs';

const file=path=>{try{const s=lstatSync(path);return s.isFile()&&!s.isSymbolicLink();}catch{return false;}};
const json=(path,limit=65536)=>{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>limit)throw remoteError('invalid_native_registration');return JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));};
function validateNative(native){
  if(!native||![native.nodePath,native.cliPath,native.configDir].every(path=>typeof path==='string'&&isAbsolute(path))||!/^node(?:\.exe)?$/i.test(basename(native.nodePath))||!file(native.nodePath)||!file(native.cliPath))throw remoteError('not_installed');
  try{const s=lstatSync(native.configDir);if(!s.isDirectory()||s.isSymbolicLink())throw Error();
    const root=resolve(dirname(native.cliPath),'..'),pkg=json(join(root,'package.json')),product=json(join(root,'product.json'),1048576);
    if(basename(native.cliPath)!=='codebuddy'||pkg.name!=='@genie/agent-cli'||pkg.version!=='2.165.0'||product.productName!=='WorkBuddy')throw Error();
  }catch{throw remoteError('native_version_unverified');}
  return{nodePath:realpathSync(native.nodePath),cliPath:realpathSync(native.cliPath),configDir:realpathSync(native.configDir),version:'2.165.0'};
}

/** 只检查本插件登记和安装元数据；账户文件由 WorkBuddy 自己加载。 */
export function resolveWorkBuddyNative({dataRoot,projectRoot,nodePath}={}){
  if(!isAbsolute(dataRoot??'')||!isAbsolute(projectRoot??''))throw remoteError('not_installed');
  try{
    const stamp=json(join(dataRoot,'workbuddy-plugin','.codex-pet-workbuddy.json'));
    if(stamp.schemaVersion!==1||resolve(stamp.appRoot??'')!==resolve(projectRoot)||!isAbsolute(stamp.workBuddyExe??'')||basename(stamp.workBuddyExe).toLowerCase()!=='workbuddy.exe'||!file(stamp.workBuddyExe))throw Error();
    const portable=join(projectRoot,'data/runtime/node/node.exe');
    const systemNode=String(process.env.PATH??process.env.Path??'').split(delimiter).filter(isAbsolute).map(directory=>join(directory,process.platform==='win32'?'node.exe':'node')).find(file);
    // Electron 的 process.execPath 是桌宠程序本身，不能拿它当 Node 启动 WorkBuddy CLI。
    const selected=nodePath??(file(portable)?portable:systemNode??(/^node(?:\.exe)?$/i.test(basename(process.execPath))?process.execPath:undefined));
    return validateNative({nodePath:selected,cliPath:join(dirname(stamp.workBuddyExe),'resources/app.asar.unpacked/cli/bin/codebuddy'),configDir:stamp.workBuddyHome});
  }catch(error){throw remoteError(error.code==='native_version_unverified'?error.code:'not_installed');}
}

function gitBash(){
  if(process.platform!=='win32')return'/bin/bash';
  const paths=[process.env.CODEBUDDY_CODE_GIT_BASH_PATH,...[process.env.ProgramFiles,'C:/Program Files'].filter(Boolean).map(root=>join(root,'Git/bin/bash.exe')),...String(process.env.PATH??process.env.Path??'').split(delimiter).filter(isAbsolute).map(root=>join(root,'../bin/bash.exe'))];
  return paths.find(path=>isAbsolute(path??'')&&file(path));
}

/** 仅为当前原生子进程授权工具，不继承保存的自动允许规则，也不修改宿主全局设置。 */
export function createWorkBuddyRemote(options={}){
  const native=validateNative(options.native),permission=options.permission??'read-only',policy=normalizeRemoteToolPolicy(options.toolPolicy),scope=remoteToolScope(policy,options.mcpRevision);
  if(options.toolScope!==undefined&&options.toolScope!==scope)throw remoteError('tool_scope_mismatch');
  const mode=permission==='read-only'&&!policy.shell&&!policy.mcp?'plan':'default',bash=policy.shell?gitBash():null;if(policy.shell&&!bash)throw remoteError('shell_unavailable');
  const selected=()=>policy.mcp?selectNativeMcp({host:'workbuddy',native,cwd:options.cwd,sourcePath:options.mcpSourcePath,revision:options.mcpRevision,serverIds:policy.mcpServerIds}).map(server=>({...server,_meta:{defer_loading:false}})):[];
  if(policy.mcp)selected();
  const tools=[...(permission==='read-only'?['Read']:['Read','Write','Edit']),...(policy.shell?['Bash']:[]),...policy.mcpServerIds.map(id=>'mcp__'+id+'__*')];
  const settings={permissions:{allow:[],ask:tools,deny:[...(!policy.shell?['Bash']:[]),'PowerShell','Agent','Skill','WebFetch','WebSearch','Glob','Grep','NotebookEdit','ExitPlanMode',...(permission==='read-only'?['Write','Edit']:[])],additionalDirectories:[]},disableAllHooks:true,
    // 该版本在 sandbox fast path 会跳过逐命令权限检查；开启命令时明确用 default + ask。
    // 这是本机主动开启的当前用户命令权限，不能宣传成项目文件沙箱。
    sandbox:{enabled:false,autoAllowBashIfSandboxed:false,allowUnsandboxedCommands:false,excludedCommands:[],systemToolPolicy:'disabled'}};
  return createAcpRemote({...options,host:'workbuddy',permission,toolPolicy:policy,toolScope:scope,closeSession:false,allowStartupPreamble:true,
    // 本版随包 CLI 需 serve 策略才启动 stdio。随机密码只在本进程环境内，不写原生设置。
    launch:async()=>{selected();return{command:native.nodePath,args:[native.cliPath,'--serve','--acp','--acp-transport','stdio','--host','127.0.0.1','--port','0','--auth','password','--permission-mode',mode,'--setting-sources','none','--tools',tools.join(','),'--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--settings',JSON.stringify(settings)],env:{...process.env,CODEBUDDY_CONFIG_DIR:native.configDir,WORKBUDDY_CONFIG_DIR:native.configDir,CODEBUDDY_FORCE_LITE_WB_BUNDLE:'1',CODEBUDDY_GATEWAY_PASSWORD:randomBytes(32).toString('base64url'),...(bash?{CODEBUDDY_CODE_GIT_BASH_PATH:bash,CODEBUDDY_CODE_SHELL:'bash',CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS:'1'}:{}),DISABLE_TELEMETRY:'1',NODE_OPTIONS:'',NODE_PATH:''}};},
    sessionConfig:()=>({mcpServers:selected()}),checkToolContext:()=>{selected();},
    checkSession:response=>{if(response?.modes?.currentModeId!==mode)throw remoteError('permission_profile_mismatch');if(response?.configOptions?.find(option=>option.id==='sandbox')?.currentValue!=='false')throw remoteError(policy.shell?'shell_approval_unavailable':'permission_profile_mismatch');},
    promptMeta:turnId=>({'codebuddy.ai/requestId':turnId})
  });
}
