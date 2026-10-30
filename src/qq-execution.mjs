const MODES=new Set(['auto','chat','task']);
const EFFORTS=['none','minimal','low','medium','high','xhigh','max','ultra'];
const DEFAULTS=Object.freeze({mode:'auto',chatModel:null,taskModel:null,chatEffort:'low',taskEffort:'high'});
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const name=value=>typeof value==='string'&&value.length>0&&value.length<=100&&!/[\u0000-\u0020\u007f]/.test(value);
const fail=code=>{throw Object.assign(Error(code),{code});};

/** 只保存执行档位，不允许策略对象夹带角色、权限或任意请求参数。 */
export function normalizeQQExecution(value){
 if(value==null)return{...DEFAULTS};
 if(!record(value)||Object.keys(value).some(key=>!Object.hasOwn(DEFAULTS,key)))fail('invalid_execution');
 const result={...DEFAULTS,...value};
 if(!MODES.has(result.mode)||!EFFORTS.includes(result.chatEffort)||!EFFORTS.includes(result.taskEffort))fail('invalid_execution');
 for(const key of ['chatModel','taskModel'])if(result[key]!==null&&!name(result[key]))fail('invalid_execution');
 return result;
}

function availableModels(models){
 if(!Array.isArray(models)||!models.length||models.length>1000)fail('catalog_unavailable');
 const valid=models.filter(item=>record(item)&&name(item.id)&&name(item.model)&&Array.isArray(item.supportedReasoningEfforts)&&item.supportedReasoningEfforts.length<=16&&item.supportedReasoningEfforts.every(effort=>typeof effort==='string'&&EFFORTS.includes(effort)));
 if(!valid.length)fail('catalog_unavailable');
 return valid;
}
const family=(model,value)=>model.model.toLowerCase().includes(value);

