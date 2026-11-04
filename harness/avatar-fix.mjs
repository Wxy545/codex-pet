import {createHash} from 'node:crypto';

/** 只保护原生头像固定文件，不遍历素材或改动其它宿主的权限。 */
export function createAvatarGuard({fs,path,randomUUID,validId}) {
  const formats=['.png','.jpg','.jpeg','.webp','.gif'];
  const samePath=(a,b)=>path.sep==='\\'?a.toLowerCase()===b.toLowerCase():a===b;
  const canonical=file=>(fs.realpathSync.native||fs.realpathSync)(file);
  const sameNode=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
  const unchanged=(a,b)=>a===null?b===null:b!==null&&sameNode(a,b)&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
  function directoryChain(dir) {
    const chain=[];
    for(let current=dir;;current=path.dirname(current)) {
      const stat=fs.lstatSync(current);
      if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('avatar-directory-link');
      chain.push({file:current,dev:stat.dev,ino:stat.ino});
      if(path.dirname(current)===current)break;
    }
    return chain;
  }
  function directory(input) {
    if(typeof input!=='string'||!path.isAbsolute(input))throw Error('avatar-directory');
    // 先检查原拼写的每层目录，再规范化8.3/大小写别名；realpath不能代替链接检查。
    const requested=path.resolve(input),requestedChain=directoryChain(requested),dir=canonical(requested),chain=directoryChain(dir);
    if(!sameNode(requestedChain[0],chain[0]))throw Error('avatar-directory-changed');
    return {requested,requestedChain,dir,chain};
  }
  function recheckDirectory(before) {
    const after=directory(before.requested),sameChain=(a,b)=>a.length===b.length&&a.every((row,i)=>samePath(row.file,b[i].file)&&sameNode(row,b[i]));
    if(!samePath(before.dir,after.dir)||!sameChain(before.chain,after.chain)||!sameChain(before.requestedChain,after.requestedChain))throw Error('avatar-directory-changed');
  }
  function inspect(file) {
    let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||!samePath(canonical(file),file))throw Error('avatar-file-link');
    return stat;
  }
  function files(dir,petId,extensions) {
    if(!validId(petId)||typeof petId!=='string'||/[\\/:]/.test(petId)||!Array.isArray(extensions)||extensions.length!==formats.length||formats.some(ext=>!extensions.includes(ext)))throw Error('avatar-target');
    return formats.map(ext=>({ext,file:path.join(dir,petId+'-avatar'+ext)}));
  }
  function read(avatarDir,petId,extensions,mime) {
    try {
      const parent=directory(avatarDir),entries=files(parent.dir,petId,extensions).map(row=>({...row,stat:inspect(row.file)}));
      recheckDirectory(parent);let best;
      for(const row of entries)if(row.stat&&(!best||row.stat.mtimeMs>best.stat.mtimeMs))best=row;
      if(!best||!unchanged(best.stat,inspect(best.file)))return undefined;
      return {file:best.file,contentType:mime[best.ext]??'application/octet-stream'};
    } catch {return undefined;}
  }
  function save(avatarDir,petId,bytes,ext,extensions) {
    let temporary,opened,fd,parent;
    try {
      if(!formats.includes(ext))throw Error('avatar-format');
      parent=directory(avatarDir);
      // 全部旧格式先检查；发现任意链接时不写新图、不清旧图。
      const entries=files(parent.dir,petId,extensions).map(row=>({...row,before:inspect(row.file)})),target=entries.find(row=>row.ext===ext);
      temporary=path.join(parent.dir,'.codex-pet-avatar-'+randomUUID()+'.tmp');
      fd=fs.openSync(temporary,'wx',0o600);opened=fs.fstatSync(fd);fs.writeFileSync(fd,bytes);fs.closeSync(fd);fd=undefined;
      recheckDirectory(parent);
      for(const row of entries)if(!unchanged(row.before,inspect(row.file)))throw Error('avatar-file-changed');
      const staged=inspect(temporary);if(!staged||!sameNode(opened,staged))throw Error('avatar-temporary-changed');
      // rename替换目录项，不跟随最终头像文件的软链或硬链；不宣称跨进程完全原子隔离。
      fs.renameSync(temporary,target.file);temporary=undefined;
      for(const row of entries)if(row.ext!==ext&&row.before) {
        try{recheckDirectory(parent);if(unchanged(row.before,inspect(row.file)))fs.unlinkSync(row.file);}catch{}
      }
      return {ok:true};
    } catch {return {ok:false,reason:'write-failed'};}
    finally {
      if(fd!==undefined)try{fs.closeSync(fd);}catch{}
      if(temporary&&opened)try{recheckDirectory(parent);const stat=inspect(temporary);if(stat&&sameNode(opened,stat))fs.unlinkSync(temporary);}catch{}
    }
  }
  return {read,save};
}

const MARK='/* codex-pet-avatar-guard-041 */',END='/* /codex-pet-avatar-guard-041 */';
const originals={petAvatarFile:'925868d8940e7486f8195ad653835179b7e0561fd73aff25a3f0188749cd3b39',savePetAvatar:'a90ff55be55611e563ea6cc68a738fd632e2f63167302e03459a85658b32a5de'};
const readReplacement='function petAvatarFile(avatarDir, petId) {\n\treturn codexPetNativeAvatarGuard.read(avatarDir, petId, AVATAR_EXTS, MIME);\n}';
const saveReplacement=`function savePetAvatar(avatarDir, petId, bytes) {
\tconst contentType = imageTypeOf(bytes, Math.min(bytes.length, IMAGE_HEAD_BYTES));
\tconst ext = contentType === void 0 ? void 0 : imageExtOf(contentType);
\tif (ext === void 0) return { ok: false, reason: "not-image" };
\treturn codexPetNativeAvatarGuard.save(avatarDir, petId, bytes, ext, AVATAR_EXTS);
}`;
const fail=()=>{throw Error('harness-avatar-anchor-mismatch');};
function declaration(source,name) {
  const anchor='function '+name+'(',start=source.indexOf(anchor),end=source.indexOf('\n}',start)+2;
  if(start<0||end<=start||source.split(anchor).length!==2)fail();
  return source.slice(start,end);
}

/** 仅用于官方0.4.1的两个头像函数；锚点和完整函数摘要都须匹配。 */
export function patchNativeAvatar041(input) {
  const source=input.replaceAll('\r\n','\n');
  const block=MARK+'\nimport * as codexPetAvatarFs from "node:fs";\nimport * as codexPetAvatarPath from "node:path";\nimport { randomUUID as codexPetAvatarUuid } from "node:crypto";\nconst codexPetNativeAvatarGuard = ('+createAvatarGuard.toString()+')({fs:codexPetAvatarFs,path:codexPetAvatarPath,randomUUID:codexPetAvatarUuid,validId:isValidPetId});\n'+END+'\n';
  const read=declaration(source,'petAvatarFile'),save=declaration(source,'savePetAvatar');
  if(source.includes(MARK)) {
    if(source.split(block).length!==2||source.split(MARK).length!==2||source.split(END).length!==2||read!==readReplacement||save!==saveReplacement)fail();
    return source;
  }
  if(source.includes(END))fail();
  for(const [name,body]of [['petAvatarFile',read],['savePetAvatar',save]])if(createHash('sha256').update(body).digest('hex')!==originals[name])fail();
  return source.replace(read,block+readReplacement).replace(save,saveReplacement);
}
