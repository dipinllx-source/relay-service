## 设计决策

### D1 索引补写的落点：`restoreEntityItems` 接受分组上下文，而非在外层循环补写

`restoreEntityItems` 目前被三处调用：apikey 实体、账户（按 `ACCOUNT_GROUPS` 循环）、以及未来的分组集合。三处的索引不只是 key 名不同，**形状本身不同构**：

| 通道 | 索引形态 | 写入入口 |
|---|---|---|
| 账户 | 单个集合 `<平台前缀>index` | `redisClient.addToIndex(indexKey, id)`（内含 `sadd` + `del <indexKey>:empty`） |
| API Key | 索引族：`apikey:idx:createdAt` / `apikey:idx:lastUsedAt` / `apikey:idx:name`（zset）、`apikey:idx:all` / `apikey:set:active` / `apikey:set:deleted` / `apikey:tag:*`（set） | `apiKeyIndexService.addToIndex(apiKey)`（一个 pipeline 写全族，并按 `isDeleted` / `isActive` 自动分桶） |

`apikey:index` **不存在**：代码里只有 `apikey:index:empty`、`apikey:index:version` 两个标记和一条 SCAN 排除前缀，集合本身无写入方也无读取方（dev 实测 `exists` = 0、`type` = `none`）。它是把账户侧形状类推到 API Key 侧的产物，任何写入路径引入它都会造出一个无人读取、必然漂移的派生数据。

**方案**：给 `restoreEntityItems` 增加可选参数 `indexWriter`（`async (id, item) => void`）而非 `indexKey` —— 后者隐含了「单集合 sadd」这一账户侧假设。函数内部在实体写回**成功之后**调用 `indexWriter`；`id` 从 `__key` 去掉前缀得到，因此还需传入 `prefix`。索引写法由调用方给出：账户侧传 `(id) => redis.addToIndex(indexKey, id)`，API Key 侧传一个包装 `apiKeyIndexService.addToIndex()` 的闭包。

API Key 侧的闭包 MUST 在登记后显式 `sismember(INDEX_KEYS.ALL_SET, id)` 复核：`apiKeyIndexService.addToIndex` 内部把异常吞成 `logger.error` 后正常返回，不复核就无从判断成败，索引写失败会被计成成功 —— 正是本次要消灭的形态。

不在外层循环补写的理由：外层拿不到「哪些条目真的写成功了、哪些被跳过」的逐条结果，只能拿到聚合计数。若在外层对全部条目无条件 `sadd`，被 `skipped` 的条目也会被塞进索引 —— 通常无害（它们本就该在索引里），但会掩盖「实体存在而索引缺失」这类真实不一致，让 D1b 的对账失去判据。

**id 提取以 Redis key 为权威**，不读实体内的 `id` 字段 —— 与 `metadataSync.js:126` 的既有约定一致（`// 以 Redis key 的 UUID 为权威 id`），也避免备份中 `id` 字段与 key 不一致时索引写错。

### D2 索引写入失败必须计入 errors，不得静默

索引写入失败会精确重建本次缺陷的形态（实体在、索引不在、管理台看不见）。因此 `indexWriter` 抛错时 MUST `bucket.errors++` 并 `logger.error`，而不是 warn 后继续。实体已写入而索引失败的条目，由 D1b 的启动重建兜住。

不做「索引失败则回滚实体」：单实体两步写入没有事务，回滚本身也会失败，而且实体在索引不在是可自愈的，实体丢失不可自愈。宁可留下可修复的不一致。

### D3 账户索引重建做双向对账，以 SCAN 结果为权威

`accountIndexService.rebuildAll()` 每个前缀内：

```
SCAN <前缀>*  → 过滤 isEntityKey → liveIds
索引 smembers                    → indexedIds

liveIds - indexedIds  → sadd    （补齐漏写，D1 本体的历史脏数据）
indexedIds - liveIds  → srem    （清理孤儿 id）
liveIds 非空          → del <前缀>index:empty
```

反向 `srem` 的风险是 SCAN 漏读导致误删索引条目。接受该风险，理由有三：索引是纯派生数据，误删后下一轮重建即恢复；`getAllIdsByIndex` 读到不存在的 id 时后续 `hgetall` 返回空会被各服务过滤掉，本就不致命；而孤儿 id 会让「索引数 = 账户数」这个最直观的核对判据失效。

