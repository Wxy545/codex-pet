import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCompatibilityArgs, compareCodexVersions, inspectChatRequirements, inspectTaskRequirements, inspectPermissionPrompt, inspectEventShapes, checkCodexCompatibility } from '../scripts/check-codex-compat.mjs';

const cli = (version = '1.0.0') => ({ status: 'known', path: 'C:/Codex/codex.exe', version });
const desktop = (version = '26.1.0.0') => ({ status: 'known', version, source: 'appx' });
const current = (version) => ({ cli: cli(version), desktop: desktop() });
const source = `const DISABLED_FEATURES = ['shell_tool', 'apps'];\nconst args = ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', '--json', '--thread-source', '--ignore-user-config', '--color', '-c', ...DISABLED_FEATURES.flatMap(feature => ['--disable', feature]), '-'];`;
const taskSource = `const DISABLED_TASK_FEATURES = ['apps'];
const permissionProfile = input.permission === 'workspace-write' ? ':workspace' : ':read-only';
const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--json', '--thread-source', '--ignore-user-config', '--color', '-c', 'default_permissions=' + JSON.stringify(permissionProfile), ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="unelevated"'] : []), ...DISABLED_TASK_FEATURES.flatMap(feature => ['--disable', feature]), '-'];`;
const help = '--ephemeral --skip-git-repo-check --sandbox read-only --json Print events to stdout as JSONL --thread-source --ignore-user-config --color --disable --config stdin';
const permissionPrompt = (mode = 'workspace-write') => JSON.stringify([{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>Filesystem sandboxing: sandbox_mode is `' + mode + '`. Network access is disabled.</permissions instructions> PRIVATE_INSTRUCTIONS' }] }]);
const supportedEvents = () => inspectEventShapes([
  { type: 'event_msg', payload: { type: 'task_started', turn_id: 'safe-id' } },
  { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'safe-id', last_agent_message: 'PRIVATE_REPLY' } },
  { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: 'PRIVATE_COMMAND' } },
  { type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 40, window_minutes: 300, resets_at: 1800000000 } }, info: { private: 'PRIVATE_TOKEN' } } },
]);

test('帮助参数独立于检查，不会触发force；未知参数明确拒绝且不修改输入', () => {
  const args = Object.freeze(['--help']);
  assert.deepEqual(parseCompatibilityArgs(args), { help: true, force: false });
  assert.deepEqual(args, ['--help']);
  assert.deepEqual(parseCompatibilityArgs(['-h']), { help: true, force: false });
  assert.deepEqual(parseCompatibilityArgs([]), { help: false, force: false });
  assert.deepEqual(parseCompatibilityArgs(['--force']), { help: false, force: true });
  assert.throws(() => parseCompatibilityArgs(['--unknown']));
});

test('纯版本比较：识别首次、路径/版本改变与失败待复查；unknown不冒充已安装版本', () => {
  assert.equal(compareCodexVersions(current(), {}).firstRun, true);
  const baseline = { lastSuccessfulVersion: current() };
  assert.equal(compareCodexVersions(current(), baseline).changed, false);
  assert.equal(compareCodexVersions(current('2.0.0'), baseline).changed, true);
  assert.equal(compareCodexVersions({ ...current(), cli: { ...cli(), path: 'C:/Other/codex.exe' } }, baseline).changed, true);
  assert.equal(compareCodexVersions(current(), { ...baseline, pendingVersion: current() }).needsCheck, true);
  const unknown = compareCodexVersions({ cli: cli(), desktop: { status: 'unknown' } }, baseline);
  assert.equal(unknown.changed, false);
  assert.deepEqual(unknown.unknownComponents, ['desktop']);
});

