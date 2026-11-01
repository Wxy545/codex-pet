const once=(s,a,b,label)=>{if(s.split(a).length!==2)throw Error('模型用途'+label+'定位失败');return s.replace(a,b);};
/** 用途由调用位置标记，不把提示词、人设或模型回复当作控制信号。 */
export function patchModelPurpose(source){
 source=once(source,'async function generateWith$1(ctx, llm, sel, system, meme) {','async function generateWith$1(ctx, llm, sel, system, meme) {','碎念函数');
 const start=source.indexOf('async function generateWith$1('),end=source.indexOf('\nasync function ',start+1);let block=source.slice(start,end<0?undefined:end);
 block=once(block,'const options = {','const options = {\n\t\tcodexPetPurpose: "whisper",','碎念标记');source=source.slice(0,start)+block+(end<0?'':source.slice(end));
 source=once(source,'const { request, signal: callerSignal } = parseRequest(options, settings.model);','const { request, signal: callerSignal } = parseRequest(options, settings.model);\n\t\trequest.codexPetPurpose = options.codexPetPurpose;','请求标记');
 source=once(source,'const stream$1 = await client$1.chat.completions.create({\n\t\t\tmodel: settings.model,','const stream$1 = await client$1.chat.completions.create({\n\t\t\tmodel: request.codexPetPurpose === "whisper" ? "codex-pet-whisper" : settings.model,','桥接用途');return source;
}
