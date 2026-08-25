## Why

账户列表里，claude / claude-console / bedrock / gemini / gemini-api / openai-responses / azure-openai / droid / ccr 九类账户都有「测试账户连通性」按钮，点一下就能同步验证这张账户能不能正常出站。唯独 `openai` 平台（ChatGPT / Codex OAuth 账户，走 `openaiAccountService`）没有——按钮不显示、后端没有 `/test` 路由、也没有可复用的 relay 测试方法。

结果是：Codex 账户加进来后，管理员无法在不真正跑一次 Codex CLI 请求的前提下，确认这张账户的 OAuth token 是否有效、代理是否通、上游是否可达。token 过期或被限流时只能等真实业务请求报错才发现。

本变更为 `openai` 平台补齐**手动连通性测试**，对齐其余九类账户的交互。范围只做手动测试（前端按钮 + 后端同步/流式路由），不含定时测试调度（`accountTestSchedulerService._testOpenAIAccount` 仍保持现状的 stub，留待后续变更）。

## What Changes

- 新增可复用的 OpenAI relay 测试方法（对齐 `claudeRelayService.testAccountConnection` 的抽法）：把 `openaiRoutes.js` 里内联的 Codex 出站请求构造逻辑，收口成一个供测试与未来定时任务共用的公共方法，避免在路由里重复实现一遍 token 解密 / 刷新 / 造 payload / 发请求。
- 新增后端路由 `POST /admin/openai-accounts/:accountId/test`（`authenticateAdmin`），以 SSE 流式返回测试过程，对齐 `POST /admin/claude-accounts/:accountId/test`。
- **模型清单改为上游动态拉取**：新增 `openaiAccountService.fetchAvailableModels()`，通过实测确认可用的 `GET https://chatgpt.com/backend-api/codex/models?client_version=<v>` 获取清单，对齐 Claude 既有的「上游优先 + 静态兜底 + 双 TTL 缓存」范式。静态列表退化为纯兜底。
- **`client_version` 自动升级**：上游按该参数做能力门控（`0.99.0`→3 个模型、`0.139.0`→5 个、`0.144.5`→8 个），写死会随时间静默劣化。改为三源取语义版本最大值且单调不降：从真实 Codex 流量 UA 学习（照搬 `claudeRelayService.captureAndGetUnifiedUserAgent` 范式）、npm `@openai/codex` 的 latest、以及冷启动兜底常量。
- **订正过期的静态模型列表**：实测发现 `config/models.js` 的 14 项里 12 项、`modelService.js` 的 10 项里 8 项在上游已不存在（含原本要用作默认值的 `gpt-5.3-codex`）。兜底列表直接替换为上游真值 8 项，不与旧列表求并集。顺带移除上游不存在且无定价数据的 `codex-mini`。
- **补齐 `openai` 的测试模型映射**：`PLATFORM_TEST_MODELS` 与前端 `platformFallbackModels` 均缺 `openai` 键，不补会导致默认模型层层回退到 Claude 模型并送往 Codex 上游，功能静默失效。
- 前端 `AccountsView` 的 `supportedTestPlatforms` 加入 `openai`，让「测试」按钮对 Codex 账户可见。
- 前端 `UnifiedTestModal` 的账户端点映射 `endpoints` 加入 `openai`，并把 `openai` 纳入 `useSSE` 列表（Codex 测试为流式）。

## Impact

- Affected specs: `openai-account-connectivity-test`（新增能力）
- Affected code:
  - `src/services/relay/openaiRelayService.js`（新增文件，或在既有 openai relay 承载处新增测试方法）
  - `src/routes/admin/openaiAccounts.js`（新增 `/test` 路由）
  - `src/services/account/openaiAccountService.js`（新增 `fetchAvailableModels`）
  - Codex `client_version` 自动升级解析器（流量学习需接入 `openaiRoutes.js` 的请求路径；版本比较工具建议从 `claudeRelayService` 提取为公共 util）
  - `src/routes/admin/system.js`（照 `claude-code-version` 增设 Codex 版本查看/清缓存入口）
  - `src/routes/apiStats.js`（openai 段接入动态清单 + `openaiSource` 标记）
  - `src/services/modelService.js`（支持替换 openai 段 + 订正静态兜底）
  - `config/models.js`（订正 `OPENAI_MODELS`、补 `PLATFORM_TEST_MODELS.openai`）
  - `web/admin-spa/src/views/AccountsView.vue`（`supportedTestPlatforms` 增项）
  - `web/admin-spa/src/components/common/UnifiedTestModal.vue`（端点映射、`useSSE`、`platformFallbackModels` 增项）
- 不改动 Codex 业务中继主链路（`openaiRoutes.js` 的正常请求路径），仅抽取其请求构造为可复用逻辑。
- **模型清单是行为变更**（非纯增量）：openai 段由静态改为「上游优先 + 静态兜底」，且静态兜底内容被订正。回滚只需移除动态拉取调用即退回纯静态。
- **有意保留的副作用**：测试消耗与业务同一份 Codex 周期配额；若测试撞到 429，该限流会被计入账户限流状态（与业务请求一致），可能使该账户短期不参与调度。这是有意为之——配额确实已耗尽，隐瞒它会让调度继续投给一张已限流的账户。
- 定时测试（scheduler）不在本次范围。

## 不做什么（Non-Goals）

- 不实现 `openai` 的定时测试调度（`_testOpenAIAccount` 保持 stub）。
- 不补 `openai-compatible` 平台的测试（另行处理）。
- 不改动 Codex 正常业务请求的行为、header 白名单或限流逻辑（测试路径复用既有限流标记，不修改其语义）。
- 不改动 Azure OpenAI 的模型列表（`azureOpenaiRoutes.js` 的 `ALLOWED_MODELS`、`AccountForm.vue` 的 Azure 分支），尽管其中同样出现 `codex-mini` —— 那是 Azure 部署名，与本次 OpenAI 清单订正无关。
- 不改动定价数据文件与教程文档中的模型名。

