# Codex Pet 维护规则

适用范围：本仓库源码、运行时适配补丁、文档和测试。先读 README.md 与 THIRD_PARTY_NOTICES.md，再定位受影响的实现和调用方。

- 保留 dsh-pet 的动画、物理与菜单实现；适配集中在所选应用的事件、Codex 额度与 CLI 对话、跟随启动和系统通知。上游版本与补丁定位都必须显式验证，定位失败时停止，不静默跳过。
- Codex 与 WorkBuddy 的联动选择保存于 `data/host.json`，与角色选择分开。WorkBuddy 事件插件位于 `workbuddy/`，当前适配 Windows 5.9.3 客户端；安装和移除只操作本插件，保留其它插件及配置。WorkBuddy 在桌宠侧未证实的账号聊天、额度、图片/文件任务和 AI 碎碎念能力保持关闭，不转给 Codex 执行或显示 Codex 额度。
- DeepSeek Harness 接入位于 `harness/`，使用原生 dsh-pet 角色包与 Harness 服务。运行时补丁只写所选 profile 内的依赖文件，原子替换以断开 pnpm 硬链接，不修改共享 store、Codex 宿主或其他 profile。
- 配置、日志、会话记忆、运行令牌、截图和依赖目录留在本机。不得提交 data/、node_modules/、.env 或 Codex 用户目录；测试使用合成会话 ID，不使用真实对话或凭据。
- 自有代码与上游代码按各自许可证维护；角色和动画按各自素材许可提供。新增或替换素材前核实来源与许可，不把素材统一标为 MIT。
- 常规验证为 node scripts/prepare-runtime.mjs、node scripts/build-harness-plugin.mjs 和 npm test。Codex 升级后再运行 node scripts/check-codex-compat.mjs --force；CI 不使用真实登录、模型请求或桌面窗口。
- 桌宠内置白龙娘、大肥鱼和卷卷小羊三只 Q 版角色；新安装按宿主选择默认：Codex 为白龙娘，WorkBuddy 为卷卷小羊。已有角色选择在更新和切换宿主时保留。卷卷小羊的 AI 参考图由 Wxy545 提供并允许随项目公开分发，素材说明保留在 `assets/curly-sheep/NOTICE.md`。现有 7 条有效独立视频，出错和低额度共用思考；共用绑定不计作新视频，未通过透明边缘检查的原片不纳入分发。
- 不恢复姐姐桌宠选项或偶尔变身。王工于 2026-10-29 重新允许白龙娘姐姐用于 Codex 启动电影，此例外仅用于 `assets/startup/` 与独立启动窗口；不得按旧 Q-only 规则移除已验收的电影。WorkBuddy 启动演出使用卷卷小羊，复用已验收的 Q 版片段，不播放龙娘电影。演出跟随当前联动应用并交回其窗口。Harness 保持 23 条白龙娘，640×360 播放变体由原 Q 版视频等比导出，保留原片及来源摘要。
- 代码说明性注释使用中文。共享行为变化时检查受影响调用方；不要为通过测试而引入伪造额度、静默回退或安全权限放宽。
- 已获提交推送授权的维护任务先检查工作区并安全同步远端，只逐项暂存本次修改，验证后以中文提交。无源码变更不空提交；冲突、权限不足或验证失败时报告，不 force、不覆盖他人修改、不自动发布 Release。
- 上游修复、功能边界和已验证版本发生变化时，同步 README、CHANGELOG 或相关维护文档。验收结论区分单元测试、本机运行、用户实测和 GitHub CI。
