# Tasks — Make Claude Model List Dynamic

## 1. 动态模型获取（后端核心）

- [x] 1.1 在 `src/services/account/claudeAccountService.js` 新增 `fetchAvailableModels()`：选第一个可用 claude-official 账户 → `getValidAccessToken` → 经账户 proxy 请求上游 `GET /v1/models`（Bearer + `anthropic-version` + `anthropic-beta: oauth-2025-04-20`），规范化为 `[{ id, object, created, owned_by, display_name? }]`；任何失败返回 `null` 并记 warn 日志（不含 token）
- [x] 1.2 模块级 TTL 缓存：成功 1h（`config/config.js` 新增 `claude.modelsCacheTTLMs` / `claude.modelsFailureCacheTTLMs`，可配）、失败 60s 短缓存；缓存命中不发上游请求
- [x] 1.3 单元测试 `tests/services/account/claudeAccountService.models.test.js`：成功规范化、无可用账户返回 null、上游非 200 返回 null、空列表视为失败、成功缓存命中不重复请求、失败短缓存、失败缓存过期重试

## 2. /api/v1/models 集成

- [x] 2.1 `src/services/modelService.js` `getAllModels({ claudeModels })` 支持以动态 Claude 列表替换静态 claude 段（OpenAI/Gemini 段不动），无参调用向后兼容
- [x] 2.2 `src/routes/api.js` `GET /v1/models`：调用 `fetchAvailableModels()`，`null` 时走纯静态；`restrictedModels` 黑名单过滤在合成后列表上统一生效
- [x] 2.3 单元测试 `tests/modelService.test.js`：动态替换、null/空数组降级一致、段隔离、黑名单语义

## 3. /apiStats/models 集成（含前端）

- [x] 3.1 `src/routes/apiStats.js` `GET /models` 变 async：Claude 段（`data.claude`、`data.platforms.claude`、`data.all` Claude 部分、`?service=claude` 分支）优先动态，失败回落静态 `CLAUDE_MODELS`，新增 `claudeSource` 字段，始终 200
- [x] 3.2 单元测试 `tests/apiStatsModelsRoute.test.js`：动态可用、静态兜底、异常兜底、`?service=claude` 优先动态、`?service=gemini` 不受影响
- [x] 3.3 确认前端零改动（三个下拉框已消费 `/apiStats/models`），无需重新构建

## 4. OpenAI 兼容 /v1/models 集成

- [x] 4.1 `src/routes/openaiClaudeRoutes.js` `GET /v1/models`：用 `fetchAvailableModels()` 替换两个静态老模型，`null` 时回落静态 Claude 列表（非原两条），保留权限校验与黑名单过滤
- [x] 4.2 单元测试 `tests/openaiClaudeModelsRoute.test.js`：动态可用、静态兜底、权限不足 403、黑名单过滤

## 5. 静态兜底列表补齐

- [x] 5.1 `config/models.js` `CLAUDE_MODELS` 补 `claude-fable-5`、`claude-opus-4-8`（置于列表前部），更新 `tests/modelsConfig.test.js`
- [x] 5.2 `src/services/modelService.js` 静态 Claude 列表补齐当代模型

## 6. 收尾验证

- [x] 6.1 `npx prettier --write` 修改文件 → `npm run lint`（仅校验本变更文件）→ 相关 Jest 套件
- [x] 6.2 真机验证（服务重启后，临时 cr_ key，用后即删）：三端点动态路径全部通过 —— ① `/apiStats/models` `claudeSource: 'upstream'`、claude[0]=fable-5、platforms.claude 同步；② `/api/v1/models` claude 段含 fable-5/opus-4-8 且 openai/gemini 段仍在；③ `/openai/claude/v1/models` 含 fable-5、旧的 `claude-opus-4-20250514` 已消失。静态兜底路径未在线上重复验证（需破坏账户/上游连通性，对运行中服务侵入过大），已由单测充分覆盖：`apiStatsModelsRoute`/`openaiClaudeModelsRoute` 各含 fallback 用例 + `modelService` null/空降级 + `fetchAvailableModels` null 路径
- [x] 6.3 `npm run service:restart` 后 `/health` 200，服务正常运行
