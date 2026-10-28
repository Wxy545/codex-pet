# Codex Pet

[English](README.md) | [简体中文](README.zh-CN.md)

A Windows desktop companion for Codex. It reacts while Codex is thinking, working, or waiting for you, then wanders off to play with a Rubik’s cube or eat a bowl of rice.

Built on [dsh-pet](https://github.com/PC2005-cloud/dsh-pet), with Codex session status, usage snapshots, chat, file tasks, and Windows notifications.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/wxy545)

## Install

Windows only. Install and sign in to Codex CLI first, then send this to Codex:

```text
Install and start https://github.com/Wxy545/codex-pet on Windows. Follow the repository’s INSTALL.md.
```

The installer prepares Node.js and the desktop runtime; Git is optional. The default folder is `%LOCALAPPDATA%\codex-pet`. The interface follows your Windows display language: Chinese for Chinese-language systems, English for all others.

<details>
<summary>Install from PowerShell</summary>

```powershell
$installer = Join-Path $env:TEMP 'codex-pet-install.ps1'; $file = Invoke-RestMethod 'https://api.github.com/repos/Wxy545/codex-pet/contents/install.ps1?ref=main' -Headers @{'User-Agent'='codex-pet'}; [IO.File]::WriteAllBytes($installer, [Convert]::FromBase64String($file.content)); powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

</details>

The pet starts with Codex after installation. You can also double-click `Start Codex Pet.vbs` or `Stop Codex Pet.vbs` in the installation folder. After a manual stop, it stays stopped until you launch Codex again. See [INSTALL.md](INSTALL.md) for custom paths and manual setup.

## Give her a poke

- **Poke:** get a bouncy reaction, a wave, or a slightly embarrassed look.
- **Pick her up:** drag her across the desktop, or give her a toss and watch her bounce.
- **Let her wander:** she can stroll around, doze off, play with a Rubik’s cube, or enjoy some hot pot.
- **Pick an animation:** open the right-click menu and choose what to play.

## While Codex works

- **Session status:** react to thinking, working, waiting for confirmation, completion, and errors, including across multiple local sessions.
- **Usage bubbles:** check Codex usage and reset times from the right-click menu. A missing reset time shows as unknown. If no data is available after installation, finish a reply in the main Codex chat and check again.
- **Chat and images:** open Chat from the right-click menu and send text, PNG, JPEG, or WebP images. Replies use your signed-in Codex CLI.
- **Project tasks:** open Tasks, choose a folder, describe the job, and confirm it. Tasks start in read-only mode; choose “Allow edits in this folder” when you want files changed.
- **Notifications:** switch to another app and let Windows tell you when Codex finishes, hits an error, or needs your attention.

Chat and idle chatter count toward your Codex usage. Chatter runs every ten minutes by default; change the interval or turn it off in AI settings.

## Characters and animations

Choose a chibi character from **Character** in the right-click menu:

- **White Dragon Girl:** 15 chibi animations: the ten core actions for idle, walking, click response, turning, dragging, thinking, typing, waiting, success, and error, plus five more gestures. Her menu shows only the actions available for her.
- **Blue whale maid:** the original dsh-pet character and its full animation set.

The dragon girl can now tend to her wings, curl up around her tail for a nap, and play with a little magic while she idles. A shy tail curl and a smug pose join her click reactions. All five are also in the right-click menu.

<img src="docs/assets/white-dragon-idle.webp" width="220" alt="White Dragon Girl idle animation">

The default character is the original blue whale maid, with **106 transparent animations**. These previews are from [dsh-pet](https://github.com/PC2005-cloud/dsh-pet):

<p>
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/dianji-huiying-yuanqi-huishou.gif" width="180" alt="Upstream whale maid waving">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/yuandi-zhuanxin-wan-mofang.gif" width="180" alt="Upstream whale maid playing with a Rubik’s cube">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/chi-baifan.gif" width="180" alt="Upstream whale maid eating rice">
</p>

## Startup and updates

To stop the pet from launching with Codex:

```powershell
powershell -File scripts/disable-follow.ps1
```

See [maintenance](docs/maintenance.md) for Codex and dsh-pet update checks, development setup, and troubleshooting. For a daily check, ask Codex to set up a maintenance task for your installation.

After updating the source, run `node scripts/prepare-runtime.mjs` to add the new animations to an unchanged official 0.3.0 dragon pack. Custom skins and your character choice are kept.

## Buy me a coffee

Want to see more dragon-girl animations? You can help fund the video work through [Ko-fi](https://ko-fi.com/wxy545) or the WeChat code below. If you have already made an animation, share it in an [Issue](https://github.com/Wxy545/codex-pet/issues) and I’ll adapt it for the pet. See the [animation guide](docs/animation-contributions.md) for specs.

<details>
<summary>WeChat support</summary>

<img src="docs/assets/wechat-support.jpg" width="220" alt="WeChat support QR code">

</details>

## Credits and license

Thanks to [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) for the desktop pet, animations, and interactions. This adaptation uses `dsh-pet@0.3.8`.

The original “溟月” character is by [上善无形](https://space.bilibili.com/4456176); the DeepSeek whale-maid design is by [ZipZipPipe](https://space.bilibili.com/4168597).

The white dragon girl is used with the creator's permission, credited as Xiaohongshu ID **233534463**. Her character assets have [separate terms](assets/white-dragon/NOTICE.md) from the code license.

This project’s code and documentation use the [MIT license](LICENSE). The original animations retain dsh-pet’s noncommercial terms, and the whale character uses [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Full credits and terms are in [third-party notices](THIRD_PARTY_NOTICES.md).

## Contribute

Found a bug? Open an [Issue](https://github.com/Wxy545/codex-pet/issues) with your Windows and Codex versions and the steps to reproduce it. For code contributions, security reports, and release notes, see [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).