**MUST 在同一轮内先 SCAN 再 smembers 再计算差集**，不得跨轮复用 SCAN 结果。

**不引入 `metadataSync` 那套两轮墓碑确认**：那套机制保护的是 SQLite 里的**真实数据**（误删不可恢复），这里保护的是可重建的索引，代价不对等。

### D4 账户索引重建的触发时机与版本标记

仿 `apiKeyIndexService.checkAndRebuild()`：`app.js` 启动时调用，读 `account:index:version`，低于当前版本则**后台异步**重建，不阻塞启动。

与 apikey 侧的一处差异：`rebuildHashMap` 是「始终执行」（幂等回填），`rebuildIndexes` 是「按版本执行」。账户索引重建取**按版本执行**，因为它含 `srem` 反向清理，每次启动都跑一遍的收益低于风险。

导入完成后 MUST 删除 `account:index:version`，让下次重启兜住 D1a 补写可能的遗漏。注意这是**兜底**而非主路径：D1a 保证导入后立即可见，D1b 保证最终一致。

与 apikey 侧的策略在此**不再对称**：`apikey:index:version` 改为**条件删除**（仅当本轮有索引登记失败时才删）。理由是两侧兜底的代价不同 —— 删 `apikey:index:version` 会让 `isIndexReady()` 返回假，把全部 API Key 列表查询回退成全量 SCAN 且退化窗口直到下次重启才结束；而账户侧无此快慢路径切换，删版本号只影响下次启动是否跑一次重建，代价近乎为零。所以账户侧无条件删，apikey 侧只在确有失败时才拿退化换收敛。

### D5 `account_groups_reverse:migrated` 不纳入备份

该 key 是 `ensureReverseIndexes()` 的迁移完成标记（`accountGroupService.js:11`）。若纳入备份并还原为 `'true'`，目标实例启动时会**跳过反向索引回填**，一旦本次还原的反向索引不完整，就永久不再补齐。

排除该标记后，目标实例启动会执行一次回填。回填是 `sadd` 语义、天然幂等，与已还原的反向索引叠加无害。**用「让幂等的重建再跑一次」换掉「一个可能永久跳过重建的标记」。**

同理，`account_groups_reverse:*` 的扫描 MUST 显式排除 `migrated` 这一条 —— 它的 key 形状与 `account_groups_reverse:<platform>:<accountId>` 不同（只有一段），`isEntityKey` 那套按冒号判断的规则在这里不适用，须单独排除。

### D6 分组三类 key 的冲突策略各不相同

| key | 类型 | 策略 | 理由 |
|---|---|---|---|
| `account_group:<gid>` | hash | 跳过冲突 | 分组定义是实体，目标实例的现有定义（可能已改过名/策略）不应被旧备份覆盖 |
| `account_groups` | set | 成员合并 `sadd` | 索引语义 |
| `account_group_members:<gid>` | set | 成员合并 `sadd` | 关系语义；跳过会导致「分组存在但没成员」 |
| `account_groups_reverse:<platform>:<id>` | set | 成员合并 `sadd` | 同上，反向 |

**注意一个不对称的后果**：分组定义被 `skipped`（因为目标已有同 id 分组）时，成员集合**仍然合并**。这意味着旧备份可以往一个现存分组里塞回已被移出的成员。这是 `sadd` 合并语义的固有代价，与 tags 的现有处理方式一致（tags 也是无条件 `sadd` 合并）。导入报告 MUST 列出新增的成员数，让操作者能发现。

### D7 `apikey:hash_map` 从实体通道摘出，按字段合并且逐条查 `isDeleted`

导出侧保持不变（仍收在 `data.apiKeys` 里，避免动备份结构），导入侧把 `__key === 'apikey:hash_map'` 的条目从实体列表里摘出单独处理，**并把这次处理排在 `restoreEntityItems` 写完 API Key 实体之后**：

```
对每个字段 <hash> → <keyId>：
  hexists apikey:hash_map <hash>  → 已存在则 skipped（不覆盖，防止把映射改指到别的 keyId）
  exists  apikey:<keyId>          → 不存在则 skipped 并计入 warnings
  hget    apikey:<keyId> isDeleted → 'true' 则 skipped 并计入 warnings
  否则 hset apikey:hash_map <hash> <keyId>
```

