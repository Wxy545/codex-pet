'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),path=require('node:path');
const {readFileSync}=require('node:fs');
const psQuote=value=>"'"+value.replaceAll("'","''")+"'";
const helper=path.join(__dirname,'workbuddy-target.ps1');
const powershell=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const functions="$ErrorActionPreference='Stop';$t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile("+psQuote(helper)+",[ref]$t,[ref]$e);if($e.Count){throw 'parse-failed'};foreach($f in $a.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){Invoke-Expression $f.Extent.Text};";
function run(body){return JSON.parse(execFileSync(powershell,['-NoProfile','-NonInteractive','-Command',functions+body],{encoding:'utf8',windowsHide:true,timeout:12000}).trim());}

test('WorkBuddy托盘恢复只启动再次验证过的同一程序，无可见窗时有限重探', {skip:process.platform!=='win32'},()=>{
 for(const fixture of [
  {kind:'tray',start:true,registered:0,window:42,tries:3},
  {kind:'closed',start:true,registered:1,window:42,tries:3},
  {kind:'unverified',start:false,registered:0,window:0,tries:0},
  {kind:'replaced',start:false,registered:0,window:0,tries:0},
  {kind:'invalid-registration',start:false,registered:1,window:0,tries:0},
  {kind:'no-window',start:true,registered:0,window:0,tries:20},
 ]){
  const command="$global:k="+psQuote(fixture.kind)+";$global:starts=@();$global:finds=0;$global:registrations=0;"+
   "function global:Get-Process{[CmdletBinding()]param([string]$Name,[int]$Id);if($global:k -in @('closed','invalid-registration')){return};[pscustomobject]@{Id=17;Path='C:\\Fixture\\WorkBuddy.exe';Product=$(if($global:k -eq 'unverified'){'Other'}else{'WorkBuddy'});Company='Tencent Technology (Shenzhen) Company Limited'}};"+
   "function global:Test-WorkBuddyExecutable([string]$Executable){return $global:k -notin @('replaced','invalid-registration') -and $Executable -eq 'C:\\Fixture\\WorkBuddy.exe'};"+
   "function global:Get-RegisteredWorkBuddyExecutable{$global:registrations++;return 'C:\\Fixture\\WorkBuddy.exe'};"+
   "function global:Get-WorkBuddyWindow{$global:finds++;if($global:k -ne 'no-window' -and $global:finds -ge 3){return [IntPtr]42};return [IntPtr]::Zero};"+
   "function global:Start-Process{param($FilePath,$WorkingDirectory,$WindowStyle);$global:starts+=@{file=$FilePath;directory=$WorkingDirectory;style=$WindowStyle}};function global:Start-Sleep{param($Milliseconds)};"+
   "$w=Restore-WorkBuddyWindow;@{window=$w.ToInt64();starts=@($global:starts);tries=$global:finds;registrations=$global:registrations}|ConvertTo-Json -Compress -Depth 4";
  const result=run(command);assert.equal(result.window,fixture.window,fixture.kind);assert.equal(result.starts.length,Number(fixture.start),fixture.kind);assert.equal(result.registrations,fixture.registered,fixture.kind);assert.equal(result.tries,fixture.tries,fixture.kind);
  if(fixture.start){assert.equal(result.starts[0].file,'C:\\Fixture\\WorkBuddy.exe');assert.equal(result.starts[0].style,'Normal');}
 }
});

test('WorkBuddy程序路径拒绝URL、相对路径及其他exe，恢复分支只由Focus调用', {skip:process.platform!=='win32'},()=>{
 const result=run("@('https://example.com/WorkBuddy.exe','relative/WorkBuddy.exe','C:/Windows/notepad.exe')|ForEach-Object{Test-WorkBuddyExecutable $_}|ConvertTo-Json -Compress");assert.deepEqual(result,[false,false,false]);
 const source=readFileSync(helper,'utf8');assert.match(source,/\$startupWindow -eq \[IntPtr\]::Zero -and \$Action -eq 'Focus'/);assert.doesNotMatch(source,/Start-Process.*(?:http|codex:|-ArgumentList)|Stop-Process|taskkill|GetWindowText|MainWindowTitle/);
});
