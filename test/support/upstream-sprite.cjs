'use strict';
const {readFileSync}=require('node:fs'),{join}=require('node:path'),vm=require('node:vm');
/** 按实际HTML顺序装入播放器模块；测试执行真实菜单和气泡，不用空类替代。 */
module.exports=function loadActualSprite(context){
 if(!vm.isContext(context))vm.createContext(context);
 if(context.BASE===undefined)context.BASE='/dsh-pet-7340';
 if(context.config===undefined)context.config={clickSoundEnabled:false};
 const helper=join(__dirname,'../../node_modules/dsh-pet/runtime/electron-helper');
 const shared={};vm.runInNewContext(readFileSync(join(helper,'shared-core.js'),'utf8'),shared);
 const target=context.S||context.window.PetShared;for(const [key,value]of Object.entries(shared.PetShared))if(target[key]===undefined)target[key]=value;
 vm.runInContext(readFileSync(join(helper,'sprite.js'),'utf8'),context);
 const html=readFileSync(join(helper,'index.html'),'utf8');
 for(const match of html.matchAll(/<script src="(?:\.\/)?(sprite\/[a-z-]+\.js)"/g))vm.runInContext(readFileSync(join(helper,match[1]),'utf8'),context);
 return vm.runInContext('PetSprite.prototype',context);
};
