(() => {
  'use strict';
  const bridge=window.petHost;
  const shared=window.PetShared;
  if(!bridge||!shared||typeof PetSprite!=='function')return;
  let host=bridge.initialHost||'codex',closed=false;
  void bridge.getState().then(value=>{if(!closed&&['codex','workbuddy','harness'].includes(value?.host))host=value.host;}).catch(()=>{});
  window.addEventListener('beforeunload',()=>{closed=true;},{once:true});
  const mount=shared.mountContextMenu;
  // 没有接入的账号能力不提供入口，动作点播中的余额和碎念视频仍可观看。
  function filter(nodes){return nodes.flatMap(node=>{
    if(node.action==='third-party')return[node];
    if(host==='harness'&&node.action==='open-site')return[];
    if(host==='workbuddy'&&node.action==='open-site')return[{...node,label:(window.CodexLocale?.getLocale()||navigator.language).startsWith('zh')?'打开 WorkBuddy':'Open WorkBuddy'}];
    if(host!=='codex'&&['chat','codex-task-panel','qq-remote-settings','show-balance','balance','say','whisper','open-ai-settings'].includes(node.action))return[];
    return[{...node,...(node.children?{children:filter(node.children)}:{})}];
  });}
  shared.mountContextMenu=function(options){
    if(!options?.tree?.some(item=>['chat','open-site','home','reload'].includes(item.action)))return mount.apply(this,arguments);
    const zh=(window.CodexLocale?.getLocale()||navigator.language).startsWith('zh');
    const tree=filter(options.tree);
    if(window.codexControl?.open)tree.unshift({label:zh?'控制中心':'Control center',action:'pet-control-center'});
    if(window.petVisibility?.setManualHidden)tree.push({label:zh?'隐藏桌宠':'Hide pet',action:'pet-hide'});
    if(host==='codex'&&window.qqRemoteSettings?.open)tree.push({label:zh?'QQ 远程任务':'QQ remote tasks',action:'qq-remote-settings'});
    tree.push({label:zh?'联动应用':'Companion app',children:[['codex','Codex'],['workbuddy','WorkBuddy'],['harness',zh?'DeepSeek Harness（原生插件）':'DeepSeek Harness (native plugin)']].map(([id,label])=>({label:(id===host?'✓ ':'')+label,action:'pet-select-host',host:id}))});
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
