import {readFile} from 'node:fs/promises';

/** 子进程已创建不等于可接管；确认它完成前置检查后才允许旧桌宠退出。 */
export function waitForRestartReady({child,file,expectedPid,timeoutMs=7000,intervalMs=50}) {
  return new Promise((resolve,reject)=>{
    let done=false,reading=false;
    const finish=error=>{if(done)return;done=true;clearTimeout(deadline);clearInterval(poll);
      // 失败的交接不能留下延迟重启；仅终止本次直接创建的助手进程。
      if(error&&child.exitCode==null)try{child.kill();}catch{}
      child.removeListener('error',failed);child.removeListener('exit',exited);error?reject(error):resolve();};
    const failed=()=>finish(new Error('pet-restart-helper-failed'));
    const exited=()=>finish(new Error('pet-restart-helper-exited'));
    const check=async()=>{
      if(done||reading)return;reading=true;
      try{
        const state=JSON.parse(await readFile(file,'utf8'));
        if(state.schemaVersion!==1||state.pid!==child.pid||state.expectedPid!==expectedPid)throw new Error('pet-restart-handshake-mismatch');
        if(child.exitCode!==null&&child.exitCode!==undefined)return exited();
        finish();
      }catch(error){if(error.code!=='ENOENT')finish(error);}
      finally{reading=false;}
    };
    const deadline=setTimeout(()=>finish(new Error('pet-restart-helper-timeout')),timeoutMs);
    const poll=setInterval(()=>{void check();},intervalMs);
    child.once('error',failed);child.once('exit',exited);
    void check();
  });
}
