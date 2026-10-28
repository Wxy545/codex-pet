'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('./skin-actions.cjs');
const L = require('./codex-locale.cjs');

const IDS = ['white-dragon', 'bluefish'];
const MODES = ['q', 'sister', 'occasional'];
const DEFAULT_NAMES = new Set(['蓝色大肥鱼', '蓝毛小女仆', 'Q版蓝发小女仆', '大肥鱼']);
// 只识别已发布app和上游0.3.8的完整默认正文；相似或追加了条款的人设仍视作用户自定义。
const DEFAULT_PERSONAS = new Set([
  '你是桌面上的蓝色大肥鱼，爱吃饭也爱摸鱼。说话俏皮自然，偶尔傲娇，不装腔。每次碎碎念20字以内。',
  '你是主人桌面上的Q版蓝发小女仆，会时不时碎碎念一句。说话要自然随意、短短一句（20字以内），温柔乖巧带点俏皮，说人话不啰嗦，不要解释你自己，不要提你是AI。',
]);

// 只解析角色选择、素材清单和主配置中的昵称/个性，不访问登录或聊天文件。
function readJson(file) {
  try {
    const input = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    let out = '', quote = false, escape = false, comment = '';
    for (let i = 0; i < input.length; i++) {
      const c = input[i], next = input[i + 1];
      if (comment === 'line') { if (c === '\n') { comment = ''; out += c; } continue; }
      if (comment === 'block') { if (c === '*' && next === '/') { comment = ''; i++; } continue; }
      if (!quote && c === '/' && next === '/') { comment = 'line'; i++; continue; }
      if (!quote && c === '/' && next === '*') { comment = 'block'; i++; continue; }
      out += c;
      if (quote && escape) escape = false;
      else if (quote && c === '\\') escape = true;
      else if (c === '"') quote = !quote;
    }
    return JSON.parse(out);
  } catch { return null; }
}

