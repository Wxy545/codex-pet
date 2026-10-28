'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('启动菜单是独立包装：保持原菜单/角色入口，英文自然显示且选择模式只传白名单值',async()=>{
 let tree,chosen,preview=0,subscribed;const state={mode:'pet',locale:'en'};
 class Pet{mountContextMenu(options){tree=options.tree;return tree;}onMenuAction(leaf){this.original=leaf;}closeMenu(){this.closed=true;}}
 const window={codexStartup:{getState:async()=>state,setMode:async value=>{chosen=value;return{...state,mode:value};},preview:async()=>{preview++;},onChanged:fn=>{subscribed=fn;return()=>{};}},addEventListener(){}};
 const file=path.join(__dirname,'startup-menu.js');assert.equal(fs.existsSync(file),true);vm.runInNewContext(fs.readFileSync(file,'utf8'),{window,PetSprite:Pet,console:{warn(){}}});await new Promise(resolve=>setImmediate(resolve));
 const p=new Pet(),base=[{label:'Chat',action:'chat'},{label:'Third party',owner:'custom',action:'custom'},{label:'Character',children:[{label:'Dragon Girl',action:'codex-select-skin'}]}];p.mountContextMenu({tree:base});
 assert.equal(tree.length,4);base.forEach((node,index)=>assert.equal(tree[index],node));const menu=tree[3];assert.equal(menu.label,'Startup scene');assert.equal(menu.children.length,4);assert.equal(menu.children[0].label,'✓ Pet only');assert.ok(menu.children.every(node=>!/[\u3400-\u9fff]/.test(node.label)));
 p.onMenuAction(menu.children[2]);await new Promise(resolve=>setImmediate(resolve));assert.equal(chosen,'both');assert.equal(p.closed,true);
 p.onMenuAction(menu.children[3]);await new Promise(resolve=>setImmediate(resolve));assert.equal(preview,1);
 p.onMenuAction({action:'custom'});assert.equal(p.original.action,'custom');
 subscribed({mode:'startup',locale:'zh-CN'});p.mountContextMenu({tree:base});assert.equal(tree[3].label,'启动演出');assert.equal(tree[3].children[1].label,'✓ 仅启动演出');
});
