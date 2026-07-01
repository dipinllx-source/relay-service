# Make Claude Model List Dynamic

## Why

中转服务有**三处**对外暴露的 Claude 模型列表全部静态硬编码,缺失当代模型(`claude-fable-5`、`claude-opus-4-8/4-7/4-6`、`claude-sonnet-4-6`)。从这些端点拉列表的客户端(Claude Code、OpenAI 兼容 GUI、后台下拉框)看不到新模型,表现为"模型不可用"——尽管真实转发链路对 `claude-` 前缀模型完全放行(不在列表里的 `claude-opus-4-8` 每天 150+ 请求正常运行)。

三处列表各自陈旧程度不一,其中 OpenAI 兼容端点最糟:

| 端点 | 文件 | 当前静态内容 |
|---|---|---|
| `/api/v1/models` | `src/routes/api.js` | `modelService` 静态列表,停在 opus-4-5 时代 |
| `/apiStats/models` | `src/routes/apiStats.js` | `config/models.js`,后台下拉框消费 |
| `/openai/…/v1/models` | `src/routes/openaiClaudeRoutes.js` | **仅 `opus-4`/`sonnet-4` 两个 2025-05-14 老模型** |

可行性已验证(spike):用账户 OAuth token 调上游 `GET https://api.anthropic.com/v1/models`(`Bearer` + `anthropic-beta: oauth-2025-04-20`)返回 HTTP 200,完整包含 `claude-fable-5` 在内的全部新模型。上游就是现成、按账户订阅个性化的 source of truth。

本变更是一次**收窄重做**:仅做"展示/选择列表"动态化。经核实,pricing 已经是动态的(GitHub 镜像分支,运行时数据已含 fable-5),bedrock 映射被迫静态,订阅门控是独立正确性问题——均明确排除。

## What Changes

- 新增 `claudeAccountService.fetchAvailableModels()`:用可用 claude-official 账户的 OAuth token 实时拉取上游 `GET /v1/models`,TTL 缓存(成功 1h / 失败 60s 短缓存防雪崩),任何失败返回 `null` 由调用方回落静态列表。
- 三个列表端点的 Claude 段改用动态数据,失败回落静态:
  - `/api/v1/models`(api.js)— OpenAI/Gemini 段维持现状
  - `/apiStats/models`(apiStats.js)— Claude 段 + `platforms.claude` + `all` 动态化,新增 `claudeSource` 观测字段;**后台前端零改动**(已消费此端点)
  - `/openai/…/v1/models`(openaiClaudeRoutes.js)— 从两个老模型替换为动态列表
- 静态列表(`config/models.js`、`src/services/modelService.js`)降级为**兜底来源**,并补齐当代模型(fable-5、opus-4-8 等),使上游不可达时兜底也不至于太旧。
- 所有端点保留现有 `restrictedModels` 黑名单过滤语义。

明确**不在**本变更范围:

- 连通性测试按钮 model 透传修复(独立小修,非"列表")
- pricing(已动态且运行时已含 fable)
- bedrock 模型 ID 映射(ID/region/上线时间与 Anthropic 不同,被迫静态)
- 订阅门控 / fable 灰区(独立正确性问题)
- 独立的 `/admin/claude-models` 端点(冗余,前端走 `/apiStats/models`)

## Capabilities

### New Capabilities

- `claude-dynamic-model-list`: Claude 模型列表的动态获取、缓存、静态兜底,及其在三个对外列表端点的统一消费。

### Modified Capabilities

无(`openspec/specs/` 下暂无已归档能力,本仓库 change 各自携带 specs)。

## Impact

- **后端**:
  - 新增动态获取逻辑(挂 `src/services/account/claudeAccountService.js`,参照 `geminiAccountService.fetchAvailableModelsAntigravity` 先例)
  - `src/routes/api.js`(`/api/v1/models` Claude 分支)
  - `src/routes/apiStats.js`(`/models` Claude 段)
  - `src/routes/openaiClaudeRoutes.js`(`/v1/models`)
  - `src/services/modelService.js`(角色降级为兜底,接口保持兼容)
  - `config/models.js`(兜底列表补齐当代模型)
- **前端**:无改动(后台下拉框已消费 `/apiStats/models`)
- **外部依赖**:新增对上游 `GET /v1/models` 的低频调用(缓存命中零调用,经账户代理发出)
- **兼容性**:无 BREAKING。上游拉取失败时行为与现状一致(静态兜底);各端点响应格式不变,仅数据变新。
