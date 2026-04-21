## Context

Relay Service 当前仅监听 HTTP 端口（`src/app.js:606` 处 `this.app.listen(port, host)`）。配置层 `config/config.js` 的 `server` 块也只有 `port/host/nodeEnv/trustProxy`，没有 TLS 字段。代码中已存在 `https` 模块的使用，但全部是**出站**请求（`https.request` 向上游 API、`https.Agent` 作为连接池），与本地监听无关。换言之，"本地 HTTPS 监听" 是一个完全新增的能力面。

部署目标定位为**内部使用 + 固定 IP 公网直出**：客户端完全可控，但没有可用域名；因此 Let's Encrypt 等公共 CA 的 ACME 流程物理上不可行（公共 CA 不签 IP 证书）。团队验证过的现实路径是 **私有 CA + 客户端系统信任**：服务端生成根 CA 与 server 证书，通过后台下载根 CA 分发到客户端系统信任库（macOS Keychain / Windows Trusted Root / Linux update-ca-certificates）以及 Node/Python SDK 的专属信任入口（`NODE_EXTRA_CA_CERTS` / `REQUESTS_CA_BUNDLE`）。

既有的 `TRUST_PROXY` 配置假定前面有反向代理做 TLS 终结，启用应用层 HTTPS 后**通常**与之互斥；现阶段仅通过启动 warning 提示，不做强制互斥。

## Goals / Non-Goals

**Goals:**

- 用 **一把开关** `HTTPS_ENABLED` 覆盖绝大多数启停需求；开关生效语义为"改 .env + 重启进程"，不提供运行时切换。
- 零外部二进制依赖：证书生成、签发、解析全部通过 `node-forge` 在进程内完成。
- 私有 CA 一次生成、长期有效（10 年），server 证书可按需轮换（默认 5 年），客户端只需信任一次根 CA。
- 管理后台具备**只读**的 HTTPS 状态可见性，包含证书剩余天数与 CA 下载入口（仅公钥）。
- 启动阶段遇错即退（fail-fast），绝不在 `HTTPS_ENABLED=true` 时降级为 HTTP。
- 默认关闭（`HTTPS_ENABLED=false`），完全向后兼容。

**Non-Goals:**

- **不**实现 ACME 自动签发（IP 场景不适用；未来若引入域名可扩展，当前不做）。
- **不**实现证书热重载；换证书即重启进程。
- **不**实现 mTLS（客户端证书认证）。
- **不**默认启用 HSTS（自签名/私有信任场景下容易把用户锁死在错误状态）。
- **不**在管理后台提供启停切换按钮（UX 上会暗示可以热切换，但实现代价与风险不匹配）。
- **不**提供"证书轮换一键按钮"（首轮轮换流程为改 `HTTPS_SAN` → 删除 `server.crt` → 重启）。
- **不**变更出站请求（所有 `https.request` 保持原状）。

## Decisions

### 决策 1：证书生成走 `node-forge`，不调 openssl 二进制

**选择**：引入 `node-forge`（MIT，纯 JS，无原生模块），在进程内完成 CA 密钥对生成、server 证书签发、SAN 扩展写入、PEM 编码。

**备选**：调用宿主机 `openssl` CLI；或用 `selfsigned`/`pem` 包。

**理由**：
- 容器镜像无需额外安装 openssl，部署面更小；
- 纯 JS 跨平台一致（Windows / Alpine / distroless 一样运行）；
- 可同步在进程内处理证书元数据（解析 notBefore/notAfter、SAN 枚举供状态接口用）；
- `selfsigned` 封装过浅，SAN/扩展字段支持较差；`pem` 仍依赖 openssl。

### 决策 2：证书存 `data/certs/` 而非 Redis

**选择**：文件系统存储，目录 `data/certs/`（权限 `0700`），文件 `ca.crt / ca.key / server.crt / server.key`（`.key` 权限 `0600`）。

**理由**：
- TLS context 初始化是启动期一次性操作，Redis 读取反而引入"Redis 不可用时 HTTPS 启不来"的耦合；
- 容器化部署时 `data/` 目录通常已作为 volume 挂载，证书随之持久化；
- 与项目中 `data/init.json` 的既有做法一致。

**约束**：`data/certs/` 必须进入 `.gitignore`；docker-compose / Dockerfile 必须确保目录随容器挂载持久化。

### 决策 3：一把开关 + fail-fast 语义

**选择**：仅 `HTTPS_ENABLED` 作为总闸。启用后任何配置/证书异常一律退出进程，不降级为 HTTP。

