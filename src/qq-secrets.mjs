import {spawn} from 'node:child_process';
import {join} from 'node:path';

// 密钥只经stdin交给当前Windows用户的DPAPI，不放命令行、日志或HTTP响应。
async function crypt(value, decrypt) {
  if(process.platform!=='win32')throw Object.assign(Error('secret-store-unavailable'),{code:'secret_store_unavailable'});
  const script=`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;[Console]::InputEncoding=New-Object Text.UTF8Encoding($false);[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);$v=[Console]::In.ReadToEnd();`+(decrypt
    ? `$b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([Text.Encoding]::UTF8.GetString($b))`
    : `$b=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([Convert]::ToBase64String($b))`);
  return new Promise((resolve,reject)=>{
    let output='',done=false;
    const child=spawn(join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);error?reject(Object.assign(Error('secret-store-unavailable'),{code:'secret_store_unavailable'})):resolve(result);};
    const timer=setTimeout(()=>{child.kill();finish(true);},8000);
    child.on('error',()=>finish(true));child.stdin.on('error',()=>finish(true));
    child.stdout.setEncoding('utf8');child.stdout.on('data',part=>{output+=part;if(output.length>32768){child.kill();finish(true);}});
    child.on('close',code=>finish(code!==0,output.replace(/^\uFEFF/,'')));
    child.stdin.end(value);
  });
}
export const protectQQSecret=value=>crypt(value,false);
export const unprotectQQSecret=value=>crypt(value,true);
