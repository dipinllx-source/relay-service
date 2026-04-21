# Proposal: 将账号 / API Key 的主数据迁移到 SQLite

## Why

当前所有持久化数据（账号、API Key、标签、会话、并发、限流、统计聚合）都放在 Redis 中。这在项目早期是合理的，但存在一个**架构上的根本问题**：

> Redis 同时承担了 **"source of truth"（账号、API Key 等主数据）** 和 **"缓存 / 热状态"（并发计数、限流、session、统计）** 两种不相容的角色。

在真实部署场景中，Redis 经常是：

- **远端托管服务**（AWS ElastiCache、Upstash、阿里云 Redis 等），持久化策略由服务商决定
- **多租户共享实例**，配置无法由应用侧修改
- **容器化 / k8s emptyDir**，重建 pod 即清空
- **纯缓存定位**（运维团队明确拒绝把它当"持久存储"用）

这些场景下 Redis 的持久化能力无法依赖。**一旦 Redis 被重启、被 LRU 驱逐、被运维清空，系统就会丢失所有账号和 API Key**，相当于整个系统需要重建。这与 Redis 的"缓存"语义是冲突的。

本变更将**账号、API Key、标签**等主数据从 Redis 搬到本地 SQLite 作为 source of truth，Redis 降级为纯粹的缓存与热状态层。Redis 的任何异常（包括完全丢失）都不再影响系统的核心能力。

## What Changes

### 存储职能分层

| 数据 | 之前 | 之后 |
|---|---|---|
| API Key 元数据 | Redis hash | **SQLite** |
| API Key 累计统计（lastUsedAt / totalCost / requestCount） | Redis hash | **Redis 实时累加 + 定期 flush 到 SQLite** |
| API Key → 哈希查找索引 | Redis hash | **SQLite UNIQUE index** |
| 11 个平台的账号主数据 | Redis hash | **SQLite**（按 platform 列区分） |
| 账号 runtime 字段（lastUsedAt、lastError 等） | Redis hash 同一字段 | **Redis**（拆字段） |
| Tag 全局列表 + 关联关系 | Redis set + hash | **SQLite**（tags + api_key_tags） |
| 并发计数、限流窗口、粘性会话 | Redis | **Redis**（不变） |
| usage 实时统计（每请求多次 hincrby） | Redis | **Redis**（不变） |
| usage 历史明细 | Redis（按日期 key） | **Redis 实时 + 日终归档到 SQLite** |

### 新增

- `better-sqlite3` 作为嵌入式数据库依赖
- `src/storage/sqlite.js` — SQLite 连接、schema 管理、迁移
- `src/storage/repositories/` — Repository 接口层（IApiKeyRepository、IAccountRepository、ITagRepository）
- `scripts/migrate-redis-to-sqlite.js` — 从现有 Redis 数据一次性导入 SQLite
- `scripts/rollback-sqlite-to-redis.js` — 紧急回滚工具（反向导出）
- 后台 flusher：每 30 秒把 `apikey:runtime:{id}` 的累计统计 flush 到 `api_keys` 表
- 日终 cron：`usage:2026-04-22:*` → SQLite `usage_daily` 表
- 备份命令：`npm run data:backup` 基于 SQLite `.backup` API

### 修改

- `apiKeyService.js`、11 个 `*AccountService.js`：改为走 Repository 接口（不再直接调 `redis.js`）
- `redis.js`：保留为缓存 / 热状态层，账号和 key 的 CRUD 方法改为 cache 实现
- `middleware/auth.js`：API Key 查询走 Repository（内部做 read-through cache）
- 所有读写账号 `lastUsedAt` 的代码路径：改为写 Redis runtime key

### 不变

- Redis 连接逻辑、配置、部署要求
- API 行为（外部无感知）
- 数据模型的字段语义

## Out of Scope

- **多实例部署**：SQLite 文件不可跨进程共享；本变更明确**只支持单实例**
- **并发 / 限流 / session 迁移**：继续留在 Redis（这是 Redis 的核心价值）
- **usage 明细表迁移**：usage 的高频写继续留在 Redis；仅做日终聚合归档
- **管理员凭据（`data/init.json`）**：保持独立 JSON 文件，不迁 SQLite
- **软删除 / 审计日志**：本变更不加 `deleted_at`，保持硬删除
- **Redis 彻底可选**：仍然需要 Redis 才能启动（并发、限流、session 依赖它）
- **Schema 版本管理工具**（如 knex migrations）：用轻量级 SQL 脚本，不引入重型迁移框架

## 收益

1. **主数据持久性脱钩**：Redis 重启 / 清空 / 驱逐不再丢失任何账号或 API Key
2. **单机备份可行**：`cp data/metadata.db data/metadata.db.bak` 即完整备份
3. **崩溃一致性增强**：SQLite WAL 模式提供真正的事务保证
4. **数据可检索可修复**：SQLite 可用标准 SQL 查询、调试、手工修复
5. **架构边界清晰**：Repository 层隔离存储引擎，未来换 Postgres 也只改一层

## 风险

1. **SQLite 单进程限制**：必须明确文档"禁止多实例"，否则数据分裂
2. **flush 窗口丢失**：API Key 累计统计走 Redis + 定期 flush，崩溃时可能丢最后 30 秒的计数
   - 缓解：flush 间隔可配置；统计类数据可接受；文档化该窗口
3. **迁移过程数据丢失**：一次性迁移时若出错需回滚
   - 缓解：迁移脚本先写 SQLite 再删 Redis（可选 dry-run）
4. **备份管理**：SQLite 文件损坏 = 数据全失
   - 缓解：文档化备份策略；提供 `npm run data:backup`
