import {readFile, lstat, realpath, open} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {join, resolve, extname, isAbsolute} from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {parse as parseToml} from 'smol-toml';
import {createCodexChildEnv} from './codex-child-env.mjs';
import {locateCodex} from './codex-path.mjs';

const privateCatalogs = new WeakMap();
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = code => {throw Object.assign(Error(code), {code});};
const digest = value => createHash('sha256').update(value).digest('hex');
const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
const label = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 80) : '';
const secret = /(?:\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})|(?:token|password|secret|api[_-]?key|authorization)\s*[=:]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY)/i;

// JSONC仅移除字符串以外的注释及尾逗号，不执行配置代码。
function jsonc(text) {
  let output = '', quoted = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index], next = text[index + 1];
    if (quoted) {output += char; if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue;}
    if (char === '"') {quoted = true; output += char; continue;}
    if (char === '/' && next === '/') {while (index < text.length && text[index] !== '\n') index++; output += '\n'; continue;}
    if (char === '/' && next === '*') {const end = text.indexOf('*/', index + 2); if (end < 0) fail('invalid_mcp_config'); index = end + 1; output += ' '; continue;}
    if (char === ',') {let after = index + 1; while (/\s/.test(text[after] || 'x')) after++; if (text[after] === '}' || text[after] === ']') continue;}
    output += char;
  }
  return JSON.parse(output);
}
async function sourceRecord(file) {
  const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 2 || info.size > 1024 * 1024) fail('invalid_mcp_source');
  const canonical = await realpath(file), handle = await open(file, 'r');
  try {
    const opened = await handle.stat(); if (opened.ino !== info.ino || opened.dev !== info.dev || opened.nlink !== 1) fail('mcp_source_changed');
    const bytes = await handle.readFile(), after = await handle.stat(), current = await lstat(file);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || current.isSymbolicLink() || current.ino !== opened.ino || current.dev !== opened.dev || current.size !== opened.size || current.mtimeMs !== opened.mtimeMs || current.nlink !== 1) fail('mcp_source_changed');
    return {sourcePath: canonical, bytes, revision: 'codex-mcp-v1-' + digest(Buffer.concat([Buffer.from(canonical + '\0'), bytes]))};
  } finally {await handle.close();}
}
function configuration(value) {
  if (!record(value) || typeof value.command !== 'string' && typeof value.url !== 'string' || value.command && value.url) fail('invalid_mcp_config');
  const result = Object.create(null), fields = ['command', 'args', 'cwd', 'env', 'env_vars', 'url', 'http_headers', 'env_http_headers', 'bearer_token_env_var', 'startup_timeout_sec', 'startup_timeout_ms', 'tool_timeout_sec', 'enabled_tools', 'disabled_tools', 'oauth', 'scopes', 'auth'];
  for (const field of fields) if (Object.hasOwn(value, field)) result[field] = value[field];
  if (result.command !== undefined && (!opaque(result.command) || result.args !== undefined && (!Array.isArray(result.args) || result.args.length > 128 || result.args.some(item => typeof item !== 'string' || item.length > 4096)))) fail('invalid_mcp_config');
  if (result.url !== undefined) {let url; try {url = new URL(result.url);} catch {fail('invalid_mcp_config');} if (!['http:', 'https:'].includes(url.protocol)) fail('invalid_mcp_config');}
  if (value.type !== undefined && !['stdio', 'http', 'streamable-http'].includes(value.type)) fail('unsupported_mcp_transport');
  result.enabled = true; return result;
}
function safeSchema(value, depth = 0) {
  if (depth > 24) fail('mcp_catalog_unavailable');
  if (typeof value === 'string') {if (value.length > 8000 || secret.test(value) || /https?:\/\/[^\s/]+:[^\s/]+@/i.test(value)) fail('mcp_catalog_unavailable'); return value;}
  if (Array.isArray(value)) {if (value.length > 512) fail('mcp_catalog_unavailable'); return value.map(item => safeSchema(item, depth + 1));}
  if (record(value)) {const next = Object.create(null); for (const [key, item] of Object.entries(value)) {if (['default', 'examples', '_meta', '$comment'].includes(key)) continue; if (key === '$ref' && typeof item === 'string' && !item.startsWith('#/')) fail('mcp_catalog_unavailable'); next[key] = safeSchema(item, depth + 1);} return next;}
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  fail('mcp_catalog_unavailable');
}

