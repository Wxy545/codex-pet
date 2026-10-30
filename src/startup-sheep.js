(() => {
  'use strict';
  const clamp = x => Math.max(0, Math.min(1, x));
  const ease = x => { const t = clamp(x); return t * t * (3 - 2 * t); };
  function play({ api, value }) {
    const english = value.locale !== 'zh-CN', reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const keys = ['idle', 'working', 'greeting'], listeners = [], timers = new Set(), voices = [];
    let finished = false, started = false, frame = null, request = null, sequence = 0, front = -1, phase = -1, blend = null, closingAt = null, exitAt = null;
    let audio = null, master = null, soundOn = false, targetReady = !['codex','workbuddy'].includes(value.reason), targetPending = false, nextProbe = 0;
    const root = document.createElement('main'); root.className = 'sheep-startup'; root.setAttribute('aria-label', 'WorkBuddy');
    const fluff = document.createElement('div'); fluff.className = 'sheep-fluff'; fluff.setAttribute('aria-hidden', 'true');
    const hero = document.createElement('div'); hero.className = 'sheep-hero'; hero.setAttribute('aria-hidden', 'true');
    const videos = keys.slice(0, 2).map(() => { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; hero.appendChild(v); return v; });
    const pane = document.createElement('section'); pane.className = 'sheep-app'; pane.setAttribute('aria-hidden', 'true');
    pane.innerHTML = '<div class="sheep-app-chrome"><span>☰</span><span>− □ ×</span></div><div class="sheep-app-brand">WorkBuddy</div><div class="sheep-composer"><div class="sheep-composer-placeholder"></div><div class="sheep-composer-tools"><span>＋</span><span class="sheep-composer-send">↑</span></div></div>';
    pane.querySelector('.sheep-composer-placeholder').textContent = english ? 'Message WorkBuddy' : '向 WorkBuddy 发送消息';
    const controls = document.createElement('div'); controls.className = 'sheep-controls';
    const sound = document.createElement('button'); sound.type = 'button'; const skip = document.createElement('button'); skip.type = 'button';
    skip.textContent = (value.copy?.skip || (english ? 'Skip' : '跳过')) + (value.reason === 'preview' ? '' : ' · Esc');
    controls.appendChild(sound); controls.appendChild(skip); root.appendChild(fluff); root.appendChild(hero); root.appendChild(pane); root.appendChild(controls);
    document.documentElement.lang = english ? 'en' : 'zh-CN'; document.title = 'Codex Pet · WorkBuddy'; document.body.classList.add('sheep-startup-active'); document.body.appendChild(root);
    function listen(element, name, callback) { element.addEventListener(name, callback); listeners.push(() => element.removeEventListener(name, callback)); }
    function later(callback, delay) { const id = setTimeout(() => { timers.delete(id); if (!finished) callback(); }, delay); timers.add(id); return id; }
    function finish() {
      if (finished) return; finished = true; sequence++; root.style.opacity = '0';
      if (frame !== null) cancelAnimationFrame(frame); for (const timer of timers) clearTimeout(timer); timers.clear(); listeners.forEach(remove => remove());
      for (const v of videos) { v.pause(); v.removeAttribute('src'); v.load(); }
      for (const v of voices) { try { v.stop(); } catch { /* 已结束的合成节点无需重复停止。 */ } }
      if (audio) void audio.close().catch(() => {});
      void api.finish().catch(() => {}).finally(() => root.remove());
    }
    function setSound(next) {
      soundOn = Boolean(next && audio); sound.textContent = english ? soundOn ? 'Sound on' : 'Sound off' : soundOn ? '声音 开' : '声音 关'; sound.setAttribute('aria-pressed', String(soundOn));
      if (audio && master) master.gain.setTargetAtTime(soundOn ? 1.1 : 0, audio.currentTime, .025);
      if (soundOn) void audio.resume().catch(() => {});
    }
    function chime(notes) {
      if (!audio || !master) return;
      try { notes.forEach((hz, i) => {
        const source = audio.createOscillator(), envelope = audio.createGain(), at = audio.currentTime + i * .09;
        source.type = 'sine'; source.frequency.setValueAtTime(hz, at); envelope.gain.setValueAtTime(.0001, at); envelope.gain.linearRampToValueAtTime(.075, at + .018); envelope.gain.exponentialRampToValueAtTime(.0001, at + .8);
        source.connect(envelope); envelope.connect(master); source.start(at); source.stop(at + .84); voices.push(source);
      }); } catch { const failed = audio; audio = null; master = null; setSound(false); void failed.close().catch(() => {}); }
    }
    function startAudio() {
      try { const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return; audio = new Audio(); master = audio.createGain(); master.connect(audio.destination); setSound(true); }
      catch { const failed = audio; audio = null; master = null; setSound(false); if (failed) void failed.close().catch(() => {}); }
    }
    async function commit(pending) {
      if (finished || request !== pending || pending.committing || pending.video.readyState < 2) return;
      pending.committing = true;
      const video = pending.video;
      if (!Number.isFinite(video.duration) || video.duration < 1 || video.duration > 16) { finish(); return; }
      try { await video.play(); } catch { if (!finished && request === pending) finish(); return; }
      if (finished || request !== pending || pending.sequence !== sequence) return;
      const old = front; front = pending.slot; phase = pending.phase; request = null;
      blend = { at: performance.now(), old }; video.style.opacity = '0'; root.dataset.phase = keys[phase];
      if (!started) {
        try { await api.ready(); } catch { finish(); return; }
        if (finished) return; started = true; startAudio(); chime([330, 440, 550]); frame = requestAnimationFrame(draw);
        // 页面和目标IPC均不能延长总上限；主进程另有22秒硬销毁。
        later(startExit, 20000);
      } else chime(phase === 1 ? [294, 392] : [392, 494, 587]);
    }
    function load(next) {
      if (finished || request) return;
      const slot = front === 0 ? 1 : 0, video = videos[slot];
      const pending = { video, slot, phase: next, sequence: ++sequence, committing: false }; request = pending;
      video.pause(); video.style.opacity = '0'; video.loop = false; video.src = value.assets[keys[next]]; video.load(); void commit(pending);
    }
    function startExit() { if (finished || exitAt !== null) return; exitAt = performance.now(); chime([440, 660]); }
    function probe(now) {
      if (targetReady || targetPending || now < nextProbe || typeof api.target !== 'function') return;
      targetPending = true; nextProbe = now + 600;
      Promise.resolve().then(() => api.target()).then(v => { if (!finished) targetReady = v?.ready === true; }).catch(() => {}).finally(() => { targetPending = false; });
    }
    function draw(now) {
      if (finished) return;
      const video = videos[front], time = Math.max(0, Number(video.currentTime) || 0); root.dataset.mediaTime = time.toFixed(3);
      if (blend) {
        const amount = reduced ? 1 : ease((now - blend.at) / 180); video.style.opacity = String(amount);
        if (blend.old >= 0) videos[blend.old].style.opacity = String(1 - amount);
        if (amount === 1) { if (blend.old >= 0) videos[blend.old].pause(); blend = null; }
      }
      // 三段都由真实EOS推进，保留完整呼吸、敲字和招呼动作，不按墙钟硬切。
      const after = closingAt === null ? 0 : Math.max(0, now - closingAt) / 1000;
      const progress = closingAt === null ? 0 : reduced ? Number(after >= 1.3) : ease(after / 1.3);
      const reveal = closingAt !== null ? 1 : phase === 2 ? ease((time / video.duration - .25) / .45) : 0;
      pane.style.opacity = String(reveal); pane.style.transform = 'translate3d(' + innerWidth * .61 * (1 - progress) + 'px,' + innerHeight * .25 * (1 - progress) + 'px,0) perspective(1600px) rotateY(' + (-10 * (1 - progress)) + 'deg) scale(' + (.3 + .7 * progress) + ')';
      hero.style.opacity = String(1 - ease(after / 1.1));
      if (closingAt !== null && after >= 1.3) { root.dataset.phase = 'window'; probe(now); if (after >= 1.55 && targetReady) startExit(); }
      if (exitAt !== null) { const amount = ease((now - exitAt) / 780); root.dataset.phase = 'handoff'; root.style.opacity = String(1 - amount); if (amount === 1) { finish(); return; } }
      frame = requestAnimationFrame(draw);
    }
    setSound(false); listen(skip, 'click', finish); listen(sound, 'click', () => setSound(!soundOn)); listen(document, 'keydown', e => { if (e.key === 'Escape') finish(); }); listen(window, 'beforeunload', finish);
    for (const video of videos) {
      listen(video, 'loadeddata', () => { if (request?.video === video) void commit(request); }); listen(video, 'error', finish);
      listen(video, 'ended', () => { if (finished || front < 0 || videos[front] !== video || request) return; if (phase < 2) load(phase + 1); else if (closingAt === null) { closingAt = performance.now(); chime([349, 440, 523]); } });
    }
    if (keys.some(key => typeof value.assets?.[key] !== 'string')) finish(); else load(0);
    return { finish };
  }
  window.CodexStartupSheep = { play };
})();
