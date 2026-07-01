# claude-dynamic-model-list

## ADDED Requirements

### Requirement: 动态获取上游 Claude 模型列表
系统 SHALL 提供 `claudeAccountService.fetchAvailableModels()`,使用一个可用 claude-official 账户(`isActive` 且 `status !== 'error'` 且 `schedulable !== 'false'` 且订阅未过期)的 OAuth access token,经该账户代理配置请求上游 `GET https://api.anthropic.com/v1/models`,请求头 MUST 含 `authorization: Bearer <token>`、`anthropic-version`、`anthropic-beta: oauth-2025-04-20`。返回规范化数组 `[{ id, object: 'model', created, owned_by: 'anthropic', display_name? }]`。

#### Scenario: 成功拉取
- **WHEN** 存在可用账户且上游返回 200
- **THEN** 返回包含上游全部模型 ID 的规范化数组,条目含 `id`/`object`/`created`/`owned_by`

#### Scenario: 无可用账户
- **WHEN** 不存在满足条件的 claude-official 账户
- **THEN** 返回 `null` 并记 warn 日志,不抛异常

#### Scenario: 上游失败
- **WHEN** 上游超时、网络错误、非 200 或空列表
- **THEN** 返回 `null` 并记 warn 日志(含状态码/错误类别,不含 token),不抛异常

### Requirement: 模型列表缓存
`fetchAvailableModels()` SHALL 使用进程内存 TTL 缓存:成功结果默认缓存 1 小时(可配),失败结果缓存 60 秒。缓存命中时 MUST NOT 发起上游请求。

#### Scenario: 成功缓存命中
- **WHEN** 距上次成功拉取未超过 TTL
- **THEN** 直接返回缓存数据,不发起上游请求

#### Scenario: 失败短缓存防雪崩
- **WHEN** 上次拉取失败且距失败未超过 60 秒
- **THEN** 直接返回 `null`,不发起上游请求

### Requirement: /api/v1/models 使用动态 Claude 列表并静态兜底
`GET /api/v1/models` 的 Claude 段 SHALL 优先使用 `fetchAvailableModels()`,返回 `null` 时 MUST 回落 `modelService` 静态列表。OpenAI 与 Gemini 段维持现有静态来源。现有 `restrictedModels` 黑名单过滤 MUST 继续生效。

#### Scenario: 动态列表可用
- **WHEN** 客户端请求且上游拉取成功(含缓存命中)
- **THEN** 响应 Claude 段为上游实时列表(如含 `claude-fable-5`),OpenAI/Gemini 段与现状一致

#### Scenario: 动态不可用时无损降级
- **WHEN** `fetchAvailableModels()` 返回 `null`
- **THEN** 响应与变更前纯静态行为一致,HTTP 200

#### Scenario: 黑名单过滤
- **WHEN** API Key 启用 `enableModelRestriction` 且 `restrictedModels` 含某动态模型 ID
- **THEN** 该模型不出现在响应中

### Requirement: /apiStats/models 的 Claude 段动态化
`GET /apiStats/models` 的 Claude 段(`data.claude`、`data.platforms.claude`、`data.all` 中 Claude 部分、`?service=claude` 分支)SHALL 优先使用动态数据;不可用时 MUST 回落静态 `CLAUDE_MODELS` 并保持 HTTP 200。响应 SHALL 含 `claudeSource: 'upstream' | 'fallback'` 字段。OpenAI/Gemini/other 段不受影响。

#### Scenario: 动态可用
- **WHEN** 上游动态数据可用
- **THEN** `data.claude` 与 `data.platforms.claude` 为上游列表,`claudeSource` 为 `'upstream'`

#### Scenario: 静态兜底
- **WHEN** 动态数据不可用(无可用账户 / 上游失败)
- **THEN** Claude 段为静态 `CLAUDE_MODELS`,`claudeSource` 为 `'fallback'`,HTTP 200

#### Scenario: 非 Claude 服务不受影响
- **WHEN** 请求 `?service=gemini`
- **THEN** 返回 Gemini 静态列表,不含 Claude 模型

### Requirement: OpenAI 兼容 /v1/models 使用动态 Claude 列表
`src/routes/openaiClaudeRoutes.js` 的 `GET /v1/models` SHALL 用 `fetchAvailableModels()` 的结果替换原有的两个静态模型(`claude-opus-4-20250514` / `claude-sonnet-4-20250514`);返回 `null` 时 MUST 回落到静态 Claude 列表(非原来的两条)。现有权限校验与 `restrictedModels` 黑名单过滤 MUST 保持。

#### Scenario: 动态可用
- **WHEN** 有权限的客户端请求且上游可用
- **THEN** 响应含上游实时 Claude 模型(如 `claude-fable-5`),不再仅限两个老模型

#### Scenario: 静态兜底
- **WHEN** `fetchAvailableModels()` 返回 `null`
- **THEN** 返回静态 Claude 列表,HTTP 200

#### Scenario: 权限不足
- **WHEN** API Key 无 claude 权限
- **THEN** 返回 403,行为与现状一致

### Requirement: 静态兜底列表补齐当代模型
`config/models.js` 的 `CLAUDE_MODELS` 与 `src/services/modelService.js` 的静态 Claude 列表 SHALL 包含当代模型(至少 `claude-fable-5`、`claude-opus-4-8`),使上游不可达时兜底列表不至过旧。静态列表角色 SHALL 为"兜底来源",接口保持向后兼容。

#### Scenario: 兜底列表含当代模型
- **WHEN** 上游不可达,客户端从任一列表端点取兜底数据
- **THEN** 兜底列表包含 `claude-fable-5` 等当代模型
