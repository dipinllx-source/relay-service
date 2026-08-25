## ADDED Requirements

### Requirement: 已软删除的 API Key MUST NOT 保有可鉴权的哈希映射

系统 SHALL 维持一条不变式：`isDeleted` 为 `'true'` 的 API Key，MUST NOT 在 `apikey:hash_map` 中存在指向它的字段。

API Key 的删除是软删除：实体保留、置 `isDeleted='true'` 与 `isActive='false'`，并从 `apikey:hash_map` 移除其哈希映射。移除映射是删除语义的组成部分，而非附带清理 —— 映射是「明文 key → keyId」的唯一可逆路径，`findApiKeyByHash` 无法从实体反推哈希，映射缺失即等价于该明文 key 不再可用。

该不变式 SHALL 由全部三处映射写入点共同守住，MUST NOT 只在删除路径单点保证：

| 写入点 | 要求 |
|---|---|
| `setApiKey`（创建 / 更新） | 仅在传入哈希且目标 key 未软删除时写映射 |
| `apiKeyIndexService.rebuildHashMap`（启动回填） | 逐条校验 `isDeleted !== 'true'` 后才回填 |
| 备份导入的 `apikey:hash_map` 字段合并 | 目标实体缺失或已软删除时跳过并告警 |

鉴权路径 SHALL 独立校验实体的 `isActive` 与 `isDeleted`，MUST NOT 把「映射不存在」当作唯一闸门。两道闸门是纵深防御关系：映射缺失阻断查找，状态校验阻断使用；任一道被绕过时另一道仍 SHALL 生效。

#### Scenario: 软删除后重启不复活鉴权能力
- **WHEN** 管理员软删除一个 API Key，随后服务重启并执行启动回填
- **THEN** `apikey:hash_map` 中 MUST NOT 出现指向该 keyId 的字段，使用该明文 key 发起请求 SHALL 鉴权失败

#### Scenario: 清理历史残留映射
- **WHEN** 升级前已存在若干「已软删除但仍有映射」的 API Key，升级后服务启动
- **THEN** 这些残留映射 SHALL 被移除，SHALL 以 info 级日志记录被清理的 keyId 列表与条数

#### Scenario: 状态闸门独立生效
- **WHEN** 某已软删除 key 的映射因任何原因仍然存在，使用该明文 key 发起请求
- **THEN** 鉴权 SHALL 因实体 `isActive` 非 `'true'` 而失败，MUST NOT 因映射存在就放行

### Requirement: 哈希映射重建必须双向收敛

启动回填 SHALL 对 `apikey:hash_map` 做双向对账，以本轮扫描到的实体集合为权威，MUST NOT 只做单向补齐：

| 情形 | 动作 |
|---|---|
| 实体活跃且映射缺失 | 补写映射 |
| 实体已软删除且映射存在 | 移除映射 |
| 映射存在而实体不存在 | 移除映射（孤儿映射） |
| 实体活跃且映射已存在 | 不动（MUST NOT 覆盖已有字段） |

移除「实体不存在」的孤儿映射前 SHALL 二次确认实体确实不存在，避免与并发创建的 key 竞争而误删刚写入的映射。扫描与映射读取 SHALL 在同一轮内完成，MUST NOT 跨轮复用扫描结果 —— 复用会把两个时间点的状态混算，导致本该保留的映射被判为孤儿。

回填与清理 SHALL 分别计数并在完成日志中区分呈现（补写条数、因软删除移除条数、因孤儿移除条数）。单条记录处理失败 SHALL 被隔离并计入 errors，MUST NOT 中断整轮对账。

回填 MUST NOT 阻塞服务启动。

#### Scenario: 补齐活跃 key 的缺失映射
- **WHEN** 某活跃 API Key 的实体存在但 `apikey:hash_map` 中无其映射，服务重启
- **THEN** 回填完成后该映射 SHALL 存在，该 key SHALL 可正常鉴权

#### Scenario: 清理孤儿映射
- **WHEN** `apikey:hash_map` 中存在一个指向已不存在实体的字段，服务重启
- **THEN** 该字段 SHALL 被移除，并计入「孤儿移除」计数

#### Scenario: 不覆盖已有映射
- **WHEN** 某哈希在 `apikey:hash_map` 中已映射到 keyId B，回填过程遇到同一哈希对应 keyId A
- **THEN** SHALL 保留 B，MUST NOT 覆盖

#### Scenario: 单条失败不中断整轮
- **WHEN** 对账过程中某条记录读取抛出异常
- **THEN** 该条 SHALL 计入 errors，其余记录 SHALL 继续处理

### Requirement: 恢复与永久删除必须维护哈希映射与索引族

从回收站恢复 API Key 时，系统 SHALL 在清除删除标记的同时重新写入其哈希映射，使恢复后的 key 立即可鉴权，MUST NOT 依赖下次启动回填。此项是收紧不变式后新暴露的路径：在回填无条件补齐映射的旧行为下，恢复路径漏写映射会被启动回填掩盖；一旦回填开始校验 `isDeleted`，漏写将变成「恢复后 key 永久不可用」。

永久删除 API Key 时，系统 SHALL 同时移除其实体、其在 API Key 索引族（`apikey:idx:*` 与 `apikey:set:*`）中的全部成员，以及 `apikey:hash_map` 中的映射，MUST NOT 留下孤儿映射或孤儿索引成员。

已软删除的 API Key MUST NOT 留在活跃集合 `apikey:set:active` 中，SHALL 在回收站集合 `apikey:set:deleted` 中 —— 活跃列表与回收站列表 SHALL 分别以这两个集合为准，二者 MUST NOT 同时包含同一 id。

API Key 侧 MUST NOT 为此另造 `apikey:index` 之类的新索引集合 —— 该 key 在系统中不存在，其形状来自账户侧的 `<平台前缀>index`，与本侧索引族不同构；任何写入路径引入它都会造出一个无人读取、必然漂移的派生数据。

#### Scenario: 恢复后立即可鉴权
- **WHEN** 管理员从回收站恢复一个被软删除的 API Key，且**不重启服务**
- **THEN** 使用该明文 key 发起请求 SHALL 鉴权成功，`apikey:hash_map` SHALL 包含其映射

#### Scenario: 永久删除不留残迹
- **WHEN** 管理员对一个已软删除的 API Key 执行永久删除
- **THEN** 其实体、其在 `apikey:idx:*` / `apikey:set:*` 中的成员与 `apikey:hash_map` 映射 SHALL 全部不存在，后续启动回填 MUST NOT 产生与之相关的告警

#### Scenario: 软删除 key 不占活跃索引
- **WHEN** 某 API Key 被软删除
- **THEN** `apikey:set:active` MUST NOT 包含其 id，`apikey:set:deleted` SHALL 包含其 id，回收站列表 SHALL 仍能列出该 key 并允许恢复
