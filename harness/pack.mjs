import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

export const ENTRY = 'codex-white-dragon';
function windowsUiLocale() {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-UICulture).Name'],
    { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  if (result.error || result.status !== 0) throw new Error('windows-ui-locale-unavailable');
  return result.stdout.trim();
}
export function detectPackLocale(explicit, { platform = process.platform, readWindowsUiLocale = windowsUiLocale,
  fallbackLocale = () => Intl.DateTimeFormat().resolvedOptions().locale } = {}) {
  if (['zh-CN', 'en'].includes(explicit)) return explicit;
  let value;
  if (platform === 'win32') try { value = readWindowsUiLocale(); } catch { /* Windows显示语言不可用时才回落区域设置。 */ }
  if (typeof value !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(value)) value = fallbackLocale();
  return /^zh(?:-|$)/i.test(value) ? 'zh-CN' : 'en';
}
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceName = name => typeof name === 'string' && /^[a-z0-9][a-z0-9_-]{0,95}\.webm$/.test(name);
const targetName = name => typeof name === 'string' && name.length <= 140 && !/[\\/:*?"<>|\u0000-\u001f]/.test(name) && !name.startsWith('.') && name.endsWith('.webm');
const LABELS = {
  idle: ['轻息摇尾', 'Quiet breathing'], walk: ['散步', 'Walk'], click: ['开心跃动', 'Happy bounce'],
  turn: ['回眸张望', 'Look around'], drag: ['拎起悬空', 'Picked up'], thinking: ['托腮思考', 'Thinking'],
  working: ['敲敲键盘', 'Typing'], waiting: ['抬头等你', 'Waiting for you'], success: ['开心庆祝', 'Celebrating'],
  error: ['垂头叹气', 'A little sigh'], 'wing-care': ['整理龙翼', 'Wing care'], 'tail-nap': ['抱尾小憩', 'Curl up for a nap'],
  magic: ['掌心微光', 'A little magic'], shy: ['害羞卷尾', 'Shy tail curl'], proud: ['叉腰得意', 'Feeling smug'],
  'dragon-snack': ['吃星形饼干', 'Star-cookie snack'], 'wing-fan': ['扇翼纳凉', 'Wing fan'],
  greeting: ['招手眨眼', 'A little wave'], tickle: ['怕痒缩肩', 'Ticklish shrug'], 'wing-hover': ['振翼踏步', 'Wing-assisted steps'],
  'book-reading': ['抱书阅读', 'Reading a spellbook'], 'cushion-rest': ['坐垫歇息', 'Cushion break'],
  'treasure-guard': ['护住小宝石', 'Guarding a gem'],
};
const OPTIONAL_PROFILES = new Set(['book-reading', 'cushion-rest', 'treasure-guard']);

/** 只把实际视频放进原生动画池；事件槽可以共用，不虚增专属动作。 */
export function buildHarnessConfig({ manifest, locale = 'zh-CN', copy }) {
  const english = locale === 'en';
  if (manifest?.schemaVersion !== 1 || !copy?.name || !copy?.persona) throw new Error('invalid-harness-manifest');
  const media = {}, names = {};
  for (const [key, labels] of Object.entries(LABELS)) {
    const profile = manifest.profiles?.[key];
    if (profile === undefined && OPTIONAL_PROFILES.has(key)) continue;
    if (profile?.type !== 'video' || !sourceName(profile.file)) throw new Error('harness-profile-video-required: ' + key);
    const action = Object.entries(manifest.actions ?? {}).find(([, value]) => value.profile === key)?.[0];
    // 护宝石同时绑定额度与玩耍槽，原生媒体名称不能由actions对象的顺序决定。
    const label = key === 'treasure-guard' ? labels[english ? 1 : 0] : copy.actionLabels?.[action] || labels[english ? 1 : 0];
    if (!targetName(label + '.webm') || media[label + '.webm']) throw new Error('invalid-harness-action-label');
    names[key] = label; media[label + '.webm'] = profile.file;
  }
  const group = (id, weight, keys) => ({ id, weight, actions: keys.map(key => names[key]).filter(Boolean) });
  const config = {
    whisperPrompt: copy.persona,
    whisperImageEnabled: false, chatImageEnabled: false, memes: {},
    pets: [{ id: ENTRY, name: copy.name, size: 420, balanceEnabled: true, whisperEnabled: true, workStatusEnabled: true,
      fixedEnabled: false, display: 'both', position: { corner: 'bottom-right', marginX: 300, marginY: 20 } }],
    animations: {
      idle: [names.idle], turn: [names.turn], drag: [names.drag],
      clicks: ['click', 'shy', 'proud', 'tickle', 'greeting'].map(key => names[key]),
      moves: { default: { minDist: 60, maxDist: 240, margin: 20, leadSec: .12, tailSec: .12 },
        actions: [{ name: names.walk }, { name: names['wing-hover'], params: { minDist: 40, maxDist: 120 } }] },
      categories: [group(english ? 'Little gestures' : '小动作', 20, ['wing-care', 'tail-nap', 'book-reading', 'cushion-rest']),
        group(english ? 'Play' : '玩耍', 20, ['magic', 'treasure-guard']), group(english ? 'Snacks' : '吃什么', 16, ['dragon-snack']),
        group(english ? 'Cooling off' : '时节', 14, ['wing-fan']), group(english ? 'Greetings' : '招呼', 10, ['greeting'])],
      events: { balance: ['treasure-guard' in names ? 'treasure-guard' : 'proud', 'success', 'idle', 'thinking', 'waiting', 'error'].map(key => names[key]),
        whisper: ['working', 'thinking', 'greeting'].map(key => names[key]),
        workStatus: ['thinking', 'working', 'working', 'waiting', 'success', 'error'].map(key => names[key]) },
    },
    animationWeights: { idle: 10, turn: 5, move: 5 },
    workStatusTexts: (english ? ['Thinking it through.', 'On it.', 'Tidying up.', 'Your call.', 'Done.', 'Let me check.']
      : ['让我想想。', '这步交给我。', '整理一下。', '这一步，等你。', '搞定。', '再检查一下。']).map(text => [text]),
  };
  return { config, media, coverage: { videos: Object.keys(media).length, balanceSlots: 6, whisperSlots: 3, workSlots: 6, sharedWorkResult: true } };
}

/** 动作引用必须与实际媒体逐一对应；新增动作可缺省，旧核心动作不能缺。 */
function referencedMedia(config, locale) {
  const animations = config?.animations;
  if (!animations) throw new Error('invalid-harness-pack');
  const used = new Set();
  const add = values => {
    if (!Array.isArray(values)) throw new Error('invalid-harness-pack');
    for (const value of values.flat()) {
      if (typeof value !== 'string' || !targetName(value + '.webm')) throw new Error('invalid-harness-pack-file');
      used.add(value + '.webm');
    }
  };
  for (const key of ['idle', 'turn', 'drag', 'clicks']) add(animations[key]);
  if (!Array.isArray(animations.moves?.actions) || !Array.isArray(animations.categories)) throw new Error('invalid-harness-pack');
  add(animations.moves.actions.map(value => value?.name));
  for (const category of animations.categories) add(category?.actions);
  for (const key of ['balance', 'whisper', 'workStatus']) add(animations.events?.[key]);
  const index = locale === 'en' ? 1 : 0;
  const known = new Set(Object.values(LABELS).map(labels => labels[index] + '.webm'));
  const required = Object.entries(LABELS).filter(([key]) => !OPTIONAL_PROFILES.has(key)).map(([, labels]) => labels[index] + '.webm');
  if ([...used].some(name => !known.has(name)) || required.some(name => !used.has(name))) throw new Error('invalid-harness-pack-file');
  return used;
}

function ownDirectory(home, directory) {
  const local = relative(home, directory);
  if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) throw new Error('unsafe-harness-target-path');
  let cursor = home;
  // 创建之前逐层检查，避免先跟随junction在目录外落文件后才发现越界。
  for (const part of local.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (existsSync(cursor)) {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe-harness-target-path');
    } else mkdirSync(cursor);
  }
  const root = realpathSync(home), target = realpathSync(directory), rel = relative(root, target);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || lstatSync(directory).isSymbolicLink()) throw new Error('unsafe-harness-target-path');
}
function fileHash(file) {
  if (!existsSync(file)) return null;
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('unsafe-harness-target-file');
  return hash(readFileSync(file));
}
function atomicFile(file, write) {
  const temporary = file + '.tmp-' + randomUUID();
  try { write(temporary); renameSync(temporary, file); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

/** 先核实完整包，再种入独立种类；只升级自己留下且仍未修改的文件。 */
export function seedHarnessPack({ sourceRoot, dshHome, locale = 'zh-CN' }) {
  if (!isAbsolute(sourceRoot) || !isAbsolute(dshHome)) throw new Error('absolute-harness-path-required');
  const pack = JSON.parse(readFileSync(join(sourceRoot, 'pack.json'), 'utf8'));
  const selectedLocale = pack.locales?.[locale] ? locale : 'en';
  const selected = pack.locales?.[selectedLocale];
  if (pack.schemaVersion !== 1 || !selected?.config || !Array.isArray(selected.files)) throw new Error('invalid-harness-pack');
  const expected = referencedMedia(selected.config, selectedLocale);
  if (selected.files.length !== expected.size) throw new Error('invalid-harness-pack');
  const snapshot = selected.files.map(item => {
    if (!targetName(item.name) || !expected.has(item.name) || !sourceName(item.source) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('invalid-harness-pack-file');
    const file = join(sourceRoot, 'assets', item.source);
    if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new Error('invalid-harness-source-media');
    const data = readFileSync(file);
    if (data.length !== item.size || hash(data) !== item.sha256) throw new Error('harness-source-media-hash-mismatch');
    return { ...item, file };
  });
  if (new Set(snapshot.map(item => item.name)).size !== snapshot.length) throw new Error('invalid-harness-pack-file');
  const configData = Buffer.from(JSON.stringify(selected.config, null, 2) + '\n');
  const petRoot = join(dshHome, 'dsh-pet', 'pet'), animationRoot = join(petRoot, ENTRY + '-animation');
  mkdirSync(dshHome, { recursive: true }); ownDirectory(dshHome, petRoot); ownDirectory(dshHome, animationRoot);
  const configFile = join(petRoot, ENTRY + '-config.json'), stampFile = join(animationRoot, '.codex-pet-harness.json');
  let previous = null;
  if (existsSync(stampFile)) { fileHash(stampFile); previous = JSON.parse(readFileSync(stampFile, 'utf8')); }
  const configBefore = fileHash(configFile), currentConfigHash = hash(configData);
  const actual = new Map(snapshot.map(item => [item.name, fileHash(join(animationRoot, item.name))]));
  const conflicts = snapshot.filter(item => actual.get(item.name) && actual.get(item.name) !== item.sha256 && actual.get(item.name) !== previous?.files?.[item.name]);
  if (!configBefore && conflicts.length) throw new Error('harness-existing-media-conflict');
  const preserved = conflicts.map(item => item.name);
  let changed = false;
  const managedFiles = { ...(previous?.files ?? {}) };
  for (const item of snapshot) {
    if (preserved.includes(item.name)) continue;
    if (actual.get(item.name) !== item.sha256) { atomicFile(join(animationRoot, item.name), file => copyFileSync(item.file, file)); changed = true; }
    managedFiles[item.name] = item.sha256;
  }
  let configHash = previous?.configHash;
  if (!configBefore || configBefore === currentConfigHash || configBefore === previous?.configHash) {
    if (configBefore !== currentConfigHash) { atomicFile(configFile, file => writeFileSync(file, configData, { flag: 'wx' })); changed = true; }
    configHash = currentConfigHash;
  } else preserved.push(ENTRY + '-config.json');
  const stamp = { schemaVersion: 1, version: pack.version, locale, configHash, files: managedFiles };
  const stampData = JSON.stringify(stamp, null, 2) + '\n';
  if (!existsSync(stampFile) || readFileSync(stampFile, 'utf8') !== stampData) atomicFile(stampFile, file => writeFileSync(file, stampData, { flag: 'wx' }));
  return { status: preserved.length ? 'preserved' : changed ? previous ? 'updated' : 'installed' : 'current', entry: ENTRY, locale, preserved, videos: snapshot.length };
}
