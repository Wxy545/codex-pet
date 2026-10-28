# Codex Pet 维护规则

适用范围：本仓库源码、运行时适配补丁、文档和测试。先读 README.md 与 THIRD_PARTY_NOTICES.md，再定位受影响的实现和调用方。

- 保留 dsh-pet 的动画、物理与菜单实现；适配集中在 Codex 事件、额度、CLI 对话和系统通知。上游版本与补丁定位都必须显式验证，定位失败时停止，不静默跳过。
- DeepSeek Harness 接入位于 `harness/`，使用原生 dsh-pet 角色包与 Harness 服务。运行时补丁只写所选 profile 内的依赖文件，原子替换以断开 pnpm 硬链接，不修改共享 store、Codex 宿主或其他 profile。
- 配置、日志、会话记忆、运行令牌、截图和依赖目录留在本机。不得提交 data/、node_modules/、.env 或 Codex 用户目录；测试使用合成会话 ID，不使用真实对话或凭据。
- 自有代码与上游代码按各自许可证维护；角色和动画另有非商用限制。新增或替换素材前核实来源与许可，不把素材标为 MIT。
- 常规验证为 node scripts/prepare-runtime.mjs、node scripts/build-harness-plugin.mjs 和 npm test。Codex 升级后再运行 node scripts/check-codex-compat.mjs --force；CI 不使用真实登录、模型请求或桌面窗口。
- 当前只保留白龙娘与大肥鱼的 Q 版角色，不恢复姐姐版或偶尔变身。Harness 的 640×360 播放变体须由原 Q 版视频等比导出，保留原片及来源摘要。
- 代码说明性注释使用中文。共享行为变化时检查受影响调用方；不要为通过测试而引入伪造额度、静默回退或安全权限放宽。
- 已获提交推送授权的维护任务先检查工作区并安全同步远端，只逐项暂存本次修改，验证后以中文提交。无源码变更不空提交；冲突、权限不足或验证失败时报告，不 force、不覆盖他人修改、不自动发布 Release。
- 上游修复、功能边界和已验证版本发生变化时，同步 README、CHANGELOG 或相关维护文档。验收结论区分单元测试、本机运行、用户实测和 GitHub CI。
