const EXECUTOR_CONTEXT = new Set([
  'CODEX_PERMISSION_PROFILE', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_TOOL_CALL_ID',
  'CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE', 'CODEX_CI',
]);

/** 新任务不继承父执行器管道/权限和桌宠能力；正常Codex登录环境原样保留。 */
export function createCodexChildEnv(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name]) =>
    !/^(?:CODEX_PET_|CODEX_APP_|DSH_PET_)/i.test(name) && !/^DSH_HOME$/i.test(name)
    && !EXECUTOR_CONTEXT.has(name.toUpperCase())));
}