**理由**：
- 用户明确要求的"一把开关"心智；
- 若降级为 HTTP，部署方可能误以为 HTTPS 在跑，安全预期被破坏；
- 失败原因在启动日志里明示后，重启即可恢复，运维成本低。

**备选被否**：提供 `HTTPS_FAIL_STRATEGY=exit|downgrade` 二选一。否决理由：语义组合容易误用；默认值分歧反而让问题排查更困难。

### 决策 4：SAN 由 `HTTPS_SAN` 显式声明，不从请求推断

**选择**：必填环境变量 `HTTPS_SAN`，格式 `IP:<addr>[,DNS:<name>]...`，留空即启动失败。

**理由**：
- 证书的 SAN 必须在签发时固化，不能推断；
- 显式声明比默认行为更安全（避免服务器绑定到 `0.0.0.0` 时自动塞入多个网卡 IP）；
- 本地调试常需 `IP:127.0.0.1,DNS:localhost`，显式配置即可。

### 决策 5：HTTPS 端口默认 3443，非 443

**选择**：`HTTPS_PORT` 默认 `3443`，文档示例 docker-compose 用 `443:3443` 做宿主映射。

**理由**：
- Node 进程非 root 无法 bind `<1024` 端口；
- 3443 对 3000 有对称感（3000 HTTP → 3443 HTTPS 便于记忆）；
- 需要真 :443 的用户改一行 `HTTPS_PORT=443` 即可，无需代码配合。

### 决策 6：私有 CA 模式下 server 证书 5 年，CA 10 年

**选择**：`HTTPS_CERT_VALID_DAYS` 默认 1825（5 年），`HTTPS_CA_VALID_DAYS` 默认 3650（10 年）。

**理由**：
- 私有信任链不受 Chrome 398 天限制（该限制只针对公共 CA 签发的证书）；
- 私有 CA 过期会让**所有已分发客户端**失效，尽量延长以降低"大迁移"概率；
- server 证书 5 年 ≈ 人员轮换周期，是合理折中。

### 决策 7：`ca.key` **永不**通过任何 HTTP 路径暴露

**选择**：代码层面规定管理后台下载接口只能读取 `ca.crt`；路由处理器直接 hardcode 文件名到白名单（`ca.crt`），不接受任何路径参数。

**理由**：
- `ca.key` 泄露 = 私有 PKI 完全失陷（攻击者可签任意证书，绕过整条信任链）；
- 用 hardcode 白名单而非路径拼接可杜绝 path traversal 攻击面；
- 前端亦不提供任何私钥相关按钮/文案，减少社会工程风险。

### 决策 8：首次启动缺什么补什么

**选择**：启动时按 `ca.crt/ca.key → server.crt/server.key` 顺序判定：
- 全有 → 直接加载
- 仅缺 server → 用现有 CA 重签 server（适合"SAN 变更"场景）
- 缺 CA → 同时生成 CA 与 server（首次启动）
- 证书文件损坏 → fail-fast，不覆盖

**理由**：
- 使"SAN 变更"流程稳定可重复：改 `HTTPS_SAN` → 删 `server.crt/server.key` → 重启；CA 保持不变，已分发的客户端信任继续有效；
- 避免误删 CA 导致大规模客户端重新导入；
- 损坏文件不自动覆盖，保留现场供诊断。

### 决策 9：启动日志协议字段动态化

**选择**：将 `src/app.js:608-616` 硬编码的 `http://` 抽成 `scheme` 变量，基于 `HTTPS_ENABLED` 决定；端口使用 `HTTPS_PORT` 或 `PORT`。

**理由**：保持日志行为一致性，降低运维困惑；是小改动但必须同步做。

### 决策 10：不默认启用 HSTS，但代码保留开启位

**选择**：`HTTPS_HSTS_ENABLED` 默认 `false`；设为 `true` 才通过 `helmet` 注入 `Strict-Transport-Security`。

