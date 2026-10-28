# Codex Pet

[English](README.md) | [简体中文](README.zh-CN.md)

陪你用 Codex 干活的 Windows 桌宠。Codex 思考、工作、等你确认时，她跟着换状态；闲下来就打个盹、玩魔方、吃白饭。

基于 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，接入 Codex 会话、额度快照、对话、文件任务和 Windows 通知。

[![通过 Ko-fi 支持开发](https://img.shields.io/badge/Ko--fi-Support%20development-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/wxy545)

## 安装

目前只支持 Windows。先安装并登录 Codex CLI，再把这句话发给 Codex：

```text
帮我安装并启动 https://github.com/Wxy545/codex-pet，按仓库的 INSTALL.md 操作。
```

安装器会准备 Node.js 和桌宠运行环境，不需要预装 Git。下载便携 Node.js 时会校验官方 SHA256。新安装默认使用 `%LOCALAPPDATA%\codex-pet`；已有安装可以继续使用原目录。

<details>
<summary>自己在 PowerShell 中安装</summary>

```powershell
$installer = Join-Path $env:TEMP 'codex-pet-install.ps1'; $file = Invoke-RestMethod 'https://api.github.com/repos/Wxy545/codex-pet/contents/install.ps1?ref=main' -Headers @{'User-Agent'='codex-pet'}; [IO.File]::WriteAllBytes($installer, [Convert]::FromBase64String($file.content)); powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

</details>

以后在安装目录双击 `Start Codex Pet.vbs` 启动，双击 `Stop Codex Pet.vbs` 停止。原有 `start.ps1`、`stop.ps1` 和中文启动入口仍可用。自定义目录和手动安装见 [INSTALL.md](INSTALL.md)。

## 怎么玩

- **桌面互动**：点击、拖拽、甩抛、落地反弹、屏幕漫游，也能右键点播动作。
- **跟着工作**：聚合本机多个 Codex 会话，显示工作中、待确认等状态。
- **看看额度**：显示 Codex 日志中的用量比例和重置时间快照。
- **文字和图片对话**：通过本机已登录的 Codex CLI 回复，支持 PNG、JPEG、WebP。
- **文件任务**：选择工作目录、填写任务，确认本次权限后再执行。
- **系统通知**：Codex 在后台时，提醒任务完成、出错或需要你确认。

聊天和自动碎碎念会消耗 Codex 使用额度。碎碎念默认十分钟一次，可在 AI 设置里调整或关闭。文件任务需要单独确认，闲聊和碎碎念不会代替你提交任务。

操作任务默认只读。允许修改后，以所选目录为 Codex 工作目录，按 CLI 的工作目录写入沙箱执行。这个入口处理 CLI 任务，不提供全桌面鼠标操作。

额度取自本机日志快照；没有数据时，在 Codex 主聊天完成一次回复后再查看。Windows 通知设置和专注模式会影响显示；点击通知跳回聊天，还需要系统已注册 Codex 协议。

## 形象与动画

公开安装默认使用原版蓝色鲸鱼女仆，保留上游 **106 段透明视频动画**。下面的预览来自原作：

<p>
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/dianji-huiying-yuanqi-huishou.gif" width="180" alt="原版鲸鱼女仆挥手">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/yuandi-zhuanxin-wan-mofang.gif" width="180" alt="原版鲸鱼女仆玩魔方">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/chi-baifan.gif" width="180" alt="原版鲸鱼女仆吃白饭">
</p>

白龙娘仍是本地试作，正在向原作者沟通授权。现有四帧动作是制作草稿，不能算作原版 106 段视频的完整替代。接下来先制作少量核心原创动作；姐姐形态另做正常比例的人设和动作。

新的龙娘素材暂不随公开仓库分发。你若已有允许本项目使用的视频，欢迎在 Issue 提供来源、授权说明和预览，供后续适配。建议规格和验收方式见[动画投稿说明](docs/animation-contributions.md)。

## 跟着 Codex 启动，也跟着更新

安装器默认开启跟随启动。手动停止桌宠后，同一次 Codex 运行期间不会反复拉起。关闭跟随启动：

```powershell
powershell -File scripts/disable-follow.ps1
```

仓库提供 Codex 与原版 dsh-pet 的兼容检查，安装器不会自动创建维护定时任务。需要每天检查时，可以把这句话发给 Codex：

```text
为本机的 Codex Pet 设置每天上午 9 点运行的维护任务，同时检查 Codex 和原版 dsh-pet 更新。有变化时，在我授权的仓库范围内调查、适配和验证；需要上传时使用我授权的仓库。没有变化就保持安静，失败或需要我处理时再通知。
```

手动检查、源码运行和故障排查见[维护文档](docs/maintenance.md)。

## 支持开发

可以通过 [Ko-fi](https://ko-fi.com/wxy545) 或下方微信赞赏码支持开发和更多龙娘动画。也欢迎试用、报错，或提供来源与授权清楚的视频。

赞赏自愿，不是付费解锁，也不承诺某个动作或交付时间。

<details>
<summary>微信赞赏</summary>

<img src="docs/assets/wechat-support.jpg" width="220" alt="维护者公开的微信赞赏码">

</details>

## 致谢与许可

感谢 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 提供桌宠、动画与互动实现。本项目基于 `dsh-pet@0.3.8` 适配。

原型“溟月”出自 [上善无形](https://space.bilibili.com/4456176)，DeepSeek 版女仆鲸鱼娘设计出自 [ZipZipPipe](https://space.bilibili.com/4168597)。Codex Pet 是社区项目，非 OpenAI 或 DeepSeek 官方产品。

自有代码和文档采用 [MIT](LICENSE)。这不改变第三方美术许可：原动画保留上游非商用条件，鲸鱼角色形象遵循 **CC BY-NC-SA 4.0**。白龙娘素材待原作者授权后再决定发布。完整说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 参与维护

代码贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见 [SECURITY.md](SECURITY.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。点击、拖拽和菜单由使用者在 Windows 上验收过；通知投递另做过验证。涉及桌面行为的改动，仍需在实际 Windows 会话里检查。
