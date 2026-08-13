## Why

账户与 API Key 已完成 DB 持久化重构（stage 0-12：Repository 抽象 + SQLite 元数据层 + `metadataSync` Redis→SQLite 对账，`METADATA_BACKEND=sqlite` 已生效），但备份/还原功能被落在了重构之外，目前处于不可用状态：

1. **Web 导出存在必现崩溃点（已复现）**：`backupService.exportBackup` 对全部 11 类账户实体一律 `hgetall`，而 bedrock 账户以 `client.set()` 存 JSON 字符串（`bedrockAccountService` 读取用 `get + JSON.parse`）。只要存在一个 bedrock 账户，导出立即 `ReplyError: WRONGTYPE` 整体 500。2026-08-06 11:58 管理台实际操作已触发（logs/stdout.log 662079 起连续 500），本次排查用一个临时 string 型 `bedrock_account:*` key 原样复现：导出 500，删除后立即恢复 200。
2. **bedrock 永远无法往返**：导出在 dump 之前崩溃；即便手工构造备份，`importBackup` 也只会 `hset` 成 hash，bedrock 服务读不出还原的账户。`metadataSync` 的 ACCOUNT_GROUPS 早已用 `storageType: 'string'` 正确处理 bedrock，backupService 抄了前缀表却没抄类型。
3. **备份层与持久层脱节**：`METADATA_BACKEND=sqlite` 下 SQLite 是持久镜像层，但备份端点对 SQLite 一无所知——只扫 Redis。还原结果依赖 `metadataSync` 15 秒异步窗口传播，且不重建索引集合、不清 `<index>:empty` 标记、不失效 read-through 缓存。
4. **删除对账无空 Redis 护栏（连带风险）**：`metadataSync` 每 15 秒做 Redis→SQLite 删除对账且无保护。Redis 一旦被清空/换实例，SQLite 中的账户与 API Key 会在 15 秒内被对账逻辑全部删除——与 `migrate-source-of-truth-to-sqlite` 提案初衷（"Redis 可丢失、可清空而不丢任何账户与 API Key"）直接相反。备份/还原本应是该场景的兜底，当前兜底链路自身也是坏的。
5. **三套备份入口各有残缺**：Web 端点（入口①）如上；CLI `data:export`（data-transfer.js，入口②）只导出 claude + gemini 两类账户，其余 9 类平台（含现网 4 个 openai 账户）直接漏掉，且同为 hgetall 假设；SQLite `.backup`（backup-metadata.js，入口③）是唯一全量一致性备份，但 6 月 3 日手工跑过一次后无定时任务，也没有任何配套还原入口/文档。管理台「存储健康」页展示的备份状态读的正是入口③的目录。
6. **tags 不在 Web 备份范围**（`apikey:tags:all` / SQLite tags 表），当前 0 条数据未踩雷，属范围缺口。

## What Changes

- **backupService 类型分流（修复 WRONGTYPE）**：ACCOUNT_GROUPS 对齐 metadataSync 的 `storageType`（hash/string）。导出时 string 实体走 `get()` 并在条目中携带 `__type: 'string'` + `value`；hash 实体维持 `__key + fields` 形态。逐实体 try/catch 错误隔离：单条坏数据记录 warn 并计入 errors，不再炸掉整个导出。
- **导入按类型回写**：`__type === 'string'` → `client.set(key, value)`；否则 `hset`。冲突跳过语义不变（exists 即 skip）。
- **备份版本升级**：`BACKUP_VERSION` 2.0 → 2.1，metadata 记录 `backend`（redis/sqlite）。导入向后兼容 2.0（全部按 hash 处理）与 2.1。
- **还原打通 SQLite**：`backend=sqlite` 时，importBackup 完成后同步触发一次 `metadataSync.reconcileAll()`，使还原结果立即落入 SQLite，不依赖 15 秒异步窗口；随后清理各账户索引的 `<index>:empty` 标记并失效 read-through 缓存键（`account:cache:*` / `apikey:cache:*`）。
- **tags 纳入备份范围**：导出/导入 `apikey:tags:all` 集合与 `apikey:tag:<tag>` 索引键（存在即备份），还原时原样写回。
- **metadataSync 空 Redis 护栏**：单次对账中，若所有账户前缀与 apikey 的实体 key 总数为 0 且 SQLite 中存在任何行，则跳过本轮删除对账（upsert 照常），logger.error 告警。防止 Redis 被清空后 SQLite 陪葬。
- **SQLite 文件级备份补完整**：新增 `scripts/restore-metadata.js`（`data:restore`）：停服校验 → SQLite `.backup` 文件一致性校验（PRAGMA integrity_check）→ 覆盖 `data/metadata.db` → 提示 `systemctl restart relay-app`。README/快速开始补充"灾备恢复"小节。为 `data:backup` 增加 systemd timer（或 crontab）每日定时，保留最近 N 份。
- **遗留 CLI 处置**：data-transfer.js / data-transfer-enhanced.js 的帮助文本与 README 中标记 deprecated，指向 Web 端点与 `data:backup`/`data:restore`；不修其平台覆盖缺口（避免维护两套格式）。

## Capabilities

### New Capabilities

- `backup-restore`：账户 / API Key / tags / 管理员凭据的备份导出、导入还原与 SQLite 文件级灾备的能力定义。

### Modified Capabilities

无（`openspec/specs/` 中现存 manual-upgrade-execution / release-version-awareness / service-process-supervision 均不涉及）。

## Impact

**代码**：
- `src/services/backupService.js` — 类型分流导出/导入、错误隔离、版本 2.1、tags、reconcile 触发与缓存/索引清理
- `src/storage/metadataSync.js` — 空 Redis 护栏
- `scripts/restore-metadata.js` — 新增；`package.json` 增加 `data:restore` script
- `scripts/data-transfer.js` / `data-transfer-enhanced.js` — 仅加 deprecated 提示
- `docs/`（README 或快速开始）— 灾备恢复小节
- systemd timer 或 crontab 条目 — `data:backup` 定时化（部署层，不入代码仓）

**数据**：无 schema 变更。备份文件格式 2.1 向后兼容 2.0；旧备份可导入，新备份在旧代码上导入时 string 实体（bedrock）会因缺少 `__type` 识别而被按 hash 写回——旧代码本就无法处理 bedrock，不构成回退。

**行为变化**：
- 存在 bedrock 账户时导出不再崩溃；bedrock 账户可完整往返备份/还原。
- Redis 被清空时 SQLite 不再被删除对账清空（改为告警），管理员可先还原备份再恢复对账。
- 还原后无需等待 15 秒，SQLite 立即可见；索引空标记与读缓存被主动清理。

**验证**：详见 tasks.md 第 6 组（服务器实测清单：临时 bedrock key 复现/消除、导入回环、护栏演练、restore 脚本演练）。

**回滚**：`git revert` 本变更提交 + `systemctl restart relay-app`；备份文件 2.1 与 2.0 双向可导入，数据格式无不可逆变化。
