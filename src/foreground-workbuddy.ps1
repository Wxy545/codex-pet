$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# 共用同一进程指纹；只返回前台布尔状态，不读取标题、聊天或登录数据。
& (Join-Path $PSScriptRoot 'workbuddy-target.ps1') -Action Foreground