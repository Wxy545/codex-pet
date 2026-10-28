# 脚本消息跟随Windows显示语言；不修改系统设置，也不改变技术JSON字段。
function Get-CodexPetText {
    param([string]$Chinese, [string]$English)
    $taskUiLanguage = [string](Get-UICulture).Name
    if ($taskUiLanguage -match '^zh(?:[-_]|$)') { return $Chinese }
    return $English
}
