# 开发与维护

产品名为 Codex Pet，公开仓库为 `Wxy545/codex-pet`。新安装默认目录为 `%LOCALAPPDATA%\codex-pet`；已有安装可以保留原目录。底层协议、通知身份等兼容标识不随产品名变更。

## 从源码运行

需要 Windows、Node.js 22.12 或更高版本，以及已安装并正常登录的 Codex CLI。日常安装可直接按 [INSTALL.md](../INSTALL.md) 操作；下面的步骤供修改源码时使用。

```powershell
git clone https://github.com/Wxy545/codex-pet.git
cd codex-pet
npm ci --legacy-peer-deps --ignore-scripts
node scripts/prepare-runtime.mjs
npm start
```

停止桌宠：

```powershell
npm run stop
```

`setup.ps1` 执行依赖安装和运行时准备。首次启动可能下载 Electron，需要能够访问相关下载服务。

## 更新已有安装

`install.ps1` 目前只向新目录安装，不提供原地自动升级。重复运行并指向已有目录会报错；不要删除旧的 `data/` 来绕过检查。源码 ZIP 安装没有 Git 元数据，不能用 `git pull` 更新。

更新前，在旧安装目录关闭跟随启动并停止桌宠：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/disable-follow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File stop.ps1
```

确认桌宠已退出后，备份旧安装目录的 `data/` 到本机其他位置，再按安装方式更新。

### 通过安装器或源码 ZIP 安装的用户

1. 下载新版源码 ZIP，解压到一个新目录。先准备 Node.js 22.12 或更高版本，再在新目录执行 `npm ci --legacy-peer-deps --ignore-scripts` 和 `node scripts/prepare-runtime.mjs`。也可重新下载安装器，用 `-InstallDir` 指定新目录，并加 `-NoStart -NoFollow`，让安装器准备环境后暂停启动。
2. 从备份恢复需要保留的桌宠偏好、人设和聊天记忆。保留新安装器准备的便携 Node.js 等运行环境，不用旧 `data/` 整体覆盖新目录。旧的 `data/dsh-pet/standalone-runtime.json`、`data/bridge-runtime.json` 是进程与令牌清单，不要恢复；新进程会重新生成。
3. 在新目录启动桌宠，确认设置与聊天记忆正常后，再启用跟随启动：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File start.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/enable-follow.ps1
```

跟随启动会改为指向新安装目录。确认新版可用后，再清理不再使用的旧安装；备份数据不要上传到仓库或 Issue。

### 通过 Git clone 安装的开发者

只有 Git clone 的工作目录可以用 `git pull`。完成上面的停机和备份步骤后，先检查本地改动并处理好自己的修改，再执行：

```powershell
git pull --ff-only
npm ci --legacy-peer-deps --ignore-scripts
node scripts/prepare-runtime.mjs
```

检查相关改动，运行对应测试，再启动桌宠并重新启用跟随。`git pull` 不会替代依赖安装或运行时准备，也不应覆盖未提交的本地修改。

运行时准备也会更新未改动的官方 0.3.0 龙娘包：保留原 10 段视频，补入 5 个特色动作。改过清单、媒体或署名文件的自定义皮肤、角色选择和其他本机数据保留。若迁移时恢复了旧角色目录，恢复后再运行一次 `node scripts/prepare-runtime.mjs`。

现在只支持 Q 版。旧版的姐姐版、偶尔变身选择按 Q 版读取；对应角色的 Q 版素材不可用时回到大肥鱼。已有素材文件保留在本机。

## 跟随 Codex 启动

安装器默认开启跟随启动，可用 `-NoFollow` 跳过。跟随器在 Windows 登录后轻量检查 Codex 桌面窗口所属的进程；Codex 从未运行变为运行时，启动桌宠。它不修改 Codex 文件，不需要管理员权限。

手动停止桌宠后，同一次 Codex 运行期间不会反复拉起桌宠。跟随启动与桌宠进程分开：停止桌宠不等于关闭以后跟随 Codex 启动的设置。

在安装目录关闭跟随：

```powershell
powershell -File scripts/disable-follow.ps1
```

重新开启：

```powershell
powershell -File scripts/enable-follow.ps1
```

## 运行时适配

当前依赖固定为 `dsh-pet@0.3.8`，由 `package-lock.json` 锁定。角色、透明动画、随机动作、点击、拖拽、甩抛、菜单与气泡沿用原实现；本项目接入 Codex 会话聚合、额度、CLI 聊天与通知。

`scripts/prepare-runtime.mjs` 从固定版本生成 Codex 宿主入口，调整额度解析，并向桌面壳挂载 Codex 扩展。依赖版本或补丁位置不匹配时会报错停止。安装或升级依赖后需要重新运行准备脚本；需要改补丁时应修改脚本，不只手改 `node_modules/`。

