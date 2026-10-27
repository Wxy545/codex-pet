import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createCodexChildEnv } from './codex-child-env.mjs';

export const MAX_TASK_BODY_BYTES = 64 * 1024;
const TASK_RULES = '你正在执行用户在独立操作面板明确确认的本地任务。只在用户选择的工作目录内按所授予的只读或工作目录读写权限处理本次正文。不得扩大目录、申请提权、关闭沙箱、读取或修改登录凭据及密钥、调用外部应用或联网代办。只读任务不得修改文件。遇到超出范围的操作，说明限制并停止该操作。遵循工作目录内相关项目约定，完成后用简短中文说明结果和实际修改；不要输出思考过程、秘密信息或无关内容。';
const DISABLED_TASK_FEATURES = [
  'code_mode', 'apps', 'plugins', 'hooks', 'browser_use', 'in_app_browser',
  'computer_use', 'image_generation', 'multi_agent', 'multi_agent_v2', 'memories',
  'workspace_dependencies', 'shell_snapshot', 'skill_search', 'sleep_tool', 'goals',
];
const ERRORS = {
  invalid_input: [400, '请填写任务正文、绝对工作目录和明确权限。'],
  confirmation_required: [400, '请在操作面板核对目录、任务和权限后确认提交。'],
  invalid_cwd: [400, '工作目录必须是存在的绝对目录。'],
  busy: [429, '桌宠已有聊天或操作任务正在运行，请等待完成或先取消。'],
  cancelled: [400, '任务已取消。'],
  timeout: [504, '任务超时，已请求停止本次执行。'],
  process_failed: [502, 'Codex任务未能完成，请检查本机Codex状态后重试。'],
  empty_reply: [502, '任务结束但没有返回摘要，请检查结果后重试。'],
  output_limit: [502, '任务输出超过上限，已请求停止本次执行。'],
  permission_violation: [502, '只读任务出现文件变更请求，已请求停止。'],
  tools_disabled: [502, '任务请求了未开放的外部能力，已请求停止。'],
};

function taskError(code) {
  return Object.assign(new Error((ERRORS[code] ?? ERRORS.process_failed)[1]), { code, statusCode: (ERRORS[code] ?? ERRORS.process_failed)[0] });
}

/** 同一个实例同时交给聊天和操作入口；释放函数幂等且不会误释放下一次请求。 */
export function createCodexActivityGate() {
  let current;
  return {
    acquire(owner) {
      if (current) return null;
      const token = { owner };
      current = token;
      return () => { if (current === token) current = undefined; };
    },
  };
}

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw taskError('invalid_input');
  if (body.confirmed !== true) throw taskError('confirmation_required');
  if (Object.keys(body).some(key => !['cwd', 'task', 'permission', 'confirmed'].includes(key))) throw taskError('invalid_input');
  if (typeof body.cwd !== 'string' || !isAbsolute(body.cwd) || body.cwd.length > 32768) throw taskError('invalid_cwd');
  if (typeof body.task !== 'string' || !body.task.trim() || body.task.length > 12000) throw taskError('invalid_input');
  if (!['read-only', 'workspace-write'].includes(body.permission)) throw taskError('invalid_input');
  return { cwd: body.cwd, task: body.task.trim(), permission: body.permission };
}

function terminateOwnChild(child) {
  if (process.platform === 'win32' && Number.isInteger(child.pid) && child.pid > 0 && child.exitCode == null) {
    // PID只来自本次spawn；Windows取消同时结束这次CLI派生的命令，不按名称杀Codex桌面进程。
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { env: createCodexChildEnv(), shell: false, windowsHide: true, stdio: 'ignore' });
    killer.once('error', () => { try { child.kill(); } catch { /* 子进程已退出。 */ } });
    killer.once('close', code => { if (code !== 0) { try { child.kill(); } catch { /* 子进程已退出。 */ } } });
  } else child.kill();
}

