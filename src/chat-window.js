'use strict';

(() => {
  const api = window.chatPanel;
  const L = window.CodexLocale;
  const T = L.t;
  const localize = locale => window.CodexPanelLocale.apply(locale);
  const byId = id => document.getElementById(id);
  const ui = {
    form: byId('chat-form'), input: byId('message-input'), messages: byId('messages'),
    attachments: byId('attachments'), choose: byId('choose-images'), send: byId('send'),
    reset: byId('new-conversation'), task: byId('open-tasks'), status: byId('status'), character: byId('character-name'), toast: byId('message'),
  };
  let state = { messages: [], attachments: [], busy: false, selecting: false };
  let pending = false;
  let stopped = false;
  let toastTimer;
  let unsubscribe = () => {};
  let renderedMessages = [];
  let renderedContext = '';
  let following = true;
  let followNext = false;
  const locked = () => pending || state.busy || state.selecting;
  function notify(text) {
    ui.toast.textContent = T(text);
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 6000);
  }
  function imageElement(image, inHistory = false) {
    const img = document.createElement('img');
    img.src = image.dataUrl;
    img.alt = image.name || T('用户图片');
    img.loading = 'lazy';
    img.decoding = 'async';
    if (inHistory) img.addEventListener('load', () => { if (following) ui.messages.scrollTop = ui.messages.scrollHeight; });
    return img;
  }
  function sameMessages(previous, next) {
    return previous.length === next.length && previous.every((message, index) => {
      const other = next[index];
      return message.role === other.role && message.text === other.text && message.imageNote === other.imageNote
        && (message.images?.length || 0) === (other.images?.length || 0)
        && (message.images || []).every((image, imageIndex) => {
          const otherImage = other.images[imageIndex];
          return image.id === otherImage.id && image.name === otherImage.name && image.dataUrl === otherImage.dataUrl;
        });
    });
  }
  function renderMessages() {
    const context = `${state.character?.id}/${state.character?.name}/${state.locale}`;
    // 状态与附件更新不重建正文；用户翻阅历史时，新回复也不抢走阅读位置。
    if (context === renderedContext && sameMessages(renderedMessages, state.messages)) return;
    const scrollTop = ui.messages.scrollTop;
    const follow = followNext || following || context !== renderedContext;
    renderedMessages = state.messages;
    renderedContext = context;
    following = follow;
    followNext = false;
    ui.messages.replaceChildren(...state.messages.map(message => {
      const article = document.createElement('article');
      article.className = 'bubble ' + (message.role === 'user' ? 'user' : 'assistant');
      article.setAttribute('aria-label', message.role === 'user' ? T('我') : state.character?.name || T('桌宠'));
      const author = document.createElement('div');
      author.className = 'message-author';
      author.textContent = message.role === 'user' ? T('我') : state.character?.name || T('桌宠');
      const body = document.createElement('div');
      body.className = 'message-text';
      body.textContent = message.text || (message.imageNote ? T('[较早图片已移出本轮上下文]') : '');
      article.append(author, body);
      if (message.images?.length) {
        const images = document.createElement('div'); images.className = 'sent-images';
        images.append(...message.images.map(image => imageElement(image, true))); article.append(images);
      }
      return article;
    }));
    ui.messages.scrollTop = follow ? ui.messages.scrollHeight : scrollTop;
  }
  function render() {
    localize(state.locale);
    document.title = `Codex Pet · ${state.character?.name || T('桌宠')} · ${T('对话')}`;
    const busy = locked();
    ui.input.disabled = busy; ui.choose.disabled = busy || state.attachments.length >= 4;
    ui.reset.disabled = busy;
    ui.send.disabled = busy || (!ui.input.value.trim() && !state.attachments.length);
    ui.send.textContent = T(state.busy ? '思考中…' : '发送');
    ui.status.textContent = T(state.busy ? '思考中，结束前不能再次发送' : state.selecting ? '正在读取图片…' : '就绪');
    ui.status.dataset.state = busy ? 'busy' : 'ready';
    ui.character.textContent = state.character?.name || T('桌宠');
    ui.messages.setAttribute('aria-busy', String(state.busy));
    ui.attachments.hidden = state.attachments.length === 0;
    ui.attachments.replaceChildren(...state.attachments.map(image => {
      const item = document.createElement('div'); item.className = 'attachment';
      item.append(imageElement(image));
      const label = document.createElement('span'); label.textContent = image.name; label.title = image.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = T('移除'); remove.disabled = busy;
      remove.setAttribute('aria-label', T('移除 {name}', { name: image.name }));
      remove.addEventListener('click', () => operate(() => api.removeImage(image.id)));
      item.append(label, remove); return item;
    }));
  }
  function updateState(next) {
    if (!next || (next.revision ?? 0) < (state.revision ?? 0)) return;
    // 草稿与当前角色一致；切角色或语言后不把未提交的话带入新对话。
    if (state.character && (state.character.id !== next.character?.id || state.locale !== next.locale)) ui.input.value = '';
    state = next; localize(state.locale); renderMessages();
  }
  function receive(response, announce = true) {
    updateState(response?.state);
    if (!response?.ok && announce) notify(response?.message || '操作未完成，请稍后重试。');
    render();
    return response?.ok === true;
  }
  async function operate(action) {
    if (locked() || stopped) return;
    pending = true; render();
    try { receive(await action()); } catch { notify('暂时无法连接桌宠服务。'); }
    finally { pending = false; if (!stopped) render(); }
  }
  ui.choose.addEventListener('click', () => operate(() => api.chooseImages()));
  ui.reset.addEventListener('click', () => operate(async () => {
    const result = await api.newConversation();
    if (result?.ok) { ui.input.value = ''; followNext = true; }
    return result;
  }));
  ui.task.addEventListener('click', async () => {
    try { receive(await api.openTaskPanel()); } catch { notify('请在桌宠上右键，选择“操作任务”。'); }
  });
  ui.input.addEventListener('input', () => { ui.send.disabled = locked() || (!ui.input.value.trim() && !state.attachments.length); });
  ui.messages.addEventListener('scroll', () => { following = ui.messages.scrollHeight - ui.messages.clientHeight - ui.messages.scrollTop <= 48; });
  ui.input.addEventListener('paste', event => {
    const images = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    if (!locked()) void operate(() => api.pasteImage());
  });
  ui.input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!ui.send.disabled) ui.form.requestSubmit();
    }
  });
  ui.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (locked() || ui.send.disabled) return;
    const text = ui.input.value;
    const context = `${state.character?.id}/${state.locale}`;
    const imageIds = state.attachments.map(image => image.id);
    followNext = true;
    pending = true; render();
    ui.input.value = '';
    try {
      const response = await api.sendMessage({ text, imageIds });
      if (!receive(response) && response?.code !== 'character_changed' && context === `${state.character?.id}/${state.locale}`) ui.input.value = text;
    } catch { if (context === `${state.character?.id}/${state.locale}`) ui.input.value = text; notify('暂时无法连接桌宠服务，请稍后重试。'); }
    finally { pending = false; if (!stopped) { render(); ui.input.focus(); } }
  });
  window.addEventListener('beforeunload', () => { stopped = true; unsubscribe(); clearTimeout(toastTimer); });
  if (!api) { notify('对话窗口未连接，请从桌宠右键菜单重新打开。'); render(); return; }
  unsubscribe = api.onState(next => {
    if (stopped) return;
    updateState(next); render();
  });
  void api.getState().then(response => { receive(response, false); if (!locked()) ui.input.focus(); }).catch(() => notify('暂时无法读取对话状态。'));
  render();
})();