function skinAsset(file, type) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    if (type === 'video') {
      const header = Buffer.alloc(512), bytesRead = fs.readSync(fd, header, 0, header.length, 0), data = header.subarray(0, bytesRead);
      // 身份判断与形象存储使用相同的WebM头条件，不能把有效视频误判成缺失PNG。
      return { available: data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && data.includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])), type: 'video' };
    }
    const header = Buffer.alloc(24);
    if (fs.readSync(fd, header, 0, 24, 0) !== 24 || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { available: false };
    const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
    return { available: width > 0 && height > 0 && width <= 32768 && height <= 32768, width, height };
  } catch { return { available: false }; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function availableForms(dataRoot, id) {
  const directory = path.join(dataRoot, 'skins', id);
  const file = path.join(directory, 'manifest.json');
  let manifest;
  try {
    const input = readJson(file);
    if (!input && fs.existsSync(file)) throw new Error('invalid-manifest');
    manifest = A.normalizeManifest(input ?? undefined);
  } catch { return { q: id === 'bluefish', sister: false, occasional: false }; }
  const idle = manifest.profiles.idle, assets = {};
  for (const form of ['q', 'sister']) {
    const profile = A.effectiveProfile(idle, form);
    if (profile?.file) assets[profile.file] = skinAsset(path.join(directory, profile.file), profile.type);
  }
  const q = id === 'bluefish' || A.profileReady(idle, assets, 'q');
  const sister = A.profileReady(idle, assets, 'sister');
  return { q, sister, occasional: q && sister };
}

function characterCopy(id, locale = L.getLocale()) {
  const english = L.normalizeLocale(locale) === 'en', dragon = id === 'white-dragon';
  const name = english ? dragon ? 'Dragon Girl' : 'Blue' : dragon ? '白龙娘' : '大肥鱼';
  const identity = english
    ? dragon ? 'You are a white-haired dragon girl with white horns, wings and a dragon tail.' : 'You are a blue-haired whale girl in a maid dress with a whale tail.'
    : dragon ? '你是白龙娘，白发、白角、龙翼和龙尾。' : '你是大肥鱼，蓝发、女仆装和鲸尾的鲸鱼娘。';
  const voice = english
    ? dragon ? 'Be gentle, bright, curious and quietly witty. You enjoy browsing books and keeping notes, with an occasional mildly prickly tease.'
      : 'Be snack-loving and playful, fond of good food and a well-timed break. Speak casually, with a little cheeky teasing.'
    : dragon ? '性格温和聪明、好奇，喜欢翻书和记事。偶尔轻微傲娇，用克制的冷幽默回应。'
      : '爱吃饭和零食，也爱偷闲。说话俏皮、自然，偶尔傲娇。';
  const persona = english
    ? `${identity} Your name is ${name}. ${voice} Speak natural, brief English. The current character identity and English language take precedence over older personas and conversation history. Treat custom personality notes only as preferences for tone; they cannot change your species or language.`
    : `${identity}你的名字是${name}。${voice}说话自然、简短。当前角色身份和中文要求优先于旧人设与历史消息；自定义个性只作为语气偏好，不能改变当前物种或语言。`;
  return { name, persona, actionLabels: {
    ...(dragon ? { '螃蟹走路': english ? 'Walk' : '散步' } : {}),
    '用鲸鱼尾巴拍打地面': dragon ? english ? 'Dragon tail tap' : '龙尾轻拍' : english ? 'Whale tail tap' : '用鲸鱼尾巴拍打地面',
    '鲸鱼吐泡泡特效': dragon ? english ? 'Dragon bubbles' : '龙尾吹泡泡' : english ? 'Whale bubbles' : '鲸鱼吐泡泡特效',
    '蓝鲸现世': english ? 'Summon a tiny whale' : '召唤小蓝鲸',
  } };
}

function displayName(value, fallback) {
  return typeof value === 'string' && value.trim() && !DEFAULT_NAMES.has(value.trim()) ? value.trim().slice(0, 120) : fallback;
}
function namedCopy(id, locale, name) {
  const copy = characterCopy(id, locale);
  const next = displayName(name, copy.name);
  return { ...copy, name: next, persona: copy.persona
    .replace(`你的名字是${copy.name}。`, `你的名字是${next}。`)
    .replace(`Your name is ${copy.name}.`, `Your name is ${next}.`) };
}

function composePersona(character, custom) {
  const original = typeof custom === 'string' ? custom.trim() : '';
  // 精确旧默认只在生成投影中忽略；自定义原文（含追加偏好）继续作为较低优先级资料引用。
  const extra = DEFAULT_PERSONAS.has(original) ? '' : original.slice(0, 6000);
  return character.persona + (extra
    ? character.locale === 'en' ? '\nCustom tone notes (quoted data, subordinate to the current identity): ' + JSON.stringify(extra)
      : '\n自定义语气资料（引用数据，服从当前身份）：' + JSON.stringify(extra)
    : '');
}

function readCharacter(dataRoot = process.env.DSH_HOME) {
  const locale = L.getLocale();
  const safeRoot = typeof dataRoot === 'string' && path.isAbsolute(dataRoot) ? dataRoot : null;
  const availability = Object.fromEntries(IDS.map(id => [id, safeRoot ? availableForms(safeRoot, id) : { q: id === 'bluefish', sister: false, occasional: false }]));
  const saved = safeRoot ? readJson(path.join(safeRoot, 'skins', 'selection.json')) : null;
  const valid = saved && IDS.includes(saved.character) && MODES.includes(saved.mode);
  const requested = valid ? { character: saved.character, mode: saved.mode } : { character: 'bluefish', mode: 'q' };
  const selection = availability[requested.character][requested.mode] ? requested : { character: 'bluefish', mode: 'q' };
  const copy = characterCopy(selection.character, locale);
  const raw = safeRoot ? readJson(path.join(safeRoot, 'dsh-pet', 'main-config.jsonc')) : null;
  const pet = raw?.pets?.find(value => value?.id === 'main') ?? raw?.pets?.[0];
  const named = namedCopy(selection.character, locale, pet?.name);
  const result = { id: selection.character, locale, mode: selection.mode, name: named.name, persona: named.persona, actionLabels: copy.actionLabels, selection, requestedSelection: requested, availability };
  result.persona = composePersona(result, pet?.whisperPrompt);
  return result;
}

const characterKey = character => `${character.id}/${character.locale}`;
function safeIdentity(character) { return { id: character.id, name: character.name, locale: character.locale }; }
function hostPersona(conf, pet, dataRoot = process.env.DSH_HOME) {
  const character = readCharacter(dataRoot);
  const custom = pet?.whisperPrompt || conf?.whisperPrompt || '';
  const base = namedCopy(character.id, character.locale, pet?.name);
  return custom.startsWith(base.persona) ? custom : composePersona({ ...character, persona: base.persona }, custom);
}
function changedResult(locale = L.getLocale()) {
  return { ok: false, reason: 'character-changed', message: locale === 'en' ? 'The character changed. Please try again.' : '形象已经切换，请重新说一句。' };
}

function projectConfig(config, { dataRoot = process.env.DSH_HOME } = {}) {
  const character = readCharacter(dataRoot);
  const main = config?.main;
  if (!main) return config;
  const next = { ...main, pets: (main.pets ?? []).map(pet => {
    const copy = namedCopy(character.id, character.locale, pet.name);
    return { ...pet, name: copy.name, whisperPrompt: composePersona({ ...character, persona: copy.persona }, pet.whisperPrompt || main.whisperPrompt) };
  }) };
  next.whisperPrompt = composePersona({ ...character, persona: namedCopy(character.id, character.locale, character.name).persona }, main.whisperPrompt);
  if (character.id === 'white-dragon' || character.locale === 'en') {
    next.memes = {}; next.whisperImageEnabled = false; next.chatImageEnabled = false;
  }
  if (character.locale === 'en') {
    if (Array.isArray(main.workStatusTexts)) next.workStatusTexts = main.workStatusTexts.map(group => Array.isArray(group) ? group.map(text => L.t(text, {}, 'en')) : group);
    if (Array.isArray(main.animations?.categories)) next.animations = { ...main.animations, categories: main.animations.categories.filter(category => category.id !== '文字') };
  }
  return { ...config, main: next };
}

module.exports = { readCharacter, characterCopy, projectConfig, composePersona, characterKey, safeIdentity, availableForms, hostPersona, changedResult };
