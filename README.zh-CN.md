# Codex Pet

[English](README.md) | [简体中文](README.zh-CN.md)

陪你用 Codex、WorkBuddy 和 DeepSeek Harness 干活的 Windows 桌宠。白龙娘、卷卷小羊、大肥鱼三只 Q 版角色可随时切换，会跟着任务换动作，也会在桌面散步、打招呼；戳一下有回应，拎起来还能甩抛反弹。

基于 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，接入任务状态、桌面互动和 Windows 通知。Codex 模式还提供额度快照、图片对话和文件任务。

<p>
  <img src="docs/assets/white-dragon-idle.webp" width="260" alt="白龙娘待机动画">
  <img src="docs/assets/curly-sheep-idle.webp" width="260" alt="卷卷小羊呼吸和眨眼">
</p>

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/wxy545)

## 安装

支持 Windows 64 位。选择你正在使用的助手，把对应的一句话发给它即可。

### WorkBuddy：默认卷卷小羊

在已安装并登录的 Windows 版 WorkBuddy 中发送：

```text
帮我下载安装并启动这个 WorkBuddy 桌宠：https://github.com/Wxy545/codex-pet/blob/main/INSTALL.workbuddy.md
```

装好后自动启动，**默认显示卷卷小羊**。下载、运行环境、事件联动和跟随启动由 WorkBuddy 调用安装器完成，用户不用手工安装依赖或修改配置，也无需安装 Codex CLI。

### Codex：默认白龙娘

先安装并登录 Codex CLI，再把这句话发给 Codex：

```text
帮我安装并启动 https://github.com/Wxy545/codex-pet，按仓库的 INSTALL.md 操作。
```

Codex 新安装默认白龙娘。两种安装方式都会开启跟随启动，已有形象选择保留。

默认安装到 `%LOCALAPPDATA%\codex-pet`，不需要预装 Git。界面跟随 Windows 显示语言：中文系统使用中文，其他语言使用英文。

