import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = {
  npm: 'https://registry.npmjs.org/dsh-pet',
  github: 'https://api.github.com/repos/PC2005-cloud/dsh-pet/commits/main',
};
const stableVersion = value => typeof value === 'string' && value.length <= 80 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
const commitSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

async function jsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temporary, path);
}

async function loadState(path) {
  let value;
  try { value = await jsonFile(path); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('upstream-state-invalid');
  }
  if (!object(value) || value.schemaVersion !== 1 || !object(value.sources)) throw new Error('upstream-state-invalid');
  if (value.acceptedBaseline && (!stableVersion(value.acceptedBaseline.npmVersion) || !commitSha(value.acceptedBaseline.githubSha))) throw new Error('upstream-state-invalid');
  for (const [name, valid] of [['npm', stableVersion], ['github', commitSha]]) {
    const observation = value.sources[name]?.lastSuccessful;
    if (observation && !valid(observation.value)) throw new Error('upstream-state-invalid');
  }
  return value;
}

async function localVersions(root) {
  const values = await Promise.allSettled([
    jsonFile(join(root, 'package.json')),
    jsonFile(join(root, 'package-lock.json')),
    jsonFile(join(root, 'node_modules', 'dsh-pet', 'package.json')),
  ]);
  const result = {
    declaredVersion: values[0].status === 'fulfilled' ? values[0].value.dependencies?.['dsh-pet'] ?? null : null,
    lockedVersion: values[1].status === 'fulfilled' ? values[1].value.packages?.['node_modules/dsh-pet']?.version ?? null : null,
    installedVersion: values[2].status === 'fulfilled' ? values[2].value.version ?? null : null,
  };
  result.effectiveVersion = [result.lockedVersion, result.installedVersion, result.declaredVersion].find(stableVersion) ?? null;
  return result;
}

function latestStable(payload) {
  if (!object(payload) || payload.name !== 'dsh-pet' || !object(payload.versions)) throw new Error('invalid-response');
  const versions = Object.keys(payload.versions).filter(stableVersion);
  // 不用字符串比较版本号；latest 标签若指向预发布版，也只挑选稳定版本。
  versions.sort((left, right) => {
    const a = left.split('.').map(BigInt); const b = right.split('.').map(BigInt);
    for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? -1 : 1;
    return 0;
  });
  if (!versions.length) throw new Error('invalid-response');
  return versions[0];
}

