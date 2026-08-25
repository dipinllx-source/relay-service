## MODIFIED Requirements

### Requirement: 导入必须按实体类型回写、重建派生索引并立即贯通 SQLite

备份导入 SHALL 按条目的 `__type` 标记选择写入方式：`string` 实体用 `SET`，hash 实体用 `HSET`。导入 SHALL 对**实体** key 保持跳过冲突语义（key 已存在则跳过）。

导入 SHALL 区分三类 key 并采用不同策略，MUST NOT 对全部 key 套用同一套跳过冲突策略：

| 类别 | 策略 |
|---|---|
| 实体（`apikey:<id>`、`<平台前缀><id>`、`account_group:<gid>`） | 跳过冲突 |
| 索引与映射（`<平台前缀>index`、`apikey:idx:*` / `apikey:set:*`、`apikey:hash_map`） | 成员级 / 字段级合并 |
| 关系（`account_groups`、`account_group_members:*`、`account_groups_reverse:*`） | 成员级合并 |

每个实体写回成功后，导入 SHALL 立即把其 id 登记进该实体所属的索引，并清除相关索引的 `:empty` 空标记。仅当实体确实被写入时才 SHALL 写索引；被跳过的实体 MUST NOT 触发索引写入。索引写入失败 SHALL 计入 errors 并记录 error 级日志，MUST NOT 静默忽略 —— 「实体存在而索引缺失」会使该实体在管理台完全不可见，且读取路径在索引非空时不会回退扫描，故不可自愈。

账户侧与 API Key 侧的索引形状不同，导入 MUST NOT 对二者套用同一种写法。账户侧是单一集合 `<平台前缀>index`，`SADD` 即可。API Key 侧不存在与之对应的单一集合，实际在维护的是 `apikey:idx:createdAt` / `apikey:idx:lastUsedAt` / `apikey:idx:name` / `apikey:idx:all` 与 `apikey:set:active` / `apikey:set:deleted` 这一索引族；导入 SHALL 复用创建路径所用的同一个登记入口写入该族，MUST NOT 另造索引 key。若该登记入口以返回而非抛出的方式吞掉内部错误，导入 SHALL 在登记后显式复核成员是否存在，MUST NOT 把失败计成成功。

已软删除（`isDeleted` 为 `'true'`）的 API Key SHALL 被登记进回收站集合，MUST NOT 出现在活跃集合中。

`apikey:hash_map` SHALL 按字段合并而非作为单个实体整体跳过。对每个 `hash → keyId` 字段：目标字段已存在则 SHALL 跳过（MUST NOT 覆盖，防止同一哈希改指到另一 keyId）；目标实体不存在则 SHALL 跳过并记入警告；目标实体 `isDeleted` 为 `'true'` 则 SHALL 跳过并记入警告。

`apikey:hash_map` 的字段合并 MUST 排在 API Key 实体写回**之后**。该合并逐条复核映射所指实体是否存在，而映射与实体在同一份备份里成对出现；先合并映射则每条复核必然为假，全部映射被判为「实体不存在」而跳过，还原的 key 在下次重启前一律鉴权失败。此种失序 MUST NOT 被视为可接受的降级 —— 它不产生 errors，只会静默复现本要修复的缺陷。

当 `METADATA_BACKEND=sqlite` 时，导入完成后 SHALL 立即触发一次 Redis→SQLite 对账，使还原数据不依赖异步对账窗口即可在 SQLite 层可见；并 SHALL 清理索引空标记与 read-through 缓存键。

账户索引版本标记 SHALL 无条件重置，为下次启动的兜底重建留出触发点。API Key 索引版本标记则 SHALL 仅在本轮出现过索引登记失败时才重置 —— 逐条登记已使该索引族完整，无条件重置会让列表查询在下次重启前一直退化为全量扫描；而登记失败时重置可让下次启动的重建兜住，期间查询回退扫描，结果仍正确。

