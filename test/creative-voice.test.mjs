import test from 'node:test';
import assert from 'node:assert/strict';
import A from '../src/skin-actions.cjs';

test('固定录音按真实事件播放，冷却、打断与隐藏不补播',async()=>{
 let time=0;const sounds=[];const createAudio=()=>{const item={paused:true,src:'',plays:0,volume:0,play(){this.paused=false;this.plays++;return Promise.resolve();},pause(){this.paused=true;},removeAttribute(){this.src='';},load(){},addEventListener(){},removeEventListener(){}};sounds.push(item);return item;};
 const voice=A.createFixedVoice({createAudio,now:()=>time});const binding=(file,interrupt=false)=>({file,volume:.4,cooldownSec:10,interrupt});
 voice.setRole({id:'custom-a',voices:{click:binding('click.wav'),working:binding('work.wav'),success:binding('done.wav',true)},assets:{'click.wav':{available:true,type:'audio',url:'file:///click.wav'},'work.wav':{available:true,type:'audio',url:'file:///work.wav'},'done.wav':{available:true,type:'audio',url:'file:///done.wav'}}});
 assert.equal(await voice.trigger('click'),true);assert.equal(sounds[0].volume,.4);assert.equal(await voice.trigger('click'),false);assert.equal(await voice.trigger('working'),false);assert.equal(await voice.trigger('success'),true);assert.equal(sounds[0].paused,true);
 voice.setHidden(true);assert.equal(sounds[1].paused,true);time=20000;assert.equal(await voice.trigger('click'),false);voice.setHidden(false);assert.equal(sounds.length,2);assert.equal(await voice.trigger('click'),true);voice.dispose();assert.equal(sounds.at(-1).src,'');assert.equal(await voice.trigger('success'),false);
});
test('录音切角色或迟到play回包不能复活旧音轨，外部URL和未知素材拒绝',async()=>{
 const sounds=[];let resume;const voice=A.createFixedVoice({createAudio:()=>{const item={paused:true,src:'',play(){this.paused=false;return new Promise(resolve=>{resume=resolve;});},pause(){this.paused=true;},removeAttribute(){this.src='';},load(){},addEventListener(){},removeEventListener(){}};sounds.push(item);return item;}});
 const role={id:'a',voices:{click:{file:'x.wav',volume:1,cooldownSec:0,interrupt:true}},assets:{'x.wav':{available:true,type:'audio',url:'https://example.test/private.wav'}}};voice.setRole(role);assert.equal(await voice.trigger('click'),false);role.assets['x.wav'].url='file:///approved.wav';voice.setRole(role);const pending=voice.trigger('click');voice.setRole({id:'b',voices:{},assets:{}});resume();assert.equal(await pending,false);assert.equal(sounds[0].src,'');assert.equal(sounds[0].paused,true);
});
