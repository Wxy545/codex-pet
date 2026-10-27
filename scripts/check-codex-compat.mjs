import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir, stat, open, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KNOWN = 'known';
const normalizedPath = value => String(value ?? '').replaceAll('\\', '/').toLowerCase();
const hasVersion = component => typeof component?.version === 'string' && component.version.length > 0;

/** 纯比较：失败留下的 pending 不会因版本字符串相同而被跳过。 */
export function compareCodexVersions(current, baseline = {}, force = false) {
  const previous = baseline.lastSuccessfulVersion;
  const unknownComponents = ['cli', 'desktop'].filter(name => !hasVersion(current[name]));
  const reasons = [];
  if (!previous) reasons.push('first-run');
  else {
    if (hasVersion(current.cli) && (current.cli.version !== previous.cli?.version || normalizedPath(current.cli.path) !== normalizedPath(previous.cli?.path))) reasons.push('cli-changed');
    if (hasVersion(current.desktop) && current.desktop.version !== previous.desktop?.version) reasons.push('desktop-changed');
  }
  const changed = reasons.length > 0;
  if (baseline.pendingVersion) reasons.push('pending-retry');
  if (force) reasons.push('forced');
  if (!hasVersion(current.cli)) reasons.push('cli-version-unknown');
  return { changed, firstRun: !previous, needsCheck: changed || force || Boolean(baseline.pendingVersion) || !hasVersion(current.cli), unknownComponents, reasons };
}

