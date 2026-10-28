(function () {
  'use strict';
  const L = window.CodexLocale;
  window.CodexPanelLocale = {
    apply(locale) {
      if (locale) L.setLocale(locale);
      document.documentElement.lang = L.getLocale();
      // 只处理开发者标记的静态控件，绝不改写聊天正文、任务结果和文件路径。
      for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = L.t(node.dataset.i18n);
      for (const [attribute, source] of [['aria-label', 'data-i18n-aria'], ['placeholder', 'data-i18n-placeholder']]) {
        for (const node of document.querySelectorAll(`[${source}]`)) node.setAttribute(attribute, L.t(node.getAttribute(source)));
      }
    },
  };
})();
