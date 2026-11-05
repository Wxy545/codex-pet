const upstreamDefaults=`const DEFAULT_PHYSICS = {
\tgravity: GRAVITY,
\trestitution: RESTITUTION,
\tgroundFriction: GROUND_FRICTION,
\tceilingBounce: true,
\tthrowPower: 1,
\tpetCollision: true,
\thapticEnabled: true,
\ttiltGravity: true,
\tshakeThrow: true
};`;
const preservedDefaults=upstreamDefaults.replace(/(hapticEnabled|tiltGravity|shakeThrow): true/g,'$1: false');
const flattenAnchor='function flattenConfigPets(merged) {';
const originalProjection='physics: conf.physics,';
// 只补成品投影的缺省，用户已有对象最后展开，显式 true/false 继续优先且不改用户文件。
const preservedProjection='physics: conf.physics && { hapticEnabled: false, tiltGravity: false, shakeThrow: false, ...conf.physics },';
const count=(source,anchor)=>source.split(anchor).length-1;
const fail=()=>{throw Error('dsh-pet 0.4.0/0.4.1/0.4.3 物理默认锚点不匹配。');};

/** 仅用于已核验的官方 0.4.0/0.4.1/0.4.3 shared-core.js/client.js；不接受缺锚点、半补丁或未知构建。 */
export function patchPhysicsDefaults040(source){
 if(typeof source!=='string')fail();
 const newline=source.includes('\r\n')?'\r\n':'\n';
 const oldDefaults=upstreamDefaults.replaceAll('\n',newline),newDefaults=preservedDefaults.replaceAll('\n',newline);
 if(count(source,'const DEFAULT_PHYSICS = {')!==1||count(source,flattenAnchor)!==1)fail();
 const start=source.indexOf(flattenAnchor),closing=source.indexOf(newline+'}',start+flattenAnchor.length);
 if(closing<0)fail();
 const end=closing+newline.length+1,flatten=source.slice(start,end);
 const original=count(source,oldDefaults)===1&&count(source,newDefaults)===0&&count(flatten,originalProjection)===1&&count(flatten,preservedProjection)===0;
 const preserved=count(source,oldDefaults)===0&&count(source,newDefaults)===1&&count(flatten,originalProjection)===0&&count(flatten,preservedProjection)===1;
 if(preserved)return source;
 if(!original)fail();
 return (source.slice(0,start)+flatten.replace(originalProjection,preservedProjection)+source.slice(end)).replace(oldDefaults,newDefaults);
}
