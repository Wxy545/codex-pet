import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,sep} from 'node:path';

// 官方 dsh-pet 0.4.1 npm 包已核验 sha512；此清单只保存/读取测试原件，绝不恢复运行源码。
export const UPSTREAM_SNAPSHOT_DIRECTORY='.codex-pet-upstream-0.4.1';
export const UPSTREAM_SHA256_041=Object.freeze({
  "assets/config.jsonc": "cdd1b4758a5c5d456a358b277c5c69eb50de58d9d3faa38738c1cd03048f2f7f",
  "lib/app.js": "2b6895c76becbe6cdf401324efc20810ed8d4793ad0f59d6dc81794ea7c5a9f2",
  "lib/chat-panel.js": "b45b3ececc7b3a5c9d07dab9da3de18fbb379487df74c9df86377ba833ae7685",
  "lib/chunk-BI7llAj_.js": "a1139ad1c3d03e4567808b36d64485f4b924ee47ac50c2805beb0eb916bc14ce",
  "lib/client.js": "9a355d6b4b152c4bf131c748cc0c2213f2f53d32a8d263c8fb751e37a54d782d",
  "lib/dist-DpF6qLoG.js": "ac2691110df0c63a145e98df1aa2953d50e398cd6e72d82a421202cc276c3807",
  "lib/index.js": "040990af96043134be4d4698c937bf281930a2df16e8e43eabb28e1d2ca2f108",
  "lib/node-BUn5KyQv.js": "edc6510a2455bab9ac53f96d5028c78052c40e38622e2394e0f470d8b1057714",
  "lib/node-BUxc_9IN.js": "caeb0424da4fd1f0517afddf5bf4080f270ac3c4235b6ad15085481f2ea9933b",
  "lib/node-CKdwitJ-.js": "b2c7c0122b6f6be28e01feb96a00e6175b4bd476e6e368869c2b4c8eb81a9f40",
  "lib/node-DbKTBV3f.js": "50983d5fb65e2dbc0d942f7fd607fee8a0106ab2b28b4d18308e4f5ce5ee6036",
  "lib/node-SuG7cu54.js": "edc6510a2455bab9ac53f96d5028c78052c40e38622e2394e0f470d8b1057714",
  "lib/node-y67FhQSo.js": "a5e3f8a924bd4f2f5f3de01e73bb315c0c5b8e6c04c9b6c917776c52a7361a14",
  "lib/promise-DLDcTBDg.js": "5c2fb8e64a1f951b29b0bf9f6f9d84891c93ba3b99fc9ee9cf82b4c4d85e4c0c",
  "lib/promise-DxjFfmXm.js": "5c2fb8e64a1f951b29b0bf9f6f9d84891c93ba3b99fc9ee9cf82b4c4d85e4c0c",
  "lib/standalone.js": "3e88f2ff663a0c04cf9260a60ffc32afbae285b32b946dc366c772b2e2c6b3bf",
  "package.json": "d45bc2b5824857c30e1d2cf648780a685f7a0a40c3a6c1445d90063c77d2bf19",
  "runtime/electron-helper/constants.js": "d4882c511395a1f4a9171a8ed3125d0c724718bc28d89801540797a0614f86f9",
  "runtime/electron-helper/desktop-geometry.js": "61cb545170ef2259f4e75e2b3006759de4eace61d07ea1b8f62621eb91e11e90",
  "runtime/electron-helper/dpi-linearization.js": "6ea137ae8d4fadfebadc2d89ffe298256a0d94b6b9591069628631aa8f9b2462",
  "runtime/electron-helper/events.js": "a4964ea9a3f48ed4bdc5bc1312050212631bbb5fe84ea33eca92cb032400bc30",
  "runtime/electron-helper/host-liveness.js": "ccbde1a267f08d184a7f2dabd7292a58f179a06f57c908dc15b02b8014ceaf07",
  "runtime/electron-helper/index.html": "350e5ffaa341abd4867575b119987a82738a12da386310a7d138c6296179651b",
  "runtime/electron-helper/main.js": "313485a4aead0eb178ac896c391dc1813413d75a93edbc820907eee6f0269411",
  "runtime/electron-helper/main/bridge.js": "5e3bc10120e6351f93cef3b30bf22d0a91a153b0d5f7c47ea4dca52abaa57147",
  "runtime/electron-helper/main/displays.js": "9df4eb31c2467165d329282494f49fbef7f720c0b5c9458b5a2107bbf4506d4f",
  "runtime/electron-helper/main/dpi.js": "5ce7b29d835c0599ca2dabb6584586fc3e76dbd256baa90178d232c98a524fea",
  "runtime/electron-helper/main/ipc.js": "619c4be9b4ea4586f8b5016cb0ef498c99a87dce1d344c212c67123490cb494a",
  "runtime/electron-helper/main/smoke.js": "dbe978a4026a1cf09c5e35a8544163456a17a54e5e8d8388c0a8f02b16d37012",
  "runtime/electron-helper/main/tray.js": "e0f9436fe6db4d527419d3d657be7975c598972c928da08034043f4e99511edc",
  "runtime/electron-helper/main/user-data.js": "5e2468c427d83379c6f915d991aab859cd159c5662a9540dd54272ad55710509",
  "runtime/electron-helper/main/windows.js": "e2a08ca6114675ec41c36d2db401032174bd2895f1593a3108d98e745c70af9e",
  "runtime/electron-helper/package.json": "8cf1275c9a520d92c4e997b7e28074de9881c6394522c6ca15d0fc84cd8c7ca1",
  "runtime/electron-helper/pointer-target.js": "42216d7cd88ef1f361cf818cdad4b3a7a7e09db9fbf22e2640ca3e5fa04a1dba",
  "runtime/electron-helper/preload.js": "41a4d6cc4c8c99671dfd464302fd3eac7bd8f82396e7516b999b7af77bfdbf5b",
  "runtime/electron-helper/range.js": "b9c5536a05c9c85dac8abd31df4dbc1083aa888bc37fa6efc372bc1224794d3e",
  "runtime/electron-helper/renderer.js": "1eb1079abdad06d4c5597d63f48a37d7c562767ae6339718897f1c7555579a8e",
  "runtime/electron-helper/shared-core.js": "133a59f67182d2939adf6d3926924432b47966ebb8fa0cfb9f5954552ec0752f",
  "runtime/electron-helper/sprite.js": "3bc8a4738f8ccc8fdb89e8a3d60ec73ac20d39693d74b056547206eed04648e5",
  "runtime/electron-helper/sprite/bubble.js": "67a8aec26b1742896c1dc71d2f8116c1dc059e28cade350f2029326e955cd012",
  "runtime/electron-helper/sprite/init.js": "7469ac0e0fa23a0574c1530121f296314069c4638f703eb33ed2980f66d6cadc",
  "runtime/electron-helper/sprite/input.js": "b05728340e01c03d1943439b32cc23b866729c28b6550abcb82a246f889dab49",
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
const fail=()=>{throw Error('verified-upstream-041-snapshot-required');};
function verified(root,name){const file=join(root,name),stat=lstatSync(file),real=realpathSync(file);if(!stat.isFile()||stat.isSymbolicLink()||!within(root,real)||stat.size>8*1024*1024)fail();const bytes=readFileSync(file);if(hash(bytes)!==UPSTREAM_SHA256_041[name])fail();return bytes;}

/** 只在准备运行时前留测试原件；已有原件逐项验摘要，绝不拿它覆盖实际补丁输入。 */
export async function captureUpstreamSnapshot041({pkg,sourceRoot=pkg}){
 if(!isAbsolute(pkg||'')||!isAbsolute(sourceRoot||''))fail();const destinationRoot=realpathSync(pkg),source=realpathSync(sourceRoot),snapshot=join(destinationRoot,UPSTREAM_SNAPSHOT_DIRECTORY),marker=join(snapshot,'manifest.json');
 const meta=JSON.parse(readFileSync(join(destinationRoot,'package.json'),'utf8'));if(meta.name!=='dsh-pet'||meta.version!=='0.4.1')fail();
 if(existsSync(snapshot)){if(lstatSync(snapshot).isSymbolicLink()||realpathSync(snapshot)!==snapshot)fail();const manifest=JSON.parse(readFileSync(marker,'utf8'));if(manifest.schemaVersion!==1||manifest.version!=='0.4.1'||JSON.stringify(manifest.files)!==JSON.stringify(UPSTREAM_SHA256_041))fail();for(const name of Object.keys(UPSTREAM_SHA256_041))verified(snapshot,name);return{status:'current',files:Object.keys(UPSTREAM_SHA256_041).length};}
 const planned=Object.keys(UPSTREAM_SHA256_041).map(name=>[name,verified(source,name)]);mkdirSync(snapshot);for(const[name,bytes]of planned){const file=join(snapshot,name);mkdirSync(dirname(file),{recursive:true});if(!within(snapshot,realpathSync(dirname(file))))fail();const temp=file+'.tmp-'+randomUUID();try{writeFileSync(temp,bytes,{flag:'wx',mode:0o600});renameSync(temp,file);}finally{if(existsSync(temp))unlinkSync(temp);}}writeFileSync(marker,JSON.stringify({schemaVersion:1,version:'0.4.1',files:UPSTREAM_SHA256_041})+'\n',{flag:'wx',mode:0o600});return{status:'captured',files:planned.length};
}

/** 测试可读原件，副本或未留原件的已修改输入一律停止；没有 data 目录隐式回退。 */
export function readVerifiedUpstream041(pkg,name){
 if(!Object.hasOwn(UPSTREAM_SHA256_041,name))fail();const root=realpathSync(pkg),snapshot=join(root,UPSTREAM_SNAPSHOT_DIRECTORY);if(existsSync(snapshot)){if(lstatSync(snapshot).isSymbolicLink()||realpathSync(snapshot)!==snapshot)fail();return verified(snapshot,name).toString('utf8');}return verified(root,name).toString('utf8');
}
