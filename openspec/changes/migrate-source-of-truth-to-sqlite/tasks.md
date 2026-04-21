# Tasks: migrate-source-of-truth-to-sqlite

> 任务粒度按"能独立 review、能独立回滚"划分。阶段之间有依赖；阶段内部允许并行。

## 阶段 0：依赖与骨架

- [x] 0.1 在 `package.json` 新增 `better-sqlite3` 依赖（生产）；`npm install` 通过
- [x] 0.2 在 `.env.example` 新增 `METADATA_BACKEND`（默认 `redis`）、`SQLITE_PATH`（默认 `data/metadata.db`）、`SQLITE_STATS_FLUSH_INTERVAL`（默认 `30`）
- [x] 0.3 在 `config/config.js` 与 `config/config.example.js` 同步新增 `metadata` 配置块（`backend` / `sqlitePath` / `statsFlushInterval`）
- [x] 0.4 创建 `src/storage/sqlite.js`：导出单例 `db`，执行 WAL + synchronous=NORMAL + foreign_keys=ON 初始化 pragma
- [x] 0.5 创建 `src/storage/schema.js`：定义 DDL，启动时 idempotent 执行建表；支持简单 schema version 记录（`_schema_version` 表）
- [x] 0.6 `data/` 目录在启动时自动 mkdir；权限强制 `0700`；`metadata.db` 创建后强制 `0600`
- [x] 0.7 `.gitignore` 增加 `data/metadata.db*`、`data/backup/`
- [x] 0.8 启动日志明确输出当前 `metadata backend: <redis|sqlite>`

## 阶段 1：Repository 接口层

- [x] 1.1 定义 `src/storage/repositories/IApiKeyRepository.js`（JSDoc 签名）
- [x] 1.2 定义 `src/storage/repositories/IAccountRepository.js`
- [x] 1.3 定义 `src/storage/repositories/ITagRepository.js`
- [x] 1.4 实现 `RedisApiKeyRepository`（包装现有 `redis.js` 账号/key 方法，零业务改动）
- [x] 1.5 实现 `RedisAccountRepository`、`RedisTagRepository`（同上）
- [x] 1.6 实现 `src/storage/repositories/index.js`：读 `METADATA_BACKEND` 装配对应实现，导出单例

## 阶段 2：SQLite 实现 - API Key

- [x] 2.1 DDL：`api_keys` 表 + 索引（Hybrid schema：核心列 + data JSON）
- [x] 2.2 DDL：`tags`、`api_key_tags` 表 + 外键 ON DELETE CASCADE
- [x] 2.3 `SqliteApiKeyRepository.findByHash(hash)`（prepared statement + UNIQUE index）
- [x] 2.4 `SqliteApiKeyRepository.findById(id)`（保持 Redis hgetall 返回 `{}` 语义）
- [x] 2.5 `SqliteApiKeyRepository.save`（首次 INSERT 要求 hashedKey；update 可省）
- [x] 2.6 save 字段级合并：data JSON merge，保留未传字段（与 Redis hset 语义一致）
- [x] 2.7 `SqliteApiKeyRepository.delete(id)`（外键 ON DELETE CASCADE 自动清理 api_key_tags）
- [x] 2.8 `SqliteApiKeyRepository.getAll()` / `scanIds()`
- [x] 2.9 `SqliteTagRepository.{addTag, removeTag, listTags}`
- [x] 2.10 单元测试 `tests/storage/sqliteApiKeyRepository.test.js`（13 test cases，全绿）

## 阶段 3：SQLite 实现 - Account

- [x] 3.1 DDL：`accounts` 表（Hybrid schema：id / platform / name / status / data JSON）
- [x] 3.2 `SqliteAccountRepository.findById(platform, id)`
- [x] 3.3 `SqliteAccountRepository.getAllByPlatform(platform)`
- [x] 3.4 `SqliteAccountRepository.save(platform, id, data)` — credentials 密文直存 data JSON
- [x] 3.5 save 字段级合并（data JSON merge）
- [x] 3.6 `SqliteAccountRepository.delete(platform, id)`
- [x] 3.7 单元测试：覆盖 10 个平台的 CRUD 流程（与 proposal/spec 一致）

