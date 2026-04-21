## Why

当前 Relay Service 仅以 HTTP 方式监听对外端口，管理后台登录凭据、API Key、OAuth token 等均以明文经由网络传输；公网直出部署时存在中间人嗅探风险。内部使用场景虽无公共 CA 签发条件（客户端通过固定 IP 访问，无域名可用于 ACME 验证），但团队客户端完全可控，可通过**私有 CA + 客户端系统信任**建立可信 TLS 通道，既实现传输加密，又保持部署自洽（零外部依赖、零付费域名）。

## What Changes

- 新增 HTTPS 监听能力：启用时以 `https.createServer` 绑定独立端口（默认 `3443`），关闭时沿用现有 HTTP 行为。
- 新增"一把开关"配置：`HTTPS_ENABLED`（.env），修改后需重启进程生效；不提供运行时切换。
- 新增**证书管理器**：使用 `node-forge`（纯 JS、无 openssl 二进制依赖）在 `data/certs/` 下自动生成根 CA 与服务端证书；SAN 由 `HTTPS_SAN` 环境变量提供；CA 有效期 10 年、server 证书 5 年（私有信任链不受公共 CA 的 398 天限制）。
- 新增管理后台只读状态页：展示当前启用状态、证书 Subject/SAN/Issuer、剩余有效期，以及 `ca.crt` 下载入口（仅登录管理员可下载；`ca.key` 永不通过任何 HTTP 路径暴露）。
- 修正启动日志中硬编码的 `http://` 协议前缀，使其在 HTTPS 模式下正确显示 `https://`。
- 更新 `.env.example`、`docker-compose.yml` 示例（443 → 3443 端口映射）与运维文档（macOS/Windows/Linux 导入 CA，以及 Node/Python/Go SDK 如何信任私有 CA）。
- 启动硬约束（**BREAKING**：当 `HTTPS_ENABLED=true` 时）：未提供 `HTTPS_SAN`、证书文件损坏无法解析等场景一律 **fail-fast** 退出，拒绝降级到 HTTP。默认值 `HTTPS_ENABLED=false` 保持完全向后兼容。

**明确不做**：ACME 自动签发（IP 场景不适用）、证书热重载、mTLS 客户端认证、HSTS 默认启用、管理后台启停切换按钮。

## Capabilities

### New Capabilities

- `https-support`：HTTPS 监听、私有 CA 自动生成与轮换、管理后台证书状态与 CA 下载入口。

### Modified Capabilities

（无——`https-support` 为全新能力，不变更现有 spec 定义的需求。启动日志、配置加载等现有行为属于实现细节层面的改动，通过 design.md 说明。）

## Impact

- **新增代码**：
  - `src/utils/certificateManager.js`（证书生成、加载、SAN 解析）
  - `src/routes/admin/https.js`（`GET /admin/https/status`、`GET /admin/https/ca`）
  - 前端页面（`web/admin-spa/src/views/` 下新增 HTTPS 状态视图）与对应路由
- **修改代码**：
  - `config/config.js`：新增 `https` 配置块
  - `src/app.js`：启动分支（HTTP vs HTTPS）、graceful shutdown、日志协议字段动态化
  - `src/routes/admin/index.js`（或等效入口）：挂载新路由
- **新增依赖**：`node-forge`（纯 JS，MIT 协议，无原生模块）
- **配置与部署**：
  - `.env.example`：新增 `HTTPS_ENABLED` / `HTTPS_PORT` / `HTTPS_SAN` / `HTTPS_CERT_DIR` / `HTTPS_CERT_VALID_DAYS` / `HTTPS_CA_VALID_DAYS` / `HTTPS_MIN_TLS_VERSION`
  - `docker-compose.yml`：示例端口映射 `443:3443`
  - `data/certs/` 加入 `.gitignore`（避免私钥误提交）
- **文档**：
  - CLAUDE.md 故障排除表增加 HTTPS 相关条目
  - 新增 CA 分发与客户端信任说明（系统信任 + Node/Python SDK 专属 env 配置）
- **运维提示**：
  - `TRUST_PROXY=true` 与 `HTTPS_ENABLED=true` 同时启用通常意味着误配，启动时打印 warning
  - 已有 OAuth 账号的回调 URL 若基于 HTTP，切换后可能需要重新绑定（一次性告知）
  - 本地 CLI/健康检查脚本访问 HTTPS 时需配置 `NODE_EXTRA_CA_CERTS` 指向 `data/certs/ca.crt`
