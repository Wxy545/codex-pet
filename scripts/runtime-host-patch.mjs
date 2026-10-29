/** 原生右键与Ctrl点击共用openSite；WorkBuddy只唤起已核实程序，不打开旧AI设置或任意URL。 */
export function patchHostOpenTarget(source) {
  const marker='// codex-pet-workbuddy-open-target-v1';
  if(source.includes(marker))return source;
  const anchor='const openSite = (url) => {';
  if(source.split(anchor).length!==2)throw new Error('宿主打开入口锚点不匹配。');
  return source.replace(anchor,anchor+`\n    ${marker}
    if (process.env.CODEX_PET_HOST === 'workbuddy') {
      void require('./codex-startup.cjs').createTargetRequest({host:'workbuddy'})('focus').catch(() => {});
      return;
    }`);
}
