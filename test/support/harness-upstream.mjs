import {readVerifiedUpstream046} from '../../scripts/upstream-snapshot-046.mjs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readVerifiedUpstream040} from '../../scripts/upstream-snapshot-040.mjs';
import {readVerifiedUpstream041} from '../../scripts/upstream-snapshot-041.mjs';
import {readVerifiedUpstream043} from '../../scripts/upstream-snapshot-043.mjs';
import {readVerifiedUpstream045} from '../../scripts/upstream-snapshot-045.mjs';
// 只读已核验官方原件；CI默认锁定安装，不碰正式Harness profile。
export const upstreamRoot=process.env.CODEX_PET_TEST_UPSTREAM?resolve(process.env.CODEX_PET_TEST_UPSTREAM):fileURLToPath(new URL('../../node_modules/dsh-pet/',import.meta.url));
export const upstreamVersion=JSON.parse(readFileSync(resolve(upstreamRoot,'package.json'),'utf8')).version;
export const readUpstream=name=>{
 if(upstreamVersion==='0.4.6')return readVerifiedUpstream046(upstreamRoot,name);
 if(upstreamVersion==='0.4.5')return readVerifiedUpstream045(upstreamRoot,name);
 if(upstreamVersion==='0.4.3')return readVerifiedUpstream043(upstreamRoot,name);
 if(upstreamVersion==='0.4.1')return readVerifiedUpstream041(upstreamRoot,name);
 if(upstreamVersion==='0.4.0')return readVerifiedUpstream040(upstreamRoot,name);
 if(upstreamVersion==='0.3.8')return readFileSync(resolve(upstreamRoot,name),'utf8');
 throw Error('unreviewed-upstream-version');
};
