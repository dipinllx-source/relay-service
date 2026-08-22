## ADDED Requirements

### Requirement: 访问日志落盘请求体前必须经过敏感字段脱敏

访问日志在把 `req.body` 写入日志 metadata 之前 SHALL 先经 `requestDetailHelper.sanitizeRequestBodySnapshot` 处理，MUST NOT 原样落盘。

现状是 `src/middleware/auth.js` 在两处直接把请求体塞进日志：`1812` 行的 `meta.req = req.body`（`res.on('finish')` 分支）与 `1781` 行 debug 分支的 `body: req.body`。于是 `logs/` 中留下了明文管理员密码：

```json
"req": { "currentPassword": "<明文>", "newPassword": "<明文>" }
```

脱敏设施本就存在且已够用 —— `SENSITIVE_KEY_PATTERN` 是无锚点子串匹配且含 `password`，`currentPassword` 与 `newPassword` 天然在覆盖范围内，**无需扩充黑名单**。缺陷纯粹在于访问日志这条路径从未接入。

SHALL 复用既有实现，MUST NOT 另写一个轻量脱敏函数：两套黑名单必然漂移，一处补了字段另一处忘补是典型的长期腐化点。

#### Scenario: 改密请求的密码字段不落盘

- **WHEN** `POST /web/auth/change-password` 被调用且请求体含 `currentPassword` / `newPassword`
- **THEN** 日志中对应字段 SHALL 为脱敏后的形态
- **AND** 日志 MUST NOT 包含任何一个密码的明文

#### Scenario: 登录请求的密码字段不落盘

- **WHEN** `POST /web/auth/login` 被调用且请求体含 `password`
- **THEN** 该字段在日志中 SHALL 被脱敏
- **AND** `username` 等非敏感字段 SHALL 保持可读，以不损失排查能力

#### Scenario: debug 分支同样脱敏

- **WHEN** 日志级别放开至 debug，请求开始时记录请求体
- **THEN** 该分支的请求体 SHALL 同样经脱敏后再落盘
- **AND** MUST NOT 只在 `res.on('finish')` 分支脱敏而遗漏 debug 分支

#### Scenario: 非敏感请求体保持可排查

- **WHEN** 请求体不含任何匹配敏感模式的字段
- **THEN** 日志 SHALL 保留其可读内容（受既有长度与深度截断约束）
- **AND** 脱敏 MUST NOT 导致排查所需的常规字段丢失

### Requirement: 密码族字段在访问日志中必须全量遮蔽

访问日志中键名匹配密码族（`password` / `passwd` / `pwd`）的字段 SHALL 被替换为完整的 `[REDACTED]`，MUST NOT 保留任何原文片段。

实施期实测确认：既有 `maskSensitiveValue` 为便于排查 token / api key 而保留首尾各 3 位，对长度 12 的密码会输出 `3.1***llx` —— 露出一半字符，显著缩小暴力破解空间。该遮蔽强度对 token 合适，对密码不合适。

该收紧 SHALL 只作用于访问日志这一处，MUST NOT 通过收紧共享的 `SENSITIVE_KEY_PATTERN` 来实现。共享正则同时服务于上游请求快照等功能，收紧它有漏遮真实凭据的风险。

#### Scenario: 密码族字段无原文残留

- **WHEN** 请求体含 `password` / `currentPassword` / `newPassword` / `adminPassword` 等字段
- **THEN** 日志中这些字段的值 SHALL 为完整的 `[REDACTED]`
- **AND** MUST NOT 保留首尾字符或任何长度线索

#### Scenario: 嵌套与数组中的密码族同样遮蔽

- **WHEN** 密码族字段出现在嵌套对象或数组元素内
- **THEN** 遮蔽 SHALL 递归生效
- **AND** MUST NOT 仅处理请求体顶层字段

### Requirement: 共享敏感字段正则的误伤范围必须作为已知限制记录

`SENSITIVE_KEY_PATTERN` 对业务字段的误伤 SHALL 被记录为已知限制并予接受，MUST NOT 通过收紧该正则来消除。

该正则以无锚点子串匹配，其中裸 `token` 分支会连带命中 `tokenLimit` / `totalTokens` / `tokenUsage` / `tokenLimitEnabled` 等业务数值字段，使它们在访问日志中显示为 `[REDACTED]`，代价是排查 API Key 创建与编辑请求时这些字段不可读。

接受而非修正的理由：该正则同时服务于上游请求快照等功能，为消除误伤而给 `token` 加边界匹配，会引入漏遮真实 `access_token` / `refresh_token` 变体的风险。少读几个数值字段的代价，远小于漏遮一个真实凭据。

#### Scenario: 业务字段被误伤但不影响正确性

- **WHEN** 请求体含 `tokenLimit` 等键名包含 `token` 子串的业务字段
- **THEN** 该字段在日志中 SHALL 显示为 `[REDACTED]`
- **AND** 该行为 SHALL 被视为已知限制，MUST NOT 被当作缺陷修复

#### Scenario: 其余常规字段保持可读

- **WHEN** 请求体含 `username` / `name` / `description` / `keyIds` / `dailyCostLimit` 等不匹配敏感模式的字段
- **THEN** 这些字段 SHALL 在日志中保持可读
- **AND** 排查能力 MUST NOT 因脱敏而实质受损

### Requirement: 已泄露凭据的处置必须依赖轮换而非日志清洗

本能力 SHALL 只保证「不再产生新的明文泄露」，存量日志中已有的明文密码 SHALL 通过轮换该密码来失效。

历史日志可能已被归档、压缩或外部采集，逐一清洗既不可靠也无法验证完成。可验证的处置只有一条：让已泄露的凭据本身失效。

轮换 SHALL 排在会话超时单位修正之前执行。若顺序颠倒，所有 token 会在密码轮换之前失效，而已泄露的旧密码此时仍是有效凭据。

#### Scenario: 修复上线后的凭据处置

- **WHEN** 脱敏修复已上线，且历史日志中存在明文管理员密码
- **THEN** 处置 SHALL 为轮换管理员密码
- **AND** MUST NOT 以「清洗历史日志」作为该风险的收口手段
