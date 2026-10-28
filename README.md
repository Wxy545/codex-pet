# Codex Pet

[English](README.md) | [简体中文](README.zh-CN.md)

A Windows desktop companion for Codex. It reacts while Codex is thinking, working, or waiting for you, then wanders off to play with a Rubik’s cube or eat a bowl of rice.

Built on [dsh-pet](https://github.com/PC2005-cloud/dsh-pet), with Codex session status, usage snapshots, chat, file tasks, and Windows notifications.

[![Support development on Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20development-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/wxy545)

## Install

Windows only. Install and sign in to Codex CLI first, then send this to Codex:

```text
Install and start https://github.com/Wxy545/codex-pet on Windows. Follow the repository’s INSTALL.md.
```

The installer prepares Node.js and the desktop runtime; Git is optional. When it downloads portable Node.js, it checks the official SHA256. New installations use `%LOCALAPPDATA%\codex-pet`. Existing installations can keep their current directory.

<details>
<summary>Install from PowerShell</summary>

```powershell
$installer = Join-Path $env:TEMP 'codex-pet-install.ps1'; $file = Invoke-RestMethod 'https://api.github.com/repos/Wxy545/codex-pet/contents/install.ps1?ref=main' -Headers @{'User-Agent'='codex-pet'}; [IO.File]::WriteAllBytes($installer, [Convert]::FromBase64String($file.content)); powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

</details>

Double-click `Start Codex Pet.vbs` to start it again, or `Stop Codex Pet.vbs` to stop it. The existing `start.ps1`, `stop.ps1`, and Chinese launchers remain usable. See [INSTALL.md](INSTALL.md) for custom paths and manual setup.

## What it does

- **Desktop interactions:** click, drag, throw, bounce, roam, or pick an animation from the right-click menu.
- **Codex status:** follow multiple local sessions and show when work is running or needs your attention.
- **Usage:** show the usage and reset-time snapshots recorded in local Codex logs.
- **Chat and images:** ask a question with text, PNG, JPEG, or WebP through your signed-in Codex CLI.
- **File tasks:** choose a working directory, write a task, and confirm its permission before running it.
- **Notifications:** let Windows tell you about completion, errors, or a request for confirmation while Codex is in the background.

Chat and idle chatter use Codex usage. Idle chatter starts at a ten-minute interval and can be changed or disabled in AI settings. File tasks are a separate, explicit action; ordinary chat and idle chatter do not run them.

File tasks default to read-only. If you allow changes, the selected directory becomes the Codex working directory and the CLI uses its workspace-write sandbox. This is a CLI task panel; it does not control your desktop mouse.

Usage is a local log snapshot. If no snapshot is available yet, finish a reply in the main Codex chat and check again. Windows notification settings and Focus/Do not disturb can affect delivery; opening a chat from a notification also depends on the registered Codex protocol.

## Characters and animations

The included blue whale maid is the original dsh-pet character, with **106 upstream transparent video animations**. The previews below are from that project:

<p>
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/dianji-huiying-yuanqi-huishou.gif" width="180" alt="Upstream whale maid waving">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/yuandi-zhuanxin-wan-mofang.gif" width="180" alt="Upstream whale maid playing with a Rubik’s cube">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/chi-baifan.gif" width="180" alt="Upstream whale maid eating rice">
</p>

Dragon-girl artwork is a local experiment awaiting permission from the original artist. Its four-frame studies are prototypes, not finished replacements for the whale’s 106 video clips. The next animation target is a small set of original core actions. Adult-proportioned forms need their own artwork and motion.

New dragon artwork is not distributed in the public repository. If you have made an animation you can authorize us to use, open an Issue with its source, permission, and a preview. See [animation contributions](docs/animation-contributions.md) for the proposed specs and review process.

## Start with Codex, keep up with updates

Follow-start is enabled by the installer. After you stop the pet manually, it stays stopped for the rest of that Codex run. To disable follow-start:

```powershell
powershell -File scripts/disable-follow.ps1
```

The repository includes Codex and upstream compatibility checks. Installation does not create a scheduled maintenance task. To set up a daily check, ask Codex:

```text
Set up a daily 9 AM maintenance task for my local Codex Pet installation. Check Codex and upstream dsh-pet updates. Investigate and validate compatibility changes within the repository I authorize, and only publish to a repository I authorize. Stay quiet when nothing changes; notify me when a check fails or needs my input.
```

See [maintenance](docs/maintenance.md) for manual checks, development setup, and troubleshooting.

## Support development

You can [support the project on Ko-fi](https://ko-fi.com/wxy545) or use the WeChat code below. Contributions help with development and more dragon-girl animations. You can also help by testing, reporting bugs, or offering videos with clear reuse permission.

Support is voluntary; it does not unlock paid features or guarantee a particular animation or delivery date.

<details>
<summary>WeChat support</summary>

<img src="docs/assets/wechat-support.jpg" width="220" alt="WeChat support code shared by the maintainer">

</details>

## Credits and license

Thanks to [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) for the desktop pet, animations, and interactions. This adaptation uses `dsh-pet@0.3.8`.

The original “溟月” character is by [上善无形](https://space.bilibili.com/4456176); the DeepSeek whale-maid design is by [ZipZipPipe](https://space.bilibili.com/4168597). Codex Pet is a community project, unaffiliated with OpenAI or DeepSeek.

Our code and documentation are [MIT licensed](LICENSE). This does not relicense third-party artwork: upstream animations retain their noncommercial terms, and the whale character is subject to **CC BY-NC-SA 4.0**. New dragon artwork remains unpublished pending the artist’s permission. See [third-party notices](THIRD_PARTY_NOTICES.md).

<a id="验证范围"></a>

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md). Click, drag, and menu interactions have been checked by the user on Windows; notification submission was checked separately. Changes to desktop behavior still need testing on a real Windows session.
