## Context

`migrate-source-of-truth-to-sqlite`（stage 0-12）完成了 Repository 抽象与 SQLite 元数据层，但备份/还原链路被留在原地：

```
                 写入路径（现状）
 ┌──────────────┐   直写    ┌──────────────────┐  15s 对账  ┌─────────────┐
 │ *AccountSvc  │──────────▶│ Redis（11 前缀    │──────────▶│ SQLite      │
 │ apiKeyService│           │  hash/string 混存）│ metadata  │ metadata.db │
 └──────────────┘           └──────────────────┘   Sync     └─────────────┘
                                     ▲
                                     │ 只扫这里，且全按 hash 读
                            ┌────────┴────────┐
                            │ backupService   │  ← 8/6 WRONGTYPE 崩溃点
                            │ (Web 导出/导入)  │
                            └─────────────────┘
```

约束与事实：

- 单实例部署；Redis 6380 本机；SQLite WAL。
- 业务写路径仍直写 Redis（Repository 层目前无业务消费者），SQLite 由 metadataSync 单向对账维护。
- bedrock 账户 `client.set()` JSON 字符串；其余 10 类账户 hash；`apikey:<uuid>` hash；`apikey:hash_map` hash。
- 备份加密字段保留密文（与 ENCRYPTION_KEY 绑定），不脱敏、不解密——维持 fbb8f89 的既定策略。
- 管理员凭据真实源 data/init.json，运行时缓存 session:admin_credentials——维持现状。

## Goals / Non-Goals

Goals：

- 修复 Web 导出/导入的现网崩溃（bedrock WRONGTYPE），全部 11 类账户 + apikeys + tags + admins 可完整往返。
- 还原结果立即贯通 SQLite 层，不依赖 15 秒异步窗口。
- 消除「Redis 被清空 → SQLite 被删除对账清空」的级联数据丢失。
- 给 SQLite 文件级备份（data:backup）补上还原脚本与定时任务，使入口③成为真正的灾备底牌。

Non-Goals：

- 不把业务写路径迁移到 Repository 层（属于另一个变更的量级）。
- 不修复 data-transfer.js / data-transfer-enhanced.js 的平台覆盖缺口（标记 deprecated，避免维护两套格式）。
- 不改动备份的加密策略（仍保留密文、绑定当前 ENCRYPTION_KEY）。
- 不做跨实例/多机备份同步。

## Decisions

### D1：backupService 按 storageType 分流，而不是改用 Repository 层

备选：导出/导入改走 `getRepositories()`（SqliteAccountRepository 等），一步到位对齐目标架构。

选择：**维持直读 Redis + 按 storageType 分流**。理由：

- Repository 层目前没有任何业务消费者，其 save() 的字段映射（Redis hash 字段 → SQLite 列）是为 metadataSync 的对账场景设计的；直接拿来做 import 写入，等于把一条未经业务验证的路径放进恢复链路，风险高于收益。
- 还原写 Redis 后由 metadataSync 立即 reconcile 进 SQLite（D2），与现网正常写入的数据流完全一致——恢复出来的数据走的是生产同一条路。
- 改动面收敛在 backupService.js 一个文件内，回滚简单。

ACCOUNT_GROUPS 增加 `storageType` 字段，与 metadataSync 逐字对齐：

```js
// hash: hgetall / hset；string: get / set（value 为 JSON 字符串）
{ name: 'bedrock', prefix: 'bedrock_account:', storageType: 'string' }
// 其余 10 类 storageType: 'hash'
```

### D2：备份条目格式 2.1 —— `__type` 标记 string 实体

```jsonc
// hash 实体：维持 2.0 形态，向后兼容
{ "__key": "claude:account:<uuid>", "name": "...", "...": "..." }

// string 实体（bedrock）：新增 __type
{ "__key": "bedrock_account:<uuid>", "__type": "string", "value": "{\"id\":...}" }
```

- `BACKUP_VERSION` 2.0 → 2.1；metadata 增加 `backend` 字段（导出时的 METADATA_BACKEND）。
- 导入侧：条目含 `__type: 'string'` → `client.set(key, value)`；缺省 → 按 hash `hset`（即 2.0 备份直接可导入）。
- tag 键（见 D4）作为独立分组 `data.tags`，不混入 apiKeys/accounts。

### D3：逐实体错误隔离

导出与导入均改为逐条 try/catch：单条 WRONGTYPE / 解析失败记录 warn 并计入 `errors` 计数，不再让一条坏数据使整个备份 500。导出摘要与导入响应透出 errors 数。

### D4：tags 纳入备份范围

