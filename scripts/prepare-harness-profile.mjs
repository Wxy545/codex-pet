import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareHarnessDependency} from '../harness/motion-fix.mjs';
import {prepareHarnessBalance} from '../harness/native-balance.mjs';
import {prepareHarnessRemoteState} from '../harness/native-remote-state.mjs';
import {prepareHarnessTasks} from '../harness/native-tasks.mjs';

const releases=new Set(['0.2.1-rc.2','0.2.1-rc.5','0.2.2-rc.1']);
const petReleases=new Set(['0.4.0','0.4.1','0.4.3','0.4.5','0.4.6']);
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const inside=(root,file)=>{const value=relative(root,file);return value===''||!isAbsolute(value)&&value!=='..'&&!value.startsWith('..'+sep);};
function checkedDirectory(file){
 for(let current=file;;current=dirname(current)){
  const stat=lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('unsafe-harness-preparation-directory');
  if(dirname(current)===current)break;
 }
 return realpathSync(file);
}
function metadata(file){
 const stat=lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)throw Error('unsafe-harness-preparation-metadata');
 return JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
}

/** 安装结束后、Harness 首次导入模块之前离线准备；不加载宿主、账户或桌面 helper。 */
export function prepareHarnessProfile({profileDir,bundleDir,dshVersion}={}){
 if(!releases.has(dshVersion))throw Error('unverified-harness-preparation-version');
 if(!isAbsolute(profileDir||'')||!isAbsolute(bundleDir||''))throw Error('absolute-harness-preparation-path-required');
 const profile=checkedDirectory(profileDir),sourceRoot=realpathSync(bundleDir),manifest=metadata(join(profile,'package.json'));
 const bundles=manifest.dsh?.profile?.bundles;
 if(!petReleases.has(manifest.dependencies?.['dsh-pet'])||typeof manifest.dependencies?.['codex-pet-harness']!=='string'||!Array.isArray(bundles)||!bundles.includes('dsh-pet')||!bundles.includes('codex-pet-harness'))throw Error('harness-preparation-bundles-not-registered');
 const require=createRequire(join(profile,'package.json'));
 const installedRoot=realpathSync(dirname(require.resolve('codex-pet-harness/package.json')));
 if(!same(installedRoot,sourceRoot)||metadata(join(installedRoot,'package.json')).name!=='codex-pet-harness')throw Error('harness-preparation-bundle-mismatch');
 const petManifest=require.resolve('dsh-pet/package.json'),petRoot=realpathSync(dirname(petManifest));
 if(!inside(profile,petRoot))throw Error('harness-preparation-pet-outside-profile');
 const pet=metadata(petManifest);
 if(pet.name!=='dsh-pet'||pet.version!==manifest.dependencies['dsh-pet'])throw Error('harness-preparation-pet-mismatch');
 // 四个准备步骤共用目标：先检查所有现有文件与父目录，不能第一步写后才发现下一步越界。
 const files=['lib/client.js','lib/index.js','runtime/electron-helper/shared-core.js','runtime/electron-helper/sprite/motion.js','runtime/electron-helper/main.js','runtime/electron-helper/main/dpi.js','runtime/electron-helper/main/user-data.js','runtime/electron-helper/sprite.js','runtime/electron-helper/sprite/input.js','runtime/electron-helper/index.html'];
 if(['0.4.3','0.4.5','0.4.6'].includes(pet.version))files.push('runtime/electron-helper/sprite/playback.js','runtime/electron-helper/sprite/window-fit.js');
 // 046 的飞行状态已统一随 setBounds 提交，写入任一补丁前先检查整个新协议文件边界。
 if(pet.version==='0.4.6')files.push(...['main/windows.js','main/ipc.js','preload.js','sprite/init.js','events.js'].map(name=>'runtime/electron-helper/'+name));
 const generated=['runtime/electron-helper/codex-pet-status-strip.js','runtime/electron-helper/codex-pet-status-strip.css'];
 for(const name of [...files,...generated]){
  const file=join(petRoot,name),parent=checkedDirectory(dirname(file));if(!inside(petRoot,parent)||!inside(profile,parent))throw Error('harness-preparation-file-outside-profile');
  try{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024||!inside(petRoot,realpathSync(file)))throw Error('unsafe-harness-preparation-file');}
  catch(error){if(error.code!=='ENOENT'||!generated.includes(name))throw error;}
 }
 // inject 只延迟 apply，不阻止 Loader 预导入。必须先落盘，不能靠用户启动两次刷新 ESM 缓存。
 const motion=prepareHarnessDependency({profileDir:profile});
 const balance=prepareHarnessBalance({profileDir:profile,sourceRoot,locale:'en',withTasks:true});
 const remote=prepareHarnessRemoteState({profileDir:profile});
 const tasks=prepareHarnessTasks({profileDir:profile});
 return{status:[motion,balance,remote,tasks].some(value=>value.status==='updated')?'updated':'current',dshVersion,petVersion:pet.version,motion,balance,remote,tasks};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options=new Map();const args=process.argv.slice(2);
 if(args.length!==6)throw Error('harness-preparation-arguments-required');
 for(let index=0;index<args.length;index+=2){const key=args[index];if(!['--profile-dir','--bundle-dir','--dsh-version'].includes(key)||options.has(key))throw Error('invalid-harness-preparation-arguments');options.set(key,args[index+1]);}
 console.log(JSON.stringify(prepareHarnessProfile({profileDir:options.get('--profile-dir'),bundleDir:options.get('--bundle-dir'),dshVersion:options.get('--dsh-version')})));
}
