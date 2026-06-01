## ADDED Requirements

### Requirement: 入站路由与鉴权

系统 SHALL 暴露 `POST /claude/openai/v1/messages`，接受 Anthropic Messages API 格式的请求体，并复用现有 `cr_` API Key 认证链；调用前 MUST 校验该 Key 具备 `openai` 权限。原生 `POST /v1/messages → Claude` 路径 MUST 保持不变。

#### Scenario: 合法 Key 且具备 openai 权限

- **WHEN** Claude Code 携带有效 `cr_` Key（含 `openai` 权限）POST 到 `/claude/openai/v1/messages`
- **THEN** 请求通过认证并进入 Claude→OpenAI 适配链路

#### Scenario: Key 缺少 openai 权限

- **WHEN** 请求携带有效 `cr_` Key 但无 `openai` 权限
- **THEN** 系统返回 403，且响应体为 Anthropic 错误信封（`{"type":"error","error":{"type":"permission_error",...}}`）

#### Scenario: 原生 Claude 路径不受影响

- **WHEN** 客户端 POST 到原生 `/v1/messages`
- **THEN** 仍由 `unifiedClaudeScheduler` 选 Claude 账号并走原 Claude 转发，无任何行为变化

### Requirement: 目标 GPT 模型解析

系统 SHALL 按固定优先级解析实际调用的 GPT 模型：请求头/参数显式覆盖（如 `x-target-model`）优先，其次为可配置的 `claude→gpt` 映射表，最后回退到所选账号的默认模型。客户端发送的 `claude-*` 模型名 MUST NOT 直接透传给 OpenAI 上游。

#### Scenario: 头部显式覆盖

- **WHEN** 请求带 `x-target-model: gpt-4o`
- **THEN** 上游 `model` 字段被设为 `gpt-4o`，忽略映射表与默认值

#### Scenario: 命中映射表

- **WHEN** 请求无覆盖头，body `model` 为 `claude-3-5-haiku-20241022` 且映射表配置 `claude-3-5-haiku-* → gpt-4o-mini`
- **THEN** 上游 `model` 字段被设为 `gpt-4o-mini`

#### Scenario: 无覆盖且未命中映射

- **WHEN** 请求无覆盖头，且 `model` 未命中任何映射条目
- **THEN** 使用所选账号配置的默认 GPT 模型

### Requirement: 请求格式转换（Anthropic Messages → OpenAI Chat Completions）

系统 SHALL 提供 `ClaudeToOpenAIConverter.convertRequest`，将 Anthropic Messages 请求转换为 OpenAI Chat Completions 请求：`system`（字符串或数组）合并为 system 消息；`messages` 角色与多模态内容映射；`max_tokens`、`temperature`、`top_p`、`stop_sequences→stop` 映射；当请求为流式时 MUST 注入 `stream_options.include_usage=true`。

#### Scenario: system 为数组带 cache_control

- **WHEN** 请求 `system` 为 `[{type:text,text:"...",cache_control:{...}}]`
- **THEN** 文本被合并为单条 `role:"system"` 消息，`cache_control` 字段被剔除

#### Scenario: 流式请求注入 usage 选项

- **WHEN** 请求 `stream:true`
- **THEN** 转换后的上游请求包含 `stream:true` 与 `stream_options:{include_usage:true}`

#### Scenario: 采样参数映射

- **WHEN** 请求含 `max_tokens`、`temperature`、`top_p`、`stop_sequences`
- **THEN** 分别映射为 OpenAI 的 `max_tokens`、`temperature`、`top_p`、`stop`

### Requirement: 工具调用双向映射

系统 SHALL 在请求方向把 Anthropic `tools`/`tool_choice` 与历史消息中的 `tool_use`/`tool_result` 块转换为 OpenAI 的 `tools`（`{type:function,function:{...}}`）、`tool_choice` 与 `assistant.tool_calls`/`role:"tool"` 消息；在响应方向把 OpenAI `tool_calls` 还原为 Anthropic `tool_use` 内容块，并保持 `id`/`tool_use_id` 关联。

#### Scenario: 工具定义与选择映射

- **WHEN** 请求含 Anthropic `tools` 数组与 `tool_choice:{type:"auto"}`
- **THEN** 上游收到 OpenAI 形态 `tools` 与 `tool_choice:"auto"`

#### Scenario: 历史 tool_result 映射

- **WHEN** 历史消息含 `{role:"user",content:[{type:"tool_result",tool_use_id:"X",content:"..."}]}`
- **THEN** 转换为 OpenAI `{role:"tool",tool_call_id:"X",content:"..."}`

#### Scenario: 响应工具调用还原

- **WHEN** OpenAI 响应 `choices[0].message.tool_calls` 含一个函数调用
- **THEN** Anthropic 响应 `content` 含对应 `{type:"tool_use",id,name,input}` 块，且 `stop_reason` 为 `tool_use`

