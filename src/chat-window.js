'use strict';

(() => {
  const api = window.chatPanel;
  const byId = id => document.getElementById(id);
  const ui = {
    form: byId('chat-form'), input: byId('message-input'), messages: byId('messages'),
    attachments: byId('attachments'), choose: byId('choose-images'), send: byId('send'),
    reset: byId('new-conversation'), task: byId('open-tasks'), status: byId('status'), toast: byId('message'),
  };
  let state = { messages: [], attachments: [], busy: false, selecting: false };
  let pending = false;
  let stopped = false;
  let toastTimer;
  let unsubscribe = () => {};
  const locked = () => pending || state.busy || state.selecting;
  function notify(text) {
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 6000);
  }
  function imageElement(image) {
    const img = document.createElement('img');
    img.src = image.dataUrl;
    img.alt = image.name || '用户图片';
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }
  function renderMessages() {
    ui.messages.replaceChildren(...state.messages.map(message => {
      const article = document.createElement('article');
      article.className = 'bubble ' + (message.role === 'user' ? 'user' : 'assistant');
      article.setAttribute('aria-label', message.role === 'user' ? '我' : '桌宠');
      const body = document.createElement('div');
      body.className = 'message-text';
      body.textContent = message.text || (message.imageNote ? '[较早图片已移出本轮上下文]' : '');
      article.append(body);
      if (message.images?.length) {
        const images = document.createElement('div'); images.className = 'sent-images';
        images.append(...message.images.map(imageElement)); article.append(images);
      }
      return article;
    }));
    ui.messages.scrollTop = ui.messages.scrollHeight;
  }
  function render() {
    const busy = locked();
    ui.input.disabled = busy; ui.choose.disabled = busy || state.attachments.length >= 4;
    ui.reset.disabled = busy;
    ui.send.disabled = busy || (!ui.input.value.trim() && !state.attachments.length);
    ui.send.textContent = state.busy ? '思考中…' : '发送';
    ui.status.textContent = state.busy ? '思考中，结束前不能再次发送' : state.selecting ? '正在读取图片…' : '就绪';
    ui.attachments.hidden = state.attachments.length === 0;
    ui.attachments.replaceChildren(...state.attachments.map(image => {
      const item = document.createElement('div'); item.className = 'attachment';
      item.append(imageElement(image));
      const label = document.createElement('span'); label.textContent = image.name; label.title = image.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除'; remove.disabled = busy;
      remove.setAttribute('aria-label', '移除' + image.name);
      remove.addEventListener('click', () => operate(() => api.removeImage(image.id)));
      item.append(label, remove); return item;
    }));
  }
  function receive(response, announce = true) {
    if (response?.state) { state = response.state; renderMessages(); }
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
    if (result?.ok) ui.input.value = '';
    return result;
  }));
  ui.task.addEventListener('click', async () => {
    try { receive(await api.openTaskPanel()); } catch { notify('请在桌宠上右键，选择“操作任务”。'); }
  });
  ui.input.addEventListener('input', () => { ui.send.disabled = locked() || (!ui.input.value.trim() && !state.attachments.length); });
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
    const imageIds = state.attachments.map(image => image.id);
    pending = true; render();
    ui.input.value = '';
    try {
      const response = await api.sendMessage({ text, imageIds });
      if (!receive(response)) ui.input.value = text;
    } catch { ui.input.value = text; notify('暂时无法连接桌宠服务，请稍后重试。'); }
    finally { pending = false; if (!stopped) { render(); ui.input.focus(); } }
  });
  window.addEventListener('beforeunload', () => { stopped = true; unsubscribe(); clearTimeout(toastTimer); });
  if (!api) { notify('对话窗口未连接，请从桌宠右键菜单重新打开。'); render(); return; }
  unsubscribe = api.onState(next => {
    if (stopped) return;
    state = next; renderMessages(); render();
  });
  void api.getState().then(response => { receive(response, false); if (!locked()) ui.input.focus(); }).catch(() => notify('暂时无法读取对话状态。'));
  render();
})();