**为何 MUST 排在实体之后**（第 9 组实测纠正了本节的初版设计）：同一份备份里映射与实体成对出现，而上面第二步要复核实体存在。先合并映射时实体尚未写入，每条映射都被判成「实体不存在」而跳过，导入报告里只留一串 `hashmap-entity-missing` 告警，还原的 key 仍要等重启才认 —— 恰好就是本次要修的 D2 症状。这个顺序错了不会报错、不会计入 errors，只会静默退化，所以代码注释与本节都写明，spec 里也以不变式固定。

**为何不覆盖已存在的字段**：同一 hash 映射到不同 keyId 意味着两个实例上有同一把明文 key 对应不同记录，覆盖会把鉴权指向错误的配额与权限。保守跳过并报告。

**为何要查 `isDeleted`**：见 proposal「D2 与 E1 会互相抵消」。这一条是本变更里唯一的跨模块耦合点，spec 里以不变式形式固定，而非只写在这个函数的注释里。

`isDeleted` 查询会给每个字段加一次 `hget`。备份中 hash_map 字段数与 API Key 数同阶（生产 25 条），不做批量优化；若未来量级上升，改 pipeline 批量 `hget` 即可，不影响语义。

### D8 悬空 groupId 的两道处置：导入时剥离 + 运行时自动解绑

**导入时剥离（D3b）**：仅在备份**不含** `data.groups` 段（即 `2.0` / `2.1`）时生效。含 `data.groups` 的 `2.2` 备份不剥离 —— 分组已随备份还原，`groupId` 是有效引用。

判据用「备份是否含 groups 段」而非「分组是否存在」：后者会在分组还原顺序靠后时误判。因此导入顺序 MUST 是 **分组 → 账户 → API Key**，且剥离判断只看备份版本。

**运行时自动解绑（D3c）**：落点选在账户更新路径而非 `accountGroupService.updateGroup()`。`updateGroup` 抛「分组不存在」本身是**正确**的 —— 更新一个不存在的分组就该报错。真正的缺陷是账户保存流程把这个错误原样冒泡成 500。

因此改动在账户更新路径：保存前校验 `groupId` 指向的分组是否存在，不存在则从待写数据中移除该字段、`logger.warn` 记录，然后继续保存。这样对任何来源的悬空引用（旧备份、手工改 Redis、分组被并发删除）都生效。

**解绑的边界（第 9 组 9.9 实测确认）**：清掉的是「待写载荷里的悬空引用」与「反向索引 `account_groups_reverse:<platform>:<accountId>` 里的同一批 gid」，账户实体上的存量 `groupId` 字段**仍留着**。不顺手 `hdel` 掉它有具体原因：这个共享助手只拿得到 `platform`，而 8 类账户的实体 key 前缀各不相同（`claude:account:` / `claude_console_account:` / `openai:account:` / `openai_responses_account:` / `gemini_account:` / `gemini_api_account:` / `ccr_account:` / `droid:account:`），从 platform 反推前缀一旦推错就是往别的 key 上写。而分组归属的权威来源是成员集合 —— `getAccountGroups()` 遍历 `account_group_members:*` 判定、管理台表单也按 `GET /account-groups/:id/members` 回填、调度器走 `getGroupMembers()`，三条读路径都不看实体上的 `groupId`，所以残留字段是惰性的，且每次保存都会被再剔除一次。

### D9 `rebuildHashMap` 改双向收敛，不写一次性清理脚本

`rebuildHashMap` 已是「始终执行、幂等」的启动动作。给它加反向清理后，47.89.246.67 上那 16 条残留映射在下次重启时自动消失，不需要单独的运维脚本，也不需要在升级流程里插一步人工操作。

清理判据（两类都清）：字段指向的 `apikey:<keyId>` 实体**不存在**；或实体存在但 `isDeleted === 'true'`。

**风险**：若某实体因 Redis 故障暂时读不到，其映射会被误删，导致该 key 短暂 401。缓解是清理前对「实体不存在」这一判定做二次确认（`exists` 复查），且清理与回填在同一轮内基于同一次扫描结果，不跨轮。

