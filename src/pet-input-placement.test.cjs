'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {compactInputBounds}=require('./pet-input-placement.cjs');
const size={width:440,height:480,minWidth:360,minHeight:360};
test('输入小窗使用鼠标所在原生屏幕，并夹在含负坐标的工作区',()=>{
 const electron={screen:{getCursorScreenPoint:()=>({x:-20,y:1060}),getDisplayNearestPoint:p=>{assert.deepEqual(p,{x:-20,y:1060});return{workArea:{x:-1920,y:0,width:1920,height:1080}};}}};
 const r=compactInputBounds(electron,size);assert.equal(r.x,-476);assert.ok(r.y>=0&&r.y+r.height<=1080);assert.equal(r.width,440);
});
test('窄屏尺寸和最小尺寸同步缩小，不让标题栏越过可见边缘',()=>{
 const r=compactInputBounds({screen:{getCursorScreenPoint:()=>({x:110,y:50}),getDisplayNearestPoint:()=>({workArea:{x:100,y:30,width:320,height:300}})}},size);
 assert.equal(r.x,100);assert.equal(r.y,30);assert.equal(r.width,320);assert.equal(r.height,300);assert.ok(r.minWidth<=r.width&&r.minHeight<=r.height);
});
test('原生屏幕探测缺失或失败保留窗口尺寸，不使用渲染器坐标猜测',()=>{
 assert.deepEqual(compactInputBounds({},size),size);assert.deepEqual(compactInputBounds({screen:{getCursorScreenPoint(){throw Error('unavailable');}}},size),size);
});
