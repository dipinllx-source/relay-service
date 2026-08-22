## ADDED Requirements

### Requirement: 管理员凭据的写入路径自身不得设置过期时间

`session:admin_credentials` SHALL 以不带 TTL 的方式写入 Redis，所有写入路径 MUST NOT 对该 key 设置任何过期时间。

该 key 承载的是配置而非会话。代码中已存在两处「它应当永久有效」的明确表达：`web.js:68` 的写入注释「不设置过期时间」，以及 `app.js:580` 在会话清理中以「系统凭据」为由显式跳过它。但 `app.js:552` 与 `web.js:262` 经 `redis.setSession()` 写入，而该方法无条件执行 `expire(key, ttl=86400)`，使凭据在 24 小时后蒸发。

写入 MUST 收口到专用入口，MUST NOT 复用 `setSession`。给 `setSession` 增加「有时不过期」的分支会使会话语义依赖调用点。

本要求只约束**写入侧**。凭据在 Redis 中的最终存活时长并不由写入侧单方面决定 —— 每小时执行的 `redis.cleanup()` 会把 `session:*` 下 `ttl === -1` 的 key 盖上 86400，详见后文「周期清理会重新施加过期时间」一节。因此下列场景的断言限定为**写入完成的即刻**。

#### Scenario: 服务启动初始化凭据

- **WHEN** 服务启动并从 `data/init.json` 加载管理员凭据写入 Redis
- **THEN** 写入完成的即刻，`session:admin_credentials` SHALL 存在且 `TTL` 为 `-1`
- **AND** 写入路径 MUST NOT 对该 key 执行 `expire`

#### Scenario: 改密成功后回写凭据

- **WHEN** 管理员成功修改账号信息，新的 `passwordHash` 被写回 Redis
- **THEN** 写入完成的即刻，`session:admin_credentials` 的 `TTL` SHALL 为 `-1`
- **AND** 该 key MUST NOT 因本次写入而获得过期时间

#### Scenario: 登录时发现凭据缓存缺失

- **WHEN** 登录流程发现 `session:admin_credentials` 不存在并从 `init.json` 重建
- **THEN** 重建完成的即刻，该 key 的 `TTL` SHALL 为 `-1`
- **AND** 重建 SHALL 走与其它写入路径相同的专用入口

#### Scenario: 服务重启后的写入同样不带过期

- **WHEN** 服务经历一次完整重启
- **THEN** 启动写入完成的即刻，`session:admin_credentials` 的 `TTL` SHALL 为 `-1`
- **AND** 该结果 SHALL 被纳入验收核对，MUST NOT 仅以「改密后 TTL 正确」推断启动路径正确

### Requirement: 凭据写入必须显式清除该 key 上已有的过期时间

凭据写入 SHALL 在字段写入后无条件执行 `PERSIST`，以清除该 key 上可能由历史版本遗留的过期时间。

Redis 中 `expire` 是 key 级属性，`HSET` 写入字段**不会**重置或清除已存在的 TTL。因此仅把写入方式从 `setSession` 改为裸 `HSET` 并不足以治愈现网：升级前由旧代码留下的带 TTL key 仍会在到点时蒸发，表现为「修复上线后仍复发一次」，且因为症状与修复内容看似无关而极难归因。

`PERSIST` MUST 无条件执行，MUST NOT 先查询 TTL 再决定是否执行。该操作对本无 TTL 的 key 是幂等无害的，增加判断只会扩大竞态窗口。

#### Scenario: 升级后首次写入命中历史遗留的带 TTL key

- **WHEN** 升级前的 `session:admin_credentials` 带有剩余 TTL，升级后任一写入路径对其写入
- **THEN** 写入完成后该 key 的 `TTL` SHALL 为 `-1`
- **AND** 该 key MUST NOT 在原定到期时刻蒸发

#### Scenario: 写入命中本就无 TTL 的 key

- **WHEN** 目标 key 已存在且 `TTL` 为 `-1`
- **THEN** 写入与 `PERSIST` SHALL 正常完成且结果仍为 `-1`
- **AND** MUST NOT 产生错误或告警

### Requirement: 周期清理会重新施加过期时间，凭据缓存允许周期重建

`session:admin_credentials` 被每小时的周期清理盖上 24 小时过期、并因此周期性重建这一行为 SHALL 作为已知限制予以接受，MUST NOT 被当作缺陷修复。

`redis.cleanup()`（每小时由 `app.js` 的 `startCleanupTasks()` 调度，`cleanupInterval` 默认 3600000ms）会扫描 `session:*` 等前缀，对 `ttl === -1` 的 key 一律 `expire(key, 86400)`，其语义是「没有过期时间视为漏设」。这构成本变更最初未识别的**第四条**写入路径 —— 前三条是被动写入者，而它是主动把 `ttl=-1` 转换为 86400 的周期转换器，因此写入侧的 `PERSIST` 无论多正确都只能维持不到一个清理周期。

由此凭据缓存呈以下循环：写入后 `ttl=-1` → 一小时内被盖 86400 → 24 小时后 key 消失 → 下一次访问从 `init.json` 自愈重建 → 复归 `ttl=-1`。

