(function () {
  'use strict';
  const A = window.CodexSkinActions;
  const bridge = window.codexSkins;
  const shared = window.PetShared;
  if (!A || !bridge || !shared || typeof PetSprite !== 'function') {
    console.warn('[龙娘桌宠] 形象桥未就绪，保留原版显示。');
    return;
  }
  const controllers = new Set();
  const loadedAssets = new Set();
  const decodedImages = new Map();
  const failedAssets = new Set();
  const pendingAssets = new Map();
  const style = document.createElement('style');
  document.head.appendChild(style);
  let model;
  let revision = 0;
  let sequence = 0;
  let timer = null;
  let closed = false;
  const baseCss = '.codex-skin-active>video.pet-video{opacity:0!important}.codex-skin-layer{position:absolute;inset:0;pointer-events:none;z-index:0}.codex-skin-frame{position:absolute;left:50%;top:13.888889%;height:79.166667%;aspect-ratio:1;transform:translateX(-50%);background-repeat:no-repeat;pointer-events:none;animation-timing-function:steps(1,end);animation-iteration-count:infinite}.codex-skin-frame>canvas{position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none}';

  function position(profile, frame) {
    return `${profile.columns === 1 ? 0 : frame[0] / (profile.columns - 1) * 100}% ${profile.rows === 1 ? 0 : frame[1] / (profile.rows - 1) * 100}%`;
  }

  function rebuildStyles() {
    const rules = [baseCss];
    for (const character of model?.characters ?? []) for (const [id, base] of Object.entries(character.manifest.profiles)) for (const form of ['q', 'sister']) {
      const profile = A.effectiveProfile(base, form);
      const frames = profile.frames.map((frame, index) => `${index / profile.frames.length * 100}%{background-position:${position(profile, frame)}}`).join('');
      rules.push(`@keyframes codex-skin-${character.id}-${form}-${id}{${frames}100%{background-position:${position(profile, profile.frames.at(-1))}}}`);
    }
    style.textContent = rules.join('\n');
  }

  function loadAsset(url, needsDecoded = false) {
    if ((loadedAssets.has(url) && (!needsDecoded || decodedImages.has(url))) || failedAssets.has(url) || pendingAssets.has(url)) return;
    const image = new Image();
    const timeout = window.setTimeout(() => finish(false), 4000);
    const finish = ok => {
      window.clearTimeout(timeout);
      image.onload = null; image.onerror = null;
      pendingAssets.delete(url);
      if (ok) {
        loadedAssets.add(url); decodedImages.delete(url); decodedImages.set(url, image);
        // 只保留少量已解码atlas；活动canvas另外持有当前图，避免27包全部常驻内存。
        while (decodedImages.size > 4) decodedImages.delete(decodedImages.keys().next().value);
      }
      else { failedAssets.add(url); console.warn('[龙娘桌宠] 形象图片未能解码，保留原版显示。'); }
      if (!closed) for (const controller of controllers) refresh(controller, false);
    };
    // 先登记再设src，缓存命中也不会触发重复加载。
    pendingAssets.set(url, { image, timeout });
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  }

  function syncTransform(controller) {
    const sprite = controller.sprite;
    const video = sprite.front === 0 ? sprite.videoA : sprite.videoB;
    controller.layer.style.transform = video?.style.transform || '';
    controller.layer.style.transformOrigin = video?.style.transformOrigin || '';
    controller.frame.style.animationPlayState = sprite.frozen ? 'paused' : 'running';
  }

  function originalVisual(controller) {
    stopCanvas(controller);
    controller.sprite.stage.classList.remove('codex-skin-active');
    controller.layer.style.display = 'none';
    controller.visualKey = '';
  }

  function stopCanvas(controller) {
    if (controller.canvasRaf != null) window.cancelAnimationFrame(controller.canvasRaf);
    controller.canvasRaf = null; controller.canvasKey = null;
    if (controller.canvas) controller.canvas.style.display = 'none';
  }

  function startCanvas(controller, profile, asset) {
    if (controller.canvasKey === controller.visualKey && controller.canvasRaf != null) return true;
    const image = decodedImages.get(asset.url);
    if (!image) return false;
    if (!controller.canvas) {
      controller.canvas = document.createElement('canvas');
      controller.frame.appendChild(controller.canvas);
    }
    const canvas = controller.canvas;
    const cellWidth = asset.width / profile.columns; const cellHeight = asset.height / profile.rows;
    const ratio = cellWidth / cellHeight;
    canvas.width = ratio >= 1 ? 512 : Math.max(1, Math.round(512 * ratio));
    canvas.height = ratio >= 1 ? Math.max(1, Math.round(512 / ratio)) : 512;
    const context = canvas.getContext('2d');
    if (!context) return false;
    stopCanvas(controller);
    const key = controller.visualKey;
    controller.canvasKey = key; canvas.style.display = '';
    controller.frame.style.backgroundImage = 'none'; controller.frame.style.animationName = 'none';
    const sourceWidth = Math.max(cellWidth, ...profile.rects.map(rect => rect[2]));
    const sourceHeight = Math.max(cellHeight, ...profile.rects.map(rect => rect[3]));
    const scale = Math.min(canvas.width * 0.92 / sourceWidth, canvas.height * 0.92 / sourceHeight);
    const baseline = canvas.height * 0.96;
    let lastFrame = -1;
    const draw = () => {
      if (controller.disposed || controller.canvasKey !== key) return;
      const sprite = controller.sprite;
      const video = sprite.front === 0 ? sprite.videoA : sprite.videoB;
      const seconds = Number.isFinite(video?.currentTime) ? Math.max(0, video.currentTime) : 0;
      const index = Math.floor(seconds * profile.fps) % profile.rects.length;
      if (index !== lastFrame) {
        const [x, y, width, height] = profile.rects[index];
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, x, y, width, height, (canvas.width - width * scale) / 2, baseline - height * scale, width * scale, height * scale);
        lastFrame = index;
      }
      controller.canvasRaf = window.requestAnimationFrame(draw);
    };
    draw();
    return true;
  }

  function refresh(controller, allowRandom) {
    if (!model || controller.disposed) return;
    const sprite = controller.sprite;
    const selection = model.selection;
    const character = model.characters.find(item => item.id === selection.character);
    if (!character || controller.externalUrl) { originalVisual(controller); return; }
    const selectionKey = `${selection.character}/${selection.mode}`;
    if (controller.selectionKey !== selectionKey) {
      controller.selectionKey = selectionKey;
      controller.transformation = { form: 'q', until: 0, nextEligibleAt: controller.transformation?.nextEligibleAt ?? 0 };
    }
    const entry = controller.catalog.find(item => item.id === sprite.anim) ?? { id: sprite.anim, group: 'unknown' };
    const now = Date.now();
    controller.transformation = A.advanceTransformation({
      mode: selection.mode, state: controller.transformation, now,
      safe: A.isCalmMoment(sprite, A.fallbackProfile(entry)), random: allowRandom ? Math.random : () => 1,
    });
    const until = controller.transformation.until;
    if (controller.expiryAt !== until) {
      if (controller.expiryTimer != null) window.clearTimeout(controller.expiryTimer);
      controller.expiryTimer = null; controller.expiryAt = until;
      if (until > now) controller.expiryTimer = window.setTimeout(() => {
        controller.expiryTimer = null; controller.expiryAt = 0;
        refresh(controller, false);
      }, until - now);
    }
    const form = controller.transformation.form;
    if (character.originalVideo && form === 'q') {
      originalVisual(controller);
      window.__codexSkinDebug = { character: character.id, mode: selection.mode, form, action: sprite.anim, profile: 'original-video', coverage: 'dedicated', summary: { total: controller.catalog.length, dedicated: controller.catalog.length, shared: 0, missing: 0 } };
      return;
    }
    const resolved = A.resolveAction(entry, character.manifest, character.assets, form);
    const profile = A.effectiveProfile(character.manifest.profiles[resolved.profile], form);
    const asset = character.assets[profile.file];
    if (resolved.coverage === 'missing' || !asset?.available) { originalVisual(controller); return; }
    if (failedAssets.has(asset.url)) { originalVisual(controller); return; }
    if (!loadedAssets.has(asset.url) || (profile.rects && !decodedImages.has(asset.url))) {
      loadAsset(asset.url, Boolean(profile.rects));
      // 新图就绪前保留上一张角色画面；首次仍由原版视频出画。
      return;
    }
    const key = `${revision}/${character.id}/${form}/${resolved.profile}/${asset.url}`;
    if (controller.visualKey !== key) {
      controller.visualKey = key;
      controller.frame.style.backgroundImage = `url(${JSON.stringify(asset.url)})`;
      controller.frame.style.backgroundSize = `${profile.columns * 100}% ${profile.rows * 100}%`;
      controller.frame.style.aspectRatio = `${asset.width / profile.columns} / ${asset.height / profile.rows}`;
      controller.frame.style.backgroundPosition = position(profile, profile.frames[0]);
      controller.frame.style.animationName = profile.frames.length > 1 ? `codex-skin-${character.id}-${form}-${resolved.profile}` : 'none';
      controller.frame.style.animationDuration = `${profile.frames.length / profile.fps}s`;
    }
    if (profile.rects) {
      if (!startCanvas(controller, profile, asset)) { originalVisual(controller); return; }
    } else stopCanvas(controller);
    controller.layer.style.display = '';
    sprite.stage.classList.add('codex-skin-active');
    syncTransform(controller);
    window.__codexSkinDebug = { character: character.id, mode: selection.mode, form, action: sprite.anim, profile: resolved.profile, coverage: resolved.coverage, summary: A.buildCoverage(controller.catalog, character.manifest, character.assets, form).summary };
  }

  function ensure(sprite) {
    if (sprite.__codexSkinController) return sprite.__codexSkinController;
    const layer = document.createElement('div');
    layer.className = 'codex-skin-layer'; layer.style.display = 'none';
    const frame = document.createElement('div'); frame.className = 'codex-skin-frame';
    layer.appendChild(frame); sprite.stage.appendChild(layer);
    const controller = { id: ++sequence, sprite, layer, frame, catalog: A.catalogFromAnimations(sprite.animations), transformation: {}, disposed: false };
    const observer = new MutationObserver(() => syncTransform(controller));
    for (const video of [sprite.videoA, sprite.videoB]) observer.observe(video, { attributes: true, attributeFilter: ['style', 'class'] });
    controller.observer = observer;
    sprite.__codexSkinController = controller;
    controllers.add(controller);
    if (timer === null) timer = window.setInterval(() => { for (const item of controllers) refresh(item, true); }, 1500);
    return controller;
  }

  const proto = PetSprite.prototype;
  const switchTo = proto.switchTo;
  proto.switchTo = function (next, once, playbackId, url) {
    const controller = ensure(this);
    controller.externalUrl = Boolean(url);
    // 原video继续承担duration/currentTime、ended、playback回执与移动驱动，只替换可见画面。
    const result = switchTo.apply(this, arguments);
    refresh(controller, false);
    return result;
  };
  const freeze = proto.applyFreeze;
  proto.applyFreeze = function () { const result = freeze.apply(this, arguments); if (this.__codexSkinController) refresh(this.__codexSkinController, false); return result; };
  const dispose = proto.dispose;
  proto.dispose = function () {
    const controller = this.__codexSkinController;
    if (controller) { controller.disposed = true; stopCanvas(controller); controller.observer.disconnect(); if (controller.expiryTimer != null) window.clearTimeout(controller.expiryTimer); controllers.delete(controller); }
    if (!controllers.size && timer !== null) { window.clearInterval(timer); timer = null; }
    return dispose.apply(this, arguments);
  };

  function decorateTree(nodes) {
    const selected = model?.characters.find(character => character.id === model.selection.character);
    const form = model?.selection.mode === 'sister' ? 'sister' : 'q';
    return nodes.map(node => {
      const copy = { ...node };
      if (copy.children) copy.children = decorateTree(copy.children);
      if (copy.action === 'chat' && window.codexChatPanel?.open) copy.label = '图文对话';
      if (copy.anim && selected && !(selected.originalVideo && form === 'q')) {
        const entry = model.catalog?.find(item => item.id === copy.anim) ?? { id: copy.anim };
        const resolved = A.resolveAction(entry, selected.manifest, selected.assets, form);
        if (resolved.coverage !== 'dedicated') copy.hint = resolved.coverage === 'missing' ? '专属帧待制作' : '基础动画代用';
      }
      return copy;
    });
  }

  const mountContextMenu = shared.mountContextMenu;
  shared.mountContextMenu = function (options) {
    const isPetMenu = options.tree.some(item => ['chat', 'open-site'].includes(item.action));
    if (!isPetMenu) return mountContextMenu.apply(this, arguments);
    const tree = decorateTree(options.tree);
    if (window.codexTaskPanel?.open) tree.push({ label: '操作任务', action: 'codex-task-panel' });
    if (model) tree.push({ label: '形象', children: model.characters.map(character => ({ label: character.label, children: [
      ['q', 'Q版'], ['sister', '姐姐版'], ['occasional', '偶尔变身'],
    ].map(([mode, label]) => ({ label: `${model.selection.character === character.id && model.selection.mode === mode ? '✓ ' : ''}${label}`, action: 'codex-select-skin', character: character.id, mode, hint: character.available[mode] ? '' : '素材未就绪' })) })) });
    return mountContextMenu.call(this, { ...options, tree });
  };

  const menuAction = proto.onMenuAction;
  function openPanel(open) {
    const failed = () => console.warn('[龙娘桌宠] 窗口未能打开。');
    try { void Promise.resolve(open()).catch(failed); } catch { failed(); }
  }
  proto.onMenuAction = function (leaf) {
    if (leaf?.action === 'codex-select-skin') {
      this.closeMenu();
      void bridge.select({ character: leaf.character, mode: leaf.mode }).then(applyModel).catch(() => console.warn('[龙娘桌宠] 形象未能切换，请确认本地素材已就绪。'));
      return;
    }
    if (leaf?.action === 'codex-task-panel' && window.codexTaskPanel?.open) { this.closeMenu(); openPanel(() => window.codexTaskPanel.open()); return; }
    if (leaf?.action === 'chat' && window.codexChatPanel?.open) { this.closeMenu(); openPanel(() => window.codexChatPanel.open()); return; }
    return menuAction.apply(this, arguments);
  };

  function applyModel(value) {
    if (closed || !value || !Array.isArray(value.characters)) return;
    model = value; revision++; failedAssets.clear();
    rebuildStyles();
    for (const controller of controllers) refresh(controller, false);
  }
  const unsubscribe = bridge.onChanged(applyModel);
  void bridge.getState().then(applyModel).catch(() => console.warn('[龙娘桌宠] 形象读取失败，保留原版显示。'));
  window.addEventListener('beforeunload', () => {
    closed = true; unsubscribe?.();
    if (timer !== null) window.clearInterval(timer);
    for (const controller of controllers) { stopCanvas(controller); controller.observer.disconnect(); if (controller.expiryTimer != null) window.clearTimeout(controller.expiryTimer); }
    for (const { image, timeout } of pendingAssets.values()) { image.onload = null; image.onerror = null; window.clearTimeout(timeout); }
    pendingAssets.clear(); decodedImages.clear(); controllers.clear();
  }, { once: true });
})();