/** 目录刷新纯离线：不启动服务、不读取auth文件，只公开服务器标签、传输类型与配置指纹。 */
export async function readCodexMcpCatalog({codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'), sourcePath} = {}) {
  const input = sourcePath || join(codexHome, 'config.toml');
  const empty = {state: 'unknown', revision: null, sourcePath: isAbsolute(input || '') ? resolve(input) : null, servers: []};
  if (!isAbsolute(input || '') || /(?:^|[\\/])(?:auth\.json|credentials[^\\/]*|\.credentials[^\\/]*|\.env(?:\.[^\\/]*)?)(?:$|[\\/])/i.test(input)) return {...empty, code: 'invalid_mcp_source'};
  if (!['.toml', '.json', '.jsonc'].includes(extname(input).toLowerCase())) return {...empty, code: 'unsupported_mcp_format'};
  try {
    const source = await sourceRecord(input), text = source.bytes.toString('utf8').replace(/^\uFEFF/, ''), parsed = extname(input).toLowerCase() === '.toml' ? parseToml(text) : jsonc(text);
    if (!record(parsed)) fail('invalid_mcp_config');
    const map = parsed.mcp_servers ?? parsed.mcpServers ?? {};
    if (!record(map) || Object.keys(map).length > 128) fail('invalid_mcp_config');
    const descriptions = new Map(), servers = [];
    for (const [name, value] of Object.entries(map)) {
      if (!opaque(name) || secret.test(name) || !record(value)) fail('invalid_mcp_config');
      if (value.enabled === false || value.disabled === true) continue;
      const config = configuration(value), id = 'mcp-' + digest(name).slice(0, 32);
      servers.push({id, label: label(name), transport: config.url ? 'http' : 'stdio'}); descriptions.set(id, {name, config});
    }
    const catalog = {state: 'ready', revision: source.revision, sourcePath: source.sourcePath, servers};
    privateCatalogs.set(catalog, {descriptions}); return catalog;
  } catch (error) {return {...empty, code: ['invalid_mcp_source', 'mcp_source_changed', 'invalid_mcp_config', 'unsupported_mcp_transport'].includes(error.code) ? error.code : error.code === 'ENOENT' ? 'mcp_source_missing' : 'invalid_mcp_config'};}
}

export function stopCodexProxyProcess(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, shell: false, stdio: 'ignore', env: createCodexChildEnv()}); killer.once('error', () => {try {child.kill();} catch {}});
  } else try {child.kill();} catch {}
}

