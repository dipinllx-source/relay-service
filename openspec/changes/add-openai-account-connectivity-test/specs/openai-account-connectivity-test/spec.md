# openai-account-connectivity-test

## ADDED Requirements

### Requirement: `openai` 平台账户 SHALL 提供手动连通性测试

管理端 SHALL 为 `openai` 平台（ChatGPT / Codex OAuth 账户）提供一个手动触发的连通性测试，其可用性与交互 MUST 对齐 claude / bedrock 等已支持平台：账户列表出现「测试」按钮，点击后向上游发起一次真实但极小的请求，并把结果反馈给管理员。

测试 MUST 通过后端路由 `POST /admin/openai-accounts/:accountId/test`（仅 `authenticateAdmin`）触发，前端 MUST 将 `openai` 纳入受支持测试平台并映射到该端点。

#### Scenario: 账户列表展示 openai 测试按钮

- **WHEN** 管理员在账户列表查看一张 `platform === 'openai'` 的账户
- **THEN** 该账户行 SHALL 显示「测试账户连通性」按钮
- **AND** 点击后 SHALL 打开测试弹窗并允许发起测试

#### Scenario: 连通正常的账户测试成功

- **WHEN** 一张 token 有效、代理可达的 `openai` 账户被测试
- **THEN** 后端 SHALL 向 `https://chatgpt.com/backend-api/codex/responses` 发起一次携带有效 OAuth Bearer token 的请求
- **AND** 测试结果 SHALL 表示成功，并附带上游返回的少量文本与耗时

#### Scenario: 后端路由鉴权

- **WHEN** 未通过管理员鉴权的请求访问 `POST /admin/openai-accounts/:accountId/test`
- **THEN** 该请求 SHALL 被 `authenticateAdmin` 拒绝

### Requirement: 测试请求 MUST 复用可复用的 Codex 出站构造逻辑

测试路径 MUST NOT 在路由内重复实现一份 token 解密 / 刷新 / 代理构造 / 请求组装，而 SHALL 收口到一个可被测试与未来定时任务共用的 relay 方法。该方法 MUST 正确处理 `openai` 账户区别于 claude 的三处事实。

#### Scenario: 取有效 access token

- **WHEN** 测试方法准备账户凭据且账户 token 已过期
- **THEN** 该方法 SHALL 先调用 `refreshAccountToken` 刷新再重新读取账户
- **AND** 由于 `getAccount` 不解密 `accessToken`，该方法 MUST 显式解密后再用于 `Authorization` 头

#### Scenario: 请求头与代理

- **WHEN** 测试方法组装 Codex 请求
- **THEN** 请求 MUST 设置 `authorization: Bearer <token>`、`chatgpt-account-id`、`host: chatgpt.com`
- **AND** 若账户配置了代理，请求 MUST 经该代理发出
- **AND** 请求体 MUST 设置 `store: false`

### Requirement: 限流响应 MUST 与连接失败区分，并 MUST 计入账户限流状态

当上游对测试请求返回 429（周期限额触发）时，测试结果 MUST 表达为「账户可达但已被限流」，MUST NOT 表达为「无法连接」。

同时，由于测试消耗的是与业务请求**同一份 Codex 周期配额**，该 429 是对调度器同样成立的真实限流事实，故测试 MUST 将其计入该账户的限流状态（与业务请求遇 429 的处理一致），MUST NOT 静默丢弃。

#### Scenario: 测试遇到 429 的结果语义

- **WHEN** 一张 `openai` 账户在测试时上游返回 429
- **THEN** 测试结果 SHALL 表示账户可达但已被限流，并在可得时给出重置剩余时间
- **AND** 该结果 MUST NOT 表述为「无法连接」或「连接失败」

#### Scenario: 测试遇到 429 的限流标记

- **WHEN** 测试请求收到上游 429 且可解析出限流信息
- **THEN** 该账户 SHALL 被标记为限流状态，与业务请求触发 429 时的处理保持一致
- **AND** 标记 SHALL 携带可得的重置时间信息

#### Scenario: 真实的连接失败

- **WHEN** 账户 token 无效或代理不可达导致请求无法完成
- **THEN** 测试结果 SHALL 如实表示连接失败并给出可读错误信息
- **AND** 该情形 MUST NOT 被标记为限流

### Requirement: 测试 payload MUST 为最小合规 Responses 请求体

测试 SHALL 使用最小的合规 Responses 请求体，MUST NOT 附带 Codex CLI 的 `instructions` 或 `tools` 等额外字段，也 MUST NOT 附带 Codex backend 不接受的参数。测试 MUST NOT 因 payload 不合规产生「账户其实正常却报连接失败」的假阳性。