- 导出：`apikey:tags:all`（set，全部 tag 名）+ 每个 tag 的 `apikey:tag:<tag>`（set，keyId 列表）。
- 导入：sadd 原样写回；冲突跳过语义改为「keyId 已在集合中则跳过单个成员」，集合本身可合并。
- 现状 0 条数据，先保证管道正确，量起来后不丢。

### D5：还原后立即贯通 SQLite + 清理索引/缓存

importBackup 末尾，当 `config.metadata.backend === 'sqlite'` 时：

1. `await metadataSync.reconcileAll()` —— 复用现有对账逻辑，Redis → SQLite 立即落库（含 bedrock string 解析）。
2. 删除所有 `<prefix>:index:empty` 与 `apikey:index:empty` 类空标记（还原前可能已被打上空标记，TTL 1h 内会让 getAllIdsByIndex 直接返回 []）。
3. `SCAN` 删除 `account:cache:*` 与 `apikey:cache:*`（read-through 缓存 TTL 60s，主动失效避免还原后短暂读到旧缓存）。
4. 响应中提示「建议重启服务以重建 apikey idx（apiKeyIndexService 启动时 rebuild）」。

### D6：metadataSync 空 Redis 护栏

reconcileAll 开始时统计全部前缀实体 key 总数 + SQLite 行数：

```
IF redis 实体总数 === 0 AND sqlite(accounts+apikeys) > 0:
    跳过本轮全部「删除对账」（upsert 仍执行——此时也没有可 upsert 的）
    logger.error 告警：Redis 疑似被清空，已暂停删除对账，请人工确认
```

- 护栏只挡「删除」，不挡 upsert：Redis 恢复数据后对账自动恢复正常。
- 不做自动禁用/状态持久化：每轮独立判断，Redis 重新有数据即自愈。
- 已知的合法「删光」运维路径（如主动清库重来）会被告警打扰——可接受，宁可吵也不丢数据。

### D7：SQLite 文件级灾备闭环（入口③）

- 新增 `scripts/restore-metadata.js`（npm: `data:restore`）：
  1. 校验入参备份文件存在且 `PRAGMA integrity_check` 通过；
  2. 检测 relay-app 是否在运行，在运行则拒绝并提示 `systemctl stop relay-app`（避免 WAL 写入竞争）；
  3. 覆盖前先 `cp data/metadata.db data/metadata.db.pre-restore.<ts>`（保留现场）；
  4. 复制备份文件 → data/metadata.db，提示 `systemctl start relay-app`。
- `data:backup` 定时化：systemd timer 每日执行，保留最近 14 份（脚本内自清理）；timer 单元随部署落盘，纳入 manage.js/README 说明。
- README 增补「灾备与恢复」小节：两条恢复路径的取舍——
  - **文件级**（data:backup/data:restore）：整机元数据原样回档，含 usage_daily；要求同版本 schema。
  - **条目级**（Web 导出/导入）：跨版本兼容、可选范围、跳过冲突合并；适合部分恢复与迁移。

### D8：遗留 CLI 标记 deprecated

data-transfer.js / data-transfer-enhanced.js 顶部帮助文本与 README 标注 deprecated：只覆盖 claude+gemini、同为 hgetall 假设。指引用户使用 Web 端点或 data:backup/data:restore。不删除、不修复（存量运维脚本可能引用，删除是 breaking）。

## Risks / Trade-offs

- **R1 护栏误报**：人为清空 Redis 想重建时会被 D6 告警打扰。取舍：接受，数据安全第一。
- **R2 reconcileAll 同步执行耗时**：当前规模（30 keys / 5 accounts）毫秒级；若未来量级上来，import 响应会变慢。可接受，日志可观测。
- **R3 备份文件含密文与 admin 明文凭据（init.json）**：维持既有策略，文件本身是敏感物，下载走 admin 鉴权 + no-store。不在本变更范围变更。
- **R4 timer 部署遗漏**：systemd timer 不在 git 仓内，升级流程（upgradeService 的 git pull + build）不会带上它。timer 单元一次性手工部署并写入 README，与 relay-app.service 同等地位。

## Migration Plan

无数据迁移。部署顺序：

1. git pull + `systemctl restart relay-app`（代码生效）。
2. 部署 data:backup 的 systemd timer（一次性）。
3. 按 tasks.md 第 6 组跑服务器实测清单。

回滚：`git revert` + `systemctl restart relay-app`。备份文件 2.1/2.0 双向可导入，无格式不可逆。

## Open Questions

- 无（二轮排查已收敛；tags 当前 0 条但管道先行）。
