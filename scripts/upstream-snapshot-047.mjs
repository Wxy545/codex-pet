import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,sep} from 'node:path';

// 官方 dsh-pet 0.4.7 npm 包已核验 sha512；此清单只保存/读取测试原件，绝不恢复运行源码。
export const UPSTREAM_SNAPSHOT_DIRECTORY='.codex-pet-upstream-0.4.7';
export const UPSTREAM_SHA256_047=Object.freeze({
  "assets/config.jsonc": "c5c6d7f6ddcc5e68a501b3a58ba7cf5863c2f283207877c20f4319054762a987",
  "lib/app.js": "cd79fd1ce4ee308d31dfaa3ada044f4885c9efdab5bc2b2020e6eedeb974bb62",
  "lib/chat-panel.js": "f57b1d88dd098aac5344cca672a08302ff63d7f010416cd927b4186dbbc954a7",
  "lib/chunk-BI7llAj_.js": "a1139ad1c3d03e4567808b36d64485f4b924ee47ac50c2805beb0eb916bc14ce",
  "lib/client.js": "32bfffc88eeda99c8db6f232a62b3e7ad8215149c4dee427a8c936b69e3b5c14",
  "lib/dist-DpF6qLoG.js": "ac2691110df0c63a145e98df1aa2953d50e398cd6e72d82a421202cc276c3807",
  "lib/index.js": "55f4b63a8f73c4f0bdd3e482c292c7dfc3f351a86917795f8f942cc4f38ee049",
  "lib/node-BUn5KyQv.js": "edc6510a2455bab9ac53f96d5028c78052c40e38622e2394e0f470d8b1057714",
  "lib/node-BUxc_9IN.js": "caeb0424da4fd1f0517afddf5bf4080f270ac3c4235b6ad15085481f2ea9933b",
  "lib/node-CKdwitJ-.js": "b2c7c0122b6f6be28e01feb96a00e6175b4bd476e6e368869c2b4c8eb81a9f40",
  "lib/node-DbKTBV3f.js": "50983d5fb65e2dbc0d942f7fd607fee8a0106ab2b28b4d18308e4f5ce5ee6036",
  "lib/node-SuG7cu54.js": "edc6510a2455bab9ac53f96d5028c78052c40e38622e2394e0f470d8b1057714",
  "lib/node-y67FhQSo.js": "a5e3f8a924bd4f2f5f3de01e73bb315c0c5b8e6c04c9b6c917776c52a7361a14",
  "lib/promise-DLDcTBDg.js": "5c2fb8e64a1f951b29b0bf9f6f9d84891c93ba3b99fc9ee9cf82b4c4d85e4c0c",
  "lib/promise-DxjFfmXm.js": "5c2fb8e64a1f951b29b0bf9f6f9d84891c93ba3b99fc9ee9cf82b4c4d85e4c0c",
  "lib/standalone.js": "3542a38f87e641c1ee099abbc11721711dbce4d7aad68d52d9a16da8c734d1de",
  "package.json": "7ee3edb723c2187aa73fbec67d4bc9805fa21befe9654d5f7d241c4815160ed1",
  "runtime/electron-helper/constants.js": "dd05194d457b3c3335e246450bc36ca866995729624f0aaeb2a05cb34cd14942",
  "runtime/electron-helper/desktop-geometry.js": "61cb545170ef2259f4e75e2b3006759de4eace61d07ea1b8f62621eb91e11e90",
  "runtime/electron-helper/dpi-linearization.js": "6ea137ae8d4fadfebadc2d89ffe298256a0d94b6b9591069628631aa8f9b2462",
  "runtime/electron-helper/events.js": "3fa99a880c8fee2f182c03f947461f9bd5469b778cee63b1b2eb54d1b187882c",
  "runtime/electron-helper/host-liveness.js": "ccbde1a267f08d184a7f2dabd7292a58f179a06f57c908dc15b02b8014ceaf07",
  "runtime/electron-helper/index.html": "27bc02437783d6da035799aea1370b30d6f10c061fbe528a55bed1592279666e",
  "runtime/electron-helper/main.js": "313485a4aead0eb178ac896c391dc1813413d75a93edbc820907eee6f0269411",
  "runtime/electron-helper/main/bridge.js": "5e3bc10120e6351f93cef3b30bf22d0a91a153b0d5f7c47ea4dca52abaa57147",
  "runtime/electron-helper/main/displays.js": "9df4eb31c2467165d329282494f49fbef7f720c0b5c9458b5a2107bbf4506d4f",
  "runtime/electron-helper/main/dpi.js": "5ce7b29d835c0599ca2dabb6584586fc3e76dbd256baa90178d232c98a524fea",
  "runtime/electron-helper/main/ipc.js": "040fea02ebadb8d765d17d282b5dec1db2d5974e312dac15b2e2219b7366d3ee",
  "runtime/electron-helper/main/smoke.js": "2b8bedbe208e0d5398fc2189b81c93002c722cab720129c257d8b9057db82114",
  "runtime/electron-helper/main/tray.js": "e0f9436fe6db4d527419d3d657be7975c598972c928da08034043f4e99511edc",
  "runtime/electron-helper/main/user-data.js": "5e2468c427d83379c6f915d991aab859cd159c5662a9540dd54272ad55710509",
  "runtime/electron-helper/main/windows.js": "5b60c629e0105e6ae92dadc718b8149649bd1dd6f6be054aa016d7c9550e1fb3",
  "runtime/electron-helper/package.json": "8cf1275c9a520d92c4e997b7e28074de9881c6394522c6ca15d0fc84cd8c7ca1",
  "runtime/electron-helper/pointer-target.js": "d83112e4552ffc4f0276c5917b05f3090dd6ce443433423084900f1669ee9964",
  "runtime/electron-helper/preload.js": "102dad829ea4e2107c6bd051f4363e0d025c42ece8098ff7b7a410c85cf37ce4",
  "runtime/electron-helper/range.js": "b9c5536a05c9c85dac8abd31df4dbc1083aa888bc37fa6efc372bc1224794d3e",
  "runtime/electron-helper/renderer.js": "48a06cfca8a9751c183d37af4a3a430364749c9a58e8bd16b906fbf31273b082",
  "runtime/electron-helper/shared-core.js": "3ea957c0cf65e321ca3af02b7e951cd7063177baa2104fefed4986b5573cd539",
  "runtime/electron-helper/sprite.js": "d107e7abdfe2d63716d2c5e1e153372322119069e191971aafbaf2f35f69f7eb",
  "runtime/electron-helper/sprite/bubble.js": "3391c1d10cd912c1abf5c3cbaf985762f454ea33531ed020fe92b9a42c3394d5",
  "runtime/electron-helper/sprite/init.js": "799fea415976bf35a1f8bf25ba49a7c285d2203ead35cd822205bb5d4a206716",
  "runtime/electron-helper/sprite/input.js": "86f021db46d7907273e47a9a9971dd7c181c72f9fdcb42c13fb6f790cd3b61aa",
  "runtime/electron-helper/sprite/menu.js": "5ef496d6e02c3a4e4ec2543b4ff362caf2a6e29892008371e3322452adc1ff5b",
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
const fail=()=>{throw Error('verified-upstream-047-snapshot-required');};
function verified(root,name){const file=join(root,name),stat=lstatSync(file),real=realpathSync(file);if(!stat.isFile()||stat.isSymbolicLink()||!within(root,real)||stat.size>8*1024*1024)fail();const bytes=readFileSync(file);if(hash(bytes)!==UPSTREAM_SHA256_047[name])fail();return bytes;}

/** 只在准备运行时前留测试原件；已有原件逐项验摘要，绝不拿它覆盖实际补丁输入。 */
export async function captureUpstreamSnapshot047({pkg,sourceRoot=pkg}){
 if(!isAbsolute(pkg||'')||!isAbsolute(sourceRoot||''))fail();const destinationRoot=realpathSync(pkg),source=realpathSync(sourceRoot),snapshot=join(destinationRoot,UPSTREAM_SNAPSHOT_DIRECTORY),marker=join(snapshot,'manifest.json');
 const meta=JSON.parse(readFileSync(join(destinationRoot,'package.json'),'utf8'));if(meta.name!=='dsh-pet'||meta.version!=='0.4.7')fail();
 if(existsSync(snapshot)){if(lstatSync(snapshot).isSymbolicLink()||realpathSync(snapshot)!==snapshot)fail();const manifest=JSON.parse(readFileSync(marker,'utf8'));if(manifest.schemaVersion!==1||manifest.version!=='0.4.7'||JSON.stringify(manifest.files)!==JSON.stringify(UPSTREAM_SHA256_047))fail();for(const name of Object.keys(UPSTREAM_SHA256_047))verified(snapshot,name);return{status:'current',files:Object.keys(UPSTREAM_SHA256_047).length};}
 const planned=Object.keys(UPSTREAM_SHA256_047).map(name=>[name,verified(source,name)]);mkdirSync(snapshot);for(const[name,bytes]of planned){const file=join(snapshot,name);mkdirSync(dirname(file),{recursive:true});if(!within(snapshot,realpathSync(dirname(file))))fail();const temp=file+'.tmp-'+randomUUID();try{writeFileSync(temp,bytes,{flag:'wx',mode:0o600});renameSync(temp,file);}finally{if(existsSync(temp))unlinkSync(temp);}}writeFileSync(marker,JSON.stringify({schemaVersion:1,version:'0.4.7',files:UPSTREAM_SHA256_047})+'\n',{flag:'wx',mode:0o600});return{status:'captured',files:planned.length};
}

/** 测试可读原件，副本或未留原件的已修改输入一律停止；没有 data 目录隐式回退。 */
export function readVerifiedUpstream047(pkg,name){
 if(!Object.hasOwn(UPSTREAM_SHA256_047,name))fail();const root=realpathSync(pkg),snapshot=join(root,UPSTREAM_SNAPSHOT_DIRECTORY);if(existsSync(snapshot)){if(lstatSync(snapshot).isSymbolicLink()||realpathSync(snapshot)!==snapshot)fail();return verified(snapshot,name).toString('utf8');}return verified(root,name).toString('utf8');
}
