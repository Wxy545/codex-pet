import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,sep} from 'node:path';

// 官方 dsh-pet 0.4.0 npm 包已核验 sha512；此清单只保存/读取测试原件，绝不恢复运行源码。
export const UPSTREAM_SNAPSHOT_DIRECTORY='.codex-pet-upstream-0.4.0';
export const UPSTREAM_SHA256_040=Object.freeze({
  "assets/config.jsonc": "cdd1b4758a5c5d456a358b277c5c69eb50de58d9d3faa38738c1cd03048f2f7f",
  "lib/app.js": "143839c5719e7efeba67cdbd5b8dee9932368b8d1c9f7361f8ff66368717d560",
  "lib/client.js": "0caf5bcc90698f68f2e486717d0263415f6d7894ac75c221433ea3163bfe6dee",
  "lib/index.js": "4de74a225b74b882bcc30fc2e727510d41e2a0b66a5a90c403d80f28711a020b",
  "lib/node-CKdwitJ-.js": "b2c7c0122b6f6be28e01feb96a00e6175b4bd476e6e368869c2b4c8eb81a9f40",
  "lib/node-DbKTBV3f.js": "50983d5fb65e2dbc0d942f7fd607fee8a0106ab2b28b4d18308e4f5ce5ee6036",
  "lib/node-SuG7cu54.js": "edc6510a2455bab9ac53f96d5028c78052c40e38622e2394e0f470d8b1057714",
  "lib/promise-DxjFfmXm.js": "5c2fb8e64a1f951b29b0bf9f6f9d84891c93ba3b99fc9ee9cf82b4c4d85e4c0c",
  "lib/standalone.js": "a71b3f841056b262070ac8c47811d41114ab0e744f56157dc36b552af72faa66",
  "package.json": "94d9f475bb33561a5d4ec2e39ed1b224665cae55db89a580be83592618a36448",
  "runtime/electron-helper/constants.js": "8d9a410f8d3dc8037c66bc12beed9431ec5f307b6366a3e14d26635cbb696bd7",
  "runtime/electron-helper/desktop-geometry.js": "61cb545170ef2259f4e75e2b3006759de4eace61d07ea1b8f62621eb91e11e90",
  "runtime/electron-helper/dpi-linearization.js": "6ea137ae8d4fadfebadc2d89ffe298256a0d94b6b9591069628631aa8f9b2462",
  "runtime/electron-helper/events.js": "349452524b25007904f16d3b24626dfd218684051b407801dbecf7f3edfee730",
  "runtime/electron-helper/host-liveness.js": "ccbde1a267f08d184a7f2dabd7292a58f179a06f57c908dc15b02b8014ceaf07",
  "runtime/electron-helper/index.html": "350e5ffaa341abd4867575b119987a82738a12da386310a7d138c6296179651b",
  "runtime/electron-helper/main.js": "2400f367c31b10e06d571e24e028b929ce3fff23df39cb27feba7b962cbf293a",
  "runtime/electron-helper/main/bridge.js": "5e3bc10120e6351f93cef3b30bf22d0a91a153b0d5f7c47ea4dca52abaa57147",
  "runtime/electron-helper/main/displays.js": "9df4eb31c2467165d329282494f49fbef7f720c0b5c9458b5a2107bbf4506d4f",
  "runtime/electron-helper/main/dpi.js": "5ce7b29d835c0599ca2dabb6584586fc3e76dbd256baa90178d232c98a524fea",
  "runtime/electron-helper/main/ipc.js": "99b45aa99ff024ff0da59e0067eac0d1a0d913ebb873fd3d31af10fe7e53144c",
  "runtime/electron-helper/main/smoke.js": "dbe978a4026a1cf09c5e35a8544163456a17a54e5e8d8388c0a8f02b16d37012",
  "runtime/electron-helper/main/tray.js": "8afc2c64dc056cde47c67ba34523f4197b1ba47689237583eb33443f5a524df2",
  "runtime/electron-helper/main/user-data.js": "5e2468c427d83379c6f915d991aab859cd159c5662a9540dd54272ad55710509",
  "runtime/electron-helper/main/windows.js": "1925956a110039272437fc1fe9989dce10d5e25ed526bd826facd445b1f1307f",
  "runtime/electron-helper/package.json": "8cf1275c9a520d92c4e997b7e28074de9881c6394522c6ca15d0fc84cd8c7ca1",
  "runtime/electron-helper/pointer-target.js": "42216d7cd88ef1f361cf818cdad4b3a7a7e09db9fbf22e2640ca3e5fa04a1dba",
  "runtime/electron-helper/preload.js": "75ed3d711aceff875160a391ddd92dafb7f76690a834bab0ab894cf68bc0cb44",
  "runtime/electron-helper/range.js": "b9c5536a05c9c85dac8abd31df4dbc1083aa888bc37fa6efc372bc1224794d3e",
  "runtime/electron-helper/renderer.js": "1eb1079abdad06d4c5597d63f48a37d7c562767ae6339718897f1c7555579a8e",
  "runtime/electron-helper/shared-core.js": "727c80e688ee3513994b8adfa791972340aeca9141c49972b3ea70785c80761b",
  "runtime/electron-helper/sprite.js": "3bc8a4738f8ccc8fdb89e8a3d60ec73ac20d39693d74b056547206eed04648e5",
  "runtime/electron-helper/sprite/bubble.js": "bd9b6548016860eb2bb9bedb58bdcbc86ee07d31865ade2feb97d4e11c258d8c",
  "runtime/electron-helper/sprite/init.js": "5cb7715765fd8d102f875acaac98d3e071211b11474a014340d4331477022d63",
  "runtime/electron-helper/sprite/input.js": "9c1b2546aa7e05583671b2bd2de769ecba176c130a4ca4c8e0356a77eedd54cb",
  "runtime/electron-helper/sprite/menu.js": "195470e6d905cb821c871a0449fc53fe6fcab4c4f2bd4ed69b4d23f037a8c10f",
  "runtime/electron-helper/sprite/motion.js": "a0e048886cd21123bf46989fb3a89c6059d2d4e12208d8c982588013095ace29",
  "runtime/electron-helper/sprite/playback.js": "bd1ec6492118ae9494c5ec6d0a178d2969461c995e82fc1af0c12906a2715c2f",
  "runtime/electron-helper/taskbar-watchdog.js": "5a9a68b89abe54c8c8cef74654a45e5bac4491b9f8fa9f53a177cfc1d3846928",
  "runtime/electron-helper/topmost-watchdog.js": "71fd4976e79045ded009004f259feef1ef194543b973f0ff2b2f4aafcbfe3618",
  "runtime/electron-helper/tray-platform.js": "c5ba0d66439fb8ad4991b8b47613eb3a3d2d69d1dff7cd86a1e0b3bc92a24fff",
  "runtime/electron-helper/x11-pointer.js": "604ec86abc2b2f771daf817fd5bfc45e395b550e3c67da496f7a7c61a5c0d247"
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(root,file)=>{const rel=relative(root,file);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
const fail=()=>{throw Error('verified-upstream-040-snapshot-required');};
function verified(root,name){const file=join(root,name),stat=lstatSync(file),real=realpathSync(file);if(!stat.isFile()||stat.isSymbolicLink()||!within(root,real)||stat.size>8*1024*1024)fail();const bytes=readFileSync(file);if(hash(bytes)!==UPSTREAM_SHA256_040[name])fail();return bytes;}

/** 只在准备运行时前留测试原件；已有原件逐项验摘要，绝不拿它覆盖实际补丁输入。 */
export async function captureUpstreamSnapshot040({pkg,sourceRoot=pkg}){
 if(!isAbsolute(pkg||'')||!isAbsolute(sourceRoot||''))fail();const destinationRoot=realpathSync(pkg),source=realpathSync(sourceRoot),snapshot=join(destinationRoot,UPSTREAM_SNAPSHOT_DIRECTORY),marker=join(snapshot,'manifest.json');
 const meta=JSON.parse(readFileSync(join(destinationRoot,'package.json'),'utf8'));if(meta.name!=='dsh-pet'||meta.version!=='0.4.0')fail();
 if(existsSync(snapshot)){if(lstatSync(snapshot).isSymbolicLink()||realpathSync(snapshot)!==snapshot)fail();const manifest=JSON.parse(readFileSync(marker,'utf8'));if(manifest.schemaVersion!==1||manifest.version!=='0.4.0'||JSON.stringify(manifest.files)!==JSON.stringify(UPSTREAM_SHA256_040))fail();for(const name of Object.keys(UPSTREAM_SHA256_040))verified(snapshot,name);return{status:'current',files:Object.keys(UPSTREAM_SHA256_040).length};}
 const planned=Object.keys(UPSTREAM_SHA256_040).map(name=>[name,verified(source,name)]);mkdirSync(snapshot);for(const[name,bytes]of planned){const file=join(snapshot,name);mkdirSync(dirname(file),{recursive:true});if(!within(snapshot,realpathSync(dirname(file))))fail();const temp=file+'.tmp-'+randomUUID();try{writeFileSync(temp,bytes,{flag:'wx',mode:0o600});renameSync(temp,file);}finally{if(existsSync(temp))unlinkSync(temp);}}writeFileSync(marker,JSON.stringify({schemaVersion:1,version:'0.4.0',files:UPSTREAM_SHA256_040})+'\n',{flag:'wx',mode:0o600});return{status:'captured',files:planned.length};
}

/** 测试可读原件，副本或未留原件的已修改输入一律停止；没有 data 目录隐式回退。 */
export function readVerifiedUpstream040(pkg,name){
 if(!Object.hasOwn(UPSTREAM_SHA256_040,name))fail();const root=realpathSync(pkg),snapshot=join(root,UPSTREAM_SNAPSHOT_DIRECTORY);if(existsSync(snapshot)){if(lstatSync(snapshot).isSymbolicLink()||realpathSync(snapshot)!==snapshot)fail();return verified(snapshot,name).toString('utf8');}return verified(root,name).toString('utf8');
}
