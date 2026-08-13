# backup-restore Specification

## Purpose

定义 relay 服务账户、API Key、tags 与管理员凭据的备份导出、导入还原能力，以及 SQLite 元数据层的文件级灾备能力。确保在 `METADATA_BACKEND=sqlite`（Redis 为写入热路径、SQLite 为持久镜像）的架构下，备份与还原链路完整、类型安全、可验证。

## Requirements

### Requirement: 导出必须覆盖全部实体类型且不因单条数据失败

备份导出 SHALL 覆盖全部 11 类账户前缀、`apikey:*` 实体、`apikey:hash_map`、tags 集合与管理员凭据。对以 JSON 字符串存储的实体（bedrock 账户），导出 SHALL 使用 `GET` 读取并标记 `__type: 'string'`；对其余 hash 实体 SHALL 使用 `HGETALL`。单条实体的读取失败 MUST NOT 导致整个导出失败，SHALL 记录 warn 日志并计入 errors 计数。

#### Scenario: 存在 bedrock 账户时导出成功
- **WHEN** Redis 中存在一个 `bedrock_account:<uuid>` 字符串型账户，管理员调用 `/admin/backup/export`
- **THEN** 响应 SHALL 为 200，备份 `data.accounts.bedrock` 中 SHALL 包含该账户条目且携带 `__type: 'string'`，MUST NOT 出现 WRONGTYPE 错误

#### Scenario: 单条实体损坏不阻断导出
- **WHEN** 某实体 key 的读取抛出异常
- **THEN** 导出 SHALL 继续处理其余实体并返回 200，errors 计数 SHALL 反映失败条数

### Requirement: 导入必须按实体类型回写并立即贯通 SQLite

备份导入 SHALL 按条目的 `__type` 标记选择写入方式：`string` 实体用 `SET`，hash 实体用 `HSET`。导入 SHALL 保持跳过冲突语义（key 已存在则跳过）。当 `METADATA_BACKEND=sqlite` 时，导入完成后 SHALL 立即触发一次 Redis→SQLite 对账，使还原数据不依赖异步对账窗口即可在 SQLite 层可见；并 SHALL 清理索引空标记与 read-through 缓存键。

#### Scenario: bedrock 账户往返还原
- **WHEN** 管理员导出含 bedrock 账户的备份、删除该账户、再导入备份
- **THEN** bedrock 账户 SHALL 以字符串形态写回 Redis，且经 `get + JSON.parse` 路径可读，SQLite `accounts` 表 SHALL 在对账后包含该行

#### Scenario: 还原后 SQLite 立即可见
- **WHEN** 在 sqlite backend 下导入一份含新 API Key 的备份
- **THEN** 导入响应返回前 SQLite `api_keys` 表 SHALL 已包含该条目

#### Scenario: 兼容 2.0 备份
- **WHEN** 导入 `metadata.version` 为 2.0 的备份文件
- **THEN** 所有条目 SHALL 按 hash 形态写回，MUST NOT 报格式错误

### Requirement: 删除对账必须有 Redis 清空护栏

metadataSync 的删除对账 SHALL 在以下条件下暂停：本轮 Redis 中全部账户与 API Key 实体 key 总数为 0，且 SQLite 中存在任何账户或 API Key 行。此时 SHALL 记录 error 级告警并跳过本轮删除对账。护栏 MUST 为每轮独立判断，Redis 恢复数据后对账 SHALL 自动恢复正常。

此外，删除对账 SHALL 采用两轮墓碑确认：实体首次被发现「SQLite 有、Redis 无」时 MUST NOT 立即删除，仅记入待删集合；下一轮对账仍缺失时才 SHALL 执行删除；期间 Redis 恢复该实体则 SHALL 撤销待删标记（消除轮初护栏检查与删除执行之间的 TOCTOU 竞态）。

#### Scenario: Redis 被清空不级联删除 SQLite
- **WHEN** Redis 被 flushdb 而 SQLite 中存在账户与 API Key 数据
- **THEN** 下一轮对账 MUST NOT 删除 SQLite 中的任何行，且日志 SHALL 出现护栏告警

#### Scenario: 清空发生在护栏检查之后（TOCTOU）
- **WHEN** flushdb 发生在某轮护栏检查通过之后、删除对账执行之前
- **THEN** 该轮 MUST NOT 删除任何 SQLite 行（首轮仅记墓碑），下一轮护栏 SHALL 拦截

#### Scenario: 正常删除延迟一轮生效
- **WHEN** 单个实体在 Redis 中被正常删除
- **THEN** SQLite 中对应行 SHALL 在其后第二轮对账内被删除

### Requirement: SQLite 文件级备份与还原闭环

`data:backup` SHALL 生成 SQLite 一致性备份并保留最近 14 份；`data:restore` SHALL 提供还原入口，还原前 SHALL 校验备份文件完整性（integrity_check）并拒绝在服务运行时覆盖，覆盖前 SHALL 保留当前数据库副本。

#### Scenario: 文件级还原恢复整机元数据
- **WHEN** 服务停止后执行 `data:restore --input=<备份文件>` 并重启服务
- **THEN** 账户、API Key、tags、usage_daily SHALL 恢复至备份时点状态

#### Scenario: 运行中拒绝还原
- **WHEN** relay-app 正在运行时执行 `data:restore`
- **THEN** 脚本 SHALL 拒绝执行并提示先停止服务
