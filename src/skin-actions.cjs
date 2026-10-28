(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CodexSkinActions = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const WORK_PROFILES = ['thinking', 'working', 'working', 'waiting', 'success', 'error'];
  const validFile = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,95}\.png$/.test(value);
  const validVideo = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,95}\.webm$/.test(value);
  const validKey = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);

  function catalogFromAnimations(animations = {}) {
    const result = new Map();
    const add = (id, fields) => {
      if (typeof id !== 'string' || !id || result.has(id)) return;
      result.set(id, { id, label: id, ...fields });
    };
    for (const group of ['idle', 'turn', 'drag', 'clicks']) for (const id of animations[group] ?? []) add(id, { group });
    for (const move of animations.moves?.actions ?? []) add(move.name, { group: 'moves', params: { ...animations.moves.default, ...move.params } });
    for (const category of animations.categories ?? []) for (const id of category.actions ?? []) add(id, { group: `category:${category.id}`, noMirror: category.noMirror === true });
    for (const [event, slots] of Object.entries(animations.events ?? {})) slots.forEach((slot, index) => (Array.isArray(slot) ? slot : [slot]).forEach(id => add(id, { group: `event:${event}`, slot: index })));
    return [...result.values()];
  }

  function defaultManifest() {
    const strip = (row, count, start = 0) => Array.from({ length: count }, (_, index) => [start + index, row]);
    const profile = (frames, fps) => ({ file: 'sprites.png', sisterFile: 'sister.png', columns: 4, rows: 4, frames, fps });
    return { schemaVersion: 1, profiles: {
      idle: profile(strip(0, 4), 3), walk: profile(strip(1, 4), 6), working: profile(strip(2, 4), 4),
      thinking: profile(strip(3, 1, 0), 1), success: profile(strip(3, 1, 1), 1), waiting: profile(strip(3, 1, 2), 1), error: profile(strip(3, 1, 3), 1),
    }, actions: {} };
  }

  function normalizeLayer(value) {
    const invalid = () => { throw new Error('invalid-skin-manifest'); };
    if (value.type === 'video') {
      if (!validVideo(value.file) || ['columns', 'rows', 'frames', 'fps', 'rects'].some(key => value[key] !== undefined)) invalid();
      return { type: 'video', file: value.file };
    }
    if (value.type !== undefined) invalid();
    const profile = { file: value.file, columns: value.columns ?? 4, rows: value.rows ?? 4, frames: value.frames, fps: value.fps ?? 4 };
    if (!validFile(profile.file)) invalid();
    if (![profile.columns, profile.rows].every(number => Number.isInteger(number) && number >= 1 && number <= 64)) invalid();
    if (!Number.isFinite(profile.fps) || profile.fps < 1 || profile.fps > 30 || !Array.isArray(profile.frames) || !profile.frames.length || profile.frames.length > 128) invalid();
    if (!profile.frames.every(frame => Array.isArray(frame) && frame.length === 2 && frame.every(Number.isInteger) && frame[0] >= 0 && frame[0] < profile.columns && frame[1] >= 0 && frame[1] < profile.rows)) invalid();
    if (value.rects !== undefined) {
      if (!Array.isArray(value.rects) || value.rects.length !== profile.frames.length || value.rects.length > 128) invalid();
      if (!value.rects.every(rect => Array.isArray(rect) && rect.length === 4 && rect.every(Number.isInteger) && rect[0] >= 0 && rect[1] >= 0 && rect[2] > 0 && rect[3] > 0 && rect.every(number => number <= 32768))) invalid();
      profile.rects = value.rects.map(rect => [...rect]);
    }
    return profile;
  }

  function normalizeManifest(input) {
    const invalid = () => { throw new Error('invalid-skin-manifest'); };
    if (input !== undefined && (!input || input.schemaVersion !== 1 || typeof input !== 'object' || Array.isArray(input))) invalid();
    const result = defaultManifest();
    for (const [key, value] of Object.entries(input?.profiles ?? {})) {
      if (!validKey(key) || !value || typeof value !== 'object') invalid();
      const profile = normalizeLayer(value);
      profile.sisterFile = value.sisterFile ?? value.file.replace(/\.(?:png|webm)$/, '-sister.png');
      if (!validFile(profile.sisterFile)) invalid();
      if (value.forms !== undefined) {
        if (!value.forms || typeof value.forms !== 'object' || Array.isArray(value.forms) || Object.keys(value.forms).some(form => form !== 'sister')) invalid();
        const sister = value.forms.sister;
        if (!sister || typeof sister !== 'object' || Array.isArray(sister) || sister.forms !== undefined || sister.sisterFile !== undefined) invalid();
        if (sister.coverage !== undefined && !['shared', 'dedicated'].includes(sister.coverage)) invalid();
        // 新形态只继承格尺寸等默认值；Q版的像素矩形绝不能套到另一张姐姐图。
        const layer = normalizeLayer(sister.type === 'video' ? sister : { file: profile.sisterFile, columns: profile.columns, rows: profile.rows, frames: profile.frames, fps: profile.fps, ...sister });
        layer.coverage = sister.coverage ?? 'shared';
        profile.forms = { sister: layer };
      }
      result.profiles[key] = profile;
    }
    for (const [id, value] of Object.entries(input?.actions ?? {})) {
      if (!id || id.length > 160 || !value || !validKey(value.profile) || !result.profiles[value.profile] || !['dedicated', 'shared'].includes(value.coverage)) invalid();
      result.actions[id] = { profile: value.profile, coverage: value.coverage };
    }
    return result;
  }

  function effectiveProfile(profile, form = 'q') {
    if (!profile) return null;
    const { forms, sisterFile, ...base } = profile;
    if (form !== 'sister') return base;
    // 视频形态不向姐姐继承媒体类型；姐姐仍须提供自己的PNG或视频层。
    const { rects, type, ...common } = base;
    if (!forms?.sister) return type === 'video' ? { file: sisterFile, columns: 4, rows: 4, frames: [[0, 0]], fps: 1 } : { ...common, file: sisterFile };
    return { ...common, ...forms.sister };
  }

  function fallbackProfile(entry = {}) {
    if (entry.group === 'moves') return 'walk';
    if (entry.group === 'drag') return 'waiting';
    if (entry.group === 'event:workStatus') return WORK_PROFILES[entry.slot] ?? 'idle';
    if (entry.group === 'event:balance') return entry.slot < 2 ? 'success' : entry.slot < 4 ? 'idle' : 'error';
    const id = entry.id ?? '';
    if (/写|记录|书|代码|归档|擦桌/.test(id)) return 'working';
    if (/思考|张望|碎碎念/.test(id)) return 'thinking';
    if (/开心|庆祝|挥手|跳跃|舞/.test(id)) return 'success';
    if (/害羞|惊讶|惊醒|吓|生气|气急|汗/.test(id)) return 'error';
    return 'idle';
  }

  function profileReady(profile, assets, form) {
    if (!profile) return false;
    profile = effectiveProfile(profile, form);
    if (assets === undefined) return true;
    const asset = assets[profile.file];
    if (profile.type === 'video') return asset?.available === true && asset.type === 'video';
    if (profile.rects) return asset?.available === true && profile.rects.every(([x, y, width, height]) => x + width <= asset.width && y + height <= asset.height);
    // 允许小数格宽和竖长人体格；实际比例由PNG尺寸与有效网格共同确定。
    return asset?.available === true && asset.width >= profile.columns && asset.height >= profile.rows;
  }

  function resolveAction(entry, manifest, assets, form = 'q') {
    const explicit = manifest.actions[entry?.id];
    const fallback = fallbackProfile(entry);
    let profileId = explicit?.profile ?? fallback;
    let profile = manifest.profiles[profileId];
    let coverage = 'shared';
    let reason = 'base-profile';
    if (!profileReady(profile, assets, form)) {
      profileId = fallback; profile = manifest.profiles[profileId]; reason = 'dedicated-atlas-unavailable';
    } else if (explicit?.coverage === 'dedicated') {
      const signature = value => { const paint = effectiveProfile(value, form); return JSON.stringify([paint.file, paint.type === 'video' ? 'video' : paint.rects ? ['rects', paint.rects] : ['grid', paint.columns, paint.rows, paint.frames]]); };
      const ownFrames = signature(profile);
      // 改profile名字不能把同一组帧重复申报成多个专属动作。
      const uses = Object.values(manifest.actions).filter(action => signature(manifest.profiles[action.profile]) === ownFrames).length;
      const paint = effectiveProfile(profile, form);
      if (paint.coverage === 'shared') reason = 'shared-form-profile';
      else if ((paint.type === 'video' || paint.frames.length > 1) && uses === 1) { coverage = 'dedicated'; reason = 'dedicated-profile'; }
      else reason = paint.type !== 'video' && paint.frames.length <= 1 ? 'single-pose' : 'shared-profile';
    }
    if (!profileReady(profile, assets, form)) { coverage = 'missing'; reason = 'atlas-unavailable'; }
    return { id: entry?.id ?? '', profile: profileId, coverage, reason };
  }

  function buildCoverage(catalog, manifest, assets, form = 'q') {
    const actions = catalog.map(entry => ({ ...entry, ...resolveAction(entry, manifest, assets, form) }));
    const summary = { total: actions.length, dedicated: 0, shared: 0, missing: 0 };
    for (const action of actions) summary[action.coverage]++;
    return { summary, actions };
  }

  function isCalmMoment(sprite, profile) {
    return ['idle', 'success'].includes(profile) && (!sprite.workState || sprite.workState === 'success') && !sprite.frozen && !sprite.menuOpen && !sprite.chatOpen && !sprite.justDragged && !sprite.dragState?.active && !sprite.dragState?.dragging && sprite.moveRef == null && sprite.throwRef == null;
  }

  function advanceTransformation({ mode, state = {}, safe, now, random = Math.random }) {
    let until = Number.isFinite(state.until) ? state.until : 0;
    let nextEligibleAt = Number.isFinite(state.nextEligibleAt) ? state.nextEligibleAt : 0;
    if (mode !== 'occasional') return { form: mode === 'sister' ? 'sister' : 'q', until: 0, nextEligibleAt };
    if (until > now && safe) return { form: 'sister', until, nextEligibleAt };
    if (until > now && !safe) nextEligibleAt = Math.max(nextEligibleAt, now + 90000);
    if (until > 0) return { form: 'q', until: 0, nextEligibleAt };
    if (!safe || now < nextEligibleAt || random() >= 0.02) return { form: 'q', until: 0, nextEligibleAt };
    until = now + 7000 + Math.floor(Math.max(0, Math.min(1, random())) * 3000);
    return { form: 'sister', until, nextEligibleAt: until + 90000 };
  }

  return { catalogFromAnimations, defaultManifest, normalizeManifest, effectiveProfile, fallbackProfile, resolveAction, buildCoverage, profileReady, isCalmMoment, advanceTransformation };
});
