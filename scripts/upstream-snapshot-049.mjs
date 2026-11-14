import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,sep} from 'node:path';

// 官方 dsh-pet 0.4.9 npm 包已核验 sha512；此清单只保存/读取测试原件，绝不恢复运行源码。
export const UPSTREAM_SNAPSHOT_DIRECTORY='.codex-pet-upstream-0.4.9';
export const UPSTREAM_SHA256_049=Object.freeze({
  "assets/config.jsonc": "b54fcd06e69326477f3da5914fc4771d653224766e265032cc3bce5dc9aec903",
  "lib/app.js": "dbbe63332e62e3415ce5d2444e9ad60f9e88f90862cea4f079bd8315d89f618b",
  "lib/chat-panel.js": "c25564e0afe86fc3d6e351ec68d359090f40a4c8deea232c7e5ba1823874b5a3",
  "lib/chunk-BI7llAj_.js": "a1139ad1c3d03e4567808b36d64485f4b924ee47ac50c2805beb0eb916bc14ce",
  "lib/client.js": "60cc9f5fee3cbfba1acec1ffdc8933176f6c6db1986531433df07103a56467dc",
  "lib/dist-DpF6qLoG.js": "ac2691110df0c63a145e98df1aa2953d50e398cd6e72d82a421202cc276c3807",
  "lib/index.js": "b70d58b76a8c79f586fd394c171fc008131069f5d44e985f827e9fd9bad956da",
  "lib/node-BUn5KyQv.js": "edc6510a2455bab9ac53f96d5028c78052c40e38622e2394e0f470d8b1057714",
  "lib/node-BUxc_9IN.js": "caeb0424da4fd1f0517afddf5bf4080f270ac3c4235b6ad15085481f2ea9933b",
  "lib/node-CKdwitJ-.js": "b2c7c0122b6f6be28e01feb96a00e6175b4bd476e6e368869c2b4c8eb81a9f40",
  "lib/node-DbKTBV3f.js": "50983d5fb65e2dbc0d942f7fd607fee8a0106ab2b28b4d18308e4f5ce5ee6036",
  "lib/node-SuG7cu54.js": "edc6510a2455bab9ac53f96d5028c78052c40e38622e2394e0f470d8b1057714",
  "lib/node-y67FhQSo.js": "a5e3f8a924bd4f2f5f3de01e73bb315c0c5b8e6c04c9b6c917776c52a7361a14",
  "lib/promise-DLDcTBDg.js": "5c2fb8e64a1f951b29b0bf9f6f9d84891c93ba3b99fc9ee9cf82b4c4d85e4c0c",
  "lib/promise-DxjFfmXm.js": "5c2fb8e64a1f951b29b0bf9f6f9d84891c93ba3b99fc9ee9cf82b4c4d85e4c0c",
  "lib/standalone.js": "1235755c0c1a11a960499a3b02fa3ec8f0850ac2c8de15c0158baddcb250453c",
  "package.json": "4e2baee1044cca7535e0b300458048b532bf3aa9d811d087e3ddc4c31fb48d48",
  "runtime/electron-helper/constants.js": "9f2aec96d75c342c8042b2809de0a1b1fdf6a5e1f4e5ec553b567859c0790ef2",
  "runtime/electron-helper/desktop-geometry.js": "61cb545170ef2259f4e75e2b3006759de4eace61d07ea1b8f62621eb91e11e90",
  "runtime/electron-helper/dpi-linearization.js": "6ea137ae8d4fadfebadc2d89ffe298256a0d94b6b9591069628631aa8f9b2462",
  "runtime/electron-helper/events.js": "d9861ff986748c345a4f4beeae1c1df059d154f923faeeecb8f8cd3068e26736",
  "runtime/electron-helper/host-liveness.js": "ccbde1a267f08d184a7f2dabd7292a58f179a06f57c908dc15b02b8014ceaf07",
  "runtime/electron-helper/index.html": "36d0003239f0b10515a0899d30c8ee99849eb644d324f460a3fda2aad2e26ea9",
  "runtime/electron-helper/main.js": "198ecac547faed21e4a76e5de9ea1ee2a6b741b226c64c05fe3fb71e122a9e42",
  "runtime/electron-helper/main/bridge.js": "5e3bc10120e6351f93cef3b30bf22d0a91a153b0d5f7c47ea4dca52abaa57147",
  "runtime/electron-helper/main/displays.js": "1c70fc5c11287f47199e313c4441e177b389c5f875305f542ad59e2ae7884c86",
  "runtime/electron-helper/main/dpi.js": "b998d492a179d37b790d680fe70b5c0ec390a1d4e448a2dd9b473b59850bf951",
  "runtime/electron-helper/main/ipc.js": "040fea02ebadb8d765d17d282b5dec1db2d5974e312dac15b2e2219b7366d3ee",
  "runtime/electron-helper/main/smoke.js": "2b8bedbe208e0d5398fc2189b81c93002c722cab720129c257d8b9057db82114",
  "runtime/electron-helper/main/tray.js": "e0f9436fe6db4d527419d3d657be7975c598972c928da08034043f4e99511edc",
  "runtime/electron-helper/main/user-data.js": "5e2468c427d83379c6f915d991aab859cd159c5662a9540dd54272ad55710509",
  "runtime/electron-helper/main/windows.js": "85b10907ae5a6817784d65045b57d9bb4d76872448a8d369f8db7c4fe79a3e21",
  "runtime/electron-helper/package.json": "8cf1275c9a520d92c4e997b7e28074de9881c6394522c6ca15d0fc84cd8c7ca1",
  "runtime/electron-helper/pointer-target.js": "dc41fa1146f8f81fcba3b2fd4b49e2b44adb6893058a8cbbf94a8fbf9f2839a9",
  "runtime/electron-helper/preload.js": "f7ef0119b911e18373d589e158b60c79019f8ebce20987c12af82cd1e968de33",
  "runtime/electron-helper/range.js": "b9c5536a05c9c85dac8abd31df4dbc1083aa888bc37fa6efc372bc1224794d3e",
  "runtime/electron-helper/renderer.js": "f7b11311b4b00eadffce64dc09129c99c23c6e9acfc9a344ee3383648e6d2be2",
  "runtime/electron-helper/shared-core.js": "8668c9be50963738782800a45497cf37814d0411671202b004dd5345ad592f13",
  "runtime/electron-helper/sprite.js": "d107e7abdfe2d63716d2c5e1e153372322119069e191971aafbaf2f35f69f7eb",
  "runtime/electron-helper/sprite/bubble.js": "06140906965d73a755c3854d6255ebec5ff327577ab1e34ffe274cb9f890d638",
  "runtime/electron-helper/sprite/init.js": "cd2c7a2586ae49ed5848d681ca6ee284d89f0b0724fd08751864d2ff38299289",
  "runtime/electron-helper/sprite/input.js": "ee83da3e68b6197dbb68978d8ef69cb6d846048424ab05fe4d4190d8aa3aeca0",
  "runtime/electron-helper/sprite/menu.js": "63fbcfa8fbc603264bc94a035577aa263cca910eebae0d8678d5a422cc5c025a",
  "runtime/electron-helper/sprite/motion.js": "0b2edc32d05cd5bdf86f265647c5bbd639f67e3a5764cfee3b9e125274d5cdd6",
  "runtime/electron-helper/sprite/playback.js": "187f68fde1f28606360b77c07d804e7a8ae8ace53b4d93ba2143abf2e1ba889f",
  "runtime/electron-helper/sprite/window-fit.js": "1a2f33f31b7d8c52bb520e42cd2494dd0d515da6bb7ed4596cea535562b45e64",
  "runtime/electron-helper/taskbar-watchdog.js": "5a9a68b89abe54c8c8cef74654a45e5bac4491b9f8fa9f53a177cfc1d3846928",
  "runtime/electron-helper/topmost-watchdog.js": "71fd4976e79045ded009004f259feef1ef194543b973f0ff2b2f4aafcbfe3618",
  "runtime/electron-helper/tray-platform.js": "c5ba0d66439fb8ad4991b8b47613eb3a3d2d69d1dff7cd86a1e0b3bc92a24fff",
  "runtime/electron-helper/x11-pointer.js": "604ec86abc2b2f771daf817fd5bfc45e395b550e3c67da496f7a7c61a5c0d247"
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(root,file)=>{const rel=relative(root,file);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
const fail=()=>{throw Error('verified-upstream-049-snapshot-required');};
function verified(root,name){const file=join(root,name),stat=lstatSync(file),real=realpathSync(file);if(!stat.isFile()||stat.isSymbolicLink()||!within(root,real)||stat.size>8*1024*1024)fail();const bytes=readFileSync(file);if(hash(bytes)!==UPSTREAM_SHA256_049[name])fail();return bytes;}

/** 只在准备运行时前留测试原件；已有原件逐项验摘要，绝不拿它覆盖实际补丁输入。 */
export async function captureUpstreamSnapshot049({pkg,sourceRoot=pkg}){
 if(!isAbsolute(pkg||'')||!isAbsolute(sourceRoot||''))fail();const destinationRoot=realpathSync(pkg),source=realpathSync(sourceRoot),snapshot=join(destinationRoot,UPSTREAM_SNAPSHOT_DIRECTORY),marker=join(snapshot,'manifest.json');
 const meta=JSON.parse(readFileSync(join(destinationRoot,'package.json'),'utf8'));if(meta.name!=='dsh-pet'||meta.version!=='0.4.9')fail();
 if(existsSync(snapshot)){if(lstatSync(snapshot).isSymbolicLink()||realpathSync(snapshot)!==snapshot)fail();const manifest=JSON.parse(readFileSync(marker,'utf8'));if(manifest.schemaVersion!==1||manifest.version!=='0.4.9'||JSON.stringify(manifest.files)!==JSON.stringify(UPSTREAM_SHA256_049))fail();for(const name of Object.keys(UPSTREAM_SHA256_049))verified(snapshot,name);return{status:'current',files:Object.keys(UPSTREAM_SHA256_049).length};}
 const planned=Object.keys(UPSTREAM_SHA256_049).map(name=>[name,verified(source,name)]);mkdirSync(snapshot);for(const[name,bytes]of planned){const file=join(snapshot,name);mkdirSync(dirname(file),{recursive:true});if(!within(snapshot,realpathSync(dirname(file))))fail();const temp=file+'.tmp-'+randomUUID();try{writeFileSync(temp,bytes,{flag:'wx',mode:0o600});renameSync(temp,file);}finally{if(existsSync(temp))unlinkSync(temp);}}writeFileSync(marker,JSON.stringify({schemaVersion:1,version:'0.4.9',files:UPSTREAM_SHA256_049})+'\n',{flag:'wx',mode:0o600});return{status:'captured',files:planned.length};
}

/** 测试可读原件，副本或未留原件的已修改输入一律停止；没有 data 目录隐式回退。 */
export function readVerifiedUpstream049(pkg,name){
 if(!Object.hasOwn(UPSTREAM_SHA256_049,name))fail();const root=realpathSync(pkg),snapshot=join(root,UPSTREAM_SNAPSHOT_DIRECTORY);if(existsSync(snapshot)){if(lstatSync(snapshot).isSymbolicLink()||realpathSync(snapshot)!==snapshot)fail();return verified(snapshot,name).toString('utf8');}return verified(root,name).toString('utf8');
}