/** POST接受后后台执行；snapshot供轮询，取消必须携带当前任务ID。 */
export function createCodexTaskHandler({ codexPath, timeoutMs = 600000, spawnImpl = spawn, terminateImpl = terminateOwnChild, fsImpl = {}, activityGate, onChange = () => {} } = {}) {
  if (typeof codexPath !== 'string' || !codexPath) throw new TypeError('codexPath is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');
  if (typeof onChange !== 'function') throw new TypeError('onChange must be a function');
  const io = { realpath, stat, ...fsImpl };
  let active;
  let last = { state: 'idle', progress: [], summary: '' };

  const snapshot = () => structuredClone(last);
  const publish = () => { try { onChange(snapshot()); } catch { /* 界面更新不影响本次进程收尾。 */ } };
  function note(view, kind, text) {
    const previous = view.progress.at(-1);
    if (!previous || previous.kind !== kind || previous.text !== text) {
      view.progress.push({ at: new Date().toISOString(), kind, text });
      if (view.progress.length > 24) view.progress.shift();
    }
    publish();
  }
  function release(token) {
    clearTimeout(token.timer);
    token.releaseGate?.();
    if (active === token) active = undefined;
  }
  function finish(token, state, code, summary = '') {
    if (token.done) return;
    token.done = true;
    token.view.state = state;
    token.view.finishedAt = new Date().toISOString();
    token.view.summary = summary;
    if (code) token.view.error = { code, message: taskError(code).message };
    // CLI零退出只代表本轮已返回；摘要可能包含能力限制，不能据此声称业务操作成功。
    note(token.view, state, state === 'completed' ? '执行已结束，请核对返回结果' : code === 'cancelled' ? '任务已取消' : taskError(code ?? 'process_failed').message);
    release(token);
  }
  function requestStop(token, reason) {
    if (token.done || token.stopReason) return;
    token.stopReason = reason;
    clearTimeout(token.timer);
    if (token.view) {
      token.view.state = 'cancelling';
      note(token.view, 'cancelling', reason === 'cancelled' ? '正在取消本次任务' : '正在停止本次任务');
    }
    if (token.child && !token.closed) {
      try { terminateImpl(token.child); } catch { try { token.child.kill(); } catch { /* 等待进程close，期间保持共享锁。 */ } }
    }
  }

  async function start(body) {
    const input = validateBody(body);
    if (active) throw taskError('busy');
    const releaseGate = activityGate?.acquire('task');
    if (activityGate && typeof releaseGate !== 'function') throw taskError('busy');
    const token = { releaseGate, child: null, closed: false, done: false, stopReason: null };
    active = token;
    let canonicalCwd;
    try {
      canonicalCwd = await io.realpath(input.cwd);
      if (!(await io.stat(canonicalCwd)).isDirectory()) throw taskError('invalid_cwd');
    } catch { release(token); throw taskError('invalid_cwd'); }
    if (token.stopReason) { release(token); throw taskError('cancelled'); }
    const view = { id: randomUUID(), state: 'running', cwd: canonicalCwd, permission: input.permission, startedAt: new Date().toISOString(), progress: [], summary: '' };
    token.view = view;
    last = view;
    note(view, 'thinking', '已确认范围，正在启动本次任务');
    // 本机验收版本用旧sandbox选项实际发出只读上下文；命名内置profile才能保留确认过的权限。
    // 两个profile均默认禁止命令联网，:workspace仅开放工作根与系统临时目录；不得混用旧sandbox配置。
    const permissionProfile = input.permission === 'workspace-write' ? ':workspace' : ':read-only';
    const args = [
      'exec', '--ephemeral', '--skip-git-repo-check',
      '--json', '--thread-source', 'pet-task', '--ignore-user-config', '--color', 'never',
      '-c', 'default_permissions=' + JSON.stringify(permissionProfile),
      // 忽略用户配置时Windows不会选择可执行的沙箱；显式使用无需管理员的受限令牌沙箱。
      ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="unelevated"'] : []),
      '-c', 'approval_policy="never"', '-c', 'web_search="disabled"',
      '-c', 'developer_instructions=' + JSON.stringify(TASK_RULES),
      ...DISABLED_TASK_FEATURES.flatMap(feature => ['--disable', feature]), '-',
    ];
    const decoder = new StringDecoder('utf8');
    let answer = '';
    let lineBuffer = ''; let totalBytes = 0;
    function parseLine(line) {
      if (!line.trim() || token.done || token.stopReason) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'turn.failed' || event.type === 'error') { requestStop(token, 'process_failed'); return; }
      const item = event.item;
      if (!item || typeof item !== 'object') return;
      if (['mcp_tool_call', 'web_search', 'collab_tool_call', 'tool_call'].includes(item.type)) { requestStop(token, 'tools_disabled'); return; }
      if (item.type === 'file_change') {
        if (input.permission === 'read-only') { requestStop(token, 'permission_violation'); return; }
        note(view, 'working', '正在处理工作目录中的文件变更');
      } else if (item.type === 'command_execution') note(view, 'working', '正在执行本次本地任务');
      else if (item.type === 'reasoning') note(view, 'thinking', '正在分析本次任务');
      if (event.type === 'item.completed' && item.type === 'agent_message' && ![item.phase, item.channel].some(value => ['commentary', 'analysis'].includes(value)) && typeof item.text === 'string') {
        const text = item.text.trim();
        if (!text) return;
        // 同一轮可能先给计划后给结果；兼容未带phase的CLI时，最后一条有效正文才是返回摘要。
        if (text.length > 16000) requestStop(token, 'output_limit');
        else answer = text;
      }
    }
    try {
      const child = spawnImpl(codexPath, args, { cwd: canonicalCwd, env: createCodexChildEnv(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      token.child = child;
      child.once('error', () => {
        if (Number.isInteger(child.pid) && child.pid > 0) requestStop(token, 'process_failed');
        else finish(token, 'failed', 'process_failed');
      });
      child.once('close', code => {
        token.closed = true;
        if (token.done) return;
        lineBuffer += decoder.end();
        if (lineBuffer) parseLine(lineBuffer);
        if (token.stopReason) {
          const state = token.stopReason === 'cancelled' ? 'cancelled' : token.stopReason === 'timeout' ? 'timed_out' : 'failed';
          finish(token, state, token.stopReason);
        } else if (code !== 0) finish(token, 'failed', 'process_failed');
        else {
          const summary = answer;
          finish(token, summary ? 'completed' : 'failed', summary ? undefined : 'empty_reply', summary);
        }
      });
      child.stdout.on('data', chunk => {
        if (token.done || token.stopReason) return;
        totalBytes += Buffer.byteLength(chunk);
        if (totalBytes > 4 * 1024 * 1024) { requestStop(token, 'output_limit'); return; }
        lineBuffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
        if (lineBuffer.length > 512 * 1024) { requestStop(token, 'output_limit'); return; }
        let boundary;
        while (!token.stopReason && (boundary = lineBuffer.indexOf('\n')) >= 0) {
          parseLine(lineBuffer.slice(0, boundary));
          lineBuffer = lineBuffer.slice(boundary + 1);
        }
      });
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => requestStop(token, 'process_failed'));
      token.timer = setTimeout(() => requestStop(token, 'timeout'), timeoutMs);
      token.timer.unref?.();
      child.stdin.end(input.task, 'utf8');
    } catch {
      if (token.child) requestStop(token, 'process_failed');
      else finish(token, 'failed', 'process_failed');
      throw taskError('process_failed');
    }
    return snapshot();
  }

  const handler = async (req, res, body) => {
    if (res.destroyed || res.writableEnded) return;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    if (req.method && req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: { code: 'method_not_allowed', message: '请使用POST提交任务。' } })); return; }
    try {
      const accepted = await start(body);
      res.statusCode = 202;
      res.end(JSON.stringify(accepted));
    } catch (error) {
      const safe = taskError(error.code ?? 'process_failed');
      res.statusCode = safe.statusCode;
      res.end(JSON.stringify({ error: { code: safe.code, type: 'codex_pet_task_error', message: safe.message } }));
    }
  };
  handler.start = start;
  handler.snapshot = snapshot;
  handler.cancel = id => {
    if (!active?.view || active.view.id !== id || active.done) return false;
    requestStop(active, 'cancelled');
    return true;
  };
  handler.dispose = () => { if (active) requestStop(active, 'cancelled'); };
  return handler;
}
