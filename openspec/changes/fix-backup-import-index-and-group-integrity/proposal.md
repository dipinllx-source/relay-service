## Why

`/admin/backup/import` 把备份中的每个 Redis key 一律当作「实体」，套同一套**跳过冲突**策略（`exists` → `skipped`）。但备份覆盖的 key 实际有三类语义，其中两类必须**合并**而非跳过，还有一类根本没被导出：

| key 类别 | 例 | 正确策略 | 现状 |
|---|---|---|---|
| 实体 entity | `apikey:<id>`、`*_account:<id>` | 跳过冲突 | ✓ 正确 |
| 索引 / 映射 index | `<平台前缀>index`、`apikey:idx:*` / `apikey:set:*`、`apikey:hash_map` | 成员级 / 字段级合并 | ✗ 整体跳过或根本不写 |
| 关系 relation | `account_group:*`、`account_group_members:*`、`account_groups_reverse:*` | 随实体一起还原并重建双向引用 | ✗ 未导出 |

后果是导入的账户成为**库里的孤儿键**：数据在 Redis 里，管理台却完全看不见。

除此之外还有一条与 key 语义**正交**的缺陷：备份里的凭据是密文，而密文与导出机的 `ENCRYPTION_KEY` 硬绑定（D5）。两条叠加有顺序效应 ——

```
现状：           索引没写 ─────────▶ 账户根本看不见（症状明显，直指索引）
只修 D1-D4：     索引写了 ─────────▶ 账户看得见了
                     │
                     └─ 若目标机密钥不同 ─▶ 全部请求 401（症状转移，更难定位）
本变更的处置：   索引写了 + 目标机沿用源机 ENCRYPTION_KEY ──▶ 可用
                     └─ 启动自检在密钥与已有密文不符时立刻大声报错
```

也就是说 D1-D4 修完之后，「换机」这条路径上的下一个坎就变成了密钥。本变更**不做**跨密钥重加密，而是把跨机迁移定义为「目标机沿用源机的 `ENCRYPTION_KEY`」这一运维前置条件，并补一道启动自检让密钥错配无法安静地存在。理由见下方 D5 一节末尾。

### D1 账户只写实体不写索引，且读取侧永不自愈

正常写入路径与导入路径逐行对照（以 droid 为例，`redis.js:2401` vs `backupService.js:257`）：

| 动作 | 正常创建 | 备份导入 |
|---|---|---|
| `hset <前缀><id>` | ✓ | ✓ |
| `sadd <前缀>index <id>` | ✓ | **✗ 缺失** |
| `del <前缀>index:empty` | ✓ | ✓（仅在导入收尾统一清一次） |

`redisClient.addToIndex()`（`redis.js:5074`）这个 helper 本来就在，导入路径就是没调用。

而读取侧 `redisClient.getAllIdsByIndex()`（`redis.js:5042`）的自愈能力只覆盖「索引为空」一种情形：

```js
const emptyMarker = await client.get(`${indexKey}:empty`)
if (emptyMarker === '1') { return [] }
let ids = await client.smembers(indexKey)
if (ids && ids.length > 0) { return ids }        // ← 索引非空即返回，永不 SCAN
const keys = await this.scanKeys(scanPattern)    // ← 仅索引为空时才回退重建
```

于是缺陷表现为**条件性**的：往空实例恢复，SCAN 回退恰好把索引建好，一切正常；往已有该平台账户的实例导入，索引非空，导入的账户永远不出现在管理台。这正是它长期未被发现的原因 —— 灾备演练用的是空实例。

现场记录：2026-08-17 在 47.89.246.67 上导入 8-14 备份后账户在后台不可见，须人工执行 `sadd <前缀>index <id>` + `del <前缀>index:empty` 才恢复可见。账户侧**没有任何索引重建服务**，不人工介入就永不收敛。

### D2 `apikey:hash_map` 被当成实体，整体跳过

导出侧把它显式当实体收进 `data.apiKeys`（`backupService.js:124-129`）：

```js
const entityKeys = allApiKeys.filter((k) => k === 'apikey:hash_map' || isEntityKey(k, 'apikey:'))
```

