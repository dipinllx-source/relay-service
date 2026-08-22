## Why

`POST /web/auth/change-password` 自 2026-08-07 起**必然返回 500**，持续 15 天无人发现。触发点是一行 `bcrypt.compare` 拿到了 `undefined`，但根因是「管理员凭据被当成会话来存」——而真正让它潜伏这么久的，是另一个把它的自愈路径掐断的单位错误。

三个缺陷咬合成一个稳定的失败态，任何单独一个都不足以造成现网症状：

| 编号 | 缺陷 | 角色 |
|---|---|---|
| D1 | `admin_credentials` 经 `setSession` 写入，被无条件盖 24h TTL | **根因** —— 凭据到点蒸发 |
| D2 | `if (!adminData)` 对 `hgetall` 返回的 `{}` 无效，`undefined` 喂进 bcrypt | **放大器** —— 把「缓存缺失」升级成 500 |
| D3 | `adminSessionTimeout` 毫秒当秒用，token 活 ~985 天 | **掩盖者** —— 让 D1 的自愈路径永不触发 |

外加一条与上述正交、本次排查顺带发现的泄露：

| 编号 | 缺陷 | 角色 |
|---|---|---|
| D4 | 访问日志原样落盘请求体，`logs/` 中存有明文 `currentPassword` / `newPassword` | 独立安全问题 |

### D1 `admin_credentials` 复用了会话的写入语义

`redis.js:2485` 的 `setSession` 第三参默认 24 小时，且**无条件** `expire`：

```js
async setSession(sessionId, sessionData, ttl = 86400) {
  const key = `session:${sessionId}`
  await this.client.hset(key, sessionData)
  await this.client.expire(key, ttl)      // ← 无条件
}
```

三条写入 `session:admin_credentials` 的路径里，两条用了它，一条没用：

| 路径 | 位置 | 写法 | 产物 |
|---|---|---|---|
| 服务启动初始化 | `app.js:552` | `setSession(...)` | `ttl=24h` ✗ |
| 改密成功后 | `web.js:262` | `setSession(...)` | `ttl=24h` ✗ |
| 登录时发现 key 已丢失 | `web.js:68` | `getClient().hset(...)` | `ttl=-1` ✓ |

只有第三条正确，而它的注释写着「重新存储到Redis，不设置过期时间」——说明**永久存储的意图在代码里是明确的**，只是另两条路径没有遵守。

同一个 `app.js` 在 580 行还专门把它从会话清理里排除：

```js
// 跳过 admin_credentials（系统凭据）
if (key === 'session:admin_credentials') { continue }
```

意图上是「系统凭据、永久有效、清理时绕开」，实现上却在写入瞬间就盖了 24 小时过期。这个自相矛盾是 D1 的本质。

后果是**健康态只能由异常分支产出**：

```
   app.js:552  服务启动    ─┐
                            ├─▶ setSession ─▶ ttl=24h  ← 病态（正常路径）
   web.js:262  改密成功    ─┘

   web.js:68   登录时发现  ───▶ 裸 hset    ─▶ ttl=-1   ← 健康（异常路径，唯一来源）
               key 已丢失
```

系统的正常操作（启动、改密）产出的全是 24 小时后自毁的病态；唯一能产出永久健康态的，是本意只作兜底的「登录时恰好发现 key 没了」这条分支。

### D2 空对象守卫是哑弹，把缓存缺失升级成 500

`getSession` 就是 `hgetall`（`redis.js:2491`），Redis 语义下 key 不存在返回**空对象而非 null**。改密路径（`web.js:207`）：

```js
const adminData = await redis.getSession('admin_credentials')
if (!adminData) { return res.status(500).json({ error: 'Admin data not found' }) }
                                        // ← !{} === false，守卫被绕过
const isValidPassword = await bcrypt.compare(currentPassword, adminData.passwordHash)
                                        // ← passwordHash === undefined，bcryptjs 抛错
```

`bcryptjs` 对 `undefined` 抛 `Illegal arguments: string, undefined`，被外层 catch 兜成 `500 Internal server error`。

对照登录路径（`web.js:47`），同一份数据、两套读取契约：

| | 空对象检查 | init.json 兜底重载 |
|---|---|---|
| 登录 `web.js:47-84` | ✓ `!adminData \|\| Object.keys(adminData).length === 0` | ✓ 重算 hash 并裸 hset 回写 |
| 改密 `web.js:207-216` | ✗ 仅 `!adminData` | ✗ 无 |

正因为登录侧有兜底，**登录一直是正常的**，管理员完全感知不到凭据缓存早已消失——只有改密这一条路会撞墙。这解释了为什么缺陷能潜伏 15 天。

### D3 毫秒当秒，放大 1000 倍，并因此掩盖 D1

`config.js:47` 的值是毫秒（注释自陈「24小时」）：

```js
adminSessionTimeout: parseInt(process.env.ADMIN_SESSION_TIMEOUT) || 86400000,  // 24小时
```

`web.js:110` 与 `web.js:383` 把它直接喂给 `setSession` 的第三参，而那里的单位是**秒**：

```
86400000 秒 ÷ 86400 = 1000 天
```

现网实测印证：

```
session:61bbd69c...  ttl=85077793   ≈ 985 天
session:7497ae72...  ttl=85081617   ≈ 985 天
```

