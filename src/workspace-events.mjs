/** 只消费现有监听器已读到的元数据，不追加日志扫描，也不从界面文字推断进度。 */
export function createWorkspaceEventSink({workspace,host,locale='zh-CN'}={}){
 const seen=new Map();
 async function observe(row,source,selectedHost=host){
  if(!row||!row.threadId&&!row.jobId)return;
  const key=source+':'+(row.jobId||row.threadId+':'+(row.turnId||'legacy'));
  const fact={key,source,host:selectedHost,title:locale==='en'?(source==='qq'?'QQ task':'Application conversation'):(source==='qq'?'QQ 任务':'应用会话'),project:row.project||'',state:row.state,active:row.active===true||row.activeCount>0,at:row.at,startedAt:row.startedAt,model:row.model??null,effort:row.effort??null,provenance:row.provenance||'unknown',phase:row.phase||row.state};
  const fingerprint=JSON.stringify(fact),identity=selectedHost+':'+key;if(seen.get(identity)===fingerprint)return;
  await workspace.tasks.observe(fact,{...(source==='desktop'?{open:()=>({open:{host:selectedHost,...(selectedHost==='codex'?{threadId:row.threadId}:{})}})}:{}),...(['qq','telegram','discord','line','whatsapp'].includes(source)&&row.controls?row.controls:{})});
  seen.set(identity,fingerprint);if(seen.size>2048)seen.delete(seen.keys().next().value);
 }
 return{sync:async rows=>{for(const row of rows||[])await observe(row,'desktop');},qq:row=>observe(row,'qq',row.application),messaging:row=>{const source=String(row.channel||'').split('-')[0];if(['telegram','discord','line','whatsapp'].includes(source))return observe(row,source,row.application);}};
}
