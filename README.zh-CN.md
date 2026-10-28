# Codex Pet

[English](README.md) | [简体中文](README.zh-CN.md)

陪你用 Codex 干活的 Windows 桌宠。Codex 思考、工作、等你确认时，她跟着换状态；闲下来就打个盹、玩魔方、吃白饭。

基于 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，接入 Codex 会话、额度快照、对话、文件任务和 Windows 通知。

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/wxy545)

## 安装

目前只支持 Windows。先安装并登录 Codex CLI，再把这句话发给 Codex：

```text
帮我安装并启动 https://github.com/Wxy545/codex-pet，按仓库的 INSTALL.md 操作。
```

安装器会准备 Node.js 和桌宠运行环境，不需要预装 Git，默认安装到 `%LOCALAPPDATA%\codex-pet`。界面跟随 Windows 显示语言：中文系统使用中文，其他语言使用英文。

<details>
<summary>自己在 PowerShell 中安装</summary>

```powershell
$installer = Join-Path $env:TEMP 'codex-pet-install.ps1'; $file = Invoke-RestMethod 'https://api.github.com/repos/Wxy545/codex-pet/contents/install.ps1?ref=main' -Headers @{'User-Agent'='codex-pet'}; [IO.File]::WriteAllBytes($installer, [Convert]::FromBase64String($file.content)); powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

</details>

安装后默认随 Codex 一起启动。也可以在安装目录双击 `Start Codex Pet.vbs` 启动，双击 `Stop Codex Pet.vbs` 停止。手动停止后，等下次启动 Codex 再跟随启动。自定义目录和手动安装见 [INSTALL.md](INSTALL.md)。

## 戳戳她，或者拎起来

- **戳一下**：Q 弹回应、开心挥手，也可能害羞或鼓起脸。
- **拎起来**：拖到桌面另一边，或者甩出去，看她落地反弹。
- **随便逛逛**：自己走走、打盹、玩魔方、吃火锅。
- **点播动作**：右键打开动作菜单，挑一段想看的。

## 跟着 Codex 开工

- **任务状态**：思考、工作、等待确认、完成和出错时切换动作，同时开着多个会话也能用。
- **额度气泡**：右键查看 Codex 已用额度和重置时间。刚装好还没有数据时，在 Codex 主聊天完成一次回复后再看。
- **聊两句**：右键打开对话，可以发文字，也可以附上 PNG、JPEG 或 WebP 图片。回复使用本机已登录的 Codex CLI。
- **处理项目文件**：右键打开操作任务，选择目录、填写要做的事，再确认执行。默认只读，需要改文件时选择允许修改所选目录。
- **做完叫你**：切去做别的事，Codex 完成任务、出错或需要确认时，通过 Windows 通知提醒你。

聊天和碎碎念会使用你的 Codex 额度。碎碎念默认十分钟一次，可在 AI 设置里调整或关闭。

## 形象与动画

默认提供原版蓝色鲸鱼女仆，保留 **106 段透明动画**。下面的预览来自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)：

<p>
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/dianji-huiying-yuanqi-huishou.gif" width="180" alt="原版鲸鱼女仆挥手">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/yuandi-zhuanxin-wan-mofang.gif" width="180" alt="原版鲸鱼女仆玩魔方">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/chi-baifan.gif" width="180" alt="原版鲸鱼女仆吃白饭">
</p>

## 启动与更新

关闭随 Codex 启动：

```powershell
powershell -File scripts/disable-follow.ps1
```

Codex 和 dsh-pet 的更新检查、源码运行及故障排查见[维护文档](docs/maintenance.md)。需要定时检查时，可以让 Codex 为你的安装设置每日维护任务。

## 请我喝杯咖啡

想让龙娘有更多动作，可以通过 [Ko-fi](https://ko-fi.com/wxy545) 或下方微信赞赏码支持视频制作。你也可以在 [Issue](https://github.com/Wxy545/codex-pet/issues) 发来已经生成好的动作视频，我来适配进桌宠。投稿规格见[动画投稿说明](docs/animation-contributions.md)。

<details>
<summary>微信赞赏</summary>

<img src="docs/assets/wechat-support.jpg" width="220" alt="微信赞赏码">

</details>

## 致谢与许可

感谢 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 提供桌宠、动画与互动实现。本项目基于 `dsh-pet@0.3.8` 适配。

原型“溟月”出自 [上善无形](https://space.bilibili.com/4456176)，DeepSeek 版女仆鲸鱼娘设计出自 [ZipZipPipe](https://space.bilibili.com/4168597)。

项目自有代码和文档采用 [MIT](LICENSE)，原版动画等素材遵守上游非商用约定，鲸鱼娘形象采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。完整来源与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 参与维护

遇到问题，欢迎到 [Issues](https://github.com/Wxy545/codex-pet/issues) 留下 Windows、Codex 版本和复现步骤。代码贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见 [SECURITY.md](SECURITY.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。
