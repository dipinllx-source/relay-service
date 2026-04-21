## ADDED Requirements

### Requirement: SQLite is the source of truth for metadata

系统 SHALL 使用 SQLite（`better-sqlite3`）作为账号（accounts）、API Key（api_keys）、标签（tags）及其关联关系的 source of truth；所有元数据的持久化、查询与修改以 SQLite 为权威来源。Redis 丢失、清空、重启都不得导致任何账号或 API Key 记录丢失。

#### Scenario: Redis 被清空后重启服务

- **WHEN** 管理员 / 运维对 Redis 执行 `FLUSHALL`、清空数据卷、或 Redis 实例被重建
- **AND** 服务进程随后正常启动
- **THEN** 所有账号、API Key、标签数据必须与清空前一致，可被查询、可用于认证、可用于账号调度

#### Scenario: Redis 不可达时的启动行为

- **WHEN** Redis 暂时不可达但 SQLite 文件存在且完好
- **THEN** 服务启动流程在 Redis 连接阶段失败（保持现有行为），但 SQLite 数据保持完整；Redis 恢复后服务重启可继续运行

#### Scenario: SQLite 文件损坏时的启动行为

- **WHEN** `data/metadata.db` 存在但损坏（无法通过 SQLite 完整性自检）
- **THEN** 进程在启动阶段以明确错误信息指向该文件并以非零状态码退出；禁止静默新建空库覆盖原文件

---

### Requirement: Redis serves only as cache and hot state

系统 SHALL 将 Redis 限定为以下职能：元数据读缓存（read-through）、实时并发计数、限流窗口、粘性会话、usage 实时累计、API Key 统计累加（待 flush）。Redis 不再作为任何主数据的唯一存储位置。

#### Scenario: 读路径的缓存回填

- **WHEN** `auth` 中间件查询 API Key 哈希索引且 Redis 缓存 miss
- **THEN** 系统从 SQLite 读取 → 异步回写 Redis（短 TTL，例如 60 秒）→ 返回给调用方

#### Scenario: 缓存失效语义

- **WHEN** API Key 或账号被修改或删除
- **THEN** 系统在事务提交后主动失效对应的 Redis 缓存键（`DEL apikey:hash:{hash}`、`DEL apikey:{id}:cache`、`DEL account:{id}:cache`）

#### Scenario: Redis 完全丢失后的自愈

- **WHEN** Redis 全量数据丢失，服务冷启动
- **THEN** 缓存层为空、所有查询首次 miss → SQLite；并发计数、限流窗口、会话绑定从零开始，属预期行为

---

### Requirement: API Key hot-path lookup uses SQLite with Redis cache

系统 SHALL 支持通过 SHA-256 哈希在 O(log N) 时间内定位 API Key 记录。哈希列必须建立 UNIQUE 索引。认证热路径优先命中 Redis 缓存；缓存 miss 时回退到 SQLite 查询且耗时 < 2 ms（prepared statement + 索引）。

#### Scenario: 认证命中缓存

- **WHEN** 请求携带 `cr_` 前缀 API Key，其 SHA-256 哈希已在 Redis 缓存中
- **THEN** 认证完成耗时应 < 2 ms（Redis 单次 GET）

#### Scenario: 认证缓存 miss

- **WHEN** 请求携带有效 API Key 但缓存已过期或被失效
- **THEN** 单次 `SELECT` 从 SQLite 命中对应行；认证完成，并异步回写缓存

#### Scenario: 认证不存在的 Key

- **WHEN** 请求携带的哈希在 SQLite 中不存在
- **THEN** 返回 401；可选地写入短 TTL 的 "negative cache" 避免暴力探测击穿 SQLite

---

### Requirement: API Key usage counters are Redis-backed with periodic SQLite flush

系统 SHALL 把每请求对 API Key 的累计统计（`last_used_at` / `request_count` / `total_cost`）记录到 Redis 的 `apikey:runtime:{id}` hash；后台 flusher 以 `SQLITE_STATS_FLUSH_INTERVAL`（默认 30 秒）为间隔批量写入 SQLite。

#### Scenario: 正常请求后累加

- **WHEN** 一个请求完成并产生 cost
- **THEN** 系统对对应 `apikey:runtime:{id}` 执行 `HINCRBY request_count 1`、`HINCRBYFLOAT total_cost <cost>`、`HSET last_used_at <ts>`，不直接写 SQLite

#### Scenario: flusher 成功路径

