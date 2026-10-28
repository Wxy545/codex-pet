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

export function patchDesktopBalanceEvents(source) {
  // 成功恢复会结束一轮故障；下次同类失败仍应告知，连续失败继续沿用shared去重。
  return replaceOne(source,
    'if (hit.state.ok) {\n    balanceTick++;',
    'if (hit.state.ok) {\n    balanceNoticeKey = S.decideBalanceNotice(hit.state, balanceNoticeKey, hit.manual).key;\n    balanceTick++;',
    '额度恢复后故障通知');
}

const frozenWorkBefore = `  this.prevWorkTick = tick;
  // 占用锁（issue #122 第 4 项）：锁生效时不响应工作状态——它是**自动**来源（任务事件驱动），
  // 没有"用户手动要"这条路。判在 tick 消费**之后**：占用期间的变化当过去了，解冻时由
  // applyFreeze 的 resumeWorkStatusAnim() 重新对齐**当前**状态，所以不会停在旧档位上。
  // 宿主侧不挡这个全局段：sections.workStatus 是所有宠物共用一份，宿主"跳过写入"会连带静音
  // 别的宠物（issue #122 要的是"只控制指定 main"），所以按宠物在渲染端忽略。
  if (this.frozen) return;`;
const frozenWorkAfter = `  // 冻结只保留最新未应用快照，不切动画或气泡；真实tick留给解冻时应用。
  if (this.frozen) {
    this.codexPendingWorkSnapshot = { snapshot: { state: snapshot?.state || null, task: snapshot?.task || null }, tick };
    return;
  }
  this.prevWorkTick = tick;`;
export function patchDesktopWorkEvents(source) {
  return replaceOne(source, frozenWorkBefore, frozenWorkAfter, '冻结工作快照');
}
export function patchDesktopWorkResume(source) {
  return replaceOne(source,
    '    // 播完由 handleEnded 接回随机链（与浏览器同一语义）。\n    if (this.resumeWorkStatusAnim()) return;\n    if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));\n  }',
    `    // 播完由 handleEnded 接回随机链（与浏览器同一语义）。
    const pendingWork = this.codexPendingWorkSnapshot;
    this.codexPendingWorkSnapshot = null;
    if (pendingWork && this.pet.workStatusEnabled) {
      const ongoing = ['thinking', 'working', 'result', 'waiting'].includes(pendingWork.snapshot.state);
      // 只恢复最新进行中状态；冻结期间的完成/出错不补播，清旧气泡后走原待机链。
      this.onWorkTick(ongoing ? pendingWork.snapshot : { state: null, task: null }, pendingWork.tick);
      if (ongoing) return;
    }
    if (this.resumeWorkStatusAnim()) return;
    if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));
  }`, '解冻工作状态恢复');
}