清理 MUST 记录条数与 keyId 列表到 info 日志 —— 这是一个会让线上 key 失效的动作，必须可追溯。

### D10 备份版本号与兼容矩阵

`BACKUP_VERSION` → `'2.3'`。导入兼容四档：

| 备份版本 | `data.groups` | `metadata.encryption` | 实体写入 | groupId 处置 |
|---|---|---|---|---|
| `2.0` | 无 | 无 | 全按 hash（无 `__type`） | 剥离 + 报告 |
| `2.1` | 无 | 无 | 按 `__type` 分流 | 剥离 + 报告 |
| `2.2` | 有 | 无 | 按 `__type` 分流 | 保留 |
| `2.3` | 有 | 有（密钥指纹） | 按 `__type` 分流 | 保留 |

导出恒为最新版本，不提供降级导出。旧代码读 `2.3` 备份时会忽略 `data.groups` 与 `metadata.encryption`（等价于其当前行为），因此新版备份在旧实例上导入不会报错 —— 这是回滚安全的前提。

`metadata` 增设 `encryption` 段（D14）：写进文件的是**密钥指纹**，用来标识这份备份的密文绑定在哪把密钥上；密钥本身与其任何未加盐摘要 MUST NOT 入文件。旧代码读该字段同样是忽略，因此仍不存在「新格式产物只能投给已升级实例」这类单向兼容约束。

### D11 导入结果结构

`stats` 现有四桶（`apiKeys` / `accounts` / `tags` / `admins`）各含 `{ imported, skipped, errors }`，保持不变并新增：

- `groups: { definitions: {imported, skipped, errors}, members: {added}, reverse: {added} }`
- `indexes: { '<前缀>index': <补写条数>, 'apikey:idx': <登记进 API Key 索引族的条数> }`
- `hashMap: { imported, skipped, skippedDeleted, errors }`
- `warnings: [{ type, message, ... }]` —— 覆盖悬空 groupId 剥离、hash_map 因 `isDeleted` 跳过、分组定义 skipped 但成员被合并三类

前端与后端读取路径 MUST 容忍旧结构（缺新字段不报错），与 `preflightFindings` 的既有做法一致。

### D12 启动期密钥一致性自检：判据是明文合理性，不是「有没有抛异常」

新增 `src/services/encryptionKeyCheckService.js`，在 `app.js` 里紧随 `accountIndexService.checkAndRebuild()` 之后异步调用。

**为什么不能靠异常判定。** 这是本决策唯一真正的技术要点。两条解密路径在失败时都不抛错：

```js
// commonHelper.js:69 —— openai / gemini / droid / ccr 四个平台走这里
} catch (e) { return text }                       // 连日志都没有，原样返回密文

// claudeAccountService.js:2183
logger.warn('⚠️ Could not decrypt data, returning as-is:', oldError.message)
return encryptedData                             // 返回密文
```

所以自检若写成 `try { decrypt(x) } catch { 判定失配 }`，永远进不到 catch，永远判定「一致」—— 一个看起来在工作、实际什么都不检的自检，比没有自检更糟。判据必须落在**返回值**上：

| 探针类型 | 判定方式 | 可靠度 |
|---|---|---|
| 聚合型 JSON 字段（`claudeAiOauth` / `openaiOauth` / `geminiOauth`） | 解出结果能否 `JSON.parse` | 高 —— 错误密钥几乎不可能产出合法 JSON |
| 单值字段（`apiKey` / `accessToken` 等） | 是否仍等于输入的密文原文；是否由可打印字符构成 | 中 |

优先取聚合型字段。原因是 AES-256-CBC 无 MAC，错误密钥通常在 PKCS#7 padding 校验处失败，但仍有约 1/256 的概率 padding 恰好合法而产出乱码明文 —— 单值字段撞上这个概率时会误判为「一致」，而 JSON 可解析这个判据几乎不可能被乱码满足。

**必须避免误报，宁可漏报。** 误报（密钥其实没问题却报 error）会让运维对这条日志脱敏，几次之后就没人看了。因此三种情形明确不判为失配：库里没有任何非空密文字段（新装机器的正常状态）；命中的是 legacy `createDecipher` 形态（裸 hex，无论密钥对不对在 Node 24 上都解不开，另行 warn 单独报）；单个字段失败时先对该平台追加抽样，不以单点定全局。