/** 只解析适配器中明确的字符串数组，不执行源码。 */
export function inspectChatRequirements(source) {
  const featuresBlock = source.match(/const\s+DISABLED_FEATURES\s*=\s*\[([\s\S]*?)\];/);
  const argsBlock = source.match(/const\s+args\s*=\s*\[([\s\S]*?)\];/);
  if (!featuresBlock || !argsBlock) return { status: 'unknown', reason: 'chat-source-contract-unrecognized', flags: [], disabledFeatures: [] };
  const disabledFeatures = [...featuresBlock[1].matchAll(/['"]([a-z][a-z0-9_]*)['"]/g)].map(match => match[1]);
  const remainder = featuresBlock[1].replace(/['"][a-z][a-z0-9_]*['"]/g, '');
  if (!disabledFeatures.length || !/^[\s,]*$/.test(remainder)) return { status: 'unknown', reason: 'feature-array-unrecognized', flags: [], disabledFeatures: [] };
  const flags = [...new Set([...argsBlock[1].matchAll(/['"](--[a-z][a-z0-9-]*)['"]/g)].map(match => match[1]))];
  if (/['"]-c['"]/.test(argsBlock[1])) flags.push('--config');
  return { status: flags.includes('--json') && flags.includes('--disable') ? 'passed' : 'failed', reason: 'static-chat-requirements', flags: [...new Set(flags)], disabledFeatures: [...new Set(disabledFeatures)] };
}

const safeName = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value);

/** 返回类型和字段名，不保留消息、命令、token数或额度值。 */
export function inspectEventShapes(records) {
  const shapes = new Map();
  let started = false; let completed = false; let activity = false; let quota = false; let incompatibleQuota = false;
  for (const record of records) {
    if (!record || !['event_msg', 'response_item', 'session_meta'].includes(record.type)) continue;
    const payload = record.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    const subtype = safeName(payload.type) ? payload.type : '';
    const key = `${record.type}:${subtype}`;
    if (!shapes.has(key) && shapes.size < 48) shapes.set(key, new Set());
    const fields = shapes.get(key);
    for (const field of Object.keys(payload).slice(0, 40)) if (safeName(field)) fields?.add(field);
    if (record.type === 'event_msg') {
      if (subtype === 'task_started') started = true;
      if (subtype === 'task_complete') completed = true;
      if (subtype === 'item_completed' && safeName(payload.item?.type)) {
        activity ||= ['Reasoning', 'CommandExecution', 'FileChange', 'McpToolCall', 'AgentMessage'].includes(payload.item.type);
        fields?.add(`item.type:${payload.item.type}`);
      }
      if (subtype === 'token_count' && payload.rate_limits && typeof payload.rate_limits === 'object') {
        for (const name of ['primary', 'secondary']) {
          const window = payload.rate_limits[name];
          if (!window) continue;
          if (typeof window.used_percent === 'number' && Number.isFinite(window.used_percent)) quota = true;
          else if (Object.hasOwn(window, 'used_percent')) incompatibleQuota = true;
          for (const field of ['used_percent', 'window_minutes', 'resets_at']) if (Object.hasOwn(window, field)) fields?.add(`rate_limits.${name}.${field}:${typeof window[field]}`);
        }
      }
    }
    if (record.type === 'response_item' && ['function_call', 'custom_tool_call', 'reasoning', 'message'].includes(subtype)) activity = true;
  }
  const support = { lifecycle: started && completed, activity, quota };
  const missing = Object.entries(support).filter(([, value]) => !value).map(([name]) => name);
  return {
    status: incompatibleQuota ? 'failed' : missing.length ? 'unknown' : 'passed',
    reason: incompatibleQuota ? 'quota-field-type-changed' : missing.length ? 'recent-log-evidence-incomplete' : 'recent-log-shapes-supported',
    support, missing,
    observed: [...shapes].map(([type, fields]) => ({ type, fields: [...fields].sort() })),
  };
}

async function runCommand(file, args, { cwd, timeoutMs = 8000, env } = {}) {
  try {
    const result = await execute(file, args, { cwd, env, encoding: 'utf8', windowsHide: true, shell: false, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
    return { code: 0, stdout: result.stdout };
  } catch (error) {
    return { code: typeof error.code === 'number' ? error.code : 1, stdout: typeof error.stdout === 'string' ? error.stdout : '', timedOut: Boolean(error.killed) };
  }
}

async function detectCli(run, platform, env) {
  let path = env.CODEX_PET_CLI;
  if (!path) {
    const found = await run(platform === 'win32' ? 'where.exe' : 'which', ['codex']);
    if (found.code !== 0) return { status: 'unknown', reason: 'cli-executable-not-found' };
    const paths = found.stdout.trim().split(/\r?\n/).filter(Boolean);
    path = platform === 'win32' ? paths.find(value => /\.exe$/i.test(value)) ?? paths[0] : paths[0];
  }
  if (!path) return { status: 'unknown', reason: 'cli-executable-not-found' };
  const result = await run(path, ['--version']);
  const version = result.code === 0 ? result.stdout.trim().match(/^codex(?:-cli)?\s+([^\s]+)$/i)?.[1] : undefined;
  return version ? { status: KNOWN, path, version } : { status: 'unknown', path, reason: 'cli-version-unavailable' };
}

const DESKTOP_QUERY = String.raw`
$ErrorActionPreference='Stop'
try {
  $pkg=Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
  if($pkg){ @{status='known';version=$pkg.Version.ToString();source='appx'} | ConvertTo-Json -Compress; exit 0 }
} catch {}
try {
  foreach($proc in @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue)) {
    $exe=$proc.Path
    if($exe -and $exe -match '^(.*\\OpenAI\.Codex_[^\\]+)\\') {
      $packageRoot=$Matches[1]
      $manifest=Join-Path $packageRoot 'AppxManifest.xml'
      if(Test-Path -LiteralPath $manifest) {
        [xml]$xml=Get-Content -LiteralPath $manifest -Raw
        $version=[string]$xml.Package.Identity.Version
        if($version){ @{status='known';version=$version;source='running-package-manifest'} | ConvertTo-Json -Compress; exit 0 }
      }
      $version=[System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductVersion
      if($version){ @{status='known';version=$version;source='running-executable-file-version'} | ConvertTo-Json -Compress; exit 0 }
    }
  }
} catch {}
@{status='unknown';reason='installed-desktop-version-unavailable'} | ConvertTo-Json -Compress
`;

async function detectDesktop(run, platform, env) {
  if (platform !== 'win32') return { status: 'unknown', reason: 'windows-appx-not-applicable' };
  const executable = join(env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = await run(executable, ['-NoProfile', '-NonInteractive', '-Command', DESKTOP_QUERY]);
  if (result.code === 0) {
    try {
      const value = JSON.parse(result.stdout.trim());
      if (value.status === KNOWN && /^[0-9][0-9A-Za-z.+-]{0,80}$/.test(value.version)) return { status: KNOWN, version: value.version, source: value.source };
    } catch { /* 查询异常或输出不符合结构时明确 unknown。 */ }
  }
  return { status: 'unknown', reason: 'installed-desktop-version-unavailable' };
}

async function collectEventContract(codexHome) {
  const candidates = [];
  const directories = [{ path: join(codexHome, 'sessions'), depth: 0 }];
  while (directories.length) {
    const { path, depth } = directories.pop();
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory() && depth < 3 && /^\d{2,4}$/.test(entry.name)) directories.push({ path: join(path, entry.name), depth: depth + 1 });
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const file = join(path, entry.name); const info = await stat(file);
          if (info.mtimeMs >= Date.now() - 48 * 3600000) {
            candidates.push({ file, mtimeMs: info.mtimeMs });
            candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
            if (candidates.length > 8) candidates.length = 8;
          }
        } catch { /* 轮转或归档的日志忽略，等待下次检查。 */ }
      }
    }
  }
  const records = [];
  for (const { file } of candidates) {
    let handle;
    try {
      handle = await open(file, 'r'); const info = await handle.stat();
      const length = Math.min(info.size, 128 * 1024); const position = info.size - length;
      const buffer = Buffer.alloc(length); const { bytesRead } = await handle.read(buffer, 0, length, position);
      const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
      if (position > 0) lines.shift();
      for (const line of lines.slice(-2000)) { try { records.push(JSON.parse(line)); } catch { /* 部分写入行不作为不兼容证据。 */ } }
    } catch { /* 无法读到事件时由 unknown 反映，不制造通过结果。 */ }
    finally { await handle?.close().catch(() => {}); }
  }
  return { ...inspectEventShapes(records), sampledFiles: candidates.length };
}

function foldedStatus(checks) {
  const values = Object.values(checks).map(check => check.status);
  return values.includes('failed') ? 'failed' : values.includes('unknown') ? 'unknown' : 'passed';
}

function versionStamp(current, previous = {}) {
  const stamp = {};
  if (hasVersion(current.cli)) stamp.cli = { path: current.cli.path, version: current.cli.version };
  if (hasVersion(current.desktop)) stamp.desktop = { version: current.desktop.version, source: current.desktop.source };
  else if (previous.desktop) stamp.desktop = previous.desktop;
  return stamp;
}

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temporary, path);
}

/** 所有外部命令可替换为mock；测试导入本模块不会执行检查或再次启动测试。 */
export async function checkCodexCompatibility({ root = ROOT, force = false, platform = process.platform, env = process.env, deps = {} } = {}) {
  root = resolve(root);
  const baselinePath = join(root, 'data', 'codex-compatibility.json');
  const reportPath = join(root, 'data', 'compatibility-report.json');
  const command = deps.runCommand ?? runCommand;
  const run = (file, args, options = {}) => command(file, args, { cwd: root, env, ...options });
  let baseline = {};
  try { baseline = JSON.parse(await readFile(baselinePath, 'utf8')); } catch { /* 首次或损坏的基线必须重新验证。 */ }
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) baseline = {};
  const current = { cli: await detectCli(run, platform, env), desktop: await detectDesktop(run, platform, env) };
  const comparison = compareCodexVersions(current, baseline, force);
  const checkedAt = new Date().toISOString();
  const report = { schemaVersion: 1, checkedAt, current, comparison, changed: comparison.changed, forced: force, testsRun: false, baselineUpdated: false, reportPath, checks: {} };
  if (!comparison.needsCheck) {
    report.skipped = true;
    report.coreStatus = 'passed';
    report.status = current.desktop.status === KNOWN ? 'passed' : 'unknown';
    report.checks.cachedCompatibility = { status: 'passed', reason: 'versions-unchanged', lastPassedAt: baseline.lastSuccessfulCheckAt };
    report.checks.desktopVersion = { status: current.desktop.status === KNOWN ? 'passed' : 'unknown', reason: current.desktop.source ?? current.desktop.reason };
    await saveJson(reportPath, report);
    return report;
  }

  const checks = report.checks;
  checks.cliVersion = { status: current.cli.status === KNOWN ? 'passed' : 'unknown', reason: current.cli.reason ?? 'executable-version-read' };
  let requirements;
  try { requirements = inspectChatRequirements(await readFile(join(root, 'src', 'codex-chat.mjs'), 'utf8')); }
  catch { requirements = { status: 'unknown', reason: 'chat-source-unavailable', flags: [], disabledFeatures: [] }; }
  checks.chatSource = requirements;
  const helpResult = current.cli.path ? await run(current.cli.path, ['exec', '--help']) : { code: 1, stdout: '' };
  if (helpResult.code !== 0) {
    checks.execHelp = { status: current.cli.path ? 'failed' : 'unknown', reason: 'exec-help-unavailable' };
    checks.cliJson = { status: 'unknown', reason: 'exec-help-unavailable' };
  } else if (!helpResult.stdout.trim()) {
    checks.execHelp = { status: 'unknown', reason: 'exec-help-empty' };
    checks.cliJson = { status: 'unknown', reason: 'exec-help-empty' };
  } else {
    const missingFlags = requirements.flags.filter(flag => !helpResult.stdout.includes(flag));
    checks.execHelp = { status: missingFlags.length ? 'failed' : 'passed', reason: 'required-flags-advertised', missingFlags };
    checks.cliJson = { status: /--json[\s\S]{0,200}\bJSONL\b/i.test(helpResult.stdout) ? 'passed' : 'failed', reason: 'jsonl-output-advertised', verification: 'help-only-no-model-request' };
  }
  if (current.cli.path && requirements.status === 'passed') {
    // features list 只查询；同时传入全部 --disable，验证CLI认识这些名称，不写配置。
    const features = await run(current.cli.path, ['features', 'list', ...requirements.disabledFeatures.flatMap(name => ['--disable', name])]);
    const knownFeatures = new Set(features.stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/)[0]).filter(name => /^[a-z][a-z0-9_]*$/.test(name)));
    const missingFeatures = requirements.disabledFeatures.filter(name => !knownFeatures.has(name));
    checks.disabledFeatures = { status: features.code !== 0 ? 'failed' : !knownFeatures.size ? 'unknown' : missingFeatures.length ? 'failed' : 'passed', reason: 'read-only-feature-recognition', requestedCount: requirements.disabledFeatures.length, missingFeatures };
  } else checks.disabledFeatures = { status: 'unknown', reason: 'cli-or-feature-contract-unavailable' };
  const tests = await run(process.execPath, ['--test', '--test-concurrency=1', 'test/*.test.mjs', 'src/*.test.cjs'], { timeoutMs: 60000 });
  report.testsRun = true;
  checks.regressionTests = { status: tests.code === 0 ? 'passed' : 'failed', exitCode: tests.code, timedOut: Boolean(tests.timedOut), reason: 'local-mocked-regression-suite' };
  try { checks.eventContract = await (deps.collectEventContract ?? collectEventContract)(env.CODEX_HOME || join(homedir(), '.codex')); }
  catch { checks.eventContract = { status: 'unknown', reason: 'recent-logs-unavailable' }; }
  report.coreStatus = foldedStatus(checks);
  checks.desktopVersion = { status: current.desktop.status === KNOWN ? 'passed' : 'unknown', reason: current.desktop.source ?? current.desktop.reason };
  report.status = report.coreStatus === 'passed' && checks.desktopVersion.status === 'unknown' ? 'unknown' : report.coreStatus;
  report.limitations = ['CLI JSON能力只核对帮助声明和本地解析回归；未发送真实模型请求。'];
  const nextBaseline = { ...baseline, schemaVersion: 1, lastAttempt: { checkedAt, status: report.coreStatus, version: versionStamp(current) } };
  if (report.coreStatus === 'passed') {
    nextBaseline.lastSuccessfulVersion = versionStamp(current, baseline.lastSuccessfulVersion);
    nextBaseline.lastSuccessfulCheckAt = checkedAt;
    delete nextBaseline.pendingVersion;
    report.baselineUpdated = true;
  } else nextBaseline.pendingVersion = versionStamp(current);
  await saveJson(baselinePath, nextBaseline);
  await saveJson(reportPath, report);
  return report;
}

export function summarizeReport(report) {
  return {
    status: report.status, changed: report.changed, testsRun: report.testsRun,
    baselineUpdated: report.baselineUpdated, skipped: Boolean(report.skipped),
    cliVersion: report.current.cli.version ?? null, desktopVersion: report.current.desktop.version ?? null,
    failedChecks: Object.entries(report.checks).filter(([, check]) => check.status === 'failed').map(([name]) => name),
    unknownChecks: Object.entries(report.checks).filter(([, check]) => check.status === 'unknown').map(([name]) => name),
    reportPath: report.reportPath,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).some(argument => argument !== '--force')) throw new Error('unsupported-argument');
    const report = await checkCodexCompatibility({ force: process.argv.includes('--force') });
    console.log(JSON.stringify(summarizeReport(report)));
    if (report.coreStatus === 'failed') process.exitCode = 1;
  } catch {
    const failure = { schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'failed', reason: 'compatibility-check-could-not-complete' };
    try { await saveJson(join(ROOT, 'data', 'compatibility-report.json'), failure); } catch { /* 无法写报告时仍返回失败JSON。 */ }
    console.log(JSON.stringify(failure));
    process.exitCode = 1;
  }
}
