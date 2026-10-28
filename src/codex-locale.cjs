(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./locale-en.cjs'));
  else root.CodexLocale = factory(root.CodexEnglish || {});
})(typeof window === 'object' ? window : globalThis, function (english) {
  'use strict';
  let selected;
  const normalizeLocale = value => /^zh(?:[-_]|$)/i.test(String(value || '')) ? 'zh-CN' : 'en';
  function getLocale() {
    return selected || normalizeLocale(typeof process === 'object' ? process.env.CODEX_PET_LOCALE || Intl.DateTimeFormat().resolvedOptions().locale : navigator.language);
  }
  function setLocale(value) { selected = normalizeLocale(value); return selected; }
  function detectSystemLocale({ platform = typeof process === 'object' ? process.platform : '', execFileSyncImpl, fallback = () => Intl.DateTimeFormat().resolvedOptions().locale } = {}) {
    if (platform === 'win32') {
      try {
        const run = execFileSyncImpl || require('node:child_process').execFileSync;
        const culture = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-UICulture).Name'], { encoding: 'utf8', timeout: 3000, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
        if (/^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(String(culture).trim())) return normalizeLocale(String(culture).trim());
      } catch { /* 系统查询失败时使用运行时区域设置，不输出系统环境或窗口信息。 */ }
    }
    try { return normalizeLocale(fallback()); } catch { return 'en'; }
  }
  function t(value, values = {}, locale = getLocale()) {
    const template = normalizeLocale(locale) === 'zh-CN' ? value : english[value] || value;
    return String(template).replace(/\{(\w+)\}/g, (all, key) => Object.hasOwn(values, key) ? String(values[key]) : all);
  }
  return { normalizeLocale, getLocale, setLocale, detectSystemLocale, t };
});
