## 设计决策

### D1 `admin_credentials` 使用专用读写入口，而非继续复用 `setSession` / `getSession`

在 `redis.js` 新增一对专用方法，三条写入路径与两条读取路径全部收口到它们：

```
setAdminCredentials(data)   →  hset session:admin_credentials <data>
                               persist session:admin_credentials

getAdminCredentials()       →  hgetall → 空对象归一为 null
```

不选择「把 `setSession` 的第三参改成可选、传 `null` 时不 expire」这一改法。`setSession` 有大量会话调用方，给它增加「有时不过期」的分支会让会话语义变得依赖调用点，而 `admin_credentials` 根本不是会话——它是配置。用独立入口表达独立语义，回归面也只限于这一把 key。

key 名 `session:admin_credentials` 保持不变。它已被 `app.js:580` 的会话清理逻辑显式排除，改名会牵动那处判断、备份导入的 key 匹配以及现网数据迁移，收益为零。

### D2 必须显式 `persist`，仅改写入方式不足以治愈现网

这是本变更最容易漏的一点。Redis 语义下，**`hset` 到一个已带 TTL 的 hash key 不会清除该 key 的 TTL**——`expire` 是 key 级属性，字段写入不重置它。

因此若只是把 `setSession` 换成裸 `hset`，现网那些历史遗留的带 TTL key（任意一次服务重启或改密留下的）仍会在到点时蒸发，缺陷表现为「改完代码上线后仍然复发一次」，且极难归因。

`setAdminCredentials` MUST 在 `hset` 之后无条件执行 `persist`。无条件而非「先查 ttl 再决定」：`persist` 对本就没有 TTL 的 key 是无害幂等操作，多一次判断只增加竞态窗口。

### D3 读取侧归一在入口内完成，而不是在每个调用点加检查

`getAdminCredentials` 内部把 `hgetall` 的 `{}` 归一为 `null`，使调用点沿用直觉写法 `if (!adminData)` 即可正确工作。

不选择「在 `getSession` 层面统一归一 `{}` → `null`」。那会影响全部会话读取点，其中若有依赖「拿到空对象而非 null」的写法就会静默改变行为，回归面远超本变更的必要范围。

也不选择「在改密路径补一行 `Object.keys(adminData).length === 0`」。那只是把 `500 Internal server error` 换成 `500 Admin data not found`——错误信息变准确了，**但管理员依然改不了密码**。守卫的作用是不让 `undefined` 流进 bcrypt，不是让功能可用；可用性靠 D4。

### D4 改密路径必须补 init.json 兜底重载，与登录路径对齐

判定 key 缺失后，改密路径 SHALL 走与 `web.js:47-84` 相同的兜底：读 `init.json`、`bcrypt.hash` 现算、经 `setAdminCredentials` 回写，然后继续本次改密流程，而不是向用户报错。

理由是这条路径上「缓存缺失」根本不是错误状态。`init.json` 是 single source of truth，缓存随时可以从它重建；让管理员因为一个可自愈的缓存缺失而无法改密，是把内部实现细节泄露成用户故障。

兜底逻辑 MUST 抽成两条路径共用的一个函数，MUST NOT 在改密处复制粘贴一份。两套契约正是 D2 缺陷的成因，复制会保留这个成因。

### D5 单位修正改配置默认值，而非在调用点做换算

`adminSessionTimeout` 的语义统一为**秒**，默认值由 `86400000` 改为 `86400`，注释与 `ADMIN_SESSION_TIMEOUT` 环境变量的文档同步说明单位。

不选择「保留毫秒语义、在两处 `setSession` 调用点除以 1000」。已核实全仓仅 4 处引用（`web.js:110/383` 喂 `expire`、`web.js:122/388` 作响应字段），其中作响应字段的两处前端并不消费。既然唯一的真实消费者要的就是秒，让配置直接是秒最省心；保留毫秒则等于永久维持一个「配置单位与唯一消费者单位不一致」的陷阱，下一个调用方还会再踩。

已核实的前端消费情况：`web/admin-spa/src/stores/auth.js` 仅 `localStorage.setItem('authToken', result.token)`，全程不读 `expiresIn`。`AccountForm.vue` 中密集出现的 `expiresIn` / `expiresInMs` 属上游 OAuth 账号凭据（Claude / Gemini / Droid），与管理员会话无关。