真正的危害不是「token 太长命」这一条，而是它**掐断了 D1 的自愈**：管理员的登录态接近三年不过期 → 永远不需要重新登录 → `web.js:68` 那条唯一能产出健康态的兜底分支永不触发 → D1 造成的缺失态被永久固化。

D3 与 D1 的关系是乘性的，不是叠加的。

`adminSessionTimeout` 全仓仅 4 处引用，全在 `web.js`：

| 位置 | 用途 | 期望单位 | 影响 |
|---|---|---|---|
| `web.js:110` | `setSession` 第三参 | 秒 | 放大 1000 倍 |
| `web.js:383` | `setSession` 第三参 | 秒 | 放大 1000 倍 |
| `web.js:122` | 登录响应 `expiresIn` | — | 前端不消费 |
| `web.js:388` | 刷新响应 `expiresIn` | — | 前端不消费 |

已核实前端 `web/admin-spa/src/stores/auth.js` 只取 `result.token` 存 localStorage，从未读取 `expiresIn`（`AccountForm.vue` 中的 `expiresIn` 属上游 OAuth 账号凭据，与管理员会话无关）。因此单位修正**没有前端爆炸半径**，真正的消费者只有那两个 `expire()`。

### D4 访问日志原样落盘请求体

`auth.js:1812` 与 `auth.js:1781` 直接把 `req.body` 塞进日志 meta，无任何过滤：

```js
if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
  meta.req = req.body
}
```

于是 `logs/` 里躺着明文：

```json
"req": { "currentPassword": "<明文>", "newPassword": "<明文>" }
```

值得注意的是，脱敏设施**本来就有且已够用**：`src/utils/requestDetailHelper.js` 导出的 `sanitizeRequestBodySnapshot`，其 `SENSITIVE_KEY_PATTERN` 含无锚点的 `password` 子串匹配，`currentPassword` / `newPassword` 天然在覆盖范围内。问题纯粹是**访问日志这条路径没接上去**。

### 三者的顺序效应

单修任何一个都留有残缺，这是本变更把三项合并的理由：

```
   只修 D2  ─▶ 改密不再 500，但成功那次仍盖 24h TTL
              → key 依旧蒸发，只是蒸发后能自愈（每次登录重算 hash）
              → 不致命，但每天在无声地做无用功

   只修 D1  ─▶ key 不再蒸发
              → 但 D2 的守卫仍是哑弹，任何其他致 key 缺失的原因
                （redis flush / 备份导入未覆盖该 key / 手工误删）都会重现 500

   只修 D3  ─▶ token 24h 过期 → 每天重新登录 → 每天触发兜底重载
              → D1 被「日常自愈」掩盖得更彻底
              → 改密成功后的 24h 窗口内仍会 500

   三者同修 ─▶ 根因消除(D1) + 守卫兜底(D2) + 掩盖者移除(D3) + 泄露止血(D4)
```

### 现网证据时间线

| 时间（东八区） | 事件 | 依据 |
|---|---|---|
| 08-06 11:16:24 | 唯一一次改密成功 | 日志 `Admin password changed successfully`；`init.json` `updatedAt=2026-08-06T03:16:23.967Z` |
| 08-07 11:16 | TTL 到期，key 蒸发 | 该次成功经 `setSession` 自盖 24h TTL |
| 08-07 ~ 08-21 | 改密必 500，登录正常，无人察觉 | 登录侧 init.json 兜底掩盖 |
| 08-21 18:31:24~18:32:46 | 5 次尝试全部 500 | 堆栈同为 `web.js:216`，`Illegal arguments: string, undefined` |
| 08-21 18:47:35 | 退出重登，恢复健康 | 日志 `Admin credentials reloaded from init.json`；实测 `ttl=-1` |

讽刺之处：**上一次成功的修改，正是这一次修改失败的原因。**

排查时点的现网状态为 `exists=1 / ttl=-1`（已由退出重登止血），但该状态脆弱——任意一次服务重启（`app.js:552` 无条件覆盖）或一次成功改密（`web.js:262`）都会把它打回 24h TTL 的病态。

## What Changes

- `admin_credentials` 改用不带 TTL 的专用持久化写入，并显式清除历史遗留 TTL；三条写入路径统一收口
- 为 `admin_credentials` 提供专用读取入口，内部把 `{}` 归一为 `null`，使 `if (!adminData)` 守卫真正生效
- 改密路径补 `init.json` 兜底重载，与登录路径的读取契约对齐
- `adminSessionTimeout` 的单位契约统一为秒，使会话过期策略真正生效
- 访问日志的请求体接入既有 `sanitizeRequestBodySnapshot`

**BREAKING**：D3 修正后，管理员会话 TTL 从 ~985 天回落到 24 小时，**所有现存 admin token 立即失效**，需重新登录；此后每 24 小时需重新登录一次。这是把「事实上从未生效的过期策略」恢复为设计意图，属预期行为变更。

## Non-goals

- **不改** `data/init.json` 明文存储管理员密码这一设计。它是 single source of truth，且登录兜底重载依赖明文现算 hash；改为只存 hash 需同时改动 setup 流程与兜底语义，另立项
- **不做** 多管理员账号与 RBAC
- **不动** 现有密码强度策略（`newPassword.length >= 8`）
- **不做** 存量日志清洗。本变更只止住新增泄露；已泄露的明文密码需通过轮换密码来失效，属运维动作
