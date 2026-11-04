const count=(source,text)=>source.split(text).length-1;
function replace(source,before,after){
 const old=count(source,before),current=count(source,after);
 if(current===1&&old===count(after,before))return source;
 if(old!==1||current!==0)throw Error('upstream-main-041-anchor-mismatch');
 return source.replace(before,after);
}

/** 移植2ef900e3：浏览器转向仅改朝向不会触发换源，显式续回原随机链。 */
export function patchTurn041(input){
 const source=input.replaceAll('\r\n','\n');
 return replace(source,'\t\t\tif (cue.kind === "turn") {\n\t\t\t\tconst next = card.state.facing === "left" ? "right" : "left";\n\t\t\t\tcard.actions.setFacing(next);\n\t\t\t\tcard.facingRef.current = next;\n\t\t\t\treturn;\n\t\t\t}',
  '\t\t\tif (cue.kind === "turn") {\n\t\t\t\tconst next = card.state.facing === "left" ? "right" : "left";\n\t\t\t\tcard.actions.setFacing(next);\n\t\t\t\tcard.facingRef.current = next;\n\t\t\t\t// codex-pet-turn-chain-041：沿用pickNext的冻结/睡眠守卫及新朝向。\n\t\t\t\tpickNext();\n\t\t\t\treturn;\n\t\t\t}');
}

/** 移植92521b74：脚垫位移恒定，保留本项目覆盖层仍需使用的stage引用。 */
export function patchDrag041(input,{browser=false}={}){
 let source=input.replaceAll('\r\n','\n');
 if(browser){
  source=replace(source,'function petStageStyle(dragging, bottomPad) {\n\treturn dragging ? { transform: "none" } : { transform: "translateY(" + bottomPad + "px)" };\n}',
   'function petStageStyle(dragging, bottomPad) {\n\t// codex-pet-drag-pad-041：保留调用参数，舞台位移不随拖拽改变。\n\treturn { transform: "translateY(" + bottomPad + "px)" };\n}');
  source=replace(source,'\t\tconst stageEl = c.stage();\n\t\tif (stageEl) stageEl.style.transform = "none";',
   '\t\t// codex-pet-drag-pad-start-041：抓取点保持原脚垫位移。');
  return replace(source,'\t\t\tconst stageEl = c.stage();\n\t\t\tif (stageEl) stageEl.style.transform = "translateY(" + c.bottomPad + "px)";',
   '\t\t\t// codex-pet-drag-pad-end-041：松手也不改写舞台位移。');
 }
 source=replace(source,"      // 真正开始拖拽才把舞台拍平（人物随光标拿起）\n      this.stage.style.transform = 'none';",
  '      // codex-pet-drag-pad-start-041：拖拽起手保留脚垫位移，人物不相对光标上跳。');
 return replace(source,"    this.stage.style.transform = 'translateY(' + this.bottomPad + 'px)';",
  '    // codex-pet-drag-pad-end-041：松手保留同一脚垫位移。');
}

const filterId='dsh-pet-alpha-fix';
const svg=`    <!-- codex-pet-alpha-041：仅修正原video.pet-video，透明素材与自有覆盖层不改写。 -->
    <svg width="0" height="0" aria-hidden="true">
      <defs><filter id="${filterId}"><feComponentTransfer><feFuncA type="linear" slope="1" intercept="-0.0039215686" /></feComponentTransfer></filter></defs>
    </svg>
`;
const browserFilter=`
// codex-pet-alpha-041：沿用e40a9800的alpha修正，每页仅注入一次。
function ensureAlphaFilter041() {
 if(document.querySelector('svg[data-dsh-pet-alpha-fix]')!==null)return;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('width','0');svg.setAttribute('height','0');svg.setAttribute('aria-hidden','true');svg.setAttribute('data-dsh-pet-alpha-fix','');
 const defs=document.createElementNS(ns,'defs'),filter=document.createElementNS(ns,'filter'),transfer=document.createElementNS(ns,'feComponentTransfer'),func=document.createElementNS(ns,'feFuncA');
 filter.id='${filterId}';func.setAttribute('type','linear');func.setAttribute('slope','1');func.setAttribute('intercept','-0.0039215686');
 transfer.appendChild(func);filter.appendChild(transfer);defs.appendChild(filter);svg.appendChild(defs);document.body.appendChild(svg);
}
`;

/** 移植e40a9800：渲染时将原WebM背景的1/255 alpha归零，不转码或修改素材。 */
export function patchAlpha041(input,{browser=false}={}){
 let source=input.replaceAll('\r\n','\n');
 if(source.includes('codex-pet-alpha-041')&&count(source,browser?browserFilter:svg)!==1)throw Error('upstream-main-041-anchor-mismatch');
 if(browser){
  source=replace(source,'transform-origin:center}",','transform-origin:center;filter:url(#'+filterId+')}"' + ',');
  source=replace(source,'function injectPetCss() {',browserFilter+'function injectPetCss() {');
  return replace(source,'\ttag.textContent = PET_CSS;\n\tdocument.head.appendChild(tag);','\ttag.textContent = PET_CSS;\n\tdocument.head.appendChild(tag);\n\tensureAlphaFilter041();');
 }
 source=replace(source,'        transition: opacity 0.18s ease;\n      }\n      video.pet-video.is-front {',
  '        transition: opacity 0.18s ease;\n        filter: url(#'+filterId+');\n      }\n      video.pet-video.is-front {');
 return replace(source,'  <body>\n    <div id="root"></div>','  <body>\n'+svg+'    <div id="root"></div>');
}
