(() => {
  'use strict';
  const api = window.startupScene;
  const scene = document.getElementById('scene'), video = document.getElementById('dragon');
  const canvas = document.getElementById('particles'), ctx = canvas.getContext('2d');
  const timers = new Set();
  let frame = null, ended = false, started = false, beginning = false, previous = 0;
  const wait = (callback, ms) => { const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms); timers.add(timer); };
  function finish() {
    if (ended) return;
    ended = true; video.pause();
    if (frame !== null) cancelAnimationFrame(frame);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('keydown', escape);
    window.removeEventListener('resize', resize);
    void api.finish().catch(() => {});
  }
  function escape(event) { if (event.key === 'Escape') finish(); }
  function resize() { canvas.width = Math.round(innerWidth); canvas.height = Math.round(innerHeight); }
  resize();
  const particles = Array.from({ length: 64 }, () => ({ x: Math.random(), y: Math.random(), speed: .001 + Math.random() * .003, size: .5 + Math.random() * 1.4 }));
  function draw(time) {
    if (ended) return;
    frame = requestAnimationFrame(draw);
    if (time - previous < 32) return;
    previous = time; ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const particle of particles) {
      const y = (particle.y - time * particle.speed / 1000 + 1) % 1;
      ctx.fillStyle = `rgba(191,193,255,${.15 + particle.size / 5})`;
      ctx.beginPath(); ctx.arc(particle.x * canvas.width, y * canvas.height, particle.size, 0, Math.PI * 2); ctx.fill();
    }
  }
  async function begin(value) {
    if (ended || started || beginning || video.readyState < 2) return;
    beginning = true;
    try { await video.play(); if (ended) return; await api.ready(); }
    catch { finish(); return; }
    if (ended) return;
    started = true; scene.classList.add('started'); frame = requestAnimationFrame(draw);
    const bars = [...document.querySelectorAll('.phase-track i')];
    const phase = index => { document.getElementById('status').textContent = value.copy.status[index]; bars.forEach((bar, number) => bar.classList.toggle('active', number <= index)); };
    phase(0); wait(() => phase(1), 1300); wait(() => phase(2), 3300); wait(() => phase(3), 5800);
    wait(() => scene.classList.add('departing'), value.durationMs - 850); wait(finish, value.durationMs);
  }
  document.addEventListener('pointerup', finish);
  document.addEventListener('keydown', escape);
  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', () => { if (!ended) finish(); }, { once: true });
  void api.get().then(value => {
    if (ended) return;
    document.documentElement.lang = value.locale === 'zh-CN' ? 'zh-CN' : 'en';
    document.getElementById('subject').textContent = value.copy.subject;
    document.getElementById('detail').textContent = value.copy.detail;
    document.getElementById('skip').textContent = `${value.copy.skip} · Esc`;
    document.getElementById('ready-label').textContent = 'CODEX PET / WD-001';
    video.muted = true; video.loop = true;
    video.addEventListener('loadeddata', () => { void begin(value); }, { once: true });
    video.addEventListener('error', finish, { once: true });
    video.src = value.video; video.load(); void begin(value);
  }).catch(finish);
})();
