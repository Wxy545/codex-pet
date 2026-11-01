'use strict';

const PATHS = new Map([
  ['/dsh-pet-7340/config/editable', new Set(['GET'])],
  ['/dsh-pet-7340/config', new Set(['PUT'])],
  ['/dsh-pet-7340/reload', new Set(['POST'])],
  ['/dsh-pet-7340/control-resume', new Set(['POST'])],
  ['/standalone-ai/settings', new Set(['GET', 'POST'])],
  ['/dsh-pet-7340/pet-host', new Set(['GET', 'POST'])],
  ['/dsh-pet-7340/pet-host/presentation', new Set(['POST'])],
  ['/dsh-pet-7340/qq-remote', new Set(['GET', 'POST'])],
  ['/dsh-pet-7340/codex-character', new Set(['GET'])],
  ['/dsh-pet-7340/codex-chat', new Set(['POST'])],
  ['/dsh-pet-7340/codex-tasks', new Set(['GET', 'POST'])],
  ['/dsh-pet-7340/codex-tasks/cancel', new Set(['POST'])],
  ['/dsh-pet-7340/codex-startup/pending', new Set(['POST'])],
  ['/dsh-pet-7340/pet-workspace/tasks', new Set(['GET', 'POST'])],
  ['/dsh-pet-7340/pet-memory/scopes', new Set(['GET'])],
  ['/dsh-pet-7340/pet-memory', new Set(['POST'])],
  ['/dsh-pet-7340/pet-memory/export', new Set(['POST'])],
  ['/dsh-pet-7340/pet-model-policy', new Set(['GET', 'POST'])],
  ['/dsh-pet-7340/pet-role/settings', new Set(['GET', 'POST'])],
  ['/dsh-pet-7340/pet-content', new Set(['GET', 'POST'])],
  ['/dsh-pet-7340/international-chat', new Set(['GET', 'POST'])],
  ['/dsh-pet-7340/pet-local-control', new Set(['POST'])],
]);

// 仅固定写入口的已知动作有执行预算：原生profile最长两段180秒，记忆模型120秒。
// 其它动作和读取仍为10秒，前端不能传入超时、完整URL或查询参数扩大范围。
const ACTION_TIMEOUTS = new Map([
  ['/dsh-pet-7340/qq-remote', new Map([['save',400000],['napcat-login',80000],['mcp-catalog',20000]])],
  ['/dsh-pet-7340/international-chat', new Map([['save',200000],['disable',200000],['remove',200000],['mcp-catalog',20000]])],
  ['/dsh-pet-7340/pet-memory', new Map([['summarize',130000]])],
  ['/dsh-pet-7340/pet-model-policy', new Map([['catalog',35000],['save',35000]])],
  ['/dsh-pet-7340/pet-content', new Map([['broadcast-voices',100000],['broadcast-prepare',110000],['save-profile',35000],['source-catalog',20000]])],
  ['/dsh-pet-7340/pet-workspace/tasks', new Map([['cancel',20000]])],
]);
function requestTimeout(method,route,body){
  if(method!=='POST')return 10000;
  if(route==='/dsh-pet-7340/codex-chat')return 130000;
  const actions=ACTION_TIMEOUTS.get(route);if(!actions||typeof body!=='string')return 10000;
  try{const value=JSON.parse(body);return value&&typeof value==='object'&&!Array.isArray(value)?actions.get(value.action)||10000:10000;}catch{return 10000;}
}

/** 新面板走带能力令牌的本机HTTP；上游stdin bridge只认识原版路由。 */
function createHostRequest({ baseUrl = process.env.CODEX_PET_API_URL, token = process.env.CODEX_PET_API_TOKEN, fetchImpl = fetch } = {}) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('invalid local endpoint');
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('invalid local capability');
  return async (method, route, body) => {
    if (!PATHS.get(route)?.has(method) || (body !== undefined && (typeof body !== 'string' || Buffer.byteLength(body) > 17 * 1024 * 1024))) throw new Error('unsupported local request');
    const response = await fetchImpl(new URL(route, base), {
      method, body, redirect: 'error', signal: AbortSignal.timeout(requestTimeout(method,route,body)),
      headers: { 'x-dsh-pet-token': token, ...((route==='/dsh-pet-7340/config'&&method==='PUT'||route==='/dsh-pet-7340/reload'&&method==='POST')?{'x-codex-pet-control':'1'}:{}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    });
    return { status: response.status, body: await response.text() };
  };
}

module.exports = { createHostRequest };
