(function () {
  'use strict';
  const A = window.CodexSkinActions;
  const L = window.CodexLocale;
  const bridge = window.codexSkins;
  const shared = window.PetShared;
  if (!A || !bridge || !shared || typeof PetSprite !== 'function') {
    console.warn('[龙娘桌宠] 形象桥未就绪，保留原版显示。');
    return;
  }
  const controllers = new Set();
  const decodedImages = new Map();
  const failedAssets = new Set();
  const pendingAssets = new Map();
  const style = document.createElement('style');
  document.head.appendChild(style);
  // 覆盖层一一对应原videoA/B，沿用180ms交接；图帧不另开CSS播放时钟。
  style.textContent = '.codex-skin-active>video.pet-video{opacity:0!important}.codex-skin-layer{position:absolute;inset:0;pointer-events:none;z-index:0;opacity:0;transition:opacity .18s ease}.codex-skin-frame{position:absolute;left:50%;top:13.888889%;height:79.166667%;transform:translateX(-50%);pointer-events:none}.codex-skin-frame>canvas{display:block;width:100%;height:100%;pointer-events:none}@media(prefers-reduced-motion:reduce){.codex-skin-layer{transition:none!important}}';
  let model;
  let modelRevision = 0;
  let modelSignature = '';
  let assetSignature = '';
  let assetRevision = 0;
  let timer = null;
  let closed = false;
  const t = key => L?.t(key, {}, model?.locale) ?? key;
  const defer = fn => (window.queueMicrotask || (callback => Promise.resolve().then(callback)))(fn);

  function loadAsset(url) {
    if (decodedImages.has(url) || failedAssets.has(url) || pendingAssets.has(url)) return;
    const image = new Image();
    const timeout = window.setTimeout(() => finish(false), 4000);
    const finish = ok => {
      window.clearTimeout(timeout);
      image.onload = null; image.onerror = null;
      pendingAssets.delete(url);
      if (ok) {
        decodedImages.delete(url); decodedImages.set(url, image);
        // 活动canvas另持本帧；缓存最多四张，避免全部atlas常驻内存。
        while (decodedImages.size > 4) decodedImages.delete(decodedImages.keys().next().value);
      } else {
        failedAssets.add(url);
        console.warn('[龙娘桌宠] 形象图片未能解码，保留原版显示。');
      }
      if (!closed) for (const controller of controllers) refresh(controller, false);
    };
    pendingAssets.set(url, { image, timeout });
    image.onload = () => finish(true); image.onerror = () => finish(false); image.src = url;
  }

  function stopLayer(layer) {
    if (layer.raf != null) window.cancelAnimationFrame(layer.raf);
    layer.raf = null;
  }
  function hold(controller) {
    for (const layer of controller.layers) stopLayer(layer);
  }
  function abandonFailedRequest(controller) {
    const request = controller.pendingRequest;
    const sprite = controller.sprite;
    // 上游error或10秒加载守卫会清pending而不提交front，旧有效画面此时可以继续。
    if (!request || sprite.pending || sprite.gen < request.gen || controller.layers[sprite.front]?.request === request) return;
    controller.pendingRequest = null;
    for (const layer of controller.layers) if (layer.request === request) layer.request = null;
  }
  function syncTransform(controller) {
    for (const layer of controller.layers) {
      layer.layer.style.transform = layer.video.style.transform || '';
      layer.layer.style.transformOrigin = layer.video.style.transformOrigin || '';
    }
  }
  function originalVisual(controller) {
    hold(controller);
    controller.sprite.stage.classList.remove('codex-skin-active');
    for (const layer of controller.layers) layer.layer.style.opacity = '0';
  }
  function syncName(controller, character) {
    const name = character?.copy?.name || character?.label;
    if (typeof name !== 'string' || !name) return;
    controller.displayName = name;
    controller.sprite.hit?.setAttribute('aria-label', name);
    if (controller.sprite.tip) controller.sprite.tip.textContent = name;
  }

  function visual(controller, request, form) {
    const character = model?.characters.find(value => value.id === model.selection.character);
    if (!character || !request || request.external) return null;
    const entry = controller.catalog.find(value => value.id === request.action) || { id: request.action, group: 'unknown' };
    if (character.originalVideo && form === 'q') return { character, entry, original: true };
    const resolved = A.resolveAction(entry, character.manifest, character.assets, form);
    const profile = A.effectiveProfile(character.manifest.profiles[resolved.profile], form);
    const asset = profile && character.assets[profile.file];
    return { character, entry, resolved, profile, asset };
  }
  function preload(controller, request) {
    const form = model?.selection.mode === 'sister' ? 'sister' : controller.transformation.form || 'q';
    const value = visual(controller, request, form);
    if (!value?.original && value?.asset?.available && value.resolved.coverage !== 'missing') loadAsset(value.asset.url);
  }

  function frameIndex(paint, video) {
    const { profile, entry } = paint;
    const count = profile.frames.length;
    const seconds = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
    if (video.ended) return count - 1;
    // 漫游的视频时钟同时驱动真实位移。准备、收尾静止，步态仅在实际行进窗口循环。
    if (entry.group === 'moves') {
      const lead = Math.max(0, Number(entry.params?.leadSec) || 0);
      const tail = Math.max(0, Number(entry.params?.tailSec) || 0);
      if (seconds <= lead) return 0;
      if (Number.isFinite(video.duration) && seconds >= video.duration - tail) return count - 1;
      return Math.floor((seconds - lead) * profile.fps) % count;
    }
    const index = Math.floor(seconds * profile.fps);
    // 一次播放按素材原fps走完并保持末姿势，不把四姿势拉长为十秒，也不伪造中间帧。
    return video.loop ? index % count : Math.min(count - 1, index);
  }

  function paintLayer(controller, layer, value, form) {
    const { profile, asset, entry } = value;
    const key = JSON.stringify([assetRevision, layer.request.gen, model.selection.character, form, value.resolved.profile, asset.url, profile]);
    if (layer.paintKey !== key) {
      stopLayer(layer);
      const image = decodedImages.get(asset.url);
      if (!image) return false;
      const cellWidth = asset.width / profile.columns, cellHeight = asset.height / profile.rows;
      const ratio = cellWidth / cellHeight;
      layer.canvas.width = ratio >= 1 ? 512 : Math.max(1, Math.round(512 * ratio));
      layer.canvas.height = ratio >= 1 ? Math.max(1, Math.round(512 / ratio)) : 512;
      layer.frame.style.aspectRatio = `${cellWidth} / ${cellHeight}`;
      const context = layer.canvas.getContext('2d');
      if (!context) return false;
      // 源框只裁相邻身体，画面位置仍按统一格内坐标；不能每帧重新居中/贴脚而抹掉跳跃。
      const frames = profile.frames.map(([column, row], index) => {
        const rect = profile.rects?.[index] || [column * cellWidth, row * cellHeight, cellWidth, cellHeight];
        return { rect, x: rect[0] - column * cellWidth, y: rect[1] - row * cellHeight };
      });
      const left = Math.min(0, ...frames.map(frame => frame.x));
      const right = Math.max(cellWidth, ...frames.map(frame => frame.x + frame.rect[2]));
      const top = Math.min(0, ...frames.map(frame => frame.y));
      const bottom = Math.max(cellHeight, ...frames.map(frame => frame.y + frame.rect[3]));
      const scale = Math.min(layer.canvas.width * .92 / (right - left), layer.canvas.height * .92 / (bottom - top));
      const originX = layer.canvas.width / 2 - (left + right) * scale / 2;
      const originY = layer.canvas.height * .96 - bottom * scale;
      layer.paintKey = key;
      layer.paint = { image, context, frames, scale, originX, originY, profile, entry, request: layer.request, last: -1 };
    }
    const draw = () => {
      if (controller.disposed || controller.active !== layer || controller.pendingRequest || !layer.paint) return;
      const p = layer.paint, index = frameIndex(p, layer.video);
      if (index !== p.last) {
        const frame = p.frames[index], [x, y, width, height] = frame.rect;
        p.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        p.context.drawImage(p.image, x, y, width, height, p.originX + frame.x * p.scale, p.originY + frame.y * p.scale, width * p.scale, height * p.scale);
        p.last = index;
      }
      if (layer.video.paused === false && !layer.video.ended && layer.raf == null) layer.raf = window.requestAnimationFrame(() => { layer.raf = null; draw(); });
    };
    layer.draw = draw;
    draw();
    return true;
  }

  function refresh(controller, allowRandom) {
    if (!model || controller.disposed) return;
    abandonFailedRequest(controller);
    const sprite = controller.sprite, selection = model.selection;
    const character = model.characters.find(value => value.id === selection.character);
    syncName(controller, character);
    syncTransform(controller);
    const layer = controller.active;
    if (!layer || controller.pendingRequest) return;
    const request = layer.request;
    if (request.external || !character) { originalVisual(controller); return; }
    const selectionKey = `${selection.character}/${selection.mode}`;
    if (controller.selectionKey !== selectionKey) {
      controller.selectionKey = selectionKey;
      controller.transformation = { form: 'q', until: 0, nextEligibleAt: controller.transformation.nextEligibleAt || 0 };
      hold(controller);
    }
    const entry = controller.catalog.find(value => value.id === request.action) || { id: request.action, group: 'unknown' };
    const now = Date.now();
    controller.transformation = A.advanceTransformation({ mode: selection.mode, state: controller.transformation, now, safe: A.isCalmMoment(sprite, A.fallbackProfile(entry)), random: allowRandom ? Math.random : () => 1 });
    const until = controller.transformation.until;
    if (controller.expiryAt !== until) {
      if (controller.expiryTimer != null) window.clearTimeout(controller.expiryTimer);
      controller.expiryTimer = null; controller.expiryAt = until;
      if (until > now) controller.expiryTimer = window.setTimeout(() => { controller.expiryTimer = null; controller.expiryAt = 0; refresh(controller, false); }, until - now);
    }
    const form = controller.transformation.form;
    const value = visual(controller, request, form);
    const debug = { character: character.id, mode: selection.mode, form, action: request.action };
    if (value?.original) {
      originalVisual(controller);
      window.__codexSkinDebug = { ...debug, profile: 'original-video', playback: 'original-video', coverage: 'dedicated' };
      return;
    }
    if (!value?.asset?.available || value.resolved.coverage === 'missing' || failedAssets.has(value.asset.url)) { originalVisual(controller); return; }
    if (!decodedImages.has(value.asset.url)) {
      hold(controller); loadAsset(value.asset.url); return;
    }
    if (!paintLayer(controller, layer, value, form)) { originalVisual(controller); return; }
    for (const other of controller.layers) other.layer.style.opacity = other === layer ? '1' : '0';
    sprite.stage.classList.add('codex-skin-active');
    window.__codexSkinDebug = { ...debug, profile: value.resolved.profile, coverage: value.resolved.coverage, playback: 'frame-prototype' };
  }

  function reconcile(controller) {
    if (controller.disposed) return;
    abandonFailedRequest(controller);
    syncTransform(controller);
    const layer = controller.layers[controller.sprite.front];
    if (!layer?.request || layer.video.readyState < 2) return;
    if (controller.active !== layer || controller.activeRequest !== layer.request) {
      hold(controller);
      controller.active = layer; controller.activeRequest = layer.request;
      if (controller.pendingRequest === layer.request) controller.pendingRequest = null;
      // 上游单候选工作档位只调用switchTo，漏同步anim会使回idle时无法解除loop。
      // 只在真实front提交后对齐上游状态；请求阶段仍独立记录代次，不提前伪写anim。
      if (!controller.pendingRequest) {
        controller.sprite.anim = layer.request.action;
        controller.sprite.once = !layer.video.loop;
      }
    }
    refresh(controller, false);
  }
  function ensure(sprite) {
    if (sprite.__codexSkinController) return sprite.__codexSkinController;
    const controller = { sprite, layers: [], catalog: A.catalogFromAnimations(sprite.animations), transformation: {}, disposed: false, listeners: [] };
    const schedule = () => {
      if (controller.queued || controller.disposed) return;
      controller.queued = true;
      // loadeddata监听器先于上游onReady注册，微任务必须等上游提交front后再决定可见动作。
      defer(() => { controller.queued = false; reconcile(controller); });
    };
    const observer = new MutationObserver(schedule);
    for (const video of [sprite.videoA, sprite.videoB]) {
      const layer = document.createElement('div'); layer.className = 'codex-skin-layer'; layer.style.opacity = '0'; layer.style.transition = 'opacity 0.18s ease';
      const frame = document.createElement('div'); frame.className = 'codex-skin-frame';
      const canvas = document.createElement('canvas'); frame.appendChild(canvas); layer.appendChild(frame); sprite.stage.appendChild(layer);
      controller.layers.push({ video, layer, frame, canvas, raf: null, paint: null });
      observer.observe(video, { attributes: true, attributeFilter: ['style', 'class'] });
      for (const name of ['loadeddata', 'play', 'playing', 'pause', 'ended', 'seeking', 'seeked', 'timeupdate', 'error']) {
        const handler = () => { if (name === 'pause' || name === 'ended') hold(controller); schedule(); };
        video.addEventListener(name, handler); controller.listeners.push([video, name, handler]);
      }
    }
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
    // 防重请求沿用原上游判断，不替它重播、改anim、改朝向或改物理状态。
    if (next && !(this.pending?.anim === next && this.pending.once === once)) {
      const layer = controller.layers[this.front === 0 ? 1 : 0];
      const request = { action: next, once, external: Boolean(url), gen: this.gen + 1 };
      layer.request = request; controller.pendingRequest = request;
      hold(controller); preload(controller, request);
    }
    const result = switchTo.apply(this, arguments);
    reconcile(controller);
    return result;
  };
  const freeze = proto.applyFreeze;
  proto.applyFreeze = function () { const result = freeze.apply(this, arguments); if (this.__codexSkinController) reconcile(this.__codexSkinController); return result; };
  const renderTip = proto.renderTip;
  if (renderTip) proto.renderTip = function () {
    const name = this.__codexSkinController?.displayName;
    if (!name) return renderTip.apply(this, arguments);
    const pet = this.pet;
    try { this.pet = { ...pet, name }; return renderTip.apply(this, arguments); }
    finally { this.pet = pet; }
  };
  function clearPendingAssets() {
    for (const { image, timeout } of pendingAssets.values()) { image.onload = null; image.onerror = null; window.clearTimeout(timeout); }
    pendingAssets.clear(); decodedImages.clear();
  }
  function disposeController(controller) {
    controller.disposed = true; hold(controller); controller.observer.disconnect();
    if (controller.expiryTimer != null) window.clearTimeout(controller.expiryTimer);
    for (const [video, name, handler] of controller.listeners) video.removeEventListener(name, handler);
    for (const layer of controller.layers) { layer.paint = null; layer.layer.remove?.(); }
    controllers.delete(controller);
  }
  const dispose = proto.dispose;
  proto.dispose = function () {
    if (this.__codexSkinController) disposeController(this.__codexSkinController);
    if (!controllers.size) { if (timer !== null) window.clearInterval(timer); timer = null; clearPendingAssets(); }
    return dispose.apply(this, arguments);
  };

  function hasRegisteredMenu(nodes) {
    return Array.isArray(nodes) && nodes.some(node => node.action === 'third-party' || hasRegisteredMenu(node.children));
  }
  function decorateTree(nodes, preserveRegistered = false) {
    const selected = model?.characters.find(character => character.id === model.selection.character);
    const form = model?.selection.mode === 'sister' ? 'sister' : 'q';
    return nodes.map(node => {
      const copy = { ...node };
      // 更多下的owner分组没有owner字段；整段原文都是注册协议数据，仅根标题可翻译。
      const registeredChildren = preserveRegistered || (copy.label === shared.MORE_MENU_LABEL && hasRegisteredMenu(copy.children));
      if (copy.children) copy.children = decorateTree(copy.children, registeredChildren);
      if (preserveRegistered || copy.action === 'third-party') return copy;
      if (typeof copy.label === 'string') copy.label = copy.anim ? selected?.copy?.actionLabels?.[copy.anim] || t(copy.label) : t(copy.label);
      if (copy.action === 'chat' && window.codexChatPanel?.open) copy.label = t('图文对话');
      if (copy.anim && selected && !(selected.originalVideo && form === 'q')) {
        const entry = model.catalog?.find(item => item.id === copy.anim) || { id: copy.anim };
        const resolved = A.resolveAction(entry, selected.manifest, selected.assets, form);
        copy.hint = [t('逐帧试作'), resolved.coverage !== 'dedicated' ? t(resolved.coverage === 'missing' ? '专属帧待制作' : '基础动画代用') : ''].filter(Boolean).join(' · ');
      }
      return copy;
    });
  }
  const mountContextMenu = shared.mountContextMenu;
  shared.mountContextMenu = function (options) {
    if (!options.tree.some(item => ['chat', 'open-site'].includes(item.action))) return mountContextMenu.apply(this, arguments);
    const tree = decorateTree(options.tree);
    if (window.codexTaskPanel?.open) tree.push({ label: t('操作任务'), action: 'codex-task-panel' });
    if (model) tree.push({ label: t('形象'), children: model.characters.map(character => ({ label: character.copy?.name || t(character.label), children: [
      ['q', 'Q版'], ['sister', '姐姐版'], ['occasional', '偶尔变身'],
    ].map(([mode, label]) => ({ label: `${model.selection.character === character.id && model.selection.mode === mode ? '✓ ' : ''}${t(label)}`, action: 'codex-select-skin', character: character.id, mode, hint: character.available[mode] ? '' : t('素材未就绪') })) })) });
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
    // 桥模型未提供revision；本地代次仍须记录有效推送，避免初始读取倒灌旧选择。
    modelRevision++;
    const signature = JSON.stringify(value);
    if (signature === modelSignature) return;
    modelSignature = signature;
    const assets = JSON.stringify(value.characters.map(({ id, assets, manifest }) => ({ id, assets, manifest })));
    if (assetSignature && assetSignature !== assets) { clearPendingAssets(); failedAssets.clear(); assetRevision++; }
    assetSignature = assets;
    model = value; L?.setLocale(value.locale || 'zh-CN');
    for (const controller of controllers) refresh(controller, false);
  }
  const unsubscribe = bridge.onChanged(applyModel);
  const initialRevision = modelRevision;
  void bridge.getState().then(value => { if (modelRevision === initialRevision) applyModel(value); }).catch(() => console.warn('[龙娘桌宠] 形象读取失败，保留原版显示。'));
  window.addEventListener('beforeunload', () => {
    closed = true; unsubscribe?.();
    if (timer !== null) window.clearInterval(timer);
    for (const controller of [...controllers]) disposeController(controller);
    clearPendingAssets();
  }, { once: true });
})();
