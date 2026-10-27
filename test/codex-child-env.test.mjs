import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexChildEnv } from '../src/codex-child-env.mjs';

test('CLI环境移除全部桌宠能力字段，保留Codex登录和系统运行环境，不修改来源', () => {
  const source = Object.freeze({
    CODEX_PET_API_TOKEN: 'synthetic-private-value',
    CODEX_PET_API_URL: 'http://127.0.0.1:3080/',
    CODEX_PET_CLI: 'C:/Codex/codex.exe',
    DSH_PET_TOKEN: 'synthetic-pet-value',
    DSH_PET_PORT: '3080',
    DSH_HOME: 'C:/pet-data',
    codex_pet_other: 'mixed-case-private-value',
    dsh_pet_other: 'mixed-case-pet-value',
    dsh_home: 'mixed-case-data',
    CODEX_APP_TOOLS_PIPE_PATH: 'synthetic-parent-pipe',
    CODEX_APP_RUNTIME_CLI_PATH: 'synthetic-parent-runtime',
    CODEX_PERMISSION_PROFILE: ':read-only',
    CODEX_THREAD_ID: 'synthetic-parent-thread',
    CODEX_SESSION_ID: 'synthetic-parent-session',
    CODEX_TOOL_CALL_ID: 'synthetic-parent-tool-call',
    CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY: 'synthetic-parent-workspace',
    CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'synthetic-parent-origin',
    CODEX_CI: '1',
    PATH: 'C:/Windows/System32',
    SystemRoot: 'C:/Windows',
    TEMP: 'C:/Temp',
    CODEX_HOME: 'C:/codex-profile',
    OPENAI_API_KEY: 'normal-auth-placeholder',
    USERPROFILE: 'C:/test-user',
  });
  const before = { ...source };
  const child = createCodexChildEnv(source);
  assert.deepEqual(child, {
    PATH: 'C:/Windows/System32', SystemRoot: 'C:/Windows', TEMP: 'C:/Temp',
    CODEX_HOME: 'C:/codex-profile', OPENAI_API_KEY: 'normal-auth-placeholder',
    USERPROFILE: 'C:/test-user',
  });
  assert.notEqual(child, source);
  assert.deepEqual(source, before);
});
