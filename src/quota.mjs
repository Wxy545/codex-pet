import Locale from './codex-locale.cjs';
// Codex 提供的是额度窗口；没有月度数据时不补造月度余额。
export function codexQuotaResult(usage, now = Date.now(), locale = Locale.getLocale()) {
  const windows = usage?.windows ?? (usage ? [usage] : []);
  const data = {};
  for (const window of windows) {
    const percent = window.usedPercent;
    const minutes = window.windowMinutes;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
    const reset = Number(window.resetsAt);
    if (Number.isFinite(reset) && reset > 0 && reset * 1000 <= now) continue;
    const key = minutes >= 40000 ? 'monthly' : minutes >= 10000 ? 'weekly' : 'rolling';
    if (data[key] !== undefined && data[key] > percent) continue;
    data[key] = percent;
    if (key === 'rolling') data.rollingLabel = window.windowLabel || (minutes ? `${minutes / 60}h` : Locale.t('当前', {}, locale));
    if (Number.isFinite(reset) && reset > 0) data[`${key}ResetsAt`] = new Date(reset * 1000).toISOString();
  }
  if (!['rolling', 'weekly', 'monthly'].some(key => data[key] !== undefined)) {
    throw new Error(Locale.t('Codex 暂无有效额度快照，请在主聊天产生一次新回复后再查看。', {}, locale));
  }
  return { ok: true, provider: 'standalone', shape: 'windows', data };
}
