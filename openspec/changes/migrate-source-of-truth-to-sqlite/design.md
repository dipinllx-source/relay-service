# Design: Metadata 迁移到 SQLite

## 架构分层

```
  ┌────────────────────── 业务层（services / routes）────────────────────┐
  │                                                                     │
  │   apiKeyService / *AccountService / 管理后台路由                    │
  │                      │                                              │
  │                      ▼ 依赖接口                                     │
  │   ┌─────────── Repository 接口 ────────────┐                        │
  │   │ IApiKeyRepository                      │                        │
  │   │ IAccountRepository<Platform>           │                        │
  │   │ ITagRepository                         │                        │
  │   └─────────── 实现选择 ──────────────────┘                        │
  │        │                      │                                     │
  │        ▼                      ▼                                     │
  │   ┌──────────┐        ┌────────────────────────┐                    │
  │   │ SQLite   │        │ Redis（cache-aside）   │                    │
  │   │ 源数据   │◀──────▶│ 热路径缓存             │                    │
  │   │ 事务     │ invalidate│                    │                    │
  │   └──────────┘        └────────────────────────┘                    │
  │                                                                     │
  └─────────────────────────────────────────────────────────────────────┘
                │                          │
                ▼                          ▼
      data/metadata.db (WAL)      共享/远端 Redis
      本地磁盘持久化              可丢失、可清空
```

## 决策点（来自探索模式对话的共识）

### ① API Key 累计统计：🅱 Redis 实时累加 + 定期 flush 到 SQLite

- `api_keys` 表仍拥有列 `last_used_at`、`total_cost`、`request_count`（source of truth 最终落地位置）
- 每请求更新走 Redis：
  - `HINCRBY apikey:runtime:{id} request_count 1`
  - `HINCRBYFLOAT apikey:runtime:{id} total_cost <delta>`
  - `HSET apikey:runtime:{id} last_used_at <unix_ms>`
- 后台 flusher 每 `SQLITE_STATS_FLUSH_INTERVAL`（默认 30 秒）：
  1. `SCAN` 所有 `apikey:runtime:*`
  2. 读出每个 hash 的累计值
  3. 一个事务内 `UPDATE api_keys SET request_count = request_count + ?, total_cost = total_cost + ?, last_used_at = MAX(last_used_at, ?) WHERE id = ?` 批量应用
  4. 成功后 `HINCRBY` 反向扣减（或 DELETE 后重建）——使用原子扣减避免计数窗口丢失
- 读路径：`GET /admin/apikey/{id}` 返回合并视图 = SQLite 快照 + Redis 实时增量

**崩溃窗口**：最多丢 30 秒内的累加（统计类可接受；计费对账时以日终归档为准）

**flush 策略细节**：
- 使用 `HGETALL` + pipeline 批量读
- flush 失败不清零 Redis（下次重试）
- 关闭进程时（SIGTERM）执行一次 graceful flush

**退路**：若 flush 异常频繁或观察到数据不一致，可把 `SQLITE_STATS_FLUSH_INTERVAL=0` 关闭 flusher、退化为每请求直写 SQLite（🅰 方案）；此退路通过 Repository 装饰器开关。

### ④ 账号字段拆分：🅰 稳定字段 SQLite，runtime 字段 Redis

**SQLite `accounts` 表字段**：
- `id` (TEXT PK)
- `platform` (TEXT NOT NULL)：`claude` / `claude-console` / `gemini` / `openai` / `bedrock` / `azure-openai` / `ccr` / `droid` / `openai-responses` / `gemini-api`
- `name`、`description`
- `status`：`active` / `banned` / `pending`（管理员态）
- `proxy` (JSON)
- `credentials` (JSON, 加密)：`refreshToken` / `accessToken` / `expiresAt` / OAuth 元数据等
- `config` (JSON)：平台独有配置（model mapping、region 等）
- `created_at`、`updated_at`

**Redis `account:runtime:{id}` hash（保持）**：
- `lastUsedAt`
- `lastError`、`errorCount`
- `sessionWindowStart`、`sessionWindowEnd`
- 所有每请求可能变更的字段

**字段拆分原则**：
- 管理员手动改的 → SQLite
- 每请求自动改的 → Redis

### ⑤ 账号 Token 凭据（accessToken/refreshToken/expiresAt）

