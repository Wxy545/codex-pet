(() => {
  'use strict';
  const bridge=window.petHost;
  const shared=window.PetShared;
  if(!bridge||!shared||typeof PetSprite!=='function')return;
  let host=bridge.initialHost||'codex',closed=false;
  void bridge.getState().then(value=>{if(!closed&&['codex','workbuddy','harness'].includes(value?.host))host=value.host;}).catch(()=>{});
  window.addEventListener('beforeunload',()=>{closed=true;},{once:true});
  const mount=shared.mountContextMenu;
  const registered=node=>node.action==='third-party'||node.children?.some(registered);
  const managed=new Set(['open-ai-settings','set-display','display','reload','codex-select-skin','codex-startup-mode','codex-startup-preview','pet-select-host','qq-remote-settings']);
  // 管理项和长动作表进入控制中心；注册协议分支整体保留，不能递归改掉owner或label。
  function filter(nodes){return nodes.flatMap(node=>{
    if(registered(node))return[node];
    if(node.anim||managed.has(node.action))return[];
    if(host!=='workbuddy'&&node.action==='open-site')return[];
    if(host==='workbuddy'&&node.action==='open-site')return[{...node,label:(window.CodexLocale?.getLocale()||navigator.language).startsWith('zh')?'打开 WorkBuddy':'Open WorkBuddy'}];
    if(host!=='codex'&&['chat','codex-task-panel','qq-remote-settings','say','whisper','open-ai-settings'].includes(node.action))return[];
    if(host==='harness'&&['show-balance','balance'].includes(node.action))return[];
    const children=node.children?filter(node.children):null;if(children&&!children.length)return[];
    return[{...node,...(children?{children}:{})}];
  });}
  shared.mountContextMenu=function(options){
    if(!options?.tree?.some(item=>['chat','open-site','home','reload'].includes(item.action)))return mount.apply(this,arguments);
    const zh=(window.CodexLocale?.getLocale()||navigator.language).startsWith('zh');
    const tree=filter(options.tree);
    if(window.codexControl?.open)tree.unshift({label:zh?'控制中心':'Control center',action:'pet-control-center'});
    tree.push(...(window.CodexPetActions?.quickMenu?.()||[]).slice(0,3));
    if(window.petVisibility?.setManualHidden)tree.push({label:zh?'隐藏桌宠':'Hide pet',action:'pet-hide'});
    return mount.call(this,{...options,tree});
  };
  const action=PetSprite.prototype.onMenuAction;
  PetSprite.prototype.onMenuAction=function(leaf){
    if(leaf?.action==='pet-hide'&&window.petVisibility?.setManualHidden){this.closeMenu();void window.petVisibility.setManualHidden(true).catch(()=>{});return;}
    if((leaf?.action==='pet-control-center'||leaf?.action==='open-ai-settings')&&window.codexControl?.open){this.closeMenu();void window.codexControl.open();return;}
    if(leaf?.action==='qq-remote-settings'&&window.qqRemoteSettings?.open){this.closeMenu();void window.qqRemoteSettings.open();return;}
    if(leaf?.action==='pet-select-host'){
      this.closeMenu();void bridge.selectHost(leaf.host).catch(()=>console.warn('[Codex Pet] Companion app could not be changed.'));return;
    }
    return action.apply(this,arguments);
  };
})();