- **WHEN** flusher 定时任务触发
- **THEN** 系统读取所有 `apikey:runtime:*`，在单个 SQLite 事务中批量 UPDATE `api_keys` 表，成功后原子扣减 Redis 已 flush 的值（避免重复累加）

#### Scenario: flusher 异常

- **WHEN** flusher 批处理失败（SQLite 写入失败）
- **THEN** 不清除 Redis 侧累计值；下次 flush 继续尝试；错误写入 `logs/sqlite-flush-error.log`

#### Scenario: 进程优雅关闭

- **WHEN** 服务收到 `SIGTERM` / `SIGINT`
- **THEN** 在关闭 SQLite 连接前执行一次同步 flush，确保关闭窗口内的累计值落盘

---

### Requirement: Account platform data is unified in one accounts table

系统 SHALL 将 11 个平台（Claude、Claude Console、Gemini、OpenAI、Bedrock、Azure OpenAI、CCR、Droid、OpenAI Responses、Gemini API、以及后续新增平台）的账号数据统一存储在 `accounts` 表中，通过 `platform` 列区分。平台独有字段放入 `config` JSON 列。

#### Scenario: 按平台列表账号

- **WHEN** 管理后台请求"列出所有 Claude 账号"
- **THEN** 系统执行 `SELECT * FROM accounts WHERE platform = 'claude' ORDER BY created_at DESC`，返回与原 Redis 实现等价的列表

#### Scenario: 跨平台查找账号

- **WHEN** 调度器根据 `accountId` 查找账号但不知其 platform
- **THEN** 系统可通过 `SELECT * FROM accounts WHERE id = ?` 单次命中

#### Scenario: 新增平台不需改表结构

- **WHEN** 未来新增一个平台（例如 "claude-v6"）
- **THEN** 仅需在业务层新增 `ClaudeV6AccountService`；`accounts` 表结构不变；平台特有配置走 `config` JSON 列

---

### Requirement: Account runtime fields stay in Redis

系统 SHALL 将账号的高频变更字段（`lastUsedAt`、`lastError`、`errorCount`、`sessionWindowStart`、`sessionWindowEnd` 等）保留在 Redis `account:runtime:{id}` hash，不落入 SQLite。SQLite 仅持久化管理员态字段（`name` / `description` / `status` / `proxy` / `credentials` / `config`）。

#### Scenario: 管理员修改账号状态

- **WHEN** 管理员在后台把账号 `status` 从 `active` 改成 `banned`
- **THEN** 系统在 SQLite 中 UPDATE accounts 相应行，失效相关缓存；`account:runtime:{id}` 不受影响

#### Scenario: 调度器更新 lastUsedAt

- **WHEN** 调度器使用某账号发起上游请求
- **THEN** 系统更新 `account:runtime:{id}` 中的 `lastUsedAt`；SQLite 不产生写操作

#### Scenario: Redis 丢失导致的 runtime 信息清空

- **WHEN** Redis 被清空
- **THEN** 所有账号的 `lastUsedAt` / `errorCount` 等重置为未知；不影响账号本身的存在性和可用性

---

### Requirement: Token credentials persist in SQLite with encryption preserved

系统 SHALL 把账号的 OAuth / API 凭据（`accessToken`、`refreshToken`、`expiresAt` 等）加密后存入 `accounts.credentials` JSON 列，加密算法与密钥管理保持与当前 `src/utils/crypto.js` 一致，迁移过程不重新加密、不轮换密钥。

#### Scenario: Token 刷新成功

- **WHEN** token 刷新流程完成
- **THEN** 系统在 SQLite 事务中更新 `credentials`，使用现有 AES 加密；不写明文；不输出完整 token 到日志

#### Scenario: 迁移脚本保留原密文

- **WHEN** 迁移脚本从 Redis 读取账号数据
- **THEN** `accessToken` / `refreshToken` 字段的密文原样写入 SQLite，不做解密再加密的二次处理

#### Scenario: SQLite 备份文件的加密保证

- **WHEN** 管理员拷贝 `data/metadata.db` 作为备份
- **THEN** 备份文件中所有凭据字段仍为密文；需同时保护 `ENCRYPTION_KEY` 环境变量

---

### Requirement: Tag storage migrates to relational tables

系统 SHALL 把全局 tag 列表与 key-tag 关联迁到关系表：`tags(name PRIMARY KEY, created_at)` 与 `api_key_tags(api_key_id, tag_name, PRIMARY KEY (api_key_id, tag_name))`。标签操作（创建、列出、分配、取消分配）走关系查询。

