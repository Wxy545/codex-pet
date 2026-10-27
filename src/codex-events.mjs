import { readdir, stat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, resolve } from 'node:path';

const RECENT_MS = 48 * 60 * 60 * 1000;
const INITIAL_TAIL_BYTES = 128 * 1024;
const READ_BYTES = 256 * 1024;
const MAX_LINE_BYTES = 512 * 1024;
const MAX_FILES = 256;
const MAX_THREADS = 512;
const MAX_NOTICE_KEYS = 512;
const EMPTY_BUFFER = Buffer.alloc(0);
const TASK_TEXT = {
  idle: '等待 Codex 任务', thinking: '正在思考', working: '正在工作',
  result: '正在整理结果', waiting: '等待您的确认', success: '本次任务已完成', error: '任务出现错误',
};
const NOTICE = {
  complete: { kind: 'complete', title: 'Codex 任务完成', body: '有会话已完成本次任务。' },
  error: { kind: 'error', title: 'Codex 任务出现错误', body: '有会话执行失败，请打开 Codex 查看。' },
  approval: { kind: 'approval', title: 'Codex 等待确认', body: '有会话需要您的确认或补充信息。' },
};
const ACTIVE_PRIORITY = { waiting: 4, working: 3, result: 2, thinking: 1 };
const APPROVAL_TYPES = new Set(['exec_approval_request', 'apply_patch_approval_request', 'approval_request', 'request_user_input']);
const ERROR_TYPES = new Set(['error', 'stream_error', 'task_failed', 'turn_failed']);
const TOOL_ITEM_TYPES = new Set(['commandexecution', 'filechange', 'mcptoolcall', 'collabagenttoolcall', 'extension', 'websearch', 'imagegeneration']);

function safeId(value, fallback) {
  return typeof value === 'string' && /^[\w-]{1,128}$/.test(value) ? value : fallback;
}

function fileThreadId(path) {
  const name = basename(path, '.jsonl');
  const ids = name.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi);
  return safeId(ids?.at(-1) ?? name, 'session');
}

