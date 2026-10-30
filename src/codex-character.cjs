'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const A = require('./skin-actions.cjs');
const L = require('./codex-locale.cjs');

const IDS = ['white-dragon', 'bluefish', 'curly-sheep'];
const PET_SIZE_MIN = 128;
const PET_SIZE_MAX = 1024;
const DEFAULT_PET_SIZE = 320;
const DEFAULT_NAMES = new Set(['蓝色大肥鱼', '蓝毛小女仆', 'Q版蓝发小女仆', '大肥鱼', '白龙娘', 'Dragon Girl', 'Blue', '卷卷', 'Curly']);
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

function mainPet(raw) {
  const pets = Array.isArray(raw?.pets) ? raw.pets : [];
  return pets.find(value => value?.id === 'main') ?? pets[0] ?? null;
}

function readPetSize(dataRoot = process.env.DSH_HOME) {
  const safeRoot = typeof dataRoot === 'string' && path.isAbsolute(dataRoot) ? dataRoot : null;
  const pet = safeRoot ? mainPet(readJson(path.join(safeRoot, 'dsh-pet', 'main-config.jsonc'))) : null;
  const value = Number(pet?.size);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_PET_SIZE;
}

function writePetSize(dataRoot, size) {
  if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) throw new Error('invalid-pet-data-root');
  if (!Number.isInteger(size) || size < PET_SIZE_MIN || size > PET_SIZE_MAX) throw new Error('invalid-pet-size');
  const file = path.join(dataRoot, 'dsh-pet', 'main-config.jsonc');
  const raw = readJson(file);
  if (!raw || !Array.isArray(raw.pets) || !raw.pets.length) throw new Error('invalid-pet-config');
  const index = raw.pets.findIndex(pet => pet?.id === 'main');
  const target = index >= 0 ? index : 0;
  if (!raw.pets[target] || typeof raw.pets[target] !== 'object' || Array.isArray(raw.pets[target])) throw new Error('invalid-pet-config');
  const next = { ...raw, pets: raw.pets.map((pet, current) => current === target ? { ...pet, size } : pet) };
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* 临时文件写入失败时无需覆盖原配置。 */ }
    throw error;
  }
  return size;
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
  } catch { return { q: id === 'bluefish' }; }
  const idle = manifest.profiles.idle, assets = {};
  if (idle?.file) assets[idle.file] = skinAsset(path.join(directory, idle.file), idle.type);
  return { q: id === 'bluefish' || A.profileReady(idle, assets) };
}

