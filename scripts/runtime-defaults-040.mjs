// 只处理官方 0.4.0 依赖的默认模板；用户覆盖仍由上游配置合并执行。
const fields=[
 ['chatMemoryRounds',10,5],['chatImageLimit',20,10],
 ['clickSoundEnabled',true,false],['chatAnimationEnabled',true,true],['trayEnabled',true,true],
 ['petCollision',true,false],['hapticEnabled',true,false],['tiltGravity',true,false],['shakeThrow',true,false]
];
const physicsKeys=new Set(['petCollision','hapticEnabled','tiltGravity','shakeThrow']);
const tracked=new Set(['physics',...fields.map(([key])=>key)]);
const fail=detail=>{throw Error('dsh-pet 0.4.0 默认模板锚点不匹配：'+detail);};

// 等长遮蔽注释，字符串中的 URL、注释样式文本与所有原文偏移保持不变。
function maskComments(source){
 const chars=source.split('');let inString=false;
 for(let index=0;index<source.length;index++){
  const char=source[index];
  if(inString){if(char==='\\')index++;else if(char==='"')inString=false;continue;}
  if(char==='"'){inString=true;continue;}
  if(char!=='/')continue;
  let end;
  if(source[index+1]==='/'){end=index+2;while(end<source.length&&!/[\r\n]/.test(source[end]))end++;}
  else if(source[index+1]==='*'){const closing=source.indexOf('*/',index+2);if(closing<0)fail('注释未闭合');end=closing+2;}
  else continue;
  for(let cursor=index;cursor<end;cursor++)if(!/[\r\n]/.test(chars[cursor]))chars[cursor]=' ';
  index=end-1;
 }
 return chars.join('');
}

/** 保留升级前的默认成本、声音与物理行为；只返回模板文本，不执行文件操作。 */
export function preserveRuntimeDefaults040(source){
 if(typeof source!=='string')fail('模板必须是字符串');
 const masked=maskComments(source);let config;
 try{config=JSON.parse(masked);}catch{fail('模板不是有效 JSONC');}
 if(!config||Array.isArray(config)||typeof config!=='object'||!config.physics||Array.isArray(config.physics)||typeof config.physics!=='object')fail('physics 结构');
 const anchors=new Map();
 // 先按完整 JSON 字符串扫描，注释和字符串值里的同名示例不能充当属性锚点。
 for(const token of masked.matchAll(/"(?:\\.|[^"\\])*"/g)){
  const key=JSON.parse(token[0]);if(!tracked.has(key))continue;
  const after=token.index+token[0].length,colon=/^\s*:/.exec(masked.slice(after));if(!colon)continue;
  if(anchors.has(key))fail(key+' 重复');
  const valueStart=after+colon[0].length+(/^\s*/.exec(masked.slice(after+colon[0].length))?.[0].length||0);
  anchors.set(key,{start:valueStart});
 }
 for(const key of tracked)if(!anchors.has(key))fail(key+' 缺失');
 const changes=[],states=new Set();
 for(const[key,upstream,preserved]of fields){
  const owner=physicsKeys.has(key)?config.physics:config;
  if(!Object.hasOwn(owner,key))fail(key+' 位置错误');
  const value=owner[key];if(value!==upstream&&value!==preserved)fail(key+' 值未知');
  const anchor=anchors.get(key),literal=/^(?:true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(masked.slice(anchor.start))?.[0];
  if(literal!==JSON.stringify(value))fail(key+' 字面量损坏');
  if(upstream!==preserved){states.add(value===upstream?'stock':'preserved');changes.push({...anchor,end:anchor.start+literal.length,value:JSON.stringify(preserved)});}
 }
 // 完整原版与完整已补丁版都可重复准备；半应用文件不静默补齐，避免掩盖未知修改。
 if(states.size!==1)fail('模板仅应用了部分默认值');
 if(states.has('preserved'))return source;
 let result=source;
 for(const change of changes.sort((left,right)=>right.start-left.start))result=result.slice(0,change.start)+change.value+result.slice(change.end);
 return result;
}