导入结果 SHALL 报告各索引的补写条数、`apikey:hash_map` 的合并与跳过明细，以及全部警告项。

#### Scenario: 目标实例已有同平台账户时导入仍可见
- **WHEN** 目标实例某平台的账户索引集合非空，管理员导入一份含该平台新账户的备份
- **THEN** 该账户 SHALL 立即出现在管理台账户列表，`<平台前缀>index` SHALL 包含其 id，MUST NOT 需要重启服务或人工补写索引

#### Scenario: 空实例导入行为不退化
- **WHEN** 目标实例某平台无任何账户，导入含该平台账户的备份
- **THEN** 该账户 SHALL 可见，且索引集合 SHALL 包含其 id

#### Scenario: 还原的 API Key 无需重启即可鉴权
- **WHEN** 目标实例已存在其他 API Key（故 `apikey:hash_map` 已存在），导入一份含活跃 API Key 的备份，且**不重启服务**
- **THEN** 使用该还原 API Key 发起请求 SHALL 鉴权成功

#### Scenario: 还原的 API Key 无需重启即可在列表中出现
- **WHEN** 目标实例的 API Key 索引处于就绪状态，导入一份含新活跃 API Key 的备份，且**不重启服务**
- **THEN** `apikey:idx:all` 与 `apikey:set:active` SHALL 包含其 id，该 key SHALL 出现在管理台 API Key 列表

#### Scenario: 还原的已软删除 key 只进回收站集合
- **WHEN** 导入的备份中某 API Key 实体带 `isDeleted` 为 `'true'`
- **THEN** `apikey:set:deleted` SHALL 包含其 id，`apikey:set:active` MUST NOT 包含其 id

#### Scenario: 不覆盖已存在的哈希映射
- **WHEN** 备份中某 `hash` 字段映射到 keyId A，而目标实例该 `hash` 已映射到 keyId B
- **THEN** 导入 SHALL 保留 B，SHALL 计入 skipped，MUST NOT 覆盖

#### Scenario: 已软删除 key 的映射不被还原
- **WHEN** 备份导出时某 API Key 尚活跃，导出后该 key 在目标实例被软删除，随后导入该备份
- **THEN** 该 key 的哈希映射 MUST NOT 被写回，SHALL 产生一条警告

#### Scenario: 索引写入失败不被静默
- **WHEN** 某实体写回成功但其索引写入抛出异常
- **THEN** SHALL 计入 errors 并记录 error 级日志

#### Scenario: bedrock 账户往返还原
- **WHEN** 管理员导出含 bedrock 账户的备份、删除该账户、再导入备份
- **THEN** bedrock 账户 SHALL 以字符串形态写回 Redis，且经 `get + JSON.parse` 路径可读，SQLite `accounts` 表 SHALL 在对账后包含该行，`bedrock_account:index` SHALL 包含其 id

#### Scenario: 还原后 SQLite 立即可见
- **WHEN** 在 sqlite backend 下导入一份含新 API Key 的备份
- **THEN** 导入响应返回前 SQLite `api_keys` 表 SHALL 已包含该条目

#### Scenario: 兼容 2.0 备份
- **WHEN** 导入 `metadata.version` 为 2.0 的备份文件
- **THEN** 所有条目 SHALL 按 hash 形态写回，MUST NOT 报格式错误

#### Scenario: 重复导入幂等
- **WHEN** 同一份备份连续导入两次
- **THEN** 第二次 SHALL 全部计入 skipped，索引集合与关系集合 SHALL 无变化

## ADDED Requirements

### Requirement: 备份必须覆盖账户分组关系

备份导出 SHALL 覆盖分组子系统的全部持久数据：分组 id 索引 `account_groups`、分组定义 `account_group:<gid>`、分组成员集合 `account_group_members:<gid>`、账户到分组的反向索引 `account_groups_reverse:<platform>:<accountId>`。