导入侧走同一个 `restoreEntityItems`，于是 `exists('apikey:hash_map')` 决定整张映射表的命运。**目标实例只要曾创建过任何一个 API Key，这个 key 就必然存在**，整张表被判 `skipped`，备份中全部 `hash → keyId` 映射被丢弃。

还原的 API Key 因此无法鉴权：`findApiKeyByHash()`（`redis.js:996`）只回退到旧结构 `apikey_hash:*`，哈希不可逆，无法从实体反推映射：

```
请求携带 key → sha256(明文+ENCRYPTION_KEY) → hget apikey:hash_map <hash> → null
                                            → hgetall apikey_hash:<hash> → 不存在
                                            → return null → 401
```

自愈窗口：`apiKeyIndexService.rebuildHashMap()`（`app.js:167`，**仅启动时**跑）会从实体的 `apiKey` 字段回填。所以症状是「导入完成后到下次重启之间，还原的 API Key 全部不可用」，重启后自行消失 —— 一个极难归因的间歇性故障。

### D3 分组子系统完全不在备份范围

`grep -n "account_group" src/services/backupService.js` → 无任何匹配。分组子系统共四类 key（`accountGroupService.js:7-11`），全部缺失：

| key | 类型 | 作用 |
|---|---|---|
| `account_groups` | set | 分组 id 索引 |
| `account_group:<gid>` | hash | 分组定义（name / platform / 调度策略） |
| `account_group_members:<gid>` | set | 分组成员 accountId |
| `account_groups_reverse:<platform>:<accountId>` | set | 账户 → 分组反向索引 |

而账户实体的 `groupId` / `groupIds` 字段**是被导出的**（它们只是 hash 字段）。于是还原后形成悬空引用：

```
账户实体      groupId = 03a7d2f4-…（源实例的分组）
                  │
                  ├─▶ account_group:03a7d2f4-… 不存在 → 不参与分组调度
                  ├─▶ account_group_members 无该成员 → 调度枚举不到
                  └─▶ 后台编辑保存 → accountGroupService 抛「分组不存在」→ 500
```

### D4 导入不登记 API Key 索引族，只删版本号把列表查询降级到下次重启

导入收尾删除 `apikey:index:version`（`backupService.js:364`）以触发 `apiKeyIndexService` 下次启动重建，但不登记索引本身。

这里有一处**需要先纠正的事实**：`apikey:index` 这个集合在系统中并不存在。`grep -rn "apikey:index" src/ web/ scripts/` 只命中三类派生 key —— `apikey:index:empty`（空标记）、`apikey:index:version`（版本标记）、`redis.js:558` 的 scan 排除前缀；集合本体既无写入方也无读取方。dev 43.110.32.63 实测 `exists apikey:index` = 0、`type` = `none`。因此 47.89.246.67 上 `scard apikey:index` = 0 并不是「索引漏写」，而是「这个 key 从来不存在」。

API Key 侧真实在维护的是另一族索引（`apiKeyIndexService.INDEX_KEYS`），dev 实测均正常：

| key | 类型 | dev 实测 | 作用 |
|---|---|---|---|
| `apikey:idx:createdAt` / `lastUsedAt` | zset | 26 | 排序分页 |
| `apikey:idx:name` | zset | — | 名称前缀检索 |
| `apikey:idx:all` | set | 26 | 全量 id |
| `apikey:set:active` | set | 12 | 活跃列表 |
| `apikey:set:deleted` | set | 14 | 回收站列表 |

于是缺陷的正确表述是：导入既不登记这一族索引，也就只能靠删 `apikey:index:version` 让 `isIndexReady()` 返回假，把全部列表查询回退成全量 SCAN —— **结果正确但持续退化，且退化窗口直到下次重启才结束**。这与 D2 的「导入的 key 到下次重启前不可鉴权」是同一种病：把本该当场收敛的事推给重启。

作者显然意识到了索引问题（专门清了 `:empty` 标记、专门删了 version），但只对 apikey 侧生效 —— **因为 apikey 侧有版本化重建服务兜底，账户侧没有**。这个不对称是 D1 长期潜伏的结构性原因。

### D5 备份密文与 `ENCRYPTION_KEY` 硬绑定，换机即静默失效

