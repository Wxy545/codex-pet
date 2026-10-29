[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$AppRoot,[Parameter(Mandatory=$true)][string]$WorkBuddyExe,[string]$NodePath,[string]$WorkBuddyHome)
$ErrorActionPreference='Stop'
if(-not $NodePath){$NodePath=Join-Path $AppRoot 'data/runtime/node/node.exe';if(-not(Test-Path -LiteralPath $NodePath -PathType Leaf)){$NodePath=(Get-Command node.exe -CommandType Application -ErrorAction Stop|Select-Object -First 1).Source}}
$taskArgs=@((Join-Path $PSScriptRoot 'manage.mjs'),'uninstall','--app-root',$AppRoot,'--workbuddy-exe',$WorkBuddyExe,'--node-path',$NodePath)
if($WorkBuddyHome){$taskArgs+=@('--workbuddy-home',$WorkBuddyHome)}
& $NodePath @taskArgs
if($LASTEXITCODE -ne 0){throw 'WorkBuddy pet plugin uninstall failed.'}
