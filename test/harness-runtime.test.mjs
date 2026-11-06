import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('Harness运行时与构建Node分离，版本检查成功和失败均恢复进程PATH', {skip:process.platform!=='win32'},t=>{
 const root=mkdtempSync(join(tmpdir(),'harness-node-scope-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const scripts=join(root,'scripts');mkdirSync(scripts);const helper=join(scripts,'harness-runtime.ps1');
 writeFileSync(helper,readFileSync(fileURLToPath(new URL('../scripts/harness-runtime.ps1',import.meta.url))));
 const cli=join(root,'dsh.cmd'),versionFile=join(root,'dsh-version.txt'),observed=join(root,'observed.json');
 writeFileSync(join(root,'dsh-stub.mjs'),`import{readFileSync,writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(observed)},JSON.stringify({node:process.execPath,version:process.versions.node}));console.log(readFileSync(${JSON.stringify(versionFile)},'utf8'));`);
 writeFileSync(cli,'@node "%~dp0dsh-stub.mjs" %*\r\n');
 const runner=join(root,'check.ps1');
 writeFileSync(runner,'\uFEFF'+`param([string]$Cli,[string]$Helper,[string]$Node)\n. $Helper\n$taskBefore=$env:PATH\ntry { $taskRuntime=Get-HarnessCliRuntime -DshCommand $Cli -HarnessNodeCommand $Node; @{ok=$true;restored=($taskBefore -ceq $env:PATH);runtime=$taskRuntime} | ConvertTo-Json -Compress } catch { @{ok=$false;restored=($taskBefore -ceq $env:PATH);message=$_.Exception.Message} | ConvertTo-Json -Compress }\n`);
 const run=version=>{writeFileSync(versionFile,version);const result=spawnSync('powershell.exe',['-NoProfile','-File',runner,'-Cli',cli,'-Helper',helper,'-Node',process.execPath],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout.trim());};
 const legacy=run('0.2.1-rc.5');assert.equal(legacy.ok,true);assert.equal(legacy.restored,true);assert.equal(legacy.runtime.Version,'0.2.1-rc.5');assert.equal(readFileSync(observed,'utf8').length>0,true);
 assert.equal(legacy.runtime.NodeCommand.toLowerCase(),process.execPath.toLowerCase());
 const [major,minor]=process.versions.node.split('.').map(Number),modern=run('0.2.2-rc.1');
 assert.equal(modern.restored,true);assert.equal(modern.ok,major>24||major===24&&minor>=9);
 if(!modern.ok)assert.match(modern.message,/24\.9/);
 const unknown=run('0.2.2-rc.2');assert.equal(unknown.ok,false);assert.equal(unknown.restored,true);assert.match(unknown.message,/Other versions have not been verified/);
});