反向索引的迁移完成标记 `account_groups_reverse:migrated` MUST NOT 纳入备份 —— 还原该标记会使目标实例启动时跳过反向索引回填，一旦还原不完整将永久不再补齐。扫描 `account_groups_reverse:*` 时 SHALL 显式排除该标记（其 key 形状与实体不同，按冒号数量判断的实体规则对其不适用）。

导入顺序 SHALL 为分组、账户、API Key 实体、`apikey:hash_map` 哈希映射，使账户写回时其分组引用已经有效、映射写回时其所指实体已经存在。分组定义 SHALL 按实体语义跳过冲突；三类集合 SHALL 按成员合并。当某分组定义因已存在而被跳过、但其成员集合仍产生新增成员时，导入 SHALL 记录警告 —— 这意味着旧备份把成员塞回了一个现存分组。

单个分组的读取失败 MUST NOT 导致整个导出失败，SHALL 记录 warn 日志并计入 errors 计数。

#### Scenario: 跨实例还原分组绑定
- **WHEN** 源实例存在一个绑定了账户的分组，导出备份后在无该分组的目标实例导入
- **THEN** 分组定义、成员集合与反向索引 SHALL 全部还原，该账户 SHALL 参与分组调度

#### Scenario: 还原后账户可正常编辑保存
- **WHEN** 导入含分组的备份后，管理员在后台编辑该账户并保存
- **THEN** SHALL 返回 200，MUST NOT 返回「分组不存在」错误

#### Scenario: 迁移标记不被还原
- **WHEN** 导出并导入一份含分组的备份
- **THEN** 备份文件中 MUST NOT 含 `account_groups_reverse:migrated`，目标实例启动时 SHALL 正常执行反向索引回填

#### Scenario: 成员被塞回现存分组时告警
- **WHEN** 目标实例已存在同 id 分组，导入的备份中该分组含目标实例已移除的成员
- **THEN** 分组定义 SHALL 被跳过，成员 SHALL 被合并，且 SHALL 产生一条警告说明新增了哪些成员

### Requirement: 旧版本备份的悬空分组引用必须被显式剥离并报告

导入不含分组数据的备份（`metadata.version` 低于 2.2）时，写回的账户实体 SHALL 剥离 `groupId` 与 `groupIds` 字段，并为每次剥离记录一条警告，说明账户名与原分组 id。

判定依据 SHALL 是「备份是否含分组数据段」，MUST NOT 是「该分组当前是否存在」—— 后者受导入顺序影响会误判。含分组数据的备份 MUST NOT 剥离。

此外，账户更新路径 SHALL 对指向不存在分组的 `groupId` 自动解绑并记录 warn 日志，然后继续完成保存，MUST NOT 使保存操作失败。此项对任何来源的悬空引用生效，包括手工修改 Redis 与分组被并发删除。分组更新接口对不存在分组报错的行为 MUST NOT 改动。

「自动解绑」的范围 SHALL 是：待写载荷里的悬空引用被剔除（因而 MUST NOT 触发绑定、MUST NOT 建出 `account_group_members:<悬空 gid>`），且反向索引 `account_groups_reverse:<platform>:<accountId>` 里的同一批 gid 被清掉。分组归属的权威来源 SHALL 是成员集合 `account_group_members:*` —— 管理台与调度器都按它解析，因此账户实体上可能残留的 `groupId` 字段不参与归属判定，SHALL 视为惰性数据，且每次保存都会被再剔除一次。清除该残留字段 MUST NOT 以逐平台推导实体 key 前缀为代价（8 类账户前缀各不相同，推错会写坏别的 key）。

#### Scenario: 导入 2.1 备份剥离悬空引用
- **WHEN** 导入 `metadata.version` 为 2.1 的备份
- **THEN** 写回的账户 SHALL 不含 `groupId` 字段，SHALL 产生剥离警告，后续在后台编辑保存 SHALL 返回 200