安装后默认跟随所选应用启动。在控制中心或托盘的「联动应用」中可切换 Codex、WorkBuddy，或接入 [DeepSeek Harness 原生桌宠](#deepseek-harness)。也可以在安装目录双击 `Start Codex Pet.vbs` 启动，双击 `Stop Codex Pet.vbs` 停止。手动停止后，等下次启动所选应用再跟随启动。WorkBuddy 接入、自定义目录和手动安装见 [INSTALL.md](INSTALL.md)。

## 控制中心

右键桌宠打开「控制中心」，预览和切换角色，调整大小、漫游、拖拽反弹和启动演出。界面跟随系统切换深浅配色，侧栏只显示当前联动应用支持的功能。

| 功能 | Codex | WorkBuddy | DeepSeek Harness |
| --- | --- | --- | --- |
| 点击、拖拽、漫游、动作点播 | 支持 | 支持 | 原生桌宠提供 |
| 工作状态、跟随启动、完成提醒 | Codex 会话 | WorkBuddy 任务 | Harness 原生服务 |
| 额度 | 实际返回的五小时、周等窗口 | 本机客户端的剩余积分 | Harness 配置的 API 余额 |
| 桌宠内聊天、图片和文件任务 | 支持，任务默认只读 | 在 WorkBuddy 中提交 | 在 Harness 中提交 |
| AI 碎碎念 | 支持 | 不开放 | Harness 原生服务 |
| QQ 远程任务 | 桌面会话与 QQ 会话 | QQ 新建会话 | QQ 新建会话 |

切换应用后，事件、额度和通知跟着切换；启动主题只改变画面，不改变账号或任务去向。Harness 使用原生插件，其设置和服务由 Harness 管理。

在「互动」里关闭「显示桌宠」，或从托盘菜单隐藏。游戏等应用全屏时默认自动隐藏，可关闭「全屏时自动隐藏」。需要她回来时，点托盘的「显示桌宠」。隐藏期间，聊天、任务和通知继续运行。

额度条位于角色正下方。Codex 会列出实际存在的各窗口剩余比例，例如 **5小时 81% · 周 33%**，点击可看重置时间；WorkBuddy 显示积分，Harness 显示自己的 API 余额。独立桌宠下方还可显示 CPU、内存和 GPU 使用率，读不到的项目显示 **—**，可在「互动」里关闭「系统监控」。

## 戳戳她，或者拎起来

- **戳一下**：Q 弹回应、开心挥手，也可能害羞或鼓起脸。
- **拎起来**：拖到桌面另一边，或者甩出去，看她落地反弹。
- **随便逛逛**：散步、整理翅膀、吃零食、抱尾打盹。切到大肥鱼，还能看她玩魔方、吃火锅。
- **点播动作**：在「控制中心 → 动作」里挑一段想看的，右键只保留少量常用互动。

## 跟着助手开工

### Codex

- **任务状态**：思考、工作、等待确认、完成和出错时切换动作，同时开着多个会话也能用。
- **额度**：角色脚下查看剩余额度，也可从右键菜单打开详情；未提供重置时间时显示“未知”。刚装好还没有数据时，在 Codex 主聊天完成一次回复后再看。
- **聊两句**：右键打开对话，可以发文字，也可以附上 PNG、JPEG 或 WebP 图片。回复使用本机已登录的 Codex CLI。
- **处理项目文件**：右键打开操作任务，选择目录、填写要做的事，再确认执行。默认只读，需要改文件时选择允许修改所选目录。
- **做完叫你**：切去做别的事，Codex 完成任务、出错或需要确认时，通过 Windows 通知提醒你。

聊天和碎碎念会使用你的 Codex 额度。碎碎念默认十分钟一次，可在控制中心的「碎念」里调整或关闭。

### WorkBuddy

桌宠接收 WorkBuddy 5.9.3 的思考、工具执行、等待确认和完成事件，跟随 WorkBuddy 启动；切到其他应用时，任务完成或需要确认会弹 Windows 通知。

脚下额度条显示 WorkBuddy 当前个人账户的剩余积分，使用客户端自己的本机只读通道；客户端未启动、未登录或查询失败时显示未知，不折算成 Codex 的额度窗口。

桌宠内的聊天（含图片输入）、文件任务和 AI 碎碎念仍不开放。任务可以直接在 WorkBuddy 中提交，也可以使用下面的 QQ 连接。

## 在 QQ 里下任务

任务应用可选 **Codex、WorkBuddy 或 DeepSeek Harness**。手机私聊发消息，桌宠跟着任务换动作，答复和确认请求回到 QQ。电脑需要保持开机、联网，所选应用已登录，桌宠正在运行。

从桌宠或托盘打开「QQ 连接」。每种任务应用和连接方式分别保存项目、会话、权限、本人绑定及结果；点击「保存并连接」才切换，一次只运行一个连接。选择 QQ 的任务应用不会改变本机桌宠正在联动的应用或角色。

### 用普通 QQ 小号

1. 选择任务应用和「普通 QQ 小号」。
2. 点击「准备连接」，自动下载并校验约 124 MB 的 [NapCat 官方便携包](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.42)，包内自带 QQ 和 Node，不改电脑上原有的 QQ。OneBot 是连接协议，不用另装软件。
3. 点击「启动并扫码登录」，登录页准备好后会自动打开。扫码并在手机上确认。
4. 添加项目文件夹、设置「允许的最高权限」，点击「保存并连接」。连接成功后生成配对码，把已登录的小号加为好友，再用自己的 QQ **私聊发给小号**。

扫码登录和账号风控由 QQ 决定，接入不会绕过这些限制。

### 用 QQ 官方机器人

选择「QQ 官方机器人」，点击「创建 QQ 机器人」。在 QQ 开放平台创建并开通私聊权限后，把 AppID 和 AppSecret 填进本机窗口。添加项目和权限上限，点击「保存并连接」，再将生成的配对消息私聊发给机器人。

| 命令 | 用法 |
| --- | --- |
| `/项目`、`/项目 2` | 列出授权项目，按编号切换 |
| `/会话`、`/会话 2` | 列出所选应用在当前项目的会话，按编号切换 |
| `/会话 搜索 名称`、`/会话 下一页` | 按名称查找、翻页 |
| `/新建 名称` | 在所选应用中创建并命名会话 |
| `/任务 2 要做的事` | 将任务发给会话列表中的第 2 项 |
| `/模式 自动`、`/模式 聊天`、`/模式 任务` | 自动分档或固定使用聊天、任务档 |
| `/模型`、`/模型 下一页`、`/模型 聊天 2`、`/模型 任务 1` | Codex：查看可用模型，按编号或完整模型 ID 选择 |
| `/思考 聊天 low`、`/思考 任务 high` | Codex：设置模型支持的思考档位 |
| `/按聊天`、`/按任务` | 执行刚才等待选择的消息一次 |
| `/权限`、`/权限 只读`、`/权限 编辑` | 查看或调整当前权限，不超过本机授权上限 |
| `/当前`、`/状态` | 查看任务应用、项目、会话、权限和进度；Codex 还显示最近实际使用的模型和思考档位 |
| `/取消`、`/结果`、`/帮助` | 取消任务、取回保留结果、查看命令 |

**Codex** 可以接着已有桌面会话聊，也保留 QQ 新建会话。默认自动分档：日常聊天优先账号实际可用的 Luna 和 `low`，没有 Luna 则使用账号默认模型；文件和代码任务优先默认模型及 `high`，默认是 Luna 时改选可用的 Astra 或 Sol。思考档位以模型实际支持为准。分类只用本机规则，不另发模型请求；没有上下文、无法判断的消息会让你选择 `/按聊天` 或 `/按任务`。

自动判断不合适时可切固定模式；自动模式下也可用 `/任务` 明确指定任务。Codex 模型目录不可用或手选模型失效时，会提示重新选择。模型和思考设置不改变文件权限。

**WorkBuddy 和 Harness** 使用从 QQ 新建的原生会话，不接管已有桌面会话；只读和可编辑两档分别续聊。模型和思考强度遵循各自应用的设置。首版只开放受控的文件读取、写入和修改，写操作逐次确认，暂不开放 Shell 或任意 MCP 工具。Harness 请先按[原生插件说明](harness/README.md)完成安装登记，QQ 设置会准备独立的任务环境，保留原有配置。

选中列表会话后，消息会接着原会话执行。执行中或无法确认空闲的会话暂不接新任务；任务运行时不能切换项目、会话或权限。Codex 每轮远程任务设置的模型、思考和执行权限，也会影响该会话后续回合的默认值。

审批消息带有完整操作内容和一次性确认码；需要补充信息时按提示回答。投递失败的结果会留在本机，跨会话取回时标明来源；取回结果不会重新执行任务。

连接只接受已配对的本人 QQ 私聊文字，群消息、自发消息和非文字消息均不接入任务。项目目录由电脑端授权，QQ 通过列表编号选择；会话列表只显示名称和状态。AppSecret 使用当前 Windows 账号加密保存。NapCat 原生配置含本机连接令牌，安装目录的 `data/` 不要分享。

## 形象与动画

在控制中心的「角色」里切换 Q 版形象：

- **白龙娘**：Codex 新安装的默认角色，提供 23 段 Q 版视频。除了散步、点击和工作状态，还会抱书阅读、护住小宝石、整理龙翼、吃星形饼干、坐垫歇息、抱尾小憩。
- **大肥鱼**：保留原版角色及完整动作。
- **卷卷小羊 Curly**：WorkBuddy 新安装的默认角色，提供 7 段透明动画，会呼吸眨眼、迈小步、开心回应、托腮思考、敲键盘、合手等待和挥手招呼。出错与低额度状态共用思考动画。

龙娘有五种点击回应，散步之外还能振翼踏步。日常动作覆盖小动作、玩耍、吃东西、纳凉和招呼五类；额度与碎碎念会复用相应视频，菜单中标为「共用动作」。更新时保留已经保存的角色选择。

原版蓝色鲸鱼女仆保留 **106 段透明动画**。下面的预览来自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)：