`backupService.js` 头注释把这条限制写成了设计：「密钥策略：保留加密形态（原样导出/导入，**与当前 encryptionKey 绑定，同环境可直接恢复**）」。跨密钥迁移从未被支持。而 `scripts/manage.sh:461` 是 `ENCRYPTION_KEY=$(generate_random_string 32)` —— **每台全新安装的机器都是随机新密钥**，也就是说「迁移到新服务器」这条最常见的路径，默认就落在不被支持的场景里。

`ENCRYPTION_KEY` 在这套代码里同时承担四种互不兼容的用途：

| # | 派生方式 | 密文形态 | 使用方 | 能否重加密 |
|---|---|---|---|---|
| ① | `scryptSync(KEY, salt, 32)` | `"ivHex:ctHex"` 字符串 | 10 个账户服务，11 个 salt | ✅ 对称可逆 |
| ② | `sha256(KEY)` 原始 digest 直接当密钥 | `{ encrypted, iv }` 对象，嵌在 JSON 字符串实体里 | 仅 bedrock | ✅ 可逆，但形态与 ① 完全不同 |
| ③ | `createDecipher('aes-256-cbc', KEY)` | 裸 hex，无 IV 前缀 | claude 旧格式兼容路径（`claudeAccountService.js:2164`） | ❌ Node v24.15.0 已删除该 API |
| ④ | `sha256(明文 apiKey + KEY)` | 哈希，非密文 | `apikey:hash_map` 字段名 + apikey 实体的 `apiKey` 字段 | ❌ 单向，明文从不落库 |

① 的 11 个 salt 各自独立派生：`salt`（claude / bedrock 共用）、`claude-relay-salt`、`claude-console-salt`、`openai-account-salt`、`openai-responses-salt`、`openai-compatible-salt`、`gemini-account-salt`、`gemini-api-salt`、`droid-account-salt`、`ccr-account-salt`、`azure-openai-account-default-salt`。这些 salt 全是源码常量。`azureOpenaiAccountService.js:13` 写的是 `config.security?.azureOpenaiSalt || 'azure-openai-account-default-salt'`，看着像可配，但实测 `config.security` 里从未定义 `azureOpenaiSalt`，`.env.example` 也没有对应变量，该分支恒取默认常量。

因此**全机只有 `ENCRYPTION_KEY` 一把可变的秘密**，它单独决定全部账户密文与全部 API Key 哈希；`JWT_SECRET` 是独立变量，换掉只影响管理员重新登录，不碰数据。这个事实决定了后面的处置选择。

④ 是数学上的硬墙：API Key 的明文只在创建时向管理员展示一次，库里存的是 `sha256(明文 + KEY)`。换 `ENCRYPTION_KEY` 后既算不出新哈希，也无法从旧哈希反推明文。「解密后用新密钥加密」对①②成立，对④不成立。

而解密失败是**静默**的：

```
目标机 ENCRYPTION_KEY 不同
  → scryptSync 派生出不同的 32 字节密钥
  → decipher.final() 抛 "bad decrypt"
  → catch → createDecipher 旧格式兜底 → Node 24 上 TypeError（实测 typeof === 'undefined'）
  → catch → logger.warn('Could not decrypt data, returning as-is') → return 密文原文
  → accessToken = "a3f1…:9c2b…" 被当作 token 原样发往上游 → 401
  → 后台只显示「账号异常」，全链路没有一处指向「解密失败」
```

`commonHelper.js:69` 那份更彻底 —— `catch (e) { return text }`，连一行日志都没有；openai / gemini / droid / ccr 四个平台走的正是它。AES-256-CBC 无 MAC，错误密钥通常在 padding 校验处抛错，但仍有约 1/256 的概率 padding 恰好合法而产出乱码明文，所以检测 MUST NOT 只依赖是否抛异常。

现场取证：

| 项 | dev 43.110.32.63 | prod 47.89.246.67 |
|---|---|---|
| `ENCRYPTION_KEY` 字节数 | 32 | 32 |
| 密钥指纹（sha256 前 12 位） | `8517dcae95ce` | `8517dcae95ce` |
| 账户敏感字段形态 | 全为 ① `ivct`（claude 1 + openai 4） | 全为 ① `ivct`（openai 5） |
| ③ 旧格式残留 | 0 | 0 |

两台机器密钥相同，所以此前那次导入没踩 D5。但这也意味着 D5 目前**零覆盖、零验证**：D1-D4 修完之后账户终于可见了，一旦目标机是真正新装的，看得见的账户里装的全是解不开的密文，症状从「账号不见了」变成「账号在但全部 401」——更难定位。