test('从真实适配器源码提取依赖，事件报告只保留类型和字段shape', () => {
  const requirements = inspectChatRequirements(source);
  assert.equal(requirements.status, 'passed');
  assert.deepEqual(requirements.disabledFeatures, ['shell_tool', 'apps']);
  assert.ok(requirements.flags.includes('--thread-source'));
  assert.equal(supportedEvents().status, 'passed');
  assert.equal(JSON.stringify(supportedEvents()).includes('PRIVATE_'), false);
  assert.equal(inspectEventShapes([]).status, 'unknown');
  assert.equal(inspectEventShapes([{ type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 'changed-to-string' } } } }]).status, 'failed');
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex-compat-test-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'codex-chat.mjs'), source);
  await writeFile(join(root, 'src', 'codex-tasks.mjs'), taskSource);
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function mocks({ version = '1.0.0', testCode = 0, desktopKnown = true, execHelp = help, features = ['shell_tool', 'apps'], eventContract = supportedEvents(), wrongPermission = false, configCode = 0 } = {}) {
  const calls = [];
  const runCommand = async (file, args, options) => {
    calls.push({ file, args, options });
    if (file === 'where.exe') return { code: 0, stdout: 'C:/Codex/codex.exe\r\n' };
    if (args[0] === '--version') return { code: 0, stdout: `codex-cli ${version}\n` };
    if (args[0] === 'exec' && args[1] === '--help') return { code: 0, stdout: execHelp };
    if (args[0] === 'features') return { code: 0, stdout: features.map(feature => `${feature} stable false`).join('\n') };
    if (args[0] === 'app-server') return { code: configCode, stdout: configCode === 0 ? JSON.stringify({ appServerVersion: version, configRequirements: { requirements: null } }) : 'PRIVATE_CONFIG_ERROR' };
    if (args[0] === 'debug' && args[1] === 'prompt-input') return { code: 0, stdout: permissionPrompt(wrongPermission ? 'read-only' : args.includes('default_permissions=":workspace"') ? 'workspace-write' : 'read-only') };
    if (args[0] === '--test') return { code: testCode, stdout: testCode ? 'PRIVATE_TEST_FAILURE' : 'tests passed' };
    if (String(file).endsWith('powershell.exe')) return { code: 0, stdout: JSON.stringify(desktopKnown ? desktop() : { status: 'unknown', reason: 'package-unavailable' }) };
    throw new Error('unexpected command in mock');
  };
  return { calls, deps: { runCommand, locateCli: () => 'C:/Codex/codex.exe', collectEventContract: async () => eventContract } };
}

test('任务合同明确要求命名profile和Windows沙箱，权限渲染只输出枚举不泄漏正文', () => {
  assert.equal(inspectTaskRequirements(taskSource).status, 'passed');
  assert.equal(inspectTaskRequirements(taskSource.replace("? ':workspace'", "? ':danger-full-access'")).status, 'failed');
  assert.equal(inspectTaskRequirements(taskSource.replace('windows.sandbox="unelevated"', 'windows.sandbox="off"')).status, 'failed');
  assert.equal(inspectPermissionPrompt(permissionPrompt(), 'workspace-write').status, 'passed');
  assert.equal(inspectPermissionPrompt(permissionPrompt().replace('Network access is disabled', 'Network access is restricted'), 'workspace-write').network, 'restricted');
  assert.equal(inspectPermissionPrompt(permissionPrompt('read-only'), 'workspace-write').status, 'failed');
  assert.equal(inspectPermissionPrompt('{}', 'workspace-write').status, 'unknown');
  assert.equal(JSON.stringify(inspectPermissionPrompt(permissionPrompt(), 'workspace-write')).includes('PRIVATE_'), false);
});

test('首次通过才建立成功基线；版本没变立即返回且不重复帮助/特性/回归测试', async t => {
  const root = await fixture(t);
  let mock = mocks();
  const env = Object.freeze({ CODEX_HOME: 'C:/private-profile', CODEX_APP_TOOLS_PIPE_PATH: 'synthetic-pipe', OPENAI_API_KEY: 'synthetic-auth' });
  const first = await checkCodexCompatibility({ root, platform: 'win32', env, deps: mock.deps });
  assert.equal(first.status, 'passed');
  assert.equal(first.testsRun, true);
  assert.equal(first.baselineUpdated, true);
  assert.equal(first.checks.taskSource.status, 'passed');
  assert.equal(first.checks.permissionProfiles.status, 'passed');
  const policyCalls = mock.calls.filter(call => call.args[0] === 'debug');
  assert.equal(policyCalls.length, 2);
  assert.ok(policyCalls.every(call => call.args.includes('windows.sandbox="unelevated"')));
  assert.ok(policyCalls.every(call => call.options.env.CODEX_HOME && call.options.env.CODEX_HOME !== env.CODEX_HOME));
  assert.ok(policyCalls.every(call => !call.options.env.OPENAI_API_KEY && !call.options.env.CODEX_APP_TOOLS_PIPE_PATH));
  assert.equal(env.OPENAI_API_KEY, 'synthetic-auth');
  const query = mock.calls.find(call => String(call.file).endsWith('powershell.exe'));
  assert.ok(String(query.file).includes('WindowsPowerShell'));
  const pathPattern = query.args.at(-1).match(/-match '([^']+)'/)[1];
  assert.equal(new RegExp(pathPattern).test('C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1.0.0_x64__test\\app\\ChatGPT.exe'), true);
  const baseline = JSON.parse(await readFile(join(root, 'data', 'codex-compatibility.json'), 'utf8'));
  assert.equal(baseline.lastSuccessfulVersion.cli.version, '1.0.0');
  mock = mocks();
  const next = await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: mock.deps });
  assert.equal(next.changed, false);
  assert.equal(next.testsRun, false);
  assert.equal(mock.calls.some(call => ['--test', 'exec', 'features', 'debug', 'app-server'].includes(call.args[0])), false);
  assert.equal(next.skipped, true);
});

