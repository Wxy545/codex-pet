'use strict';
/** 鼠标和屏幕工作区均由Electron返回DIP坐标，避免跨屏缩放时输入窗跑出屏幕。 */
function compactInputBounds(electron,size){
 try{
  const cursor=electron.screen.getCursorScreenPoint(),area=electron.screen.getDisplayNearestPoint(cursor).workArea;
  if(![cursor.x,cursor.y,area.x,area.y,area.width,area.height].every(Number.isFinite)||area.width<=0||area.height<=0)return{...size};
  const width=Math.min(size.width,area.width),height=Math.min(size.height,area.height);
  const desiredX=cursor.x+16+width<=area.x+area.width?cursor.x+16:cursor.x-16-width;
  const x=Math.max(area.x,Math.min(area.x+area.width-width,desiredX)),y=Math.max(area.y,Math.min(area.y+area.height-height,cursor.y-Math.min(height/3,128)));
  return{...size,width,height,minWidth:Math.min(size.minWidth,width),minHeight:Math.min(size.minHeight,height),x:Math.round(x),y:Math.round(y)};
 }catch{return{...size};}
}
module.exports={compactInputBounds};
