## Context

中转服务已具备 `OpenAI 客户端 → Claude 后端` 的适配（`src/services/openaiToClaude.js` 的 `OpenAIToClaudeConverter`，含请求/响应/流式三向转换），以及 `geminiToOpenAI.js` 这一反向转换参考。本变更补齐镜像反向：让只会说 Anthropic Messages API 的 Claude Code 由 GPT（OpenAI Chat Completions 兼容端点）承载。

当前约束：
- 原生 `POST /v1/messages` 经 `unifiedClaudeScheduler` 只会选 Claude 系账号（`claude-official`/`claude-console`/`bedrock`/`ccr`），无法路由到 OpenAI 账号。
- 现有「GPT 系」账号中，`openai`（ChatGPT OAuth）与 `openai-responses`（Factory.ai）走的是 **Responses API**；`azure-openai` 走 Chat Completions 但 URL 为 Azure 专有形态（`/openai/deployments/{dep}/chat/completions`）。没有「通用 OpenAI-compatible Chat Completions（`{baseUrl}/v1/chat/completions` + Bearer）」账号类型。
- 转发/SSE 解析/usage 记录已有成熟模式（`axios` + `ProxyHelper`、`apiKeyService.recordUsageWithDetails`）。

## Goals / Non-Goals

**Goals:**
- Claude Code 把 `ANTHROPIC_BASE_URL` 指到新前缀即可用 GPT，无需改客户端。
- 提供 `ClaudeToOpenAIConverter`（请求/响应/流式），流式正确合成 Anthropic SSE 事件序列。
- 目标模型解析：头部/参数覆盖 → 映射表 → 账号默认。
- 复用既有鉴权（`cr_` + `openai` 权限）、调度（`unifiedOpenAIScheduler`）、用量记录。
- 零回归：不触碰原生 `/v1/messages`、`unifiedClaudeScheduler`、`openaiToClaude.js`。

**Non-Goals:**
- 不支持 Responses API 作为目标上游（本期只做 Chat Completions；Responses 留待后续）。
- 不实现 Anthropic 的 `thinking`、prompt caching、1M 上下文等无对应特性（仅安全降级）。
- 不改动 OpenAI 客户端 → Claude 后端的既有链路。

## Decisions

### D1. 目标上游形态 = OpenAI Chat Completions
镜像 `openaiToClaude` 的成熟字段映射，文档最全、第三方兼容端点最多。Responses API（`openai`/`openai-responses`）形态更复杂、与 Codex 流程耦合，本期排除。

### D2. 新增 `openai-compatible` 账号类型，而非复用 azure/responses
- **选择**：新增账号类型 `openai-compatible`，字段：`name`、`baseUrl`、`apiKey`、`defaultModel`、`modelMapping`（可选）、`proxy`、`status`、`supportedModels`（可选）。上游固定打 `{baseUrl}/v1/chat/completions`，头 `Authorization: Bearer {apiKey}`。
- **理由**：`azure-openai` 的 URL/鉴权（`api-key` 头 + deployment 路径）是 Azure 专有，强行复用会污染语义；`openai-responses` 绑定 Responses relay。新增一个轻量类型与仓库「每平台一类账号」的既有模式一致，边界清晰。
- **备选**：① 复用 `openai-responses` 的 `baseApi+apiKey` 加 `endpointType` 开关——被否，混淆 Responses 语义；② 仅复用 `azure-openai`——被否，URL 形态不通用。
- 实现上新增 `src/services/account/openaiCompatibleAccountService.js`（敏感字段 AES 加密，参考 `claudeAccountService.js`）、`unifiedOpenAIScheduler` 增加该类型选号分支、薄转发服务 `src/services/relay/openaiChatRelayService.js`（或在新路由内联，最终在 tasks 决定粒度）。