function timestampOf(record, fallback) {
  const parsed = Date.parse(record.timestamp);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function windowLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '额度窗口';
  if (minutes % 1440 === 0) return `${minutes / 1440} 天额度`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时额度`;
  return `${minutes} 分钟额度`;
}

// 额度来自真实 rate_limits 字段；不使用 token 数推算账号余额。
function usageFrom(rateLimits) {
  const groups = Array.isArray(rateLimits) ? rateLimits : [rateLimits];
  const windows = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    for (const key of ['primary', 'secondary']) {
      const value = group[key];
      if (!value || typeof value.used_percent !== 'number' || !Number.isFinite(value.used_percent)) continue;
      const usage = {
        usedPercent: Math.min(100, Math.max(0, value.used_percent)),
        windowLabel: Number.isFinite(value.window_minutes) && value.window_minutes > 0
          ? windowLabel(value.window_minutes)
          : typeof value.window_label === 'string' && value.window_label.trim()
            ? value.window_label.trim().slice(0, 80) : '额度窗口',
      };
      if (Number.isFinite(value.window_minutes) && value.window_minutes > 0) usage.windowMinutes = value.window_minutes;
      if (typeof value.resets_at === 'number' && Number.isFinite(value.resets_at)) usage.resetsAt = value.resets_at;
      windows.push(usage);
    }
  }
  return windows.length ? { windows } : undefined;
}

function usageSnapshot(quota) {
  if (!quota) return undefined;
  const now = Date.now() / 1000;
  const windows = quota.windows.map(window => ({ ...window, ...(window.resetsAt !== undefined && window.resetsAt <= now ? { stale: true } : {}) }));
  const fresh = windows.filter(window => !window.stale);
  const selected = [...(fresh.length ? fresh : windows)].sort((a, b) => b.usedPercent - a.usedPercent)[0];
  // 重置时间已过代表这条观测过期，不能据此把实际使用率改成 0。
  const result = { usedPercent: selected.usedPercent, windowLabel: selected.windowLabel, windows };
  if (selected.resetsAt !== undefined) result.resetsAt = selected.resetsAt;
  if (selected.stale) result.stale = true;
  return result;
}

function transitionFor(record) {
  const payload = record.payload;
  if (!payload || typeof payload !== 'object') return undefined;
  if (record.type === 'event_msg') {
    const type = payload.type;
    if (type === 'task_started') return { state: 'thinking', active: true };
    if (type === 'task_complete') return payload.error
      ? { state: 'error', active: false, notice: 'error' }
      : { state: 'success', active: false, notice: 'complete' };
    if (type === 'turn_aborted') return ['error', 'failed', 'fatal'].includes(payload.reason)
      ? { state: 'error', active: false, notice: 'error' }
      : { state: 'idle', active: false };
    if (APPROVAL_TYPES.has(type)) return { state: 'waiting', active: true, notice: 'approval' };
    if (ERROR_TYPES.has(type)) return { state: 'error', active: false, notice: 'error' };
    if (['exec_approval_response', 'apply_patch_approval_response', 'request_user_input_response'].includes(type)) return { state: 'thinking', active: true };
    if (type === 'item_started' || type === 'item_completed') {
      const item = payload.item;
      const itemType = String(item?.type ?? '').toLowerCase();
      if (itemType === 'reasoning') return { state: 'thinking', active: true };
      if (TOOL_ITEM_TYPES.has(itemType)) return { state: 'working', active: true };
      if (itemType === 'agentmessage') return { state: item.phase === 'final_answer' || item.phase === 'final' ? 'result' : 'thinking', active: true };
    }
  }
  if (record.type === 'response_item') {
    if (['function_call', 'custom_tool_call'].includes(payload.type)) {
      if (/(?:request_user_input|ask_user|request_approval|approval_request)/i.test(String(payload.name ?? ''))) return { state: 'waiting', active: true, notice: 'approval' };
      return { state: 'working', active: true };
    }
    if (['function_call_output', 'custom_tool_call_output'].includes(payload.type)) return { state: 'working', active: true };
    if (payload.type === 'reasoning') return { state: 'thinking', active: true };
    if (payload.type === 'message' && payload.role === 'assistant') return { state: ['final_answer', 'final'].includes(payload.phase) ? 'result' : 'thinking', active: true };
  }
  return undefined;
}

/**
 * 只读跟随 Codex 会话日志。snapshot 与通知只包含固定状态文案，不返回对话或命令正文。
 * start/stop 可 await；snapshot 同步读取，onChange 只在快照变化或出现新通知时调用。
 */
export function createCodexWatcher({ codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'), onChange = () => {}, pollMs = 1500, excludeThreadSources = ['pet-chat'], terminalHoldMs = 10000 } = {}) {
  if (typeof codexHome !== 'string' || !codexHome) throw new TypeError('codexHome 必须是目录路径');
  if (typeof onChange !== 'function') throw new TypeError('onChange 必须是函数');
  if (!Number.isFinite(pollMs) || pollMs < 10) throw new TypeError('pollMs 必须不少于 10 毫秒');
  if (!Number.isFinite(terminalHoldMs) || terminalHoldMs < 0) throw new TypeError('terminalHoldMs 必须是非负毫秒数');
  if (!Array.isArray(excludeThreadSources)) throw new TypeError('excludeThreadSources 必须是数组');
  const sessionsRoot = join(resolve(codexHome), 'sessions');
  const excludedSources = new Set(excludeThreadSources);
  const files = new Map();
  const threads = new Map();
  const noticeKeys = new Set();
  let running = false;
  let bootstrapping = false;
  let timer;
  let startPromise;
  let inFlight;
  let startedAt = 0;
  let nextDiscovery = 0;
  let sequence = 0;
  let quota;
  let quotaTimestamp = -Infinity;
  let published;

  function snapshot() {
    const all = [...threads.values()];
    const active = all.filter(thread => thread.active);
    const ordered = active.length
      ? active.sort((a, b) => (ACTIVE_PRIORITY[b.state] ?? 0) - (ACTIVE_PRIORITY[a.state] ?? 0) || b.updatedAt - a.updatedAt || b.sequence - a.sequence)
      : all.sort((a, b) => b.updatedAt - a.updatedAt || b.sequence - a.sequence);
    const selected = ordered[0];
    const terminalExpired = selected && !selected.active && ['success', 'error'].includes(selected.state)
      && Date.now() - Math.min(selected.updatedAt, selected.observedAt) >= terminalHoldMs;
    // 终态只短暂展示；仍在运行或等待确认的会话不以时间推断为结束。
    const state = terminalExpired ? 'idle' : selected?.state ?? 'idle';
    const result = { state, task: active.length > 1 ? `${active.length} 个会话${TASK_TEXT[state]}` : TASK_TEXT[state], activeCount: active.length };
    if (quota) result.usage = usageSnapshot(quota);
    if (selected) result.threadId = selected.threadId;
    return result;
  }

  function publish(notification) {
    if (!running || bootstrapping) return;
    const current = snapshot();
    const fingerprint = JSON.stringify(current);
    if (!notification && fingerprint === published) return;
    published = fingerprint;
    try { onChange(current, notification ? { ...notification } : undefined); } catch { /* 界面回调失败不影响只读游标。 */ }
  }

  function applyRecord(record, cursor, mode, linePosition) {
    if (!record || typeof record !== 'object') return;
    const payload = record.payload;
    if (record.type === 'session_meta' && payload && typeof payload === 'object') {
      cursor.threadId = safeId(payload.id ?? payload.session_id, cursor.threadId);
      cursor.source = payload.thread_source ?? payload.source;
      cursor.excluded = excludedSources.has(cursor.source);
    }
    if (cursor.excluded) return;
    const updatedAt = timestampOf(record, cursor.mtimeMs);
    if (record.type === 'event_msg' && payload?.type === 'token_count') {
      const next = usageFrom(payload.rate_limits);
      if (next && updatedAt >= quotaTimestamp) { quota = next; quotaTimestamp = updatedAt; publish(); }
    }
    const transition = transitionFor(record);
    if (!transition) return;
    const previous = threads.get(cursor.threadId);
    if (!previous || updatedAt >= previous.updatedAt) {
      threads.set(cursor.threadId, { threadId: cursor.threadId, state: transition.state, active: transition.active, updatedAt, observedAt: Date.now(), sequence: ++sequence, sourcePath: cursor.path });
      // 只保存归约后的状态；不积累原始日志、工具结果和对话正文。
      if (threads.size > MAX_THREADS) {
        const oldest = [...threads.values()].sort((a, b) => Number(a.active) - Number(b.active) || a.updatedAt - b.updatedAt)[0];
        threads.delete(oldest.threadId);
      }
    }
    let notification;
    if (transition.notice) {
      const turn = payload.turn_id ?? payload.root_turn_id ?? '';
      const discriminator = transition.notice === 'approval'
        ? payload.id ?? payload.call_id ?? record.timestamp ?? linePosition
        : turn || record.timestamp || linePosition;
      const key = `${cursor.threadId}:${transition.notice}:${discriminator}`;
      const seen = noticeKeys.has(key);
      noticeKeys.add(key);
      if (noticeKeys.size > MAX_NOTICE_KEYS) noticeKeys.delete(noticeKeys.values().next().value);
      const hasTime = Number.isFinite(Date.parse(record.timestamp));
      const newEnough = hasTime ? updatedAt >= startedAt : mode === 'append';
      // 聚合快照可能仍选中另一条活动会话，通知跳转必须使用本条事件的来源会话。
      if (!seen && mode !== 'silent' && newEnough) notification = { ...NOTICE[transition.notice], threadId: cursor.threadId };
    }
    publish(notification);
  }

  function consume(cursor, chunk, mode, absoluteStart, skipFirst = false) {
    let content = cursor.pending.length ? Buffer.concat([cursor.pending, chunk]) : chunk;
    let start = 0;
    if (skipFirst || cursor.droppingLine) {
      const firstNewline = content.indexOf(10);
      if (firstNewline < 0) { cursor.pending = EMPTY_BUFFER; cursor.droppingLine = true; return; }
      start = firstNewline + 1;
      cursor.droppingLine = false;
    }
    for (;;) {
      const newline = content.indexOf(10, start);
      if (newline < 0) break;
      if (newline - start <= MAX_LINE_BYTES) {
        try { applyRecord(JSON.parse(content.subarray(start, newline).toString('utf8')), cursor, mode, absoluteStart + newline); } catch { /* 半行、损坏行和非 JSON 行不外传。 */ }
      }
      start = newline + 1;
    }
    content = content.subarray(start);
    if (content.length > MAX_LINE_BYTES) { cursor.pending = EMPTY_BUFFER; cursor.droppingLine = true; }
    else cursor.pending = Buffer.from(content);
  }

  async function readBytes(handle, position, length) {
    if (length <= 0) return EMPTY_BUFFER;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  }

  async function initialCursor(path, info, mode, oldCursor) {
    const handle = await open(path, 'r');
    try {
      if (oldCursor && threads.get(oldCursor.threadId)?.sourcePath === path) threads.delete(oldCursor.threadId);
      const cursor = { path, threadId: fileThreadId(path), source: undefined, excluded: false, offset: 0, pending: EMPTY_BUFFER, droppingLine: false, anchor: EMPTY_BUFFER, identity: `${info.dev}:${info.ino}`, mtimeMs: info.mtimeMs };
      // 首行只用于来源和稳定会话 ID；最多读取一个有限块，不读取认证或配置文件。
      const head = await readBytes(handle, 0, Math.min(info.size, READ_BYTES));
      const end = head.indexOf(10);
      if (end >= 0) {
        try {
          const header = JSON.parse(head.subarray(0, end).toString('utf8'));
          if (header.type === 'session_meta') applyRecord(header, cursor, 'silent', end);
        } catch { /* 超长或不完整元信息使用文件名 ID。 */ }
      }
      const tailStart = Math.max(0, info.size - INITIAL_TAIL_BYTES);
      const tail = await readBytes(handle, tailStart, info.size - tailStart);
      consume(cursor, tail, mode, tailStart, tailStart > 0);
      cursor.offset = tailStart + tail.length;
      cursor.anchor = await readBytes(handle, Math.max(0, cursor.offset - 64), Math.min(64, cursor.offset));
      files.set(path, cursor);
    } finally { await handle.close(); }
  }

  async function refresh(cursor) {
    const info = await stat(cursor.path);
    if (!info.isFile()) return;
    if (`${info.dev}:${info.ino}` !== cursor.identity || info.size < cursor.offset) return initialCursor(cursor.path, info, 'silent', cursor);
    if (info.size === cursor.offset && info.mtimeMs === cursor.mtimeMs) return;
    const handle = await open(cursor.path, 'r');
    let replaced = false;
    try {
      // 即使两次轮询之间截断后又长回原大小，也能通过已读末尾锚点发现重写。
      const anchor = await readBytes(handle, Math.max(0, cursor.offset - 64), Math.min(64, cursor.offset));
      if (!anchor.equals(cursor.anchor)) replaced = true;
      else {
        const chunk = await readBytes(handle, cursor.offset, Math.min(READ_BYTES, info.size - cursor.offset));
        const start = cursor.offset;
        cursor.mtimeMs = info.mtimeMs;
        consume(cursor, chunk, 'append', start);
        cursor.offset += chunk.length;
        cursor.anchor = await readBytes(handle, Math.max(0, cursor.offset - 64), Math.min(64, cursor.offset));
      }
    } finally { await handle.close(); }
    if (replaced) await initialCursor(cursor.path, info, 'silent', cursor);
  }

  async function discover(initial) {
    const candidates = [];
    const directories = [{ path: sessionsRoot, depth: 0 }];
    // 允许旧日期目录内的续聊文件，以最近修改时间界定近两日，跳过符号链接。
    while (directories.length) {
      const { path: directory, depth } = directories.pop();
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (entry.isDirectory() && depth < 3 && /^\d{2,4}$/.test(entry.name)) directories.push({ path: join(directory, entry.name), depth: depth + 1 });
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const path = join(directory, entry.name);
          try {
            const info = await stat(path);
            if (info.mtimeMs >= Date.now() - RECENT_MS) {
              candidates.push({ path, info });
              if (candidates.length > MAX_FILES * 2) {
                candidates.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
                candidates.length = MAX_FILES;
              }
            }
          } catch { /* 发现期间被轮转或归档的文件留待下一轮。 */ }
        }
      }
    }
    candidates.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    const selected = candidates.slice(0, MAX_FILES);
    const paths = new Set(selected.map(file => file.path));
    for (const [path, cursor] of files) if (!paths.has(path)) {
      files.delete(path);
      if (threads.get(cursor.threadId)?.sourcePath === path) threads.delete(cursor.threadId);
    }
    for (const { path, info } of selected) {
      if (!running) return;
      if (!files.has(path)) {
        try { await initialCursor(path, info, initial ? 'silent' : 'new-file'); } catch { /* 文件写入或轮转中的短暂竞态不作为任务失败。 */ }
      }
    }
  }

  async function tick(initial = false) {
    if (!running) return;
    if (initial || Date.now() >= nextDiscovery) {
      await discover(initial);
      nextDiscovery = Date.now() + Math.max(100, pollMs * 3);
    }
    for (const cursor of files.values()) {
      if (!running) return;
      try { await refresh(cursor); } catch { /* 只读失败时保留已知状态，不伪造业务错误通知。 */ }
    }
    publish();
  }

  function scheduleTick() {
    if (!running || inFlight) return;
    inFlight = tick().catch(() => { /* 文件系统短暂异常留待下轮重试，不让桌宠进程退出。 */ }).finally(() => { inFlight = undefined; });
  }

  function start() {
    if (running) return startPromise;
    running = true;
    bootstrapping = true;
    startedAt = Date.now();
    startPromise = (async () => {
      inFlight = tick(true);
      try { await inFlight; } finally { inFlight = undefined; bootstrapping = false; }
      if (running) {
        publish();
        timer = setInterval(scheduleTick, pollMs);
        timer.unref?.();
      }
      return snapshot();
    })();
    return startPromise;
  }

  async function stop() {
    running = false;
    clearInterval(timer);
    timer = undefined;
    await inFlight;
    startPromise = undefined;
  }

  return { start, stop, snapshot };
}
