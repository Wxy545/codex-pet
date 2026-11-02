'use strict';

const MAX_BODY_BYTES = 128 * 1024;
const PATHS = new Map([
  ['/shutdown', new Set(['POST'])],
  ['/dsh-pet-7340/pet-host', new Set(['GET', 'POST'])],
  ['/dsh-pet-7340/pet-size', new Set(['POST'])],
  ['/dsh-pet-7340/codex-startup/pending', new Set(['POST'])],
]);

/** 新面板走带能力令牌的本机HTTP；上游stdin bridge只认识原版路由。 */
function createHostRequest({ baseUrl = process.env.CODEX_PET_API_URL, token = process.env.CODEX_PET_API_TOKEN, fetchImpl = fetch } = {}) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('invalid local endpoint');
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('invalid local capability');
  return async (method, route, body) => {
    if (!PATHS.get(route)?.has(method) || (body !== undefined && (typeof body !== 'string' || Buffer.byteLength(body) > MAX_BODY_BYTES))) throw new Error('unsupported local request');
    const response = await fetchImpl(new URL(route, base), {
      method, body, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'x-dsh-pet-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    });
    return { status: response.status, body: await response.text() };
  };
}

module.exports = { createHostRequest };
