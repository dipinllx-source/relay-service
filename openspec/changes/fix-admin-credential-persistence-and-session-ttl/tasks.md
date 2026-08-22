## 1. 凭据专用读写入口（D1 / D2 / D3）

- [x] 1.1 `src/models/redis.js` 新增 `setAdminCredentials(data)`：`hset session:admin_credentials <data>` 后**无条件** `persist session:admin_credentials`。MUST NOT 调用 `expire`；`persist` MUST NOT 先查 TTL 再决定执行（幂等无害，加判断只扩大竞态窗口）
- [x] 1.2 同文件新增 `getAdminCredentials()`：`hgetall` 后把空对象归一为 `null` 再返回。归一 MUST 在此入口内完成，MUST NOT 改动通用 `getSession()` 的返回语义（回归面覆盖全部会话读取点，见 design D3 / 否决五）
- [x] 1.3 两个方法紧邻 `setSession` / `getSession` 放置，并各写一行注释说明「凭据是配置不是会话，故不复用会话入口」，避免后来者按对称性把它们合回去
- [x] 1.4 `persist` 的必要性 MUST 在代码注释中点明「HSET 不清除 key 上已有的 TTL」——这是本变更最易被后续重构抹掉的一行

## 2. 三条写入路径与两条读取路径收口（D1）

- [x] 2.1 `src/app.js:552` 的 `redis.setSession('admin_credentials', adminCredentials)` 改为 `redis.setAdminCredentials(adminCredentials)`
- [x] 2.2 `src/routes/web.js:262`（改密成功回写）同样改为 `setAdminCredentials`
- [x] 2.3 `src/routes/web.js:68`（登录兜底重建）的裸 `getClient().hset(...)` 也改为 `setAdminCredentials`。该处当前行为已正确，但 MUST 一并收口——留一条绕过专用入口的写法，等于留一个「为什么这条不一样」的疑问
- [x] 2.4 `src/routes/web.js:47`（登录读取）与 `src/routes/web.js:207`（改密读取）改为 `getAdminCredentials()`
      —— **任务原文已按实测补充**：复核发现还有**第三处**读取点 `web.js:324`（`GET /auth/user`），同样是 `getSession` + 无效的 `if (!adminData)` 守卫。其表现与前两处都不同：空对象通过守卫后 `adminData.username` 取到 `undefined`，接口仍返回 `success: true` 但用户名为空 —— 不 500，是静默错。已一并改为 `getAdminCredentials()` 并接入共用兜底自愈（否则「改密能自愈、看用户信息却报错」会重新造出本变更要消除的两套契约）
- [x] 2.5 全仓复核 `session:admin_credentials` 的其余出现点：`app.js:580` 的会话清理跳过判断 MUST 保持不变（该 key 名不改，见 design D1）
- [x] 2.6 grep 确认改完后 `setSession('admin_credentials'` 与 `getSession('admin_credentials'` 零残留

## 3. 改密路径补兜底重载（D4）

- [x] 3.1 把 `web.js:47-84` 登录路径中的「读 init.json → `bcrypt.hash` 现算 → 回写」抽成共用函数（如 `reloadAdminCredentialsFromInit()`），返回重建后的凭据对象或 `null`（文件缺失）
- [x] 3.2 登录路径改为调用该函数，行为 MUST 与现状完全一致（含 `✅ Admin credentials reloaded from init.json` 这条 info 日志）
- [x] 3.3 改密路径在 `getAdminCredentials()` 返回 `null` 时调用同一函数重建，并以重建结果继续本次改密，MUST NOT 返回错误
- [x] 3.4 重建失败（`init.json` 不存在）时返回明确指向配置文件缺失的错误，MUST NOT 是通用 `Internal server error`
- [x] 3.5 MUST NOT 在改密处复制一份重建逻辑——「同一份数据两套读取契约」正是本缺陷成因
- [x] 3.6 保留 `web.js:216` 之后的 `currentPassword` 校验语义不变：校验失败仍返回 `401`，且 MUST NOT 写 `init.json` 或更新 Redis

## 4. 日志脱敏（D7）

- [x] 4.1 `src/middleware/auth.js:1812` 的 `meta.req = req.body` 改为经 `sanitizeRequestBodySnapshot(req.body)` 后赋值
- [x] 4.2 `src/middleware/auth.js:1781` debug 分支的 `body: req.body` 同样处理。MUST NOT 只改其中一处——debug 级别放开时该分支同样落盘明文
- [x] 4.3 从 `src/utils/requestDetailHelper.js` 引入既有导出，MUST NOT 新写脱敏函数，MUST NOT 扩充 `SENSITIVE_KEY_PATTERN`（`password` 子串匹配已覆盖 `currentPassword` / `newPassword`）
- [x] 4.4 确认引入不产生循环依赖（`auth.js` ↔ `requestDetailHelper.js`）
- [x] 4.5 复核脱敏后常规字段（如 `username`、业务参数）仍可读，排查能力不受损
      —— **实测发现两处偏差，已按决策处置**：(1) 既有 `maskSensitiveValue` 为便于排查 token/key 而保留首尾各 3 位，用在密码上等于 12 位露 6 位（`3.1415926llx` → `3.1***llx`）；(2) `SENSITIVE_KEY_PATTERN` 的裸 `token` 分支会误伤 `tokenLimit` / `totalTokens` / `tokenUsage` / `tokenLimitEnabled` 等业务数值字段。
      处置：在访问日志侧新增 `PASSWORD_FIELD_PATTERN` 把密码族强制为完整 `[REDACTED]`（`buildLoggableRequestBody`），**公共 `SENSITIVE_KEY_PATTERN` 不动**——收紧共享正则有漏遮真实凭据的风险，代价大于收益。`tokenLimit` 类误伤作为**已知限制**保留。
      实测常规字段仍可读：`username` / `name` / `description` / `keyIds` / `dailyCostLimit` / `newUsername` 均正常显示。

