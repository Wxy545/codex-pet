# dsh-pet-codex 🐋

一只住在 Codex 旁边的蓝色大肥鱼。你让 Codex 干活，她在桌面上思考、忙碌、等你确认；闲下来就开始打盹、玩魔方、吃白饭。

沿用 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的角色动画和桌面互动，接上 Codex 的任务、额度、聊天和通知。Windows 独立运行，不需要启动 DeepSeek Harness。

## 安装与启动

把这句话发给 Codex：

```text
帮我安装并启动 https://github.com/Wxy545/dsh-pet-codex，按仓库的 INSTALL.md 操作。
```

Codex CLI 需要提前安装并正常登录。安装器会准备桌宠所需的 Node.js 和运行环境，不需要预装 Git；缺少合适的 Node.js 时，会下载官方便携版并校验 SHA256。

也可以自己在 PowerShell 里运行这一行：

```powershell
$installer = Join-Path $env:TEMP 'dsh-pet-codex-install.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/Wxy545/dsh-pet-codex/main/install.ps1' -UseBasicParsing -OutFile $installer; powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

默认安装到 `%LOCALAPPDATA%\dsh-pet-codex`，装好后启动。以后在安装目录双击 **启动大肥鱼.vbs** 就能叫她出来，双击 **停止大肥鱼.vbs** 让她休息。自定义目录和手动安装见 [INSTALL.md](INSTALL.md)。

## 🎮 先戳一下

- **戳她**：开心蹦一下、害羞、挥手，也可能鼓起脸生气。
- **拎起来**：拖到桌面另一边，或者甩出去，看她落地反弹。
- **随便逛逛**：在屏幕里走走，停下来打个盹、伸懒腰，翻出魔方玩一会儿。
- **点播动作**：右键 → 动作，想看吃白饭、吃火锅还是女仆舞，自己挑。

<p>
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/preview/dianji-huiying-yuanqi-huishou.gif" width="200" alt="大肥鱼挥手">
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/preview/yuandi-zhuanxin-wan-mofang.gif" width="200" alt="大肥鱼玩魔方">
  <img src="https://raw.githubusercontent.com/PC2005-cloud/dsh-pet/main/dsh-pet/assets/preview/chi-baifan.gif" width="200" alt="大肥鱼吃白饭">
</p>

动画预览来自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet#效果预览)，本项目沿用原作动画。

## 💻 跟着 Codex 开工

默认开启跟随启动：以后打开 Codex，大肥鱼也跟着出来。手动停掉桌宠后，这次 Codex 运行期间不会反复把她叫回来。想关掉跟随启动，在安装目录运行：

```powershell
powershell -File scripts/disable-follow.ps1
```

| Codex 正在做什么 | 大肥鱼的反应 |
| --- | --- |
| 思考回复 | 凝神想一想 |
| 执行工具 | 忙碌点按 |
| 整理结果 | 清点、归档 |
| 需要你确认或回答 | 停下来等你 |
| 任务完成 | 雀跃庆祝 |
| 遇到错误 | 垂头叹气 |

同时开着几个聊天也能用：桌宠会聚合会话状态，优先显示需要你确认和正在执行的任务。

## 🍚 吃白饭，也帮你看额度

右键 **查看额度**，头顶气泡会显示 Codex 已用比例和重置时间，点一下还能展开各个窗口。额度充足还是快用完了，大肥鱼会换一段对应的动作。

数据取自本机 Codex 日志里的额度快照。刚安装时如果还没有数据，在 Codex 主聊天完成一次回复后再看；过期窗口不会被补成零。

## 💬 聊两句，或者听她碎碎念

右键打开对话，说说今天写的代码，或者问她准备吃什么。回复由你本机已登录的 Codex CLI 生成，不用另外填一把 API Key。

自动碎碎念默认十分钟一次，可在 AI 设置里关闭或调整。聊天和碎碎念都会消耗 Codex 使用额度；目前只支持文字，图片和操作任务请交给 Codex 主聊天。

## 🔔 你去忙，做完叫你

切去做别的事，Codex 完成任务、出错或需要确认时，会通过 Windows 通知提醒你；回到 Codex 前台就不重复打扰。系统已注册 Codex 协议时，点击通知可以尝试回到对应聊天。

收不到通知时，先检查 Windows 是否允许通知，以及是否开启了专注模式。

## 来源与许可

感谢 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 提供原桌宠、动画和互动实现，本项目基于 **0.3.8** 适配 Codex。原型“溟月”出自 [上善无形](https://space.bilibili.com/4456176)，DeepSeek 版女仆鲸鱼娘设计出自 [ZipZipPipe](https://space.bilibili.com/4168597)。本项目是社区适配，非 DeepSeek 或 OpenAI 官方产品。

自有代码和文档采用 [MIT](LICENSE)；原动画等素材保留上游非商用条件，角色形象遵循 **CC BY-NC-SA 4.0**。完整来源、上游版权与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

<a id="验证范围"></a>

## 开发与维护

源码安装、配置、故障排查和 Codex 升级检查见 [维护文档](docs/maintenance.md)。想提问题或改代码，先看 [贡献指南](CONTRIBUTING.md)；安全问题见 [SECURITY.md](SECURITY.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。
