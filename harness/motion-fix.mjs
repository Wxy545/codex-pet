import { lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { patchModularMain, patchModularMouseRelease, patchModularSandbox, patchModularUserData, patchModularPlayback043, patchModularOwnedElectron043, patchModularAlphaLayout043, validateModularOwnedElectron045, validateModularAlphaLayout045, validateModularClient043, validateModularHelper043, validateModularHelper046, validateModularHelper047, validateModularDpi, validateModularMotion } from './modular-runtime-fix.mjs';
import { patchPhysicsDefaults040 } from './physics-defaults-fix.mjs';
import { patchNativeAvatar041 } from './avatar-fix.mjs';
import {patchDrag041,patchAlpha041,patchTurn041} from './main-fixes-041.mjs';
import {patchModularCanvas047,patchModularMenu047,patchModularTooltip047,patchModularClient048,patchModularHelper048,validateModularOwnedElectron048} from './modular-runtime-fix.mjs';
import {patchModularClient049,patchModularHelper049,validateModularOwnedElectron049} from './modular-runtime-fix.mjs';

const staysWithin = (root, file) => { const rel = relative(root, file); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };

function replaceOne(source, before, after) {
  const oldCount = source.split(before).length - 1, newCount = source.split(after).length - 1;
  if (oldCount === 0 && newCount === 1) return source;
  if (oldCount !== 1 || newCount !== 0) throw new Error('harness-native-motion-anchor-mismatch');
  return source.replace(before, after);
}

// 移植自 PC2005-cloud/dsh-pet 86181ce；只修目标与起点的差值，不改宿主、菜单和物理参数。
export function patchNativeMotion(input) {
  let source = input.replaceAll('\r\n', '\n');
  source = replaceOne(source,
    'const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;',
    'const { startRatio, startYRatio, targetRatio, leadSec, tailSec } = pm;');
  return replaceOne(source,
    'else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);',
    'else ratioX = startRatio + (targetRatio - startRatio) * ((t - leadSec) / travelWindow);');
}

// 047 将总闸改作回复播报。原有气泡仍需总闸授权，新通知只看自己的显式开关，单句点播走原生入口。
const voicePlayback047 = [
  ['let notifyEnabled = false;', 'let notifyEnabled = false;\nlet codexPetVoiceMasterEnabled = false;'],
  ['function setVoiceConfig(name, volume) {', 'function setVoiceConfig(name, volume, enabled) {\n\tcodexPetVoiceMasterEnabled = enabled === true;'],
  ['\t\tconst main = body?.main;\n\t\tvoiceName =', '\t\tif (configLoaded) return;\n\t\tconst main = body?.main;\n\t\tcodexPetVoiceMasterEnabled = main?.voiceEnabled === true;\n\t\tvoiceName ='],
  ['\tawait loadConfigOnce();\n\tconst seq = ++utteranceSeq;', '\tawait loadConfigOnce();\n\tif (canPlayHidden && !notifyEnabled) return;\n\tif (!canPlayHidden && !codexPetVoiceMasterEnabled) {\n\t\tsetVoiceState("idle");\n\t\treturn;\n\t}\n\tconst seq = ++utteranceSeq;'],
];
// 保留各语言原生词典和其他语音说明，仅校正总闸标签及其与分项的关系。
const voiceCopy047 = [
  [ // de
    "Vier Schalter und eine Stimme: Jede Art von Sprachausgabe hat ihren eigenen Schalter, keiner hängt von einem anderen ab. Standardmäßig alle aus; wird beim „Speichern\" in die Benutzerkonfiguration geschrieben (kein sofortiges Schreiben).",
    "Manuelles Flüstern sprechen",
    "Das Vorlesen von Sprechblasen gilt für Chat-Antworten und manuell ausgelöstes Flüstern. Regelmäßiges Flüstern und Aufgaben-Erinnerungen brauchen zusätzlich ihren eigenen Schalter. Arbeitsmeldungen und das Vorlesen einzelner Zeilen per Lautsprechertaste funktionieren unabhängig davon. Änderungen werden beim Speichern übernommen.",
    "Sprechblasen vorlesen",
  ],
  [ // en
    "Four switches plus a voice: each kind of speech has its own switch and none of them depends on another. All off by default; written to the user config on \"Save\" (never written immediately).",
    "Speak manual whispers",
    "Bubble speech covers chat replies and manually triggered whispers. Periodic whispers and to-do reminders also need their own switch. Work-status speech and the chat speaker button for a single line are independent of bubble speech. Changes take effect when you save.",
    "Speak bubbles",
  ],
  [ // es
    "Cuatro interruptores y una voz: cada tipo de locución tiene su propio interruptor y ninguno depende de otro. Todo desactivado por defecto; se escribe en la configuración del usuario al \"Guardar\" (nunca al instante).",
    "Locutar susurros manuales",
    "La lectura de globos incluye las respuestas del chat y los susurros activados manualmente. Los susurros periódicos y los recordatorios de tareas también necesitan su propio interruptor. El aviso de estado de trabajo y la lectura de una frase con el botón del altavoz son independientes. Los cambios se aplican al guardar.",
    "Leer los globos en voz alta",
  ],
  [ // fr
    "Quatre interrupteurs et une voix : chaque type de parole a son propre interrupteur, aucun ne dépend d'un autre. Tout est désactivé par défaut et écrit dans la configuration utilisateur lors de l'enregistrement (jamais immédiatement).",
    "Lire les murmures manuels",
    "La lecture des bulles couvre les réponses du chat et les murmures déclenchés manuellement. Les murmures périodiques et les rappels de tâches nécessitent aussi leur propre interrupteur. Les annonces d’état de travail et la lecture d’une réplique avec le bouton haut-parleur sont indépendantes. Les modifications s’appliquent à l’enregistrement.",
    "Lire les bulles à voix haute",
  ],
  [ // ja
    "ペットが音を出すための4つのスイッチと声質：音声の種類ごとに独立したスイッチがあり、どれも他のスイッチには従いません。デフォルトはすべてオフで、「保存」時にユーザー設定へ書き込まれます（即時書き込みはしません）。",
    "手動ひとりごとの読み上げ",
    "吹き出しの読み上げは、チャットの返信と手動で呼び出したひとりごとが対象です。定期的なひとりごとと ToDo リマインダーは、それぞれの設定もオンにしてください。作業状態の読み上げとスピーカーボタンでの一文再生は独立しています。変更は保存後に反映されます。",
    "吹き出しの読み上げ",
  ],
  [ // pt
    "Quatro interruptores e uma voz: cada tipo de fala tem o próprio interruptor e nenhum depende de outro. Tudo desligado por padrão; gravado na configuração do usuário ao \"Salvar\" (nunca na hora).",
    "Falar sussurros manuais",
    "A leitura dos balões inclui respostas do chat e sussurros acionados manualmente. Sussurros periódicos e lembretes de tarefas também precisam do próprio interruptor. Os avisos de status do trabalho e a leitura de uma frase pelo botão de alto-falante são independentes. As alterações valem após salvar.",
    "Ler os balões em voz alta",
  ],
  [ // ru
    "Четыре переключателя и голос: у каждого типа озвучивания свой переключатель, ни один не зависит от другого. По умолчанию всё выключено; записывается в пользовательский конфиг по «Сохранить» (без немедленной записи).",
    "Озвучивать ручной шёпот",
    "Озвучивание пузырей распространяется на ответы в чате и шёпот, вызванный вручную. Для периодического шёпота и напоминаний о задачах также нужно включить соответствующий переключатель. Озвучивание рабочего статуса и чтение одной фразы по кнопке динамика не зависят от озвучивания пузырей. Изменения применяются после сохранения.",
    "Озвучивать реплики в пузырях",
  ],
  [ // zh
    "桌宠出声的四个开关与音色：每类语音各一个开关，互不从属。默认全关，随「保存」写入用户配置（不做即时写入）。",
    "手动播报",
    "气泡播报控制对话回复和手动触发的碎碎念。定时碎碎念和待办提醒还要开启各自的开关。工作状态播报单独开启，对话中的喇叭可随时点播一句。设置在保存后生效。",
    "气泡播报",
  ],
].map(([beforeHint, beforeLabel, afterHint, afterLabel]) => [
  voiceCopyAnchor047(beforeHint, beforeLabel), voiceCopyAnchor047(afterHint, afterLabel),
]);

function voiceCopyAnchor047(hint, label) {
  return `\tvoiceHint: ${JSON.stringify(hint)},\n\tvoiceEnabled: ${JSON.stringify(label)},`;
}

const voiceFiles047 = {
  'lib/client.js': [
    ...voicePlayback047,
    ...voiceCopy047,
    ['setVoiceConfig(main.voiceName, main.voiceVolume);', 'setVoiceConfig(main.voiceName, main.voiceVolume, main.voiceEnabled);'],
  ],
  'lib/index.js': [
    ['const whisperVoiceOn = cfg.main?.voiceWhisperEnabled === true;', 'const whisperVoiceOn = cfg.main?.voiceEnabled === true && cfg.main.voiceWhisperEnabled === true;'],
    ['isVoiceTodoEnabled: () => readAllConfig(configPaths).main?.voiceTodoEnabled === true,', 'isVoiceTodoEnabled: () => {\n\t\t\tconst main = readAllConfig(configPaths).main;\n\t\t\treturn main?.voiceEnabled === true && main.voiceTodoEnabled === true;\n\t\t},'],
  ],
  'runtime/electron-helper/shared-core.js': voicePlayback047,
  'runtime/electron-helper/renderer.js': [
    ["    voiceName: (merged && merged.main && merged.main.voiceName) || '',", "    voiceEnabled: (merged && merged.main && merged.main.voiceEnabled) === true,\n    voiceName: (merged && merged.main && merged.main.voiceName) || '',"],
    ['S.setVoiceConfig(cfg.voiceName, cfg.voiceVolume);', 'S.setVoiceConfig(cfg.voiceName, cfg.voiceVolume, cfg.voiceEnabled);'],
  ],
};

function planVoice047(input, anchors, modes) {
  let native = input.replaceAll('\r\n', '\n'), patched = native;
  for (const [before, after] of anchors) {
    // 部分新锚点包含旧行。先排除新块再计数，拒绝重复锚点与半补丁。
    const newCount = native.split(after).length - 1;
    const oldCount = native.replaceAll(after, '').split(before).length - 1;
    if (oldCount === 1 && newCount === 0) {
      modes.add('native');
      patched = patched.replace(before, after);
    } else if (oldCount === 0 && newCount === 1) {
      modes.add('patched');
      native = native.replace(after, before);
    } else throw Error('harness-native-voice-047-anchor-mismatch');
  }
  return { native, patched };
}

const hostFunctions048 = [
  ['async function currentEnvironment(', '8d66b6935aa93243c0cf8afaf505d4ddc822e23ff0e425284c86234bdc41a6ed', `async function currentEnvironment() {
	// 继续用本机日期时间，省略上游公网 IP 定位与天气背景。
	return void 0;
}`],
  ['async function handleEnvironmentRoutes(', '38de12b493444faa52d160b5de0d4f5bdb724117173a64834fa4508c2458c53f', `async function handleEnvironmentRoutes(_deps, { rest }) {
	if (rest !== "environment" && !rest.startsWith("environment/")) return void 0;
	return { kind: "json", status: 403, obj: failureBody("forbidden", "dsh-pet: environment is disabled") };
}`],
];
const hostLines048 = [
  [' || rest === "environment" || rest === "broadcast"', ' || rest === "broadcast" /* codex-pet-environment-blocked-048 */'],
  [
    'const picFile = resolveExisting(join(userRoot, "pic"), picRel) ?? resolveExisting(join(PACKAGE_ROOT, "assets", "pic"), picRel);',
    'const picFile = resolveExisting(join(PACKAGE_ROOT, "assets", "pic"), picRel);',
  ],
];

const hostFunctions049 = [
  [hostFunctions048[0][0], '637163c921607db7cad40752b5573b275c4fe05c4aa884c39ec2b0faf4a95fbd', hostFunctions048[0][2]],
  [hostFunctions048[1][0], 'abe6cf6722ff9917f28ee4fa1225d9e2ee465228ff9ff5e958f2914203edec77', hostFunctions048[1][2]],
  ['function registerVoiceProvider(', '45c60e6980b520f6870670857a553ec9798511e1692841f1a8e5cc8b5f7c0981', `function registerVoiceProvider(def) {
	// 只允许受核验的原有语音来源，避免新 provider 接收对话内容。
	if (def !== EDGE_PROVIDER) throw new TypeError("unsupported pet voice provider");
	validateVoiceProvider(def);
	if (providers$1.has(def.id)) throw new TypeError("pet voice provider already registered");
	providers$1.set(def.id, def);
	return () => { if (providers$1.get(def.id) === def) providers$1.delete(def.id); };
}`],
  ['function registerSpeechProvider(', '93e16bb19e300b0d93335f498f3a8e77de55960fc8a319da987988766e1866b3', `function registerSpeechProvider(def) {
	if (!def || def !== codexPetDshProvider) throw new TypeError("unsupported pet speech provider");
	validateSpeechProvider(def);
	if (providers.has(def.id)) throw new TypeError("pet speech provider already registered");
	providers.set(def.id, def);
	return () => { if (providers.get(def.id) === def) providers.delete(def.id); };
}`],
  ['function resolveVoice(', '92911a27a5cda34193bb121066a4905d6811ed35d15d4ce4f1e157df62e38c6b', `function resolveVoice(value) {
	// 旧配置存的是 Edge 音色名，仅在目录中精确匹配后增加命名空间。
	const voice = codexPetEdgeVoice(value);
	const provider = providers$1.get(EDGE_PROVIDER_ID);
	if (!provider || !voice) return void 0;
	return { provider, voice, limitedId: limitedVoiceId(EDGE_PROVIDER_ID, voice.id) };
}`],
];
const nativeSpeechInit049 = '\tensureDshSpeechProvider({ speechToText: () => setup.optionalService("speechToText") });';
const deepseekSpeech049 = `	const resolveDeepseekKey = async () => {
		const dedicated = setup.standaloneDeepseekKey();
		if (dedicated) return dedicated;
		const standalone = setup.standaloneAiBalance();
		if (standalone?.provider === DEEPSEEK_OFFICIAL_PROVIDER_ID && standalone.apiKey) return standalone.apiKey;
		const resolved = await ctx.credentials.resolve(credentialRef("DEEPSEEK_API_KEY"));
		return resolved?.value;
	};
	ensureDeepseekTtsProvider({ resolveKey: resolveDeepseekKey });
	ensureDeepseekAsrProvider({ resolveKey: resolveDeepseekKey });`;
const builtInSpeech049 = `	if (resolveSpeechProvider(DSH_SPEECH_PROVIDER_ID)) return;
	registerSpeechProvider(createDshSpeechProvider(deps));`;
const builtInSpeechMarker049 = `	if (resolveSpeechProvider(DSH_SPEECH_PROVIDER_ID)) return;
	codexPetDshProvider = createDshSpeechProvider(deps);
	registerSpeechProvider(codexPetDshProvider);`;
const hostLines049 = [
  [hostLines048[0][0].replace('"broadcast"', '"broadcast" || rest === "bubble/clear"'), hostLines048[0][1]],
  hostLines048[1],
  [
    '\tsetCityProvider(() => {\n\t\tconst city = readAllConfig(configPaths).main?.environmentCity;\n\t\treturn typeof city === "string" && city.trim() !== "" ? city.trim() : void 0;\n\t});',
    '\t// 不向天气或公网定位注入用户配置。',
  ],
  [
    '\t\tenvironment: (opts) => currentEnvironment({\n\t\t\tforce: opts?.fresh === true,\n\t\t\t...opts?.city === void 0 ? {} : { city: opts.city }\n\t\t}),',
    '\t\tenvironment: currentEnvironment,',
  ],
  [
    '\tconst standaloneDeepseekKey = () => {\n\t\tconst service = optionalService("standaloneAi");\n\t\tconst key = service?.deepseekKey?.();\n\t\treturn key ? key : void 0;\n\t};',
    '\t// 语音不请求本机或余额凭据。',
  ],
  ['\t\tstandaloneDeepseekKey,', '\t\t// 原生的账户额度来源单独保留。'],
  [nativeSpeechInit049+'\n'+deepseekSpeech049, nativeSpeechInit049+'\n\t// 继续沿用已配置的原生录音能力和 Edge 播报。'],
  ['function ensureDshSpeechProvider(deps) {\n'+builtInSpeech049, 'let codexPetDshProvider;\nfunction ensureDshSpeechProvider(deps) {\n'+builtInSpeechMarker049],
  ['const EDGE_PROVIDER_ID = "edge";', `const EDGE_PROVIDER_ID = "edge";
function codexPetEdgeVoice(value) {
	if (typeof value !== "string") return void 0;
	const id = value.startsWith("edge/") ? value.slice(5) : value;
	return EDGE_PROVIDER.voices.find(voice => voice.id === id);
}`],
  ['\t\tcase "voiceName": return typeof value === "string" && VOICE_ID_PATTERN.test(value);', '\t\tcase "voiceName": return typeof value === "string"; // 未知值保留到运行时明确拒绝。'],
  ['\tconst vn = o.voiceName;\n\tif (vn !== void 0 && !topFieldValid("voiceName", vn)) return null;', '\tconst vn = o.voiceName === existing?.voiceName ? void 0 : o.voiceName;\n\tif (vn !== void 0 && !codexPetEdgeVoice(vn)) return null;'],
  ['\tconst nwf = o.notifyWhenFocused;\n\tif (nwf !== void 0 && typeof nwf !== "boolean") return null;', '\t// 保存宠物设置时沿用原前台通知规则。'],
  ['\tconst sp = o.speechProvider;\n\tif (sp !== void 0 && !topFieldValid("speechProvider", sp)) return null;\n\tconst ec = o.environmentCity;\n\tif (ec !== void 0 && !topFieldValid("environmentCity", ec)) return null;', '\t// 原有字段通过 existing 循环保留，避免改写用户配置。'],
  ['\tif (nwf !== void 0) outConfig.notifyWhenFocused = nwf;', '\t// 不新增前台提醒配置。'],
  ['\tif (sp !== void 0) outConfig.speechProvider = sp;\n\tif (ec !== void 0) outConfig.environmentCity = String(ec).trim();', '\t// 不通过此接口写入语音提供方或城市。'],
  ['\tif (nwf !== void 0) bodyOwned.add("notifyWhenFocused");', '\t// 已保存的前台提醒字段仍由 existing 保留。'],
  ['\tif (sp !== void 0) bodyOwned.add("speechProvider");\n\tif (ec !== void 0) bodyOwned.add("environmentCity");', '\t// 已保存的识别服务和城市字段仍由 existing 保留。'],
  ['const MAX_BODY_BYTES = 10 * 1024 * 1024;', 'const MAX_BODY_BYTES = 1024 * 1024; // 保留原请求体上限。'],
  ['const MAX_AUDIO_BYTES = 7 * 1024 * 1024;', 'const MAX_AUDIO_BYTES = 768 * 1024; // 保留原识别字节上限。'],
  ['\t\tconst run = () => dispatchPetRoute(url, rest, method, body, signal);', `		// Helper 管道与 HTTP 共用同一请求上限。
		if (typeof body === "string" && Buffer.byteLength(body) > MAX_BODY_BYTES) {
			return { kind: "json", status: 413, obj: failureBody("payload-too-large", "request body too large") };
		}
		if (rest === "bubble/clear" || rest.startsWith("bubble/clear/")) {
			return { kind: "json", status: 403, obj: failureBody("forbidden", "dsh-pet: feature is disabled") };
		}
		const run = () => dispatchPetRoute(url, rest, method, body, signal);`],
  ['\t\tconst limitedId = parsed.value.voice ?? configuredVoice?.();', '\t\tconst limitedId = parsed.value.voice ?? configuredVoice?.() ?? DEFAULT_VOICE;'],
  ['return typeof name$1 === "string" && name$1 ? name$1 : void 0;', 'return typeof name$1 === "string" ? name$1 : void 0;'],
  ['message: \`voice not found: \${limitedId}\`', 'message: "voice unavailable"'],
  ['cacheKey(limitedId, rate, text), format)', 'cacheKey(resolved.voice.id, rate, text), format)'],
  ['createHash("sha1").update(\`${voiceId}\\n${rate}\\n${text}\`).digest("hex")', 'createHash("sha1").update(\`edge\\n${voiceId}\\n${rate >= 0 ? "+" : ""}${rate}%\\n${text}\`).digest("hex")'],
  ['\t\tconst run = await withDeadline(signal, timeoutMs, (inner) => provider.transcribe({\n\t\t\t\taudio: parsed.value.audio,\n\t\t\t\tsignal: inner\n\t\t\t}));', '\t\tconst run = await withDeadline(signal, timeoutMs, (inner) => provider.transcribe({\n\t\t\t\taudio: parsed.value.audio,\n\t\t\t\tlanguage: parsed.value.language,\n\t\t\t\tsignal: inner\n\t\t\t}));'],
  ['async transcribe({ audio, signal }) {\n\t\t\tconst speech = deps.speechToText();', 'async transcribe({ audio, language, signal }) {\n\t\t\tconst speech = deps.speechToText();'],
  ['speech.transcribe(speech.resolve({ audio }), signal ?? NEVER_ABORT)', 'speech.transcribe(speech.resolve({ audio, ...language === void 0 ? {} : { language } }), signal ?? NEVER_ABORT)'],
  ['\tconst provider = body.provider;\n', '\tconst language = body.language;\n\tif (language !== void 0 && (typeof language !== "string" || language.trim() === "")) return { ok: false, message: "language must be a non-empty string" };\n\tconst provider = body.provider;\n'],
  ['\t\t\taudio,\n\t\t\t...provider === void 0 ? {} : { provider: provider.trim() }', '\t\t\taudio,\n\t\t\t...language === void 0 ? {} : { language: language.trim() },\n\t\t\t...provider === void 0 ? {} : { provider: provider.trim() }'],
  ['const providerId = parsed.value.provider ?? options.configuredProvider?.();', 'const providerId = parsed.value.provider ?? options.configuredProvider?.() ?? DSH_SPEECH_PROVIDER_ID;'],
  ['\t\t\tif (!providerId) return {\n\t\t\t\tok: false,\n\t\t\t\treason: "bad-request",\n\t\t\t\tmessage: "provider is required"\n\t\t\t};', '\t\t\tif (providerId !== DSH_SPEECH_PROVIDER_ID) return { ok: false, reason: "unsupported", message: "speech provider unavailable" };'],
  ['message: \`provider not found: \${providerId}\`', 'message: "native speech provider unavailable"'],
  ['\ttry {\n\t\treturn {\n\t\t\tok: true,\n\t\t\tvalue: await Promise.race([task(controller.signal), deadline])', '\ttry {\n\t\tif (signal?.aborted) return { ok: false, message: "speech transcription aborted" };\n\t\treturn {\n\t\t\tok: true,\n\t\t\tvalue: await Promise.race([task(controller.signal), deadline])'],
];

function patchNativeHost(input, version) {
  let source = input.replaceAll('\r\n', '\n');
  const modes = new Set();
  const is049 = version === '0.4.9';
  const fail = () => { throw Error(`harness-native-host-${is049 ? '049' : '048'}-anchor-mismatch`); };
  for (const [start, digest, replacement] of is049 ? hostFunctions049 : hostFunctions048) {
    const begin = source.indexOf(start);
    const end = source.indexOf('\n}', begin);
    if (begin < 0 || end < 0 || source.indexOf(start, begin + start.length) >= 0) fail();
    const existing = source.slice(begin, end + 2);
    if (existing === replacement) {
      modes.add('patched');
    } else {
      if (createHash('sha256').update(existing).digest('hex') !== digest) fail();
      modes.add('native');
      source = source.slice(0, begin) + replacement + source.slice(end + 2);
    }
  }
  for (const [before, after] of is049 ? hostLines049 : hostLines048) {
    const oldCount = source.replaceAll(after, '').split(before).length - 1;
    const newCount = source.split(after).length - 1;
    if (oldCount + newCount !== 1) fail();
    modes.add(oldCount ? 'native' : 'patched');
    if (oldCount) source = source.replace(before, after);
  }
  if (modes.size !== 1) fail();
  return source;
}

export function prepareHarnessDependency({ profileDir }) {
  if (!isAbsolute(profileDir)) throw new Error('absolute-harness-profile-required');
  // 显式从官方profile目录解析，不能落到外部linked bundle祖先的Codex依赖。
  const require = createRequire(join(profileDir, 'package.json'));
  const packageRoot = realpathSync(dirname(require.resolve('dsh-pet/package.json')));
  const profileRoot = realpathSync(profileDir), rel = relative(profileRoot, packageRoot);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('harness-dsh-pet-outside-selected-profile');
  const meta = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (meta.name !== 'dsh-pet' || !['0.4.0', '0.4.1', '0.4.3', '0.4.5', '0.4.6', '0.4.7', '0.4.8', '0.4.9'].includes(meta.version)) throw new Error('harness-dsh-pet-0.4.0-or-0.4.1-or-0.4.3-or-0.4.5-or-0.4.6-or-0.4.7-or-0.4.8-or-0.4.9-required');
  const version = meta.version;
  const is048 = version === '0.4.8';
  const is049 = version === '0.4.9';
  const nativeDesktop = is048 || is049;
  const hasVoiceConfig = version === '0.4.7' || nativeDesktop;
  const voiceModes = new Set();
  const transforms = [
    ['lib/client.js', source => {
      let native = source;
      if (is049) native = patchModularClient049(source);
      else if (is048) native = patchModularClient048(source);
      else if (['0.4.5', '0.4.6', '0.4.7'].includes(version)) native = validateModularAlphaLayout045(source);
      else if (version === '0.4.3') native = patchModularAlphaLayout043(validateModularClient043(source));
      const base = patchPhysicsDefaults040(patchModularMouseRelease(validateModularMotion(native, { browser: true })));
      return version === '0.4.1' ? patchTurn041(patchAlpha041(patchDrag041(base, { browser: true }), { browser: true })) : base;
    }],
    ['lib/index.js', source => {
      let native = source;
      if (is049) native = patchNativeHost(validateModularOwnedElectron049(source), version);
      else if (is048) native = patchNativeHost(validateModularOwnedElectron048(source), version);
      else if (['0.4.5', '0.4.6', '0.4.7'].includes(version)) native = validateModularOwnedElectron045(source);
      else if (version === '0.4.3') native = patchModularOwnedElectron043(source);
      return patchModularSandbox(version === '0.4.0' ? native : patchNativeAvatar041(native));
    }],
    ['runtime/electron-helper/shared-core.js', patchPhysicsDefaults040],
    ['runtime/electron-helper/sprite/motion.js', validateModularMotion],
    ['runtime/electron-helper/main.js', patchModularMain],
    ['runtime/electron-helper/main/dpi.js', validateModularDpi],
    ['runtime/electron-helper/main/user-data.js', patchModularUserData],
  ];
  if(version==='0.4.1')transforms.push(['runtime/electron-helper/sprite/input.js',patchDrag041],['runtime/electron-helper/index.html',patchAlpha041]);
  if(['0.4.3','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9'].includes(version))transforms.push(['runtime/electron-helper/sprite/playback.js',patchModularPlayback043],...['sprite.js','sprite/input.js','sprite/window-fit.js','index.html'].map(name=>['runtime/electron-helper/'+name,source=>source]));
  // 046 起广播、preload 与 renderer 协议须作为同一组核验，不能只认旧的窗口落位片段。
  if(['0.4.6','0.4.7','0.4.8','0.4.9'].includes(version))transforms.push(...['main/windows.js','main/ipc.js','preload.js','sprite/init.js','events.js'].map(name=>['runtime/electron-helper/'+name,source=>source]));
  if(hasVoiceConfig)transforms.push(['runtime/electron-helper/renderer.js',source=>source]);
  if(nativeDesktop)transforms.push(...['main/displays.js','pointer-target.js','sprite/menu.js'].map(name=>['runtime/electron-helper/'+name,source=>source]));
  if(is049)transforms.push(...['constants.js','sprite/bubble.js'].map(name=>['runtime/electron-helper/'+name,source=>source]));
  const planned = transforms.map(([name, transform]) => {
    const file = join(packageRoot, name), stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe-harness-upstream-file');
    const realFile = realpathSync(file);
    if (!staysWithin(packageRoot, realFile) || !staysWithin(profileRoot, realFile)) throw new Error('unsafe-harness-upstream-file-outside-profile');
    const before = readFileSync(file, 'utf8');
    const voice = hasVoiceConfig && voiceFiles047[name] ? planVoice047(before, voiceFiles047[name], voiceModes) : null;
    return { name, file, realFile, before, after: transform(voice?.patched ?? before), native: voice?.native ?? before, transform, mode: stat.mode };
  });
  const helperPrefix = 'runtime/electron-helper/';
  const helperEntries = planned.filter(item => item.name.startsWith(helperPrefix));
  const helperFiles=Object.fromEntries(helperEntries.map(item=>[item.name.slice(helperPrefix.length),hasVoiceConfig?item.native:item.after]));
  if(hasVoiceConfig && voiceModes.size!==1)throw Error('harness-native-voice-047-anchor-mismatch');
  if(nativeDesktop){
    const prepared = is049 ? patchModularHelper049(helperFiles) : patchModularHelper048(helperFiles);
    for (const item of helperEntries) {
      let source = prepared[item.name.slice(helperPrefix.length)];
      if (voiceFiles047[item.name]) source = planVoice047(source, voiceFiles047[item.name], new Set()).patched;
      item.after = item.transform(source);
    }
  }else if(version==='0.4.7'){
    validateModularHelper047(helperFiles);
    const prepared = patchModularTooltip047(Object.fromEntries(helperEntries.map(item => [item.name.slice(helperPrefix.length), item.after])));
    prepared['index.html'] = patchModularCanvas047(prepared['index.html']);
    prepared['shared-core.js'] = patchModularMenu047(prepared['shared-core.js']);
    for (const item of helperEntries) item.after = prepared[item.name.slice(helperPrefix.length)];
    const client = planned.find(item => item.name === 'lib/client.js');
    client.after = patchModularMenu047(client.after);
  }else if(meta.version==='0.4.6')validateModularHelper046(helperFiles);
  else if(['0.4.3','0.4.5'].includes(meta.version))validateModularHelper043(helperFiles);
  // 全部锚点文件都通过才落盘；临时文件rename断开pnpm硬链接，不写共享store的inode。
  const changed = [];
  for (const item of planned) {
    if (item.before === item.after) continue;
    const realFile = realpathSync(item.file);
    if (realFile !== item.realFile || !staysWithin(packageRoot, realFile) || !staysWithin(profileRoot, realFile)) throw new Error('unsafe-harness-upstream-file-outside-profile');
    if (readFileSync(item.file, 'utf8') !== item.before) throw new Error('harness-upstream-file-changed');
    const temporary = item.file + '.dragon-' + randomUUID();
    try {
      writeFileSync(temporary, item.after, { flag: 'wx', mode: item.mode });
      renameSync(temporary, item.file); changed.push(item.name);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  return { status: changed.length ? 'updated' : 'current', version: meta.version, files: changed };
}