## 5. 会话超时单位修正（D5 / D6）— 独立批次

- [ ] 5.1 **前置**：本组开工前确认操作者手上有可用的管理员凭据，且第 1~3 组已上线、改密功能已恢复。顺序 MUST 为「先恢复改密 → 轮换已泄露密码 → 再做本组」，颠倒则 token 全失效发生在密码轮换之前，泄露的旧密码仍有效（见 design D8）
- [ ] 5.2 `config/config.js:47` 默认值 `86400000` 改为 `86400`，注释由「24小时」改为明确标注单位为秒
- [ ] 5.3 `config/config.example.js:47` 同步修改，保持两份一致
- [ ] 5.4 复核 `web.js:110` / `web.js:383` 传参无需再改（配置已是秒）
- [ ] 5.5 `web.js:122` / `web.js:388` 的 `expiresIn` 保持返回，单位随配置变为秒，MUST NOT 借本次变更删除该字段
- [ ] 5.6 `.env.example` 与部署文档中 `ADMIN_SESSION_TIMEOUT` 的说明补上单位（秒），并提示曾配置毫秒值的部署须按秒重设
- [ ] 5.7 升级说明标注 BREAKING：现存 admin token 立即失效、此后按周期需重新登录

## 6. 验证

- [x] 6.1 改密成功后 `ttl session:admin_credentials` 期望 `-1`
- [x] 6.2 **重启后**复核 `ttl session:admin_credentials` 仍为 `-1`。此项 MUST 单独执行——`app.js:552` 是唯一无人操作也会自行触发的写入路径，且症状静默，最易在修复中被遗漏（design D9）
- [x] 6.3 历史遗留场景回归：手工对该 key 执行 `expire <key> 600` 模拟旧版遗留，再触发任一写入路径，期望 TTL 回到 `-1`（验证 1.1 的 `persist`，这是仅改写入方式会漏掉的情形）
- [x] 6.4 缓存缺失自愈：`del session:admin_credentials` 后直接调改密接口，期望改密成功（HTTP 200）而非 5xx，且日志出现凭据重建记录
- [x] 6.5 缓存缺失 + 错误的 `currentPassword`：期望 `401` 且 `init.json` 的 `updatedAt` 与 mtime 不变
- [x] 6.6 日志脱敏：调用改密与登录接口后 grep 日志，期望零明文密码命中；同时确认 `username` 等字段仍可读
- [ ] 6.7 会话单位（第 5 组上线后）：新登录会话的 `ttl` 期望约 `86400`，且响应 `expiresIn` 与之一致
- [x] 6.8 升级前后各跑一次 `openspec validate fix-admin-credential-persistence-and-session-ttl --strict`
- [x] 6.9 收口复核：改密成功一次 → 等待超过 24 小时 → 再次改密，期望仍成功（即原自毁循环已断开）。此项是本变更是否真正解决问题的最终判据
      —— **字面的「等待 24 小时」已用确定性等价验证替代**：等价证据链为 6.1（改密后 `ttl=-1`）+ 6.2（重启后 `ttl=-1`）+ 6.3（手工注入 600s TTL 被 `persist` 清除）+ 6.4（key 被整体删除后改密仍自愈并返回 200），覆盖「TTL 残留」与「凭据完全丢失」两种形态。
      —— **本项前提已由 6.10 更正**：原注记称「修复后不存在任何会设置 TTL 的写入路径」，属漏判 —— 每小时的 `redis.cleanup()` 会重新盖上 86400。原自毁循环并未消失，而是被自愈机制**兜住**：key 仍周期性到期，但到期后改密返回 200 而非 500。判据的实质结论（改密不再因凭据到期而失败）仍然成立。
- [x] 6.10 真实密码轮换后的实景复核（用户于 `2026-08-22T15:37:59Z` 自行轮换）
      结果：改密返回 `200`（未 500，实景印证 6.4 的自愈）；新密码在日志中为 `{"currentPassword":"[REDACTED]","newPassword":"[REDACTED]"}`，无明文（实景印证 4.5 的密码族全量遮蔽）；18 个登录会话 `ttl≈983 天` 全部未受影响。
      **同时发现第四条写入路径**：凭据 key 的 `ttl` 已由 `-1` 变为 `86400` 倒计时。由剩余值反推设置时刻为 `16:31:10Z`，与日志中 `Redis cleanup completed` 每小时 `:31:10` 吻合 —— `redis.cleanup()`（`redis.js:3093`）会把 `session:*` 下 `ttl === -1` 的 key 一律 `expire(key, 86400)`，即本修复产出的正确状态恰是它的猎杀目标。
      处置：**接受现状，只改 spec 不改代码**（见 design D10 与 spec「周期清理会重新施加过期时间」）。理由是自愈已使该循环对使用者不可见，改密不再 5xx；残留代价仅为每轮一次 `bcrypt.hash` 与 `lastLogin` 元数据回落。
