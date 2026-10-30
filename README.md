# Codex Pet

[English](README.md) | [简体中文](README.zh-CN.md)

A Windows desktop pet for Codex and WorkBuddy. Pick a chibi dragon girl, Curly the sheep, or the original whale maid. They react to your tasks, wander around the desktop, and bounce when you pick them up.

Built on [dsh-pet](https://github.com/PC2005-cloud/dsh-pet), with task status, desktop interactions, and Windows notifications. Codex mode also includes usage snapshots, chat with images, and project tasks.

<p>
  <img src="docs/assets/white-dragon-idle.webp" width="260" alt="White Dragon Girl idle animation">
  <img src="docs/assets/curly-sheep-idle.webp" width="260" alt="Curly the sheep breathing and blinking">
</p>

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/wxy545)

## Install

Windows 64-bit. Send the matching message below to the assistant you use.

### WorkBuddy: Curly the sheep

Open WorkBuddy on Windows, sign in, and send:

```text
Install and launch this WorkBuddy desktop pet on my Windows PC: https://github.com/Wxy545/codex-pet/blob/main/INSTALL.workbuddy.md
```

The pet launches when setup finishes, with **Curly the sheep as the default**. WorkBuddy runs the installer to handle the download, runtime, task-event connection, and launch settings. You don't need to install dependencies or edit configuration files. Codex CLI is not required.

### Codex: White Dragon Girl

Install and sign in to Codex CLI first, then send this to Codex:

```text
Install and start https://github.com/Wxy545/codex-pet on Windows. Follow the repository’s INSTALL.md.
```

New Codex installations start with White Dragon Girl. Both options enable launch alongside the selected app and keep any saved character choice.

The default folder is `%LOCALAPPDATA%\codex-pet`; Git is optional. The interface follows your Windows display language: Chinese for Chinese-language systems, English for all others.

The pet starts with your selected app after installation. Use **Companion app** in the right-click menu to switch between Codex and WorkBuddy. You can also double-click `Start Codex Pet.vbs` or `Stop Codex Pet.vbs` in the installation folder. After a manual stop, it stays stopped until the next launch of the selected app. See [INSTALL.md](INSTALL.md) for WorkBuddy setup, custom paths, and manual installation.

## Give her a poke

- **Poke:** get a bouncy reaction, a wave, or a slightly embarrassed look.
- **Pick her up:** drag her across the desktop, or give her a toss and watch her bounce.
- **Let her wander:** watch her stroll, tend to her wings, snack, or curl up for a nap. Switch to the whale maid for her Rubik’s cube and hot pot.
- **Pick an animation:** open the right-click menu and choose what to play.

## While your assistant works

### Codex

- **Session status:** react to thinking, working, waiting for confirmation, completion, and errors, including across multiple local sessions.
- **Usage bubbles:** check Codex usage and reset times from the right-click menu. A missing reset time shows as unknown. If no data is available after installation, finish a reply in the main Codex chat and check again.
- **Chat and images:** open Chat from the right-click menu and send text, PNG, JPEG, or WebP images. Replies use your signed-in Codex CLI.
- **Project tasks:** open Tasks, choose a folder, describe the job, and confirm it. Tasks start in read-only mode; choose “Allow edits in this folder” when you want files changed.
- **Notifications:** switch to another app and let Windows tell you when Codex finishes, hits an error, or needs your attention.

Chat and idle chatter count toward your Codex usage. Chatter runs every ten minutes by default; change the interval or turn it off in AI settings.

AI settings support OpenAI-compatible, OpenAI Responses, and Anthropic endpoints. After entering the base URL and API key, use **Fetch models** to choose from the provider's `/models` list or enter a model ID manually.

### WorkBuddy

The pet follows WorkBuddy 5.9.3 task events: thinking, using tools, waiting for confirmation, and finishing a turn. It starts with WorkBuddy and sends completion or confirmation notifications when you are in another app.

Send chats and new tasks from WorkBuddy itself. The pet's Chat (including image input), Tasks, usage, and AI chatter controls are hidden in this mode.

## Characters and animations

Choose a chibi character from **Character** in the right-click menu. Use **Size** at the top to drag the slider and preview the size live; release it to save without restarting the pet.

- **White Dragon Girl:** the default for new Codex installations, with 23 chibi clips. She can read a spellbook, hug a little gem, tend to her wings, snack, or take a cushion break, alongside her walking, click and work reactions.
- **Blue whale maid:** the original dsh-pet character and its full animation set.
- **Curly the sheep:** the default for new WorkBuddy installations, with seven transparent clips for breathing, walking, a cheerful click response, thinking, typing, waiting, and waving. Error and low-quota reactions share her thinking clip.

