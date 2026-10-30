/** 设置保存沿用上游处理器；只在本次Helper重建期间保留一次短期窗口恢复意图。 */
export function installControlResume({routes,prefix='/dsh-pet-7340',now=Date.now}={}) {
 if(!Array.isArray(routes)||typeof now!=='function'||typeof prefix!=='string'||!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(prefix))throw new TypeError('invalid control resume options');
 const matches=routes.filter(route=>route.kind==='prefix'&&route.path===prefix&&typeof route.handler==='function');
 if(matches.length!==1)throw new Error('control resume upstream route must be unique');
 const upstream=matches[0],config=`${prefix}/config`,reload=`${prefix}/reload`,consume=`${prefix}/control-resume`;
 if(routes.some(route=>route.kind==='exact'&&[config,reload,consume].includes(route.path)))throw new Error('control resume route conflict');
 let pending=null,disposed=false;
 const send=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
 const clear=marker=>{if(pending===marker)pending=null;};
 const proxy=method=>async(req,res)=>{
  if(disposed)return upstream.handler(req,res);
  const controlled=req.method===method&&req.headers?.['x-codex-pet-control']==='1'&&req.headers?.origin===undefined;
  const marker=controlled?{expiresAt:now()+15000}:null;
  if(marker)pending=marker;
  const finish=()=>{if(marker&&res.statusCode>=400)clear(marker);cleanup();};
  // 上游重建Helper会先结束发起请求的旧客户端；连接关闭不能抹掉已授权的恢复意图。
  const close=()=>{cleanup();};
  const cleanup=()=>{res.removeListener?.('finish',finish);res.removeListener?.('close',close);};
  if(marker){res.once('finish',finish);res.once('close',close);}
  try{
   // 原请求对象与正文只交给原处理器，不建立第二份配置保存或请求体读取逻辑。
   const result=await upstream.handler(req,res);
   if(marker&&res.writableEnded&&res.statusCode>=400)clear(marker);
   return result;
  }catch(error){if(marker)clear(marker);cleanup();throw error;}
 };
 const owned=[
  {kind:'exact',path:config,handler:proxy('PUT')},
  {kind:'exact',path:reload,handler:proxy('POST')},
  {kind:'exact',path:consume,handler:(req,res)=>{
   if(req.headers?.origin!==undefined){send(res,403,{error:'origin_not_allowed'});return;}
   if(req.method!=='POST'){send(res,405,{error:'method_not_allowed'});return;}
   const resumeSettings=!disposed&&pending!==null&&now()<pending.expiresAt;
   pending=null;send(res,200,{resumeSettings});
  }},
 ];
 routes.unshift(...owned);
 return{dispose(){if(disposed)return;disposed=true;pending=null;for(const route of owned){const index=routes.indexOf(route);if(index>=0)routes.splice(index,1);}}};
}