### Requirement: 非流式响应转换（OpenAI → Anthropic）

系统 SHALL 提供 `ClaudeToOpenAIConverter.convertResponse`，把 OpenAI Chat Completions 响应封装为 Anthropic message 信封：`choices[0].message.content`→`content` 文本块；`finish_reason`→`stop_reason`（`stop→end_turn`、`length→max_tokens`、`tool_calls→tool_use`）；`usage.prompt_tokens`/`completion_tokens`→`input_tokens`/`output_tokens`。

#### Scenario: 普通文本响应

- **WHEN** 上游返回 `{choices:[{message:{content:"hi"},finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:5}}`
- **THEN** 返回 `{type:"message",role:"assistant",content:[{type:"text",text:"hi"}],stop_reason:"end_turn",usage:{input_tokens:10,output_tokens:5}}`

#### Scenario: 截断映射

- **WHEN** 上游 `finish_reason` 为 `length`
- **THEN** Anthropic `stop_reason` 为 `max_tokens`

### Requirement: 流式 SSE 事件合成

系统 SHALL 提供 `ClaudeToOpenAIConverter.convertStreamChunk`，把 OpenAI 的扁平 delta 流合成为 Anthropic SSE 事件序列：首块发 `message_start`；首个文本 delta 前发 `content_block_start`；文本以 `content_block_delta(text_delta)` 递增；工具参数以 `content_block_delta(input_json_delta)` 递增；结束发 `content_block_stop` → `message_delta`（含 `stop_reason` 与从 usage 块得到的 `output_tokens`）→ `message_stop`。

#### Scenario: 文本流式

- **WHEN** 上游依次推 `delta.content="He"`、`delta.content="llo"`、含 `finish_reason:"stop"` 的结束块
- **THEN** 客户端依次收到 `message_start`、`content_block_start`、两次 `content_block_delta(text_delta)`、`content_block_stop`、`message_delta(stop_reason:end_turn)`、`message_stop`

#### Scenario: 流式 usage 落入 message_delta

- **WHEN** 末尾 usage 块返回 `{prompt_tokens:8,completion_tokens:3}`
- **THEN** `message_delta` 的 `usage.output_tokens` 为 3，且 `message_start` 的 `usage.input_tokens` 为 8

#### Scenario: 工具调用流式

- **WHEN** 上游以 `delta.tool_calls[].function.arguments` 分片推送工具参数
- **THEN** 客户端收到 `content_block_start(type:tool_use)` 后跟随若干 `content_block_delta(input_json_delta)`

### Requirement: Anthropic 专有特性降级

系统 SHALL 对 Chat Completions 无对应的 Anthropic 特性（`thinking`、`cache_control`、1M 上下文等 beta）执行安全丢弃或忽略，MUST NOT 因此报错或中断请求。

#### Scenario: thinking 请求字段被忽略

- **WHEN** 请求含 `thinking:{type:"enabled",budget_tokens:1024}`
- **THEN** 该字段不传给上游，请求正常完成，不报错

#### Scenario: cache_control 被剔除

- **WHEN** 任意消息块带 `cache_control`
- **THEN** 转换后字段被移除，其余内容保留

### Requirement: OpenAI 兼容账号调度

系统 SHALL 通过 `unifiedOpenAIScheduler` 为该路由选择一个 OpenAI Chat Completions 兼容账号（`baseUrl` + `Bearer apiKey`），并支持粘性会话；转发 MUST 使用账号配置的代理（若有）。

#### Scenario: 选中可用账号并转发

- **WHEN** 存在可用的 openai-compatible 账号
- **THEN** 转换后的请求被 POST 到 `{baseUrl}/v1/chat/completions`，头部含 `Authorization: Bearer {apiKey}`

#### Scenario: 无可用账号

- **WHEN** 没有可用的 openai-compatible 账号
- **THEN** 返回错误（Anthropic 错误信封），不发起上游请求

### Requirement: 用量与成本记录

系统 SHALL 在请求结束后通过现有 `apiKeyService.recordUsageWithDetails` 记录 token 用量与成本，账号类型标记为所选 OpenAI 兼容类型，模型记为实际调用的 GPT 模型。

#### Scenario: 流式与非流式均记录

- **WHEN** 一次流式或非流式请求成功完成
- **THEN** 系统按实际 `input_tokens`/`output_tokens` 与 GPT 模型记录用量；若 `pricingService` 缺该模型价格则成本记 0 并可告警

### Requirement: 上游错误映射

系统 SHALL 把上游/调度错误转换为 Anthropic 错误信封返回客户端：上游 429 透传为 429 并按现有策略标记账号临时不可用；上游 401/403 归一为权限错误；网络错误归为 502 级。

#### Scenario: 上游限流

- **WHEN** 上游返回 429
- **THEN** 客户端收到 429（Anthropic 错误信封），且该账号被标记为临时不可用一段时间
