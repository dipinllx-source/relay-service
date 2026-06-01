## Why

中转服务目前只能让 **OpenAI 格式的客户端访问 Claude 后端**（`src/services/openaiToClaude.js`），但反方向缺失：**Claude Code 这类只会说 Anthropic Messages API 的客户端无法使用 GPT 模型**。用户希望把 Claude Code 指向中转服务后，由 GPT（OpenAI Chat Completions 兼容端点）实际承载推理，从而在不改客户端的前提下复用 GPT 配额、做成本/调度统一管理。

## What Changes

- 新增反向适配链路：`Anthropic Messages API → OpenAI Chat Completions`，作为现有 `OpenAIToClaudeConverter` 的镜像反向。
- 新增转换服务 `src/services/claudeToOpenai.js`（`ClaudeToOpenAIConverter`），实现 `convertRequest` / `convertResponse` / `convertStreamChunk` 三个方法，其中流式需把 OpenAI 扁平 delta **合成**回 Anthropic 的 SSE 事件序列。
- 新增独立路由 `src/routes/claudeOpenaiRoutes.js`，暴露 `POST /claude/openai/v1/messages`（沿用现有 `/openai/claude/...` 的命名对称）。Claude Code 只需把 `ANTHROPIC_BASE_URL` 指向该前缀。
- 目标 GPT 模型解析顺序：**请求头/参数覆盖（如 `x-target-model`）→ 可配置 `claude→gpt` 映射表 → 账号默认**。
- 选号走 `unifiedOpenAIScheduler`，转发到 OpenAI Chat Completions 兼容上游（`baseUrl + Bearer apiKey`）。
- 凭据载体：新增/复用一种「通用 openai-compatible（baseUrl + apiKey + `/v1/chat/completions`）」账号能力（具体方案在 design.md 决策）。
- **不改动**原生 `POST /v1/messages → Claude` 路径与 `unifiedClaudeScheduler`，零回归风险。
- 复用现有 `apiKeyService.recordUsageWithDetails` 记录 usage 与成本。

## Capabilities

### New Capabilities

- `claude-to-openai-chat-relay`: 让 Anthropic Messages API 客户端（Claude Code）经中转由 OpenAI Chat Completions 兼容后端（GPT）承载。涵盖入站路由与鉴权、目标模型解析、OpenAI 账号调度、请求/响应/流式三向格式转换、Anthropic 专有字段（`system` 数组、`tool_use`/`tool_result`、`cache_control`、`thinking`）的映射或丢弃策略、usage/成本记录。

### Modified Capabilities

<!-- 无：本变更为纯新增链路，不修改既有 spec 级行为。 -->

## Impact

- **新增代码**：`src/services/claudeToOpenai.js`、`src/routes/claudeOpenaiRoutes.js`；在 `src/app.js`（或路由装配处）挂载新路由。
- **账号体系**：可能新增一种 openai-compatible 账号类型（含账户服务、管理后台表单、`unifiedOpenAIScheduler` 选号分支）—— 详见 design.md 开放问题 #1。
- **鉴权/权限**：复用 `cr_` Key + `openai` 权限校验。
- **成本统计**：`pricingService` 需补目标 GPT 模型价格，否则成本计为 0。
- **能力降级**：`thinking` / `cache_control` / 1M 上下文等 Anthropic 特性在 Chat Completions 无对应，需明确丢弃/忽略且不报错。
- **依赖**：复用现有 `axios` + `ProxyHelper` 转发与 SSE 解析模式，无新增三方依赖。
- **零回归目标**：不触碰原生 `/v1/messages`、`unifiedClaudeScheduler`、`openaiToClaude.js`。