test('新权限合同失败保留旧成功基线，旧检查版本必须补检一次', async t => {
  const root = await fixture(t);
  await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: mocks().deps });
  const path = join(root, 'data', 'codex-compatibility.json');
  const baseline = JSON.parse(await readFile(path, 'utf8'));
  delete baseline.lastSuccessfulContractRevision;
  await writeFile(path, JSON.stringify(baseline));
  const failed = await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: mocks({ wrongPermission: true }).deps });
  assert.equal(failed.changed, false);
  assert.equal(failed.testsRun, true);
  assert.ok(failed.comparison.reasons.includes('adapter-contract-changed'));
  assert.equal(failed.checks.permissionProfiles.status, 'failed');
  assert.equal(failed.baselineUpdated, false);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.lastSuccessfulVersion.cli.version, baseline.lastSuccessfulVersion.cli.version);
  assert.equal(saved.pendingVersion.cli.version, '1.0.0');
  assert.equal(JSON.stringify(failed).includes('PRIVATE_'), false);
  const invalidConfig = await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: mocks({ configCode: 1 }).deps });
  assert.equal(invalidConfig.checks.permissionProfiles.configuration.status, 'failed');
  assert.equal(invalidConfig.baselineUpdated, false);
  assert.equal(JSON.stringify(invalidConfig).includes('PRIVATE_'), false);
});

test('更新失败保留旧成功版本，下次仍复查；force也能对未变版本运行全部检查', async t => {
  const root = await fixture(t);
  await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: mocks().deps });
  const failed = await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: mocks({ version: '2.0.0', testCode: 1 }).deps });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.baselineUpdated, false);
  let baseline = JSON.parse(await readFile(join(root, 'data', 'codex-compatibility.json'), 'utf8'));
  assert.equal(baseline.lastSuccessfulVersion.cli.version, '1.0.0');
  assert.equal(baseline.pendingVersion.cli.version, '2.0.0');
  const retry = await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: mocks({ version: '2.0.0' }).deps });
  assert.equal(retry.testsRun, true);
  assert.equal(retry.baselineUpdated, true);
  const forcedMock = mocks({ version: '2.0.0' });
  const forced = await checkCodexCompatibility({ root, force: true, platform: 'win32', env: {}, deps: forcedMock.deps });
  assert.equal(forced.changed, false);
  assert.equal(forced.testsRun, true);
  assert.ok(forcedMock.calls.some(call => call.args[0] === '--test' && call.args.includes('--test-concurrency=1')));
  baseline = JSON.parse(await readFile(join(root, 'data', 'codex-compatibility.json'), 'utf8'));
  assert.equal(baseline.pendingVersion, undefined);
});

test('没有事件证据保持pending，不假通过；缺失flag或feature明确失败', async t => {
  const root = await fixture(t);
  const unknown = await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: mocks({ eventContract: inspectEventShapes([]) }).deps });
  assert.equal(unknown.coreStatus, 'unknown');
  assert.equal(unknown.baselineUpdated, false);
  assert.equal(JSON.parse(await readFile(join(root, 'data', 'codex-compatibility.json'), 'utf8')).lastSuccessfulVersion, undefined);
  const missingFlag = await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: mocks({ execHelp: help.replace('--thread-source', '') }).deps });
  assert.equal(missingFlag.checks.execHelp.status, 'failed');
  const missingFeature = await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: mocks({ features: ['apps'] }).deps });
  assert.equal(missingFeature.checks.disabledFeatures.status, 'failed');
  assert.equal(JSON.stringify(missingFeature).includes('PRIVATE_'), false);
});

test('桌面版本unknown单独报告；CLI和事件合同通过后保存组件基线，后续不反复测试', async t => {
  const root = await fixture(t);
  const first = await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: mocks({ desktopKnown: false }).deps });
  assert.equal(first.current.desktop.status, 'unknown');
  assert.equal(first.coreStatus, 'passed');
  assert.equal(first.status, 'unknown');
  assert.equal(first.baselineUpdated, true);
  const nextMock = mocks({ desktopKnown: false });
  const second = await checkCodexCompatibility({ root, platform: 'win32', env: {}, deps: nextMock.deps });
  assert.equal(second.changed, false);
  assert.equal(second.testsRun, false);
  assert.equal(nextMock.calls.some(call => call.args[0] === '--test'), false);
});
