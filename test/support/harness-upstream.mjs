import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readVerifiedUpstream040} from '../../scripts/upstream-snapshot-040.mjs';
// 日检可指定已核验的官方包副本；CI默认读取锁定安装，不碰正式Harness profile。
export const upstreamRoot=process.env.CODEX_PET_TEST_UPSTREAM?resolve(process.env.CODEX_PET_TEST_UPSTREAM):fileURLToPath(new URL('../../node_modules/dsh-pet/',import.meta.url));
export const readUpstream=name=>{
 const meta=JSON.parse(readFileSync(resolve(upstreamRoot,'package.json'),'utf8'));
 return meta.version==='0.4.0'?readVerifiedUpstream040(upstreamRoot,name):readFileSync(resolve(upstreamRoot,name),'utf8');
};
