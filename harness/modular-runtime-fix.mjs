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

const MENU_REGION_047 = '//#region src/shared/menu/mount.ts';
const MENU_SECTION_DIGESTS_047 = new Set([
  '51fddd7dc65cbaba58d773dfe27edae2a9d42841c4f254421c379f4553f0102e', // 桌面 shared-core.js
  '29d346879f3052b48d38098aa2c7a4db37101db61b74e69db81757f7934c2ef4', // Harness lib/client.js
]);
const MENU_LEAF_047 = '\t\t\t} else {\n\t\t\t\tif (node.thumb) {';
const MENU_LEAF_HOVER_047 = [
  '\t\t\t} else {',
  '\t\t\t\t// 上游 b7abd740：悬停叶子项时，收起同层展开的子菜单链。',
  '\t\t\t\titem.addEventListener("mouseenter", () => {',
  '\t\t\t\t\tconst prev = openChild.get(panel);',
  '\t\t\t\t\tif (prev) hideChain(prev);',
  '\t\t\t\t});',
  '\t\t\t\tif (node.thumb) {',
].join('\n');

export function patchModularMenu047(input) {
  if (typeof input !== 'string') throw Error('harness-modular-runtime-anchor-mismatch');
  requireOnce(input, MENU_REGION_047);
  const start = input.indexOf(MENU_REGION_047);
  const end = input.indexOf('//#endregion', start);
  if (end < 0) throw Error('harness-modular-runtime-anchor-mismatch');
  const region = input.slice(start, end);
  const normalized = region.replaceAll('\r\n', '\n');
  const patched = normalized.includes(MENU_LEAF_HOVER_047);
  const original = normalized.replace(MENU_LEAF_HOVER_047, MENU_LEAF_047);
  if (!MENU_SECTION_DIGESTS_047.has(createHash('sha256').update(original).digest('hex'))) {
    throw Error('harness-modular-runtime-anchor-mismatch');
  }
  if (patched) return input;
  const eol = region.includes('\r\n') ? '\r\n' : '\n';
  const before = MENU_LEAF_047.replaceAll('\n', eol);
  requireOnce(region, before);
  const fixed = region.replace(before, MENU_LEAF_HOVER_047.replaceAll('\n', eol));
  return input.slice(0, start) + fixed + input.slice(end);
}

/** 择取 7f6cc57 的画布定位修复，行内 SVG 不再推移窗口内容原点。 */
export function patchModularCanvas047(input) {
  if (typeof input !== 'string') throw Error('harness-modular-runtime-anchor-mismatch');
  const selector = '      #root {';
  requireOnce(input, selector);
  requireOnce(input, '    <div id="root"></div>');
  const afterSelector = input.indexOf(selector) + selector.length;
  const eol = input.startsWith('\r\n', afterSelector) ? '\r\n' : '\n';
  const before = [selector, '        position: relative;', '        width: 100%;', '        height: 100%;', '      }'].join(eol);
  const after = [selector, '        position: absolute;', '        inset: 0;', '      }'].join(eol);
  if (count(input, after) === 1) return input;
  requireOnce(input, before);
  return input.replace(before, after);
}

// 官方 0.4.6 tar 经 SHA512 核验；这里只核对实际原生函数，不复制旧模块或恢复生产源码。
const NATIVE_HELPER_BLOCKS = [
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
  }
];