/** 独立原生协议连接从不启动模型turn；配置只经stdin传递，stderr及完整配置不对外转发。 */
export function createCodexProxyServer({codexPath, codexHome, cwd, spawnImpl = spawn, timeoutMs = 30000, configArgs = []} = {}) {
  let child, pending = new Map(), sequence = 0, readyPromise, closed = false,faulted=false;
  const disabled = ['shell_tool', 'unified_exec', 'code_mode', 'code_mode_host', 'apps', 'plugins', 'hooks', 'multi_agent', 'multi_agent_v2', 'memories', 'skill_search', 'image_generation', 'browser_use', 'computer_use'];
  const send = value => {if (!child || child.exitCode != null || child.stdin.destroyed) fail('mcp_proxy_closed'); child.stdin.write(JSON.stringify(value) + '\n');};
  function lost(code) {for (const item of pending.values()) {clearTimeout(item.timer); item.reject(Object.assign(Error(code), {code}));} pending.clear();}
  function fault(code){if(faulted)return;faulted=true;lost(code);stopCodexProxyProcess(child);}
  const request = (method, params, limit = timeoutMs) => new Promise((resolveRequest, reject) => {
    if (closed || faulted || !child || pending.size >= 64) {reject(Object.assign(Error('mcp_proxy_unavailable'), {code: 'mcp_proxy_unavailable'})); return;}
    const id = ++sequence, timer = setTimeout(() => {pending.delete(id); reject(Object.assign(Error('mcp_proxy_timeout'), {code: 'mcp_proxy_timeout'}));}, limit);
    pending.set(id, {resolve: resolveRequest, reject, timer}); try {send({id, method, params});} catch {lost('mcp_proxy_closed');}
  });
  function line(text) {
    let frame; try {frame = JSON.parse(text);} catch {fault('mcp_proxy_protocol'); return;}
    if (!record(frame)) return;
    if (typeof frame.method === 'string' && Object.hasOwn(frame, 'id')) {
      try {send({id: frame.id, result: frame.method === 'mcpServer/elicitation/request' ? {action: 'decline', content: null} : frame.method === 'item/permissions/requestApproval' ? {permissions: {}, scope: 'turn'} : {decision: 'decline'}});} catch {}
      return;
    }
    const item = pending.get(frame.id); if (!item) return; pending.delete(frame.id); clearTimeout(item.timer);
    Object.hasOwn(frame, 'error') ? item.reject(Object.assign(Error('mcp_native_rejected'), {code: 'mcp_native_rejected'})) : item.resolve(frame.result);
  }
  async function ready() {
    if (closed) fail('mcp_proxy_closed'); if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      const args = ['app-server', '--listen', 'stdio://', '-c', 'mcp_servers={}', '-c', 'default_permissions=":read-only"', '-c', 'web_search="disabled"', '-c', 'analytics.enabled=false', ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="unelevated"'] : []), ...disabled.flatMap(key => ['--disable', key]), ...configArgs];
      const env = createCodexChildEnv(); if (codexHome) env.CODEX_HOME = codexHome;
      child = spawnImpl(codexPath || locateCodex(), args, {cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
      let buffer = ''; const decoder = new StringDecoder('utf8');
      child.stdout.on('data', bytes => {if(faulted)return;buffer += typeof bytes === 'string' ? bytes : decoder.write(bytes); if (buffer.length > 4 * 1024 * 1024) {buffer='';fault('mcp_proxy_protocol'); return;} let end; while (!faulted&&(end = buffer.indexOf('\n')) >= 0) {const next = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (next.trim()) line(next);}});
      child.stderr.on('data', () => {}); child.stdin.on('error', () => lost('mcp_proxy_closed')); child.once('error', () => lost('mcp_proxy_unavailable')); child.once('close', () => lost('mcp_proxy_closed'));
      await request('initialize', {clientInfo: {name: 'codex-pet-tool-proxy', version: '1.0.0'}, capabilities: {experimentalApi: true}}); send({method: 'initialized'});
    })(); return readyPromise;
  }
  async function close() {
    if (closed) return; closed = true; lost('mcp_proxy_closed'); const owned = child; child = null; if (!owned) return;
    await new Promise(done => {const timer = setTimeout(() => {stopCodexProxyProcess(owned); done();}, 1000); owned.once('close', () => {clearTimeout(timer); done();}); try {owned.stdin.end();} catch {clearTimeout(timer); stopCodexProxyProcess(owned); done();}});
  }
  return {ready, request, close};
}

/** 仅授权后的自有连接启用精确所选服务；主对话没有原生MCP入口，执行只能经过一次审批代理。 */
export async function createCodexMcpProxy({catalog, selectedIds, cwd, codexPath, codexHome, spawnImpl = spawn, createServer = createCodexProxyServer, signal} = {}) {
  const privateConfig = privateCatalogs.get(catalog); if (!privateConfig || catalog.state !== 'ready' || !Array.isArray(selectedIds) || !selectedIds.length || selectedIds.some(id => !privateConfig.descriptions.has(id))) fail('mcp_catalog_unavailable');
  const configs = Object.create(null); for (const id of selectedIds) {const value = privateConfig.descriptions.get(id); configs[value.name] = value.config;}
  const server = createServer({cwd, codexPath, codexHome, spawnImpl}); let threadId, tools = new Map(), stopped = false;
  const abort=()=>{stopped=true;void server.close();};
  const check=()=>{if(stopped||signal?.aborted)fail('tool_initialization_cancelled');};
  signal?.addEventListener('abort',abort,{once:true});
  async function current() {const fresh = await readCodexMcpCatalog({sourcePath: catalog.sourcePath}); if (fresh.state !== 'ready' || fresh.revision !== catalog.revision) fail('mcp_source_changed');}
  try {
    check();await current();check();await server.ready();check();
    const response = await server.request('thread/start', {ephemeral: true, cwd, permissions: ':read-only', environments: [], config: {mcp_servers: configs, default_permissions: ':read-only', web_search: 'disabled'}, approvalPolicy: 'never', approvalsReviewer: 'user'});
    check();threadId = response?.thread?.id; if (!opaque(threadId)) fail('mcp_proxy_protocol');
    for (const id of selectedIds) {
      const selected = privateConfig.descriptions.get(id); let cursor, pages = 0;
      do {
        check();
        const response = await server.request('mcpServerStatus/list', {threadId, serverName: selected.name, detail: 'toolsAndAuthOnly', limit: 100, ...(cursor ? {cursor} : {})});
        check();
        if (!Array.isArray(response?.data) || ++pages > 3) fail('mcp_catalog_unavailable');
        const entry = response.data.find(value => value.name === selected.name); if (!entry || !record(entry.tools) || entry.toolsError || entry.runtimeStatus?.status === 'failed') fail('mcp_catalog_unavailable');
        for (const [name, tool] of Object.entries(entry.tools)) {
          if (!opaque(name) || !record(tool) || !record(tool.inputSchema)) fail('mcp_catalog_unavailable');
          const rawDescription=tool.description||tool.title||name;
          if(typeof rawDescription!=='string'||secret.test(rawDescription))fail('mcp_catalog_unavailable');
          const key = 'qq_mcp_' + digest(id + '\0' + name).slice(0, 24), schema = safeSchema(tool.inputSchema), description = label(rawDescription);
          tools.set(key, {id, server: selected.name, name, schema, fingerprint: digest(JSON.stringify(schema)), description: selected.name + ' · ' + name + (description ? ': ' + description : '')});
          if (tools.size > 256) fail('mcp_catalog_limit');
        }
        cursor = response.nextCursor;
      } while (cursor);
    }
    const specs = [...tools].map(([name, tool]) => ({type: 'function', name, description: tool.description, inputSchema: tool.schema})); if (!specs.length) fail('mcp_catalog_unavailable'); if (Buffer.byteLength(JSON.stringify(specs)) > 512 * 1024) fail('mcp_catalog_limit');
    return {
      specs,
      describe(name) {const tool = tools.get(name); return tool ? {server: label(tool.server), tool: label(tool.name)} : null;},
      async call(name, args) {
        if (stopped || !tools.has(name) || !record(args)) fail('mcp_tool_unavailable'); await current();check(); const tool = tools.get(name);
        const response = await server.request('mcpServer/tool/call', {threadId, server: tool.server, tool: tool.name, arguments: args}, 120000);
        return response?.result ?? response;
      },
      async close() {stopped = true;signal?.removeEventListener('abort',abort);tools.clear();await server.close();},
    };
  } catch (error) {signal?.removeEventListener('abort',abort);await server.close();throw error;}
}