async function observe(name, previous, { fetchImpl, checkedAt, timeoutMs }) {
  const cached = previous?.lastSuccessful;
  const failure = reason => ({ status: 'failed', checkedAt, reason, ...(cached ? { lastSuccessful: cached } : {}) });
  const headers = { 'User-Agent': 'dsh-pet-codex-upstream-check', Accept: name === 'npm' ? 'application/vnd.npm.install-v1+json' : 'application/vnd.github+json' };
  if (name === 'github') headers['X-GitHub-Api-Version'] = '2022-11-28';
  if (typeof cached?.etag === 'string' && cached.etag.length <= 512 && !/[\r\n]/.test(cached.etag)) headers['If-None-Match'] = cached.etag;
  try {
    const response = await fetchImpl(SOURCES[name], { headers, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 304) {
      if (!cached) return failure('cache-missing');
      return { status: 'ok', checkedAt, notModified: true, lastSuccessful: { ...cached, checkedAt } };
    }
    if (!response.ok) return failure(`http-${response.status}`);
    let payload;
    try { payload = await response.json(); } catch (error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
      return failure('invalid-response');
    }
    const value = name === 'npm' ? latestStable(payload) : payload?.sha;
    if (name === 'github' && !commitSha(value)) return failure('invalid-response');
    const etag = response.headers.get('etag');
    return { status: 'ok', checkedAt, notModified: false, lastSuccessful: { value, checkedAt, ...(etag && etag.length <= 512 && !/[\r\n]/.test(etag) ? { etag } : {}) } };
  } catch (error) {
    const reason = ['AbortError', 'TimeoutError'].includes(error.name) ? 'request-timeout' : error.message === 'invalid-response' ? 'invalid-response' : 'request-failed';
    return failure(reason);
  }
}

function comparison(sources, local, baseline) {
  const available = Object.values(sources).every(source => source.status === 'ok');
  const npmVersion = sources.npm.status === 'ok' ? sources.npm.lastSuccessful.value : null;
  const githubSha = sources.github.status === 'ok' ? sources.github.lastSuccessful.value : null;
  const reasons = [];
  if (!baseline) reasons.push('baseline-missing');
  if (npmVersion && npmVersion !== local.effectiveVersion) reasons.push('npm-local-version-diff');
  if (new Set([local.declaredVersion, local.lockedVersion, local.installedVersion].filter(value => value !== null)).size > 1) reasons.push('local-dependency-inconsistent');
  if (baseline && npmVersion && npmVersion !== baseline.npmVersion) reasons.push('npm-version-changed');
  if (baseline && githubSha && githubSha !== baseline.githubSha) reasons.push('github-main-changed');
  if (!available) reasons.push('source-unavailable');
  if (!local.effectiveVersion) reasons.push('local-version-unknown');
  const unknown = !available || !local.effectiveVersion;
  return { status: unknown ? 'unknown' : reasons.length ? 'candidate' : 'unchanged', changed: unknown ? null : reasons.length > 0, reasons, candidate: available ? { npmVersion, githubSha } : null };
}

function acceptanceDecision(accept, report) {
  if (accept.verified !== true) return { status: 'rejected', reason: 'verification-declaration-required' };
  if (!stableVersion(accept.npmVersion) || !commitSha(accept.githubSha)) return { status: 'rejected', reason: 'exact-candidate-required' };
  if (Object.values(report.sources).some(source => source.status !== 'ok')) return { status: 'rejected', reason: 'fresh-observation-required' };
  if (accept.npmVersion !== report.candidate.npmVersion || accept.githubSha !== report.candidate.githubSha) return { status: 'rejected', reason: 'candidate-changed' };
  const { declaredVersion, lockedVersion, installedVersion } = report.local;
  if ([declaredVersion, lockedVersion, installedVersion].some(version => version !== accept.npmVersion)) return { status: 'rejected', reason: 'local-version-not-applied' };
  return { status: 'accepted', reason: 'maintainer-declared-verified' };
}

/** 只检查公开上游；接受基线必须由完成验证的维护者显式声明，不执行依赖升级。 */
export async function checkUpstream({ root = ROOT, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), timeoutMs = 10000, accept } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('invalid-timeout');
  root = resolve(root);
  const statePath = join(root, 'data', 'upstream-compatibility.json');
  const reportPath = join(root, 'data', 'upstream-report.json');
  const previous = await loadState(statePath);
  const checkedAt = now();
  const [local, npm, github] = await Promise.all([
    localVersions(root),
    observe('npm', previous.sources?.npm, { fetchImpl, checkedAt, timeoutMs }),
    observe('github', previous.sources?.github, { fetchImpl, checkedAt, timeoutMs }),
  ]);
  const sources = { npm, github };
  const report = { schemaVersion: 1, checkedAt, local, sources, ...comparison(sources, local, previous.acceptedBaseline), baselineUpdated: false, reportPath };
  const next = { ...previous, schemaVersion: 1, sources };
  if (accept) {
    report.acceptance = acceptanceDecision(accept, report);
    if (report.acceptance.status === 'accepted') {
      next.acceptedBaseline = { ...report.candidate, acceptedAt: checkedAt, verification: 'maintainer-declared-verified' };
      report.baselineUpdated = true;
      report.status = 'accepted';
    }
  }
  next.lastAttempt = { checkedAt, status: report.status, changed: report.changed, reasons: report.reasons, ...(report.acceptance ? { acceptance: report.acceptance } : {}) };
  report.acceptedBaseline = next.acceptedBaseline ?? null;
  await saveJson(statePath, next);
  await saveJson(reportPath, report);
  return report;
}

function argumentsFor(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (['--accept', '--verified'].includes(argument)) {
      if (options[argument]) throw new Error('unsupported-argument');
      options[argument] = true;
    } else if (['--npm-version', '--github-sha'].includes(argument) && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      if (options[argument]) throw new Error('unsupported-argument');
      options[argument] = argv[++index];
    } else throw new Error('unsupported-argument');
  }
  if (!options['--accept'] && Object.keys(options).length) throw new Error('unsupported-argument');
  return options['--accept'] ? { accept: { npmVersion: options['--npm-version'], githubSha: options['--github-sha'], verified: Boolean(options['--verified']) } } : {};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('检查：node scripts/check-upstream.mjs\n适配验证通过后接受：node scripts/check-upstream.mjs --accept --npm-version VERSION --github-sha SHA --verified');
  } else {
    try {
      const report = await checkUpstream(argumentsFor(process.argv.slice(2)));
      console.log(JSON.stringify({ status: report.status, changed: report.changed, reasons: report.reasons, candidate: report.candidate, acceptance: report.acceptance ?? null, baselineUpdated: report.baselineUpdated, reportPath: report.reportPath }));
      process.exitCode = report.acceptance?.status === 'rejected' ? 1 : report.status === 'unknown' ? 2 : 0;
    } catch (error) {
      const reason = ['upstream-state-invalid', 'unsupported-argument'].includes(error.message) ? error.message : 'upstream-check-could-not-complete';
      const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), status: 'unknown', changed: null, reason };
      try { await saveJson(join(ROOT, 'data', 'upstream-report.json'), report); } catch { /* 写入失败仍从退出码和固定JSON报告。 */ }
      console.log(JSON.stringify(report));
      process.exitCode = 2;
    }
  }
}
