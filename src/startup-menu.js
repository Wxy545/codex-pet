(() => {
  'use strict';
  const bridge = window.codexStartup;
  const shared = window.PetShared;
  if (!bridge || !shared || typeof PetSprite !== 'function') return;
  let state = { mode: 'pet', locale: 'en' };
  let revision = 0;
  const update = value => { if (value && ['pet', 'startup', 'both'].includes(value.mode)) { state = value; revision++; } };
  const unsubscribe = bridge.onChanged(update);
  const initialRevision = revision;
  void bridge.getState().then(value => { if (revision === initialRevision) update(value); }).catch(() => {});
  window.addEventListener('beforeunload', unsubscribe, { once: true });
  const mount = shared.mountContextMenu;
  shared.mountContextMenu = function (options) {
    // 原sprite通过共享函数挂菜单；WorkBuddy过滤账号入口后仍有home/reload根工具。
    if (!options?.tree?.some(item => ['chat', 'open-site', 'home', 'reload'].includes(item.action))) return mount.apply(this, arguments);
    const zh = state.locale === 'zh-CN';
    const labels = zh ? ['仅桌宠', '仅启动演出', '桌宠与启动演出'] : ['Pet only', 'Startup scene only', 'Pet and startup scene'];
    const children = ['pet', 'startup', 'both'].map((mode, index) => ({
      label: `${state.mode === mode ? '✓ ' : ''}${labels[index]}`, action: 'codex-startup-mode', startupMode: mode,
    }));
    children.push({ label: zh ? '预览演出' : 'Preview scene', action: 'codex-startup-preview' });
    return mount.call(this, { ...options, tree: [...options.tree, { label: zh ? '启动演出' : 'Startup scene', children }] });
  };
  const action = PetSprite.prototype.onMenuAction;
  PetSprite.prototype.onMenuAction = function (leaf) {
    if (leaf?.action === 'codex-startup-mode' && ['pet', 'startup', 'both'].includes(leaf.startupMode)) {
      this.closeMenu();
      void bridge.setMode(leaf.startupMode).then(update).catch(() => console.warn('[Codex Pet] Startup preference could not be saved.'));
      return;
    }
    if (leaf?.action === 'codex-startup-preview') {
      this.closeMenu(); void bridge.preview().catch(() => {}); return;
    }
    return action.apply(this, arguments);
  };
})();
