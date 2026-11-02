(() => {
  'use strict';
  if (typeof PetSprite !== 'function') return;
  const proto = PetSprite.prototype, bind = proto.bindEvents;
  if (typeof bind !== 'function' || bind.codexQuickInput) return;
  const plain = event => event?.button === 0 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  function bindQuickInput() {
    const result = bind.apply(this, arguments), hit = this.hit, signal = this.ac?.signal;
    if (!hit?.addEventListener || !signal || signal.aborted) return result;
    let press = null, clicks = [], generation = 0, opening = false;
    const blocked = () => this.justDragged || this.pressScoreFired || this.menuOpen || this.chatOpen || this.todoOpen;
    const settled = () => !signal.aborted && !this.dragState?.active && !this.dragState?.dragging && !blocked();
    const cancel = () => { generation++; press = null; clicks = []; };
    // 原生 pointerdown 先执行：按下即得分的标记必须在 click 清掉它之前记住。
    hit.addEventListener('pointerdown', event => {
      generation++;
      press = { valid: plain(event) && !blocked() };
    }, { signal });
    hit.addEventListener('pointermove', () => {
      if (press && (this.dragState?.dragging || blocked())) press.valid = false;
    }, { signal });
    hit.addEventListener('click', event => {
      if (event.detail === 1) clicks = [];
      clicks.push(Boolean(press?.valid && plain(event) && settled()));
      clicks = clicks.slice(-2);
      press = null;
    }, { signal });
    hit.addEventListener('dblclick', async event => {
      if (event.detail !== 2 || !plain(event) || !settled() || clicks.length !== 2 || !clicks.every(Boolean) || opening) return;
      // 第二次按下会命中原生 sling 标记；没有实际拖动时不应拦掉正常双击。
      const current = generation;
      clicks = []; opening = true;
      try {
        const state = await window.petHost?.getState?.();
        if (current !== generation || !settled()) return;
        if (state?.host === 'codex' && state.capabilities?.chat === true) window.codexChatPanel?.open?.();
        else if (state?.host === 'workbuddy') this.onMenuAction?.({ action: 'open-site' });
      } catch { /* 宿主未知、切换或窗口退出时不打开其它应用。 */ }
      finally { opening = false; }
    }, { signal });
    window.addEventListener('pointercancel', cancel, { signal });
    window.addEventListener('blur', cancel, { signal });
    signal.addEventListener('abort', cancel, { once: true });
    return result;
  }
  Object.defineProperty(bindQuickInput, 'codexQuickInput', { value: true });
  proto.bindEvents = bindQuickInput;
})();