原版蓝色鲸鱼女仆保留 106 段视频动画。白龙娘提供 15 段 Q 版视频：10 个核心动作覆盖待机、散步、点击、转向、拖拽和 Codex 工作状态，工作与结果档共用打字素材；另有整理龙翼、抱尾小憩、掌心微光、害羞卷尾和叉腰得意。前三个特色动作会在闲逛时随机播放，后两个加入点击回应，五个都能从右键菜单点播。菜单和随机候选按已就绪的视频筛选。欢迎通过 [Issue](https://github.com/Wxy545/codex-pet/issues) 提供来源、许可和规格清楚的动作视频。

白龙娘素材位于 `assets/white-dragon/`，许可见该目录的 [NOTICE.md](../assets/white-dragon/NOTICE.md)。准备运行时会为尚无该角色目录的安装复制内置包，并为未改动的官方 0.3.0 包补入新动作；已有自定义素材和角色选择保留。原大肥鱼素材继续遵循 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 配置与本机数据

运行数据保存在安装目录的 `data/`，包括桌宠偏好、聊天记忆、本机接口能力令牌和兼容性报告。`data/`、`node_modules/` 和日志已被 Git 忽略，不应加入提交或完整上传到 Issue。

会话联动只读本机 Codex 会话日志；聊天通过 Codex CLI 使用其现有登录状态，适配器不读取或复制 Codex 登录凭据。服务监听本机回环地址，不用于外网或多人共享部署。

| 环境变量 | 用途 |
| --- | --- |
| `CODEX_PET_CLI` | 指定实际的 Codex CLI 可执行文件 |
| `CODEX_HOME` | 指定要读取的 Codex 会话目录根；默认使用当前用户的 Codex 目录 |
| `CODEX_PET_PORT` | 指定桌宠本机服务的起始端口；占用时由运行时选择可用端口 |

Windows 自动定位使用实际的 `codex.exe`。若终端只能找到 `.cmd` 等命令行 shim，可用 `CODEX_PET_CLI` 指定真正的可执行文件。未登录时按 Codex CLI 正常流程登录，不要将令牌粘贴到 Issue、聊天示例或公开配置中。

个性化人设和桌宠偏好留在本机设置中。公开默认值及测试样例不应包含个人称呼、真实会话 ID 或本机路径。

## 状态、额度与聊天

会话状态来自已观测到的本机事件。多个会话先聚合再展示，状态与任务文案应来自同一会话。日志轮转、截断或部分写入不能造成状态串线；旧的完成事件不应在重新启动后当作新通知发送。

占用锁冻结时保留最新工作快照，不切换动画和气泡。解冻后恢复最新的进行中状态及任务文字；若任务已经结束或回到空闲，则清理旧工作气泡并返回待机，不补播冻结期间的完成或出错动画。

额度来自会话日志中的 `rate_limits` 快照，不是持续联网查询的实时账户余额。只显示实际存在且仍有效的窗口，不补造缺失的月度窗口；未提供重置时间时显示“未知”。数据缺失或已过重置时间时，需要在 Codex 主聊天产生新回复后再查看。

余额动画按有效窗口中最高的已用比例分六档：`[0,20)`、`[20,40)`、`[40,60)`、`[60,80)`、`[80,100)` 和 `100%`。气泡进度条另在 70% 和 90% 切换预警颜色。原鱼保留六套档位动画；龙娘依次复用完成、完成、待机、待机、出错、出错视频，不把它们算成六段新动画。

原鱼的三套碎碎念动画保留，龙娘复用打字和思考视频。新安装默认每 600 秒查询额度，碎碎念也默认每 600 秒生成；AI 就绪后先生成一次，后续间隔和开关由 AI 设置控制。碎碎念使用当前角色的人设，切换角色会丢弃旧角色尚未返回的回复。

聊天支持文字和图片。图片入口接收 PNG、JPEG、WebP 的 data URL，校验文件签名、数量和大小；不接受远程图片 URL 或任意本地文件路径。图片只写入本次请求的临时目录，交给 Codex CLI 的 `--image` 输入，完成、失败或取消后清理。闲聊仍关闭操作工具。

操作任务通过独立面板提交，必须先用系统对话框选择工作目录，填写任务并确认本次权限。默认 `read-only`；选择 `workspace-write` 后，以所选目录为 Codex 工作目录，按 CLI 的工作目录写入沙箱执行。工作目录不是文件读取的操作系统隔离边界，读取范围依 Codex CLI 的沙箱策略。此入口不提供全桌面鼠标控制。

聊天和操作任务共用单进程门控，已有请求执行时不会叠加新的 CLI 任务。取消只终止本次 CLI 及其子进程，关闭面板本身不等于取消。

自动碎碎念初始间隔为十分钟，可在 AI 设置中关闭或调整。文字聊天、看图、自动碎碎念和操作任务都会消耗 Codex 使用额度。

## 通知排查

Codex 处于后台时，新的完成、错误和待确认事件可触发 Windows 通知；处于前台时抑制重复提醒。点击跳转需要系统注册 Codex 协议，且事件带有有效会话 ID。

排查时区分三个结果：通知是否提交到系统、是否出现在通知中心或横幅、点击是否打开对应聊天。通知设置和专注模式会影响显示；前台检查失败时，本次通知不显示。错误日志只保留固定说明及可识别的原生错误码。

先看 `data/app.log` 和 `data/app-error.log`。分享错误时只附脱敏片段或错误码，避免提交聊天正文、完整诊断报告或个人路径。安全问题按 [SECURITY.md](../SECURITY.md) 处理。

## 每日兼容检查

可在 Codex 中配置每天运行的维护任务，同时检查本机 Codex 和原版 dsh-pet：

```powershell
node scripts/check-codex-compat.mjs
node scripts/check-upstream.mjs
```

Codex 检查比较已安装的 CLI、桌面版与上次通过检查的版本，核对 CLI 参数、特性名称和近期会话事件字段，并在需要时运行本地回归测试。报告写入 `data/compatibility-report.json`。缺少日志或版本证据时会记录 `unknown`，不能当作通过；检查不发送真实模型请求。需要对未变化版本重新检查时，运行 `node scripts/check-codex-compat.mjs --force`。

上游检查只访问 [npm 官方元数据](https://registry.npmjs.org/dsh-pet) 和 [原仓库 main 提交](https://api.github.com/repos/PC2005-cloud/dsh-pet/commits/main)，比较最新稳定版、本地依赖和上次已处理的版本及提交。它不使用 GitHub 凭据，不执行 `npm update`，也不自动修改源码。日常未变化时只做两个条件请求，可用 ETag 复用观测，不运行测试或模型请求。

观测与已处理基线保存在 `data/upstream-compatibility.json`，本次报告保存在 `data/upstream-report.json`。报告中的 `candidate` 表示待调查的变更，`unchanged` 表示与已处理基线一致，`unknown` 表示证据不全或检查失败。网络超时、限流或响应异常会保留旧成功观测，不能据此判断没有更新。检查完成的退出码为 0；显式接受被拒绝为 1；检查失败或证据不足为 2。

发现候选后，先查看原版发布内容和提交差异，核对运行时补丁、接口及许可变化。需要升级依赖时，显式修改固定版本和 lock 文件，重新安装依赖并运行 `node scripts/prepare-runtime.mjs`、相关测试及 `npm test`；影响桌面互动、通知或聊天时，再验证对应的实际操作。只有 main 更新、npm 尚未发版时，也应先确认是否影响现有适配。

适配与验证完成后，用本次报告的确切版本及提交接受基线：

```powershell
$report = Get-Content data/upstream-report.json -Raw | ConvertFrom-Json
node scripts/check-upstream.mjs --accept --npm-version $report.candidate.npmVersion --github-sha $report.candidate.githubSha --verified
```

`--verified` 是执行者对已完成验证的声明，脚本不会替代验证。接受时会重新检查两个来源；候选已变化、来源失败，或本地声明、lock、已安装的 dsh-pet 版本未与候选一致时，都不会推进基线。适配失败时保留候选，下次仍会报告，不能为消除提醒而直接接受。

Codex 的 CLI 参数与会话事件可能随版本变化，dsh-pet 补丁也绑定到固定版本。升级后先收集失败证据，再修改适配，完成相关回归和实机验证后提交。

维护者本机配置为每天上午 9 点检查一次，同时关注 Codex 和原版 dsh-pet。该任务不随安装器复制，也不表示其他用户已配置调度。其他用户可按 [中文 README 中的提示](../README.zh-CN.md) 在自己的 Codex 中建立维护任务。

每日维护任务可在发现变化后调查、修改和验证，并在明确授权的仓库范围内提交、推送。未变化时保持安静；验证失败、访问失败或需要人工处理时再报告。调度由 Codex 任务承担，仓库不包含个人账户的定时任务配置。未获授权的本地角色素材不得随功能更新上传。

2026-10-28 对上游 `b78e3fc` 至 `4a222e2` 的十个提交做过差异审查。在 npm 仍为 `0.3.8` 时，择取 [4864269 的素材 Range 修复](https://github.com/PC2005-cloud/dsh-pet/commit/48642698ee73ecf2029ea85a2e8f76f562b710e5)、[86181ce 的负距离走位修复](https://github.com/PC2005-cloud/dsh-pet/commit/86181ce1660a57ab27336630bab5b344de71b28c)和 [e0c5f97 的独立模式设置菜单文案](https://github.com/PC2005-cloud/dsh-pet/commit/e0c5f9749ab74dfc31e0624b8c778dc6f1ecd044)，由 `scripts/upstream-fixes.mjs` 在准备运行时应用；锚点不匹配会停止。没有合入 DSH 专属右栏、Web 宠物改动或未接入播报的语音功能，也没有改变代码、角色和动画各自的许可。

## 验证记录

点击、拖拽和菜单已由使用者验收；Windows 通知做过 WinRT 投递验证。这些结果对应开发时的 Windows 环境。通知中心、横幅和点击跳转应分别检查，不能由其中一项推定其余项通过。

运行本地回归检查：

```powershell
npm test
```

自动测试覆盖事件聚合、日志轮转、额度解析、CLI 聊天边界、兼容性检查和通知决策。修改影响真实模型回复、桌面交互或系统通知时，还需执行相应实机路径；自动测试通过不能替代这些操作。

提交改动的范围和验证要求见 [CONTRIBUTING.md](../CONTRIBUTING.md)。引入或升级第三方内容时，同时核对 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
