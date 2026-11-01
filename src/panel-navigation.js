(() => {
  'use strict';
  const bridge=window.petPanels;
  if(!bridge)return;
  const paths={
    brand:'M7 14c-4 3-4 7 0 7 2 0 3-1 5-1s3 1 5 1c4 0 4-4 0-7-3-3-7-3-10 0ZM4 9a2 3 0 1 0 0 .1M9 4a2 3 0 1 0 0 .1M15 4a2 3 0 1 0 0 .1M20 9a2 3 0 1 0 0 .1',
    settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
    chat:'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 1-2Z',
    tasks:'M8 5H5v16h14V5h-3M8 3h8v5H8ZM8 13h8M8 17h5',
    workbench:'M3 4h7v7H3ZM14 4h7v7h-7ZM3 15h7v6H3ZM14 15h7v6h-7Z',
    memory:'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3ZM12 6v16',
    creative:'M12 3a9 9 0 1 0 0 18h2a3 3 0 0 0 0-6h-1a1 1 0 0 1 0-2h3a5 5 0 0 0 0-10ZM7 8h.01M11 6h.01M7 13h.01',
    connections:'M8 3v5M16 3v5M5 8h14v3a7 7 0 0 1-7 7v4M12 18a7 7 0 0 1-7-7',
    content:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM2 12h20M12 2c-5 6-5 14 0 20 5-6 5-14 0-20Z',
    qq:'M7 17c-3 3-4-1-3-3 1-1 1-3 2-4C6 3 9 2 12 2s6 1 6 8c1 1 1 3 2 4 1 2 0 6-3 3M7 17v3h4l1-1 1 1h4v-3M9 9h.01M15 9h.01M10 13h4',
  };
  const icon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]||paths.tasks);svg.append(p);return svg;};
  const sidebar=document.createElement('aside');sidebar.className='panel-navigation';
  const brand=document.createElement('div');brand.className='panel-brand';brand.append(icon('brand'));const title=document.createElement('span');title.textContent='Codex Pet';brand.append(title);
  const nav=document.createElement('nav'),host=document.createElement('div');host.className='panel-host';host.textContent=bridge.host==='workbuddy'?'WorkBuddy':'Codex';
  const buttons=[];let selectedHost=bridge.host==='workbuddy'?'workbuddy':'codex',unlisten=()=>{};
  function rebuild(value){if(!['codex','workbuddy','harness'].includes(value))return;selectedHost=value;host.textContent=value==='harness'?'DeepSeek Harness':value==='workbuddy'?'WorkBuddy':'Codex';document.documentElement.dataset.brand=value==='harness'?'deepseek':value==='workbuddy'?'workbuddy':'chatgpt';nav.replaceChildren();buttons.length=0;for(const name of value==='codex'?['workbench','settings','chat','tasks','memory','creative','content','qq','connections']:['workbench','settings','memory','creative','content','qq','connections']){const b=document.createElement('button');b.type='button';b.dataset.panel=name;b.append(icon(name),document.createElement('span'));if(name===document.body.dataset.panel)b.setAttribute('aria-current','page');nav.append(b);buttons.push(b);}localize();}
  let busy=false;
  function localize(){const zh=/^zh/i.test(document.documentElement.lang||navigator.language);const labels=zh?{settings:'控制中心',chat:'对话',tasks:'任务',qq:'QQ 连接',workbench:'任务列表',memory:'记忆',creative:'创作',content:'内容活动',connections:'海外连接'}:{settings:'Control center',chat:'Chat',tasks:'Tasks',qq:'QQ connection',workbench:'Task list',memory:'Memory',creative:'Create',content:'Activities',connections:'Chat connections'};nav.setAttribute('aria-label',zh?'桌宠功能':'Companion panels');for(const b of buttons){b.lastChild.textContent=labels[b.dataset.panel];b.title=labels[b.dataset.panel];b.setAttribute('aria-label',labels[b.dataset.panel]);}}
  const unavailable=()=>{const note=document.createElement('span');note.className='panel-navigation-error';note.setAttribute('role','alert');note.textContent=/^zh/i.test(document.documentElement.lang)?'暂时无法打开':'Could not open';sidebar.append(note);setTimeout(()=>note.remove(),5000);};
  nav.addEventListener('click',async event=>{const button=event.target.closest('button[data-panel]');if(!button||busy||button.getAttribute('aria-current')==='page')return;busy=true;button.disabled=true;try{const result=await bridge.navigate(button.dataset.panel);if(!result?.ok)unavailable();}catch{unavailable();}finally{button.disabled=false;busy=false;}});
  sidebar.append(brand,nav,host);document.body.prepend(sidebar);document.body.classList.add('panel-frame');rebuild(selectedHost);
  try{unlisten=bridge.onChanged?.(value=>rebuild(value.host))||(()=>{});Promise.resolve(bridge.getState?.()).then(value=>{if(value?.ok)rebuild(value.host);},()=>{});}catch{}
  const observer=new MutationObserver(localize);observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});window.addEventListener('beforeunload',()=>{observer.disconnect();unlisten();},{once:true});
})();
