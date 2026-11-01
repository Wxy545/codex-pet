import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {deflateRawSync} from 'node:zlib';
const require=createRequire(import.meta.url),Z=require('../src/creative-zip.cjs');
const base=()=>Z.encodeZip([{name:'manifest.json',data:Buffer.from('{}')},{name:'media/aa.png',data:Buffer.from('image')}]);
function rename(bytes,old,next){assert.equal(Buffer.byteLength(old),Buffer.byteLength(next));const output=Buffer.from(bytes);for(let at=0;(at=output.indexOf(old,at))>=0;at+=old.length)Buffer.from(next).copy(output,at);return output;}
test('导出ZIP的字节、名称、CRC32可回读，CRC损坏和截断拒绝',()=>{
 assert.deepEqual(Z.decodeZip(base()).map(e=>[e.name,e.data.toString()]),[['manifest.json','{}'],['media/aa.png','image']]);
 const changed=Buffer.from(base());changed[30+'manifest.json'.length]^=1;assert.throws(()=>Z.decodeZip(changed),/invalid/);
 assert.throws(()=>Z.decodeZip(base().subarray(0,-3)),/invalid/);
});
test('中央/本地目录中的穿越、重复路径、符号链接和超额尺寸在提取前拒绝',()=>{
 assert.throws(()=>Z.decodeZip(rename(base(),'media/aa.png','../datax.png')),/invalid/);
 const pair=Z.encodeZip([{name:'media/a.png',data:Buffer.from('a')},{name:'media/b.png',data:Buffer.from('b')}]);assert.throws(()=>Z.decodeZip(rename(pair,'media/b.png','media/a.png')),/invalid/);
 const symlink=Buffer.from(base()),at=symlink.indexOf(Buffer.from('504b0102','hex'));symlink.writeUInt32LE(0xa1ff0000,at+38);assert.throws(()=>Z.decodeZip(symlink),/invalid/);
 const bomb=Buffer.from(base());bomb.writeUInt32LE(Z.LIMITS.fileBytes+1,at+24);assert.throws(()=>Z.decodeZip(bomb),/invalid/);
 for(const name of ['../a.png','media/x.ps1','media/a.png:stream','media/CON.png','media/con.png','media/com1.png','file:///a.png'])assert.throws(()=>Z.encodeZip([{name,data:Buffer.from('x')}]),/invalid/);
});
test('deflate按中央目录声明的输出上限解压，不能用极小声明展开压缩炸弹',()=>{
 const full=Buffer.alloc(2*1024*1024,65),compressed=deflateRawSync(full),name=Buffer.from('manifest.json'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt32LE(Z.crc32(full),14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(1,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt32LE(Z.crc32(full),16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(1,24);central.writeUInt16LE(name.length,28);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
 assert.throws(()=>Z.decodeZip(Buffer.concat([local,name,compressed,central,name,end])),/invalid/);
});