The dragon girl has five click reactions and a second walking action with a flutter of her wings. Her idle pool covers small gestures, play, food, cooling off, and greetings. Balance and chatter events reuse suitable clips and are marked “Shared animation” in the menu. Your saved character choice is kept when updating.

The original blue whale maid retains her **106 transparent animations**. These previews are from [dsh-pet](https://github.com/PC2005-cloud/dsh-pet):

<p>
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/dianji-huiying-yuanqi-huishou.gif" width="180" alt="Upstream whale maid waving">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/yuandi-zhuanxin-wan-mofang.gif" width="180" alt="Upstream whale maid playing with a Rubik’s cube">
  <img src="https://cdn.jsdelivr.net/gh/PC2005-cloud/dsh-pet@main/dsh-pet/assets/preview/chi-baifan.gif" width="180" alt="Upstream whale maid eating rice">
</p>

## Startup and updates

New installations enable the pet and a startup scene. WorkBuddy opens with Curly: a blink, a little typing, then a wave before the WorkBuddy window is revealed. Codex keeps its dragon-girl cinematic: eyes opening, wings unfolding, glass panels sweeping past, then a window reveal into Codex. The Codex intro lasts about 11 seconds. Both scenes have original sound effects. Use **Skip** or Esc to leave early; the sound button toggles audio.

The cinematic uses her full-size form. The desktop companions stay chibi, with no random transformations.

Open **Startup scene** in the right-click or tray menu to choose **Pet only**, **Startup scene only**, or **Pet and startup scene**. **Preview scene** plays it immediately. Updates keep your saved mode.

<img src="docs/assets/startup-scene.jpg" width="720" alt="White Dragon Girl and the window reveal in the startup cinematic">

For updates, troubleshooting, or disabling launch alongside your app, ask your assistant to follow the [maintenance guide](docs/maintenance.md).

<details>
<summary>Manual settings and development</summary>

To stop the pet from launching with the selected app:

```powershell
powershell -File scripts/disable-follow.ps1
```

See [maintenance](docs/maintenance.md) for Codex and dsh-pet update checks, development setup, and troubleshooting. For a daily check, ask Codex to set up a maintenance task for your installation.

After updating the source, run `node scripts/prepare-runtime.mjs` to prepare the bundled characters and startup film. Custom skins and your saved choices are kept.

</details>

## DeepSeek Harness

The dragon girl's 23 clips are also available as a [DeepSeek Harness plugin](harness/README.md). It uses Harness sessions, balance and chat through dsh-pet. Follow that guide to install it in your Harness profile.

## Buy me a coffee

Want to see more dragon-girl animations? You can help fund the video work through [Ko-fi](https://ko-fi.com/wxy545) or the WeChat code below. If you have already made an animation, share it in an [Issue](https://github.com/Wxy545/codex-pet/issues) and I’ll adapt it for the pet. See the [animation guide](docs/animation-contributions.md) for specs.

<details>
<summary>WeChat support</summary>

<img src="docs/assets/wechat-support.jpg" width="220" alt="WeChat support QR code">

</details>

## Credits and license

Thanks to [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) for the desktop pet, animations, and interactions. This adaptation uses `dsh-pet@0.3.8`.

Startup scenes draw on [884048454/codex-startup-animation](https://github.com/884048454/codex-startup-animation) and [yushua0808-cpu/dragon-codex-boot](https://github.com/yushua0808-cpu/dragon-codex-boot). Thanks also to [jingh12312-rgb/bailong-desktop-pet](https://github.com/jingh12312-rgb/bailong-desktop-pet) for desktop interaction ideas. This project uses its own dragon clips and startup visuals.

The original “溟月” character is by [上善无形](https://space.bilibili.com/4456176); the DeepSeek whale-maid design is by [ZipZipPipe](https://space.bilibili.com/4168597).

The white dragon girl is used with the creator's permission, credited as Xiaohongshu ID **233534463**. Her character assets have [separate terms](assets/white-dragon/NOTICE.md) from the code license.

Curly's AI-created character reference was supplied by **Wxy545**, who authorized its use and distribution with Codex Pet. Her clips have their own [asset notice](assets/curly-sheep/NOTICE.md).

This project’s code and documentation use the [MIT license](LICENSE). The original animations retain dsh-pet’s noncommercial terms, and the whale character uses [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Full credits and terms are in [third-party notices](THIRD_PARTY_NOTICES.md).

## Contribute

Found a bug? Open an [Issue](https://github.com/Wxy545/codex-pet/issues) with your Windows version, the selected app and its version, and the steps to reproduce it. For code contributions, security reports, and release notes, see [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).
