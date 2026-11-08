import {createHash} from 'node:crypto';

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

const ELECTRON_RESOLVER_043 = `function resolveElectronPath(candidates = []) {
\tconst seen = new Set();
\tconst list = [];
\tconst push = (value) => {
\t\tif (!value || seen.has(value)) return;
\t\tseen.add(value);
\t\tlist.push(value);
\t};
\tfor (const value of candidates) push(value);
\tif (process.env.DSH_PET_ELECTRON_PATH) push(process.env.DSH_PET_ELECTRON_PATH);
\ttry {
\t\tconst resolved = require("electron");
\t\tif (typeof resolved === "string" && resolved) push(resolved);
\t} catch {}
\tpush(defaultElectronExe());
\treturn list.find(isNonEmptyFile);
}`;
const ELECTRON_OWNED_043=ELECTRON_RESOLVER_043.replace(`\ttry {
\t\tconst resolved = require("electron");
\t\tif (typeof resolved === "string" && resolved) push(resolved);
\t} catch {}`, '\t// codex-pet-owned-electron-043：不借宿主npm依赖；显式候选、环境配置和自有下载位置保留。');

const ALPHA_FILTER_043 = `function ensureAlphaFilter() {
\tif (document.querySelector("svg[data-dsh-pet-alpha-fix]") !== null) return;
\tconst NS$1 = "http://www.w3.org/2000/svg";
\tconst svg = document.createElementNS(NS$1, "svg");
\tsvg.setAttribute("width", "0");
\tsvg.setAttribute("height", "0");
\tsvg.setAttribute("aria-hidden", "true");
\tsvg.setAttribute("data-dsh-pet-alpha-fix", "");
\tconst defs = document.createElementNS(NS$1, "defs");
\tconst filter = document.createElementNS(NS$1, "filter");
\tfilter.id = ALPHA_FIX_ID;
\tconst transfer = document.createElementNS(NS$1, "feComponentTransfer");
\tconst func = document.createElementNS(NS$1, "feFuncA");
\tfunc.setAttribute("type", "linear");
\tfunc.setAttribute("slope", "1");
\tfunc.setAttribute("intercept", "-0.0039215686");
\ttransfer.appendChild(func);
\tfilter.appendChild(transfer);
\tdefs.appendChild(filter);
\tsvg.appendChild(defs);
\tdocument.body.appendChild(svg);
}`;
const ALPHA_LAYOUT_043=ALPHA_FILTER_043.replace('\tsvg.setAttribute("data-dsh-pet-alpha-fix", "");', '\tsvg.setAttribute("data-dsh-pet-alpha-fix", "");\n\tsvg.style.position = "absolute"; // codex-pet-alpha-layout-043：留在同文档，不参与宿主行内流。');

function replaceKnown043(input,before,after){
  if(typeof input!=='string')throw Error('harness-modular-runtime-anchor-mismatch: 0.4.3上游修复锚点不匹配。');
  const source=input.replaceAll('\r\n','\n'),old=count(source,before),current=count(source,after);
  if(count(source,before.slice(0,before.indexOf('\n')))!==1)throw Error('harness-modular-runtime-anchor-mismatch: 0.4.3上游修复锚点不匹配。');
  if(old===0&&current===1)return source;
  if(old!==1||current!==0)throw Error('harness-modular-runtime-anchor-mismatch: 0.4.3上游修复锚点不匹配。');
  return source.replace(before,after);
}

/** 择取31ed1b31：只移除自动借用宿主npm包，下载、显式覆盖及沙箱决策不改。 */
export function patchModularOwnedElectron043(input){return replaceKnown043(input,ELECTRON_RESOLVER_043,ELECTRON_OWNED_043);}

/** 择取cf0aec77：零尺寸滤镜仍可按同文档ID解析，同时不再撑高Harness网页。 */
export function patchModularAlphaLayout043(input){return replaceKnown043(input,ALPHA_FILTER_043,ALPHA_LAYOUT_043);}

const ELECTRON_OWNED_045=ELECTRON_RESOLVER_043.replace(`\ttry {
\t\tconst resolved = require("electron");
\t\tif (typeof resolved === "string" && resolved) push(resolved);
\t} catch {}\n`, '');
const ALPHA_LAYOUT_045=ALPHA_FILTER_043.replaceAll('NS$1','NS$2').replace('\tsvg.setAttribute("data-dsh-pet-alpha-fix", "");', '\tsvg.setAttribute("data-dsh-pet-alpha-fix", "");\n\tsvg.style.position = "absolute";');

/** 0.4.5 已原生只用自有 Electron；完整核对原函数，不叠加 043 的替换标记。 */
export function validateModularOwnedElectron045(input){
  if(typeof input!=='string')throw Error('harness-modular-runtime-anchor-mismatch');
  const source=input.replaceAll('\r\n','\n');
  requireOnce(source,'function resolveElectronPath(candidates = []) {');
  requireOnce(source,ELECTRON_OWNED_045);
  return input;
}

/** 0.4.5 原生滤镜已脱离页面行内流；同时核对原透明、转向和工作状态契约。 */
export function validateModularAlphaLayout045(input){
  if(typeof input!=='string')throw Error('harness-modular-runtime-anchor-mismatch');
  const source=validateModularClient043(input).replaceAll('\r\n','\n');
  requireOnce(source,'function ensureAlphaFilter() {');
  requireOnce(source,ALPHA_LAYOUT_045);
  return input;
}