function characterCopy(id, locale = L.getLocale()) {
  const english = L.normalizeLocale(locale) === 'en', dragon = id === 'white-dragon', sheep = id === 'curly-sheep';
  const name = english ? sheep ? 'Curly' : dragon ? 'Dragon Girl' : 'Blue' : sheep ? '卷卷' : dragon ? '白龙娘' : '大肥鱼';
  const identity = english
    ? sheep ? 'You are a little sheep companion with cream curls, curled brown-gold horns, sheep ears and a dark brown fleece jacket.' : dragon ? 'You are a white-haired dragon girl with white horns, wings and a dragon tail.' : 'You are a blue-haired whale girl in a maid dress with a whale tail.'
    : sheep ? '你是一只奶油卷毛、棕金盘角、羊耳朵、穿深棕羊羔绒夹克的小羊。' : dragon ? '你是白龙娘，白发、白角、龙翼和龙尾。' : '你是大肥鱼，蓝发、女仆装和鲸尾的鲸鱼娘。';
  const voice = english
    ? sheep ? 'Be warm, curious and a little bashful, with a dry little joke now and then. You like taking small, steady steps and keeping people company. Use sheep puns sparingly; do not bleat in every sentence.' : dragon ? 'Be gentle, bright, curious and quietly witty. You enjoy browsing books and keeping notes, with an occasional mildly prickly tease.'
      : 'Be snack-loving and playful, fond of good food and a well-timed break. Speak casually, with a little cheeky teasing.'
    : sheep ? '性格温软、好奇，带一点腼腆，喜欢踏实做点小事和安静陪伴。偶尔开个轻巧玩笑，不句句咩咩叫。' : dragon ? '性格温和聪明、好奇，喜欢翻书和记事。偶尔轻微傲娇，用克制的冷幽默回应。'
      : '爱吃饭和零食，也爱偷闲。说话俏皮、自然，偶尔傲娇。';
  const persona = english
    ? `${identity} Your name is ${name}. ${voice} Speak natural, brief English. The current character identity and English language take precedence over older personas and conversation history. Treat custom personality notes only as preferences for tone; they cannot change your species or language.`
    : `${identity}你的名字是${name}。${voice}说话自然、简短。当前角色身份和中文要求优先于旧人设与历史消息；自定义个性只作为语气偏好，不能改变当前物种或语言。`;
  const sharedAnimationHint = english ? 'Shared animation' : '共用动作';
  if (sheep) {
    // 只改可实际播放的羊动作显示语义，技术槽位仍与上游事件协议一致。
    const pairs = {
      '待机呼吸休闲': ['待机轻晃', 'Easy breathing'], '螃蟹走路': ['哒哒小步', 'Little steps'],
      '点击回应-开心跃动': ['开心回应', 'A happy hello'], '点击回应-元气挥手': ['挥手招呼', 'A little wave'],
      '东张西望': ['抬手招呼', 'A quick hello'], '被鼠标拖拽悬空反馈': ['乖乖悬着', 'Hanging on'],
      '工作状态-思考冒泡': ['歪头想想', 'Thinking it over'], '工作状态-忙碌点按': ['认真敲字', 'Typing away'],
      '工作状态-清点归档': ['整理收尾', 'Wrapping up'], '工作状态-原地踱步张望': ['乖乖等候', 'Waiting patiently'],
      '工作状态-雀跃庆祝': ['小小庆祝', 'A little celebration'], '工作状态-垂头叹气冒汗': ['再想想办法', 'Thinking of a fix'],
      '余额-钱袋满溢': ['余量宽裕', 'Plenty left'], '余额-金袋叮当': ['余量充足', 'Looking good'],
      '余额-钱袋如常': ['余量适中', 'Steady for now'], '余额-数金皱眉': ['余量偏低', 'Running low'],
      '余额-袋空如洗': ['余量将尽', 'Nearly out'], '余额-分文不剩': ['余量耗尽', 'All used up'],
      '碎碎念-擦桌碎碎念': ['边忙边聊', 'A word while typing'], '碎碎念-发呆碎碎念': ['歪头碎碎念', 'A wandering thought'],
      '碎碎念-对屏碎碎念': ['跟你打个招呼', 'Just saying hi'],
    };
    return { name, persona, sharedAnimationHint, menuLabels: { '文字': english ? 'Greetings' : '招呼' }, actionLabels: Object.fromEntries(Object.entries(pairs).map(([key, pair]) => [key, pair[english ? 1 : 0]])) };
  }
  return { name, persona, sharedAnimationHint, menuLabels: dragon ? { '文字': english ? 'Greetings' : '招呼' } : {}, actionLabels: {
    ...(dragon ? {
      '螃蟹走路': english ? 'Walk' : '散步',
      '超大伸懒腰': english ? 'Wing care' : '整理龙翼',
      '原地小憩沉眠': english ? 'Curl up for a nap' : '抱尾小憩',
      '凭空生花': english ? 'A little magic' : '掌心微光',
      '点击回应-害羞惊讶': english ? 'Shy tail curl' : '害羞卷尾',
      '点击回应-傲娇生气': english ? 'Feeling smug' : '叉腰得意',
      '大口吃零食': english ? 'Star-cookie snack' : '吃星形饼干',
      '被落叶淹没': english ? 'Wing fan' : '扇翼纳凉',
      '深度思考碎碎念': english ? 'A little wave' : '招手眨眼',
      '点击回应-元气挥手': english ? 'A little wave' : '招手眨眼',
      '点击回应-挠痒咯咯笑': english ? 'Ticklish shrug' : '怕痒缩肩',
      '原地漂浮踏步': english ? 'Wing-assisted steps' : '振翼踏步',
      '轻快记录': english ? 'Reading a spellbook' : '抱书阅读',
      '悠闲哼歌': english ? 'Cushion break' : '坐垫歇息',
      '原地专心玩魔方': english ? 'Guarding a gem' : '护住小宝石',
      '余额-钱袋满溢': english ? 'Balance: plenty left' : '余量宽裕',
      '余额-金袋叮当': english ? 'Balance: comfortable' : '余量充足',
      '余额-钱袋如常': english ? 'Balance: moderate' : '余量适中',
      '余额-数金皱眉': english ? 'Balance: getting low' : '余量偏低',
      '余额-袋空如洗': english ? 'Balance: almost out' : '余量将尽',
      '余额-分文不剩': english ? 'Balance: exhausted' : '余量耗尽',
      '碎碎念-擦桌碎碎念': english ? 'Chatter while working' : '边做边聊',
      '碎碎念-发呆碎碎念': english ? 'Daydream and chatter' : '发呆碎碎念',
      '碎碎念-对屏碎碎念': english ? 'A word with you' : '跟你说句话',
    } : {}),
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
  const availability = Object.fromEntries(IDS.map(id => [id, safeRoot ? availableForms(safeRoot, id) : { q: id === 'bluefish' }]));
  const saved = safeRoot ? readJson(path.join(safeRoot, 'skins', 'selection.json')) : null;
  const valid = saved && IDS.includes(saved.character) && ['q', 'sister', 'occasional'].includes(saved.mode);
  const preferred = process.env.CODEX_PET_HOST === 'workbuddy' ? 'curly-sheep' : 'white-dragon';
  const requested = valid ? { character: saved.character, mode: 'q' } : { character: availability[preferred].q ? preferred : 'bluefish', mode: 'q' };
  const selection = availability[requested.character].q ? requested : { character: 'bluefish', mode: 'q' };
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
  const workbuddy = process.env.CODEX_PET_HOST === 'workbuddy';
  const main = config?.main;
  if (!main) return config;
  const next = { ...main, pets: (main.pets ?? []).map(pet => {
    const copy = namedCopy(character.id, character.locale, pet.name);
    return { ...pet, ...(workbuddy ? { balanceEnabled: false, whisperEnabled: false } : {}), name: copy.name, whisperPrompt: composePersona({ ...character, persona: copy.persona }, pet.whisperPrompt || main.whisperPrompt) };
  }) };
  next.whisperPrompt = composePersona({ ...character, persona: namedCopy(character.id, character.locale, character.name).persona }, main.whisperPrompt);
  if (character.id !== 'bluefish' || character.locale === 'en') {
    next.memes = {}; next.whisperImageEnabled = false; next.chatImageEnabled = false;
  }
  if (character.locale === 'en') {
    if (Array.isArray(main.workStatusTexts)) next.workStatusTexts = main.workStatusTexts.map(group => Array.isArray(group) ? group.map(text => L.t(text, {}, 'en')) : group);
    // 动作清单保留完整；含中文字幕的原鱼视频在渲染器按当前角色过滤，切到无字龙娘时仍可使用同一槽位。
  }
  return { ...config, main: next };
}

module.exports = {
  readCharacter, characterCopy, projectConfig, composePersona, characterKey, safeIdentity, availableForms, hostPersona, changedResult,
  readPetSize, writePetSize, PET_SIZE_MIN, PET_SIZE_MAX,
};
