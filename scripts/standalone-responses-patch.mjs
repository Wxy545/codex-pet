// 固定 dsh-pet 0.3.8 的独立 AI 协议补丁，追加 OpenAI Responses 与模型发现。
const marker='// codex-pet-openai-responses-v1';

function replaceCount(source,before,after,label,count=1){
  const found=source.split(before).length-1;
  if(found!==count)throw new Error(`${label}补丁定位失败。`);
  return source.replaceAll(before,after);
}

export function patchStandaloneResponses(source){
  if(source.includes(marker))return source;
  const protocol='z.enum(["openai-compatible", "anthropic"])';
  source=replaceCount(
    source,
    protocol,
    'z.enum(["openai-compatible", "openai-responses", "anthropic"])',
    '独立AI协议枚举',
    2,
  );
  source=replaceCount(
    source,
    '<option value="openai-compatible">OpenAI 兼容</option><option value="anthropic">Anthropic</option>',
    '<option value="openai-compatible">OpenAI 兼容</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic">Anthropic</option>',
    '独立AI协议选项',
  );

  const oldModel='<label for="model">模型名称</label><input id="model" name="model" type="text" maxlength="200" placeholder="填写服务商的模型 ID，例如 deepseek-chat" spellcheck="false">';
  source=replaceCount(source,oldModel,'','模型输入位置');
  const keyNote='<p id="key-note" class="hint">密钥只写入本机配置，不会回显。留空不会删除旧密钥。</p>';
  const modelBlock=keyNote+`
<div class="model-heading"><label for="model">模型名称</label><button id="models-btn" type="button">获取模型</button></div>
<div class="model-control"><input id="model" name="model" type="text" maxlength="200" placeholder="填写服务商的模型 ID，例如 deepseek-chat" spellcheck="false"><select id="model-options" hidden></select></div>
<p id="models-note" class="hint" role="status" aria-live="polite">手动填写模型 ID，或从服务商自动获取后选择。</p>`;
  source=replaceCount(source,keyNote,modelBlock,'模型输入位置');

  const styleAnchor='@media(max-width:560px)';
  const modelStyle=`.model-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.model-heading label{margin:0 0 6px}.model-control{margin-top:0}#models-btn{width:auto;min-height:38px;padding:6px 18px;background:#fff;color:var(--blue);border:1.5px solid var(--blue);font-size:14px;font-weight:600;border-radius:6px;cursor:pointer}#models-btn:hover{background:#edf5fa}#models-btn:disabled{opacity:.6;cursor:wait}#model-options{margin-top:8px}[hidden]{display:none!important}`;
  source=replaceCount(source,styleAnchor,modelStyle+styleAnchor,'模型控件样式');

  const scriptState="  const testResult = get('test-result');";
  const modelState=scriptState+`
  const modelsBtn = get('models-btn');
  const modelOptions = get('model-options');
  const modelsNote = get('models-note');`;
  source=replaceCount(source,scriptState,modelState,'模型控件状态');

  const clearAnchor="  get('clearApiKey').addEventListener('change', () => {";
  const modelHelpers=`  function clearModelOptions() {
    if (modelOptions) {
      modelOptions.replaceChildren();
      modelOptions.hidden = true;
    }
    if (modelsNote) modelsNote.textContent = '手动填写模型 ID，或从服务商自动获取后选择。';
  }
  function modelInput() {
    return {
      protocol: get('protocol').value,
      baseUrl: get('baseUrl').value.trim(),
      apiKey: get('apiKey').value.trim(),
    };
  }
  for (const id of ['protocol', 'baseUrl', 'apiKey']) {
    get(id).addEventListener('input', clearModelOptions);
  }
${clearAnchor}`;
  source=replaceCount(source,clearAnchor,modelHelpers,'模型控件清理');

  const testAnchor='  if (testBtn && testResult) {';
  const modelsClick=`  if (modelsBtn && modelOptions && modelsNote) {
    modelsBtn.addEventListener('click', async () => {
      modelsBtn.disabled = true;
      modelOptions.hidden = true;
      modelsNote.textContent = '正在获取模型…';
      try {
        const response = await fetch('/standalone-ai/models', {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          headers: {'X-DSH-Pet-Token': token, 'Content-Type': 'application/json'},
          body: JSON.stringify(modelInput()),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.message || data.error || '获取模型失败，请检查接口地址、协议与 API 密钥。');
        const models = Array.isArray(data.models) ? data.models : [];
        if (!models.length) {
          modelsNote.textContent = '没有获取到可用的模型，可继续手动填写。';
          return;
        }
        modelOptions.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '请选择获取到的模型';
        modelOptions.appendChild(placeholder);
        for (const model of models) {
          const id = typeof model === 'string' ? model : String(model && model.id || '');
          if (!id) continue;
          const name = typeof model === 'object' && model ? String(model.name || '') : '';
          const option = document.createElement('option');
          option.value = id;
          option.textContent = name && name !== id ? name + ' (' + id + ')' : id;
          modelOptions.appendChild(option);
        }
        modelOptions.hidden = false;
        const selected = models.find(model => (typeof model === 'string' ? model : model && model.id) === get('model').value);
        if (selected) modelOptions.value = typeof selected === 'string' ? selected : selected.id;
        modelsNote.textContent = '模型列表已获取，请在下拉框中选择。';
      } catch (error) {
        modelsNote.textContent = error && error.message ? error.message : '获取模型失败，请检查接口地址、协议与 API 密钥。';
      } finally {
        modelsBtn.disabled = false;
      }
    });
    modelOptions.addEventListener('change', () => {
      if (modelOptions.value) get('model').value = modelOptions.value;
    });
  }
  ${testAnchor}`;
  source=replaceCount(source,testAnchor,modelsClick,'模型获取按钮');

  const expected='const expected = base + (settings.protocol === "anthropic" ? "/v1/messages" : "/chat/completions");';
  source=replaceCount(
    source,
    expected,
    'const expected = base + (settings.protocol === "anthropic" ? "/v1/messages" : settings.protocol === "openai-responses" ? "/responses" : "/chat/completions");',
    'Responses接口路径',
  );
  const openAiValidation='const validOpenAi = settings.protocol === "openai-compatible" && (urlStr === expected || urlStr === base + "/chat/completions" || urlStr === base + "/v1/chat/completions");';
  source=replaceCount(
    source,
    openAiValidation,
    openAiValidation+`
\t\tconst validOpenAiResponses = settings.protocol === "openai-responses" && (urlStr === expected || urlStr === base + "/responses" || urlStr === base + "/v1/responses");`,
    'Responses接口校验',
  );
  source=replaceCount(source,'if (!validOpenAi && !validAnthropic) throw new Error("Unexpected standalone AI endpoint.");','if (!validOpenAi && !validOpenAiResponses && !validAnthropic) throw new Error("Unexpected standalone AI endpoint.");','Responses接口白名单');
  source=replaceCount(
    source,
    'accept: "application/json"',
    'accept: settings.protocol === "openai-responses" ? "text/event-stream" : "application/json"',
    'Responses流式响应头',
  );

  const chatBranch='\tif (settings.protocol === "openai-compatible") {';
  const responsesBranch=`\tif (settings.protocol === "openai-responses") {
\t\tconst client = new OpenAI({
\t\t\t...shared,
\t\t\torganization: null,
\t\t\tproject: null,
\t\t\twebhookSecret: null
\t\t});
\t\tconst stream = await client.responses.create({
\t\t\tmodel: settings.model,
\t\t\t...request.system ? { instructions: request.system } : {},
\t\t\tinput: request.messages,
\t\t\tstream: true,
\t\t\tmax_output_tokens: settings.maxTokens,
\t\t\tstore: false
\t\t}, { signal });
\t\tfor await (const event of stream) {
\t\t\tif (event.type === "response.output_text.delta" && event.delta) yield { text: event.delta };
\t\t\telse if (event.type === "response.refusal.delta" || event.type === "response.refusal.done") yield { refusal: true };
\t\t}
\t\treturn;
\t}
${chatBranch}`;
  source=replaceCount(source,chatBranch,responsesBranch,'Responses流式请求');

  const returnAnchor=`\t}
\treturn {
\t\tcurrentSelection: selection,`;
  const discoverModels=`\t}
\tasync function discoverModels(input) {
\t\tif (disposed) return { ok: false, code: "closed" };
\t\tconst body = input && typeof input === "object" ? input : {};
\t\tconst current = store.current();
\t\tconst protocols = ["openai-compatible", "openai-responses", "anthropic"];
\t\tconst protocol = protocols.includes(body.protocol) ? body.protocol : current.protocol;
\t\tconst baseUrl = String(body.baseUrl ?? current.baseUrl).trim().replace(/\\/+$/, "");
\t\tconst apiKey = String(body.apiKey !== undefined && body.apiKey !== "" ? body.apiKey : current.apiKey).trim();
\t\tif (!baseUrl) return { ok: false, code: "base-url" };
\t\tif (!apiKey) return { ok: false, code: "api-key" };
\t\tif (/[\\r\\n\\u0000-\\u001f\\u007f]/.test(apiKey) || /\\s/.test(baseUrl)) return { ok: false, code: "invalid" };
\t\tlet parsed;
\t\ttry {
\t\t\tparsed = new URL(baseUrl);
\t\t} catch {
\t\t\treturn { ok: false, code: "invalid" };
\t\t}
\t\tif (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return { ok: false, code: "invalid" };
\t\tconst headers = new Headers({ accept: "application/json" });
\t\tif (protocol === "anthropic") {
\t\t\theaders.set("x-api-key", apiKey);
\t\t\theaders.set("anthropic-version", "2023-06-01");
\t\t} else headers.set("authorization", "Bearer " + apiKey);
\t\tconst controller = new AbortController();
\t\tconst timer = setTimeout(() => controller.abort(), 15e3);
\t\ttry {
\t\t\tconst response = await fetcher(baseUrl + "/models" + (protocol === "anthropic" ? "?limit=1000" : ""), {
\t\t\t\tmethod: "GET",
\t\t\t\theaders,
\t\t\t\tsignal: controller.signal,
\t\t\t\tredirect: "error"
\t\t\t});
\t\t\tif (!response.ok) {
\t\t\t\tif (response.status === 401 || response.status === 403) return { ok: false, code: "unauthorized" };
\t\t\t\tif (response.status === 404) return { ok: false, code: "not-found" };
\t\t\t\tif (response.status === 429) return { ok: false, code: "rate-limit" };
\t\t\t\treturn { ok: false, code: "http" };
\t\t\t}
\t\t\tlet payload;
\t\t\ttry {
\t\t\t\tpayload = JSON.parse(await response.text());
\t\t\t} catch {
\t\t\t\treturn { ok: false, code: "invalid-response" };
\t\t\t}
\t\t\tconst rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
\t\t\tconst seen = new Set();
\t\t\tconst models = [];
\t\t\tfor (const row of rows) {
\t\t\t\tconst id = String(typeof row === "string" ? row : row?.id ?? "").trim();
\t\t\t\tif (!id || id.length > 200 || seen.has(id)) continue;
\t\t\t\tseen.add(id);
\t\t\t\tconst name = String(typeof row === "object" && row ? row.display_name ?? row.name ?? "" : "").trim().slice(0, 200);
\t\t\t\tmodels.push({ id, ...name ? { name } : {} });
\t\t\t\tif (models.length >= 500) break;
\t\t\t}
\t\t\treturn models.length ? { ok: true, models } : { ok: false, code: "empty" };
\t\t} catch {
\t\t\treturn { ok: false, code: controller.signal.aborted ? "timeout" : "network" };
\t\t} finally {
\t\t\tclearTimeout(timer);
\t\t}
\t}
\treturn {
\t\tcurrentSelection: selection,`;
  source=replaceCount(source,returnAnchor,discoverModels,'模型发现方法');
  source=replaceCount(source,'\t\tstream,\n\t\tgetSettings:','\t\tstream,\n\t\tdiscoverModels,\n\t\tgetSettings:','模型发现导出');

  const handlerAnchor='function testHandler(ai) {';
  const modelsHandler=`function modelsHandler(ai) {
\tlet windowStart = Date.now();
\tlet count = 0;
\treturn async (req, res) => {
\t\tif (!ai?.discoverModels) {
\t\t\trejectRequest(res, 503, "当前环境未配置模型列表能力");
\t\t\treturn;
\t\t}
\t\tif (req.method !== "POST") {
\t\t\trejectRequest(res, 405, "仅支持 POST");
\t\t\treturn;
\t\t}
\t\tif (Date.now() - windowStart >= 6e4) {
\t\t\twindowStart = Date.now();
\t\t\tcount = 0;
\t\t}
\t\tcount += 1;
\t\tif (count > 20) {
\t\t\trejectRequest(res, 429, "获取模型过于频繁，请稍后再试");
\t\t\treturn;
\t\t}
\t\tif (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
\t\t\trejectRequest(res, 415, "请使用 JSON 获取模型列表");
\t\t\treturn;
\t\t}
\t\ttry {
\t\t\tconst chunks = [];
\t\t\tawait new Promise((resolve$1, reject) => {
\t\t\t\treq.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
\t\t\t\treq.once("end", resolve$1);
\t\t\t\treq.once("error", reject);
\t\t\t});
\t\t\tconst input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
\t\t\tconst result = await ai.discoverModels(input);
\t\t\tif (result?.ok) {
\t\t\t\tsendJson(res, 200, { ok: true, models: result.models });
\t\t\t\treturn;
\t\t\t}
\t\t\tconst messages = {
\t\t\t\tclosed: "服务已关闭",
\t\t\t\t"base-url": "请先填写接口地址（Base URL）",
\t\t\t\t"api-key": "请先填写 API 密钥",
\t\t\t\tinvalid: "接口地址或 API 密钥格式无效",
\t\t\t\tunauthorized: "身份验证失败 (HTTP 401/403)：请检查 API 密钥是否正确",
\t\t\t\t"not-found": "模型列表接口不存在 (HTTP 404)：请确认接口地址，或手动填写模型名称",
\t\t\t\t"rate-limit": "请求受限 (HTTP 429)：请稍后再试",
\t\t\t\ttimeout: "获取模型请求超时，请检查网络连通性或服务器状态",
\t\t\t\tnetwork: "无法连接到目标服务器：请检查地址与端口是否正确、服务器是否正在运行",
\t\t\t\tempty: "未获取到模型，请确认服务商支持 /models 接口，或手动填写模型名称",
\t\t\t\t"invalid-response": "服务商返回的模型列表格式无效",
\t\t\t\thttp: "服务商未能返回模型列表，请检查接口地址、协议与 API 密钥"
\t\t\t};
\t\t\tsendJson(res, 200, { ok: false, message: messages[result?.code] ?? messages.http });
\t\t} catch {
\t\t\tsendJson(res, 400, { ok: false, message: "模型列表请求格式无效" });
\t\t}
\t};
}
${handlerAnchor}`;
  source=replaceCount(source,handlerAnchor,modelsHandler,'模型列表处理');

  const dispatchAnchor='\tconst tester = testHandler(options.ai);';
  source=replaceCount(source,dispatchAnchor,'\tconst tester = testHandler(options.ai);\n\tconst modelLister = modelsHandler(options.ai);','模型列表分发');
  const testRoute=`\t\tif (pathname === "/standalone-ai/test") {
\t\t\ttester(req, res).catch((error) => fail(res, error, options.logger));
\t\t\treturn;
\t\t}`;
  source=replaceCount(source,testRoute,testRoute+`
\t\tif (pathname === "/standalone-ai/models") {
\t\t\tmodelLister(req, res).catch((error) => fail(res, error, options.logger));
\t\t\treturn;
\t\t}`,'模型列表路由');

  source=source.replace(/^(#![^\n]*\n)?/,'$1'+marker+'\n');
  return source;
}
