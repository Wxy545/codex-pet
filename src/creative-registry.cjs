'use strict';
const fs=require('node:fs');
const path=require('node:path');
const Bindings=require('./creative-bindings.cjs');
const CUSTOM_ID=/^custom-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_ROLES=32;
const validCustomId=id=>typeof id==='string'&&CUSTOM_ID.test(id);
function safeOwnedPath(root,file){
 if(!path.isAbsolute(root)||!path.isAbsolute(file))throw Error('unsafe-creative-path');
 const rel=path.relative(root,file);if(path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep))throw Error('unsafe-creative-path');
 let cursor=path.parse(root).root;for(const part of root.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('linked-creative-path');}catch(e){if(e.code!=='ENOENT')throw e;}}
 cursor=root;for(const part of rel.split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('linked-creative-path');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return file;
}
function readSmall(file,max=1024*1024){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw Error('unsafe-creative-file');return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
/** 只从固定登记文件读取用户作品；不枚举data中的其它目录，也不把任意路径交给渲染器。 */
function readCustomCharacters(dataRoot){
 if(typeof dataRoot!=='string'||!path.isAbsolute(dataRoot))return[];
 try{
  const skins=path.join(dataRoot,'skins'),file=safeOwnedPath(dataRoot,path.join(skins,'custom-characters.json')),index=readSmall(file,16384);
  if(index.schemaVersion!==1||!Array.isArray(index.ids)||index.ids.length>MAX_ROLES||new Set(index.ids).size!==index.ids.length||index.ids.some(id=>!validCustomId(id)))return[];
  return index.ids.flatMap(id=>{try{const record=readSmall(safeOwnedPath(dataRoot,path.join(skins,id,'character.json')));if(record.schemaVersion!==1||record.id!==id||typeof record.name!=='string'||!record.name.trim()||record.name.length>120||typeof record.persona!=='string'||record.persona.length>6000)return[];const voices=Bindings.voices(record.voices||{},record.assets||{});if(Object.values(voices).some(v=>!/^asset-[a-f0-9-]+\.(wav|mp3|ogg)$/.test(v.file)))return[];return[{id,label:record.name,name:record.name,persona:record.persona,custom:true,originalVideo:false,author:record.author||'',source:record.source||'',license:record.license||'',actionLabels:record.actionLabels||{},voices}];}catch{return[];}});
 }catch{return[];}
}
module.exports={validCustomId,readCustomCharacters,safeOwnedPath,readSmall,MAX_ROLES};
