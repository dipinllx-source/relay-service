# Adapt OpenAI Scheduling to Weekly-Only Limit

## Why

Codex 上游已取消 5h 窗口，现仅回传**周限**，且落在 primary 槽位（2026-07-30 线上 Redis 实测：4/4 账号 `codexPrimaryWindowMinutes=10080`（7 天）、`codexSecondary*` 全 0）。两个后果：

1. **展示错位**：管理台标签写死 `primary→'5h'`、`secondary→'周限'`（`AccountsView.vue` L4968 `getCodexWindowLabel`），周限数据顶着 "5h" 标签展示，"周限" 栏恒 0%。
2. **调度盲区**：选号不感知配额消耗。4 账号 priority 全为 50，`sortAccountsByPriority` 退化为纯 LRU；LRU 只保证次数均匀，不保证配额消耗均匀，重度会话粘住的账号持续放血。周限重置周期最长 7 天，选错号的代价相比 5h 时代放大 33 倍。线上用量分布 38/20/18/13% 已现失衡——5x 小配额账号（Dipin-chartGPT-5x）反而烧得最快。

`codexPrimaryUsedPercent` 是百分比，天然归一化了 5x/20x 套餐的配额差异，是做均衡的理想指标。经核实该组字段目前**仅用于展示**，调度器不消费（OpenAI 限流走流内 429 的 `resets_in_seconds`），因此本变更无既有调度语义冲突。

## What Changes

- **调度**：`unifiedOpenAIScheduler` 内新增 OpenAI 专属排序：`priority ASC → usageBand ASC → lastUsedAt ASC → createdAt ASC`，其中 usageBand 由 `codexPrimaryUsedPercent` 分档（默认档宽 30%）；档内保留 LRU 避免羊群效应。`usedPercent ≥ 硬阈值`（默认 95%）的账号从候选池剔除，剔除后池空则放行（对齐现有 429 兜底语义，不引入新的拒绝路径）。共享 `sortAccountsByPriority`（Claude/Gemini 在用）行为不变。
- **展示**：`getCodexWindowLabel` 改为按 `windowMinutes` 动态推导（300→'5h'、10080→'周限'、其他→'Nh'/'Nd'）；无数据窗口不渲染。上游未来若恢复 5h 窗口，展示零改动自适应。
- **配置**：`OPENAI_USAGE_BAND_WIDTH=30`（设 100 等效关闭分档）、`OPENAI_USAGE_HARD_LIMIT=95`（设 100 关闭硬保护）。关闭态行为与现状严格一致，灰度与回滚干净。

## Non-Goals

- **粘性会话破除**（mapped 账号超限时强制迁移）：Codex prompt cache 绑定账号（线上单请求 cache_read 12 万 token 级），破除 = 缓存全灭 = 成本延迟双升。先让新会话自然分流，观察一周再议。
- Claude/Gemini 调度权重。
- Redis 存储结构、`codexPrimary*` 字段语义、`openaiRoutes` 响应头解析的任何变更。
- secondary 窗口参与调度（上游已不回传）。

## Impact

- `src/services/scheduler/unifiedOpenAIScheduler.js` — 候选过滤 + 排序（`selectAccountFromGroup` 与 `_getAllAvailableAccounts` 两条路径）
- `config/config.js`、`.env.example` — 两个开关
- `web/admin-spa/src/views/AccountsView.vue` — 标签推导 + 空窗口隐藏（卡片/列表两处渲染位，L1149 / L1749）
- **不动**：`src/utils/commonHelper.js` `sortAccountsByPriority`、Redis 结构、粘性会话机制