const NATIVE_VOICE_BLOCKS_046 = [
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

// 047 改动了音频世代、隐藏播放和 renderer 配置签名。只校验这些实包函数。
const NATIVE_VOICE_BLOCKS_047 = [
  {file:'shared-core.js', start:'function setVoiceConfig(name, volume) {', sha256:'f6f89ccab8b68e17612f4fc721798c4568fffb6880a8a203982b3170254096f6'},
  {file:'shared-core.js', start:'function setVoiceNotifyEnabled(on) {', sha256:'93376f1d3704824efc3bf8a847166251ab4f66a79a3c525bd080d93af7a0dc75'},
  {file:'shared-core.js', start:'async function loadConfigOnce() {', sha256:'0dccf5db91cdee799f35c65cff157a2c0edd0e1161f2c1eee7eba1422d7c1e1b'},
  {file:'shared-core.js', start:'function playSayVoice(say) {', sha256:'ebce2ae959a44cb2fa0d995bb9ee7e6d05ef4b6ceb8898a7ff9887f4ec98af0a'},
  {file:'shared-core.js', start:'async function speakWhenReady(text, canPlayHidden = false) {', sha256:'1c7b49fef4ca89b23d8093649456d887fb4919b56ce077fc91c0f76a4aded523'},
  {file:'shared-core.js', start:'function speakNotice(text) {', sha256:'370c41ac0889cb531d7fa72f9c7afe2312c6a7a6931e7b90335d12b54a5fe6fa'},
  {file:'shared-core.js', start:'function stopAutoAudio() {', sha256:'65de090e9ed22e5e048170ea6285b7d00114c47ad2a315f0853be2ead343e570'},
  {file:'shared-core.js', start:'\nif (typeof document !== "undefined" && typeof document.addEventListener === "function") document.addEventListener("visibilitychange", () => {', end:'\n});', sha256:'2fcaebd3f094f5d039a9000035a3f4a741ae7d25f10e17104d44fd6cce6a48cd'},
  {file:'shared-core.js', start:'async function speak(text, canPlayHidden = false) {', sha256:'af680096d349dab0bab4f6583b66b4ac743aa487fc11fc5ce5d7a6e5f507bc52'},
  {file:'renderer.js', start:'async function loadConfig() {', sha256:'f6abd5a15e47de43ee644f81c368c1f2727e00c73bd5b8dfd88a6b22d85875c4'},
  {file:'renderer.js', start:'async function boot() {', sha256:'a7e7e0e1a85170977cd2876a3103c83a9bad2427ea147110cd02cedaef647554'},
];

function validateModularHelperNative(files, voiceBlocks, extraFiles = [], revisedBlocks = []) {
  validateModularHelper043(files);
  const names=['index.html','sprite.js','sprite/input.js','sprite/window-fit.js','sprite/playback.js','main/windows.js','main/ipc.js','preload.js','sprite/init.js','sprite/motion.js','events.js','shared-core.js',...extraFiles];
  const sources={};
  for(const name of names){
    if(typeof files?.[name]!=='string')throw Error('harness-modular-runtime-anchor-mismatch');
    sources[name]=files[name].replaceAll('\r\n','\n');
    // 046 已将完整状态并入 setBounds；不能混回旧 IPC 或 30ms 上报泵。
    if(/reportFlight|flightReportTimer|['"]pet:(?:report-flight|flight-state)['"]/.test(sources[name]))throw Error('harness-modular-runtime-anchor-mismatch');
  }
  const commonBlocks = NATIVE_HELPER_BLOCKS.filter(block =>
    !revisedBlocks.some(revised => revised.file === block.file && revised.start === block.start));
  for(const {file,start,end='\n}',sha256}of [...commonBlocks,...voiceBlocks,...revisedBlocks]){
    const source=sources[file];requireOnce(source,start);
    const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
    if(b<0||createHash('sha256').update(source.slice(a,b+end.length)).digest('hex')!==sha256)throw Error('harness-modular-runtime-anchor-mismatch');
  }
  return files;
}

/** 046 的跨窗协议、切屏定位与语音桥一起核对；残缺或混装模块在落盘前拒绝。 */
export function validateModularHelper046(files) {
  return validateModularHelperNative(files, NATIVE_VOICE_BLOCKS_046);
}

const POINTER_FALLBACK_START = '  function startPointerFallback(win) {\n    const pointerTimer = setInterval(() => {';
const POINTER_ZONE_LINE = '      const zone = pointerZone(bounds, point, margin);';
const DISPLAYS_PRELOAD = "  onDisplays(cb) {\n    ipcRenderer.on('pet:displays', (e, geo) => cb(geo));\n  },";
const RENDERER_BOOT = 'injectAssets();\nvoid boot();';
const TOOLTIP_FIX_047 = {
  'main/windows.js': [
    [POINTER_FALLBACK_START, `  function startPointerFallback(win) {
    let previousPointerZone;
    const pointerTimer = setInterval(() => {`],
    [POINTER_ZONE_LINE, `${POINTER_ZONE_LINE}
      // 上游 c7ea8b2：宠物离开光标时可能没有 mousemove，用现有轮询补收提示。
      if (!busy && previousPointerZone === 'body' && zone !== 'body') {
        win.webContents.send('pet:pointer-left');
      }
      previousPointerZone = zone;`],
  ],
  'preload.js': [
    [DISPLAYS_PRELOAD, `${DISPLAYS_PRELOAD}
  onPointerLeft(callback) {
    ipcRenderer.on('pet:pointer-left', () => callback());
  },`],
  ],
  'renderer.js': [
    [RENDERER_BOOT, `// 每个页面只订阅一次，角色重建后只操作当前的 sprites。
window.petBridge?.onPointerLeft?.(() => {
  for (const sprite of sprites) sprite.setTip(false);
});
${RENDERER_BOOT}`],
  ],
};

/** 同一窗口复用穿透轮询，渲染订阅与窗口页面同寿命。 */
export function patchModularTooltip047(files) {
  const fixed = { ...files };
  const modes = new Set();
  for (const [file, replacements] of Object.entries(TOOLTIP_FIX_047)) {
    if (typeof files?.[file] !== 'string') throw Error('harness-modular-tooltip-047-anchor-mismatch');
    let source = files[file].replaceAll('\r\n', '\n');
    for (const [before, after] of replacements) {
      const newCount = count(source, after);
      const oldCount = count(source.replaceAll(after, ''), before);
      if (oldCount === 1 && newCount === 0) {
        modes.add('original');
        source = source.replace(before, after);
      } else if (oldCount === 0 && newCount === 1) modes.add('patched');
      else throw Error('harness-modular-tooltip-047-anchor-mismatch');
    }
    fixed[file] = source;
  }
  if (modes.size !== 1) throw Error('harness-modular-tooltip-047-anchor-mismatch');
  return fixed;
}

/** 047 保留原跨窗协议，并单独核对新版语音配置与播放链。 */
export function validateModularHelper047(files) {
  return validateModularHelperNative(files, NATIVE_VOICE_BLOCKS_047, ['renderer.js']);
}

const MENU_DIGEST_048 = {
  desktop: '17ef11d0197f03dffeafa220b50482ced04f7d2724cb2d4cbd649d3fd3b5f767',
  web: 'daa8b526f574e4b0d0bc23d3b83cf603f62fe02b0aadf6104c0ddb725cf46664',
};

function validateMenu048(source, surface) {
  requireOnce(source, MENU_REGION_047);
  const start = source.indexOf(MENU_REGION_047);
  const end = source.indexOf('//#endregion', start);
  if (end < 0 || createHash('sha256').update(source.slice(start, end)).digest('hex') !== MENU_DIGEST_048[surface]) {
    throw Error('harness-modular-menu-048-anchor-mismatch');
  }
}

const ALPHA_OFF_048 = 'const PET_ALPHA_FIX_ENABLED = false;';
const ALPHA_ON_048 = 'const PET_ALPHA_FIX_ENABLED = true; // 保留已验证的原视频透明修正。';
const DESKTOP_WEATHER_MENU_048 = `      // 「查询天气」与余额同一类：宿主强制刷新并写 sections.env，气泡由 /state 驱动。
      { label: '查询天气', action: 'show-environment' },`;
const WEB_WEATHER_MENU_048 = '\t\t\t\t{\n\t\t\t\t\tlabel: "查询天气",\n\t\t\t\t\taction: "show-environment"\n\t\t\t\t},';
const WEATHER_HIDDEN_048 = '// codex-pet-environment-disabled-048：保留菜单中已支持的本机功能。';
const NATIVE_TOOLTIP_048 = `    // 主进程兜底：宠物自己走开、或窗口被别的窗口接走时页面收不到 mousemove，提示会一直亮着；
    // 主进程按光标轮询判定「刚离开身体」后通知这里收起（setTip 幂等，与 mousemove 判定不冲突）。
    if (window.petBridge && typeof window.petBridge.onPointerLeft === 'function') {
      window.petBridge.onPointerLeft(() => this.setTip(false));
    }`;
const WINDOW_TOOLTIP_048 = '    // 悬浮提示由窗口页面统一订阅，避免重建角色时保留旧实例。';
const DPI_REBUILD_048 = `      const previous = dpi.primaryScale;
      const written = dpi.writeCachedPrimaryScale(real);
      dpi.setPrimaryScale(real);
      petWindows.closeAll();
      petWindows.create();
      console.error(
        '[dsh-pet-desktop-helper] primary scaleFactor ' +
          previous +
          ' -> ' +
          real +
          '; rebuilt windows' +
          (written ? '' : '（写缓存失败，下次启动会再自查）'),
      );`;
const DPI_CACHE_048 = `      // 下次启动使用新缓存，当前窗口沿原宿主的模式和活动守卫管理。
      if (dpi.writeCachedPrimaryScale(real)) {
        console.error('[dsh-pet-desktop-helper] primary scaleFactor changed; restart the desktop pet to resize');
      }`;
const DPI_START_TIMER_048 = '  setTimeout(verifyPrimaryScale, SCALE_VERIFY_DELAY_MS).unref?.();';
const DPI_START_OFF_048 = '  // 缩放检查由显示器事件触发，沿用原启动流程。';

function inspectExact048(source, original, patched) {
  const after = count(source, patched);
  const before = count(source.replaceAll(patched, ''), original);
  if (before + after !== 1) throw Error('harness-modular-runtime-048-anchor-mismatch');
  return after === 1;
}

const DESKTOP_CHANGES_048 = {
  'shared-core.js': [[ALPHA_OFF_048, ALPHA_ON_048]],
  'renderer.js': TOOLTIP_FIX_047['renderer.js'],
  'sprite/init.js': [[NATIVE_TOOLTIP_048, WINDOW_TOOLTIP_048]],
  'sprite/menu.js': [[DESKTOP_WEATHER_MENU_048, '      ' + WEATHER_HIDDEN_048]],
  'main/displays.js': [[DPI_REBUILD_048, DPI_CACHE_048], [DPI_START_TIMER_048, DPI_START_OFF_048]],
};

const NATIVE_BLOCKS_048 = [
  {file:'main/windows.js', start:"    win.on('closed', () => {", end:'\n    });', sha256:'9cf03ca3d902ae4273893f288760dc7356fb86418d1bc9d2668fff7d753c8b68'},
  {file:'main/windows.js', start:'  function startPointerFallback(win) {', end:'\n  }', sha256:'ba6fc9839ac49216df991369ded8ffd8fffc2c514308e4fba0493fea794cc8f9'},
  {file:'main/displays.js', start:'function createDisplaySync({ screen, petWindows, dpi }) {', sha256:'c4f4c8822e17d3ec63d2c5656b02d89ffa381ff01b5ab5f20bdf3954c2ca4c50'},
  {file:'main/dpi.js', start:'  function probePrimaryScaleAsync() {', end:'\n  }', sha256:'813f06cc945ec559c8a99a3382a3177213ccfc7e934b8ed0a1c759e973773737'},
  {file:'pointer-target.js', start:'function leavesBody(prevZone, zone) {', sha256:'3f7da6e595a49a62496765850efad99174cc2edef9bbf9f536e06ac780470dc5'},
];

export const validateModularOwnedElectron048 = validateModularOwnedElectron045;

export function validateModularHelper048(files) {
  const native = { ...files };
  const modes = new Set();
  for (const [file, edits] of Object.entries(DESKTOP_CHANGES_048)) {
    if (typeof files?.[file] !== 'string') throw Error('harness-modular-runtime-048-anchor-mismatch');
    let source = files[file].replaceAll('\r\n', '\n');
    for (const [original, patched] of edits) {
      const isPatched = inspectExact048(source, original, patched);
      modes.add(isPatched ? 'patched' : 'original');
      if (isPatched) source = source.replace(patched, original);
    }
    native[file] = source;
  }
  if (modes.size !== 1) throw Error('harness-modular-runtime-048-anchor-mismatch');
  validateModularHelperNative(native, NATIVE_VOICE_BLOCKS_047, [
    'renderer.js', 'sprite/menu.js', 'main/displays.js', 'main/dpi.js', 'pointer-target.js',
  ], NATIVE_BLOCKS_048);
  validateModularDpi(native['main/dpi.js']);
  validateMenu048(native['shared-core.js'], 'desktop');
  requireOnce(native['preload.js'], "  onPointerLeft(cb) {\n    ipcRenderer.on('pet:pointer-left', () => cb());\n  },");
  requireOnce(native['renderer.js'], "if (S.PET_ALPHA_FIX_ENABLED) document.documentElement.classList.add('pet-alpha-fix');");
  requireOnce(native['index.html'], '      #root {\n        position: absolute;\n        inset: 0;\n      }'.replaceAll('\n', native['index.html'].includes('\r\n') ? '\r\n' : '\n'));
  requireOnce(native['index.html'], 'html.pet-alpha-fix video.pet-video {');
  return files;
}

export function patchModularHelper048(files) {
  validateModularHelper048(files);
  const fixed = { ...files };
  for (const [file, edits] of Object.entries(DESKTOP_CHANGES_048)) {
    let source = files[file].replaceAll('\r\n', '\n');
    for (const [original, patched] of edits) {
      if (count(source, patched) === 0) source = source.replace(original, patched);
    }
    fixed[file] = source;
  }
  return fixed;
}

export function patchModularClient048(input) {
  const source = validateModularClient043(input).replaceAll('\r\n', '\n');
  const weatherHidden = '\t\t\t\t' + WEATHER_HIDDEN_048;
  const alphaPatched = inspectExact048(source, ALPHA_OFF_048, ALPHA_ON_048);
  const menuPatched = inspectExact048(source, WEB_WEATHER_MENU_048, weatherHidden);
  if (alphaPatched !== menuPatched) throw Error('harness-modular-runtime-048-anchor-mismatch');
  validateMenu048(menuPatched ? source.replace(weatherHidden, WEB_WEATHER_MENU_048) : source, 'web');
  requireOnce(source, ALPHA_LAYOUT_045);
  requireOnce(source, 'const ALPHA_FIX_FILTER = PET_ALPHA_FIX_ENABLED ? ";filter:url(#dsh-pet-alpha-fix)" : "";');
  requireOnce(source, '\tif (PET_ALPHA_FIX_ENABLED) ensureAlphaFilter();');
  return alphaPatched ? source : source.replace(ALPHA_OFF_048, ALPHA_ON_048).replace(WEB_WEATHER_MENU_048, weatherHidden);
}
