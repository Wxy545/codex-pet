'use strict';
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const fail=()=>{throw Error('invalid-creative-bindings');};
function voices(value,assets){
 if(!record(value)||Object.keys(value).some(k=>!['greeting','click','working','waiting','success','error'].includes(k)))fail();
 const result={};for(const[event,item]of Object.entries(value)){if(!record(item)||Object.keys(item).some(k=>!['file','volume','cooldownSec','interrupt'].includes(k))||assets[item.file]?.kind!=='audio'||!Number.isFinite(item.volume)||item.volume<0||item.volume>1||!Number.isFinite(item.cooldownSec)||item.cooldownSec<0||item.cooldownSec>3600||typeof item.interrupt!=='boolean')fail();result[event]={file:item.file,volume:item.volume,cooldownSec:item.cooldownSec,interrupt:item.interrupt};}return result;
}
function startup(value,assets){if(value==null)return null;if(!record(value)||Object.keys(value).some(k=>!['file','startSec','endSec'].includes(k))||assets[value.file]?.kind!=='startup'||!Number.isFinite(value.startSec)||value.startSec<0||!Number.isFinite(value.endSec)||value.endSec<=value.startSec||value.endSec>assets[value.file].duration)fail();return{file:value.file,startSec:value.startSec,endSec:value.endSec};}
module.exports={voices,startup};