// 官方 0.4.6 tar 经 SHA512 核验；这里只核对实际原生函数，不复制旧模块或恢复生产源码。
const NATIVE_HELPER_BLOCKS_046 = [
  {
    "file": "sprite.js",
    "start": "  relayout(prevView) {",
    "end": "\n  }",
    "sha256": "dcf779ea394548a518e6a4e4be0897dded1914ee36befa06397dc1be51c4347f"
  },
  {
    "file": "sprite/window-fit.js",
    "start": "  reportWindow(fit) {",
    "end": "\n  },",
    "sha256": "4626732d25b6a65caefdd3ae14d7c670a0cc710b6210f25a6322d7eb3962e8fd"
  },
  {
    "file": "main/windows.js",
    "start": "  function broadcastPetStates() {",
    "end": "\n  }",
    "sha256": "23ad730af6fbaa54667abad07af691f7f5e3f2f2ad86afe1adeb1ae2fcca66e2"
  },
  {
    "file": "main/windows.js",
    "start": "  function updatePetState(petId, partial) {",
    "end": "\n  }",
    "sha256": "10ef6675cad258a4501ac255e795b99593d689a1f424c6392a55a8d40580c1c3"
  },
  {
    "file": "main/windows.js",
    "start": "    win.on('closed', () => {",
    "end": "\n    });",
    "sha256": "6a9e151a34e05828ae8fdf850980e7d8cc906a8553b50cee2b2be538e44d6e00"
  },
  {
    "file": "main/ipc.js",
    "start": "  ipcMain.on('pet:set-bounds', (event, bounds) => {",
    "end": "\n  });",
    "sha256": "ef450d6176da5c72c1216e887c488d983546a1637a413c68c9f1f1e0f47b27f8"
  },
  {
    "file": "preload.js",
    "start": "  setBounds(x, y, width, height, boxX, boxY, size, bottomPad, vx, vy, marginL, marginT) {",
    "end": "\n  },",
    "sha256": "61f8b3f321cd6f4e4a7cc8588a64f2a5d4bf8fc2780949cae2060eb762e0936d"
  },
  {
    "file": "sprite/init.js",
    "start": "  initMotion() {",
    "end": "\n  },",
    "sha256": "db5be58a022c0b2a85d0950447802d6adf002699098104783885242eb4a824eb"
  },
  {
    "file": "sprite/init.js",
    "start": "  subscribeCollision() {",
    "end": "\n  },",
    "sha256": "e894571380f8d9e44e657b8064674153094f4a1bb9536acde09ed77efa7765f4"
  },
  {
    "file": "sprite/motion.js",
    "start": "  stopThrow() {",
    "end": "\n  },",
    "sha256": "63ef54bf028616c8f9d4b9d45c771f11558238582a99ed6e97c3bc6d62fd0a95"
  },
  {
    "file": "events.js",
    "start": "function startLoops() {",
    "end": "\n}",
    "sha256": "d2a1245798bd3f98726b688267d9315b3c12a9749747150058610d4b7973cc6b"
  },
  {
    "file": "shared-core.js",
    "start": "function utteranceToHold(event) {",
    "end": "\n}",
    "sha256": "9e421fc1cc5ff30b63135d9040df5cc9fadb9e0b154a20635f4656b433d91158"
  },
  {
    "file": "shared-core.js",
    "start": "function stopAutoAudio() {",
    "end": "\n}",
    "sha256": "cffe5b3dce3a60322c6efb53c98abb87d27bbfac2b22089428e0093b6a4bc730"
  },
  {
    "file": "shared-core.js",
    "start": "async function speak(text) {",
    "end": "\n}",
    "sha256": "1b42e90a39874abeaf2f3989705feb4382beaea194461fef1d754bbcf2ad713a"
  }
];

/** 046 的跨窗协议、切屏定位与语音桥一起核对；残缺或混装模块在落盘前拒绝。 */
export function validateModularHelper046(files) {
  validateModularHelper043(files);
  const names=['index.html','sprite.js','sprite/input.js','sprite/window-fit.js','sprite/playback.js','main/windows.js','main/ipc.js','preload.js','sprite/init.js','sprite/motion.js','events.js','shared-core.js'];
  const sources={};
  for(const name of names){
    if(typeof files?.[name]!=='string')throw Error('harness-modular-runtime-anchor-mismatch');
    sources[name]=files[name].replaceAll('\r\n','\n');
    // 046 已将完整状态并入 setBounds；不能混回旧 IPC 或 30ms 上报泵。
    if(/reportFlight|flightReportTimer|['"]pet:(?:report-flight|flight-state)['"]/.test(sources[name]))throw Error('harness-modular-runtime-anchor-mismatch');
  }
  for(const {file,start,end,sha256}of NATIVE_HELPER_BLOCKS_046){
    const source=sources[file];requireOnce(source,start);
    const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
    if(b<0||createHash('sha256').update(source.slice(a,b+end.length)).digest('hex')!==sha256)throw Error('harness-modular-runtime-anchor-mismatch');
  }
  return files;
}
