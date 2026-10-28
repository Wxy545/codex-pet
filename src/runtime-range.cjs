'use strict';
// 移植 dsh-pet / PC2005-cloud 的单段 Range 语义：
// https://github.com/PC2005-cloud/dsh-pet/commit/48642698ee73ecf2029ea85a2e8f76f562b710e5
// 上游代码 MIT，Copyright (c) 2026 PC2005-cloud；完整许可保留在 THIRD_PARTY_NOTICES.md。
const { open, fstat, close, createReadStream } = require('node:fs');

function parseRange(header, totalBytes) {
  if (!header || totalBytes <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0
      ? { start: Math.max(0, totalBytes - suffix), end: totalBytes - 1 } : null;
  }
  const start = Number(match[1]), end = match[2] ? Number(match[2]) : totalBytes - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  if (start > end || start >= totalBytes) return 'unsatisfiable';
  return { start, end: Math.min(end, totalBytes - 1) };
}

function rangeHeaders(decision, totalBytes, headers) {
  const result = { ...headers, 'accept-ranges': 'bytes' };
  if (decision === 'unsatisfiable') return { ...result, 'content-range': `bytes */${totalBytes}`, 'content-length': '0' };
  if (decision) return { ...result, 'content-range': `bytes ${decision.start}-${decision.end}/${totalBytes}`, 'content-length': String(decision.end - decision.start + 1) };
  return { ...result, 'content-length': String(totalBytes) };
}

function bridgeResponse(data, header, headers, status = 200) {
  const decision = parseRange(header, data.length);
  const body = decision === 'unsatisfiable' ? null : decision ? data.subarray(decision.start, decision.end + 1) : data;
  return new Response(body === null ? null : new Uint8Array(body), {
    status: decision === 'unsatisfiable' ? 416 : decision ? 206 : status,
    headers: rangeHeaders(decision, data.length, headers),
  });
}

/** 路由已验证的文件路径照旧传入；只改变应答区间，不新增任何路径解析或访问入口。 */
function sendFile(req, res, file, contentType) {
  let stream;
  res.once('close', () => stream?.destroy());
  open(file, 'r', (error, fd) => {
    if (error) { res.destroy(); return; }
    const release = () => close(fd, () => {});
    if (res.destroyed || res.writableEnded) { release(); return; }
    fstat(fd, (statError, stat) => {
      if (res.destroyed || res.writableEnded) { release(); return; }
      if (statError) { release(); res.destroy(); return; }
      const decision = parseRange(req.headers.range, stat.size);
      const headers = rangeHeaders(decision, stat.size, { 'content-type': contentType, 'cache-control': 'public, max-age=3600' });
      if (decision === 'unsatisfiable') { release(); res.writeHead(416, headers); res.end(); return; }
      // 长度与实际读取共用同一个 fd，避免先stat再重开文件期间被覆盖后应答挂起。
      stream = createReadStream(file, { fd, autoClose: true, ...(decision || {}) });
      stream.once('error', () => res.destroy());
      res.writeHead(decision ? 206 : 200, headers);
      stream.pipe(res);
    });
  });
}

module.exports = { parseRange, bridgeResponse, sendFile };
