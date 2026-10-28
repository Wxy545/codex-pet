'use strict';

(() => {
  const api = window.taskPanel;
  const L = window.CodexLocale;
  const T = L.t;
  const element = id => document.getElementById(id);
  const fields = {
    form: element('task-form'), directory: element('directory'), choose: element('choose-directory'),
    task: element('task'), permissions: element('permissions'), confirmation: element('confirmation'),
    submit: element('submit-task'), cancel: element('cancel-task'), retry: element('retry-state'),
    state: element('execution-state'), scope: element('active-scope'), progress: element('progress'),
    result: element('result-text'), copy: element('copy-result'), message: element('message'), count: element('character-count'),
  };
  const STATE_TEXT = { idle: '尚未开始', running: '正在执行', cancelling: '正在取消', completed: '已返回结果', failed: '未完成', cancelled: '已取消', timed_out: '已超时' };
  let snapshot = { state: 'idle', progress: [], summary: '' };
  let pending = false;
  let connected = false;
  let polling = false;
  let stopped = false;
  let timer = null;
  let messageTimer = null;
  let revision = 0;

  const permission = () => fields.form.elements.permission.value;
  const active = () => ['running', 'cancelling'].includes(snapshot.state);
  function notify(text) {
    fields.message.textContent = T(text);
    fields.message.hidden = false;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { fields.message.hidden = true; }, 6000);
  }
  function render() {
    window.CodexPanelLocale.apply(snapshot.locale);
    document.title = `Codex Pet · ${T('操作任务')}`;
    const busy = pending || active();
    fields.choose.disabled = busy;
    fields.task.disabled = busy;
    fields.permissions.disabled = busy;
    fields.count.textContent = fields.task.value.length + ' / 12000';
    fields.submit.disabled = busy || !connected || !fields.directory.value || !fields.task.value.trim();
    fields.submit.textContent = T(permission() === 'workspace-write' ? '确认并允许修改' : '确认执行');
    fields.cancel.hidden = !active();
    fields.cancel.disabled = pending || snapshot.state === 'cancelling';
    fields.retry.hidden = connected;
    fields.copy.disabled = pending || !snapshot.summary;
    fields.confirmation.textContent = fields.directory.value && fields.task.value.trim()
      ? T(permission() === 'workspace-write' ? '确认后，按工作目录写入权限执行：' : '本次禁止写入，工作目录：') + fields.directory.value
      : T('选择目录并填写任务后，可确认执行。');
    fields.state.textContent = T(connected ? STATE_TEXT[snapshot.state] || '状态未知' : '暂时无法读取任务状态');
    fields.scope.hidden = !snapshot.cwd;
    fields.scope.textContent = snapshot.cwd ? T(snapshot.permission === 'workspace-write' ? '工作目录读写 · ' : '只读，禁止写入 · ') + snapshot.cwd : '';
    fields.progress.replaceChildren(...(snapshot.progress || []).map(item => {
      const li = document.createElement('li');
      li.textContent = item.text;
      return li;
    }));
    fields.result.textContent = snapshot.summary || snapshot.error?.message || '';
  }
  function receive(response, announce = false) {
    if (!response?.ok) {
      if (response?.code === 'host_unavailable') connected = false;
      if (announce) notify(response?.message || '操作未完成，请稍后重试。');
      return false;
    }
    if (response.snapshot) { snapshot = response.snapshot; connected = true; }
    if (!fields.directory.value && response.selectedDirectory) fields.directory.value = response.selectedDirectory;
    return true;
  }
  async function poll() {
    if (stopped || polling || pending) return;
    polling = true;
    const requestRevision = revision;
    try {
      const response = await api.getState();
      if (!stopped && requestRevision === revision) connected = receive(response);
    }
    catch { if (requestRevision === revision) connected = false; }
    finally { polling = false; if (!stopped) render(); }
  }
  async function operate(action) {
    if (pending) return;
    revision += 1;
    pending = true; render();
    try { await action(); }
    catch { notify('操作未完成，请稍后重试。'); }
    finally { pending = false; render(); }
  }
  fields.choose.addEventListener('click', () => operate(async () => {
    const response = await api.chooseDirectory();
    if (!receive(response, true) || response.cancelled) return;
    fields.directory.value = response.directory || '';
  }));
  fields.form.addEventListener('submit', event => {
    event.preventDefault();
    if (fields.submit.disabled) return;
    void operate(async () => {
      receive(await api.submitTask({ cwd: fields.directory.value, task: fields.task.value, permission: permission(), confirmed: true }), true);
    });
  });
  fields.cancel.addEventListener('click', () => operate(async () => { receive(await api.cancelTask(snapshot.id), true); }));
  fields.copy.addEventListener('click', () => operate(async () => { if (receive(await api.copyResult(), true)) notify('结果已复制。'); }));
  fields.retry.addEventListener('click', () => { void poll(); });
  fields.task.addEventListener('input', render);
  fields.permissions.addEventListener('change', render);
  window.addEventListener('beforeunload', () => { stopped = true; clearInterval(timer); clearTimeout(messageTimer); });
  if (!api) { notify('任务面板未连接，请从桌宠右键菜单重新打开。'); render(); return; }
  render();
  void poll();
  timer = setInterval(() => { void poll(); }, 1000);
})();