**不阻断启动。** 库里可能只有一部分账户属于错配密钥（例如从两台机器分别导入过），阻断会把局部故障放大成全局不可用。自检的职责是让问题可见，不是替运维做决定。

**指纹不能用 `sha256(KEY)`。** 若日志中需要标识当前密钥，指纹必须走带盐 KDF 后截断，例如 `scryptSync(KEY, 'key-fingerprint', 16)`。不能用 `sha256(ENCRYPTION_KEY)` —— 该摘要正是 `bedrockAccountService.js:668` 的 `_encryptionKeyCache`，即 bedrock 账户实际使用的 AES-256 密钥。把它写进日志等于把一把可用密钥写进日志。

### D13 落地顺序：先 D1-D4，自检最后加

D5a 的自检必须在 D1-D4 之后实现与验证，原因是症状掩盖：D1-D4 未修时账户在管理台完全不可见，此时即使密钥错配，也没人会去看凭据能不能解开。顺序颠倒会让两组缺陷的验证结论互相污染。

自检本身的验证需要主动破坏配置（临时改 `.env` 里的 `ENCRYPTION_KEY` 再重启），因为 dev 与 prod 当前密钥指纹恰好一致（按本服务自己的 salt `relay-key-check-fingerprint` 现场从两台机器各自的 `.env` 派生，实测均为 `87389747817f`；早期文稿里记的 `8517dcae95ce` 出自另一种临时派生方式，已作废），不改配置复现不出失配。验证完 MUST 立即改回并确认账户恢复可用。

### D14 导出声明密钥指纹：把「凭据能否直接用」从口头前提变成文件里可核对的事实

D5a 的自检解决的是「本机密钥与本机库对不上」。还剩一个入口没覆盖：**拿着备份文件的人，在导入之前无从判断这份文件的密文绑在哪把密钥上**。第 8 组已经把前提写成了琥珀色警示（8.4），但那是一段散文 —— 运维要核对，唯一的办法是把两台机 `.env` 里的 32 个字符拿出来肉眼比，而这恰好是最不该被复制粘贴到聊天窗口的东西。

所以导出侧声明指纹，导入侧比对指纹。

**指纹复用 D12 的派生，不另写一份。** 取 `encryptionKeyCheckService.keyFingerprint()`（为此把它从 `_internal` 提为正式导出）。两处 MUST 是同一个函数而不是同一段代码的两份拷贝：一旦 salt 漂移，导出的指纹与启动日志里那行指纹就不相等，运维会据此判断「密钥被换过」——一个由实现细节造出来的假故障。同理，指纹 MUST NOT 用 `sha256(ENCRYPTION_KEY)`（D12：那正是 bedrock 实际使用的 AES 密钥）。

**三处落点，各有各的不可替代性：**

| 落点 | 内容 | 为什么不能少 |
|---|---|---|
| 文件内 `metadata.encryption` | `{ keyFingerprint, algorithm, notice }` | 文件要能离开这台机器后仍自带前提；导入侧的比对判据也只能来自这里 |
| 响应头 `X-Backup-Key-Fingerprint` | 指纹 | 导出走的是 blob 下载，前端拿到的是二进制附件、不解析 JSON，body 里的字段对界面不可见 |
| `GET /backup/summary` 的 `encryption.keyFingerprint` | 本机指纹 | 让面板在**点导出之前**就显示本机指纹 —— 事后核对救不了已经投错机器的那次导入 |
| `GET /admin/storage/status` 的 `encryption`（**实施期新增**） | 本机指纹 + 派生方式 | 面板运行时的实际取数口 |

**实施期修正（第四处落点）**：上表第三行的意图是「面板在点导出之前就能看到本机指纹」，但把它落在 `/backup/summary` 上代价不对 —— 该端点内部要跑一整趟 `exportBackup()`（全量 dump 完只为数条目数），面板一挂载就拉它，等于每次进设置页都全量导出一次。而 `/admin/storage/status` 本就被这个面板 10s 轮询，顺路带回指纹是零成本。因此**面板取数改用 `/storage/status`**，`/backup/summary` 的 `encryption` 字段仍按原设计保留，供 API 调用方与脚本使用（9.24 的三处逐字相等也仍在它上面校验）。新增的这一处同样在 `authenticateAdmin` 之后（9.30 已实测不带 token 为 401 且响应头/响应体都不含指纹）。

