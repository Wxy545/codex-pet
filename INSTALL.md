# 安装 Codex Pet

在 Windows 的 Codex 聊天里发这句话：

```text
帮我安装并启动 https://github.com/Wxy545/codex-pet，按仓库的 INSTALL.md 操作。
```

如果要跟随 WorkBuddy，改用：

```text
请读取 https://github.com/Wxy545/codex-pet/blob/main/INSTALL.workbuddy.md，帮我在这台 Windows 上下载安装并启动 WorkBuddy 桌宠。
```

WorkBuddy 的完整自动安装步骤见 [INSTALL.workbuddy.md](INSTALL.workbuddy.md)。由 WorkBuddy 完成下载、环境准备、原生事件 Hook 注册、跟随启动和首次启动。

需要 Windows 64 位，无需管理员权限。Codex 模式需要本机已安装并登录 Codex CLI，聊天、看图和文件任务通过它处理。WorkBuddy 模式当前适配 Windows 客户端 5.9.3，安装器会识别正在运行的 WorkBuddy，不需要 Codex CLI。

## 执行安装

先下载仓库的安装脚本：

```powershell
$installer = Join-Path $env:TEMP ('codex-pet-install-' + [Guid]::NewGuid().ToString('N') + '.ps1')
$file = Invoke-RestMethod 'https://api.github.com/repos/Wxy545/codex-pet/contents/install.ps1?ref=main' -Headers @{'User-Agent'='codex-pet'}
[IO.File]::WriteAllBytes($installer, [Convert]::FromBase64String($file.content))
```

安装为 Codex 桌宠：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

安装为 WorkBuddy 桌宠：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -CompanionHost workbuddy
```

WorkBuddy 模式会检测正在运行的客户端。未打开客户端或需要指定安装位置时，加上实际的程序路径：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -CompanionHost workbuddy -WorkBuddyExe "D:\Apps\WorkBuddy\WorkBuddy.exe"
```

安装器下载选定提交的源码，安装锁定的 npm 依赖，准备运行时，保存联动应用，然后开启跟随启动并启动桌宠。WorkBuddy 模式还会安装任务事件插件。新安装默认目录是 `%LOCALAPPDATA%\codex-pet`，不需要 Git。已有安装不搬迁，可以继续从原目录启动。

首次启动还需要下载 Electron，请等安装脚本结束。下载或启动失败会报错并提示日志位置；文件已经装好时，可排查后双击 `Start Codex Pet.vbs` 重试；原中文启动入口仍可用。

优先使用本机已有的 Node.js 22.12 或更高版本。版本不合适时，安装器从 nodejs.org 下载 Node.js 24 LTS 便携版，按官方 SHA256 清单校验后放入安装目录，不改系统 PATH。

可以给最后一行加参数：

| 参数 | 用法 |
| --- | --- |
| `-InstallDir "D:\Apps\codex-pet"` | 安装到指定的新目录 |
| `-CompanionHost codex` | 跟随 Codex，默认选项 |
| `-CompanionHost workbuddy` | 跟随 WorkBuddy，并安装事件插件 |
| `-WorkBuddyExe "D:\Apps\WorkBuddy\WorkBuddy.exe"` | 指定 WorkBuddy 程序；省略时检测正在运行的客户端 |
| `-NoFollow` | 不注册跟随所选应用启动 |
| `-NoStart` | 安装后先不启动；跟随监控也等下次登录才运行 |

安装器只用于新安装，目标目录已存在时会报错，不覆盖源码或 `data/`，也不执行原地升级。已有安装请按[维护文档](docs/maintenance.md#更新已有安装)迁移到新目录；不要删除旧数据来绕过目录检查。

下载失败时先检查 GitHub、npm 官方源和 nodejs.org 的连接，再重试，不要改用来源不明的下载包。

## 装完确认

确认安装进程成功退出、桌宠出现，且 `data/app-error.log` 没有启动错误。

- Codex：在主聊天完成一次回复，观察工作状态变化，再从桌宠右键菜单查看额度或打开对话。
- WorkBuddy：在客户端执行一次任务，观察思考、工具执行、等待确认和完成动作。切到其他应用后，检查完成或确认通知。

Codex 新安装默认白龙娘，提供 23 段 Q 版视频；WorkBuddy 新安装默认卷卷小羊，提供 7 段透明动画。右键「形象」可切换这两只角色或保留 106 段动画的大肥鱼。已有形象选择保留，切换联动应用也不会重置角色。

新安装会复制内置角色包与启动电影。已有安装更新源码后运行 `node scripts/prepare-runtime.mjs`，准备新增素材并保留自定义角色目录和已经保存的选择。每日维护任务按需另行设置。

右键或托盘菜单的「启动演出」可选择仅桌宠、仅启动演出或两者同时开启，新安装默认两者同时开启，已有模式保留。WorkBuddy 使用卷卷小羊演出，Codex 使用约 11 秒的龙娘姐姐电影，结束后交回对应应用；可用「跳过」或 Esc 提前结束，声音可单独开关。桌宠自身保持 Q 版，不随机变身。

跟随启动在当前用户的 Windows 启动文件夹注册隐藏监控，在所选的 Codex 或 WorkBuddy 桌面程序出现时启动桌宠。手动停止后，本次应用运行期间不会反复拉起。关闭跟随启动：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "安装目录\scripts\disable-follow.ps1"
```

只安装文件、不启动窗口时，同时使用 `-NoStart -NoFollow`。

## 切换已有安装的联动应用

右键「联动应用」选择 Codex 或 WorkBuddy；有聊天或任务正在运行时，先等它结束。选择保存在安装目录的 `data/host.json`，与角色选择分开。更新时保留 `data/`。

已有 Codex 桌宠第一次接入 WorkBuddy 时，先在桌宠安装目录执行一次插件安装，填入实际的 WorkBuddy 程序路径：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File workbuddy/install.ps1 -AppRoot (Get-Location).Path -WorkBuddyExe "D:\Apps\WorkBuddy\WorkBuddy.exe"
```

然后从右键菜单切换到 WorkBuddy。切回 Codex 时需要本机 Codex CLI 可用。插件安装与移除见 [workbuddy/README.md](workbuddy/README.md)。

WorkBuddy 模式保留工作状态、桌面互动、跟随启动、完成与确认通知。由于没有可供本接入使用的可靠账号聊天与额度 API，桌宠中的聊天、图片输入、文件任务、额度和 AI 碎碎念入口会隐藏；聊天和新任务在 WorkBuddy 内提交。

手动源码安装、配置与更新见[维护文档](docs/maintenance.md)。

## 安装到 DeepSeek Harness

在 Codex 中发送：

```text
帮我把 https://github.com/Wxy545/codex-pet 的白龙娘插件装到 DeepSeek Harness，按 harness/README.md 操作，保留已有宠物和配置。
```

这一入口使用 Harness 的原生 dsh-pet 插件和 23 段白龙娘 Q 版动画。所需 CLI、profile 选择和安装命令见 [Harness 插件说明](harness/README.md)。