接受而非修正的理由：本变更的自愈要求已使该循环对使用者**完全不可见**。凭据缺失时登录、改密、获取用户信息三条路径均从 `init.json` 重建并正常返回，改密不再返回 5xx。残留代价仅为每轮一次 `bcrypt.hash` 重算，以及 `lastLogin` 等运行时元数据随重建回落到 `init.json` 的值。相比之下，两种修正方案各有其代价：在 `redis.cleanup()` 中排除该 key 会在清理逻辑里引入特例，而把凭据迁出 `session:` 键空间需要现网数据迁移并牵动备份读写的兼容性。

#### Scenario: 清理周期到来时凭据被盖上过期时间

- **WHEN** 凭据 key 的 `ttl` 为 `-1`，且 `redis.cleanup()` 的调度周期到达
- **THEN** 该 key SHALL 被设置为 86400 秒过期
- **AND** 该结果 MUST NOT 被判定为写入路径的缺陷

#### Scenario: 凭据因过期消失后自愈

- **WHEN** 凭据 key 因上述过期而消失，随后有登录、改密或获取用户信息的请求到达
- **THEN** 系统 SHALL 从 `init.json` 重建凭据并正常完成该请求
- **AND** 改密请求 MUST NOT 因此返回 5xx

#### Scenario: 登录会话不受该清理影响

- **WHEN** 周期清理扫描 `session:*`
- **THEN** 已带 TTL 的登录会话 key（`ttl !== -1`）SHALL 不被改动
- **AND** 管理员的登录状态 MUST NOT 因该清理而失效

#### Scenario: 元数据随重建回落

- **WHEN** 凭据经自愈重建
- **THEN** `lastLogin` 等运行时元数据 SHALL 回落到 `init.json` 所能提供的值
- **AND** 该损失 SHALL 被视为已接受的代价，MUST NOT 阻塞重建

### Requirement: 凭据读取必须把 Redis 空对象归一为空值

管理员凭据的读取入口 SHALL 在返回前把 `HGETALL` 的空对象结果归一为 `null`，使调用方的 `if (!adminData)` 守卫真正生效。

`redis.getSession()` 直接返回 `HGETALL` 结果，Redis 语义下 key 不存在时返回**空对象而非 null**，而 `!{}` 为 `false`。`web.js:207` 的守卫因此被绕过，`adminData.passwordHash` 取到 `undefined` 并流入 `bcrypt.compare`，`bcryptjs` 抛 `Illegal arguments: string, undefined`，最终被外层 catch 兜成 `500 Internal server error`。

归一 MUST 在专用读取入口内部完成。MUST NOT 改动 `getSession` 的通用行为——那会影响全部会话读取点，其中若有依赖「取到空对象」的写法将静默改变行为，回归面远超必要范围。

#### Scenario: 凭据 key 不存在

- **WHEN** `session:admin_credentials` 在 Redis 中不存在，调用凭据读取入口
- **THEN** 入口 SHALL 返回 `null`
- **AND** MUST NOT 返回空对象

#### Scenario: undefined 不得流入密码比对

- **WHEN** 凭据缺失且请求进入改密流程
- **THEN** 流程 MUST NOT 以 `undefined` 作为参数调用 `bcrypt.compare`
- **AND** MUST NOT 返回 `500 Internal server error`

### Requirement: 改密流程在凭据缓存缺失时必须自愈而非报错

改密流程判定凭据缓存缺失后 SHALL 从 `data/init.json` 重建凭据并继续本次改密，MUST NOT 向调用方返回错误。

`data/init.json` 是管理员凭据的 single source of truth，Redis 中的副本随时可以从它重建。缓存缺失在这条路径上不是错误状态，而是一个可自愈的中间态。让管理员因为一个可自愈的缓存缺失而无法修改账号信息，等于把内部实现细节泄露成用户可见故障——现网正是如此：登录侧有兜底所以一切正常，改密侧没有所以必然 500，两者反差使缺陷潜伏了 15 天。

重建逻辑 MUST 由登录路径与改密路径共用同一实现，MUST NOT 在两处各写一份。「同一份数据、两套读取契约」正是本缺陷的成因，复制实现会保留这个成因。

#### Scenario: 改密时凭据缓存已蒸发

- **WHEN** 管理员携带有效会话请求改密，而 `session:admin_credentials` 不存在
- **THEN** 系统 SHALL 从 `init.json` 重建凭据并以重建结果校验 `currentPassword`
- **AND** 校验通过时 SHALL 正常完成改密并返回成功
- **AND** MUST NOT 因缓存缺失返回 5xx

#### Scenario: 当前密码确实错误

- **WHEN** 凭据经重建后可用，但 `currentPassword` 与之不匹配
- **THEN** 系统 SHALL 返回 `401` 并提示当前密码错误
- **AND** MUST NOT 写入 `init.json` 或更新 Redis 凭据

#### Scenario: init.json 缺失导致无法重建

- **WHEN** 凭据缓存缺失且 `data/init.json` 不存在
- **THEN** 系统 SHALL 返回明确指向配置文件缺失的错误
- **AND** 错误信息 MUST NOT 是通用的 `Internal server error`

#### Scenario: 两条路径共用同一重建实现

- **WHEN** 审阅登录路径与改密路径的凭据缺失处置
- **THEN** 二者 SHALL 调用同一个重建函数
- **AND** MUST NOT 存在两份各自维护的重建逻辑
