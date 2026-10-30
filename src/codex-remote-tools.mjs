import {randomUUID} from 'node:crypto';
import {realpathSync, statSync} from 'node:fs';
import {join, resolve, relative, isAbsolute, sep} from 'node:path';
import {normalizeRemoteToolPolicy} from './remote-tool-policy.mjs';
import {readCodexMcpCatalog, createCodexMcpProxy} from './codex-mcp.mjs';
import {createCodexRemoteFiles} from './codex-remote-files.mjs';

const fail = code => {throw Object.assign(Error(code), {code});};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const within = (root, file) => {const path = relative(root, file); return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);};
const secret = /(?:\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})|(?:token|password|secret|api[_-]?key|authorization)\s*[=:]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY|(?:^|[\\/\s"'])auth\.json(?:\b|$))/i;
const reviewable = value => typeof value === 'string' && value.length > 0 && value.length <= 3000 && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value) && !secret.test(value);
export const dynamicFailure = text => ({success: false, contentItems: [{type: 'inputText', text}]});
const resultText = value => ({success: true, contentItems: [{type: 'inputText', text: value}]});

export async function createCodexRemoteTools({cwd, permission, toolPolicy, mcpSourcePath, mcpRevision, codexPath, codexHome, spawnImpl,signal,
  readCatalogImpl = readCodexMcpCatalog, createMcpProxyImpl = createCodexMcpProxy} = {}) {
  const policy = normalizeRemoteToolPolicy(toolPolicy), root = realpathSync(cwd), commands = new Map(),files=createCodexRemoteFiles({cwd:root}); let mcp, closed = false;
  const specs = files.specs.map(spec=>({type:'function',...spec}));
  if (policy.shell) specs.push({type: 'function', name: 'qq_shell', description: 'Run a shell command inside this project. Each complete command requires a fresh one-time approval in QQ. Network and file permissions remain restricted.', inputSchema: {type: 'object', properties: {command: {type: 'string'}, cwd: {type: 'string'}, timeoutMs: {type: 'integer', minimum: 1000, maximum: 120000}}, required: ['command'], additionalProperties: false}});
  if (policy.mcp) {
    const catalog = await readCatalogImpl({codexPath, codexHome, cwd: root, sourcePath: mcpSourcePath});
    if (catalog.state !== 'ready' || !mcpRevision || catalog.revision !== mcpRevision || policy.mcpServerIds.some(id => !catalog.servers.some(server => server.id === id))) fail('mcp_source_changed');
    if(signal?.aborted)fail('tool_initialization_cancelled');
    mcp = await createMcpProxyImpl({catalog, selectedIds: policy.mcpServerIds, cwd: root, codexPath, codexHome, spawnImpl,signal});
    if(signal?.aborted){await mcp.close();fail('tool_initialization_cancelled');}specs.push(...mcp.specs);
  }
  function prepare(name, input) {
    if (closed || !object(input)) fail('tool_unavailable');
    const file=files.prepare(name,input);if(file)return file;
    if (name === 'qq_shell') {
      if (!policy.shell || Object.keys(input).some(key => !['command', 'cwd', 'timeoutMs'].includes(key)) || !reviewable(input.command) || !input.command.trim()) fail('tool_not_authorized');
      let directory; try {directory = realpathSync(input.cwd ? resolve(root, input.cwd) : root);} catch {fail('invalid_tool_directory');}
      if (!within(root, directory) || !statSync(directory).isDirectory()) fail('invalid_tool_directory');
      const timeoutMs = input.timeoutMs ?? 60000; if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) fail('invalid_tool_arguments');
      const summary = 'Command / 命令：\n' + input.command + '\nDirectory / 目录：' + directory + '\nTimeout / 超时：' + timeoutMs + 'ms'; if (!reviewable(summary)) fail('local_review_required');
      return {kind: 'command', summary, name, input: {command: input.command, cwd: directory, timeoutMs}};
    }
    const metadata = policy.mcp && mcp?.describe(name); if (!metadata) fail('tool_not_authorized');
    let encoded; try {encoded = JSON.stringify(input);} catch {fail('invalid_tool_arguments');}
    const summary = 'MCP: ' + metadata.server + '\nTool / 工具：' + metadata.tool + '\nArguments / 参数：\n' + encoded;
    if (!reviewable(summary)) fail('local_review_required');
    return {kind: 'mcp', summary, name, input: structuredClone(input)};
  }
  async function execute(call, request, run) {
    if (closed || run.cancelRequested) return dynamicFailure('Tool call cancelled.');
    if(call.kind==='read')return files.execute(call);
    if (call.kind === 'mcp') {
      const output = await mcp.call(call.name, call.input); if (closed || run.cancelRequested) return dynamicFailure('Tool call cancelled.');
      const text = (Array.isArray(output?.content) ? output.content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n') : '') || (output?.structuredContent ? JSON.stringify(output.structuredContent) : 'MCP call returned no text content.');
      if (text.length > 64000) return dynamicFailure('MCP output exceeded the remote limit.');
      return {success: output?.isError !== true, contentItems: [{type: 'inputText', text}]};
    }
    // 手机确认期间目录可能被替换为junction；实际提交前再次验证同一个项目与工作目录。
    try{if(realpathSync(root)!==root||realpathSync(call.input.cwd)!==call.input.cwd||!within(root,call.input.cwd)||!statSync(call.input.cwd).isDirectory())fail('invalid_tool_directory');}catch{fail('invalid_tool_directory');}
    const id = 'qq-shell-' + randomUUID(), shell = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : '/bin/sh';
    const command = process.platform === 'win32' ? [shell, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', call.input.command] : [shell, '-c', call.input.command];
    commands.set(id, {request, run});
    try {
      const env = Object.fromEntries(Object.keys(process.env).filter(key => /(?:TOKEN|KEY|AUTH|PASS|SECRET)|^(?:CODEX|DSH|WORKBUDDY)_/i.test(key)).map(key => [key, null]));
      // 当前Windows沙箱不接受自定义outputBytesCap；保留原生默认限额及外层协议帧上限。
      const output = await request('command/exec', {command, cwd: call.input.cwd, permissionProfile: permission === 'workspace-write' ? ':workspace' : ':read-only', processId: id, timeoutMs: call.input.timeoutMs, ...(process.platform === 'win32' ? {} : {outputBytesCap: 32000}), tty: false, streamStdin: false, streamStdoutStderr: false, env}, call.input.timeoutMs + 5000);
      if (closed || run.cancelRequested) return dynamicFailure('Command cancelled.');
      const stdout = typeof output?.stdout === 'string' ? output.stdout : '', stderr = typeof output?.stderr === 'string' ? output.stderr : '';
      return resultText('Exit code: ' + String(output?.exitCode ?? 'unknown') + '\n' + (stdout + (stderr ? '\n' + stderr : '')).slice(0, 64000));
    } finally {commands.delete(id);}
  }
  async function cancel(run) {
    const active = [...commands].filter(([, item]) => !run || item.run === run);
    await Promise.allSettled(active.map(([processId, item]) => item.request('command/exec/terminate', {processId})));
    if (mcp) {const owned = mcp; mcp = null; await owned.close();}
  }
  async function close() {if (closed) return; closed = true; await cancel();}
  return {specs, prepare, execute, cancel, close};
}