#### Scenario: 创建带 tag 的 API Key

- **WHEN** 管理员创建 API Key 并指定 tag 列表 `["prod", "team-a"]`
- **THEN** 系统在单个事务中插入 `api_keys` 行、`INSERT OR IGNORE INTO tags` 两次、`INSERT INTO api_key_tags` 两次

#### Scenario: 删除 API Key 的级联清理

- **WHEN** 管理员删除一个 API Key
- **THEN** `api_key_tags` 中相关行由外键 `ON DELETE CASCADE` 自动清理；`tags` 全局表不动（即便某 tag 已无关联）

#### Scenario: 按 tag 筛选 API Key

- **WHEN** 管理后台请求"列出所有带 tag = prod 的 API Key"
- **THEN** 通过 `JOIN api_key_tags` 单次查询完成，返回与原 Redis scan 等价的结果

---

### Requirement: usage_daily table archives Redis usage indices at day boundary

系统 SHALL 新增 `usage_daily(scope, id, model, date, request_count, input_tokens, output_tokens, cost)` 表；每日 UTC 00:10 的 cron 任务把前一天 Redis 中 `usage:*:{date}` 聚合后写入此表；Redis 的实时 usage 计数保持不变。

#### Scenario: 日终归档成功

- **WHEN** cron 任务在 UTC 00:10 触发，前一天数据完整
- **THEN** 系统把 `usage:{scope}:{id}:{date}` 全量扫描、按 (scope, id, model, date) 聚合、批量 `INSERT OR REPLACE INTO usage_daily`

#### Scenario: 归档失败重试

- **WHEN** 当日归档因故失败（例如 SQLite 事务冲突）
- **THEN** 失败记录写入 `logs/usage-archive-error.log`；次日归档任务需尝试补跑前一天

#### Scenario: 报表查询历史

- **WHEN** 用户请求"过去 30 天每日成本"
- **THEN** 系统优先走 `usage_daily` 聚合查询；当日数据合并 Redis 实时值

---

### Requirement: Metadata backend is switchable via environment variable

系统 SHALL 通过环境变量 `METADATA_BACKEND` 选择元数据后端实现：`redis`（legacy，默认）或 `sqlite`（新实现）。切换仅需重启进程；配置不一致时必须启动失败。

#### Scenario: 默认后端

- **WHEN** `METADATA_BACKEND` 未设置或为 `redis`
- **THEN** 系统使用现有 Redis 存储路径（向后兼容）

#### Scenario: 切换到 SQLite

- **WHEN** `METADATA_BACKEND=sqlite` 且 `data/metadata.db` 存在且通过自检
- **THEN** 所有 Repository 走 SQLite 实现；启动日志明确输出 "metadata backend: sqlite"

#### Scenario: 配置非法

- **WHEN** `METADATA_BACKEND=postgres` 或其他非法值
- **THEN** 系统以明确错误退出，提示合法值列表

---

### Requirement: Migration script preserves all Redis metadata to SQLite

系统 SHALL 提供 `scripts/migrate-redis-to-sqlite.js` 一次性迁移脚本，把现有 Redis 中的账号、API Key、tag 全量读入 SQLite；迁移过程必须提供 dry-run 模式与迁移后的对比报告。

#### Scenario: dry-run 模式

- **WHEN** 管理员运行 `node scripts/migrate-redis-to-sqlite.js --dry-run`
- **THEN** 系统读取 Redis 数据、打印将要写入的 SQLite 行数与样本，但不真正写入；用于迁移前 preview

#### Scenario: 正式迁移

- **WHEN** 管理员运行 `node scripts/migrate-redis-to-sqlite.js`
- **THEN** 系统在单个事务中写入 SQLite，完成后打印对比报告：Redis 源计数 vs SQLite 目标计数 vs 随机 N 条双读比对

#### Scenario: 重复迁移的幂等

- **WHEN** 迁移脚本被重复运行
- **THEN** 已存在的记录以 SQLite 数据为准（`INSERT OR IGNORE` 或跳过），脚本不破坏已有 SQLite 数据

#### Scenario: Redis 数据保留

- **WHEN** 迁移脚本完成
- **THEN** Redis 源数据不被自动删除；管理员需在观察期后运行独立的 `scripts/cleanup-redis-metadata.js` 才会清理

---

### Requirement: SQLite file permissions and placement follow security baseline

系统 SHALL 把 SQLite 数据库文件放在 `data/metadata.db`，文件权限 `0600`，所属用户与服务进程一致；`data/` 目录权限 `0700`。相关 WAL 与 SHM 文件由 SQLite 自动管理，位于同一目录。

