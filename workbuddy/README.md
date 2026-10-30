# WorkBuddy companion

[English](#install) | [简体中文](#安装)

Connect WorkBuddy task states to the desktop pet. The companion reacts while WorkBuddy thinks, uses tools, waits for a reply, or finishes a turn. Character videos, wandering, clicking and dragging run in the existing desktop pet.

## Install

Install WorkBuddy and keep this checkout in a permanent folder. From the Codex Pet project folder, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File workbuddy/install.ps1 -AppRoot (Get-Location).Path -WorkBuddyExe "<WorkBuddy installation folder>\WorkBuddy.exe"
```

The installer uses that WorkBuddy installation's bundled CLI and adds only `codex-pet-companion@codex-pet-workbuddy` at user scope. It uses the pet's portable Node.js when available. `-NodePath` and `-WorkBuddyHome` can select an existing Node.js executable and a nondefault WorkBuddy data folder.

Reopen WorkBuddy after installation, select WorkBuddy as the pet's linked app, and start a new task. The hook reports task metadata to the running local pet. The selected app controls which account and capabilities are available; this hook provides task-state events, without a chat or account-usage API.

The standalone companion queries remaining credits separately through WorkBuddy 5.9.3's local WBIPC billing channel. WorkBuddy must be running and signed in. Missing or failed queries show unavailable; chat and new tasks stay in WorkBuddy. This internal channel is version-dependent, not a stable public API.

To remove the hook, use the same arguments with `workbuddy/uninstall.ps1`. Other plugins and this plugin's data remain. The installer stops if its marketplace name belongs to another directory or its managed scripts have been edited.

## 安装

先安装 WorkBuddy，并将本项目保留在固定目录。在 Codex Pet 项目目录运行上面的安装命令，将 `<WorkBuddy installation folder>` 换成实际安装目录。

安装使用该客户端自带的 CLI，在当前用户下添加 `codex-pet-companion@codex-pet-workbuddy`，保留其它插件和配置。Node.js 优先使用桌宠的便携版本；也可用 `-NodePath` 指定已有程序，用 `-WorkBuddyHome` 指定自定义数据目录。

安装后重新打开 WorkBuddy，在桌宠中选择联动 WorkBuddy，再开始新任务。思考、工具执行、等待确认、收尾、完成和失败会对应现有工作动画。点击、拖拽和日常随机动作继续由桌宠播放。这项 Hook 接入提供任务状态，不提供 WorkBuddy 账号的聊天或额度接口。

独立桌宠另外通过 WorkBuddy 5.9.3 的本机 WBIPC 账单通道查询剩余积分，需要客户端已启动并登录。缺失或失败时显示未知；聊天和新任务仍在 WorkBuddy 中提交。该内部通道随版本变化，不视为稳定公开 API。

卸载时使用相同参数运行 `workbuddy/uninstall.ps1`。脚本只移除本插件；同一市场还有其它插件时保留市场登记，插件数据也保留。市场名称被别的目录占用，或已登记脚本被修改时，安装停止并保留原文件。

## 接入约定

用途：维护本模块的 Hook、安装和宿主接线；维护者：项目维护者。适用版本：Windows WorkBuddy 5.9.3，内置 `@genie/agent-cli` 2.165.0；核对日期：2026-10-29。

- 插件格式为 `.codebuddy-plugin/plugin.json` 和 `hooks/hooks.json`。实际客户端支持直接 `powershell.exe -File`；脚本使用 UTF-8 BOM，兼容 Windows PowerShell 5.1，不要求额外安装 Git Bash 或 PowerShell 7。
- `CODEBUDDY_CONVERSATION_REQUEST_ID` 区分回合；同一会话旧回合的结束不能覆盖新回合。子代理 Hook 的 `session_id` 可能是父会话 ID，环境中的 `CODEBUDDY_SESSION_ID` 是实际会话 ID，二者不同时过滤。审批按 `call_id` 保留等待；`elicitation_id` 映射为同一传输字段 `callId`，只有对应决定或结果才清理，避免并行工具覆盖等待状态。
- `Stop` 可能被其它 Hook 续跑，只进入整理结果；`FinalStop` 的 `completed` 才表示本轮返回，`failed` 表示失败，`cancelled` 和 `interrupted` 回待机。工具失败可能继续重试，不等于整项任务失败。`SessionEnd` 可不带回合 ID，按明确会话关闭处理，保留时间顺序校验。
- `createWorkBuddyBridge({onChange, locale})` 位于 `src/workbuddy-events.mjs`，提供 `accept(body)`、`snapshot()`、`hostClosed()` 和 `dispose()`。回调给出 `{state, task, activeCount, source:'workbuddy'}`；通知只含固定文案和内存中的来源会话 ID。宿主确认 WorkBuddy 进程全部退出时调用 `hostClosed()`，最小化、失焦和长任务无事件不作为退出。
- `report.mjs` 只传白名单元数据，不传提示词、工具输入输出、错误正文、文件路径或对话。连接参数在安装生成的 `connection.json`，只读取桌宠自产的 `data/dsh-pet/standalone-runtime.json` 能力令牌，不读取 WorkBuddy 登录凭据。
- 事件入口为 `POST /dsh-pet-7340/workbuddy-events`，仅连接 `127.0.0.1`，使用 `x-dsh-pet-token`，请求失败不重试到其它宿主。Hook 在离线、配置异常或坏输入时静默退出 0，不输出审批决定或模型上下文。
- 原生 CLI 安装到用户插件缓存，同版本 `update` 不刷新脚本。本安装器核对自有缓存路径及已登记摘要后补齐未改文件；只处理本插件，不写 WorkBuddy 安装目录。
- 本机 `.codex-pet-workbuddy.json` 登记中的 `workBuddyExe` 来自安装时核实的客户端。窗口唤起 helper 使用前重新验证程序名、产品和发行方，不将登记路径直接当作可信程序执行。

本模块已验证原生 CLI 安装与卸载、其它插件登记保留、缓存摘要，以及 Windows PowerShell 到本机 HTTP 的元数据投递。真实任务联动验收由主项目记录，不以合成事件测试代替。

格式参考：[WorkBuddy 插件说明](https://www.workbuddy.cn/docs/workbuddy/Plugins)、[官方插件参考](https://www.codebuddy.ai/docs/cli/plugins-reference)、[官方 Hook 参考](https://www.codebuddy.ai/docs/cli/hooks)。具体事件及 Windows 执行行为同时核对上述客户端的随包实现。桌宠基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，代码与角色素材分别遵循项目[来源和许可说明](../THIRD_PARTY_NOTICES.md)。
