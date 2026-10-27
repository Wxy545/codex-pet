# 龙娘桌宠 🐉

跟着 Codex 一起开工的 Windows 桌宠。

你让 Codex 干活，她在桌面上思考、忙碌、等你确认；闲下来就开始打盹、玩魔方、吃白饭。

沿用 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的角色动画和桌面互动，接上 Codex 的任务、额度、聊天和通知。

## 选个形象

- **原版大肥鱼**：保留上游 106 段透明动画和互动，公开安装即可使用。
- **白龙娘 Q 版、姐姐版、偶尔变身**：目前是本地试作，待作者授权后发布。白龙娘的专属动作正在按原版清单逐项补齐。
- **蓝鱼姐姐版**：以蓝鱼 Q 版为基础原创延展的正常比例形象，保留蓝发、女仆装和鲸尾；目前仅在本地试作，新素材暂不发布。

下面是原版大肥鱼的动画预览：

<p>
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/dianji-huiying-yuanqi-huishou.gif" width="200" alt="大肥鱼挥手">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/yuandi-zhuanxin-wan-mofang.gif" width="200" alt="大肥鱼玩魔方">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/chi-baifan.gif" width="200" alt="大肥鱼吃白饭">
</p>

动画预览来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet#效果预览)，本项目沿用原作动画。

## 安装与启动

把这句话发给 Codex：

```text
帮我安装并启动 https://github.com/Wxy545/dsh-pet-codex，按仓库的 INSTALL.md 操作。
```

Codex CLI 需要提前安装并正常登录。安装器会准备桌宠所需的 Node.js 和运行环境，不需要预装 Git；缺少合适的 Node.js 时，会下载官方便携版并校验 SHA256。

<details>
<summary>自己在 PowerShell 里安装</summary>

运行这一行：

```powershell
$installer = Join-Path $env:TEMP 'dsh-pet-codex-install.ps1'; $file = Invoke-RestMethod 'https://api.github.com/repos/Wxy545/dsh-pet-codex/contents/install.ps1?ref=main' -Headers @{'User-Agent'='dsh-pet-codex'}; [IO.File]::WriteAllBytes($installer, [Convert]::FromBase64String($file.content)); powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

</details>

默认安装到 `%LOCALAPPDATA%\dsh-pet-codex`，装好后启动。以后在安装目录双击 **启动龙娘桌宠.vbs** 就能叫她出来，双击 **停止龙娘桌宠.vbs** 让她休息。自定义目录和手动安装见 [INSTALL.md](INSTALL.md)。

## 🎮 先戳一下

- **戳她**：开心蹦一下、害羞、挥手，也可能鼓起脸生气。
- **拎起来**：拖到桌面另一边，或者甩出去，看她落地反弹。
- **随便逛逛**：在屏幕里走走，停下来打个盹、伸懒腰，翻出魔方玩一会儿。
- **点播动作**：右键 → 动作，想看吃白饭、吃火锅还是女仆舞，自己挑。

原版大肥鱼的动作完整保留。白龙娘使用自己的动作素材，尚未补齐的部分不算作已适配。

## 💻 跟着 Codex 开工

默认开启跟随启动：以后打开 Codex，桌宠也跟着出来。手动停掉桌宠后，这次 Codex 运行期间不会反复把她叫回来。想关掉跟随启动，在安装目录运行：

```powershell
powershell -File scripts/disable-follow.ps1
```

同时开着几个聊天也能用：桌宠会聚合会话状态，优先显示需要你确认和正在执行的任务。

## 🍚 吃白饭，也帮你看额度

右键 **查看额度**，头顶气泡会显示 Codex 已用比例和重置时间，点一下还能展开各个窗口。额度充足还是快用完了，桌宠会换一段对应的动作。

数据取自本机 Codex 日志里的额度快照。刚安装时如果还没有数据，在 Codex 主聊天完成一次回复后再看。

## 💬 聊两句，或者听她碎碎念

右键打开对话，说说今天写的代码，或者问她准备吃什么。

也可以附上 PNG、JPEG 或 WebP 图片一起提问。回复通过本机已登录的 Codex CLI 生成，不需要另外填写 API Key。

自动碎碎念默认十分钟一次，可在 AI 设置里关闭或调整。聊天、看图和碎碎念都会消耗 Codex 使用额度。

## 🛠️ 让她处理点事

右键打开 **操作任务**，选择工作目录，写下要做的事，再确认本次权限。默认只读；需要修改项目时，选择 **允许修改所选目录** 后再提交。面板会显示进度和结果，也可以取消本次任务。

这是指定工作目录的 Codex CLI 任务入口，不提供全桌面的鼠标操作。闲聊和自动碎碎念不会执行操作任务。

## 🔔 你去忙，做完叫你

切去做别的事，Codex 完成任务、出错或需要确认时，会通过 Windows 通知提醒你；回到 Codex 前台就不重复打扰。

系统已注册 Codex 协议时，点击通知可以尝试回到对应聊天。

收不到通知时，先检查 Windows 是否允许通知，以及是否开启了专注模式。

## 更新跟着走

仓库提供 Codex 和原版 dsh-pet 的升级检查脚本。安装器不会自动创建定时维护任务；想每天检查，可以把这句发给 Codex：

```text
为本机的龙娘桌宠设置每天上午 9 点运行的维护任务，同时检查 Codex 和原版 dsh-pet 更新。有变化时，在我授权的仓库范围内完成兼容适配和验证；需要上传时使用我授权的仓库。没有变化就保持安静，失败或需要我处理时再通知。
```

维护方式和手动检查命令见[维护文档](docs/maintenance.md#每日兼容检查)。

## 来源与许可

感谢 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 提供原桌宠、动画和互动实现，本项目基于 **0.3.8** 适配 Codex。

原型“溟月”出自 [上善无形](https://space.bilibili.com/4456176)，DeepSeek 版女仆鲸鱼娘设计出自 [ZipZipPipe](https://space.bilibili.com/4168597)。本项目是社区适配，非 DeepSeek 或 OpenAI 官方产品。

自有代码和文档采用 [MIT](LICENSE)；原动画等素材保留上游非商用条件，大肥鱼角色形象遵循 **CC BY-NC-SA 4.0**。白龙娘试作素材尚未获得发布授权，不随公开仓库分发。完整来源、上游版权与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

<a id="验证范围"></a>

## 开发与维护

源码安装、配置、故障排查和 Codex 升级检查见 [维护文档](docs/maintenance.md)。

想提问题或改代码，请先看 [贡献指南](CONTRIBUTING.md)；安全问题见 [SECURITY.md](SECURITY.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。
