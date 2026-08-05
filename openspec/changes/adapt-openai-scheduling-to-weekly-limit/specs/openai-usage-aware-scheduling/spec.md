# openai-usage-aware-scheduling

## ADDED Requirements

### Requirement: 按周限用量分档排序
OpenAI 调度器（`unifiedOpenAIScheduler`）候选账号排序 SHALL 使用键 `(priority ASC, usageBand ASC, lastUsedAt ASC, createdAt ASC)`，其中 `usageBand = floor(codexPrimaryUsedPercent / OPENAI_USAGE_BAND_WIDTH)`；`codexPrimaryUsedPercent` 缺失或非数值时 usageBand MUST 为 0。共享函数 `sortAccountsByPriority`（Claude/Gemini 调度器在用）的行为 MUST NOT 改变。

#### Scenario: 同优先级不同档
- **WHEN** 两账号 priority 相同，用量分别为 13% 与 55%（档宽 30）
- **THEN** 13%（band 0）排在 55%（band 1）之前，无论 lastUsedAt 先后

#### Scenario: 同档内保持 LRU
- **WHEN** 多账号落在同一 band
- **THEN** 按 lastUsedAt ASC 轮换，行为与现状一致

#### Scenario: 缺数据不惩罚
- **WHEN** 账号无 `codexPrimaryUsedPercent`（新账号或 openai-responses 类型）
- **THEN** 按 band 0 参与排序

#### Scenario: 关闭态等价现状
- **WHEN** `OPENAI_USAGE_BAND_WIDTH=100`
- **THEN** 全部账号落 band 0，排序结果与 `sortAccountsByPriority` 逐元素一致

### Requirement: 硬保护阈值与池空放行
候选池组装后，`codexPrimaryUsedPercent ≥ OPENAI_USAGE_HARD_LIMIT` 的账号 SHALL 被剔除；若剔除导致候选池为空，SHALL 放行全部被剔除账号并记 warn 日志（含各账号用量百分比）。`OPENAI_USAGE_HARD_LIMIT=100` 时 MUST NOT 剔除任何账号。

#### Scenario: 部分账号超限
- **WHEN** 池内 4 账号中 1 个 ≥95%
- **THEN** 该账号不参与本次选号，其余 3 个正常排序

#### Scenario: 全部账号超限
- **WHEN** 池内全部账号 ≥95%
- **THEN** 全部放行参与排序（不返回 402），记 warn 日志

#### Scenario: 粘性会话不受硬保护影响
- **WHEN** 粘性映射的账号用量 ≥95%
- **THEN** 粘性会话继续使用该账号（本变更不破除粘性，超限仅影响新会话落点）

### Requirement: 配置开关
系统 SHALL 提供 `OPENAI_USAGE_BAND_WIDTH`（默认 30）与 `OPENAI_USAGE_HARD_LIMIT`（默认 95）两个环境变量，取值钳制在 1-100；两者均为 100 时调度行为 MUST 与本变更引入前严格一致。

#### Scenario: 非法配置钳制
- **WHEN** 配置为 0、负数、超 100 或非数值
- **THEN** 钳制/回落到合法默认值，服务正常启动
