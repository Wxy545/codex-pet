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
  style.textContent = '.codex-skin-active>video.pet-video{opacity:0!important}.codex-skin-layer{position:absolute;inset:0;pointer-events:none;z-index:0;opacity:0;transition:opacity .18s ease}.codex-skin-frame{position:absolute;left:50%;top:13.888889%;height:79.166667%;transform:translateX(-50%);pointer-events:none}.codex-skin-frame>canvas,.codex-skin-frame>video{display:block;width:100%;height:100%;pointer-events:none;object-fit:contain}@media(prefers-reduced-motion:reduce){.codex-skin-layer{transition:none!important}}';
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
      if (!closed) for (const controller of controllers) refresh(controller);
    };
    pendingAssets.set(url, { image, timeout });
    image.onload = () => finish(true); image.onerror = () => finish(false); image.src = url;
  }

  function pauseMedia(media) {
    if (!media || (!media.playing && media.element.paused)) return;
    // pause会打断尚未兑现的play Promise；代次失效后不得清掉新一次播放或把AbortError记为坏素材。
    media.playAttempt = (media.playAttempt || 0) + 1; media.playing = false;
    if (!media.element.paused) media.element.pause();
  }
  function stopLayer(layer) {
    if (layer.raf != null) window.cancelAnimationFrame(layer.raf);
    layer.raf = null;
    pauseMedia(layer.media);
  }
  function releaseMedia(layer) {
    const media = layer.media;
    if (!media) return;
    layer.media = null;
    window.clearTimeout(media.timeout);
    for (const [name, handler] of media.listeners) media.element.removeEventListener(name, handler);
    media.element.pause(); media.element.removeAttribute('src'); media.element.load(); media.element.remove();
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

  function visual(controller, request) {
    const character = model?.characters.find(value => value.id === model.selection.character);
    if (!character || !request || request.external) return null;
    const entry = controller.catalog.find(value => value.id === request.action) || { id: request.action, group: 'unknown' };
    if (character.originalVideo) return { character, entry, original: true };
    const resolved = A.resolveAction(entry, character.manifest, character.assets);
    const profile = character.manifest.profiles[resolved.profile];
    const asset = profile && character.assets[profile.file];
    return { character, entry, resolved, profile, asset };
  }
  function readyNativeAction(character, id) {
    const explicit = character?.manifest.actions[id];
    if (!explicit) return false;
    const profile = character.manifest.profiles[explicit.profile];
    const asset = profile && character.assets[profile.file];
    return profile?.type === 'video' && A.profileReady(profile, character.assets) && !failedAssets.has(asset?.url);
  }
  function coreCharacter() {
    const character = model?.characters.find(value => value.id === model.selection.character);
    if (!character || character.originalVideo) return null;
    const idle = character.manifest.profiles.idle;
    return idle?.type === 'video' && A.profileReady(idle, character.assets) && !failedAssets.has(character.assets[idle.file]?.url) ? character : null;
  }
  function currentCharacter() {
    return model?.characters.find(value => value.id === model.selection.character);
  }
  function actionEntry(id) {
    const known = model?.catalog?.find(entry => entry.id === id);
    if (known) return known;
    for (const controller of controllers) {
      const entry = controller.catalog.find(value => value.id === id);
      if (entry) return entry;
    }
    return { id };
  }
  function textFreeGreeting(character, id) {
    return character && !character.originalVideo && character.manifest.actions[id]?.profile === 'greeting' && readyNativeAction(character, id);
  }
  function visibleCategories(categories, character) {
    return (categories ?? []).filter(category => !(model?.locale === 'en' && character?.originalVideo && category.id === '文字'));
  }
  function readyEventAction(character, id) {
    const entry = actionEntry(id);
    if (!['event:balance', 'event:whisper', 'event:workStatus'].includes(entry.group)) return false;
    const resolved = A.resolveAction(entry, character.manifest, character.assets);
    const profile = character.manifest.profiles[resolved.profile];
    return profile?.type === 'video' && A.profileReady(profile, character.assets) && !failedAssets.has(character.assets[profile.file]?.url);
  }
  const isNoMirrorAnimation = shared.isNoMirrorAnimation;
  shared.isNoMirrorAnimation = function (categories, id) {
    // 新角色的招手片没有烘焙文字，不继承原文字槽位镜像限制；原鱼继续走上游判断。
    return textFreeGreeting(currentCharacter(), id) ? false : isNoMirrorAnimation.apply(this, arguments);
  };
  function preload(controller, request) {
    const value = visual(controller, request);
    if (!value?.original && value?.profile.type !== 'video' && value?.asset?.available && value.resolved.coverage !== 'missing') loadAsset(value.asset.url);
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

  function paintLayer(controller, layer, value) {
    if (layer.media) { releaseMedia(layer); layer.paintKey = null; }
    const { profile, asset, entry } = value;
    const key = JSON.stringify([assetRevision, layer.request.gen, model.selection.character, value.resolved.profile, asset.url, profile]);
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

  function finishNativeMove(controller, video) {
    const layer = controller.layers.find(value => value.video === video);
    const request = layer?.request, sprite = controller.sprite, plan = request?.movePlan;
    // 低刷新时可能跳过最后的收尾帧；只替仍有效的本次自然结束补交原规划落点。
    if (!video.ended || !request?.nativeMove || !plan || controller.active !== layer || controller.activeRequest !== request || controller.pendingRequest || sprite.pending || sprite.gen !== request.gen || sprite.frozen || sprite.moveRef == null) return;
    sprite.stopMove();
    sprite.sendBounds(plan.targetRatio * VIEW.w - sprite.halfW, plan.startYRatio * VIEW.h - sprite.halfH);
    sprite.customPos = { rx: plan.targetRatio, ry: plan.startYRatio };
  }

  function paintMoveVideo(controller, layer, value) {
    // 原生走路直接由上游video自己的解码帧绘制；位移、画面和结束只用这一只媒体时钟。
    if (layer.media) releaseMedia(layer);
    const source = layer.video;
    if (source.readyState < 2 || !source.videoWidth || !source.videoHeight) return false;
    const key = JSON.stringify(['move-source', layer.request.gen, value.asset.url]);
    if (layer.paintKey !== key) {
      stopLayer(layer); layer.paint = null; layer.paintKey = key;
      const ratio = source.videoWidth / source.videoHeight;
      layer.frame.style.aspectRatio = `${source.videoWidth} / ${source.videoHeight}`;
      layer.canvas.width = Math.max(1, Math.round(512 * Math.min(1, ratio)));
      layer.canvas.height = Math.max(1, Math.round(512 / Math.max(1, ratio)));
    }
    layer.canvas.style.display = 'block';
    const context = layer.canvas.getContext('2d');
    if (!context) return false;
    const draw = () => {
      if (controller.disposed || controller.active !== layer || controller.pendingRequest) return;
      context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      context.drawImage(source, 0, 0, source.videoWidth, source.videoHeight, 0, 0, layer.canvas.width, layer.canvas.height);
      if (!source.paused && !source.ended && layer.raf == null) layer.raf = window.requestAnimationFrame(() => { layer.raf = null; draw(); });
    };
    layer.draw = draw; draw();
    return true;
  }

  function paintVideoLayer(controller, layer, value) {
    if (layer.request.nativeMove) return paintMoveVideo(controller, layer, value);
    const identity = JSON.stringify([assetRevision, model.selection.character, value.asset.url]);
    const key = JSON.stringify([assetRevision, layer.request.gen, model.selection.character, value.resolved.profile, value.asset.url]);
    if (layer.media?.key !== key) {
      // 重复同一待机仍由原状态机发新请求；先快照可见相位，释放旧缓冲不能把它清零。
      const previous = value.entry.group === 'idle' && controller.layers.find(item => item.layer.style.opacity === '1' && item.media?.identity === identity && item.media.group === 'idle')?.media;
      const resumeAt = previous?.ready && Number.isFinite(previous.element.currentTime) ? Math.max(0, previous.element.currentTime) : 0;
      stopLayer(layer); releaseMedia(layer); layer.paint = null; layer.paintKey = null;
      const element = document.createElement('video');
      element.muted = true; element.playsInline = true; element.preload = 'auto';
      element.style.display = 'none';
      const media = { key, identity, group: value.entry.group, element, ready: false, listeners: [] };
      layer.media = media; layer.frame.appendChild(element);
      const listen = (name, handler) => { element.addEventListener(name, handler); media.listeners.push([name, handler]); };
      const failed = () => {
        if (controller.disposed || layer.media !== media) return;
        window.clearTimeout(media.timeout); failedAssets.add(value.asset.url);
        refresh(controller);
      };
      const ready = () => {
        if (controller.disposed || layer.media !== media || element.readyState < 2) return;
        window.clearTimeout(media.timeout); media.ready = true;
        layer.frame.style.aspectRatio = `${element.videoWidth} / ${element.videoHeight}`;
        refresh(controller);
      };
      listen('loadeddata', () => {
        if (controller.disposed || layer.media !== media || element.readyState < 2 || media.seekRequested) return;
        if (resumeAt > 0) {
          media.seekRequested = true;
          media.seekTarget = Number.isFinite(element.duration) && element.duration > 0 ? resumeAt % element.duration : resumeAt;
          // 等目标帧完成解码再淡入，不能先显示新源的第零帧。
          element.currentTime = media.seekTarget;
          return;
        }
        ready();
      });
      listen('seeked', () => {
        if (media.seekRequested && Math.abs(element.currentTime - media.seekTarget) < .1) ready();
      });
      listen('error', failed);
      listen('ended', () => {
        if (controller.disposed || layer.media !== media) return;
        const sprite = controller.sprite;
        // 拿起期间由pointerUp结束拖拽，素材结束不能提前报结束或接回待机。
        if (value.entry.group === 'drag' && (sprite.dragState?.active || sprite.dragState?.dragging)) return;
        media.ended = true;
        // 单候选工作回空闲时上游只解除loop，不重发once请求；沿它已安装的onended收尾。
        const workReturnedIdle = value.entry.group === 'event:workStatus' && sprite.workState == null && !layer.video.loop && typeof layer.video.onended === 'function';
        if (!element.ended || media.completed || value.entry.group === 'idle' || value.entry.group === 'moves' || (!layer.request.once && !workReturnedIdle) || controller.active !== layer || controller.activeRequest !== layer.request || controller.pendingRequest || sprite.pending || sprite.gen !== layer.request.gen || sprite.frozen) return;
        const current = visual(controller, layer.request);
        if (current?.original || current?.profile.type !== 'video' || current?.asset.url !== value.asset.url || current.character.id !== value.character.id) return;
        const ended = layer.video.onended;
        if (typeof ended !== 'function') return;
        // 以新单次素材的真实结束推进原动画链与回执，先拆隐藏视频回调以防十秒后二次结束。
        media.completed = true; layer.video.onended = null; layer.video.pause();
        ended.call(layer.video);
      });
      media.timeout = window.setTimeout(failed, 10000);
      element.src = value.asset.url; element.load();
    }
    const media = layer.media;
    if (!media.ready) return false;
    layer.canvas.style.display = 'none'; media.element.style.display = 'block';
    const drive = () => {
      if (controller.disposed || controller.active !== layer || controller.pendingRequest || layer.media !== media) return;
      const source = layer.video;
      const moving = value.entry.group === 'moves';
      const lead = Math.max(0, Number(value.entry.params?.leadSec) || 0);
      const tail = Math.max(0, Number(value.entry.params?.tailSec) || 0);
      const seconds = Number.isFinite(source.currentTime) ? source.currentTime : 0;
      const duration = Number.isFinite(source.duration) && source.duration > 0 ? source.duration : 10.09;
      const heldDrag = value.entry.group === 'drag' && (controller.sprite.dragState?.active || controller.sprite.dragState?.dragging) && !controller.sprite.frozen;
      // 同上游位移窗口采样；规划失败、未发车、已停步时不能只因动作ID是move就踏步。
      const travel = !moving || (controller.sprite.moveRef != null && seconds > lead && seconds < duration - tail);
      media.element.loop = moving || heldDrag || value.entry.group === 'idle' || source.loop;
      // 隐藏原片十秒结束后，仍拿在手上的新素材继续循环；物理和松手回调保持原实现。
      const sourceStopped = (source.paused || source.ended) && !(heldDrag && source.ended);
      if (sourceStopped || !travel) {
        pauseMedia(media);
        // 没有实际走位的旧move请求保持当前帧，不把收尾硬倒回第一帧。
      } else if (media.element.paused && !media.element.ended && !media.ended && !media.playing) {
        media.playing = true;
        const attempt = media.playAttempt = (media.playAttempt || 0) + 1;
        void Promise.resolve(media.element.play()).catch(() => {
          if (!controller.disposed && layer.media === media && media.playAttempt === attempt) { failedAssets.add(value.asset.url); refresh(controller); }
        }).finally(() => {
          if (layer.media !== media || media.playAttempt !== attempt) return;
          media.playing = false;
          // 真实EOS的pause/ended可能早于play兑现；兑现后补一次事件协调，不依赖1500ms轮询。
          if (!controller.disposed && !failedAssets.has(value.asset.url)) defer(() => {
            if (!controller.disposed && layer.media === media && media.playAttempt === attempt) refresh(controller);
          });
        });
      }
      // timeupdate可间隔约250ms；每帧只读原时钟以对齐实际窗口的起步和到达。
      if (moving && !source.paused && !source.ended && layer.raf == null) layer.raf = window.requestAnimationFrame(() => { layer.raf = null; drive(); });
    };
    layer.draw = drive;
    drive();
    return true;
  }

  function refresh(controller) {
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
    const selectionKey = selection.character;
    if (controller.selectionKey !== selectionKey) {
      controller.selectionKey = selectionKey;
      hold(controller);
    }
    const value = visual(controller, request);
    const debug = { character: character.id, mode: 'q', form: 'q', action: request.action };
    if (value?.original) {
      originalVisual(controller);
      window.__codexSkinDebug = { ...debug, profile: 'original-video', playback: 'original-video', coverage: 'dedicated' };
      return;
    }
    if (!value?.asset?.available || value.resolved.coverage === 'missing' || failedAssets.has(value.asset.url)) { originalVisual(controller); return; }
    if (value.profile.type !== 'video' && !decodedImages.has(value.asset.url)) {
      hold(controller); loadAsset(value.asset.url); return;
    }
    if (value.profile.type === 'video') {
      if (!paintVideoLayer(controller, layer, value)) return;
    } else {
      if (!paintLayer(controller, layer, value)) { originalVisual(controller); return; }
      layer.canvas.style.display = 'block';
    }
    for (const other of controller.layers) {
      other.layer.style.opacity = other === layer ? '1' : '0';
      if (other !== layer) stopLayer(other);
    }
    sprite.stage.classList.add('codex-skin-active');
    window.__codexSkinDebug = { ...debug, profile: value.resolved.profile, coverage: value.resolved.coverage, playback: value.profile.type === 'video' ? 'transparent-video' : 'frame-prototype' };
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
    refresh(controller);
  }
  function ensure(sprite) {
    if (sprite.__codexSkinController) return sprite.__codexSkinController;
    const controller = { sprite, layers: [], baseAnimations: sprite.animations, catalog: A.catalogFromAnimations(sprite.animations), disposed: false, listeners: [] };
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
        const handler = () => { if (name === 'ended') finishNativeMove(controller, video); if (name === 'pause' || name === 'ended') hold(controller); schedule(); };
        video.addEventListener(name, handler); controller.listeners.push([video, name, handler]);
      }
    }
    controller.observer = observer;
    sprite.__codexSkinController = controller;
    controllers.add(controller);
    if (timer === null) timer = window.setInterval(() => { for (const item of controllers) refresh(item); }, 1500);
    return controller;
  }

  const proto = PetSprite.prototype;
  const playIdle = proto.playIdle;
  proto.playIdle = function () {
    const controller = ensure(this);
    const character = coreCharacter();
    const original = this.animations, weights = this.weights;
    const categoriesForLocale = visibleCategories(original.categories, currentCharacter());
    if (!character) {
      if (categoriesForLocale.length === (original.categories ?? []).length) return playIdle.apply(this, arguments);
      this.animations = { ...original, categories: categoriesForLocale };
      try { return playIdle.apply(this, arguments); }
      finally { this.animations = original; }
    }
    const ready = id => readyNativeAction(character, id);
    const idle = (original.idle ?? []).filter(ready);
    if (!idle.length) return;
    const turn = (original.turn ?? []).filter(ready);
    const moves = { ...original.moves, actions: (original.moves?.actions ?? []).filter(action => ready(action.name)) };
    const categories = categoriesForLocale.map(category => {
      const actions = category.actions.filter(ready);
      return { ...category, actions, noMirror: category.noMirror === true && actions.some(id => !textFreeGreeting(character, id)) };
    }).filter(category => category.actions.length);
    // 只在随机链同步取候选期间使用核心表；事件档位、拖拽、共享配置和原catalog保持完整。
    this.animations = { ...original, idle, turn, moves, categories };
    this.weights = { ...weights, turn: turn.length ? weights?.turn ?? 0 : 0, move: moves.actions.length ? weights?.move ?? 0 : 0 };
    try { return playIdle.apply(this, arguments); }
    finally { this.animations = original; this.weights = weights; }
  };
  const onClick = proto.onClick;
  proto.onClick = function () {
    const controller = ensure(this);
    const character = model?.characters.find(value => value.id === model.selection.character);
    const animations = this.animations;
    if (!character || character.originalVideo || !Array.isArray(animations?.clicks)) return onClick.apply(this, arguments);
    const candidates = animations.clicks.filter(id => readyNativeAction(character, id));
    if (!candidates.length) return onClick.apply(this, arguments);
    // 仅普通点击同步取候选时替换；菜单、结束回调和共享配置始终保留完整原动作表。
    this.animations = { ...animations, clicks: candidates };
    try { return onClick.apply(this, arguments); }
    finally { this.animations = animations; }
  };
  const switchTo = proto.switchTo;
  proto.switchTo = function (next, once, playbackId, url) {
    const controller = ensure(this);
    let sourceUrl = url;
    // 防重请求沿用原上游判断，不替它重播、改anim、改朝向或改物理状态。
    if (next && !(this.pending?.anim === next && this.pending.once === once)) {
      const layer = controller.layers[this.front === 0 ? 1 : 0];
      const request = { action: next, once, external: Boolean(url), gen: this.gen + 1 };
      const value = !url && this.pendingMove ? visual(controller, request) : null;
      if (value?.entry.group === 'moves' && !value.original && readyNativeAction(value.character, next)) {
        // 新片没有原鱼首尾两秒的表演段；只留淡入淡出的短缓冲，且不改共享配置。
        this.pendingMove = { ...this.pendingMove, leadSec: .12, tailSec: .12 };
        request.nativeMove = true; request.movePlan = { ...this.pendingMove }; sourceUrl = value.asset.url;
      }
      layer.request = request; controller.pendingRequest = request;
      const old = controller.layers[this.front];
      if (old.request?.nativeMove) old.video.pause();
      hold(controller); preload(controller, request);
    }
    const result = switchTo.call(this, next, once, playbackId, sourceUrl);
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
    for (const [video, name, handler] of controller.listeners) video.removeEventListener(name, handler);
    for (const layer of controller.layers) { if (layer.request?.nativeMove) layer.video.pause(); releaseMedia(layer); layer.paint = null; layer.layer.remove?.(); }
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
  function hasAnimationMenu(nodes) {
    return Array.isArray(nodes) && nodes.some(node => node.anim || hasAnimationMenu(node.children));
  }
  function decorateTree(nodes, preserveRegistered = false) {
    const selected = model?.characters.find(character => character.id === model.selection.character);
    const limited = coreCharacter();
    return nodes.flatMap(node => {
      const copy = { ...node };
      // 更多下的owner分组没有owner字段；整段原文都是注册协议数据，仅根标题可翻译。
      const registeredChildren = preserveRegistered || (copy.label === shared.MORE_MENU_LABEL && hasRegisteredMenu(copy.children));
      if (copy.children) copy.children = decorateTree(copy.children, registeredChildren);
      if (preserveRegistered || copy.action === 'third-party') return [copy];
      if (selected?.originalVideo && model.locale === 'en' && (copy.anim ? actionEntry(copy.anim).group === 'category:文字' : copy.label === '文字' && hasAnimationMenu(node.children))) return [];
      if (limited && copy.anim && !readyNativeAction(limited, copy.anim) && !readyEventAction(limited, copy.anim)) return [];
      if (limited && copy.children?.length === 0 && hasAnimationMenu(node.children)) return [];
      if (typeof copy.label === 'string') copy.label = copy.anim ? selected?.copy?.actionLabels?.[copy.anim] || t(copy.label) : selected?.copy?.menuLabels?.[copy.label] || t(copy.label);
      if (copy.action === 'chat' && window.codexChatPanel?.open) copy.label = t('图文对话');
      if (copy.anim && selected && !selected.originalVideo) {
        const entry = actionEntry(copy.anim);
        const resolved = A.resolveAction(entry, selected.manifest, selected.assets);
        const profile = selected.manifest.profiles[resolved.profile];
        const sharedHint = resolved.coverage === 'missing' ? t('专属帧待制作') : selected.copy?.sharedAnimationHint || t('基础动画代用');
        copy.hint = [profile?.type === 'video' ? '' : t('逐帧试作'), resolved.coverage !== 'dedicated' ? sharedHint : ''].filter(Boolean).join(' · ');
      }
      return [copy];
    });
  }
  const mountContextMenu = shared.mountContextMenu;
  shared.mountContextMenu = function (options) {
    if (!options.tree.some(item => ['chat', 'open-site'].includes(item.action))) return mountContextMenu.apply(this, arguments);
    const tree = decorateTree(options.tree);
    if (window.codexTaskPanel?.open) tree.push({ label: t('操作任务'), action: 'codex-task-panel' });
    if (model) tree.push({ label: t('形象'), children: model.characters.map(character => ({ label: `${model.selection.character === character.id ? '✓ ' : ''}${character.copy?.name || t(character.label)}`, action: 'codex-select-skin', character: character.id, hint: character.available.q ? '' : t('素材未就绪') })) });
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
      void bridge.select({ character: leaf.character, mode: 'q' }).then(applyModel).catch(() => console.warn('[龙娘桌宠] 形象未能切换，请确认本地素材已就绪。'));
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
    const previousCharacter = model?.selection.character;
    model = value; L?.setLocale(value.locale || 'zh-CN');
    for (const controller of controllers) {
      if (previousCharacter !== value.selection.character && (controller.activeRequest?.nativeMove || controller.pendingRequest?.nativeMove)) {
        controller.sprite.stopMove();
        if (!controller.sprite.resumeWorkStatusAnim()) controller.sprite.playIdle();
      } else refresh(controller);
    }
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
