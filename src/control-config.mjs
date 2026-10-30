/** HTTP与桌面管道共用原路由门控，锁覆盖配置落盘及Helper重建队列。 */
export function createDesktopChangeGuard({gate,run,settled,prefix='/dsh-pet-7340'}) {
  return async(...args)=>{
    const [url,method]=args;let path;try{path=decodeURIComponent(new URL(url,'http://127.0.0.1').pathname);}catch{return run(...args);}
    const mutates=path===prefix+'/config'&&['PUT','POST'].includes(method)||path===prefix+'/reload'&&method==='POST'||path===prefix+'/pet-display'&&method==='POST';
    if(!mutates)return run(...args);
    const activity=gate(),release=activity?.acquire('control-config');
    if(!release)return{kind:'json',status:activity?409:503,obj:{error:activity?'host_busy':'preferences_unavailable'}};
    try{return await run(...args);}finally{try{await settled();}finally{release();}}
  };
}
