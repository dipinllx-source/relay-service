# Tasks

## 1. 后端：可复用的 OpenAI relay 测试方法

- [x] 1.1 新建 `src/services/relay/openaiRelayService.js`（或在既有 openai relay 承载处），实现 `_prepareAccountForTest(accountId)`：`getAccount` → `isTokenExpired` 为真则 `refreshAccountToken` 后重取 → `decrypt(account.accessToken)` → `createProxyAgent(account.proxy)`，返回 `{ account, accessToken, proxyAgent }`
- [x] 1.2 实现 `testAccountConnection(accountId, res, model)`：造**最小** Responses 测试 payload（`createOpenAITestPayload` + `store:false`，不带 `instructions`/`tools`，`max_output_tokens` 取极小值），POST `https://chatgpt.com/backend-api/codex/responses`（`responseType:'stream'`，带 `authorization` / `chatgpt-account-id` / `host:chatgpt.com` / `accept:text/event-stream`），把上游 SSE 转成前端期望事件写回 `res`（实测修正：必须剔除 `max_output_tokens`，Codex backend 以 `400 Unsupported parameter` 拒绝该参数）
- [x] 1.3 SSE 解析：文本取 `response.output_text.delta.delta`，模型取 `response.completed.response.model`，错误取 `error.type/message`
- [x] 1.4 429 处理：识别 `rate_limit_error`/`usage_limit_reached`/`rate_limit_exceeded`，解析 `resets_in_seconds`；结果回「账户可达但已限流（剩余重置时间）」而非「连接失败」，**同时**调用 `unifiedOpenAIScheduler.markAccountRateLimited` 把限流计入账户状态（与业务请求遇 429 一致）
- [x] 1.5 确保真实连接失败（token 失效 / 代理不通）走失败分支，且**不**被标记为限流

## 2. 后端：admin 路由

- [x] 2.1 在 `src/routes/admin/openaiAccounts.js` 新增 `POST /:accountId/test`（`authenticateAdmin`），直接把 `res` 透传给 `openaiRelayService.testAccountConnection`，对齐 `claude-accounts/:id/test` 的写法
- [x] 2.2 确认该路由的挂载前缀，使最终路径为 `/admin/openai-accounts/:accountId/test`（与前端端点映射一致）

## 3. 模型清单：上游动态拉取 + 静态兜底订正

- [x] 3.1 新增 `openaiAccountService.fetchAvailableModels()`，照搬 `claudeAccountService.fetchAvailableModels()` 范式：挑可用账户（`isActive==='true'` 且 `status!=='error'` 且 `schedulable!=='false'` 且未过期）→ 取并**解密** accessToken → 走账户代理 → `GET https://chatgpt.com/backend-api/codex/models?client_version=<自动解析值，见 3.2>` → 映射 `slug`/`display_name` → 成功缓存 1h / 失败缓存 1min
- [x] 3.2 实现 `client_version` **自动升级**解析器（三源取语义版本最大值、单调不降）：
  - [x] 3.2.1 源①流量学习：照搬 `claudeRelayService.captureAndGetUnifiedUserAgent` 范式，用现成正则 `/^(codex_vscode|codex_cli_rs|codex_exec)\/[\d.]+/i` 从 Codex 请求 UA 提取版本，存 Redis（如 `codex_client_version:daily`，TTL 25h），**仅当语义版本更大时覆盖，否则只续期**
  - [x] 3.2.2 复用既有 `compareSemanticVersions`（建议提取为公共 util，避免从 `claudeRelayService` 反向依赖）
  - [x] 3.2.3 源②npm registry：`GET https://registry.npmjs.org/@openai/codex/latest` 取 `version`（实测 0.149.1，响应仅 3.5KB），长 TTL 缓存（约 24h）；**失败静默跳过，绝不阻塞拉取**
  - [x] 3.2.4 源③floor 兜底常量：取已验证可拿全量的值（当前 `0.144.5`），保证冷启动无流量无外网时可用
  - [x] 3.2.5 三源取最大后单调写回；**禁止**上报虚构超高版本（如 `9.9.9`）
