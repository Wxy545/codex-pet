import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkUpstream } from '../scripts/check-upstream.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const NOW = '2026-10-28T00:00:00.000Z';
const npmUrl = 'https://registry.npmjs.org/dsh-pet';
const githubUrl = 'https://api.github.com/repos/PC2005-cloud/dsh-pet/commits/main';
const accepted = (version = '0.3.8', sha = SHA_A) => ({ npmVersion: version, githubSha: sha, verified: true });

async function fixture(t, version = '0.3.8') {
  const root = await mkdtemp(join(tmpdir(), 'pet-upstream-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'node_modules', 'dsh-pet'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { 'dsh-pet': version } }));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/dsh-pet': { version } } }));
  await writeFile(join(root, 'node_modules', 'dsh-pet', 'package.json'), JSON.stringify({ name: 'dsh-pet', version }));
  return root;
}

const json = (value, etag) => new Response(JSON.stringify(value), { status: 200, headers: { ETag: etag } });
function remote({ version = '0.3.8', sha = SHA_A, npmFailure, githubFailure, notModified = false, versions } = {}) {
  return async (url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    if (url === npmUrl) {
      if (npmFailure) throw npmFailure;
      if (notModified && options.headers['If-None-Match'] === 'npm-v1') return new Response(null, { status: 304 });
      return json({ name: 'dsh-pet', 'dist-tags': { latest: version }, versions: versions ?? { [version]: { name: 'dsh-pet', version } } }, 'npm-v1');
    }
    assert.equal(url, githubUrl);
    if (githubFailure) return new Response('PRIVATE_RESPONSE', { status: githubFailure });
    if (notModified && options.headers['If-None-Match'] === 'github-v1') return new Response(null, { status: 304 });
    return json({ sha, commit: { message: 'PRIVATE_COMMIT_TEXT' } }, 'github-v1');
  };
}
const run = (root, options = {}) => checkUpstream({ root, now: () => NOW, fetchImpl: remote(), ...options });
const state = async root => JSON.parse(await readFile(join(root, 'data', 'upstream-compatibility.json'), 'utf8'));

test('首次观测只报告候选，不把尚未验证的上游自动标记为已处理', async t => {
  const root = await fixture(t);
  const report = await run(root);
  assert.equal(report.status, 'candidate');
  assert.equal(report.changed, true);
  assert.ok(report.reasons.includes('baseline-missing'));
  assert.deepEqual(report.candidate, { npmVersion: '0.3.8', githubSha: SHA_A });
  assert.equal((await state(root)).acceptedBaseline, undefined);
});

test('显式验证并接受后，两次304响应复用成功观测且结果为未变化', async t => {
  const root = await fixture(t);
  const first = await run(root, { accept: accepted() });
  assert.equal(first.acceptance.status, 'accepted');
  assert.equal((await state(root)).acceptedBaseline.npmVersion, '0.3.8');
  const report = await run(root, { fetchImpl: remote({ notModified: true }) });
  assert.equal(report.status, 'unchanged');
  assert.equal(report.changed, false);
  assert.equal(report.sources.npm.notModified, true);
  assert.equal(report.sources.github.notModified, true);
});

test('main更新在重试时仍是候选，普通检查不会推进已处理基线', async t => {
  const root = await fixture(t);
  await run(root, { accept: accepted() });
  for (let count = 0; count < 2; count++) {
    const report = await run(root, { fetchImpl: remote({ sha: SHA_B }) });
    assert.equal(report.status, 'candidate');
    assert.ok(report.reasons.includes('github-main-changed'));
    assert.equal((await state(root)).acceptedBaseline.githubSha, SHA_A);
  }
});

test('npm按稳定语义版本排序，忽略latest标签中的预发布版本', async t => {
  const root = await fixture(t);
  const versions = { '0.3.9': {}, '0.3.10': {}, '1.0.0-beta.1': {}, invalid: {} };
  const report = await run(root, { fetchImpl: remote({ version: '1.0.0-beta.1', versions }) });
  assert.equal(report.candidate.npmVersion, '0.3.10');
  assert.ok(report.reasons.includes('npm-local-version-diff'));
});