function automaticKind(text,lastKind){
 const value=typeof text==='string'?text.trim():'';
 if(!value)return null;
 // 只识别明确用途；不会为分类再调用模型，无法判断的短指代沿用上一档或让用户选择。
 const greeting=/^(?:(?:你好|您好|早上好|下午好|晚上好|早安|晚安|在吗|谢谢|多谢|辛苦了|测试\s*\d*|hi|hello|hey|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|test\s*\d*|ping)[\s!！?？,.，。~～]*)+$/i;
 if(greeting.test(value))return'chat';
 const refer=/^(?:(?:请(?:你)?|帮我|麻烦(?:你)?|你帮我)\s*|please\s+)?(?:继续(?:吧|做|一下|(?:这个|那个|前面(?:的)?|之前(?:的)?)?(?:任务|工作|事情))?|接着(?:来|做)?|再来(?:一次)?|搞一下|弄一下|处理(?:一下|(?:前面|之前|刚才|上面)?的?(?:那个|这个))|做吧|就这样|这个呢|那个呢|然后呢|这件事(?:情)?|那件事(?:情)?|好的|好|可以|行|go\s+on|continue|carry\s+on|do\s+it|handle\s+(?:that|this|it|the\s+previous\s+one)|deal\s+with\s+(?:that|this|it|the\s+previous\s+one)|again|next|ok(?:ay)?|yes)[\s!！?？,.，。~～]*$/i;
 if(refer.test(value))return['chat','task'].includes(lastKind)?lastKind:null;
 const delivery=/^(?:(?:请(?:你)?|麻烦(?:你)?|帮我|给我|能否|能不能|可以(?:帮我)?|能(?:帮我)?)\s*)?(?:写|做|生成|制作|编写|整理|输出|完成|提供|分析|设计|研究|调研)[\s\S]{0,40}(?:方案|报告|复杂分析|架构设计|全面分析)|^(?:给我|提供)[\s\S]{0,30}(?:完整|详细|全面)[\s\S]{0,8}(?:方案|分析|报告)|^(?:(?:please|can you|could you|would you)\s+)?(?:write|create|produce|prepare|develop|draft|give me)\b[\s\S]{0,60}\b(?:plan|analysis|report|proposal|architecture|design)\b/i;
 if(delivery.test(value))return'task';
 const fileRewrite=/(?:润色|改写|重写|翻译|修改|编辑)[\s\S]{0,30}(?:文件|目录|README|[A-Za-z0-9_.-]+\.(?:md|txt|js|jsx|ts|tsx|java|py|vue|json|ya?ml|sql))|(?:文件|README(?:\.md)?)[\s\S]{0,30}(?:润色|改写|重写|翻译)|\b(?:rewrite|rephrase|translate|polish|proofread)\b[\s\S]{0,40}\b(?:files?|README(?:\.md)?)\b/i.test(value);
 if(fileRewrite)return'task';
 const codeContext=/(?:```|\b(?:README(?:\.md)?|[A-Za-z0-9_.-]+\.(?:js|jsx|ts|tsx|java|py|vue|json|ya?ml|toml|sql|ps1|sh|cjs|mjs))\b|(?:代码|脚本|仓库|数据库|接口|函数|组件)|\b(?:code|script|repository|database|function|component)\b)/i.test(value);
 const rewrite=/(?:润色|改写|重写|翻译|措辞|语法|语病|缩写|扩写|rewrite|rephrase|proofread|translate|polish\s+(?:this|the)\s+(?:text|sentence))/i.test(value);
 if(rewrite&&!codeContext)return'chat';
 const task=/^(?:修复|调试|排查|执行|运行|构建|重构|部署|安装|卸载|编译|提交|推送|改文件|写代码|fix\b|debug\b|run\b|execute\b|build\b|refactor\b|deploy\b|install\b|commit\b|push\b)/i.test(value)
  ||/(?:修改|改动|编辑|重构|修复|调试|排查|运行|执行|部署|安装|卸载|编译|构建|提交|推送|删除|创建|生成|新增|实现|适配|回归|测试|检查|启动|停止|读取|搜索|查找|扫描|写)(?:[\s\S]{0,30})(?:代码|文件|目录|项目|仓库|脚本|程序|接口|服务|数据库|进程|命令|测试|构建|依赖|函数|组件|算法|页面|bug|错误|README|\.vue|\.tsx?|\.jsx?|\.py|\.java)/i.test(value)
  ||/\b(?:edit|modify|fix|debug|refactor|implement|run|execute|build|deploy|install|uninstall|commit|push|delete|create|generate|write|test|review)\b[\s\S]{0,60}\b(?:code|files?|folder|directories|directory|project|repo(?:sitory)?|scripts?|app|program|api|service|database|commands?|tests?|functions?|classes?|components?|package|dependencies|bug|errors?|javascript|typescript|python|java|sql)\b/i.test(value)
  ||/```|\b(?:TypeError|SyntaxError|Traceback|NullPointerException)\b/.test(value);
 if(task)return'task';
 if(value.length<=240&&(/[?？]|是什么|什么是|有什么区别|你是谁|你叫什么|几点了|能做什么|能不能|可以[^。\n]{0,40}吗/.test(value)||/^(?:什么|为什么|怎么理解|如何理解|介绍|解释|告诉我|推荐|聊|算一下|多少|what\b|why\b|how\b|who\b|when\b|where\b|explain\b|tell\s+me\b|can\b|could\b|would\b|will\b|do\b|does\b|is\b|are\b|am\b|should\b)/i.test(value)))return'chat';
 if(value.length<=120&&/(?:今天天气|最近怎么样|周末愉快|好无聊|有点累|心情|开心|难过|好饿|干得不错|做得不错|how\s+are\s+you|nice\s+weather)/i.test(value))return'chat';
 // 普通短陈述直接聊天；只有仍带技术任务信号或明确指代的输入才需要沿用/选择档位。
 const taskSignal=codeContext||/(?:文件|目录|命令|执行|复杂分析|全面分析|完整方案|\b(?:files?|folders?|directories|commands?|execute|complex analysis)\b)/i.test(value);
 if(value.length<=240&&!taskSignal)return'chat';
 return['chat','task'].includes(lastKind)?lastKind:null;
}

function effortFor(model,requested){
 const supported=[...new Set(model.supportedReasoningEfforts)];
 if(!supported.length)return null;
 if(supported.includes(requested))return requested;
 const ordered=supported.sort((left,right)=>EFFORTS.indexOf(left)-EFFORTS.indexOf(right));
 if(EFFORTS.indexOf(requested)<=EFFORTS.indexOf('low'))return ordered[0];
 const lower=ordered.filter(value=>EFFORTS.indexOf(value)<=EFFORTS.indexOf(requested));
 if(lower.length)return lower.at(-1);
 if(supported.includes(model.defaultReasoningEffort))return model.defaultReasoningEffort;
 fail('catalog_unavailable');
}

/** 模型只取本次账号可用目录；手选失效时明确失败，不自动替换成另一模型。 */
export function chooseQQExecution(policy,models,{text='',taskCommand=false,lastKind}={}){
 const config=normalizeQQExecution(policy),available=availableModels(models);
 const kind=config.mode==='auto'?(taskCommand?'task':automaticKind(text,lastKind)):config.mode;
 if(!kind)return{needsChoice:true};
 const selected=config[kind+'Model'];
 let model,reason;
 if(selected!==null){model=available.find(item=>item.id===selected||item.model===selected);if(!model)fail('model_unavailable');reason='manual-model';}
 else{
  const fallback=available.find(item=>item.isDefault===true)||available[0];
  if(kind==='chat'){model=available.find(item=>family(item,'luna'))||fallback;reason=family(model,'luna')?'chat-luna':'chat-default';}
  else{model=family(fallback,'luna')?(available.find(item=>family(item,'astra'))||available.find(item=>family(item,'sol'))||fallback):fallback;reason=model===fallback?'task-default':'task-family';}
 }
 return{kind,model:model.model,effort:effortFor(model,config[kind+'Effort']),reason};
}