响应头在同源部署下前端可直接读；若将来管理台跨域部署，MUST 补 `Access-Control-Expose-Headers`，否则前端只会拿到 `undefined` 而静默少一句提示。

**文案 MUST 把两类后果分开讲，因为补救办法根本不同。** `ENCRYPTION_KEY` 在这套代码里既是账户凭据的可逆加密密钥，又是 API Key 的哈希盐（`sha256(明文 + KEY)`，明文从不落库，见否决一）。密钥不一致时：账户凭据是解不开的密文，表现为上游 401，补救办法是在目标机重新授权或重录；已发放的 API Key 连算出来的哈希都不同，表现为在中转入口就 401，而且**无法**用任何方式在目标机上恢复 —— 明文既不在备份里也不在库里，只能重新发放。只写「需要同一 ENCRYPTION_KEY」会让人以为把密钥改回去就万事大吉；改得回去当然可以，改不回去（目标机已在别的密钥下建了数据）时这两类的下场是不一样的，文案不说清就等于把最坏情况藏起来。

**导入侧只提示不拦（与否决二一致）。** 三态：

- 两侧指纹相同 → 不产生任何 warning。这条是有意的噪音控制：正常迁移是主流路径，主流路径上多一条告警，几次之后告警就没人看了（D12 同一条原则）。
- 两侧指纹不同 → `warnings` 里一条 `encryption-key-fingerprint-mismatch` + 一条 `logger.warn`，导入照常写完。MUST NOT 拒绝写入：明知密钥不同但只想捞回 tags、分组结构、管理员凭据，是正当操作，闸门会把它一起堵死。
- 任一侧缺失或为 `'unavailable'` → 不比对，只记 info。`2.0`/`2.1`/`2.2` 备份天天都是这种，报警就是纯噪音。

判据 MUST 落在「`metadata.encryption.keyFingerprint` 是否存在」上，MUST NOT 用版本号推断：`keyFingerprint()` 在派生失败时返回 `'unavailable'`，因此一份 `2.3` 备份也可能没有可比对的指纹。

**把指纹写进备份文件泄不泄密。** 12 个 hex 是截断后的加盐 scrypt 输出，它确实是一个可离线校验密钥猜测的 oracle。但它所在的这个文件里已经躺着大量 `iv:密文` 且明文结构已知（`claudeAiOauth` 是 JSON），那是强得多的同类 oracle —— 对已经拿到备份文件的人来说，指纹不增加实质攻击面。真正要守的是别把它漏到文件之外：指纹的两个新出口（导出响应头、`/backup/summary`）MUST 都在 `authenticateAdmin` 之后，且 MUST NOT 进入任何免鉴权的静态产物或页面。

**落地顺序**：D14 改了 `BACKUP_VERSION`，MUST 在第 10 组的版本号 bump 之前完成并验证。

### D15 与否决二的边界：拿掉闸门，留下声明

否决二否掉的是「导入前置闸门」——在写入任何 key 之前整体拒绝。D14 取的是它被否掉的那个方案里唯一独立成立的部分：指纹声明与比对**告警**。两者的差别不是程度而是性质：闸门要替运维做决定（且在指纹缺失时还得回落到抽样试解，等于把 D12 整套判定搬进导入前置阶段），声明只负责让事实可见。

因此否决二的保留结论仍然有效且未被推翻：若将来真要加闸门，其判定逻辑与 D12 的明文合理性判据完全共用，只是触发点从启动改为导入前。D14 不构成那个闸门的半成品 —— 它不做任何试解，只比对两个字符串。

## 已否决方案

以下三条曾进入设计，经权衡后否决。分析结论完整保留，便于将来遇到真正需要的场景时直接取用，避免重新推导。

### 否决一：导出期 / 导入期跨密钥重加密

方案是新增 `POST /admin/backup/export` 接受目标机 `ENCRYPTION_KEY`，导出时逐字段「源密钥解密 → 目标密钥加密」；导入侧对称地接受源密钥。技术上可行——实测两台机全部密文字段均为 `scrypt + iv:ct` 形态，可解可加。否决理由三条：