**理由**：
- 私有 CA 场景若开启 HSTS 且客户端偶遇证书问题，会被永久锁死在错误状态，用户体验灾难；
- 留一个环境变量给将来切换到公共 CA 时用。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| `ca.key` 泄露等于私有 PKI 完全失陷 | 文件权限 `0600`；下载接口 hardcode 白名单仅允许 `ca.crt`；`data/certs/` 进 `.gitignore`；文档强调备份策略与访问控制 |
| Node/Python SDK 默认不读系统信任 store，导致"系统已信任但 SDK 报错" | 文档 / 管理后台状态页给出各语言显式信任方式（`NODE_EXTRA_CA_CERTS` / `REQUESTS_CA_BUNDLE` / `SSL_CERT_FILE`） |
| 现有 CLI 脚本 (`npm run cli status`) 访问 `/health`/`/admin` 在 HTTPS 下可能失败 | CLI 脚本需要读取 `HTTPS_ENABLED` 并传入 `ca.crt` 信任；文档补充；不改动 CLI 在本变更中（保持 scope） |
| OAuth 回调 URL 基于 HTTP 已配置，切换后失效 | 一次性告知运维手动重新绑定；不在代码中自动迁移（会涉及外部 OAuth 提供方） |
| `TRUST_PROXY=true` 与 `HTTPS_ENABLED=true` 并存通常是误配 | 启动时打印 warning；文档清晰说明二选一的典型语境；不做强制互斥（灵活性保留） |
| 端口 <1024 在容器里 bind 失败 | 默认 `HTTPS_PORT=3443` + docker-compose 映射示例；文档解释 `cap_add: NET_BIND_SERVICE` 方案 |
| 证书过期无人察觉 | 管理后台状态页显示剩余天数；`certDaysRemaining<30` / `caDaysRemaining<90` 响应 `warning` 字段；结合未来 webhook 告警（非本变更 scope） |
| 客户端一旦缓存 HSTS，回退到 HTTP 失败 | 默认 HSTS 关闭；文档在启用 HSTS 前提醒"确认证书稳定再开" |
| `node-forge` 的 RSA 密钥生成在低配机器较慢（2048-bit ~1-3s，4096-bit 可达 10s+） | 默认 RSA 2048（`HTTPS_KEY_BITS` 可覆盖为 4096）；首次启动会打出"正在生成证书，约 X 秒"日志；生成发生在应用路由注册之前，不影响 HTTP 兼容路径 |
| 运维误删 `ca.key` 后，再生成会创建新 CA，已分发客户端全部失效 | 文档强调备份 `data/certs/` 目录；不提供一键重置按钮；使"重签 server" 与"重建 CA"在 UX 上明确分开 |

## Migration Plan

**启用 HTTPS 的最小步骤**（对现有部署）：

1. 拉取新版本代码，确认依赖 `node-forge` 已安装
2. 在 `.env` 追加：
   ```
   HTTPS_ENABLED=true
   HTTPS_SAN=IP:<公网IP>,DNS:localhost,IP:127.0.0.1
   ```
3. 确保 `data/certs/` 目录存在且为服务进程所有
4. 重启服务（首次启动会生成 CA + server 证书，日志中会提示"约 1-3 秒"）
5. 管理员登录后台，从 `/admin/https/ca` 下载 `ca.crt`
6. 分发 `ca.crt` 到各客户端并导入系统信任库（文档提供 macOS/Windows/Linux 步骤）
7. 对 Node/Python SDK，配置 `NODE_EXTRA_CA_CERTS` / `REQUESTS_CA_BUNDLE` 指向本地 `ca.crt`
8. 更新客户端使用的 base URL 为 `https://<IP>:3443`（或宿主映射的 443）

**回滚**：

1. 在 `.env` 将 `HTTPS_ENABLED` 改为 `false`（或删除该行）
2. 重启服务
3. 服务恢复 HTTP 监听，行为与本变更前一致
4. `data/certs/` 目录可保留不删，便于未来再次启用

**SAN 变更（新增客户端 IP）**：

1. 修改 `.env` 中 `HTTPS_SAN` 新增条目
2. 删除 `data/certs/server.crt` 与 `data/certs/server.key`（**不要**删 `ca.*`）
3. 重启服务（自动用现有 CA 重签 server 证书）
4. 客户端无需任何操作（已信任的 CA 继续有效）

## Open Questions

- `HTTPS_HSTS_ENABLED` 配置项是否纳入本轮实现？（代码保留一行开关成本极低，倾向纳入；文档默认关闭。）
- 管理后台的 HTTPS 状态页是否需要同时展示"推荐的客户端信任命令"（例如给出复制即用的 `export NODE_EXTRA_CA_CERTS=/path/to/ca.crt`）？——倾向做，减少文档查找成本，但会增加前端工作量。
- CLI `npm run cli status` 是否应在本变更中同步适配 HTTPS？——scope 取舍：如果纳入，要在 CLI 侧自动读取 `HTTPS_ENABLED` 并装载 `ca.crt`；如果不纳入，运维需手动 `NODE_EXTRA_CA_CERTS=... npm run cli status`。本设计暂不纳入，留作后续变更。