- 走 SQLite `accounts.credentials` 列（JSON 加密字符串）
- 刷新时通过事务写入
- 加密方式保持现有 AES（`src/utils/crypto.js`），迁移时不动密钥

### ⑥ usage 明细：🅰 Redis 实时 + 日终归档

- Redis 继续承担 `usage:{scope}:{id}:{date}` 的高频 hincrby
- 新增 `SQLite usage_daily` 表：`(scope, id, model, date, request_count, input_tokens, output_tokens, cost)`
- 新增 cron：每天 UTC 00:10 执行 `flushUsageDaily()`
  - 扫描前一天的 Redis usage key
  - 批量 INSERT OR REPLACE 到 `usage_daily`
  - 可选：TTL Redis 中 90 天以前的明细（降低内存压力）
- 报表查询优先走 SQLite（历史），fall-back 到 Redis（当天实时）

### ⑦ 管理员凭据：🅰 继续 data/init.json

- 不迁移、不处理
- 理由：紧急恢复路径（文件可人工编辑、可 grep、可 backup）

### ⑧ 软删除：🅱 硬删除

- `DELETE FROM api_keys WHERE id=?` / `DELETE FROM accounts WHERE id=?`
- 不设 `deleted_at`、不保留历史
- 保持当前语义，避免查询路径处处加 `WHERE deleted_at IS NULL`

## SQLite Schema 初版

```sql
-- ─────────── api_keys ───────────
CREATE TABLE api_keys (
  id              TEXT PRIMARY KEY,
  hashed_key      TEXT NOT NULL UNIQUE,   -- SHA-256(apiKey) 做 auth lookup
  name            TEXT NOT NULL,
  description     TEXT,

  -- 权限与限制（从现有 apikey hash 平移）
  permissions     TEXT,                   -- JSON array
  allowed_models  TEXT,                   -- JSON array (可空 = 不限)
  blocked_models  TEXT,                   -- JSON array
  client_limits   TEXT,                   -- JSON

  -- 费用限制
  daily_cost_limit   REAL DEFAULT 0,
  monthly_cost_limit REAL DEFAULT 0,
  total_cost_limit   REAL DEFAULT 0,

  -- 并发（软阈值；实际扣减仍在 Redis）
  concurrency_limit  INTEGER DEFAULT 0,

  -- 过期
  expires_at      INTEGER,                -- unix ms (NULL = 不过期)

  -- 所属
  owner_user_id   TEXT,

  -- 累计统计（决策 ①🅰 每请求 UPDATE）
  last_used_at    INTEGER,                -- unix ms
  request_count   INTEGER NOT NULL DEFAULT 0,
  total_cost      REAL    NOT NULL DEFAULT 0,

  -- 状态
  status          TEXT NOT NULL DEFAULT 'active',   -- active | banned | expired

  -- 其他/未来扩展
  metadata        TEXT,                   -- JSON

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_api_keys_owner  ON api_keys(owner_user_id);
CREATE INDEX idx_api_keys_status ON api_keys(status);

-- ─────────── accounts ───────────
CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,
  platform        TEXT NOT NULL,
                  -- claude | claude-console | gemini | openai | bedrock
                  -- | azure-openai | ccr | droid | openai-responses
                  -- | gemini-api
  name            TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'active',

  proxy           TEXT,                   -- JSON (可空)
  credentials     TEXT,                   -- JSON 加密字符串（refreshToken 等）
  config          TEXT,                   -- JSON 平台独有配置

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_accounts_platform ON accounts(platform);
CREATE INDEX idx_accounts_status   ON accounts(status);

-- ─────────── tags ───────────
CREATE TABLE tags (
  name            TEXT PRIMARY KEY,
  created_at      INTEGER NOT NULL
);

-- ─────────── api_key_tags ───────────
CREATE TABLE api_key_tags (
  api_key_id      TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  tag_name        TEXT NOT NULL REFERENCES tags(name)   ON DELETE CASCADE,
  PRIMARY KEY (api_key_id, tag_name)
);
CREATE INDEX idx_api_key_tags_tag ON api_key_tags(tag_name);

-- ─────────── usage_daily ───────────（决策 ⑥🅰 归档目标）
CREATE TABLE usage_daily (
  scope           TEXT NOT NULL,          -- 'apikey' | 'account'
  id              TEXT NOT NULL,
  model           TEXT NOT NULL DEFAULT '',
  date            TEXT NOT NULL,          -- 'YYYY-MM-DD' UTC
  request_count   INTEGER NOT NULL DEFAULT 0,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost            REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, id, model, date)
);
CREATE INDEX idx_usage_daily_date   ON usage_daily(date);
CREATE INDEX idx_usage_daily_scope  ON usage_daily(scope, id, date);
```

