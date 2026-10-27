# dsh-pet-codex

基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) **0.3.8** 的独立 Windows 桌宠适配，让蓝色大肥鱼跟随本机 Codex 会话切换动作、显示额度快照，并通过 Codex CLI 进行文字聊天。

本项目由 dsh-pet-codex contributors 维护，适用于 Windows。当前处于早期版本，功能与验证说明更新于 2026-10-28。本项目是社区适配，非 DeepSeek 或 OpenAI 官方产品。

## 来源与改动

| 来源 | 功能 |
| --- | --- |
| dsh-pet 原实现 | 角色与透明动画、随机动作、点击回应、拖拽与甩抛、右键动作菜单、气泡、桌面透明窗口 |
| 本项目适配 | Codex 多会话状态聚合、额度窗口快照、Codex CLI 文字聊天、后台任务通知、Codex 版本与接口兼容性检查 |

原形象“溟月”出自 [上善无形](https://space.bilibili.com/4456176)，DeepSeek 版女仆鲸鱼娘设计出自 [ZipZipPipe](https://space.bilibili.com/4168597)。角色和动画沿用原作，本项目负责 Codex 接入。代码与素材适用不同许可，详见 [第三方来源与许可](THIRD_PARTY_NOTICES.md)。

## 安装与启动

需要 Windows、Node.js **22.12 或更高版本**，以及能在终端正常运行并已登录的 Codex CLI。先执行 `node --version`、`codex --version` 确认环境；未登录时按 Codex CLI 的正常流程完成登录，无需向本项目提交登录令牌。Windows 自动定位只使用真正的 `codex.exe`，不通过命令行 shim 启动；若使用 npm 安装且终端只找到 `.cmd`，请将 `CODEX_PET_CLI` 指向实际的 `codex.exe`。

```powershell
git clone https://github.com/WangXinYu123456/dsh-pet-codex.git
cd dsh-pet-codex
npm ci --legacy-peer-deps --ignore-scripts
node scripts/prepare-runtime.mjs
```

也可以在项目目录运行 `setup.ps1`，它执行同一组依赖安装与运行时准备步骤。首次启动可能下载 Electron，需要能够访问相关下载服务。

准备完成后，双击 **启动大肥鱼.vbs**；退出时双击 **停止大肥鱼.vbs**。终端启动和停止命令分别是：

```powershell
npm start
npm run stop
```

`prepare-runtime.mjs` 为固定版本生成 Codex 宿主入口，调整额度窗口解析，并接入通知模块。依赖版本或补丁位置不匹配时会报错停止。升级依赖后需要重新准备运行时。

## 使用

- 点击、拖动或甩出角色，与原桌宠互动；右键可点播动作、查看额度或打开对话。
- Codex 思考、执行工具、整理结果、等待确认、完成及出错时，桌宠按已观测到的会话状态切换动作。多会话先聚合再展示。
- “查看额度”使用本机 Codex 会话日志中的 `rate_limits` 快照，显示实际存在的窗口；它不是持续联网查询的实时账户余额。数据缺失或已过重置时间时，需要在 Codex 主聊天产生新回复后再查看。
- 对话仅支持文字。回复由本机已登录的 Codex CLI 生成；聊天请求配置为只读并关闭相关工具，操作电脑、开发或图片请求应在 Codex 主聊天完成。
- 自动碎碎念初始间隔为十分钟，会消耗 Codex 使用额度。可在桌宠菜单的 AI 设置中关闭或调整间隔。
- Codex 处于后台时，完成、出错和需要确认的新事件可触发 Windows 通知；处于前台时抑制重复提醒。通知显示还受 Windows 通知设置影响。已注册 Codex 协议且事件带有效会话 ID 时，点击通知尝试打开对应聊天。

## 本机数据与配置

运行数据保存在项目内的 `data/`，包括桌宠偏好、聊天记忆、本机接口能力令牌和兼容性报告。`data/`、`node_modules/` 和日志已被 Git 忽略；不要将这些内容加入提交或完整上传到 Issue。

会话联动只读本机 Codex 会话日志。聊天通过 Codex CLI 使用其现有登录状态，适配器不读取或复制 Codex 登录凭据。服务监听本机回环地址，本机接口不是供外网或多人共享部署的服务。

| 环境变量 | 用途 |
| --- | --- |
| `CODEX_PET_CLI` | 指定 Codex CLI 可执行文件；自动定位失败时可使用 |
| `CODEX_HOME` | 指定要读取的 Codex 会话目录根；默认使用当前用户的 Codex 目录 |
| `CODEX_PET_PORT` | 指定桌宠本机服务的起始端口；占用时由运行时选择可用端口 |

修改个性化人设和桌宠偏好时，使用本机 `data/` 下的设置；不要把个人称呼、会话 ID 或本机路径写入公开默认值。

## Codex 升级与维护

提供以下兼容性检查命令：

```powershell
node scripts/check-codex-compat.mjs
node scripts/check-codex-compat.mjs --force
```

检查会比较已安装的 Codex CLI、桌面版与上次通过检查的版本，核对 CLI 参数和特性名称、近期会话事件字段，并在需要时运行本地回归测试。报告写入 `data/compatibility-report.json`。缺少日志或版本证据时会记录 `unknown`，不把证据不足记为通过；这项检查不发送真实模型请求。

如需自动维护，可自行在 Codex 中配置定时任务：检查版本变化，发现不兼容后调查、修改适配并验证。提交或推送必须在使用者明确授权的仓库与范围内进行。本程序本身不会自动改源码或升级依赖，也不附带个人账户的定时任务配置。

本项目读取的会话事件与 CLI 参数可能随 Codex 更新变化；dsh-pet 的补丁也绑定到 0.3.8。升级后应保留失败证据，并按 [贡献指南](CONTRIBUTING.md) 完成验证再提交适配。

## 验证范围

开发期间，点击、拖拽和菜单已由使用者验收；Windows 通知已做 WinRT 投递验证。这些记录对应当时的 Windows 环境，不代表其他系统版本或通知设置已通过验证。通知中心投递、横幅显示和点击跳转应分别核实。

运行本地回归检查：

```powershell
npm test
```

自动测试覆盖事件聚合、日志轮转、额度解析、CLI 聊天边界、兼容性检查和通知决策；它们不能替代真实桌面操作或模型回复验收。排查问题前先看 `data/app.log`、`data/app-error.log`，分享时只保留脱敏片段。

## 许可与参与

本项目自有代码与文档采用 [MIT](LICENSE)。dsh-pet 代码、角色、动画等第三方内容保留各自许可；原素材通过 npm 依赖取得，本仓库不将它们重新授权为 MIT。涉及角色及素材的使用须遵守非商用等原有条件，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

提交问题或改动前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题按 [SECURITY.md](SECURITY.md) 处理。变更记录见 [CHANGELOG.md](CHANGELOG.md)。