**处置：本变更不做跨密钥重加密。** 跨机迁移的前置条件定为「目标机在建立任何数据之前，把 `ENCRYPTION_KEY` 设为源机的值」，另加一道启动自检兜住错配。否决重加密的理由有三条，按分量排序：

第一，重加密只能迁一半，而迁一半比不迁更危险。①②可逆，账户凭据确实能换锁；④是单向哈希且明文从不落库，API Key 无论如何迁不过去。结果是账户能用、全部已发放 API Key 401 —— 一次「看起来成功」的导入换来一个更难归因的故障。而沿用源机密钥两侧同时成立，因为哈希与密文用的是同一把 `ENCRYPTION_KEY`。

第二，重加密的正确性取决于「加密字段清单是否完整」，而漏登记一个字段的后果是静默的：那个字段会原样留在旧密钥下，导入时不报错，等到实际调用才炸。要押的是 11 个前缀 × 3 种方案 × 每个平台各自私有的加解密实现全部登记无误 —— 这是个坏赌注。沿用源机密钥则与字段数量无关，不需要枚举任何字段，也就没有这个赌注。

第三，重加密**必须持有旧密钥**才能解密。所以它恰恰救不了唯一真正需要它的场景（旧密钥丢失）；而在能拿到旧密钥的场景里，直接沿用它就已经解决问题了。

重加密真正无法被替代的场景只剩两个，两个都不是当前处境：旧密钥泄露必须轮换（此时重加密账户可免掉全部 OAuth 重新授权，API Key 无论如何要重发），以及两台各自有数据的实例合并（目标机改不了密钥，改了会毁掉它自己的账户与它自己已发放的 API Key）。留待真正遇到时再立变更。

**遗留风险与其兜底。** 沿用密钥这条路依赖操作纪律，有两个失手点：一是 `scripts/manage.sh:461` 装机时会自动生成 `ENCRYPTION_KEY`，若新机已启动并建过账户或 API Key，事后再改密钥会把这批数据打死 —— 顺序必须是「改密钥，再建任何数据」；二是改错或忘改，今天没有任何一处会告诉你。因此本变更加一道启动自检：抽样试解本机已有账户的密文字段，解不开就打 error 日志明示「当前 `ENCRYPTION_KEY` 与库中已有密文不匹配」。它不阻断启动（阻断会让一次配置失手升级为服务不可用），但让这件事再也不能悄悄发生。

### 附带发现 E1：软删除的 API Key 每次重启后被重新赋予可鉴权映射

`apiKeyService.deleteApiKey()`（`apiKeyService.js:1304`）是**软删除**：置 `isDeleted='true'`、`isActive='false'`，并显式移除哈希映射，注释写明意图：

```js
// 从哈希映射中移除（这样就不能再使用这个key进行API调用）
if (keyData.apiKey) { await redis.deleteApiKeyHash(keyData.apiKey) }
```

但 `rebuildHashMap()` 扫描全部实体，只要 `keyData.apiKey` 字段存在就无条件回填，**不看 `isDeleted`**：

```js
if (keyData && keyData.apiKey) {                                  // ← 缺 isDeleted 判断
  const exists = await client.hexists('apikey:hash_map', keyData.apiKey)
  if (!exists) { fillPipeline.hset('apikey:hash_map', keyData.apiKey, batch[j]) }
}
```

于是每次服务启动都把已删除 key 的鉴权映射写回。47.89.246.67 实测（`ExecMainStartTimestamp` = 2026-08-17 14:23:47 CST = **06:23:47Z**，此后未重启）：

| 软删除时间 | 条数 | `apikey:hash_map` 中是否存在映射 |
|---|---|---|
| 早于 06:23:47Z | 16 | **全部存在** ✗ |
| 晚于 06:23:47Z | 3 | 全部不存在 ✓ |

边界与重启时刻精确吻合，无一例外。回收站里躺着 19 条已删除 key（28 条实体中），其中 16 条的鉴权映射是活的。