#### Scenario: 运行时悬空引用不打挂保存
- **WHEN** 某账户的 `groupId` 指向一个不存在的分组，管理员在后台编辑该账户并保存
- **THEN** SHALL 返回 200 且 MUST NOT 返回 500，该悬空 gid SHALL 不出现在任何成员集合中、SHALL 从反向索引中被清除、SHALL 记录一条 warn 日志，且该次保存的其余字段 SHALL 正常写入

### Requirement: 账户索引必须具备版本化重建能力

系统 SHALL 提供账户索引的版本化重建能力，以 `account:index:version` 为版本标记，在服务启动时检查并在版本落后时后台异步重建，MUST NOT 阻塞启动。

重建 SHALL 对每个账户前缀做双向对账，以本轮扫描到的实体集合为权威：实体存在而索引缺失的 id SHALL 被补入索引；索引存在而实体缺失的 id SHALL 从索引移除。扫描与索引读取 SHALL 在同一轮内完成，MUST NOT 跨轮复用扫描结果。实体集合非空时 SHALL 清除该索引的 `:empty` 空标记；实体集合为空时 MUST NOT 主动写入空标记。

单个前缀的重建失败 SHALL 被隔离并计入 errors，MUST NOT 中断其余前缀。仅当全部前缀成功时才 SHALL 写入版本标记，使失败的重建在下次启动时重试。

此能力是导入路径索引写入的兜底，MUST NOT 被当作主路径 —— 导入 SHALL 保证还原数据立即可见，重建 SHALL 保证最终一致。

#### Scenario: 补齐缺失的索引条目
- **WHEN** 某账户实体存在但其 id 不在索引集合中，重置版本标记后重启服务
- **THEN** 重建完成后索引集合 SHALL 包含该 id

#### Scenario: 清理索引中的孤儿 id
- **WHEN** 索引集合中存在一个没有对应实体的 id，重置版本标记后重启服务
- **THEN** 重建完成后该 id SHALL 已从索引集合移除

#### Scenario: 重建失败不写版本号
- **WHEN** 某个前缀的重建过程抛出异常
- **THEN** 该前缀 SHALL 计入 errors，其余前缀 SHALL 继续重建，版本标记 MUST NOT 被写入

### Requirement: 备份文件必须被标注为最高敏感级并说明其密钥绑定前提

导出结果与操作日志 SHALL 明确标注备份文件为最高敏感级 —— 它含全部账户凭据密文与明文管理员凭据（`data/init.json` 的 `adminPassword` 是明文，非哈希），且本能力**不**提供文件级口令加密。

导出结果 SHALL 同时说明恢复的前提条件：备份中的凭据密文与导出实例的 `ENCRYPTION_KEY` 硬绑定，仅能在使用同一 `ENCRYPTION_KEY` 的实例上恢复。本能力不提供跨密钥重加密；`ENCRYPTION_KEY` 与库中密文的一致性核对由 `encryption-key-consistency` 能力定义。

#### Scenario: 敏感级警示
- **WHEN** 管理员导出备份
- **THEN** 导出结果 SHALL 标注该文件含明文管理员凭据与全部账户密文
- **AND** SHALL 说明本产物无文件级口令保护，须按机密文件保管

#### Scenario: 恢复前提说明
- **WHEN** 管理员导出备份
- **THEN** 导出结果 SHALL 说明该备份仅可在使用同一 `ENCRYPTION_KEY` 的实例上恢复
- **AND** MUST NOT 暗示备份可在任意实例上直接恢复

### Requirement: 导出必须声明其密文所绑定的密钥指纹并给出可读提示

导出产物 SHALL 在 `metadata.encryption` 中声明导出实例的密钥指纹与派生方式，并附一段可读提示，说明目标机 `ENCRYPTION_KEY` 不同时备份中的账户凭据与已发放 API Key 都不能直接使用。指纹 SHALL 复用 `encryption-key-consistency` 能力所定义的派生方式（加盐 KDF 后截断），MUST NOT 为 `sha256(ENCRYPTION_KEY)`，也 MUST NOT 写入密钥明文或其任何未加盐摘要。

