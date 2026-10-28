# 安装 Codex Pet

在 Windows 的 Codex 聊天里发这句话就行：

```text
帮我安装并启动 https://github.com/Wxy545/codex-pet，按仓库的 INSTALL.md 操作。
```

以下步骤供 Codex 执行安装。需要 Windows 64 位，无需管理员权限。先确认本机 Codex 能正常使用；桌宠聊天、看图和操作任务通过已登录的 Codex CLI 处理。

## 执行安装

下载并运行仓库的安装脚本：

```powershell
$installer = Join-Path $env:TEMP ('codex-pet-install-' + [Guid]::NewGuid().ToString('N') + '.ps1')
$file = Invoke-RestMethod 'https://api.github.com/repos/Wxy545/codex-pet/contents/install.ps1?ref=main' -Headers @{'User-Agent'='codex-pet'}
[IO.File]::WriteAllBytes($installer, [Convert]::FromBase64String($file.content))
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

安装器下载本次选定提交的源码，安装锁定的 npm 依赖，准备运行时，然后开启跟随 Codex 启动并启动桌宠。新安装默认目录是 `%LOCALAPPDATA%\codex-pet`，不需要 Git。已有安装不搬迁，可以继续从原目录启动。

首次启动还需要下载 Electron，请等安装脚本结束。下载或启动失败会报错并提示日志位置；文件已经装好时，可排查后双击 `Start Codex Pet.vbs` 重试；原中文启动入口仍可用。

优先使用本机已有的 Node.js 22.12 或更高版本。版本不合适时，安装器从 nodejs.org 下载 Node.js 24 LTS 便携版，按官方 SHA256 清单校验后放入安装目录，不改系统 PATH。

可以给最后一行加参数：

| 参数 | 用法 |
| --- | --- |
| `-InstallDir "D:\Apps\codex-pet"` | 安装到指定的新目录 |
| `-NoFollow` | 不注册跟随 Codex 启动 |
| `-NoStart` | 安装后先不启动；跟随监控也等下次登录才运行 |

安装器只用于新安装，目标目录已存在时会报错，不覆盖源码或 `data/`，也不执行原地升级。已有安装请按[维护文档](docs/maintenance.md#更新已有安装)迁移到新目录；不要删除旧数据来绕过目录检查。

下载失败时先检查 GitHub、npm 官方源和 nodejs.org 的连接，再重试，不要改用来源不明的下载包。

## 装完确认

确认安装进程成功退出，目录里存在 `node_modules/dsh-pet/lib/codex-host.js`。默认安装后检查桌宠是否出现，以及 `data/app-error.log` 是否报错。在 Codex 主聊天完成一次回复，观察工作状态是否变化，再从桌宠右键菜单查看额度或打开对话。

安装包提供原版蓝色鲸鱼女仆的 106 段动画，以及白龙娘的 15 段 Q 版动画：10 个核心动作，加上整理龙翼、抱尾小憩、掌心微光、害羞卷尾和叉腰得意。默认显示原版角色，右键「形象」可切换白龙娘。前三个特色动作会在闲逛时随机出现，后两个加入点击回应，均可右键点播。

新安装会复制内置龙娘包。已有安装更新源码后运行 `node scripts/prepare-runtime.mjs`，未改动的官方 0.3.0 包会补齐新动作；自定义角色目录和形象选择保留。每日维护任务按需另行设置。

跟随启动在当前用户的 Windows 启动文件夹注册隐藏监控。它在 Codex 桌面程序出现时启动桌宠；手动停止桌宠后，本次 Codex 运行期间不会反复拉起，也不修改 Codex 安装文件。关闭跟随启动：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "安装目录\scripts\disable-follow.ps1"
```

只检查安装、不启动窗口时，同时使用 `-NoStart -NoFollow`，不调用真实模型。安装不需要读取、复制或输出 Codex 登录凭据。

手动源码安装、配置与更新见[维护文档](docs/maintenance.md)。