对现网 `.env`：该实例未设置 `ADMIN_SESSION_TIMEOUT`，走默认值，故改默认值即生效。若其他部署显式设了毫秒值，升级说明 MUST 提示按秒重设——这属于配置语义变更，靠文档而非代码兼容来承接（见「已否决方案」否决三）。

### D6 `expiresIn` 响应字段保持返回，语义随之变为秒

尽管当前前端不消费，`expiresIn` 仍是公开响应字段，MUST NOT 借本次变更删除。单位随配置一并变为秒，与 OAuth 生态中 `expires_in` 的惯例（秒）一致，反而消除了原先的反直觉。

### D7 日志脱敏复用既有 `sanitizeRequestBodySnapshot`，不新写脱敏函数

`auth.js:1781`（debug 分支）与 `auth.js:1812`（`res.on('finish')` 分支）两处的 `req.body` MUST 经 `requestDetailHelper.sanitizeRequestBodySnapshot` 后再进日志 meta。

已核实 `SENSITIVE_KEY_PATTERN` 为无锚点子串匹配且含 `password`，故 `currentPassword` / `newPassword` 天然覆盖，**无需扩充黑名单**。该函数还附带深度、数组长度、字符串长度与总量截断，对访问日志同样是收益。

不新写一个轻量脱敏函数。两套黑名单必然漂移——一处补了字段另一处忘补，是典型的长期腐化点。

两处都要改，MUST NOT 只改 `res.on('finish')` 那处：debug 分支在 `logger` 级别放开时同样落盘明文，遗漏它等于脱敏形同虚设。

### D8 落地顺序：D1+D2 一批，D3 单独，D4 随时

```
   第一批  D1 持久化 + D2 守卫归一 + D4-兜底重载
           └─ 纯缺陷修复，无对外行为变更，可直接上线

   第二批  D3 单位修正
           └─ BREAKING：现存 token 全失效
           └─ 上线前需确认操作者手上有可用凭据（见 tasks 5.1）

   随时    D7 日志脱敏
           └─ 独立、无耦合，不必等前两批
```

D3 MUST NOT 与第一批同批上线。第一批修完后，改密功能即恢复可用；此时再做 D3，操作者可以先用恢复了的改密功能轮换掉已泄露的密码，再让所有 token 失效。顺序颠倒的话，token 全失效发生在密码轮换之前，泄露的旧密码仍是有效凭据。

### D9 验证必须覆盖「重启后 TTL 仍为 -1」

`app.js:552` 是三条写入路径中唯一会在无人操作时自行触发的一条，也是最容易在修复中被遗漏的一条（改密路径症状明显，启动路径静默）。验收 SHALL 包含一次真实重启后的 `ttl session:admin_credentials` 复核，期望 `-1`。

仅验证「改密后 ttl=-1」不足以证明 D1 修完。

## 已否决方案

### 否决一：给 `admin_credentials` 续一个超长 TTL（如 10 年）

改动最小，但语义仍是错的——凭据不是会话，用过期时间表达「永久」只是把问题推到未来某个无人记得的时点。且它不解决「启动路径与改密路径各自盖 TTL、兜底路径不盖」的不一致，下一个改动者仍会困惑于三条路径为何不同。

### 否决二：靠「改密后强制重新登录」触发兜底重载来自愈

看似成立——`web.js:272` 本来就删掉当前会话强制重登。但兜底重载只在 **key 缺失** 时触发，而改密刚刚写入的 key 此刻还在（带 24h TTL），兜底不会触发。真正到期是 24 小时之后，届时是否有人登录纯属运气。把正确性建立在「用户恰好会在某个时间窗内登录」上不可靠。

### 否决三：为 `ADMIN_SESSION_TIMEOUT` 做毫秒/秒自动识别（如 `> 100000` 视为毫秒）

启发式猜测配置单位会引入新的不可预测性：`86400` 秒（1 天）与 `86400` 毫秒（86 秒）都是合法意图，阈值法必然在某个区间猜错，且猜错时静默。配置单位应当由文档明确，而非由代码猜测。

### 否决四：把 `data/init.json` 改为存储 bcrypt hash

方向正确但超出本变更范围，见 proposal 的 Non-goals。它会连带改动 `npm run setup` 流程、两条兜底重载路径的实现（无明文可重算）、以及现网 `init.json` 的迁移，风险与本次要修的缺陷不在同一量级，混在一起会让回归定位困难。

### 否决五：在 `getSession` 层统一归一 `{}` → `null`

见 D3。回归面覆盖全部会话读取点，收益仅限一把 key。
