## 1. 账号类型 openai-compatible

- [x] 1.1 设计存储结构：`openai-compatible` 账号字段（name/baseUrl/apiKey/defaultModel/modelMapping/proxy/status），apiKey AES 加密（对齐 `openaiResponsesAccountService.js`）
- [x] 1.2 新增 `src/services/account/openaiCompatibleAccountService.js`（CRUD + 加解密 + 列表/按 id 取 + 限流标记 + 用量时间）
- [x] 1.3 在 `SqliteAccountRepository` SUPPORTED_PLATFORMS 注册 `openai-compatible`（运行时与其它账号类型一致走 Redis 直连；SQLite 仅为未来迁移）
- [x] 1.4 在 `unifiedOpenAIScheduler` 增加**隔离**方法 `selectCompatibleAccountForApiKey`（仅枚举 openai-compatible 账号 + 复用粘性会话映射），路由改用之；不污染既有 openai/openai-responses 选号，零回归
- [x] 1.5 管理后台：新增 `openai-compatible` 账号的创建/编辑表单（平台单选 + baseUrl/apiKey/defaultModel/modelMapping 字段，暗黑模式）+ 后端 admin 路由 `src/routes/admin/openaiCompatibleAccounts.js`（list/create/update/delete/toggle/toggle-schedulable）+ 前端 store/http_apis/AccountsView/AccountForm 全链路接入；前端 `npm run build:web` 通过

## 2. 转换器 ClaudeToOpenAIConverter

- [x] 2.1 新建 `src/services/claudeToOpenai.js`，搭好类骨架与 `module.exports`，对齐 `openaiToClaude.js` 结构
- [x] 2.2 实现 `convertRequest`：system(字符串/数组)→system 消息并剔除 `cache_control`；采样参数与 `stop_sequences→stop` 映射
- [x] 2.3 `convertRequest` 消息体：role/多模态映射；`tool_use`/`tool_result` → `assistant.tool_calls`/`role:"tool"`
- [x] 2.4 `convertRequest` 工具：`tools`/`tool_choice` → OpenAI 形态；流式注入 `stream_options.include_usage=true`；剔除 `thinking` 等无对应字段
- [x] 2.5 实现 `convertResponse`：message 信封、`finish_reason→stop_reason`、`tool_calls→tool_use`、`usage` 映射
- [x] 2.6 实现 `convertStreamChunk` 状态机：合成 `message_start`/`content_block_start`/`content_block_delta`(text_delta 与 input_json_delta)/`content_block_stop`/`message_delta`/`message_stop`
- [x] 2.7 流式 usage：从末尾 usage 块取 `output_tokens` 填入 `message_delta`，`input_tokens` 填入 `message_start`

## 3. 目标模型解析

- [x] 3.1 实现 `resolveTargetModel(req, account)`：头/参数覆盖（`x-target-model`）→ 账号 `modelMapping`（前缀/精确）→ 账号 `defaultModel`
- [x] 3.2 内置一份保守的「出厂默认」claude→gpt 映射，账号配置可覆盖
- [x] 3.3 确保客户端 `claude-*` 模型名不透传上游

## 4. 路由与转发

- [x] 4.1 新增 `src/routes/claudeOpenaiRoutes.js`，暴露 `POST /claude/openai/v1/messages`，接 `authenticateApiKey` + `openai` 权限校验
- [x] 4.2 路由内：解析模型 → 选号（路由内最小选号器：active+schedulable+未限流，按优先级）→ `convertRequest` → 转发
- [x] 4.3 新增转发服务 `src/services/relay/openaiCompatibleRelayService.js`：`axios` POST `{baseUrl}/v1/chat/completions`，`Authorization: Bearer`，`ProxyHelper` 代理，stream/json 双模式
- [x] 4.4 非流式：`convertResponse` 返回 Anthropic 信封；流式：行缓冲 `convertStreamChunk` 输出 SSE + `finalizeStream` 收尾，客户端断开 AbortController 清理
- [x] 4.5 错误映射：上游 429→429 并标记账号限流；401/403→权限错误；网络错误→502；统一 Anthropic 错误信封
- [x] 4.6 在 `src/app.js` 挂载 `/claude/openai`（置于 `/claude` 别名之前以优先匹配），原生 `/v1/messages` 不受影响

## 5. 用量、成本与配置

- [x] 5.1 请求结束调用 `apiKeyService.recordUsage`，账号类型记 `openai-compatible`、模型记实际 GPT 模型（流式从 streamState usage 取，非流式从响应 usage 取）
- [x] 5.2 `pricingService` 已含目标 GPT 模型价格（`data/model_pricing.json` 含 gpt-4o / gpt-4o-mini 等，由 LiteLLM 价格库覆盖）；用量按实际 GPT 模型记录即自动计费
- [ ] 5.3 `config/config.js` 与 `.env.example` 增补开关/默认映射 — 当前模型映射为账号级，暂无需全局配置

## 6. 测试与验证

- [x] 6.1 `tests/` 增加 `claudeToOpenai` 单测：请求转换（system/工具/多模态/采样参数）
- [x] 6.2 单测：非流式响应转换（文本、截断、工具调用还原、usage）
- [x] 6.3 单测：流式状态机（文本流、tool_use 分片、usage 落入 message_delta、block 切换）
- [x] 6.4 集成验证：`tests/claudeOpenaiRoute.test.js` 用 mock axios 跑通路由→转发→转回 Anthropic（含模型映射、头部覆盖、403、上游 429）；真实端点流式实跑留待手动验证
- [x] 6.5 回归验证（按构造）：纯新增链路，未改 `unifiedClaudeScheduler` / `openaiToClaude` / 既有 `/openai` 选号；`/claude/openai` 挂载于 `/claude` 别名之前不影响原生 `/v1/messages`
- [x] 6.6 改动文件全部 prettier 格式化 + eslint 干净；新测试 21/21 绿（`claudeToOpenai` + `claudeOpenaiRoute`）。注：`npm run lint:check` 另有 5 个 pre-existing 报错在未改动的 `src/utils/headerFilter.js`（仓库历史债）

## 7. 文档

- [x] 7.1 README 新增「Claude Code 使用 GPT 模型（Anthropic → OpenAI 适配）」章节（创建 openai-compatible 账号、赋 openai 权限、设 ANTHROPIC_BASE_URL、modelMapping、模型解析顺序、特性降级说明）
- [x] 7.2 快速开始页（StartView.vue）新增「让 Claude Code 用上 GPT」进阶用法区块：3 步说明 + 可复制的 ANTHROPIC_BASE_URL 命令 + 模型解析顺序提示；`npm run build:web` 通过
