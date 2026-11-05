const count = (source, text) => source.split(text).length - 1;
function requireOnce(source, text) {
  if (count(source, text) !== 1) throw Error('harness-modular-runtime-anchor-mismatch');
}

/** 已核验的0.4.0/0.4.1/0.4.3保留原生目标插值，不覆盖成旧版整份实现。 */
export function validateModularMotion(input, { browser = false } = {}) {
  const source = input.replaceAll('\r\n', '\n');
  requireOnce(source, browser
    ? 'else ratioX = move.startRatio + (move.targetRatio - move.startRatio) * ((t - move.leadSec) / travelWindow);'
    : 'else ratioX = startRatio + (targetRatio - startRatio) * ((t - leadSec) / travelWindow);');
  if (!browser) requireOnce(source, 'const { startRatio, startYRatio, targetRatio, leadSec, tailSec } = pm;');
  return input;
}

/** 原生兜底已有统一收尾，仅补左右键组合时松左键的漏收，不改变新拖拽驱动。 */
export function patchModularMouseRelease(input) {
  let source = input.replaceAll('\r\n', '\n');
  for (const anchor of ['function createDrag(card) {', 'const endPress = (c, point) => {\n\t\tclearMouseFallback();', 'dispose: clearMouseFallback']) requireOnce(source, anchor);
  const before = 'if (!hit || e.button !== 0 || e.buttons !== 0) return;';
  const after = 'if (!hit || (e.buttons & 1) !== 0) return; // codex-pet-mouse-buttons-v2';
  if (count(source, after) === 1 && count(source, before) === 0) return source;
  requireOnce(source, before);
  return source.replace(before, after);
}

