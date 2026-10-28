import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { locateCodex } from './codex-path.mjs';
import { createCodexWatcher } from './codex-events.mjs';
import { createCodexChatHandler, MAX_CHAT_BODY_BYTES } from './codex-chat.mjs';
import { createCodexActivityGate, createCodexTaskHandler, MAX_TASK_BODY_BYTES } from './codex-tasks.mjs';
import { codexQuotaResult } from './quota.mjs';
import Character from './codex-character.cjs';
import Locale from './codex-locale.cjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = join(root, 'data');
const runtimeFile = join(home, 'dsh-pet', 'standalone-runtime.json');
const bridgeFile = join(home, 'bridge-runtime.json');
const prefix = '/dsh-pet-7340';
process.env.DSH_HOME = home;
// 启动时读取系统界面语言一次，Electron子进程沿用同一结果。
process.env.CODEX_PET_LOCALE = Locale.detectSystemLocale();
Locale.setLocale(process.env.CODEX_PET_LOCALE);
const t = Locale.t;

async function readRuntime() {
  try { return JSON.parse(await readFile(runtimeFile, 'utf8')); } catch { return null; }
}
async function stopExisting() {
  const runtime = await readRuntime();
  if (!runtime) { console.log(t('桌宠当前没有运行。')); return; }
  const response = await fetch(`http://127.0.0.1:${runtime.port}/shutdown`, {
    method: 'POST', headers: { 'x-dsh-pet-token': runtime.token }, signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(t('停止请求失败，请查看本程序日志。'));
  console.log(t('已发送桌宠退出请求。'));
}

if (process.argv.includes('--stop')) {
  await stopExisting();
} else {
  await start();
}

async function start() {
  const previous = await readRuntime();
  if (previous) {
    try {
      const response = await fetch(`http://127.0.0.1:${previous.port}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) { console.log(t('Codex Pet 已经在运行。')); return; }
    } catch { /* 已退出进程的旧清单会由新进程覆盖。 */ }
  }
  mkdirSync(join(home, 'dsh-pet'), { recursive: true });
  const configFile = join(home, 'dsh-pet', 'main-config.jsonc');
  if (!existsSync(configFile)) {
    writeFileSync(configFile, JSON.stringify({
      pets: [{ id: 'main', name: '大肥鱼', size: 320, display: 'desktop', balanceEnabled: true,
        whisperEnabled: true, workStatusEnabled: true, fixedEnabled: false,
        position: { corner: 'bottom-right', marginX: 80, marginY: 30 },
        whisperPrompt: '' }],
      notificationsEnabled: true, confineToScreen: true,
      whisperImageEnabled: false, chatImageEnabled: false,
      eventsRefreshSec: { balance: 600, whisper: 600 },
    }, null, 2));
  }
  const codexPath = locateCodex();
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  const hostPath = join(root, 'node_modules', 'dsh-pet', 'lib', 'codex-host.js');
  if (!existsSync(hostPath)) throw new Error(t('请先运行 setup.ps1 准备运行时。'));
  const host = await import(pathToFileURL(hostPath).href);
  const logger = host.createStandaloneLogger();
  const activityGate = createCodexActivityGate();
  const chatHandler = createCodexChatHandler({ codexPath, cwd: home, timeoutMs: 120000, activityGate });
  let receiveTaskChange = () => {};
  const taskHandler = createCodexTaskHandler({ codexPath, activityGate, onChange: view => receiveTaskChange(view) });
  const chatToken = randomBytes(32).toString('base64url');
  const chatServer = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(res, 404, { error: 'not found' });
    if (req.headers.authorization !== `Bearer ${chatToken}` || req.headers.origin) return json(res, 403, { error: t('本机调用未授权') });
    try { await chatHandler(req, res, await requestJson(req, MAX_CHAT_BODY_BYTES)); }
    catch { if (!res.writableEnded) json(res, 400, { error: t('请求格式不正确') }); }
  });
  await new Promise((ok, fail) => { chatServer.once('error', fail); chatServer.listen(0, '127.0.0.1', ok); });
  const chatPort = chatServer.address().port;
  // 配置的是本机桥接能力令牌，既不复制也不读取 Codex 登录凭据。
  const aiConfig = host.createAiConfig(home);
  const firstAi = !existsSync(join(home, 'dsh-pet', 'codex-ai-initialized'));
  const preferences = aiConfig.publicSettings();
  await aiConfig.save({ protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${chatPort}/v1`, model: 'codex',
    apiKey: chatToken, enabled: true, automaticWhispers: firstAi ? true : preferences.automaticWhispers,
    whisperIntervalSec: firstAi ? 600 : preferences.whisperIntervalSec, timeoutMs: 60000, maxTokens: 1024 });
  writeFileSync(join(home, 'dsh-pet', 'codex-ai-initialized'), '1');
  const ai = host.createStandaloneAi(home, logger);
  const security = host.createRequestSecurity();
  const routes = [];
  const notices = [];
  let shutdown = async () => {};
  let snapshot = { state: 'idle', task: '', activeCount: 0 };
  let port = 0;
  routes.push({ kind: 'exact', path: `${prefix}/codex-character`, handler: (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    if (req.headers['x-dsh-pet-token'] !== security.token || req.headers.origin) return json(res, 403, { error: 'unauthorized' });
    json(res, 200, Character.safeIdentity(Character.readCharacter(home)));
  } });
  routes.push({ kind: 'exact', path: `${prefix}/codex-notices`, handler: (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    json(res, 200, { notices: notices.splice(0) });
  } });
  routes.push({ kind: 'exact', path: `${prefix}/codex-status`, handler: (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    json(res, 200, { ...snapshot, codexHome: undefined });
  } });
  routes.push({ kind: 'exact', path: `${prefix}/codex-chat`, handler: async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    try { await chatHandler(req, res, await requestJson(req, MAX_CHAT_BODY_BYTES)); }
    catch { if (!res.writableEnded) json(res, 400, { error: { code: 'invalid_input', message: t('图文消息格式不正确。') } }); }
  } });
  routes.push({ kind: 'exact', path: `${prefix}/codex-tasks`, handler: async (req, res) => {
    if (req.method === 'GET') return json(res, 200, taskHandler.snapshot());
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    try { await taskHandler(req, res, await requestJson(req, MAX_TASK_BODY_BYTES)); }
    catch { if (!res.writableEnded) json(res, 400, { error: { code: 'invalid_input', message: t('操作任务格式不正确。') } }); }
  } });
  routes.push({ kind: 'exact', path: `${prefix}/codex-tasks/cancel`, handler: async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    try {
      const body = await requestJson(req, 2048);
      if (!body || typeof body.id !== 'string' || Object.keys(body).some(key => key !== 'id')) return json(res, 400, { error: { code: 'invalid_input', message: t('取消请求格式不正确。') } });
      if (!taskHandler.cancel(body.id)) return json(res, 409, { error: { code: 'stale_task', message: t('任务状态已经变化。') } });
      json(res, 200, taskHandler.snapshot());
    } catch { if (!res.writableEnded) json(res, 400, { error: { code: 'invalid_input', message: t('取消请求格式不正确。') } }); }
  } });
  const context = host.createStandaloneContext({ port: () => port, logger, routes, ai, authenticatedUrl: security.authenticatedUrl });
  const server = await host.listenStandaloneServer({ routes, logger, port: Number(process.env.CODEX_PET_PORT || 3080), security, ai,
    status: () => ({ name: 'codex-pet', pid: process.pid, port }), onShutdown: () => { void shutdown(); } });
  port = server.port;
  const releaseRuntime = host.writeStandaloneRuntime(home, { port, token: security.token,
    settingsUrl: security.authenticatedUrl(`http://127.0.0.1:${port}`), pluginRoot: host.packageRoot });
  await writeFile(bridgeFile, JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }));
  process.env.CODEX_PET_NOTICE_URL = `http://127.0.0.1:${port}${prefix}/codex-notices`;
  process.env.CODEX_PET_API_URL = `http://127.0.0.1:${port}/`;
  process.env.CODEX_PET_API_TOKEN = security.token;
  process.env.CODEX_PET_LAUNCHER = join(root, existsSync(join(root, 'Start Codex Pet.vbs')) ? 'Start Codex Pet.vbs' : '启动龙娘桌宠.vbs');
  host.apply(context.ctx);
  const releaseQuota = context.ctx.get('petApi7340').balance.register({ id: 'standalone', fetch: async () => codexQuotaResult(snapshot.usage) });
  const petRequest = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${prefix}${path}`, { method,
      headers: { 'x-dsh-pet-token': security.token, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(t('桌宠状态同步失败（{status}）', { status: response.status }));
    return response;
  };
  let updateChain = Promise.resolve();
  let lastState = '';
  let lastQuota = '';
  let stopping = false;
  let mainSnapshot = snapshot;
  let manualTaskView = null;
  let manualTerminalUntil = 0;
  let manualTimer;
  const activeTaskStates = new Set(['running', 'cancelling']);
  const terminalTaskStates = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
  // 操作面板与主聊天统一决定外观，普通轮询不能把仍在运行的操作任务切回待机。
  function updateDisplay() {
    const active = activeTaskStates.has(manualTaskView?.state);
    const terminal = manualTerminalUntil > Date.now() && terminalTaskStates.has(manualTaskView?.state);
    const showManual = (active && mainSnapshot.state !== 'waiting') || (terminal && !mainSnapshot.activeCount);
    const next = showManual ? {
      ...mainSnapshot, state: active ? 'working' : manualTaskView.state === 'completed' ? 'success' : manualTaskView.state === 'cancelled' ? 'idle' : 'error',
      task: active ? t('正在处理已确认的目录任务') : manualTaskView.state === 'completed' ? t('操作任务已返回结果') : manualTaskView.state === 'cancelled' ? '' : t('操作任务未完成'),
      activeCount: (mainSnapshot.activeCount || 0) + Number(active),
    } : mainSnapshot;
    snapshot = next;
    updateChain = updateChain.then(async () => {
      if (stopping) return;
      const stateKey = JSON.stringify([next.state, next.task]);
      if (stateKey !== lastState) {
        if (next.state === 'idle') await petRequest('DELETE', '/work-status');
        else await petRequest('POST', '/work-status', { state: next.state, task: Array.from(next.task || '').slice(0, 40).join('') || null });
        lastState = stateKey;
      }
      const quotaKey = JSON.stringify(next.usage || null);
      if (quotaKey !== lastQuota && next.usage && next.state === 'idle') {
        await petRequest('POST', '/balance'); lastQuota = quotaKey;
      }
    }).catch(error => logger.warn(error.message));
  }
  receiveTaskChange = view => {
    const previousState = manualTaskView?.state;
    manualTaskView = view;
    if (terminalTaskStates.has(view.state) && view.state !== previousState) {
      manualTerminalUntil = Date.now() + 10000;
      clearTimeout(manualTimer);
      manualTimer = setTimeout(updateDisplay, 10020);
      if (view.state !== 'cancelled') {
        notices.push({ id: randomBytes(12).toString('hex'), kind: view.state === 'completed' ? 'success' : 'error',
          title: t(view.state === 'completed' ? '操作任务已返回结果' : '操作任务未完成'), body: t('打开 Codex Pet 的操作任务面板查看结果。'), threadId: null });
        if (notices.length > 24) notices.shift();
      }
    }
    updateDisplay();
  };
  // 桌宠跟随用户聊天，内部子代理的中间完成不作为整项任务完成提醒。
  const watcher = createCodexWatcher({ codexHome, excludeThreadSources: ['pet-chat', 'pet-task', 'subagent'], onChange: (next, event) => {
    mainSnapshot = next;
    if (event) {
      // 多会话并行时，通知跳转跟随事件来源，而不是当前显示工作动画的会话。
      notices.push({ id: randomBytes(12).toString('hex'), ...event, title: t(event.title), body: t(event.body), threadId: event.threadId || next.threadId });
      if (notices.length > 24) notices.shift();
    }
    updateDisplay();
  } });
  shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(manualTimer);
    await watcher.stop();
    chatHandler.dispose();
    taskHandler.dispose();
    releaseQuota();
    await context.dispose();
    await server.close();
    await new Promise(resolveClose => chatServer.close(resolveClose));
    releaseRuntime();
    await unlink(bridgeFile).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
  await watcher.start();
  logger.info(t('Codex Pet 已启动，本机端口 {port}，动画与互动基于 dsh-pet 0.3.8。', { port }));
  logger.info(t('右键可点播动作、查看额度或对话；自动碎碎念默认十分钟一次，可在 AI 设置中关闭。'));
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function requestJson(req, maximum) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maximum) throw new Error('body too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
