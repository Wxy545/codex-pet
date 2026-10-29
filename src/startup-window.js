(() => {
  'use strict';
  const api = window.startupScene;
  const scene = document.getElementById('scene');
  const videos = [document.getElementById('dragon'), document.getElementById('dragon-next')];
  const canvas = document.getElementById('particles'), ctx = canvas.getContext('2d');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const timers = new Set(), disposers = [];
  let frame = null, ended = false, started = false, beginning = false, previous = 0, epoch = 0;
  let current = 0, stage = 0, audio = null, audioOutput = null, soundOn = false, value, swapGeneration = 0, departing = false;
  const wait = (callback, ms) => { const timer = setTimeout(() => { timers.delete(timer); if (!ended) callback(); }, ms); timers.add(timer); return timer; };
  function finish() {
    if (ended) return;
    ended = true; swapGeneration++;
    videos.forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); });
    if (frame !== null) cancelAnimationFrame(frame);
    for (const timer of timers) clearTimeout(timer);
    timers.clear(); disposers.forEach(dispose => dispose());
    if (audio) void audio.close().catch(() => {});
    void api.finish().catch(() => {});
  }
  function listen(target, name, callback) { target.addEventListener(name, callback); disposers.push(() => target.removeEventListener(name, callback)); }
  function resize() { canvas.width = Math.round(innerWidth); canvas.height = Math.round(innerHeight); }
  resize();
  // 星尘和施法轨迹由程序绘制，人物动作来自本项目的透明视频。
  const stars = Array.from({ length: reduced ? 24 : 105 }, (_, i) => ({ x: ((i * 73 + 19) % 107) / 107, y: ((i * 41 + 7) % 109) / 109, z: .25 + (i % 11) / 15, size: .5 + (i % 4) * .35 }));
  function draw(time) {
    if (ended) return;
    frame = requestAnimationFrame(draw);
    if (time - previous < 32) return;
    previous = time;
    const elapsed = (time - epoch) / 1000, width = canvas.width, height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    for (const star of stars) {
      const x = (star.x + (reduced ? 0 : elapsed * .003 * star.z)) % 1;
      const y = (star.y - (reduced ? 0 : elapsed * .009 * star.z) + 1) % 1;
      ctx.fillStyle = `rgba(211,200,250,${.15 + star.z * .33})`;
      ctx.beginPath(); ctx.arc(x * width, y * height, star.size, 0, Math.PI * 2); ctx.fill();
    }
    if (reduced || stage < 2) return;
    const portrait = width < height, cx = width * (portrait ? .5 : .64), cy = height * (portrait ? .66 : .45);
    const radius = Math.min(width * .1, height * .15), power = Math.min(1, (elapsed - 6.6) / 1.3);
    if (power <= 0) return;
    for (let i = 0; i < 36; i++) {
      const angle = elapsed * .6 + i * Math.PI * 2 / 36;
      const r = radius * (1.15 + .35 * Math.sin(elapsed * .9 + i * 3));
      ctx.fillStyle = `rgba(219,201,255,${power * (.25 + (i % 3) * .15)})`;
      ctx.fillRect(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r * .62, i % 4 === 0 ? 3 : 1.5, i % 4 === 0 ? 3 : 1.5);
    }
  }
  function phase(number, className) {
    stage = number;
    if (className) scene.classList.add(className);
    const labels = value.locale === 'zh-CN' ? ['龙息苏醒', '神经链接', '掌心微光', '准备就绪'] : ['DRAGON AWAKENING', 'NEURAL LINK', 'A LITTLE MAGIC', 'READY'];
    document.getElementById('status').textContent = labels[number];
    document.getElementById('chapter-number').textContent = `0${number + 1}`;
  }
  function load(video, asset) {
    video.muted = true; video.loop = true;
    if (video.dataset.asset !== asset) { video.dataset.asset = asset; video.src = asset; video.load(); }
  }
  function preload(asset) { load(videos[1 - current], asset); }
  async function change(asset, following) {
    if (ended) return;
    const generation = ++swapGeneration;
    const incoming = videos[1 - current], outgoing = videos[current];
    load(incoming, asset);
    if (incoming.readyState < 2) {
      // 未解码完成时保留当前人物，避免黑闪；后续片段仍按时间轴准备。
      if (following) wait(() => preload(following), 1000);
      return;
    }
    try { incoming.currentTime = 0; await incoming.play(); } catch { return; }
    if (ended || generation !== swapGeneration || incoming.dataset.asset !== asset) return;
    incoming.classList.add('visible'); outgoing.classList.remove('visible'); current = 1 - current;
    wait(() => { outgoing.pause(); if (following) preload(following); }, 600);
  }
  function setSound(on) {
    soundOn = Boolean(on);
    const zh = value?.locale === 'zh-CN', button = document.getElementById('sound');
    button.textContent = soundOn ? (zh ? '声音 开' : 'Sound on') : (zh ? '声音 关' : 'Sound off');
    button.setAttribute('aria-pressed', String(soundOn));
    if (audioOutput) audioOutput.gain.setTargetAtTime(soundOn ? .10 : 0, audio.currentTime, .03);
    if (audio && soundOn) void audio.resume().catch(() => {});
  }
  function soundtrack() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      audio = new Audio();
      const output = audioOutput = audio.createGain(); output.gain.value = .10; output.connect(audio.destination);
      const tone = (at, duration, hz, gain) => {
        const source = audio.createOscillator(), level = audio.createGain();
        source.type = 'sine'; source.frequency.value = hz;
        level.gain.setValueAtTime(0, at); level.gain.linearRampToValueAtTime(gain, at + .07);
        level.gain.exponentialRampToValueAtTime(.0001, at + duration);
        source.connect(level); level.connect(output); source.start(at); source.stop(at + duration + .01);
      };
      const now = audio.currentTime;
      // 原创五声音阶：唤醒低音、施法清音与结束和弦。
      for (const hz of [130.81, 196, 261.63]) tone(now, 7.4, hz, .2);
      [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => tone(now + 6.6 + i * .23, 2.2, hz, .35));
      [261.63, 392, 523.25, 659.25].forEach(hz => tone(now + 10.15, 4.05, hz, .23));
      setSound(true);
    } catch {
      const failedAudio = audio;
      audio = null; audioOutput = null;
      if (failedAudio) void failedAudio.close().catch(() => {});
      setSound(false);
    }
  }
  function depart() { if (ended || departing) return; departing = true; scene.classList.add('departing'); wait(finish, 1050); }
  async function handoff() {
    if (ended) return;
    // 真正启动时短暂等候主窗口，预览按时结束；22秒主进程看门狗另作兜底。
    if (!['codex', 'workbuddy'].includes(value.reason) || typeof api.target !== 'function') { depart(); return; }
    const deadline = epoch + 20000;
    // 独立于IPC兑现；即使探测Promise永久挂起，也按上限退场。
    wait(depart, Math.max(0, deadline - performance.now()));
    const check = async () => {
      if (ended || departing) return;
      let ready = false;
      try { ready = Boolean((await api.target())?.ready); } catch { /* 探测失败仍按上限交还桌面。 */ }
      if (ended || departing) return;
      if (ready || performance.now() >= deadline) depart(); else wait(() => { void check(); }, 600);
    };
    await check();
  }
  async function begin() {
    if (ended || started || beginning || videos[0].readyState < 2) return;
    beginning = true;
    try { await videos[0].play(); if (ended) return; await api.ready(); } catch { finish(); return; }
    if (ended) return;
    started = true; epoch = performance.now(); videos[0].classList.add('visible');
    scene.classList.add('started'); phase(0); frame = requestAnimationFrame(draw); soundtrack();
    const assets = value.assets || { idle: value.video };
    const awakening = assets['wing-care'] || assets.idle, magic = assets.magic || assets.idle, greeting = assets.greeting || assets.idle;
    preload(awakening);
    wait(() => { phase(1, 'link'); void change(awakening, magic); }, 3400);
    wait(() => { phase(2, 'magic'); void change(magic, greeting); }, 6600);
    wait(() => { phase(3, 'greeting'); void change(greeting); }, 10100);
    wait(() => { void handoff(); }, Math.max(1050, value.durationMs - 1050));
  }
  listen(document.getElementById('skip'), 'click', finish);
  listen(document.getElementById('sound'), 'click', () => setSound(!soundOn));
  listen(document, 'keydown', event => { if (event.key === 'Escape') finish(); });
  listen(window, 'resize', resize); listen(window, 'beforeunload', finish);
  void api.get().then(result => {
    if (ended) return;
    if (result.film === true) {
      if (typeof window.CodexStartupCinema?.play !== 'function') { finish(); return; }
      // 电影只接管同一次scene读取；旧Q页监听必须先撤掉，不能由旧beforeunload误关电影。
      ended = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear(); disposers.forEach(dispose => dispose());
      if (frame !== null) cancelAnimationFrame(frame);
      try { window.CodexStartupCinema.play({ api, value: result }); }
      catch { void api.finish().catch(() => {}); }
      return;
    }
    value = result; document.documentElement.lang = value.locale === 'zh-CN' ? 'zh-CN' : 'en';
    const brand = value.host === 'workbuddy' ? 'WorkBuddy' : 'ChatGPT';
    document.title = 'Codex Pet · ' + brand; scene.setAttribute('aria-label', brand);
    const wordmark = document.getElementById('startup-brand'); if (wordmark) wordmark.textContent = brand;
    document.getElementById('skip').textContent = value.reason === 'preview' ? value.copy.skip : `${value.copy.skip} · Esc`;
    document.getElementById('ready-label').textContent = value.locale === 'zh-CN' ? '随时出发' : 'READY WHEN YOU ARE';
    setSound(false);
    videos.forEach((video, index) => listen(video, 'error', () => { if (index === current && !started) finish(); }));
    listen(videos[0], 'loadeddata', () => { void begin(); });
    load(videos[0], value.assets?.idle || value.video); void begin();
  }).catch(finish);
})();