/** 失败仍沿用上游 DPI 退化策略；锚点变化时停止而不是猜测缩放行为。 */
export function validateModularDpi(input) {
  const source = input.replaceAll('\r\n', '\n');
  for (const anchor of ["app.commandLine.appendSwitch('force-device-scale-factor', String(forced));", 'PRIMARY_SCALE = readCachedPrimaryScale() || probePrimaryScale();', 'PRIMARY_SCALE = 0;\n      FORCED_SCALE = 0;']) requireOnce(source, anchor);
  if (!/try\s*\{\s*PRIMARY_SCALE = readCachedPrimaryScale\(\) \|\| probePrimaryScale\(\);[\s\S]*?catch \(error\)/.test(source)) throw Error('harness-modular-runtime-anchor-mismatch');
  return input;
}

const PROBE_BEFORE = `function tryPrepareDir(dir, fileSystem) {
  try {
    fileSystem.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, PROBE_NAME);
    fileSystem.writeFileSync(probe, '');
    fileSystem.unlinkSync(probe);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}`;
const PROBE_AFTER = `function tryPrepareDir(dir, fileSystem) {
  // codex-pet-user-data-probe-v2：独占创建，仅删除本次拥有的探测文件。
  let fd, probe, owned = false, error = null;
  try {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw Error('absolute-profile-required');
    fileSystem.mkdirSync(dir, { recursive: true });
    probe = path.join(dir, PROBE_NAME + '-' + require('node:crypto').randomUUID());
    fd = fileSystem.openSync(probe, 'wx', 0o600);
    owned = true;
    fileSystem.writeFileSync(fd, '1');
  } catch (value) { error = value; }
  finally {
    if (fd !== undefined) try { fileSystem.closeSync(fd); } catch (value) { error ||= value; }
    if (owned) try { fileSystem.unlinkSync(probe); } catch (value) { error ||= value; }
  }
  return { ok: error === null, error };
}`;

export function patchModularUserData(input) {
  let source = input.replaceAll('\r\n', '\n');
  requireOnce(source, "const fallbackDir = path.join(input.dshHome, 'dsh-pet', input.appMode ? 'app-profile' : 'electron-profile');");
  if (count(source, PROBE_AFTER) === 1 && count(source, PROBE_BEFORE) === 0) return source;
  requireOnce(source, PROBE_BEFORE);
  return source.replace(PROBE_BEFORE, PROBE_AFTER);
}

const MAIN_DECISION_BEFORE = "const userDataDecision = resolveUserDataDir({\n  currentDir: app.getPath('userData'),\n  dshHome: dshHomeDir(),\n  appMode: APP_MODE,\n});";
const MAIN_DECISION_AFTER = "const userDataDecision = resolveUserDataDir({\n  // codex-pet-user-data-get-path-v2：原目录查询失败仍交给原生私有目录回退。\n  currentDir: (() => { try { return app.getPath('userData'); } catch { return null; } })(),\n  dshHome: dshHomeDir(),\n  appMode: APP_MODE,\n});";
export function validateModularMain(input) {
  const source = input.replaceAll('\r\n', '\n');
  for (const anchor of ["require('./main/dpi.js')", "require('./main/user-data.js')"]) requireOnce(source, anchor);
  if (count(source, MAIN_DECISION_BEFORE) + count(source, MAIN_DECISION_AFTER) !== 1) throw Error('harness-modular-runtime-anchor-mismatch');
  return input;
}

export function patchModularMain(input) {
  const source = validateModularMain(input).replaceAll('\r\n', '\n');
  if (count(source, MAIN_DECISION_AFTER) === 1) return source;
  return source.replace(MAIN_DECISION_BEFORE, MAIN_DECISION_AFTER);
}

/** helper 崩溃时维持沙箱，不将上游新增的自动降级带进两种宿主。 */
export function patchModularSandbox(input) {
  let source = input.replaceAll('\r\n', '\n');
  const replacements = [[`function shouldFallbackToNoSandbox(input) {
\tif (input.alreadyApplied || input.customCommand || input.sandboxOptOut) return false;
\tif (input.code === null || input.code >>> 0 !== SANDBOX_INIT_FAILED_CODE) return false;
\tif (input.sawOutput) return false;
\treturn input.ranMs < SANDBOX_FALLBACK_WINDOW_MS;
}`, `function shouldFallbackToNoSandbox(input) {
\t// Codex Pet 保留 Chromium 沙箱，崩溃不能成为自动降级理由。
\tvoid input;
\treturn false;
}`], ['return opts.sandboxFallback && !opts.customCommand ? ["--no-sandbox", ...baseArgs] : [...baseArgs];', 'void opts; // codex-pet-no-sandbox-downgrade-v1\n\treturn [...baseArgs];']];
  for (const [before, after] of replacements) {
    if (count(source, after) === 1 && count(source, before) === 0) continue;
    requireOnce(source, before);
    if (count(source, after) !== 0) throw Error('harness-modular-runtime-anchor-mismatch');
    source = source.replace(before, after);
  }
  return source;
}

/** 0.4.3把元数据统一收口到switchTo；once仍表示单次，不能与el.loop同向。 */
export function patchModularPlayback043(input) {
  const source=input.replaceAll('\r\n','\n');
  for(const anchor of ['  switchTo(next, nextOnce, playbackId, url) {','    this.anim = next;','    el.onended = nextOnce ? () => this.handleEnded() : () => this.restartLoop(el);','  restartLoop(el) {\n    el.currentTime = 0;\n    void el.play().catch(() => {});'])requireOnce(source,anchor);
  const before='    this.once = !nextOnce;',after='    this.once = nextOnce; // codex-pet-once-contract-043';
  if(count(source,after)===1&&count(source,before)===0)return source;
  requireOnce(source,before);if(count(source,after)!==0)throw Error('harness-modular-runtime-anchor-mismatch');
  return source.replace(before,after);
}

/** 0.4.3已原生包含三项main修复，必须核对实际代码，不能再叠041替换。 */
export function validateModularClient043(input) {
  const source=input.replaceAll('\r\n','\n');
  for(const anchor of [
    'function petStageStyle(bottomPad) {\n\treturn { transform: "translateY(" + bottomPad + "px)" };\n}',
    'const ALPHA_FIX_ID = "dsh-pet-alpha-fix";',
    'func.setAttribute("intercept", "-0.0039215686");',
    'card.facingRef.current = next;\n\t\t\t\tpickNext();',
    'workStatus: workOn ? workStatus : null,','workStatusTick: workOn ? workStatusTick : 0,',
  ])requireOnce(source,anchor);
  if(source.includes('stageEl.style.transform = "none"'))throw Error('harness-modular-runtime-anchor-mismatch');
  return input;
}

/** 新窗口落位模块是所有平台共用装配，Windows也须完整加载并保留winOffset。 */
export function validateModularHelper043(files) {
  const read=name=>{if(typeof files?.[name]!=='string')throw Error('harness-modular-runtime-anchor-mismatch');return files[name].replaceAll('\r\n','\n');};
  const html=read('index.html'),sprite=read('sprite.js'),input=read('sprite/input.js'),fit=read('sprite/window-fit.js');
  const scripts=['<script src="./sprite.js"></script>','<script src="./sprite/window-fit.js"></script>','<script src="./sprite/init.js"></script>'];
  scripts.forEach(anchor=>requireOnce(html,anchor));
  if(!(html.indexOf(scripts[0])<html.indexOf(scripts[1])&&html.indexOf(scripts[1])<html.indexOf(scripts[2])))throw Error('harness-modular-runtime-anchor-mismatch');
  for(const anchor of ['filter: url(#dsh-pet-alpha-fix);','<filter id="dsh-pet-alpha-fix">','<feFuncA type="linear" slope="1" intercept="-0.0039215686" />'])requireOnce(html,anchor);
  for(const anchor of ['this.winOffset = { x: this.margin.l, y: this.margin.t };','const fit = this.fitWindow();','this.reportWindow(fit);'])requireOnce(sprite,anchor);
  for(const anchor of ['const px = e.clientX - this.winOffset.x;','const py = e.clientY - this.winOffset.y;'])requireOnce(input,anchor);
  if(input.includes("this.stage.style.transform = 'none'"))throw Error('harness-modular-runtime-anchor-mismatch');
  for(const anchor of ['  fitWindow() {','  reportWindow(fit) {','const area = CONFIG.isWindowClampedToWorkArea','const fit = S.fitWindowInArea({','this.applyWinOffset(fit.offsetX, fit.offsetY);'])requireOnce(fit,anchor);
  patchModularPlayback043(read('sprite/playback.js'));
  return files;
}
