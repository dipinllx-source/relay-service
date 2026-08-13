## 1. backupService 类型分流导出

- [x] 1.1 `src/services/backupService.js` 的 ACCOUNT_GROUPS 每项增加 `storageType`（`bedrock` 为 `'string'`，其余 10 类为 `'hash'`），与 `src/storage/metadataSync.js` 逐字对齐
- [x] 1.2 `dumpHashGroup` 改造为 `dumpEntityGroup(client, keys, storageType)`：hash 走 `hgetall`（条目形态 `{__key, ...fields}` 不变）；string 走 `get`，条目形态 `{__key, __type:'string', value}`；`get` 返回 null 的 key 跳过
- [x] 1.3 逐实体 try/catch 错误隔离：单条失败 `logger.warn` 并计入返回的 `errors` 计数，不向上抛
- [x] 1.4 `BACKUP_VERSION` 2.0 → 2.1；`metadata` 增加 `backend`（取 `config.metadata.backend`）
- [x] 1.5 新增 tags 导出：`apikey:tags:all`（set → 数组）与每个 tag 的 `apikey:tag:<tag>`（set → keyId 数组），落 `backup.data.tags = { all: [...], byTag: { <tag>: [...] } }`；无任何 tag 时输出 `{ all: [], byTag: {} }`

## 2. backupService 类型分流导入

- [x] 2.1 `restoreHashItems` 改造为 `restoreEntityItems`：条目含 `__type==='string'` → 校验 value 为字符串后 `client.set(key, value)`；否则按原 hash 逻辑 `hset`
- [x] 2.2 冲突跳过语义维持 `client.exists(key)` 判断（string/hash 同等对待），跳过计数不变
- [x] 2.3 逐实体 try/catch 错误隔离，计入 `stats.<bucket>.errors`
- [x] 2.4 tags 导入：`sadd('apikey:tags:all', ...all)` 与各 `apikey:tag:<tag>` 集合合并写回（set 天然幂等）
- [x] 2.5 兼容 2.0 备份：无 `__type` 条目全部按 hash 处理（回归断言写入 6.4）

## 3. 还原后贯通 SQLite 与索引/缓存清理

- [x] 3.1 `importBackup` 末尾：`config.metadata.backend === 'sqlite'` 时 `await require('../storage/metadataSync').reconcileAll()`；reconcile 失败不吞错，抛出使导入响应 500 可见（数据未落库必须显式失败）
- [x] 3.2 删除各账户前缀与 apikey 的 `<index>:empty` 空标记键（`SCAN <prefix>:index:empty` 与 `apikey:index:empty`）
- [x] 3.3 `SCAN` 删除 `account:cache:*` 与 `apikey:cache:*`（read-through 缓存主动失效）
- [x] 3.4 `src/routes/admin/backup.js` 的 import 响应在 `data` 中附 `note`：建议重启服务重建 apikey 索引（文案常量，便于前端展示）

## 4. metadataSync 空 Redis 护栏

- [x] 4.1 `src/storage/metadataSync.js` 的 `reconcileAll` 开头：统计全部 11 前缀实体 key + `apikey:` 实体 key 总数
- [x] 4.2 实体总数为 0 且 SQLite `accounts`+`api_keys` 行数 > 0 时：跳过本轮全部删除对账（直接返回，upsert 也无可做），`logger.error('🛑 metadataSync: Redis 实体为 0 但 SQLite 非空，疑似 Redis 被清空，本轮跳过删除对账')`
- [x] 4.3 护栏为每轮独立判断，不持久化状态；Redis 恢复数据后自动恢复正常对账

## 5. SQLite 文件级灾备闭环

- [x] 5.1 新增 `scripts/restore-metadata.js`：入参 `--input=<file>`；`PRAGMA integrity_check` 校验备份文件；检测 relay-app 运行中（`systemctl is-active relay-app`）则拒绝并提示先停服；覆盖前 `cp data/metadata.db data/metadata.db.pre-restore.<ts>`；复制后提示启动命令
- [x] 5.2 `package.json` 增加 `"data:restore": "node scripts/restore-metadata.js"`
- [x] 5.3 `scripts/backup-metadata.js` 增加保留策略：备份成功后删除超出最近 14 份的旧文件（按文件名时间戳排序）
- [x] 5.4 部署 systemd timer：`relay-backup.timer`（每日）+ `relay-backup.service`（Type=oneshot，ExecStart 跑 `npm run data:backup`），`systemctl enable --now`；单元文件内容记入 README
- [x] 5.5 README（或 docs 快速开始）增补「灾备与恢复」小节：文件级（data:backup/data:restore）与条目级（Web 导出/导入）两条路径的适用场景、命令与恢复后动作

## 6. 服务器实测验证（全部在 43.110.32.63 执行）

- [x] 6.1 WRONGTYPE 复现与消除：临时 `set bedrock_account:verify-uuid '{"id":"verify"}'` → 旧代码导出 500（基线已确认）→ 新代码导出 200 且 `data.accounts.bedrock` 含该条（`__type:'string'`）→ 删除临时 key
- [x] 6.2 回环导入：导出文件原样 POST import，期望全部 skipped、errors=0；`GET /admin/backup/summary` 计数与 SQLite 行数一致
- [x] 6.3 bedrock 往返：经管理 API 建一个临时 bedrock 账户 → 导出 → 删除该账户 → 导入 → `bedrockAccountService.getAccount` 能读出（get+JSON.parse 路径）→ 清理
- [x] 6.4 2.0 兼容：构造一份 `metadata.version='2.0'` 的备份（去掉 `__type` 字段）导入，全部按 hash 处理不报错
- [x] 6.5 护栏演练：`redis-cli flushdb` 前导出备份 → flushdb → 等待一轮对账（≤15s）→ 断言 SQLite 行数不变且日志出现护栏告警 → 导入备份 → reconcile 恢复数据 → 断言 Redis 实体与 SQLite 一致
- [x] 6.6 restore 脚本演练：`npm run data:backup` 生成新备份 → 停服 → `npm run data:restore --input=<file>` → 起服 → summary 计数一致
- [x] 6.7 回归：`/admin/backup/summary` 与存储健康页 UI 展示正常；accounts/apikeys 的 CRUD 冒烟（建一个测试 apikey 再删）

## 7. 收尾

- [x] 7.1 `cd web/admin-spa && npx eslint --fix && npx vite build`（如前端无改动则跳过）；后端 `npx eslint src/services/backupService.js src/storage/metadataSync.js scripts/restore-metadata.js`
- [x] 7.2 `git commit`（遵循仓库提交风格：`fix(backup): ...`），`systemctl restart relay-app` 换代码
- [x] 7.3 版本号升级（沿用发布惯例 `chore: 版本号升级为 x.y.z`）——是否发布 tag 由用户决定
- [x] 7.4 标记 tasks 完成、归档变更（openspec archive 惯例：移入 openspec/changes/archive/ 并落 specs/backup-restore/spec.md）