- [x] 3.3 空/不完整清单处理：空数组 → 记 warn 提示所用版本可能过低 + 落入失败缓存 + 返回 null 由调用处兜底；成功时日志 SHALL 同时记录本次 `client_version` 与返回条数（无法从响应判断完整性，靠日志事后核对）
- [x] 3.3b 管理端可观测：照 `GET /admin/claude-code-version` 与 `POST /admin/claude-code-version/clear` 的样子，提供查看当前解析版本/各源取值/TTL 的只读入口与清缓存入口
- [x] 3.4 `apiStats.js` 的 `GET /apiStats/models`：openai 段接入动态列表，并按 `claudeSource` 的写法新增 `openaiSource: 'upstream' | 'fallback'` 标记位
- [x] 3.5 `modelService.getAllModels()` 扩展为支持替换 openai 段动态列表（当前仅 claude 段可替换）
- [x] 3.6 订正 `config/models.js` 的 `OPENAI_MODELS` 为上游真值 8 项，顺序保持最新在前：`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini`、`gpt-5.3-codex-spark`、`codex-auto-review`；**不与旧列表求并集**
- [x] 3.7 同步订正 `modelService.getDefaultModels().openai.models` 静态兜底，与 3.6 保持一致
- [x] 3.8 移除 `codex-mini`（上游不存在且 `data/model_pricing.json` 无定价）；**不得改动** Azure 的 `ALLOWED_MODELS` 与 `AccountForm.vue` 的 Azure 分支

## 4. 前端：暴露测试入口

- [x] 4.1 `web/admin-spa/src/views/AccountsView.vue` 的 `supportedTestPlatforms` 数组加入 `'openai'`
- [x] 4.2 `web/admin-spa/src/components/common/UnifiedTestModal.vue` 的 `endpoints` 映射加入 `openai: .../admin/openai-accounts/${id}/test`
- [x] 4.3 把 `'openai'` 纳入 `startTest` 里的 `useSSE` 平台列表
- [x] 4.4 `config/models.js` 的 `PLATFORM_TEST_MODELS` 补 `openai` 键（**缺失会导致默认模型层层回退到 `platformFallbackModels.claude`，把 Claude 模型名送给 Codex 上游**）
- [x] 4.5 `UnifiedTestModal` 的 `platformFallbackModels` 补 `openai` 项，取值为 OpenAI/Codex 模型（当前 `gpt-5.6-sol`），杜绝回退成 Claude 模型
- [x] 4.6 测试结果文案：429 场景需明确呈现「账户可达但已被限流 + 重置剩余时间 + 已标记限流」，避免管理员误判为功能异常

## 5. 实测与验证（关键：排除假阳性）

- [x] 5.1 用 43.110.32.63 上真实 `openai` 账户点「测试」，确认最小 payload 直接返回成功文本（预期无需补 `instructions`）；若意外 400，按 design Decision 2 兜底补最小字段后再测
- [x] 5.2 确认下拉框非空、默认选中 `gpt-5.6-sol`，且日志中无 `normalizing to gpt-5`（模型未被归一化改写）
- [x] 5.3 确认 `/apiStats/models` 返回 `openaiSource: 'upstream'`，且 openai 段为上游 8 项
- [x] 5.4 版本自动升级验证：
  - [x] 5.4.1 清掉版本缓存后发一次 Codex 请求（本机流量为 `codex_exec/0.144.5`），确认解析出的版本被学到且清单为 8 项
  - [x] 5.4.2 随后用低版本 UA（如 `codex_exec/0.139.0`）再发一次，确认记录值**未被降级**、仅续期，清单仍为 8 项
  - [x] 5.4.3 断开 npm 源（或临时改错域名）确认静默跳过、不阻塞拉取，仍走流量学习值
  - [x] 5.4.4 把 floor 常量临时下调到 `0.90.0` 且清空流量缓存与 npm 缓存，确认拿到空数组时记 warn 并回退静态、`openaiSource` 变为 `fallback`；随后还原
  - [x] 5.4.5 确认成功日志中同时含本次 `client_version` 与返回条数
- [x] 5.5 构造 token 失效/代理不通的账户，确认测试如实返回失败信息（真阴性），且账户未被误标限流
- [x] 5.6 验证已限流账户点测：结果为「限流」语义，且账户限流状态被正确写入（含重置时间）
- [x] 5.7 回归：确认抽取 Codex 出站逻辑后，正常 Codex CLI 业务请求（流式/非流式/compact）行为不变（验证方式：diff 确认 `openaiRoutes.js` 改动为纯新增的两处——一条 require 与一段被 `if (isCodexCLI)` 包裹的 fire-and-forget 调用，请求主链路未被触碰；重启后服务健康、无错误日志。观察窗口内无真实 Codex 业务流量，故未取得线上请求样本）
- [x] 5.8 回归：确认其余九类账户的测试按钮、弹窗与各自模型列表不受本次改动影响；`/v1/models` 对客户端输出正常

## 6. 构建与发布

- [x] 6.1 `web/admin-spa` 前端构建产物更新
- [x] 6.2 按项目流程重启 `relay-app.service` 并核对 `/health`
