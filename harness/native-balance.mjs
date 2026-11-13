import {lstatSync,readFileSync,realpathSync,renameSync,unlinkSync,writeFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {basename,dirname,isAbsolute,join,relative,sep} from 'node:path';

const inside=(root,file)=>{const rel=relative(root,file);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
const marker='/* codex-pet-native-balance-v1 */';
function replaceOne(source,before,after){
 const old=source.split(before).length-1,next=source.split(after).length-1;
 if(next===1&&old===after.split(before).length-1)return source;
 if(old!==1||next!==0)throw Error('harness-native-balance-anchor-mismatch');
 return source.replace(before,after);
}

/** 原余额计算和币种金额保留，只翻译展示标签；不读取或请求账户。 */
export function localizeBalanceShared(shared,locale){
 if(locale==='zh-CN')return shared;
 const label=value=>typeof value!=='string'?value:value.replace(/余额/g,'Balance ').replace(/（/g,'(').replace(/）/g,') ').replace(/峰/g,'peak').replace(/谷/g,'off-peak').replace(/积分|点数/g,'credits').replace(/数据不可用/g,'unavailable').replace(/重置时间未知/g,'Reset time unavailable').replace(/已重置/g,'Reset').replace(/小时/g,'h').replace(/分钟/g,'m').replace(/天/g,'d').replace(/后?重置/g,' until reset').replace(/ {2,}/g,' ');
 const rows=fn=>state=>fn(state).map(row=>({...row,...(typeof row.text==='string'?{text:label(row.text)}:{}),...(typeof row.resetText==='string'?{resetText:label(row.resetText)}:{})}));
 return{...shared,balanceBubbleView:rows(shared.balanceBubbleView),balanceDetailView:rows(shared.balanceDetailView)};
}

/** 原生网页端为React，不安装桌面类补丁；余额只来自PetCard已有的balance属性。 */
export function createNativeFooter(rt,status,shared,locale,tasks){
 const {h,useState,useEffect,useRef}=rt;
 return function CodexNativeBalanceFooter({balance,enabled,size,onMeasure}){
  const [expanded,setExpanded]=useState(false),ref=useRef(null),taskRef=useRef(null),view=status.quotaView(balance,shared,locale),en=locale!=='zh-CN';
  useEffect(()=>{
   if(!enabled&&!tasks){onMeasure?.(0);return;}
   const measure=()=>{if(ref.current)onMeasure?.(Math.ceil(ref.current.offsetHeight)+8);};measure();
   if(typeof ResizeObserver!=='function'||!ref.current)return;
   const observer=new ResizeObserver(measure);observer.observe(ref.current);return()=>observer.disconnect();
  },[enabled,size,expanded,view.text]);
  useEffect(()=>{if(!tasks||!taskRef.current)return;const widget=tasks.create({window,document,locale,container:taskRef.current});return()=>widget.dispose();},[Boolean(tasks)]);
  if(!enabled&&!tasks)return null;
  const hasDetails=view.details.length>0,open=expanded&&hasDetails;
  return h('div',{ref,className:'pet-status-footer',style:{left:size/2+'px',top:size*9/16+8+'px',width:Math.min(260,Math.max(180,size*.42))+'px'},children:
   [enabled?h('div',{className:'pet-status-quota'+(hasDetails?' is-interactive':''),children:[
    h('button',{type:'button',className:'pet-status-quota-toggle',disabled:!hasDetails,'aria-expanded':open,onClick:event=>{event.preventDefault();event.stopPropagation();setExpanded(value=>!value);},children:[
     h('span',{className:'pet-status-quota-label',children:view.text}),
     view.remaining===null?null:h('span',{className:'pet-status-quota-track',role:'progressbar','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':view.remaining,'aria-label':en?'Usage remaining':'剩余额度',children:h('span',{className:'pet-status-quota-fill',style:{width:view.remaining+'%'}})}),
    ]}),
    open?h('div',{className:'pet-status-quota-details',children:view.details.map(row=>h('div',{key:row.label,className:'pet-status-quota-row',children:[h('span',{className:'pet-status-quota-window',children:row.label}),h('span',{className:'pet-status-quota-value',children:en?Math.round(row.remaining)+'% left':'剩余 '+Math.round(row.remaining)+'%'}),h('span',{className:'pet-status-quota-reset',children:row.reset})]}))}):null,
   ]}):null,tasks?h('div',{ref:taskRef}):null]});
 };
}

function statusModule(source){return `(()=>{const module={exports:{}};\n${source}\nreturn module.exports;})()`;}
export function patchNativeWebBalance(input,{statusScript,statusCss,locale,taskScript,version='0.4.0'}){
 if(!['0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7','0.4.8'].includes(version))throw Error('harness-native-balance-version-unsupported');
 let source=input.replaceAll('\r\n','\n');
 const start=marker+'\n',end='/* /codex-pet-native-balance-v1 */\n';
 const block=start+`const CodexNativeStatus=${statusModule(statusScript)};\nconst CodexNativeTaskUI=${taskScript?statusModule(taskScript):'null'};\nconst codexNativeTaskFeature=${Boolean(taskScript)};\nconst CodexNativeBalanceShared=(${localizeBalanceShared.toString()})({balanceDetailView,balanceBubbleView,balancePercent},${JSON.stringify(locale)});\nfunction codexNativeFooter(rt){return (${createNativeFooter.toString()})(rt,CodexNativeStatus,CodexNativeBalanceShared,${JSON.stringify(locale)},CodexNativeTaskUI);}\nfunction injectCodexNativeBalanceCss(){if(document.querySelector('style[data-codex-native-balance]'))return;const style=document.createElement('style');style.setAttribute('data-codex-native-balance','1');style.textContent=${JSON.stringify(statusCss)};document.head.appendChild(style);}\n`+end;
 if(source.includes(start)){
  const from=source.indexOf(start),to=source.indexOf(end,from);if(to<0||source.indexOf(start,from+start.length)>=0)throw Error('harness-native-balance-anchor-mismatch');
  source=source.slice(0,from)+block+source.slice(to+end.length);
 }else source=replaceOne(source,'function makePetUI(rt) {',block+'function makePetUI(rt) {');
 // 0.4.0 将卡片拆成 view/runtime/motion；只在新装配边界挂脚下条。
 source=replaceOne(source,'function createCardRuntime(rt) {\n\tconst { h, useEffect, useRef, useState } = rt;','function createCardRuntime(rt) {\n\tconst { h, useEffect, useRef, useState } = rt;\n\tinjectCodexNativeBalanceCss();\n\tconst CodexNativeBalanceFooter=codexNativeFooter(rt);');
 const cardState=['0.4.3','0.4.5','0.4.6','0.4.7','0.4.8'].includes(version)?'\t\tconst { corner, customPos, facing, margin, size, tipOn } = state;':'\t\tconst { corner, customPos, dragging, facing, margin, size, tipOn } = state;';
 source=replaceOne(source,cardState,cardState+'\n\t\tconst [nativeFooterSpace,setNativeFooterSpace]=useState(cfg.balanceEnabled||codexNativeTaskFeature?34:0);\n\t\tconst footerSpace=cfg.balanceEnabled||codexNativeTaskFeature?nativeFooterSpace:0;');
 source=replaceOne(source,'if (input.balanceOn && input.balanceAvailable && (input.balanceEnabled || input.balanceManual)) return "balance";','if (!input.balanceEnabled && input.balanceOn && input.balanceAvailable && input.balanceManual) return "balance";');
 source=replaceOne(source,'\t\t\t\tprops.bubble,','\t\t\t\tprops.bubble,\n\t\t\t\tprops.nativeFooter,');
 source=replaceOne(source,'\t\t\tbubble: bubbles.node(),','\t\t\tbubble: bubbles.node(),\n\t\t\tnativeFooter:h(CodexNativeBalanceFooter,{balance,enabled:cfg.balanceEnabled,size,onMeasure:setNativeFooterSpace}),');
 source=replaceOne(source,'\t\t\tmarginY: margin.y,','\t\t\tmarginY: margin.y+footerSpace,');
 // 归一化中心仍以完整视口存储，仅夹最终绘制与地面边界，避免松手时跳位。
 source=replaceOne(source,'\t\t\tw: halfW\n\t\t});\n\t\treturn {\n\t\t\tbubble:','\t\t\tw: halfW\n\t\t});\n\t\tif(customPos&&footerSpace)rootStyle.top=Math.min(customPos.ry*window.innerHeight-halfH,Math.max(0,window.innerHeight-halfH*2-footerSpace))+"px";\n\t\treturn {\n\t\t\tbubble:');
 source=replaceOne(source,'\t\t\t\tbottomPad,\n\t\t\t\thalfH,','\t\t\t\tbottomPad,\n\t\t\t\tnativeFooterSpace:footerSpace,\n\t\t\t\thalfH,');
 source=replaceOne(source,'\t\t\tH: viewport.height,\n\t\t\tsize: metrics.size,','\t\t\tH: viewport.height-(metrics.nativeFooterSpace||0),\n\t\t\tsize: metrics.size,');
 return source;
}

export function prepareHarnessBalance({profileDir,sourceRoot,locale='en',withTasks=false}){
 if(!isAbsolute(profileDir)||!isAbsolute(sourceRoot))throw Error('absolute-harness-profile-required');
 const require=createRequire(join(profileDir,'package.json')),profile=realpathSync(profileDir),pkg=realpathSync(dirname(require.resolve('dsh-pet/package.json')));
 if(!inside(profile,pkg))throw Error('harness-dsh-pet-outside-selected-profile');
 const meta=JSON.parse(readFileSync(join(pkg,'package.json'),'utf8'));if(meta.name!=='dsh-pet'||!['0.4.0','0.4.1','0.4.3','0.4.5','0.4.6','0.4.7','0.4.8'].includes(meta.version))throw Error('harness-dsh-pet-0.4.0-or-0.4.1-or-0.4.3-or-0.4.5-or-0.4.6-or-0.4.7-or-0.4.8-required');
 const statusScript=readFileSync(join(sourceRoot,'runtime','pet-status-strip.js'),'utf8'),taskScript=withTasks?readFileSync(join(sourceRoot,'native-tasks-ui.js'),'utf8'):null,statusCss=readFileSync(join(sourceRoot,'runtime','pet-status-strip.css'),'utf8')+(withTasks?'\n'+readFileSync(join(sourceRoot,'native-tasks.css'),'utf8'):'');
 const files=[];
 function plan(name,transform,fresh=false){
  const file=join(pkg,name),parent=realpathSync(dirname(file));if(!inside(pkg,parent)||!inside(profile,parent))throw Error('unsafe-harness-balance-file-outside-profile');
  let before=null,mode=0o644,realFile=join(parent,basename(file));
  try{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('unsafe-harness-balance-file');before=readFileSync(file,'utf8');mode=stat.mode;realFile=realpathSync(file);if(fresh&&!before.startsWith(marker))throw Error('unmanaged-harness-balance-file');}catch(error){if(error.code!=='ENOENT'||!fresh)throw error;}
  if(!inside(pkg,realFile)||!inside(profile,realFile))throw Error('unsafe-harness-balance-file-outside-profile');
  files.push({name,file,before,after:transform(before),mode,realFile});
 }
 plan('lib/client.js',input=>{
  const source=patchNativeWebBalance(input,{statusScript,statusCss,locale,taskScript,version:meta.version});if(!withTasks)return source;
  const anchor='}), "dsh-pet: notifications");';
  const extra=anchor+'\n\t\t\tctx.effect(()=>CodexNativeTaskUI.installNavigation({window,document,navigate:sessionId=>{const ui=ctx.get?.("uiWorkspace");if(typeof ui?.openSession!=="function")return false;ui.openSession(sessionId);return true;}}),"codex-pet: native task navigation");';
  return replaceOne(source,anchor,extra);
 });
 plan('runtime/electron-helper/sprite.js',input=>{
  const source=input.replaceAll('\r\n','\n');
  return replaceOne(source,'      r: m,\n      b: m,\n      l: m,','      r: m,\n      b: Math.max(m, 184),\n      l: m,');
 });
 plan('runtime/electron-helper/sprite/input.js',input=>replaceOne(input.replaceAll('\r\n','\n'),'.dsh-pet-menu-column, .dsh-pet-chat, .dsh-pet-todo, .pet-bubble.is-clickable','.dsh-pet-menu-column, .dsh-pet-chat, .dsh-pet-todo, .pet-bubble.is-clickable, .pet-status-quota.is-interactive'));
 plan('runtime/electron-helper/index.html',input=>{
  let html=input.replaceAll('\r\n','\n');html=replaceOne(html,'</head>','<link rel="stylesheet" href="./codex-pet-status-strip.css">\n</head>');
  return replaceOne(html,'<script src="./renderer.js"></script>','<script src="./codex-pet-status-strip.js"></script>\n<script src="./renderer.js"></script>');
 });
 const desktop=marker+'\n(()=>{const status='+statusModule(statusScript)+';'+(withTasks?'const taskUI='+statusModule(taskScript)+';const tasks=taskUI.create({window,document,endpoint:BASE+"/native-tasks",locale:'+JSON.stringify(locale)+',showChip:false,autoPoll:false,openHost:()=>window.petBridge?.openDshSite?.(ORIGIN)});window.addEventListener("beforeunload",()=>tasks.dispose(),{once:true});':'')+'const shared=('+localizeBalanceShared.toString()+')(window.PetShared,'+JSON.stringify(locale)+');status.install({window:{PetShared:shared,CodexLocale:{getLocale:()=>'+JSON.stringify(locale)+'},'+(withTasks?'petWorkbench:tasks,':'')+'addEventListener:window.addEventListener.bind(window)},document,PetSprite});})();\n';
 plan('runtime/electron-helper/codex-pet-status-strip.js',()=>desktop,true);plan('runtime/electron-helper/codex-pet-status-strip.css',()=>marker+'\n'+statusCss,true);
 const changed=[];
 // 所有锚点通过后再原子替换，断开pnpm硬链接，不改共享store或其他profile。
 for(const item of files){
  if(item.before===item.after)continue;
  const parent=realpathSync(dirname(item.file));if(!inside(pkg,parent)||!inside(profile,parent))throw Error('unsafe-harness-balance-file-outside-profile');
  if(item.before===null){if(existsSync(item.file))throw Error('harness-upstream-file-changed');}
  else if(realpathSync(item.file)!==item.realFile||lstatSync(item.file).isSymbolicLink()||readFileSync(item.file,'utf8')!==item.before)throw Error('harness-upstream-file-changed');
  const temporary=item.file+'.balance-'+randomUUID();try{writeFileSync(temporary,item.after,{flag:'wx',mode:item.mode});renameSync(temporary,item.file);changed.push(item.name);}finally{if(existsSync(temporary))unlinkSync(temporary);}
 }
 return{status:changed.length?'updated':'current',version:meta.version,files:changed};
}
