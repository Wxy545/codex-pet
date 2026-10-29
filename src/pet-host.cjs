'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const HOSTS = Object.freeze(['codex', 'workbuddy']);
const validHost = value => HOSTS.includes(value);

/** 宿主选择与角色选择独立；切换应用不覆盖人设、素材或各自账号配置。 */
function readHost(dataRoot, fallback = process.env.CODEX_PET_HOST) {
  if (typeof dataRoot === 'string' && path.isAbsolute(dataRoot)) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(dataRoot, 'host.json'), 'utf8').replace(/^\uFEFF/, ''));
      if (saved.schemaVersion === 1 && validHost(saved.host)) return saved.host;
    } catch { /* 首次安装没有选择时沿用Codex；不从进程是否存在猜测用户选择。 */ }
  }
  return validHost(fallback) ? fallback : 'codex';
}
function writeHost(dataRoot, host) {
  if (!path.isAbsolute(dataRoot) || !validHost(host)) throw new Error('invalid-pet-host');
  const file = path.join(dataRoot, 'host.json');
  for (const target of [dataRoot, file]) {
    try { if (fs.lstatSync(target).isSymbolicLink()) throw new Error('linked-pet-host-path'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  fs.mkdirSync(dataRoot, {recursive: true});
  const temporary = file + '.tmp-' + randomUUID();
  try {
    fs.writeFileSync(temporary, JSON.stringify({schemaVersion: 1, host}, null, 2) + '\n', {flag: 'wx'});
    fs.renameSync(temporary, file);
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return publicHost(host);
}
function publicHost(host) {
  if (!validHost(host)) throw new Error('invalid-pet-host');
  const codex = host === 'codex';
  return {schemaVersion: 1, host, label: codex ? 'Codex' : 'WorkBuddy', capabilities: {
    events: true, chat: codex, images: codex, tasks: codex, quota: codex, chatter: codex,
  }};
}

/** 没有证实的账号能力保持关闭；不读取旧AI密钥，不把WorkBuddy请求转给Codex。 */
function unavailableAi() {
  const settings = {protocol: 'openai-compatible', baseUrl: '', model: '', hasKey: false,
    enabled: false, automaticWhispers: false, whisperIntervalSec: 600, timeoutMs: 60000, maxTokens: 1024};
  return {
    currentSelection: () => ({provider: 'standalone', model: ''}), listProviders: () => [],
    listModels: async () => [], resolveModelInfo: async () => undefined,
    isReady: () => false, canWhisper: () => false, getSettings: () => ({...settings}),
    async *stream() { throw new Error('host-chat-unavailable'); },
    async saveSettings() { throw new Error('host-chat-unavailable'); },
    async testConnection() { return {ok: false, message: 'WorkBuddy chat is unavailable.'}; },
    dispose() {},
  };
}
module.exports = {HOSTS, validHost, readHost, writeHost, publicHost, unavailableAi};
