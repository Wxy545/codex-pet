import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import Startup from './codex-startup.cjs';
import PetHost from './pet-host.cjs';
import { createWorkBuddyBridge } from './workbuddy-events.mjs';
import { createWorkBuddyBalance } from './workbuddy-balance.mjs';
import { waitForRestartReady } from './pet-restart.mjs';
import { createQQBridge, projectQQState } from './qq-remote.mjs';
import { installControlResume } from './control-resume.mjs';
import HarnessHandoff from './harness-handoff.cjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = join(root, 'data');
const runtimeFile = join(home, 'dsh-pet', 'standalone-runtime.json');
const bridgeFile = join(home, 'bridge-runtime.json');
const prefix = '/dsh-pet-7340';
if(!process.env.CODEX_PET_NATIVE_DSH_HOME)process.env.CODEX_PET_NATIVE_DSH_HOME=process.env.DSH_HOME&&resolve(process.env.DSH_HOME)!==home?process.env.DSH_HOME:join(homedir(),'.dsh');
process.env.DSH_HOME = home;
const companionHost = PetHost.readHost(home);
const isCodex = companionHost === 'codex';
process.env.CODEX_PET_HOST = companionHost;
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
  // 选择WorkBuddy时不查找Codex CLI，也不读取或改写Codex的账号/AI设置。
  const codexPath = isCodex ? locateCodex() : null;
  const codexHome = isCodex ? process.env.CODEX_HOME || join(homedir(), '.codex') : null;
  const hostPath = join(root, 'node_modules', 'dsh-pet', 'lib', 'codex-host.js');
  if (!existsSync(hostPath)) throw new Error(t('请先运行 setup.ps1 准备运行时。'));
  const host = await import(pathToFileURL(hostPath).href);
  const logger = host.createStandaloneLogger();
  const activityGate = createCodexActivityGate();
  let switchingHost = false;
  // 原生 Harness 沿用自己的服务；旧 Codex 任务可收尾，新任务在受理前再次核对移交状态。
  const canStartCodex = () => isCodex && !switchingHost && !HarnessHandoff.isActive({dataRoot:home,projectRoot:root});
  const refuseNewCodex = res => json(res,409,{error:{code:'host_unavailable',message:Locale.getLocale()==='zh-CN'?'请先将桌宠联动应用切回 Codex，再发送新任务。':'Select Codex as the companion app before sending a new task.'}});
  let receiveTaskChange = () => {};
  const chatHandler = isCodex ? createCodexChatHandler({ codexPath, cwd: home, timeoutMs: 120000, activityGate }) : null;
  const taskHandler = isCodex ? createCodexTaskHandler({ codexPath, activityGate, onChange: view => receiveTaskChange(view) }) : null;
  const chatToken = randomBytes(32).toString('base64url');
  const chatServer = isCodex ? createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(res, 404, { error: 'not found' });
    if (req.headers.authorization !== `Bearer ${chatToken}` || req.headers.origin) return json(res, 403, { error: t('本机调用未授权') });
    if (!canStartCodex()) return refuseNewCodex(res);
    try { const body=await requestJson(req,MAX_CHAT_BODY_BYTES);if(!canStartCodex())return refuseNewCodex(res);await chatHandler(req,res,body); }
    catch { if (!res.writableEnded) json(res, 400, { error: t('请求格式不正确') }); }
  }) : null;
  if (chatServer) await new Promise((ok, fail) => { chatServer.once('error', fail); chatServer.listen(0, '127.0.0.1', ok); });
  const chatPort = chatServer?.address().port;
  // 配置的是本机桥接能力令牌，既不复制也不读取 Codex 登录凭据。
  if (isCodex) {
  const aiConfig = host.createAiConfig(home);
  const firstAi = !existsSync(join(home, 'dsh-pet', 'codex-ai-initialized'));
  const preferences = aiConfig.publicSettings();
  await aiConfig.save({ protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${chatPort}/v1`, model: 'codex',
    apiKey: chatToken, enabled: true, automaticWhispers: firstAi ? true : preferences.automaticWhispers,
    whisperIntervalSec: firstAi ? 600 : preferences.whisperIntervalSec, timeoutMs: 60000, maxTokens: 1024 });
  writeFileSync(join(home, 'dsh-pet', 'codex-ai-initialized'), '1');
  }
  const ai = isCodex ? host.createStandaloneAi(home, logger) : PetHost.unavailableAi();
  const workbuddyBalance = isCodex ? null : createWorkBuddyBalance({locale:Locale.getLocale()});
  // WorkBuddy只开放其本机只读积分通道，聊天与模型执行能力继续关闭。
  if (!isCodex) ai.currentSelection = () => ({provider:'workbuddy',model:''});
  const security = host.createRequestSecurity();
  const routes = [];
  const startup = Startup.createLaunchQueue();
  startup.push(process.argv.includes('--workbuddy-startup') ? 'workbuddy' : process.argv.includes('--codex-startup') ? 'codex' : 'manual');
  const notices = [];
  function enqueueNotice(value) {
    // 原生Harness自行通知；旧宿主任务继续收尾，但移交期间不弹提醒，也不留到切回后补发。
    if (HarnessHandoff.isActive({dataRoot:home,projectRoot:root})) { notices.length = 0; return; }
    notices.push(value);
    if (notices.length > 24) notices.shift();
  }
  let shutdown = async () => {};
  let snapshot = { state: 'idle', task: '', activeCount: 0 };
  let mainSnapshot = snapshot;
  let port = 0;
  let eventReady = false;
  let updateChain = Promise.resolve();
  let lastState = '';
  let lastQuota = '';
  let stopping = false;
  let manualTaskView = null;
  let manualTerminalUntil = 0;
  let manualTimer;
  let processTimer = null;
  let processChecking = false;
  let qq, qqView=null, qqTerminalTimer;
  if(isCodex)try{qq=await createQQBridge({dataRoot:home,codexPath,codexHome,activityGate,canStart:canStartCodex,locale:Locale.getLocale(),onState:view=>{
    const previousState=qqView?.state;qqView=view;clearTimeout(qqTerminalTimer);
    if(['success','error'].includes(view.state)){
      qqTerminalTimer=setTimeout(()=>{qqView=null;if(eventReady)updateDisplay();},10000);qqTerminalTimer.unref();
      if(previousState!==view.state)enqueueNotice({id:randomBytes(12).toString('hex'),kind:view.state==='success'?'complete':'error',title:Locale.getLocale()==='zh-CN'?'QQ 任务已结束':'QQ task finished',body:Locale.getLocale()==='zh-CN'?'在 QQ 中查看任务结果。':'Check QQ for the task result.',threadId:view.threadId||null});
    }
    if(eventReady)updateDisplay();
  }});}catch{logger.warn(Locale.getLocale()==='zh-CN'?'QQ 连接设置未能读取；桌宠继续运行，请检查本机 QQ 设置。':'QQ settings could not be loaded. The pet is still running; check its local QQ settings.');}
  routes.push({kind:'exact',path:`${prefix}/qq-remote`,handler:async(req,res)=>{
    if(req.headers['x-dsh-pet-token']!==security.token||req.headers.origin)return json(res,403,{error:{code:'unauthorized'}});
    if(!canStartCodex())return json(res,409,{error:{code:'host_unavailable_for_qq'}});
    if(!qq)return json(res,503,{error:{code:'storage_failed'}});
    if(req.method==='GET')return json(res,200,qq.state());
    if(req.method!=='POST')return json(res,405,{error:{code:'method_not_allowed'}});
    try{json(res,200,await qq.configure(await requestJson(req,32768)));}
    catch(error){const code=['invalid_input','invalid_directory','busy','not_configured','already_paired','secret_required','secret_store_unavailable'].includes(error.code)?error.code:'storage_failed';json(res,code==='busy'?409:400,{error:{code}});}
  }});
  const activeTaskStates = new Set(['running', 'cancelling']);
  const terminalTaskStates = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
  routes.push({ kind: 'exact', path: `${prefix}/pet-host`, handler: async (req, res) => {
    if (req.headers['x-dsh-pet-token'] !== security.token || req.headers.origin) return json(res, 403, {error: 'unauthorized'});
    if (req.method === 'GET') return json(res, 200, PetHost.publicHost(companionHost));
    if (req.method !== 'POST') return json(res, 405, {error: 'method not allowed'});
    let releaseSwitch, readyFile, changedPreference=false;
    try {
      const body = await requestJson(req, 1024);
      if (!body || !PetHost.validHost(body.host) || Object.keys(body).some(key => key !== 'host')) return json(res, 400, {error: 'invalid host'});
      if (body.host === companionHost) return json(res, 200, PetHost.publicHost(companionHost));
      if (switchingHost || snapshot.activeCount) return json(res, 409, {error: 'host_busy'});
      if (body.host === 'codex') {try {locateCodex();} catch {return json(res, 409, {error:'codex_missing'});}}
      releaseSwitch = activityGate.acquire('host-switch');
      if (!releaseSwitch) return json(res, 409, {error: 'host_busy'});
      switchingHost = true;
      PetHost.writeHost(home, body.host);
      changedPreference=true;
      readyFile=join(home,'host-restart-ready-'+randomUUID()+'.json');
      // 只重启本安装的宠物进程，不结束Codex、WorkBuddy或其中的任务。
      const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/restart-pet.ps1'), '-AppRoot', root, '-ExpectedPid', String(process.pid), '-ReadyFile', readyFile],
        {windowsHide: true, detached: true, stdio: 'ignore'});
      await waitForRestartReady({child,file:readyFile,expectedPid:process.pid});
      await unlink(readyFile).catch(()=>{});
      child.unref();
      json(res, 202, {...PetHost.publicHost(body.host), restarting: true});
      setTimeout(() => { if (switchingHost) void shutdown(); }, 350).unref();
    } catch {
      switchingHost = false;releaseSwitch?.();
      if(changedPreference)try{PetHost.writeHost(home,companionHost);}catch{}
      if(readyFile)await unlink(readyFile).catch(()=>{});
      if (!res.writableEnded) json(res, 500, {error: 'host_switch_failed'});
    }
  } });
  const workbuddy = createWorkBuddyBridge({locale: Locale.getLocale(), onChange: (next, event) => {
    if (companionHost !== 'workbuddy') return;
    mainSnapshot = next;
    if (event) enqueueNotice({id: randomBytes(12).toString('hex'), ...event, threadId: null});
    if (eventReady) updateDisplay();
  }});
  routes.push({kind: 'exact', path: `${prefix}/workbuddy-events`, handler: async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, {error: 'method not allowed'});
    if (req.headers['x-dsh-pet-token'] !== security.token || req.headers.origin) return json(res, 403, {error: 'unauthorized'});
    if (companionHost !== 'workbuddy' || switchingHost) return json(res, 202, {ok: true, ignored: true});
    try { const accepted = workbuddy.accept(await requestJson(req, 8192)); json(res, accepted ? 202 : 400, {ok: accepted}); }
    catch { if (!res.writableEnded) json(res, 400, {error: 'invalid event'}); }
  }});
  routes.push({ kind: 'exact', path: `${prefix}/codex-startup`, handler: async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    try {
      const body = await requestJson(req, 1024);
      if (body?.reason !== companionHost) return json(res, 202, {ok: true, ignored: true});
      startup.request(body); json(res, 202, { ok: true });
    } catch { if (!res.writableEnded) json(res, 400, { error: 'invalid startup request' }); }
  } });
  routes.push({ kind: 'exact', path: `${prefix}/codex-startup/pending`, handler: (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    json(res, 200, startup.take());
  } });
  routes.push({ kind: 'exact', path: `${prefix}/codex-character`, handler: (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    if (req.headers['x-dsh-pet-token'] !== security.token || req.headers.origin) return json(res, 403, { error: 'unauthorized' });
    json(res, 200, Character.safeIdentity(Character.readCharacter(home)));
  } });
  routes.push({ kind: 'exact', path: `${prefix}/codex-notices`, handler: (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    if (HarnessHandoff.isActive({dataRoot:home,projectRoot:root})) notices.length = 0;
    json(res, 200, { notices: notices.splice(0) });
  } });
  routes.push({kind:'exact',path:`${prefix}/pet-host/presentation`,handler:async(req,res)=>{
    if(req.headers['x-dsh-pet-token']!==security.token||req.headers.origin)return json(res,403,{error:'unauthorized'});
    if(req.method!=='POST')return json(res,405,{error:'method not allowed'});
    try{
      const body=await requestJson(req,512);
      if(!body||Object.keys(body).length!==1||!['pause','resume'].includes(body.mode))return json(res,400,{error:'invalid presentation mode'});
      const active=HarnessHandoff.isActive({dataRoot:home,projectRoot:root});
      if(active!==(body.mode==='pause'))return json(res,409,{error:'host_changed'});
      // 移交边界立即清空旧提醒，不依赖下一次通知轮询；恢复先更新真实状态再显示角色。
      notices.length=0;lastState='';lastQuota='';
      if(body.mode==='resume'){
        await updateDisplay({strict:true});
        await petRequest('POST','/balance');
      }
      return json(res,200,{ok:true});
    }catch{return json(res,500,{error:'presentation_sync_failed'});}
  }});
  routes.push({ kind: 'exact', path: `${prefix}/codex-status`, handler: (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    json(res, 200, { ...snapshot, codexHome: undefined });
  } });
  routes.push({ kind: 'exact', path: `${prefix}/codex-chat`, handler: async (req, res) => {
    if (!chatHandler || !canStartCodex()) return refuseNewCodex(res);
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    try { const body=await requestJson(req,MAX_CHAT_BODY_BYTES);if(!canStartCodex())return refuseNewCodex(res);await chatHandler(req,res,body); }
    catch { if (!res.writableEnded) json(res, 400, { error: { code: 'invalid_input', message: t('图文消息格式不正确。') } }); }
  } });
  routes.push({ kind: 'exact', path: `${prefix}/codex-tasks`, handler: async (req, res) => {
    if (!taskHandler || switchingHost) return json(res, 409, {error: {code: 'host_unavailable', message: t('请在 WorkBuddy 中提交操作任务。')}});
    if (req.method === 'GET') return json(res, 200, taskHandler.snapshot());
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    if (!canStartCodex()) return refuseNewCodex(res);
    try { const body=await requestJson(req,MAX_TASK_BODY_BYTES);if(!canStartCodex())return refuseNewCodex(res);await taskHandler(req,res,body); }
    catch { if (!res.writableEnded) json(res, 400, { error: { code: 'invalid_input', message: t('操作任务格式不正确。') } }); }
  } });
  routes.push({ kind: 'exact', path: `${prefix}/codex-tasks/cancel`, handler: async (req, res) => {
    if (!taskHandler || switchingHost) return json(res, 409, {error: {code: 'host_unavailable', message: t('请在 WorkBuddy 中提交操作任务。')}});
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
    status: () => ({ name: 'codex-pet', pid: process.pid, port, host: companionHost }), onShutdown: () => { void shutdown(); } });
  port = server.port;
  const releaseRuntime = host.writeStandaloneRuntime(home, { port, token: security.token,
    settingsUrl: security.authenticatedUrl(`http://127.0.0.1:${port}`), pluginRoot: host.packageRoot });
  await writeFile(bridgeFile, JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }));
  process.env.CODEX_PET_NOTICE_URL = `http://127.0.0.1:${port}${prefix}/codex-notices`;
  process.env.CODEX_PET_API_URL = `http://127.0.0.1:${port}/`;
  process.env.CODEX_PET_API_TOKEN = security.token;
  process.env.CODEX_PET_LAUNCHER = join(root, existsSync(join(root, 'Start Codex Pet.vbs')) ? 'Start Codex Pet.vbs' : '启动龙娘桌宠.vbs');
  host.setDesktopActivityGate(activityGate);
  host.apply(context.ctx);
  const controlResume=installControlResume({routes,prefix});
  const quotaProvider = isCodex ? 'standalone' : 'workbuddy';
  const nativeQuotaUnavailable = () => ({ok:false,provider:quotaProvider,reason:'host-unavailable',message:Locale.getLocale()==='zh-CN'?'请在 Harness 中查看其账户额度。':'Check your account usage in Harness.'});
  const releaseQuota = context.ctx.get('petApi7340').balance.register({id:quotaProvider,fetch:async()=>{
    if(HarnessHandoff.isActive({dataRoot:home,projectRoot:root}))return nativeQuotaUnavailable();
    const value = isCodex ? codexQuotaResult(snapshot.usage) : await workbuddyBalance.fetch();
    // 在途积分查询可以正常关闭连接，但移交后不能把旧宿主的值发布给新宿主。
    return HarnessHandoff.isActive({dataRoot:home,projectRoot:root}) ? nativeQuotaUnavailable() : value;
  }});
  async function petRequest(method, path, body) {
    const response = await fetch(`http://127.0.0.1:${port}${prefix}${path}`, { method,
      headers: { 'x-dsh-pet-token': security.token, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(t('桌宠状态同步失败（{status}）', { status: response.status }));
    return response;
  }
  // 操作面板与主聊天统一决定外观，普通轮询不能把仍在运行的操作任务切回待机。
  function updateDisplay({strict=false}={}) {
    const active = activeTaskStates.has(manualTaskView?.state);
    const terminal = manualTerminalUntil > Date.now() && terminalTaskStates.has(manualTaskView?.state);
    const showManual = (active && mainSnapshot.state !== 'waiting') || (terminal && !mainSnapshot.activeCount);
    const next = showManual ? {
      ...mainSnapshot, state: active ? 'working' : manualTaskView.state === 'completed' ? 'success' : manualTaskView.state === 'cancelled' ? 'idle' : 'error',
      task: active ? t('正在处理已确认的目录任务') : manualTaskView.state === 'completed' ? t('操作任务已返回结果') : manualTaskView.state === 'cancelled' ? '' : t('操作任务未完成'),
      activeCount: (mainSnapshot.activeCount || 0) + Number(active),
    } : mainSnapshot;
    snapshot = projectQQState(next,qqView,Locale.getLocale());
    const displaySnapshot=snapshot;
    const pending = updateChain.then(async () => {
      if (stopping || HarnessHandoff.isActive({dataRoot:home,projectRoot:root})) return;
      const next=displaySnapshot;
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
    });
    updateChain = pending.catch(error => logger.warn(error.message));
    // 后台更新继续自愈；恢复入口必须观察本次真实写入失败，不能带着旧工作状态显示角色。
    return strict ? pending : updateChain;
  }
  receiveTaskChange = view => {
    const previousState = manualTaskView?.state;
    manualTaskView = view;
    if (terminalTaskStates.has(view.state) && view.state !== previousState) {
      manualTerminalUntil = Date.now() + 10000;
      clearTimeout(manualTimer);
      manualTimer = setTimeout(updateDisplay, 10020);
      if (view.state !== 'cancelled') {
        enqueueNotice({ id: randomBytes(12).toString('hex'), kind: view.state === 'completed' ? 'success' : 'error',
          title: t(view.state === 'completed' ? '操作任务已返回结果' : '操作任务未完成'), body: t('打开 Codex Pet 的操作任务面板查看结果。'), threadId: null });
      }
    }
    updateDisplay();
  };
  // 桌宠跟随用户聊天，内部子代理的中间完成不作为整项任务完成提醒。
  const watcher = isCodex ? createCodexWatcher({ codexHome, excludeThreadSources: ['pet-chat', 'pet-task', 'subagent'],excludeThread:(id,turnId)=>qq?.ownsTurn(id,turnId)===true, onChange: (next, event) => {
    mainSnapshot = next;
    if (event) {
      // 多会话并行时，通知跳转跟随事件来源，而不是当前显示工作动画的会话。
      enqueueNotice({ id: randomBytes(12).toString('hex'), ...event, title: t(event.title), body: t(event.body), threadId: event.threadId || next.threadId });
    }
    updateDisplay();
  } }) : {async start() {}, async stop() {workbuddy.dispose();}};
  shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(manualTimer);
    clearTimeout(qqTerminalTimer);
    try{await qq?.dispose();}catch{/* QQ关闭失败不能阻止主桌宠、监听器和本机服务收尾。 */}
    clearInterval(processTimer);
    await watcher.stop();
    chatHandler?.dispose();
    taskHandler?.dispose();
    workbuddy.dispose();
    controlResume.dispose();
    workbuddyBalance?.dispose();
    releaseQuota();
    await context.dispose();
    await server.close();
    if (chatServer) await new Promise(resolveClose => chatServer.close(resolveClose));
    releaseRuntime();
    await unlink(bridgeFile).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
  eventReady = true;
  if (!isCodex) updateDisplay();
  await watcher.start();
  void qq?.start();
  if (!isCodex) {
    // 仅在已核实全部WorkBuddy进程退出时清场；最小化和长任务不按超时误判。
    const checkWorkBuddyProcess = async () => {
      if (stopping || processChecking) return;
      processChecking = true;
      try {
        const {stdout} = await promisify(execFile)(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'src/workbuddy-target.ps1'),'-Action','Alive'],
          {windowsHide: true, timeout: 3000, maxBuffer: 4096, encoding: 'utf8'});
        const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
        if (!stopping && result.ok === true && result.running === false) workbuddy.hostClosed();
      } catch { /* 无法确认进程状态时保留真实任务，不制造完成或失败。 */ }
      finally { processChecking = false; }
    };
    processTimer = setInterval(() => { void checkWorkBuddyProcess(); }, 10000);
    processTimer.unref();
    void checkWorkBuddyProcess();
  }
  logger.info(t('Codex Pet 已启动，本机端口 {port}，动画与互动基于 dsh-pet 0.3.8。', { port }));
  logger.info(isCodex ? Locale.getLocale()==='zh-CN'?'右键可点播动作、查看额度或对话；自动碎碎念默认十分钟一次，可在控制中心的「碎念」中关闭。':'Use the pet menu for actions, usage, or chat. Automatic chatter runs every ten minutes; turn it off under Chatter in the control center.' : t('桌宠已联动 WorkBuddy，右键可点播动作和切换形象。'));
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
