## ADDED Requirements

### Requirement: 管理员会话超时配置的单位必须统一为秒

`config.security.adminSessionTimeout` SHALL 以**秒**为单位，其默认值与 `ADMIN_SESSION_TIMEOUT` 环境变量的文档说明 MUST 与该单位一致。

现状是该值为 `86400000`（注释自陈「24小时」，实为毫秒），却被 `web.js:110` 与 `web.js:383` 直接传给 `redis.setSession()` 的第三参——那里的单位是秒。结果会话 TTL 被放大 1000 倍，现网实测 `ttl=85077793`（约 985 天）。也就是说，管理员会话的过期策略**事实上从未生效过**。

单位 SHALL 通过修正配置默认值来统一，MUST NOT 通过在调用点做除法换算来兼容。全仓仅 4 处引用该配置，其中真正的消费者只有那两个 `expire`，它们要的就是秒；保留毫秒语义等于永久维持「配置单位与唯一消费者单位不一致」这一陷阱。

#### Scenario: 登录后会话按配置值过期

- **WHEN** 管理员登录成功，系统为其创建会话
- **THEN** 该会话 key 的 `TTL` SHALL 等于 `adminSessionTimeout` 所配置的秒数
- **AND** 在未设置 `ADMIN_SESSION_TIMEOUT` 时 SHALL 为 86400 秒

#### Scenario: 会话到期后不再被接受

- **WHEN** 会话创建时间距今已超过配置的秒数
- **THEN** 携带该 token 的请求 SHALL 被判定为会话过期
- **AND** MUST NOT 因 TTL 被放大而继续有效

#### Scenario: 配置单位不做启发式推断

- **WHEN** `ADMIN_SESSION_TIMEOUT` 被设置为任意合法整数
- **THEN** 系统 SHALL 一律按秒解释该值
- **AND** MUST NOT 依据数值大小推断其为毫秒

### Requirement: 会话超时的单位修正必须在升级说明中标注为行为变更

该修正 SHALL 在升级说明中明确标注：所有现存管理员 token 将立即失效，且此后会话按配置周期到期。

修正会把会话 TTL 从约 985 天回落到 24 小时。虽然这是把「从未生效的过期策略」恢复为设计意图，但对使用者是可感知的行为变更：正在登录的管理员会被登出，且此后需按周期重新登录。

升级说明 SHALL 同时提示：若某部署曾显式设置 `ADMIN_SESSION_TIMEOUT` 为毫秒值，升级后 MUST 按秒重设，否则会话将在极短时间内到期。

#### Scenario: 升级后现存 token 失效

- **WHEN** 携带升级前签发的 token 的请求到达
- **THEN** 该 token SHALL 被判定为无效或过期
- **AND** 该结果 SHALL 已在升级说明中被预先告知

#### Scenario: 部署曾显式配置毫秒值

- **WHEN** 某部署的 `.env` 中 `ADMIN_SESSION_TIMEOUT` 为毫秒量级的值（如 `86400000`）
- **THEN** 升级说明 SHALL 提示该值须改为秒
- **AND** 系统 MUST NOT 自动改写用户的配置文件

### Requirement: 会话超时的响应字段必须与配置单位保持一致

登录与会话刷新响应中的 `expiresIn` SHALL 与 `adminSessionTimeout` 使用同一单位（秒），且该字段 MUST NOT 因本次修正被移除。

已核实前端 `web/admin-spa/src/stores/auth.js` 仅读取 `result.token` 并存入 localStorage，从不消费 `expiresIn`，因此单位变更没有前端爆炸半径。但它仍是公开响应字段，可能有其它调用方；改为秒后反而与 OAuth 生态中 `expires_in` 的惯例一致。

#### Scenario: 登录响应返回秒为单位的过期时长

- **WHEN** 管理员登录成功
- **THEN** 响应中的 `expiresIn` SHALL 为秒数，且与该会话 key 的实际 `TTL` 一致
- **AND** 该字段 SHALL 继续存在于响应体中
