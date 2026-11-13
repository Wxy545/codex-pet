# White Dragon Girl for DeepSeek Harness

[English](#install) | [简体中文](#安装)

The chibi white dragon girl from [Codex Pet](https://github.com/Wxy545/codex-pet), running as a native [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) pet pack in DeepSeek Harness. The pack has 23 transparent videos, five click reactions, two ways to wander, and spellbook reading, gem guarding, wing care, cushion breaks, snacks, and greetings.

You can ask Codex: **Install White Dragon Girl from https://github.com/Wxy545/codex-pet in my DeepSeek Harness. Follow harness/README.md and use the CLI that belongs to my Harness installation.**

## Install

On Windows, use DeepSeek Harness **0.2.2-rc.1** with Node.js **24.9 or newer**, and `dsh-pet` **0.4.8**. Existing Harness **0.2.1-rc.2 and 0.2.1-rc.5** installations remain supported with Node.js **22.12 or newer**. The npm Harness CLI also needs `pnpm` on PATH. From the Codex Pet checkout, run:

```powershell
powershell -File scripts/install-harness.ps1 -Profile web
```

The script builds a JavaScript bundle in `data/harness-plugin`, then asks the official `dsh plugin` CLI to add `dsh-pet` and `codex-pet-harness` to that profile. It prepares the selected profile before its first launch, so task tracking and QQ status are available immediately. It also accepts existing `dsh-pet` 0.4.0, 0.4.1, 0.4.3, 0.4.5 and 0.4.6 profiles.

The installer checks the Node runtime used by the selected npm CLI. If a suitable installed runtime is available, it uses that runtime for Harness commands in this process only. The bundle can still be built with the project's Node 22 runtime; Codex and WorkBuddy requirements do not change. Nothing is installed globally and your PATH is restored when the installer exits.

Keep the checkout in a permanent folder, such as `%LOCALAPPDATA%\codex-pet`. A local install links to its `data/harness-plugin` directory; moving or deleting the checkout breaks that link.

For Harness Desktop, launch it once, then fully quit it. Use `-Profile desktop` with its bundled CLI, for example `-DshCommand '<app-folder>/resources/runtime/cli/bin/dsh.cmd'`. The npm CLI cannot manage the reserved desktop profile. The installer checks this before building or adding packages. The desktop carrier itself has not been tested in this project.

Restart the selected profile. Dragon Girl appears in the web overlay and desktop pet window; `/pet` lists her as `codex-white-dragon`. Use the original pet's display setting if you want only one character. The installation keeps the whale maid and its saved settings.

Already have a prebuilt bundle? Install `dsh-pet@0.4.8` first, then run `dsh plugin --profile web add <bundle-folder-or-tarball>`. Before opening the profile, run the following from this checkout, using the installed bundle's real folder and the version returned by your selected `dsh --version`:

```powershell
node scripts/prepare-harness-profile.mjs --profile-dir '<Harness-home>/profiles/web' --bundle-dir '<installed-bundle-folder>' --dsh-version 0.2.2-rc.1
```

Keep both bundles enabled. The source `harness/` folder is not a built bundle; use the build script or installer first.

The original dsh-pet host supplies Harness session states, six balance tiers, three chatter slots, chat, click physics, dragging, the action menu, and its notification handling. Balance, chatter, and some work slots reuse the available dragon videos. Model calls and balance queries follow the Harness account and dsh-pet settings.

The bar below the pet shows the API balance returned by Harness's active provider: account money, credits, or every available usage window. Click a window summary for reset details. Work and chatter bubbles stay above the pet. Unsupported providers and failed queries show an unavailable state; no balance is estimated, and the native pet does not display standalone system-monitor placeholders.

The task button lists turns observed in the selected Harness profile, with working and pending counts, elapsed time, and the model and reasoning effort reported by native events. Unknown model details stay unknown. Read and snooze controls organize reminders; **Open conversation** uses Harness's own navigation when that client is connected. This list does not use a Codex account or offer remote cancellation of existing desktop sessions. After restarting the profile, saved rows are marked as last known rather than still running.

The dragon's action names and personality default to Chinese on Chinese-language systems and English elsewhere. Other controls retain the upstream dsh-pet wording. Set `locale: en` or `locale: zh-CN` on the `codex-pet-harness` plugin row to override the pack language. Existing edited dragon configuration is kept.

The bundle is enabled only in the selected profile. Native dsh-pet stores pet packs under `$DSH_HOME/dsh-pet/pet`, shared by profiles in that home. The files use the separate `codex-white-dragon` prefix; updates preserve edited dragon files and leave other pets alone. Removing the bundle keeps these user files. The original dsh-pet settings page manages its own main pet; edit this pack's `codex-white-dragon-config.json` to change the dragon's size, position, switches, or display mode.

The bundle checks the playback, motion, input, window, and voice modules before adapting the selected profile. It keeps existing profiles on their supported versions: 0.4.0, 0.4.1, 0.4.3, 0.4.5, 0.4.6, or 0.4.7. Periodic whispers and todo speech still require the voice master switch. Web work-status speech has its own switch and is off by default. Edge placement, video transparency, and animation loops stay in place. A DPI change updates the cache for the next launch without rebuilding the current windows. The plugin leaves upstream weather lookup disabled. The patch preserves mouse release with multiple buttons, uses an exclusive temporary write probe, and keeps Chromium sandboxing on after a helper crash. The dragon keeps its original 640 × 360 canvas and has no sleep mode without matching clips.

## 安装

也可以直接对 Codex 说：**把 https://github.com/Wxy545/codex-pet 的白龙娘插件装到我正在用的 DeepSeek Harness，按 harness/README.md 选择对应的官方 CLI，保留现有宠物设置。**

Windows 上支持 DeepSeek Harness **0.2.2-rc.1**，该版本需要 Node.js **24.9 或更新版**，配合 `dsh-pet` **0.4.8**。旧版 Harness **0.2.1-rc.2、0.2.1-rc.5** 仍可使用，Node.js 要求保持 **22.12 或更新版**。普通 npm 版 Harness CLI 还需要 PATH 中有 `pnpm`。在 Codex Pet 项目目录运行：

```powershell
powershell -File scripts/install-harness.ps1 -Profile web
```

脚本会构建龙娘插件，再通过官方 `dsh plugin` 命令把原版 dsh-pet 和龙娘扩展加入指定 profile，并在首次启动前自动完成补丁准备，让任务列表和 QQ 状态直接生效。遇到未验证的 dsh-pet 版本会停止。安装后重启该 profile；`/pet` 可以选择 `codex-white-dragon`。龙娘默认同时显示在网页和桌面，原鱼及其显示设置保留。

手工添加预构建包时，在打开 profile 前执行上面的 `prepare-harness-profile.mjs` 命令：目录填所选 profile 和已安装插件的真实位置，版本填该 Harness CLI 实际返回的版本。使用安装器时无需另做这一步。

安装器会核对所选 npm CLI 实际使用的 Node。有合适的已安装运行时时，仅在本次 Harness 命令中使用；退出后恢复 PATH，不安装全局软件。龙娘插件仍可用项目的 Node 22 构建，Codex 与 WorkBuddy 的要求不变。

项目需放在并保留于固定目录，例如 `%LOCALAPPDATA%\codex-pet`。本地安装链接的是其中的 `data/harness-plugin`；移动或删除项目目录会断开插件。

Harness 桌面版需要先启动一次、再完全退出，用 `-Profile desktop -DshCommand '<安装目录>/resources/runtime/cli/bin/dsh.cmd'` 指定桌面版自带命令。npm 安装的普通 dsh 不能管理 desktop profile；脚本会在构建和安装前检查。当前项目尚未实测 Harness 桌面应用载体。

角色动作、点击、拖拽、随机漫游和菜单由原版 dsh-pet 播放；工作状态、余额、碎碎念、聊天和通知沿用 Harness 接口与账号。龙娘有 23 段 Q 版视频，含抱书阅读、护住小宝石；余额六档、碎念三档及部分工作状态共用现有片段。

适配先核对 dsh-pet 的卡片、窗口与语音模块。已有 profile 使用 0.4.0、0.4.1、0.4.3、0.4.5、0.4.6 或 0.4.7 时保留原版本。周期碎念和待办朗读仍需打开语音总开关，网页工作状态朗读有单独的开关，默认关闭。贴边、透明修正和循环续播保留。显示器缩放变化时只更新下次启动用的缓存，当前窗口不重建。插件不启用上游天气查询，helper 崩溃后继续保留 Chromium 沙箱。龙娘没有配套睡觉三段视频，暂不开放睡觉或梦话。

脚下额度条显示 Harness 当前服务商实际返回的 API 余额：金额、积分，或各个用量窗口；点击窗口摘要可看重置时间。工作和碎念气泡仍在头顶。服务商不支持查询或查询失败时显示未知，不估算余额；原生桌宠不显示独立宿主的系统监控占位读数。

任务按钮列出当前 Harness profile 观察到的会话回合，显示执行中、待处理、耗时，以及原生事件实际返回的模型和思考档位；没有返回的字段保持未知。可以标记已读、稍后提醒，或在原生客户端连接时打开对应会话。这里不使用 Codex 账号，也不提供接管旧桌面会话的取消操作。重启 profile 后，保留记录标为上次状态，不冒充仍在执行。

插件层只加入指定 profile。种类文件遵循 dsh-pet 原生规则，位于各 profile 共用的 `$DSH_HOME/dsh-pet/pet`，使用独立的 `codex-white-dragon` 前缀。更新保留用户改过的文件。可以编辑 `codex-white-dragon-config.json` 调整龙娘的大小、位置、开关和显示方式；卸载插件时这些用户文件保留。

## QQ tasks

Codex Pet's **QQ connection** window can send private QQ messages to Harness through either an official bot or a NapCat QQ account. Choose **DeepSeek Harness** as the task app, authorize a project, and save the connection. The [QQ guide](../README.md#tasks-from-qq) covers setup and commands. This selection is separate from the companion app and character on your desktop.

Install and register the native plugin above first. QQ setup checks the registered, formal Harness installation and prepares its own `codex-pet-qq-*` ACP profile for the project and permission level. It keeps your original profile intact. An isolated test CLI is not treated as an installed desktop carrier.

QQ conversations are created by this bridge and resumed within the same project, file permission, and tool selection; existing Harness desktop conversations are not listed or taken over. Model and reasoning settings follow Harness. File writes ask for approval. Enable Shell and choose MCP servers separately in QQ settings on your computer; both start off, and each command or MCP call needs approval. Changing the tool selection starts a new conversation and keeps the old one. Usage and balance still come from Harness's own provider.

## QQ 任务

Codex Pet 的「QQ 连接」可以通过官方机器人或 NapCat 小号，把私聊消息交给 Harness。在窗口中选择任务应用「DeepSeek Harness」，授权项目并保存；步骤和命令见 [QQ 使用说明](../README.zh-CN.md#在-qq-里下任务)。这里的选择与本机桌宠联动应用、角色分开。

先按上文安装并登记原生插件。QQ 设置核对正式 Harness 安装，再为项目和权限档准备本项目自己的 `codex-pet-qq-*` ACP profile，保留用户原 profile；隔离验收 CLI 不能代替正式载体。

QQ 只恢复本桥新建、项目、文件权限和工具选择相符的原生会话，不列出或接管旧桌面会话。模型和思考遵 Harness 自己的设置。文件写入逐次确认；Shell 和 MCP 在电脑端 QQ 设置中分别开启，默认关闭，具体命令或 MCP 调用每次确认。更换工具范围会新建会话并保留旧会话。额度与余额仍由 Harness 自己的服务商提供。

## Credits and license

Built on [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet). The White Dragon Girl design is used with the creator's permission; credit: Xiaohongshu **233534463**. The animation videos were generated with MiniMax H3 and edited for this pet. Code uses MIT; character and animation terms are separate. See the bundled `NOTICE.md` and the repository's [third-party notices](https://github.com/Wxy545/codex-pet/blob/main/THIRD_PARTY_NOTICES.md).
