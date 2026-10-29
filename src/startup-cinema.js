(() => {
  'use strict';
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
  const pushEase = value => { const x = clamp(value); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  // 本片3.5秒已落稳全身构图，手势后立即接窗，避免套用旧6.3秒节点空等。
  const WINDOW_AT = 3.8;

  function play({ api, value }) {
    const english = value.locale !== 'zh-CN';
    const brand = value.host === 'workbuddy' ? 'WorkBuddy' : 'ChatGPT';
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const listeners = [], timers = new Set(), audioNodes = [], cues = new Set();
    let finished = false, started = false, beginning = false, buffering = false, frame = null;
    let endAt = null, exitAt = null, targetReady = !['codex', 'workbuddy'].includes(value.reason), targetPending = false, nextProbeAt = 0;
    let audio = null, master = null, soundOn = false;
    const root = document.createElement('main'); root.className = 'cinema'; root.setAttribute('aria-label', brand);
    const video = document.createElement('video'); video.className = 'cinema-video'; video.muted = true; video.loop = false; video.playsInline = true; video.preload = 'auto';
    const application = document.createElement('section'); application.className = 'cinema-app'; application.setAttribute('aria-hidden', 'true');
    application.innerHTML = '<div class="cinema-app-chrome"><span class="cinema-app-nav">☰</span><span class="cinema-app-window-controls">− □ ×</span></div><div class="cinema-app-brand">' + brand + '</div><div class="cinema-composer"><div class="cinema-composer-placeholder"></div><div class="cinema-composer-tools"><span>＋</span><span class="cinema-composer-send">↑</span></div></div>';
    application.querySelector('.cinema-composer-placeholder').textContent = english ? 'Message ' + brand : '向 ' + brand + ' 发送消息';
    const flash = document.createElement('div'); flash.className = 'cinema-flash';
    const controls = document.createElement('div'); controls.className = 'cinema-controls';
    const sound = document.createElement('button'); sound.type = 'button';
    const skip = document.createElement('button'); skip.type = 'button';
    skip.textContent = (value.copy?.skip || (english ? 'Skip' : '跳过')) + (value.reason === 'preview' ? '' : ' · Esc');
    controls.appendChild(sound); controls.appendChild(skip);
    root.appendChild(video); root.appendChild(application); root.appendChild(flash); root.appendChild(controls);
    document.title = 'Codex Pet · ' + brand; document.documentElement.lang = english ? 'en' : 'zh-CN'; document.body.classList.add('cinema-active'); document.body.appendChild(root);

    function listen(target, name, handler) { target.addEventListener(name, handler); listeners.push(() => target.removeEventListener(name, handler)); }
    function later(callback, ms) {
      const id = setTimeout(() => { timers.delete(id); if (!finished) callback(); }, ms);
      timers.add(id); return id;
    }
    function finish() {
      if (finished) return;
      finished = true; root.style.opacity = '0';
      if (frame !== null) cancelAnimationFrame(frame);
      for (const timer of timers) clearTimeout(timer); timers.clear();
      listeners.forEach(dispose => dispose());
      video.pause(); video.removeAttribute('src'); video.load();
      for (const node of audioNodes) { try { node.stop(); } catch { /* 已结束的合成节点无需再次停止。 */ } }
      if (audio) void audio.close().catch(() => {});
      void api.finish().catch(() => {}).finally(() => root.remove());
    }
    function gain() {
      if (master && audio) master.gain.setTargetAtTime(soundOn && (!buffering || endAt !== null) ? 3.15 : 0, audio.currentTime, .025);
    }
    function setSound(next) {
      soundOn = Boolean(next && audio);
      sound.textContent = english ? soundOn ? 'Sound on' : 'Sound off' : soundOn ? '声音 开' : '声音 关';
      sound.setAttribute('aria-pressed', String(soundOn)); gain();
      if (soundOn) void audio.resume().catch(() => {});
    }
    function tone(hz, duration, volume, delay = 0, type = 'sine', endHz) {
      if (!audio || !master) return;
      const at = audio.currentTime + delay, source = audio.createOscillator(), envelope = audio.createGain();
      source.type = type; source.frequency.setValueAtTime(hz, at);
      if (endHz) source.frequency.exponentialRampToValueAtTime(endHz, at + duration);
      envelope.gain.setValueAtTime(.0001, at); envelope.gain.linearRampToValueAtTime(volume, at + .025);
      envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
      source.connect(envelope); envelope.connect(master); source.start(at); source.stop(at + duration + .03); audioNodes.push(source);
    }
    function whoosh(duration, startHz, endHz, volume) {
      if (!audio || !master) return;
      const count = Math.max(1, Math.round(audio.sampleRate * duration)), buffer = audio.createBuffer(1, count, audio.sampleRate);
      const samples = buffer.getChannelData(0); let seed = 214013;
      for (let i = 0; i < samples.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; samples[i] = seed / 2147483648; }
      const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), envelope = audio.createGain(), at = audio.currentTime;
      source.buffer = buffer; filter.type = 'bandpass'; filter.Q.value = .7;
      filter.frequency.setValueAtTime(startHz, at); filter.frequency.exponentialRampToValueAtTime(endHz, at + duration);
      envelope.gain.setValueAtTime(.0001, at); envelope.gain.linearRampToValueAtTime(volume, at + duration * .42); envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
      source.connect(filter); filter.connect(envelope); envelope.connect(master); source.start(at); source.stop(at + duration + .03); audioNodes.push(source);
    }
    function cue(key, callback) {
      if (cues.has(key)) return;
      cues.add(key);
      try { callback(); } catch {
        const failedAudio = audio; audio = null; master = null;
        if (failedAudio) void failedAudio.close().catch(() => {});
        sound.disabled = true; setSound(false);
      }
    }
    function startAudio() {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) { sound.disabled = true; setSound(false); return; }
      try { audio = new Audio(); master = audio.createGain(); master.connect(audio.destination); setSound(true); }
      catch { const failedAudio = audio; audio = null; master = null; if (failedAudio) void failedAudio.close().catch(() => {}); sound.disabled = true; setSound(false); }
    }
    function soundtrack(mediaTime, after) {
      if (!audio) return;
      cue('bed', () => { tone(110, 19, .035); tone(164.81, 19, .022); tone(220, 19, .016); });
      if (mediaTime >= 1.05) cue('pullback', () => { whoosh(.65, 400, 3600, .1); tone(130.81, .7, .09, 0, 'triangle'); });
      if (mediaTime >= 2.5) cue('construct', () => { whoosh(.9, 450, 2400, .065); [392, 523.25, 659.25].forEach((hz, i) => tone(hz, 1, .07, i * .12)); });
      if (mediaTime >= WINDOW_AT) cue('window', () => { [659.25, 783.99, 1046.5].forEach((hz, i) => tone(hz, .85, .07, i * .1)); });
      if (after >= .28) cue('push', () => { whoosh(.85, 350, 4800, .13); tone(135, .55, .16, 0, 'sine', 45); });
      if (after >= 1.55) cue('seal', () => { [261.63, 392, 523.25, 659.25].forEach((hz, i) => tone(hz, .85, .06, i * .045)); });
    }
    function startExit() { if (!finished && exitAt === null) { exitAt = performance.now(); root.dataset.phase = 'handoff'; } }
    async function probe() {
      if (finished || targetPending || targetReady || typeof api.target !== 'function') return;
      targetPending = true; nextProbeAt = performance.now() + 650;
      try { const result = await api.target(); if (!finished) targetReady = result?.ready === true; }
      catch { /* 主窗口暂不可用时保留当前画面，独立截止时间仍能退场。 */ }
      finally { targetPending = false; }
    }
    function applicationFrame(now, mediaTime) {
      const reveal = smooth((mediaTime - WINDOW_AT) / .65), after = endAt === null ? -1 : (now - endAt) / 1000;
      const grow = smooth((mediaTime - WINDOW_AT) / Math.max(.65, video.duration - WINDOW_AT));
      const push = endAt === null ? 0 : pushEase((after - .3) / 1.15);
      const vw = video.videoWidth || 1920, vh = video.videoHeight || 1080, fitScale = Math.min(innerWidth / vw, innerHeight / vh);
      const width = vw * fitScale, height = vh * fitScale, left = (innerWidth - width) / 2, top = (innerHeight - height) / 2;
      // 以实际contain画幅定位玻璃窗，超宽或16:10屏幕也不会裁切电影中的角色。
      const initialScale = Math.min((.28 + .07 * grow) * width / innerWidth, .55 * height / innerHeight);
      // 跟随右侧空框中心生长，不从左57%压住龙翼；抬手后持续向前舒展而非静止等片尾。
      const anchorX = left + width * .79, anchorY = top + height * .34;
      const x = (anchorX - innerWidth * initialScale / 2) * (1 - push), y = (anchorY - innerHeight * initialScale / 2) * (1 - push), scale = initialScale + (1 - initialScale) * push;
      const yaw = (-24 + 12 * grow) * (1 - push), roll = (-4.5 + 3 * grow) * (1 - push);
      application.style.opacity = String(endAt === null ? reveal : 1);
      application.style.borderRadius = `${18 * (1 - push)}px`;
      application.style.transform = reduced
        ? `translate3d(${push >= 1 ? 0 : x}px,${push >= 1 ? 0 : y}px,0) scale(${push >= 1 ? 1 : initialScale})`
        : `translate3d(${x}px,${y}px,0) perspective(1600px) rotateY(${yaw}deg) rotateZ(${roll}deg) scale(${scale})`;
      flash.style.opacity = reduced || after < 0 ? '0' : String(.62 * Math.max(0, 1 - Math.abs(after - 1.48) / .18));
      if (endAt !== null) {
        root.dataset.phase = push < 1 ? 'push' : 'window';
        video.style.opacity = String(1 - smooth((after - 1.1) / .45));
        // 推进与揭幕最多3秒；等真实窗口时只保持已落稳的画面，不循环假进度。
        if (after >= 1.5 && !targetReady && now >= nextProbeAt) void probe();
        if (after >= 1.95 && targetReady) startExit();
      }
      return after;
    }
    function draw(now) {
      if (finished) return;
      const mediaTime = Math.max(0, Number(video.currentTime) || 0);
      root.dataset.mediaTime = mediaTime.toFixed(3);
      const after = applicationFrame(now, mediaTime); soundtrack(mediaTime, after);
      if (exitAt !== null) { const exit = clamp((now - exitAt) / 780); root.style.opacity = String(1 - smooth(exit)); root.dataset.phase = 'handoff'; if (exit >= 1) { finish(); return; } }
      frame = requestAnimationFrame(draw);
    }
    async function begin() {
      if (finished || started || beginning || video.readyState < 2) return;
      beginning = true;
      if (!Number.isFinite(video.duration) || video.duration < 1 || video.duration > 16) { finish(); return; }
      try { await video.play(); if (finished) return; await api.ready(); } catch { finish(); return; }
      if (finished) return;
      started = true; root.style.opacity = '1'; root.dataset.phase = 'film'; root.dataset.duration = String(video.duration);
      startAudio(); frame = requestAnimationFrame(draw);
      // 不依赖媒体ended或IPC Promise兑现，20秒开始退场，主进程另有22秒硬销毁。
      later(startExit, 20000);
    }
    setSound(false);
    listen(skip, 'click', finish); listen(sound, 'click', () => setSound(!soundOn));
    listen(document, 'keydown', event => { if (event.key === 'Escape') finish(); }); listen(window, 'beforeunload', finish);
    listen(video, 'loadeddata', () => { void begin(); }); listen(video, 'error', finish);
    listen(video, 'waiting', () => { buffering = true; gain(); }); listen(video, 'playing', () => { buffering = false; gain(); });
    listen(video, 'ended', () => { if (finished || endAt !== null) return; endAt = performance.now(); buffering = false; gain(); });
    video.src = value.video; video.load(); void begin();
    return { finish };
  }
  window.CodexStartupCinema = { play };
})();