test('网络和限流失败保留旧成功观测与基线，不能冒充未变化或写出响应正文', async t => {
  const root = await fixture(t);
  await run(root, { accept: accepted() });
  const report = await run(root, { fetchImpl: remote({ npmFailure: new Error('PRIVATE_NETWORK_DETAIL'), githubFailure: 429 }) });
  assert.equal(report.status, 'unknown');
  assert.equal(report.changed, null);
  const saved = await state(root);
  assert.equal(saved.sources.npm.lastSuccessful.value, '0.3.8');
  assert.equal(saved.sources.github.lastSuccessful.value, SHA_A);
  assert.equal(saved.acceptedBaseline.githubSha, SHA_A);
  assert.equal(report.sources.npm.status, 'failed');
  assert.equal(report.sources.github.reason, 'http-429');
  assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  assert.equal(JSON.stringify(saved).includes('PRIVATE_'), false);
  assert.equal((await run(root, { fetchImpl: remote({ sha: SHA_B }) })).status, 'candidate');
});

test('请求超时会中止等待并返回unknown，不吞掉已有升级候选', async t => {
  const root = await fixture(t);
  await run(root, { accept: accepted() });
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  const report = await run(root, { fetchImpl, timeoutMs: 20 });
  assert.equal(report.status, 'unknown');
  assert.equal(report.sources.npm.reason, 'request-timeout');
  assert.equal((await state(root)).acceptedBaseline.githubSha, SHA_A);
});

test('接受时必须声明已验证，并精确匹配本次联网观测，防止检查后上游又更新', async t => {
  const root = await fixture(t);
  for (const accept of [{ npmVersion: '0.3.8', githubSha: SHA_A }, accepted('0.3.8', SHA_B)]) {
    const report = await run(root, { accept });
    assert.equal(report.acceptance.status, 'rejected');
    assert.equal((await state(root)).acceptedBaseline, undefined);
  }
});

test('未应用的npm升级不能接受；本地声明、lock和已安装版本不一致也不能接受', async t => {
  const root = await fixture(t);
  const report = await run(root, { fetchImpl: remote({ version: '0.3.9' }), accept: accepted('0.3.9') });
  assert.equal(report.acceptance.status, 'rejected');
  assert.equal(report.acceptance.reason, 'local-version-not-applied');
  await writeFile(join(root, 'node_modules', 'dsh-pet', 'package.json'), JSON.stringify({ version: '0.3.7' }));
  const inconsistent = await run(root, { accept: accepted() });
  assert.equal(inconsistent.acceptance.status, 'rejected');
  assert.equal((await state(root)).acceptedBaseline, undefined);
});

test('已接受后本地依赖出现偏差会报告候选，不能沿用旧结果显示未变化', async t => {
  const root = await fixture(t);
  await run(root, { accept: accepted() });
  await writeFile(join(root, 'node_modules', 'dsh-pet', 'package.json'), JSON.stringify({ version: '0.3.7' }));
  const report = await run(root);
  assert.equal(report.status, 'candidate');
  assert.ok(report.reasons.includes('local-dependency-inconsistent'));
});

test('接受时任一来源失败都保持旧基线，不使用缓存值冒充新验证', async t => {
  const root = await fixture(t);
  await run(root, { accept: accepted() });
  const report = await run(root, { fetchImpl: remote({ sha: SHA_B, npmFailure: new Error('offline') }), accept: accepted('0.3.8', SHA_B) });
  assert.equal(report.acceptance.status, 'rejected');
  assert.equal(report.acceptance.reason, 'fresh-observation-required');
  assert.equal((await state(root)).acceptedBaseline.githubSha, SHA_A);
});

test('畸形上游响应不会覆盖成功值或夹带公开提交正文', async t => {
  const root = await fixture(t);
  await run(root, { accept: accepted() });
  const report = await run(root, { fetchImpl: remote({ sha: 'not-a-sha', versions: { '1.0.0-beta.1': {} } }) });
  assert.equal(report.status, 'unknown');
  assert.equal(report.sources.npm.reason, 'invalid-response');
  assert.equal(report.sources.github.reason, 'invalid-response');
  assert.equal((await state(root)).sources.github.lastSuccessful.value, SHA_A);
  const savedReport = await readFile(join(root, 'data', 'upstream-report.json'), 'utf8');
  assert.equal(savedReport.includes('PRIVATE_'), false);
});

test('损坏的基线显式失败并原样保留，避免静默当成首次检查', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'data'));
  const path = join(root, 'data', 'upstream-compatibility.json');
  await writeFile(path, '{broken');
  await assert.rejects(run(root), { message: 'upstream-state-invalid' });
  assert.equal(await readFile(path, 'utf8'), '{broken');
});