**严重性：不可利用。** 软删除同时置 `isActive='false'`，`validateApiKey()`（`apiKeyService.js:313` / `492`）第一道即返回「API key is disabled」。这是纵深防御被撤销 —— 代码显式表达的「移除映射」意图被回填逻辑悄悄抹掉，风险面收窄为「任何能单独把 `isActive` 拨回 true 而不走 `restore` 接口的路径」。

### D2 与 E1 会互相抵消，必须同批次并按同一不变式落地

```
E1 单独修：rebuildHashMap 查 isDeleted → 启动不再回填已删 key 的映射 ✓
D2 单独修：hash_map 字段级合并       → 备份中的映射逐条写回

        旧备份是在「key 被删除之前」导出的
                    │
                    └──▶ 里面存的是当时还活着的映射
                             │
             导入合并 ───────▶ 已删 key 的映射被原样写回 ✗
                             │
                             └──▶ 正是 E1 要消除的状态

E1 只覆盖启动回填这条路径，覆盖不到导入合并这条路径。
```

因此本变更确立一条不变式：**`isDeleted='true'` 的 API Key MUST NOT 在 `apikey:hash_map` 中存在映射**，并要求全部三处写入点（`setApiKey`、`rebuildHashMap`、导入合并）统一守住，而非散落在代码里靠自觉。

### 现存 spec 本身有缺口

`backup-restore` spec 中「导入必须按实体类型回写并立即贯通 SQLite」明确要求「清理索引空标记与 read-through 缓存键」，却**没有要求写索引集合本身**。所以 D1/D4 不只是实现 bug —— 规格允许了这个行为，修实现的同时必须补规格，否则下次重构会原地复发。

## What Changes

- **导入时补写账户索引（D1a）**：`restoreEntityItems` 接受所属分组信息，账户实体写回后 `sadd <前缀>index <id>` 并 `del <前缀>index:empty`，复用 `redisClient.addToIndex()`。索引写入失败 MUST 计入 errors 并告警，MUST NOT 静默（实体在、索引不在正是本次缺陷形态）。
- **新增账户索引版本化重建（D1b）**：仿 `apiKeyIndexService`，新增账户侧索引重建能力，以 `account:index:version` 为版本标记，启动时异步双向对账 —— 实体有索引无则 `sadd`，索引有实体无则 `srem`，以 SCAN 结果为权威。用于收敛历史脏数据（含 47.89.246.67 上人工补过的部分）与未来任何漏写。
- **`apikey:hash_map` 改为字段级合并（D2）**：从实体通道中摘出，单独按字段合并写回，不再受 `exists` 整体跳过。每个字段写入前 MUST 检查其目标 keyId 对应实体的 `isDeleted`：为 `'true'` 则跳过该字段并计数，避免与 E1 对冲。
- **导入时登记 API Key 索引族（D4）**：随 apikey 实体写回，调用创建路径同一个入口 `apiKeyIndexService.addToIndex()` 把该 key 登记进真实索引族（`apikey:idx:createdAt` / `lastUsedAt` / `name` 三个 zset 与 `apikey:idx:all` / `apikey:set:active` / `apikey:set:deleted` / `apikey:tag:*`），由该入口按 `isDeleted` / `isActive` 自动分桶 —— 已软删除的 key 因此只进 `apikey:set:deleted`（回收站），MUST NOT 进 `apikey:set:active`。`addToIndex` 内部把异常吞成日志后正常返回，故导入侧 MUST 在登记后显式复核 `sismember apikey:idx:all <id>`，MUST NOT 把失败计成成功。MUST NOT 另造 `apikey:index` 集合 —— 该 key 在代码中不存在（无写入方、无读取方）。`apikey:index:version` 的删除相应改为**条件执行**：仅当本轮有登记失败时才删，否则列表查询会无谓退化为全量 SCAN 直到下次重启。
- **分组子系统纳入备份（D3）**：备份新增 `data.groups` 段，覆盖 `account_groups`、`account_group:<gid>`、`account_group_members:<gid>`、`account_groups_reverse:<platform>:<accountId>` 四类。分组定义按实体语义跳过冲突，三类集合按成员合并。`account_groups_reverse:migrated` 迁移标记 MUST NOT 纳入备份（见 design D5）。备份格式 `2.1` → `2.2`。
- **2.1 及更早备份的悬空 groupId 处置（D3b）**：导入不含 `data.groups` 段的旧备份时，对写回的账户实体**剥离** `groupId` / `groupIds` 字段，并在导入结果中逐条报告「账户 `<name>` 原属分组 `<gid>`，本实例无此分组，已解除绑定」。不静默改数据，也不留下会打挂后台保存的悬空引用。
- **悬空分组引用的健壮性兜底（D3c）**：账户更新路径遇到指向不存在分组的 `groupId` 时，SHALL 自动解绑并告警，MUST NOT 让整个保存操作返回 500。此项独立于备份格式，对任何来源的悬空引用都生效。
- **`rebuildHashMap` 改为双向收敛（E1）**：回填时跳过 `isDeleted='true'` 的实体；同时清理 `apikey:hash_map` 中指向已软删除实体或不存在实体的残留字段。47.89.246.67 上那 16 条残留因此在下次重启时自动收敛，无需一次性清理脚本。
- **导入结果结构扩展**：`stats` 新增 `groups` 桶与 `indexes`（各前缀补写条数）、`warnings`（悬空 groupId 剥离、hash_map 跳过的已删 key）两段，使还原结果可核对而非只看总数。
- **启动期密钥一致性自检（D5a）**：启动时抽样试解本机已有账户的密文字段，若解不开则打 error 日志明示「当前 `ENCRYPTION_KEY` 与库中已有密文不匹配」，并列出受影响平台。SHALL NOT 阻断启动，SHALL NOT 输出密钥或密文值。这是本变更针对 D5 的**唯一代码改动**。
- **跨机迁移步骤进文档（D5b）**：`.env.example` 与升级说明写明 `ENCRYPTION_KEY` 一旦有数据即不可更改，跨机迁移须在目标机建立任何数据之前把该值设为源机的值；不做跨密钥重加密，理由与例外场景一并记录（见 design 已否决方案）。