#### Scenario: 最小 payload 合规

- **WHEN** 测试向 Codex backend 发送测试请求体
- **THEN** 该请求体 SHALL 为合规的 Responses 格式，含 `model` 与 `input`，并设置 `store: false`
- **AND** 该请求体 MUST NOT 包含 `instructions` 或 `tools` 字段

#### Scenario: 不得携带上游不支持的参数

- **WHEN** 测试请求体由通用 Responses payload 构造器生成
- **THEN** 实现 MUST 剔除 Codex backend 不接受的参数
- **AND** 具体地，请求体 MUST NOT 包含 `max_output_tokens`——该参数在公开 Responses API 可用，但 Codex backend 会以 `400 Unsupported parameter: max_output_tokens` 拒绝整个请求

#### Scenario: 上游以参数问题拒绝时不得误判账户

- **WHEN** 上游因请求体字段问题返回 400
- **THEN** 测试实现 MUST 修正请求体使合规账户测试成功
- **AND** MUST NOT 把该 400 作为「账户不可用」呈现给管理员

### Requirement: OpenAI 模型清单 SHALL 优先取自上游动态接口

系统 SHALL 通过 Codex 上游接口动态获取 OpenAI 可用模型清单，静态列表仅作为兜底。获取方式 MUST 对齐 Claude 既有的动态拉取范式（可用账户 → 有效 token → 上游 GET → 成功与失败双 TTL 缓存 → 失败回退静态）。

上游接口为 `GET https://chatgpt.com/backend-api/codex/models`，MUST 携带有效 OAuth Bearer token，并 MUST 传递必填 query 参数 `client_version`（缺失时上游返回 400）。

#### Scenario: 成功获取上游清单

- **WHEN** 存在至少一张可用的 `openai` 账户且上游可达
- **THEN** 系统 SHALL 从上游获取模型清单并用于前端模型选项
- **AND** 清单来源 SHALL 可被标识为上游而非静态兜底

#### Scenario: 拉取请求经由账户代理

- **WHEN** 用于拉取清单的账户配置了代理
- **THEN** 该拉取请求 MUST 经由该代理发出

#### Scenario: 上游不可达时回退静态

- **WHEN** 上游不可达，或不存在任何可用 `openai` 账户
- **THEN** 系统 SHALL 回退到静态兜底列表，模型选项 MUST 保持可用
- **AND** 该情形 SHALL 被记录为告警，并 SHALL 在短 TTL 内避免重复打上游

#### Scenario: 缓存复用

- **WHEN** 距上次成功获取未超过成功缓存有效期
- **THEN** 系统 SHALL 复用缓存结果，MUST NOT 每次请求都打上游

### Requirement: `client_version` MUST 自动升级，MUST NOT 写死

上游依据 `client_version` 做**能力门控**：版本越新解锁越多模型，版本落后时返回**空数组或不完整清单而非错误**。因此该值 MUST NOT 硬编码为固定常量，MUST 具备自动跟进最新版本的能力，否则清单会随时间静默劣化且无从察觉。

系统 SHALL 从多个来源解析该版本并取语义版本**最大值**，且解析结果 MUST 单调不降。系统 MUST NOT 上报一个虚构的超高版本来规避门控。

#### Scenario: 从真实客户端流量学习版本

- **WHEN** 一个 Codex 客户端请求经过中继且其 User-Agent 含版本号
- **THEN** 系统 SHALL 提取该版本并纳入版本解析来源
- **AND** 当该版本语义上高于已记录版本时，记录值 SHALL 被更新

#### Scenario: 解析结果单调不降

- **WHEN** 已记录版本高于本次观测到的客户端版本
- **THEN** 记录值 MUST NOT 被降级
- **AND** 其有效期 SHALL 被续期

#### Scenario: 本地客户端落后时仍能取到最新版本

- **WHEN** 所有本地客户端的版本均低于官方已发布的最新版本
- **THEN** 系统 SHALL 能从官方发布渠道获取更高版本并采用之
- **AND** 该渠道不可达时 MUST NOT 阻塞或失败，SHALL 静默跳过并沿用其余来源

#### Scenario: 冷启动无流量且无外部渠道

- **WHEN** 系统首次运行，既无 Codex 流量记录也无法访问官方发布渠道
- **THEN** 系统 SHALL 使用一个已验证可取得完整清单的兜底版本常量
- **AND** MUST NOT 因缺少版本而放弃拉取