## 阶段 4：Cache 装饰器

- [x] 4.1 `CachingApiKeyRepository`：装饰 inner 实现，read-through 回写 Redis
- [x] 4.2 `findByHash` / `findById` 走双缓存键（`apikey:cache:hash:{hash}` + `apikey:cache:id:{id}`）TTL 60s
- [x] 4.3 `save` / `delete` 失效 id 与 hash 两个 cache；hash 变更时失效旧 hash
- [x] 4.4 `CachingAccountRepository`（key `account:cache:{platform}:{id}`，同样模式）
- [x] 4.5 `repositories/index.js` sqlite 分支：`Caching(Sqlite(db), redis)`；失败回退 Redis 并告警
- [x] 4.6 契约测试：`tests/storage/cachingRepositories.test.js` 覆盖缓存命中 / 失效 / 腐败 payload 穿透（10 cases 全绿）

## 阶段 5：API Key Runtime 统计（Redis + flush）

- [ ] 5.1 定义 Redis schema：`apikey:runtime:{id}` hash（`request_count` / `total_cost` / `last_used_at`）
- [ ] 5.2 在 `apiKeyService.incrementUsage()` 改为写 `apikey:runtime:{id}`，不再写 SQLite
- [ ] 5.3 实现 `src/storage/flusher.js`：定时任务；读所有 `apikey:runtime:*`，在 SQLite 事务中批量 UPDATE `api_keys`
- [ ] 5.4 Flusher 成功后原子扣减 Redis（`HINCRBYFLOAT` 负值）
- [ ] 5.5 Flusher 异常写 `logs/sqlite-flush-error.log` 且不清零 Redis
- [ ] 5.6 进程 SIGTERM/SIGINT 触发 graceful flush（同步）
- [ ] 5.7 `GET /admin/apikey/{id}` 返回值合并 SQLite 快照 + Redis 增量
- [ ] 5.8 单元测试：flusher 的幂等性、异常重试、进程优雅退出

## 阶段 6：业务层切换

> 这一阶段涉及改动多个现有文件，每个子任务独立 commit。

- [ ] 6.1 `apiKeyService.js`：所有 `redis.getApiKey` / `redis.setApiKey` / `redis.findApiKeyByHash` 等调用替换为 `apiKeyRepo` 方法
- [ ] 6.2 `apiKeyService.js`：tag 相关调用替换为 `tagRepo`
- [ ] 6.3 `middleware/auth.js`：API Key lookup 走 `apiKeyRepo.findByHash`
- [ ] 6.4 `claudeAccountService.js`：所有账号 CRUD 替换为 `accountRepo`；runtime 字段保留 Redis
- [ ] 6.5 其余 10 个 `*AccountService.js` 做同样替换（可并行拆 PR）
- [ ] 6.6 `routes/admin/*.js`：直接调 `redis.js` 的地方改为 service 层（不要跳过 service）
- [ ] 6.7 全局搜索 `redis.getApiKey` / `redis.getClaudeAccount` 等，确保无残留
- [ ] 6.8 `redis.js` 中已被 repository 取代的账号/key 方法标记为 `@deprecated`；保留以供 legacy backend 使用

## 阶段 7：usage 日终归档

- [ ] 7.1 DDL：`usage_daily` 表 + 索引
- [ ] 7.2 实现 `src/services/usageArchiveService.js`：扫描 `usage:{scope}:{id}:{date}` → 聚合 → 批量 INSERT OR REPLACE
- [ ] 7.3 注册 cron：UTC 00:10 每日执行（`node-cron`，现有调度器）
- [ ] 7.4 失败重试：次日补跑前一天未归档数据
- [ ] 7.5 报表查询（`apiStats.js` / `dashboard.js`）历史走 `usage_daily`，当日实时叠加 Redis
- [ ] 7.6 单元测试：归档脚本幂等性、空数据、分片大量数据

## 阶段 8：迁移工具