## Repository 接口

```js
// src/storage/repositories/IApiKeyRepository.js
//
// 纯接口约定（JSDoc / TS 风格）——所有实现都要满足同样的语义
//
// 实现：
//   SqliteApiKeyRepository         // 主存储（source of truth）
//   CachingApiKeyRepository        // 装饰器：Redis cache-aside + delegate
//
// 业务代码只依赖 repository 对象；入口处按配置组装。

class IApiKeyRepository {
  async create(apiKey)                   // 事务：写 api_keys + api_key_tags
  async findById(id)                     // 单行
  async findByHash(hashedKey)            // auth 热路径（UNIQUE index）
  async update(id, patch)                // 字段级更新
  async delete(id)                       // 事务：级联 tag
  async list({ ownerUserId, tag, status, limit, offset, keyword })
  async incrementUsage(id, { cost, lastUsedAt })   // 每请求调用
  async findByOwner(userId)

  // Tag
  async addTag(tagName)
  async removeTag(tagName)
  async listTags()
}
```

```js
// src/storage/repositories/IAccountRepository.js
class IAccountRepository {
  async create(platform, account)
  async findById(id)                     // 任意 platform
  async findByPlatformAndId(platform, id)
  async listByPlatform(platform)
  async update(id, patch)
  async delete(id)
}
```

**装饰器模式的价值**：业务代码写死依赖 `repo.findByHash(hash)`；底层可以是纯 SQLite，也可以套一层 Redis 缓存——切换只改装配点。

## 热路径性能

**读路径（auth 每请求）：**

```
  req → middleware/auth
        │
        ├─ Redis GET apikey:hash:<sha256>      ── hit: < 1ms
        │                                         miss ↓
        │
        ├─ SQLite SELECT * FROM api_keys WHERE hashed_key=?
        │                                         <1ms (prepared, indexed)
        │
        └─ SETEX apikey:hash:<sha256> 60 <JSON>    异步回写
```

**写路径（请求结束后累加统计）：**

```
  Redis HINCRBY apikey:runtime:{id} request_count 1          ── <1ms
  Redis HINCRBYFLOAT apikey:runtime:{id} total_cost <delta>  ── <1ms
  Redis HSET apikey:runtime:{id} last_used_at <ts>           ── <1ms
```

**后台 flusher（每 30 秒一次）：**

```
  SCAN apikey:runtime:*
  ↓
  pipeline HGETALL for all keys
  ↓
  BEGIN
    for each key:
      UPDATE api_keys SET request_count = request_count + ?,
                           total_cost = total_cost + ?,
                           last_used_at = MAX(last_used_at, ?)
                     WHERE id = ?
    原子扣减 Redis 已 flush 的量
  COMMIT
```

单机 QPS 上限：主路径只写 Redis，几乎不受 SQLite 影响；flush 是批量+事务，单次事务 UPDATE N 行（N = 活跃 key 数）通常 <100ms。

**SQLite 初始化参数**：

```js
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')        // 安全 + 快
db.pragma('busy_timeout = 5000')         // 并发等待上限
db.pragma('foreign_keys = ON')
db.pragma('cache_size = -8000')          // 8MB 页缓存
db.pragma('wal_autocheckpoint = 1000')
```

## 迁移策略：one-shot + 双读验证

**不做长期双写**——这会引入一致性窗口和额外代码路径。直接两阶段：

```
  阶段 A: 迁移脚本 scripts/migrate-redis-to-sqlite.js
  ─────────────────────────────────────────────────────
    1. 服务可以正常运行
    2. 脚本只读 Redis 全量数据 → 插入 SQLite
    3. 完成后打印对比报告：
       · Redis key 数量 vs SQLite 行数
       · 随机 N 条双读比对
    4. 不删除 Redis 数据
  
  阶段 B: 切换实现
  ─────────────────────────────────────────────────────
    1. 配置开关 METADATA_BACKEND=sqlite（默认仍是 redis）
    2. 重启服务，业务走 SQLite
    3. 观察期（24-72h）：监控报错率、性能指标、数据一致性
    4. 观察期结束若无异常，执行 scripts/cleanup-redis-metadata.js
       清理已迁移的 Redis hash（保留 cache / runtime / 计数）

  回滚：在观察期内，把配置改回 redis 并重启，即刻回到旧路径
       （前提：Redis 旧数据未清理）
```