#### Scenario: 首次启动创建文件

- **WHEN** `METADATA_BACKEND=sqlite` 且 `data/metadata.db` 不存在
- **THEN** 系统创建该文件并设置权限为 `0600`；初始化 schema；打印 "metadata db created" 日志

#### Scenario: 权限不当的启动

- **WHEN** `data/metadata.db` 存在但权限宽松（例如 `0644`）
- **THEN** 系统在启动阶段输出警告；可选地自动修正为 `0600`

#### Scenario: Docker / 容器部署

- **WHEN** 项目以 Docker 方式部署
- **THEN** `data/` 目录必须作为持久化 volume 挂载；否则每次容器重建都会丢失 SQLite 文件（文档必须明确警告此风险）

---

### Requirement: Admin UI exposes a read-only storage health panel

系统 SHALL 在管理后台（`SettingsView.vue`）提供一个"存储健康"只读面板，并通过 `GET /admin/storage/status` 接口为其供数。该接口 SHALL 要求管理员身份认证，不得暴露任何敏感内容（如加密密钥、token 明文、完整文件路径之外的内容）。

#### Scenario: 未登录访问被拒绝

- **WHEN** 未携带有效管理员 session 或 token 访问 `GET /admin/storage/status`
- **THEN** 响应 401

#### Scenario: 响应内容（Redis 后端）

- **WHEN** 管理员登录后访问接口，且 `METADATA_BACKEND=redis`
- **THEN** 响应 200，JSON 至少包含：
  - `backend: "redis"`
  - `redis: { connected: true, usedMemory: <bytes>, dbSize: <N>, lastSaveAt: <ts> }`（字段从 Redis INFO 提取）
  - `sqlite` 字段不出现或为 `null`

#### Scenario: 响应内容（SQLite 后端）

- **WHEN** 管理员登录后访问接口，且 `METADATA_BACKEND=sqlite`
- **THEN** 响应 200，JSON 至少包含：
  - `backend: "sqlite"`
  - `sqlite: { fileSizeBytes, walSizeBytes, journalMode, integrityCheck: "ok"|"failed", rowCounts: { apiKeys, accounts, tags, usageDaily } }`
  - `flusher: { lastSuccessAt, lastErrorAt, lastErrorMessage, pendingRuntimeKeyCount }`
  - `backup: { lastBackupAt, lastBackupSizeBytes, backupDir }` (文件元数据，不列出完整备份文件列表)
  - `redis: { connected, usedMemory, dbSize }`（继续返回，因为 Redis 仍在用）

#### Scenario: 前端面板渲染

- **WHEN** 管理员打开系统设置页面
- **THEN** 在现有设置卡片下方出现 "存储健康" 卡片；实时刷新频率 ≥ 10 秒；完全兼容暗黑模式；遵循项目既有的玻璃态 / Apple 风格

#### Scenario: SQLite 完整性自检失败时

- **WHEN** `PRAGMA integrity_check` 返回非 `ok`
- **THEN** 响应中 `sqlite.integrityCheck` 字段反映失败信息；前端面板以醒目颜色（遵循暗黑/亮色两套方案）标示健康异常；不影响其他字段的返回

#### Scenario: flusher 状态外显

- **WHEN** flusher 最近 N 次（例如 5 次）全部失败
- **THEN** 面板在 "flusher" 区块显示告警标记，并在鼠标 hover 时展示最近一次错误的 truncated message（完整错误只进日志）

---

### Requirement: Single-instance deployment is mandatory

系统 SHALL 明确声明启用 SQLite 后端时**仅支持单实例部署**。若检测到 `METADATA_BACKEND=sqlite` 且存在多实例部署迹象（例如 `pm2 cluster` 或多个进程争用同一 `metadata.db`），系统 SHALL 在启动日志中输出明确警告。

#### Scenario: 文件锁冲突

- **WHEN** 第二个进程试图以写模式打开同一 `metadata.db`
- **THEN** better-sqlite3 会因 busy-timeout 抛错；此时不自动重试超过 5 次，记录详细错误后退出

#### Scenario: 文档要求

- **WHEN** 项目文档或 install.sh 说明中涉及 `METADATA_BACKEND=sqlite` 启用
- **THEN** 必须明确说明 "仅支持单实例"；推荐多实例需求者保持 `METADATA_BACKEND=redis` 或使用外部数据库（未来变更）