<p>
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/dianji-huiying-yuanqi-huishou.gif" width="180" alt="原版鲸鱼女仆挥手">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/yuandi-zhuanxin-wan-mofang.gif" width="180" alt="原版鲸鱼女仆玩魔方">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/chi-baifan.gif" width="180" alt="原版鲸鱼女仆吃白饭">
</p>

## 启动与更新

新安装默认同时开启桌宠和启动演出。WorkBuddy 默认由卷卷小羊出场：呼吸眨眼、敲键盘、挥手。Codex 默认播放约 11 秒的龙娘姐姐电影：睁眼、镜头拉远、展翼、玻璃前景掠过，再揭开应用窗口。演出配有原创音效，可用「跳过」或 Esc 提前结束，右下角可切换声音。

姐姐形象用于启动电影，桌宠继续使用 Q 版，不会随机变身。

控制中心的「启动与联动」或托盘的「启动演出」中，可选「仅桌宠」「仅启动演出」「桌宠与启动演出」；「预览演出」可立即查看。更新时保留已经保存的模式。

在「控制中心 → 启动与联动 → 主题与视频」里，可选「跟随联动应用」、ChatGPT、DeepSeek 或 WorkBuddy。DeepSeek 使用蓝色科技演出，WorkBuddy 使用卷卷小羊。主题决定画面，播完仍回到你选定的联动应用。