### Non-goals

以下七项**明确不在本变更范围**，另行立变更：

- **账户删除墓碑**：账户是硬删除（`del` 实体 + `srem` 索引，无痕），导入旧备份仍会**复活已删除账户**，且复活后立刻参与调度。API Key 因为是软删除、实体保留，`exists` 恰好挡住了复活 —— 两侧删除模型不对称，这是设计问题而非导入路径问题。
- **账户回收站**：与 API Key 的 `isDeleted` / `/api-keys/deleted` / `restore` / `permanent` 范式对齐需改动 11 个平台服务的读取路径、调度过滤、OAuth 凭据滞留与自动刷新调度，面过大。
- **导入前置预览与勾选**：可顺带解决跨机污染（47.89.246.67 生产库中的 `dump-test-2`、`capture-test` 两条测试 key 即来自 43.110.32.63 的备份），但属于新交互能力。
- **跨密钥重加密（导出期与导入期）**：不做。理由见 D5 一节末尾三条 —— 只能迁一半、正确性押在字段清单完整性上且漏登记是静默失败、且它本身就要求持有旧密钥。跨机迁移改用「目标机沿用源机 `ENCRYPTION_KEY`」。仅当出现「旧密钥泄露必须轮换」或「两台各自有数据的实例合并」时才重启此议题。
- **导入前置密钥闸门与备份密钥指纹**：不做。闸门的价值是替「沿用密钥」这条运维纪律做强制校验，但它只覆盖导入这一个入口；启动自检（D5a）覆盖面更宽（改错 `.env`、装机顺序颠倒、导入之外的任何路径）且实现更小，因此本次只做自检。备份 `metadata` 不新增 `encryption` 段，格式变化仅来自 `data.groups`。
- **API Key 哈希 pepper 与加密密钥解耦**：不做。`API_KEY_PEPPER` 的作用是让 `ENCRYPTION_KEY` 可以更换而不作废已发放的 API Key，但在「沿用源机密钥」的路径下它没有用武之地；且若把 pepper 设为旧密钥来保住已发放的 key，旧密钥照样留在新机 `.env` 里，并不构成真正的密钥轮换。真要用时是三行改动，随时可加。
- **备份文件整体口令加密**：备份文件仍是明文 JSON，且 `data/init.json` 的 `adminPassword` 是明文（实测 12 字符，非哈希），等于随备份一起流出。本变更只在导出结果与日志中明确警示这是最高敏感级文件，不引入口令派生加密，也不改管理员密码的存储形态。

