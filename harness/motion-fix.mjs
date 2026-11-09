import { lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { patchModularMain, patchModularMouseRelease, patchModularSandbox, patchModularUserData, patchModularPlayback043, patchModularOwnedElectron043, patchModularAlphaLayout043, validateModularOwnedElectron045, validateModularAlphaLayout045, validateModularClient043, validateModularHelper043, validateModularHelper046, validateModularHelper047, validateModularDpi, validateModularMotion } from './modular-runtime-fix.mjs';
import { patchPhysicsDefaults040 } from './physics-defaults-fix.mjs';
import { patchNativeAvatar041 } from './avatar-fix.mjs';
import {patchDrag041,patchAlpha041,patchTurn041} from './main-fixes-041.mjs';

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

export function prepareHarnessDependency({ profileDir }) {
  if (!isAbsolute(profileDir)) throw new Error('absolute-harness-profile-required');
  // 显式从官方profile目录解析，不能落到外部linked bundle祖先的Codex依赖。
  const require = createRequire(join(profileDir, 'package.json'));
  const packageRoot = realpathSync(dirname(require.resolve('dsh-pet/package.json')));
  const profileRoot = realpathSync(profileDir), rel = relative(profileRoot, packageRoot);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('harness-dsh-pet-outside-selected-profile');
  const meta = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (meta.name !== 'dsh-pet' || !['0.4.0', '0.4.1', '0.4.3', '0.4.5', '0.4.6', '0.4.7'].includes(meta.version)) throw new Error('harness-dsh-pet-0.4.0-or-0.4.1-or-0.4.3-or-0.4.5-or-0.4.6-or-0.4.7-required');
  const voice047 = meta.version === '0.4.7', voiceModes = new Set();
  const transforms = [
    ['lib/client.js', source => {const native=['0.4.5','0.4.6','0.4.7'].includes(meta.version)?validateModularAlphaLayout045(source):meta.version==='0.4.3'?patchModularAlphaLayout043(validateModularClient043(source)):source;const base=patchPhysicsDefaults040(patchModularMouseRelease(validateModularMotion(native, { browser: true })));return meta.version==='0.4.1'?patchTurn041(patchAlpha041(patchDrag041(base,{browser:true}),{browser:true})):base;}],
    ['lib/index.js', source => {const native=['0.4.5','0.4.6','0.4.7'].includes(meta.version)?validateModularOwnedElectron045(source):meta.version==='0.4.3'?patchModularOwnedElectron043(source):source;return patchModularSandbox(['0.4.1','0.4.3','0.4.5','0.4.6','0.4.7'].includes(meta.version) ? patchNativeAvatar041(native) : native);}],
    ['runtime/electron-helper/shared-core.js', patchPhysicsDefaults040],
    ['runtime/electron-helper/sprite/motion.js', validateModularMotion],
    ['runtime/electron-helper/main.js', patchModularMain],
    ['runtime/electron-helper/main/dpi.js', validateModularDpi],
    ['runtime/electron-helper/main/user-data.js', patchModularUserData],
  ];
  if(meta.version==='0.4.1')transforms.push(['runtime/electron-helper/sprite/input.js',patchDrag041],['runtime/electron-helper/index.html',patchAlpha041]);
  if(['0.4.3','0.4.5','0.4.6','0.4.7'].includes(meta.version))transforms.push(['runtime/electron-helper/sprite/playback.js',patchModularPlayback043],...['sprite.js','sprite/input.js','sprite/window-fit.js','index.html'].map(name=>['runtime/electron-helper/'+name,source=>source]));
  // 046 起广播、preload 与 renderer 协议须作为同一组核验，不能只认旧的窗口落位片段。
  if(['0.4.6','0.4.7'].includes(meta.version))transforms.push(...['main/windows.js','main/ipc.js','preload.js','sprite/init.js','events.js'].map(name=>['runtime/electron-helper/'+name,source=>source]));
  if(voice047)transforms.push(['runtime/electron-helper/renderer.js',source=>source]);
  const planned = transforms.map(([name, transform]) => {
    const file = join(packageRoot, name), stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe-harness-upstream-file');
    const realFile = realpathSync(file);
    if (!staysWithin(packageRoot, realFile) || !staysWithin(profileRoot, realFile)) throw new Error('unsafe-harness-upstream-file-outside-profile');
    const before = readFileSync(file, 'utf8');
    const voice = voice047 && voiceFiles047[name] ? planVoice047(before, voiceFiles047[name], voiceModes) : null;
    return { name, file, realFile, before, after: transform(voice?.patched ?? before), native: voice?.native ?? before, mode: stat.mode };
  });
  const helperFiles=Object.fromEntries(planned.filter(item=>item.name.startsWith('runtime/electron-helper/')).map(item=>[item.name.slice('runtime/electron-helper/'.length),voice047?item.native:item.after]));
  if(voice047){
    if(voiceModes.size!==1)throw Error('harness-native-voice-047-anchor-mismatch');
    validateModularHelper047(helperFiles);
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