### D3. 转换器 `ClaudeToOpenAIConverter`（`src/services/claudeToOpenai.js`）
镜像 `OpenAIToClaudeConverter` 的三方法与私有 helper 结构：
- `convertRequest(anthropicReq, targetModel)`：`system`(字符串/数组)→ system 消息并剔除 `cache_control`；`messages` 角色/多模态/`tool_use`/`tool_result` → OpenAI `messages`/`tool_calls`/`role:"tool"`；`tools`/`tool_choice` 映射；`max_tokens`/`temperature`/`top_p`/`stop_sequences→stop`；流式时注入 `stream_options.include_usage=true`；剔除 `thinking` 等无对应字段。
- `convertResponse(openaiResp, requestModel)`：封装为 Anthropic message 信封；`finish_reason→stop_reason`（`stop→end_turn`/`length→max_tokens`/`tool_calls→tool_use`）；`usage` 映射。
- `convertStreamChunk(chunk, state)`：见 D4。

### D4. 流式 SSE 合成（状态机）
OpenAI 是「扁平 delta」，Anthropic 是「事件编排」，需用一个 per-request `streamState` 合成：

```
状态：{ started, blockOpen, blockType, blockIndex, toolCallAccum, usage }
首个上游块            → emit message_start (usage.input_tokens 占位)
首个 text delta 前    → emit content_block_start(text); blockOpen=true
每个 text delta       → emit content_block_delta(text_delta)
首个 tool_call 分片前  → emit content_block_start(tool_use,{id,name})
每个 arguments 分片    → emit content_block_delta(input_json_delta)
finish_reason 出现     → emit content_block_stop
末尾 usage 块          → 记 output_tokens
结束                   → emit message_delta(stop_reason,usage) → message_stop
```
要点：必须正确处理 text 与 tool_use 之间的 block 切换与 `content_block_stop`；usage 仅在注入 `include_usage` 后于末块出现。

### D5. 目标模型解析顺序
`resolveTargetModel(req, account)`：① 头 `x-target-model` 或 body 显式覆盖 → ② `modelMapping`（账号级，按前缀/精确匹配 `claude-*→gpt-*`）→ ③ 账号 `defaultModel`。客户端 `claude-*` 名不透传上游。映射表配置位置：账号级 `modelMapping` 为主，允许后续扩展 API Key 级覆盖（本期不做）。

### D6. 路由与挂载
新增 `src/routes/claudeOpenaiRoutes.js`，路径 `POST /claude/openai/v1/messages`（对称于 `/openai/claude/...`）。在 `src/app.js` 路由装配处独立挂载，复用 `authenticateApiKey` + `openai` 权限校验中间件。

## Risks / Trade-offs

- **[流式合成出错（tool_use 分片 JSON、block 切换）]** → 编写单测，用例镜像 `openaiToClaude` 的流式用例；以真实 GPT SSE 抓样回归。
- **[第三方 OpenAI-compatible 端点字段差异]** → 转换严格遵循 Chat Completions 规范；账号级保留 `defaultModel`/`modelMapping` 兜底；不做端点特异 hack。
- **[模型映射缺失或配错]** → 缺失时回退账号默认并记日志；管理后台表单做校验。
- **[成本计为 0]** → `pricingService` 补 GPT 模型价格；缺价时记 0 并告警（spec 已要求）。
- **[Anthropic 特性静默丢失被误解为 bug]** → design/proposal 显式声明丢弃；丢弃时打 debug 日志，不报错。
- **[新账号类型增加管理面板/存储面]** → 复用既有账户 CRUD/加密模式，最小字段集，降低面积。

## Migration Plan

- 纯新增、可灰度：新增账号类型 + 新路由，不动既有路径。
- 上线步骤：① 合入转换器与路由（默认无 `openai-compatible` 账号时该路由返回「无可用账号」）；② 后台创建 `openai-compatible` 账号并配 `modelMapping`；③ 客户端将 `ANTHROPIC_BASE_URL` 指向 `/claude/openai`；④ `pricingService` 补价。
- 回滚：卸载/禁用新路由或停用账号即可，对原生 Claude 链路零影响。

## Open Questions

- 默认 `claude→gpt` 映射表的具体取值（如 haiku→`gpt-4o-mini`、sonnet→`gpt-4o`、opus→旗舰）由部署方按可用模型配置，是否需要内置一份「出厂默认」？倾向：内置一份保守默认，账号可覆盖。
- 转发逻辑放独立 `openaiChatRelayService.js` 还是内联进路由？倾向独立服务以便复用与测试，最终在 tasks 拍板。
- 是否需要在管理后台为该账号类型加「连通性测试」按钮（参考现有 UnifiedTestModal）？建议纳入但可作为后续增强。