**阶段 B 的切换开关实现**：

```js
// src/storage/repositories/index.js
const METADATA_BACKEND = process.env.METADATA_BACKEND || 'redis'

module.exports = {
  apiKeyRepo: METADATA_BACKEND === 'sqlite'
    ? new CachingApiKeyRepository(new SqliteApiKeyRepository(db), redis)
    : new RedisApiKeyRepository(redis),   // legacy adapter
  accountRepo: /* 同上 */,
  tagRepo: /* 同上 */,
}
```

legacy `RedisApiKeyRepository` 只是把现有 `redis.js` 的账号/key 方法包一层，零业务逻辑改动。

## 测试策略

- **单测**：每个 Repository 单独测，用 `:memory:` SQLite
- **契约测**：对 `IApiKeyRepository` 的所有实现跑同一组契约测试，保证语义一致
- **迁移脚本**：先 dry-run，fixture 覆盖所有 platform
- **集成测**：启动 Redis + SQLite，跑 `tests/integration/` 全流程

**已有测试改动最小化**：jest.mock 依然 mock `redis`；Repository 用真 `:memory:` SQLite。

## 备份与恢复

```
  备份:
    npm run data:backup
      → sqlite3 data/metadata.db ".backup 'data/backup/metadata-<ts>.db'"
      → 文件级 cp 亦可（WAL 模式需 checkpoint 后）

  恢复:
    1. 停服务
    2. cp backup.db → data/metadata.db
    3. 启服务（SQLite 启动自检）

  导出（人读）:
    sqlite3 data/metadata.db .dump > metadata.sql
```

## 文件位置与权限

```
  data/
    metadata.db              ← SQLite 主文件
    metadata.db-wal          ← WAL（运行时自动生成）
    metadata.db-shm          ← 共享内存（运行时自动生成）
    backup/
      metadata-2026-04-21.db
      ...
    init.json                ← 管理员（不迁）
    certs/                   ← HTTPS 证书（不迁）
```

- `data/metadata.db` 权限 `0600`，所属用户与服务进程一致
- 目录 `data/` 权限 `0700`
- `install.sh` 需增加 `data/metadata.db` 的权限设置

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 多实例部署导致数据分裂 | 中 | 高 | README + 启动日志明确警告；环境变量 `ALLOW_MULTI_INSTANCE=unsafe` 才允许绕过 |
| SQLite 文件损坏 | 低 | 高 | 备份命令 + 文档化策略 |
| flush 窗口内崩溃丢失计数 | 中 | 低 | 可配置间隔（默认 30s）；SIGTERM 触发 graceful flush |
| flusher 异常导致计数持续增长 | 低 | 中 | flush 失败告警；观测 `apikey:runtime:*` 增长速率 |
| 迁移脚本漏字段 | 中 | 高 | dry-run 模式 + 双读对比报告 |
| Redis 清理过早导致无法回滚 | 低 | 高 | 观察期结束前不提供清理脚本；清理脚本要求二次确认 |
| 加密密钥变化丢失 credentials | 低 | 高 | 迁移不触碰加密；复用现有 crypto 模块 |
| CRLF / JSON 格式差异 | 低 | 低 | 迁移脚本显式 `JSON.parse` / `JSON.stringify` |

## 已确认的范围决策

- **Admin UI"存储健康"面板**：纳入本变更（见阶段 10 任务）
  - `GET /admin/storage/status` 只读接口
  - `SettingsView.vue` 下新增 "存储健康" 卡片
  - 展示：backend / SQLite 文件大小 / 最近 backup / flusher 健康

## Open Questions（迁移完成前需确认）

1. `data/metadata.db` 是否需要在 Docker Compose 中显式声明 volume 路径（避免被 image layer 覆盖）
2. `install.sh` 中的备份策略是否需要改动（目前依赖 Redis dump.rdb）——本变更内会处理
