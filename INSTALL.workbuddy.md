# 用 WorkBuddy 安装桌宠

<!-- 维护：codex-pet contributors；范围：Windows 64 位 WorkBuddy；状态：当前安装入口；安装参数核对：2026-10-29；入口：根 install.ps1。 -->

把这段话直接发给 Windows 版 WorkBuddy：

```text
请读取 https://github.com/Wxy545/codex-pet/blob/main/INSTALL.workbuddy.md，帮我在这台 Windows 上下载安装并启动 Codex Pet。由你执行仓库根目录的 install.ps1 -CompanionHost workbuddy，自动识别正在运行的 WorkBuddy，完成运行环境准备、原生事件 Hook 注册、跟随启动和首次启动。新安装使用默认的卷卷小羊，保留已有安装和形象选择。遇到失败请给出实际错误和日志位置。
```

## 给 WorkBuddy 的执行步骤

在当前 Windows 上完成全部安装，不需要用户手工 clone、执行 npm 命令或填写 token，也不需要 Codex CLI。

下载根安装器，再以 WorkBuddy 模式运行：

```powershell
$ErrorActionPreference = 'Stop'
$installer = Join-Path $env:TEMP ('codex-pet-workbuddy-install-' + [Guid]::NewGuid().ToString('N') + '.ps1')
$file = Invoke-RestMethod 'https://api.github.com/repos/Wxy545/codex-pet/contents/install.ps1?ref=main' -Headers @{'User-Agent'='codex-pet'}
[IO.File]::WriteAllBytes($installer, [Convert]::FromBase64String($file.content))
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -CompanionHost workbuddy
if ($LASTEXITCODE -ne 0) { throw "Codex Pet 安装失败，退出码：$LASTEXITCODE。请保留安装器的实际错误。" }
```

等待安装器正常退出并完成就绪检查。确认桌宠已启动、联动应用为 WorkBuddy；新安装默认卷卷小羊。向用户报告安装目录和结果。

安装失败时，保留原始输出，报告失败步骤、实际错误及可用的日志位置。自动识别客户端失败时，从本机实际进程确认 WorkBuddy 程序路径，再使用 `-WorkBuddyExe` 指定。

目标目录已存在时保留原目录和 `data/`，按[已有安装更新说明](docs/maintenance.md#更新已有安装)处理，不清空目录或覆盖配置。

## 安装器会做什么

根 [install.ps1](install.ps1) 下载源码和锁定依赖，准备 Node.js 与 Electron，安装 WorkBuddy 原生事件插件，保存联动应用并注册跟随启动。默认安装目录为 `%LOCALAPPDATA%\codex-pet`。

运行中的 WorkBuddy 程序会被自动识别，安装器将它传给 [WorkBuddy 插件安装脚本](workbuddy/install.ps1)。插件接收任务事件，桌宠随思考、工具执行、等待确认和完成切换动作；联动应用选择保存在 `data/host.json`。

Codex 新安装默认白龙娘，WorkBuddy 新安装默认卷卷小羊。已有角色选择在更新和切换联动应用时保留。安装参数见 [INSTALL.md](INSTALL.md)，插件管理见 [workbuddy/README.md](workbuddy/README.md)。