本变更期间，「导入旧备份会复活已删账户」这一行为**保持现状**，靠操作纪律规避。

## Capabilities

### New Capabilities

- `api-key-deletion-durability`：定义 API Key 软删除的持久性 —— 已删除 key 的可鉴权映射不得被任何重建、回填或还原路径重新赋予。
- `encryption-key-consistency`：定义 `ENCRYPTION_KEY` 与库中已有密文的一致性必须在启动时被主动核对且失配必须可见 —— 不静默、不阻断、不泄露密钥。

### Modified Capabilities

- `backup-restore`：修改「导入必须按实体类型回写并立即贯通 SQLite」，新增索引与关系的还原要求；新增「备份必须覆盖分组关系」「旧版本备份的悬空引用处置」两项要求。

## Impact

**代码**：

- `src/services/backupService.js` — 索引补写、`hash_map` 摘出字段级合并、`data.groups` 导出与导入、悬空 groupId 剥离与报告、`stats` 结构扩展、`BACKUP_VERSION` → `2.2`
- `src/services/apiKeyIndexService.js` — `rebuildHashMap` 增加 `isDeleted` 判断与反向清理
- `src/services/accountIndexService.js` — 新增；账户索引版本化重建
- `src/services/encryptionKeyCheckService.js` — 新增；启动期抽样试解，判定当前 `ENCRYPTION_KEY` 与库中已有密文是否一致（D5a）
- `src/app.js` — 启动调用账户索引重建与密钥一致性自检
- `src/services/accountGroupService.js` 或账户更新路径 — 悬空 groupId 自动解绑（D3c，具体落点见 design D8）
- `web/admin-spa` — 导入结果展示 `groups` / `indexes` / `warnings`；导出结果标注备份文件的敏感级别
- `.env.example`、升级说明 — `ENCRYPTION_KEY` 不可变更的约束与跨机迁移步骤（D5b）

各账户服务的加解密实现、`commonHelper.js`、`apiKeyService._hashApiKey`、`config/config.js` 与备份路由的方法签名**均不改动** —— 这是砍掉重加密之后省下的全部改动面。

**数据**：无 schema 变更。备份文件格式 `2.1` → `2.2`（仅新增 `data.groups` 一段）；导入 MUST 兼容 `2.0` / `2.1`。Redis 新增 `account:index:version` 版本标记 key。无新增环境变量。

**行为变化**：

- 导入的账户立即出现在管理台，不再依赖目标实例索引是否为空。
- 导入的 API Key 立即可鉴权，不再需要等一次重启。
- 分组定义、成员与反向索引随备份一起还原；跨实例还原不再产生悬空 groupId。
- 导入 2.1 及更早备份时，账户的分组绑定被显式解除并报告（此前是静默留下悬空引用）。
- 已软删除的 API Key 在重启后不再被重新赋予鉴权映射；47.89.246.67 上 16 条残留自动收敛。
- 账户保存遇悬空 groupId 不再 500。
- `ENCRYPTION_KEY` 与库中密文不一致时，启动日志出现明确的 error 而非无声无息；服务照常启动。

**跨机迁移的行为不变**：备份仍与 `ENCRYPTION_KEY` 硬绑定，目标机必须沿用源机的该值，这一点本变更不改变，只是让违反它的后果变得可见。

**验证**：详见 tasks.md 验证组。核心用例两条 —— 一是**已有同平台账户的实例**上导入（这是 D1 唯一的暴露条件，空实例复现不出来）；二是**故意把 `ENCRYPTION_KEY` 改错**后重启，自检 SHALL 报 error 且服务 SHALL 正常启动（这是 D5a 唯一的暴露条件，两台机当前密钥指纹恰好一致，不改配置复现不出来）。

**回滚**：`git revert` 本变更提交 + `systemctl restart relay-app`。`2.2` 备份文件在旧代码上导入时 `data.groups` 段会被忽略（旧代码只读 `data.apiKeys` / `data.accounts` / `data.tags` / `data.admins`），不会报错；已写入的索引集合与分组关系不受回滚影响，因为它们是正常运行路径本就该有的数据。回滚后启动自检消失，密钥错配回到静默状态，但不会产生任何新的错误数据 —— 本次没有引入「产物只能投给已升级实例」这类单向兼容风险。
