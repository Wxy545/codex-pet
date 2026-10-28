// 固定0.3.8上的小范围移植；原项目版权和许可保留在THIRD_PARTY_NOTICES.md。
// 来源：PC2005-cloud/dsh-pet 的4864269（Range）、86181ce（负距离走位）、e0c5f97（独立菜单）。
function replaceOne(source, before, after, label) {
  const oldCount = source.split(before).length - 1, newCount = source.split(after).length - 1;
  if (oldCount === 0 && newCount === 1) return source;
  if (oldCount !== 1 || newCount !== 0) throw new Error(`${label}上游修复锚点不匹配。`);
  return source.replace(before, after);
}

const oldSendFile = `function sendFile(res, file, contentType) {
\tconst stream = createReadStream(file);
\tstream.once("open", (fd) => {
\t\tif (res.destroyed || res.writableEnded) {
\t\t\tstream.destroy();
\t\t\treturn;
\t\t}
\t\ttry {
\t\t\tres.writeHead(200, {
\t\t\t\t"content-type": contentType,
\t\t\t\t"content-length": fstatSync(fd).size,
\t\t\t\t"cache-control": "public, max-age=3600"
\t\t\t});
\t\t} catch {
\t\t\tres.writeHead(200, {
\t\t\t\t"content-type": contentType,
\t\t\t\t"cache-control": "public, max-age=3600"
\t\t\t});
\t\t}
\t\tstream.pipe(res);
\t});
\tstream.on("error", () => res.destroy());
\tres.on("close", () => stream.destroy());
}`;
const newSendFile = `function sendFile(req, res, file, contentType) {
\treturn CodexRuntimeRange.sendFile(req, res, file, contentType);
}`;
const rangeImport = 'import CodexRuntimeRange from "../runtime/electron-helper/runtime-range.cjs";\n';

export function patchHostAssets(source) {
  source = replaceOne(source, oldSendFile, newSendFile, 'HTTP素材Range');
  source = replaceOne(source, 'else sendFile(res, result.file, result.contentType);', 'else sendFile(req, res, result.file, result.contentType);', 'HTTP素材请求');
  const imports = source.split(rangeImport).length - 1;
  if (imports > 1) throw new Error('HTTP素材Range导入重复。');
  return imports === 1 ? source : source.replace(/^(#![^\n]*\n)?/, '$1' + rangeImport);
}

export function patchBridgeAssets(source) {
  return replaceOne(source,
    'return new Response(new Uint8Array(data), { status: resp.status || 200, headers });',
    "return require('./runtime-range.cjs').bridgeResponse(data, request.headers.get('range'), headers, resp.status || 200);",
    'Electron素材Range');
}

export function patchDesktopMotion(source) {
  source = replaceOne(source,
    'const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;',
    'const { startRatio, startYRatio, targetRatio, leadSec, tailSec } = pm;', '走位参数');
  source = replaceOne(source,
    'else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);',
    'else ratioX = startRatio + (targetRatio - startRatio) * ((t - leadSec) / travelWindow);', '负距离走位');
  return replaceOne(source,
    "label: OPEN_TARGET === 'desktop' ? '打开软件' : '打开网站',",
    "label: OPEN_TARGET === 'desktop' ? '打开软件' : '打开 AI 设置',", '独立模式设置菜单');
}
