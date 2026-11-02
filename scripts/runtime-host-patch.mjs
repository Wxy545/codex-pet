/** 原生右键与Ctrl点击共用openSite；WorkBuddy只唤起已核实程序，不打开旧AI设置或任意URL。 */
export function patchHostOpenTarget(source,{startupModule='./codex-startup.cjs'}={}) {
  if(!['./codex-startup.cjs','../codex-startup.cjs'].includes(startupModule))throw Error('宿主打开模块不匹配。');
  const marker='// codex-pet-workbuddy-open-target-v1';
  const anchor='const openSite = (url) => {';
  const patched=anchor+`\n    ${marker}
    if (process.env.CODEX_PET_HOST === 'workbuddy') {
      void require('${startupModule}').createTargetRequest({host:'workbuddy'})('focus').catch(() => {});
      return;
    }`;
  if(source.split(anchor).length!==2)throw new Error('宿主打开入口锚点不匹配。');
  if(source.includes(marker)){
    if(source.split(marker).length!==2||source.split(patched).length!==2)throw Error('宿主打开入口锚点不匹配。');
    return source;
  }
  return source.replace(anchor,patched);
}