**只能迁一半。** `ENCRYPTION_KEY` 在这套代码里承担四种用途，前三种是可逆加密，第四种 `sha256(明文 apiKey + KEY)` 是单向哈希且明文从不落库。重加密对账户凭据成立，对 API Key 不成立。结果是「账户可用、全部已发放 API Key 401」—— 一次看起来成功的导入换来一个更难归因的故障。而「目标机沿用源机密钥」两侧同时成立，因为哈希与密文用的是同一把密钥。

**正确性押在字段清单完整性上，而漏登记是静默失败。** 重加密要求把 11 个账户前缀、3 种派生方案、各平台各自私有的加解密实现全部登记无误。漏掉一个字段，它会原样留在旧密钥下，导入不报错，等到实际调用才炸。为此本来还要配一套「扫描形如 `iv:ct` 但未登记的字段并告警」的反向自检——这套机器本身就是在为一个可以整体避开的风险打补丁。沿用密钥与字段数量无关，不需要枚举任何字段。

**它必须持有旧密钥。** 所以它救不了唯一真正需要它的场景（旧密钥丢失）；而能拿到旧密钥时，直接沿用就已经解决问题。

附一条实现层面的坑，若将来重启此议题必须记住：`commonHelper.js` 的 `_encryptorCache` 与其闭包内的 `keyCache` 只按 salt 缓存。用目标密钥调用同一个 salt 的加密器时会命中源密钥的缓存，产出的仍是**源密钥密文**且不报任何错。缓存键必须改为 (salt, 密钥指纹) 二元组。这个坑在「同时持有两把密钥」时才存在，本次否决重加密后自动消失。

真正无法替代的场景只有两个：旧密钥泄露必须轮换（重加密账户可免掉全部 OAuth 重新授权，API Key 无论如何要重发），以及两台各自有数据的实例合并（目标机改不了密钥，改了会毁掉它自己的账户与自己已发放的 API Key）。

### 否决二：备份声明密钥指纹 + 导入前置闸门

方案是 `metadata` 增设 `encryption` 段记录密钥指纹，导入时先比对指纹（快路径）、指纹缺失则每平台抽样试解（慢路径），失配即在写入任何 key 之前整体拒绝。

否决理由是覆盖面与成本不成比例。闸门只守住「导入」这一个入口，而密钥错配的成因还包括改错 `.env`、装机后先建数据再改密钥、直接操作 Redis 搬数据等。启动自检（D12）覆盖全部入口且实现更小——它不需要备份格式变化，不需要在导入流程里插入一个前置阶段，也不需要处理「用户显式传入源密钥时闸门语义反转」这类分支。

保留结论：若将来加闸门，其判定逻辑与 D12 的明文合理性判据完全共用，只是触发点从启动改为导入前；且指纹同样不能用 `sha256(KEY)`。

**本条的否决范围后经 D14 收窄**：其中「`metadata` 声明密钥指纹 + 导入时比对」这半部分已被 D14 采纳为**非阻断的告警**，被否决的只剩「在写入任何 key 之前整体拒绝」这个闸门本身，以及闸门在指纹缺失时必须回落抽样试解的那套前置阶段。边界见 D15。

### 否决三：`API_KEY_PEPPER` 与加密密钥解耦

方案是新增 `security.apiKeyPepper = process.env.API_KEY_PEPPER || process.env.ENCRYPTION_KEY || <默认>`，`_hashApiKey` 改用它。回落链保证不设该变量时哈希逐字节不变，迁移成本为零。

否决理由是在「沿用源机密钥」的路径下它没有用武之地，而且它对密钥轮换的价值被高估了：若在新机把 pepper 设为旧 `ENCRYPTION_KEY` 以保住已发放的 API Key，旧密钥照样躺在新机 `.env` 里，只不过账户密文换了把锁——这不构成真正的密钥轮换。真正需要它的场合是「旧密钥泄露，必须让它从新机彻底消失」，而那个场合下 API Key 本来就必须全部重发，pepper 也就没用了。

它是三行改动，随时可加。若将来加，`.env.example` 必须写明「一旦设定即不可更改，改动等于全量作废已发放的 API Key」。

