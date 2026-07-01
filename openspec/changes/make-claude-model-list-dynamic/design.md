# Design — Make Claude Model List Dynamic

## Context

- 三处对外 Claude 模型列表静态硬编码,陈旧程度不一(见 proposal 表)。其中 `openaiClaudeRoutes.js` 的 `/v1/models` 只列 `claude-opus-4-20250514` / `claude-sonnet-4-20250514` 两个 2025-05-14 模型,且 `created` 时间戳写死。
- 转发链路本身不依赖这些列表:调度器 `_isModelSupportedByAccount` 对 `claude-` 前缀放行,`claudeRelayService` 原样透传模型名。列表只影响"客户端能看到什么"。
- 仓库已有动态拉取先例:Antigravity 分支在 `/v1/models` 路由内实时调用 `geminiAccountService.fetchAvailableModelsAntigravity(accessToken, proxyConfig, refreshToken)` 并格式化为 OpenAI list。
- Spike 已验证:`GET https://api.anthropic.com/v1/models?limit=100`,头 `authorization: Bearer <token>` + `anthropic-version: 2023-06-01` + `anthropic-beta: oauth-2025-04-20`,返回 200 与完整新模型列表(含 `display_name`)。
- 前端三个 Claude 模型下拉框(`UnifiedTestModal`、`AccountForm`、`AccountScheduledTestModal`)统一通过 `getModelsApi()` 消费 `GET /apiStats/models`,因此动态化该端点即可让前端零改动受益。
- 经核实排除:pricing 走 GitHub `price-mirror` 镜像,运行时 `data/model_pricing.json` 已含 `claude-fable-5`/`opus-4-8`,无需动作;bedrock 映射 ID 体系与 Anthropic 不同且上线滞后,被迫静态;订阅门控基于命名约定,是独立正确性问题。

## Goals / Non-Goals

**Goals:**

- 三个对外列表端点的 Claude 段来自上游实时数据(带缓存),新模型发布无需改代码即可可见
- 上游不可达时无损降级到静态列表(行为与现状一致)
- 单一共享数据源 + 缓存,三端点复用,避免三次上游调用
- 后台前端零改动

**Non-Goals:**

- 不动 OpenAI / Gemini 列表来源
- 不做按 API Key / 订阅级别差异化的模型列表(取一个可用账户的列表作为全局视图)
- 不把动态列表变成转发层准入校验(保持"列表只影响可见性"的现状语义)
- 不碰 pricing、bedrock、订阅门控、测试透传

## Decisions

### D1. 数据源:上游 `GET /v1/models`(OAuth token)

上游 models 端点按账户订阅返回真实可用集合,是唯一不漂移的来源。不用 litellm(语义是"如何计费",且 pricing 已另行覆盖)。

### D2. 实现位置:`claudeAccountService.fetchAvailableModels()` + 模块级 TTL 缓存

- 在 `claudeAccountService` 新增方法:
  1. 命中缓存(成功 TTL 默认 1h,可配)直接返回
  2. 失败短缓存(60s)窗口内直接返回 `null`,防上游故障时每请求打上游
  3. 取第一个 `isActive && status !== 'error' && schedulable !== 'false' && !isSubscriptionExpired` 的账户
  4. `getValidAccessToken(accountId)` 取 token(自带刷新),经账户 proxy(复用 `ProxyHelper` / `_createProxyAgent`)请求上游
  5. 成功 → 规范化为 `[{ id, object: 'model', created, owned_by: 'anthropic', display_name? }]`,写缓存
  6. 失败(无可用账户 / 网络 / 非 200 / 空列表)→ warn 日志(不含 token),写失败缓存,返回 `null`
- fallback 放在**调用方**(路由层),保持 service 语义干净("上游怎么说"),路由决定兜底。
- 备选:独立新 service 文件 — 否决,单方法 + 缓存不值得新文件,挂账户服务旁还能复用 token/proxy 私有逻辑。
- 备选:放进 `modelService` — 否决,`modelService` 无账户/token/proxy 依赖,引入会层级倒挂。

### D3. 缓存:进程内存,不进 Redis

列表小、可随时重建、过期无害(兜底可用)。SQLite backend 约束单实例,内存缓存即全局;redis backend 多实例下各实例独立拉取一次,成本可忽略。

### D4. 三端点统一消费

- **`/api/v1/models`(api.js)**:`modelService.getAllModels({ claudeModels })` 增加可选参数,传入动态列表则替换 claude 段,OpenAI/Gemini 段不变;`null` 走纯静态。黑名单过滤保持原位。
- **`/apiStats/models`(apiStats.js)**:路由变 async,Claude 段(`data.claude`、`data.platforms.claude`、`data.all` 中 Claude 部分、`?service=claude` 分支)优先动态;失败回落静态 `CLAUDE_MODELS`;新增 `claudeSource: 'upstream' | 'fallback'` 观测字段;始终 200。前端零改动。
- **`/openai/…/v1/models`(openaiClaudeRoutes.js)**:用动态列表替换两个老模型;`null` 时回落到一个静态兜底列表(复用 `modelService` 的 claude 段或 `CLAUDE_MODELS`,而非原来的两条);黑名单过滤保持。

### D5. 静态列表降级为兜底并补齐

`config/models.js` 与 `modelService.js` 的静态 Claude 列表补齐当代模型(fable-5、opus-4-8/4-7/4-6、sonnet-4-6),使上游不可达时兜底也不至于太旧。它们从"唯一真相"降级为"兜底来源",接口保持兼容。

## Risks / Trade-offs

- [上游 models 端点对 OAuth token 的支持属非公开行为,可能变更] → 失败即兜底静态,退化到现状而非更差;warn 可观测。
- [取"第一个可用账户"的列表,不同订阅级别账户混部时可能展示某些账户不可用的模型] → 与现状一致(静态列表同样不区分);转发层调度器 opus gate 兜底真实准入。
- [缓存 1h 内新模型不可见 / 已下线模型仍可见] → 可接受;TTL 可配,重启即刷新。
- [`/apiStats/models` 是公开接口,触发上游调用放大] → D2 缓存(成功 1h / 失败 60s)约束:每 60 秒至多一次上游请求。
- [`openaiClaudeRoutes.js` 列表从 2 个变多] → 客户端通常按需选模型,扩大可见集合是修复而非回归。

## Migration Plan

无数据迁移。普通发版 → `npm run service:update`。回滚即回退代码,缓存为进程内存,无状态残留。

## Open Questions

- 多 claude-official 账户时是否取各账户列表并集?当前单账户,先按"第一个可用账户"实现,留作后续增强。