提示文案 SHALL 分别说明两类后果，因为二者的补救办法不同：账户凭据为可逆密文，密钥不一致时表现为上游 401，可在目标机重新授权或重录；已发放的 API Key 以 `sha256(明文 + ENCRYPTION_KEY)` 存储且明文从不落库，密钥不一致时在中转入口即 401，且无法在目标机恢复，只能重新发放。

指纹 SHALL 同时可在导出响应头与备份摘要接口中获得，使管理台在导出前即可显示本机指纹。这两个出口 MUST 位于管理员鉴权之后，MUST NOT 出现在任何免鉴权的接口或静态产物中。

#### Scenario: 导出声明指纹
- **WHEN** 管理员导出备份
- **THEN** 产物的 `metadata.encryption.keyFingerprint` SHALL 为本实例密钥的指纹
- **AND** `metadata.encryption` SHALL 含派生方式说明与可读提示文案
- **AND** 产物中 MUST NOT 出现 `ENCRYPTION_KEY` 明文或其未加盐摘要

#### Scenario: 提示区分两类凭据
- **WHEN** 导出提示文案生成
- **THEN** 文案 SHALL 分别说明账户凭据与已发放 API Key 在密钥不一致时的表现与补救办法
- **AND** SHALL 明确已发放 API Key 在目标机无法恢复、只能重新发放

#### Scenario: 导出前即可核对本机指纹
- **WHEN** 管理员打开备份面板或调用备份摘要接口
- **THEN** 响应 SHALL 含本实例的密钥指纹
- **AND** 该指纹 SHALL 与导出产物中声明的指纹、以及启动自检日志中输出的指纹逐字相同

#### Scenario: 指纹出口受鉴权保护
- **WHEN** 未通过管理员鉴权的请求访问导出或摘要接口
- **THEN** 请求 SHALL 被拒绝，指纹 MUST NOT 被返回

### Requirement: 导入必须比对密钥指纹并以告警提示，且不得因此拒绝导入

导入时 SHALL 比对备份声明的指纹与本实例指纹：不一致时 SHALL 在导入结果的 `warnings` 中登记一条并记 warn 级日志，说明账户凭据与已发放 API Key 的后果；一致时 MUST NOT 产生任何告警（正常迁移是主流路径，主流路径上的告警会让告警整体失效）；备份未声明指纹或任一侧指纹不可用时 SHALL 跳过比对并以 info 记录，MUST NOT 报为不一致。

比对结果 MUST NOT 阻断导入。已知密钥不同而仅需还原标签、分组结构或管理员凭据是正当操作，拒绝写入会一并堵死该操作。

判定 SHALL 以「备份是否声明了可用指纹」为条件，MUST NOT 由备份版本号推断 —— 指纹派生失败时最新版本的产物同样缺少可比对的指纹。

#### Scenario: 指纹不一致
- **WHEN** 备份声明的指纹与本实例指纹不同
- **THEN** 导入 SHALL 继续并完成写入，MUST NOT 拒绝
- **AND** `warnings` SHALL 含一条指纹不一致的告警，说明账户凭据表现为上游 401、已发放 API Key 只能重新发放
- **AND** 系统 SHALL 记一条 warn 级日志

#### Scenario: 指纹一致
- **WHEN** 备份声明的指纹与本实例指纹相同
- **THEN** 导入结果 MUST NOT 因此新增任何告警
- **AND** MUST NOT 产生 warn 或 error 级日志

#### Scenario: 备份未声明指纹
- **WHEN** 导入 `2.0` / `2.1` / `2.2` 等未声明指纹的备份，或任一侧指纹不可用
- **THEN** 系统 SHALL 跳过比对并以 info 记录跳过原因
- **AND** MUST NOT 报为不一致，MUST NOT 产生告警