- [ ] 8.1 `scripts/migrate-redis-to-sqlite.js`：读 Redis 所有账号（按 platform）+ API Key + tag，批量写 SQLite
- [ ] 8.2 支持 `--dry-run` 模式：只打印计划，不写库
- [ ] 8.3 完成后输出对比报告：各类记录数 + 随机 10 条双读比对
- [ ] 8.4 迁移脚本幂等：重复运行不破坏 SQLite 现有数据
- [ ] 8.5 `scripts/rollback-sqlite-to-redis.js`：反向导出工具（应急）
- [ ] 8.6 `scripts/cleanup-redis-metadata.js`：观察期后清理 Redis 中已迁移的 hash；要求 `--confirm` 参数 + 明确提示
- [ ] 8.7 `npm run data:migrate` / `data:rollback` / `data:cleanup` 三个脚本入口

## 阶段 9：备份与运维

- [ ] 9.1 实现 `scripts/backup-metadata.js`：调用 SQLite `.backup` API，输出到 `data/backup/metadata-<timestamp>.db`
- [ ] 9.2 `npm run data:backup` 入口
- [ ] 9.3 `install.sh` 新增自动 nightly backup 的 cron 说明（可选配置）
- [ ] 9.4 文档：`docs/metadata-storage-guide/README.md`（备份、恢复、迁移、回滚步骤）
- [ ] 9.5 README.md 补充一段说明 metadata backend 切换的前后注意事项

## 阶段 10：Admin UI 存储健康面板（本变更范围内）

- [ ] 10.1 后端：新增 `GET /admin/storage/status` 只读接口（admin 鉴权），返回字段：
  - `backend: redis | sqlite`
  - `redis: { connected, usedMemory, dbSize, lastSaveAt }`
  - `sqlite: { fileSizeBytes, walSizeBytes, journalMode, integrityCheck, rowCounts }`（仅 backend=sqlite 时）
  - `flusher: { lastSuccessAt, lastErrorAt, lastErrorMessage, pendingRuntimeKeyCount }`
  - `backup: { lastBackupAt, lastBackupSizeBytes, backupDir }`
- [ ] 10.2 后端：`storageStatusService.js` 聚合上述字段（integrity check 缓存 60s 避免频繁执行）
- [ ] 10.3 前端：新增 `web/admin-spa/src/components/settings/StorageHealthSection.vue`
  - 放在 `SettingsView.vue` 下方，紧接现有 "HTTPS 状态" 卡片后
  - 玻璃态 / Apple 风格 / 暗黑模式完整支持
  - 每 10 秒刷新
- [ ] 10.4 前端：`http_apis.js` 增加 `getStorageStatus()`
- [ ] 10.5 前端：integrity check 失败或 flusher 连续失败时以告警色渲染
- [ ] 10.6 前端：文案国际化（中文主文案，现有项目无 i18n 框架则保持中文）
- [ ] 10.7 单测：`tests/storageStatusService.test.js`
- [ ] 10.8 组件测试：`StorageHealthSection` 的 loading / error / sqlite / redis 四种状态快照

## 阶段 11：观察期与清理

- [ ] 11.1 `METADATA_BACKEND=sqlite` 上线灰度：开发环境先跑 1 周，确认无报错
- [ ] 11.2 staging 环境切换并观察 3 天（metric：错误率、p99、flush 失败次数）
- [ ] 11.3 生产环境切换并观察 7 天
- [ ] 11.4 观察期结束，运行 `cleanup-redis-metadata.js` 清理 Redis 中已迁移的 hash
- [ ] 11.5 `redis.js` 中 `@deprecated` 方法在下一个变更中删除（本变更不删）

## 阶段 12：收尾

- [ ] 12.1 `npm run lint`、`npm run format:check`、`npm test` 全绿
- [ ] 12.2 `npm run cli status` 在两种 backend 下行为一致
- [ ] 12.3 更新 CLAUDE.md：新增"元数据存储"小节，说明 SQLite/Redis 职能边界
- [ ] 12.4 准备 PR 合并策略（按阶段拆多 PR 或一个大 PR，由实施时决策）