#### Scenario: 不得上报虚构版本

- **WHEN** 系统构造 `client_version` 参数
- **THEN** 其值 SHALL 来自真实客户端流量、官方发布版本或兜底常量
- **AND** MUST NOT 为规避门控而上报任意超高的虚构版本号

### Requirement: 上游返回空清单 MUST NOT 被静默当作正常结果

系统 MUST NOT 将空数组静默视为「上游没有模型」，否则版本落后导致的清单劣化会被兜底完全掩盖。由于无法从响应本身判断清单是否完整，系统 SHALL 记录本次使用的版本与返回条数以便事后核对。

#### Scenario: 上游返回空数组

- **WHEN** 上游以 200 返回空的模型数组
- **THEN** 系统 SHALL 记录告警级日志以提示所用版本可能过低
- **AND** 系统 SHALL 回退静态兜底列表
- **AND** 该结果 MUST NOT 被当作成功清单写入成功缓存

#### Scenario: 记录版本与条数以便核对完整性

- **WHEN** 系统成功从上游取得非空清单
- **THEN** 日志 SHALL 同时包含本次使用的 `client_version` 与返回的模型条数

#### Scenario: 可观测与强制重新解析

- **WHEN** 管理员需要确认当前解析出的客户端版本
- **THEN** 系统 SHALL 提供查看该版本及其有效期的入口
- **AND** SHALL 支持清除缓存以强制重新解析


### Requirement: 静态兜底列表 SHALL 订正为上游真值且不与旧列表求并集

静态兜底列表 SHALL 被订正为与上游一致的模型集合，MUST NOT 与历史列表求并集保留已下线模型——已下线模型出现在可选项中会导致用户选中后必然失败。

清单顺序 SHALL 保持最新模型在前，因为前端默认模型取列表首项。

#### Scenario: 兜底列表不含已下线模型

- **WHEN** 静态兜底列表被使用
- **THEN** 其中 MUST NOT 包含上游已不存在的模型
- **AND** 其首项 SHALL 是当前最新的模型

#### Scenario: 无定价模型被移除

- **WHEN** 某模型在定价数据中不存在且上游亦不存在
- **THEN** 该模型 SHALL 从 OpenAI 模型列表中移除

#### Scenario: 不得改动 Azure 模型列表

- **WHEN** 清理 OpenAI 模型列表时遇到与 Azure 部署名同名的条目
- **THEN** Azure 平台自身的允许模型列表 MUST NOT 被改动

### Requirement: 测试平台模型映射 MUST 包含 `openai` 键

平台到测试模型列表的映射 MUST 包含 `openai` 键，且前端回退默认模型 MUST 为 `openai` 平台提供取值。缺失任一处时，`openai` 账户的测试会因层层回退而最终取到 **Claude 模型名**并送往 Codex 上游，造成功能静默失效。

#### Scenario: openai 平台有专属测试模型列表

- **WHEN** 管理员打开一张 `openai` 账户的测试弹窗
- **THEN** 模型下拉列表 MUST NOT 为空
- **AND** 默认选中项 SHALL 为该列表首项，即当前最新模型

#### Scenario: 默认模型不得回退为 Claude 模型

- **WHEN** `openai` 平台的模型列表因任何原因为空
- **THEN** 回退默认模型 MUST 是一个 OpenAI 或 Codex 模型
- **AND** 该值 MUST NOT 是 Claude 系列模型

#### Scenario: 默认模型不被归一化改写

- **WHEN** 测试以默认模型向 Codex 上游发起请求
- **THEN** 实际送出的模型 SHALL 与管理员所见一致
- **AND** 该模型 MUST NOT 被中继归一化改写为 `gpt-5`



### Requirement: 本变更 MUST NOT 改变 Codex 正常业务请求与定时测试现状

抽取 Codex 出站构造为可复用方法的过程 MUST NOT 改变 `openai` 账户正常业务请求（流式 / 非流式 / compact）的行为。定时测试调度 MUST 保持现状，不在本变更实现。

#### Scenario: 正常业务请求回归

- **WHEN** 一个正常的 Codex CLI 业务请求经过被抽取后的中继逻辑
- **THEN** 其请求头、`store` 处理、限流处理与响应行为 SHALL 与变更前一致

#### Scenario: 定时测试保持未实现

- **WHEN** 定时测试调度器对 `openai` 平台账户执行调度
- **THEN** 其行为 SHALL 与变更前一致，本变更 MUST NOT 声称已实现 openai 定时测试