也可以「导入视频」，选择自己的 MP4 或 WebM 后预览。支持最长 **60 秒、最高 4K、256 MiB** 的视频。导入副本只保存在本机；从视频库移除时，不会删除原文件。

<img src="docs/assets/startup-scene.jpg" width="720" alt="龙娘启动电影与窗口揭幕">

需要关闭跟随启动、更新或排查问题时，可以让当前助手按[维护文档](docs/maintenance.md)处理。

<details>
<summary>手动设置与源码维护</summary>

关闭跟随启动：

```powershell
powershell -File scripts/disable-follow.ps1
```

Codex 和 dsh-pet 的更新检查、源码运行及故障排查见[维护文档](docs/maintenance.md)。需要定时检查时，可以让 Codex 为你的安装设置每日维护任务。

更新源码后运行 `node scripts/prepare-runtime.mjs`，准备内置角色包和启动电影；自定义皮肤与已经保存的选择保留。

</details>

## DeepSeek Harness

在控制中心或托盘选择「联动应用 → DeepSeek Harness（原生插件）」，选择已安装的 Harness 和 profile，即可将龙娘的 23 段动画接入原生 dsh-pet。桌面版先启动一次以初始化配置，再从托盘完全退出后安装；装好后重新打开该 profile。

Harness 使用自己的账号、会话、余额和聊天。脚下额度条显示服务商实际返回的 API 金额、积分或用量窗口，点击窗口摘要可看重置时间。托盘或控制中心切回 Codex、WorkBuddy 后，恢复独立桌宠和原有角色选择。启动主题与导入视频目前用于独立桌宠，尚不控制 Harness 原生启动页。兼容版本与手动安装见[插件说明](harness/README.md)。

## 请我喝杯咖啡

想让龙娘有更多动作，可以通过 [Ko-fi](https://ko-fi.com/wxy545) 或下方微信赞赏码支持视频制作。你也可以在 [Issue](https://github.com/Wxy545/codex-pet/issues) 发来已经生成好的动作视频，我来适配进桌宠。投稿规格见[动画投稿说明](docs/animation-contributions.md)。

<details>
<summary>微信赞赏</summary>

<img src="docs/assets/wechat-support.jpg" width="220" alt="微信赞赏码">

</details>

## 致谢与许可

感谢 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 提供桌宠、动画与互动实现。本项目基于 `dsh-pet@0.3.8` 适配。

启动演出参考了 [884048454/codex-startup-animation](https://github.com/884048454/codex-startup-animation)、[yushua0808-cpu/dragon-codex-boot](https://github.com/yushua0808-cpu/dragon-codex-boot) 和 [linke-e/dsh-opening-animation](https://github.com/linke-e/dsh-opening-animation) 的启动、窗口交接与本地视频管理思路，桌宠交互也参考了 [jingh12312-rgb/bailong-desktop-pet](https://github.com/jingh12312-rgb/bailong-desktop-pet)。感谢这些项目的作者；本项目使用自制的龙娘动作与启动画面。

原型“溟月”出自 [上善无形](https://space.bilibili.com/4456176)，DeepSeek 版女仆鲸鱼娘设计出自 [ZipZipPipe](https://space.bilibili.com/4168597)。

白龙娘形象已获原作者许可，参考图署名为小红书号 **233534463**；角色素材遵循[独立许可说明](assets/white-dragon/NOTICE.md)。

卷卷小羊的 AI 参考图由 **Wxy545** 提供，已同意本项目使用并公开分发，动画制作与许可见[小羊素材说明](assets/curly-sheep/NOTICE.md)。

项目自有代码和文档采用 [MIT](LICENSE)，原版动画等素材遵守上游非商用约定，鲸鱼娘形象采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。完整来源与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

普通 QQ 小号使用本项目独立编写的 OneBot 协议适配器。[NapCat](https://github.com/NapNeko/NapCatQQ/tree/v4.18.42) 在用户本机从官方发布页原样下载，按其非商用 [Limited Redistribution License](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/LICENSE) 使用，不属于本项目的 MIT 代码。

## 参与维护

遇到问题，欢迎到 [Issues](https://github.com/Wxy545/codex-pet/issues) 留下 Windows 版本、当前联动应用及其版本和复现步骤。代码贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见 [SECURITY.md](SECURITY.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。
