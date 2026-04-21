## 1. 依赖与目录

- [x] 1.1 在 `package.json` 追加 `node-forge` 运行时依赖（稳定版本，锁定 major）
- [x] 1.2 运行 `npm install` 更新 `package-lock.json`
- [x] 1.3 在根 `.gitignore` 追加 `data/certs/`（保护私钥误提交）

## 2. 配置层

- [x] 2.1 在 `config/config.js` 新增 `https` 配置块：`enabled / port / san / certDir / certValidDays / caValidDays / minTlsVersion / keyBits / hstsEnabled`
- [x] 2.2 在 `.env.example` 追加对应环境变量：`HTTPS_ENABLED` / `HTTPS_PORT` / `HTTPS_SAN` / `HTTPS_CERT_DIR` / `HTTPS_CERT_VALID_DAYS` / `HTTPS_CA_VALID_DAYS` / `HTTPS_MIN_TLS_VERSION` / `HTTPS_KEY_BITS` / `HTTPS_HSTS_ENABLED`，附中英文注释与默认值
- [x] 2.3 启动阶段配置校验：`HTTPS_ENABLED=true` 时 `HTTPS_SAN` 为空即 fail-fast 退出并打印可抄写的示例
- [x] 2.4 启动阶段打印 warning：`HTTPS_ENABLED=true` 且 `TRUST_PROXY=true` 并存时

## 3. 证书管理器（src/utils/certificateManager.js）

- [x] 3.1 新建模块 `src/utils/certificateManager.js`（纯函数导出，无副作用）
- [x] 3.2 实现 `parseSan(sanString)`：解析 `IP:.../DNS:...` 格式到 `node-forge` 所需的 altNames 数组；非法前缀 / 空条目抛错
- [x] 3.3 实现 `generateCa(options)`：生成 RSA 密钥对（bits 可配）、构造自签名根 CA（含 `basicConstraints` CA=true、`keyUsage` keyCertSign+cRLSign、`subjectKeyIdentifier`），返回 `{ certPem, keyPem, notBefore, notAfter }`
- [x] 3.4 实现 `generateServerCert(caCertPem, caKeyPem, altNames, options)`：生成 server 密钥对、以 CA 签发、扩展包含 `subjectAltName / keyUsage / extKeyUsage serverAuth / authorityKeyIdentifier`
- [x] 3.5 实现 `loadFromDisk(certDir)`：读取四个文件，缺失 / 损坏分别抛出可识别错误类型（`MissingCaError` / `MissingServerError` / `InvalidPemError` / `ExpiredCertError`）
- [x] 3.6 实现 `writeToDisk(certDir, { caCertPem, caKeyPem?, serverCertPem, serverKeyPem })`：创建目录（`0700`）、写文件、`.key` 强制 `0600`
- [x] 3.7 实现 `describeCert(certPem)`：解析返回 `{ subject, issuer, sanList, notBefore, notAfter, daysRemaining }`，供状态接口使用
- [x] 3.8 为 certificateManager 编写单元测试（`tests/certificateManager.test.js`）覆盖 SAN 解析、CA 生成、server 签发、加载错误分支、文件权限（Linux 下 `stat.mode & 0o777`）

## 4. 启动分支（src/app.js）

- [x] 4.1 抽出一个 `resolveListener()` 辅助：根据 `config.https.enabled` 返回 `{ server, scheme, port }`
- [x] 4.2 HTTPS 分支：调用 certificateManager，按 "全有/仅缺 server/全缺/损坏" 分支处理，失败 `process.exit(1)`
- [x] 4.3 首次生成证书前后打印明确日志（开始 / 耗时 / 文件路径）
- [x] 4.4 替换 `this.app.listen(port, host)` 为 `https.createServer(tlsOptions, this.app).listen(port, host)`，`tlsOptions` 含 `minVersion`、`key`、`cert`、可选 `ca`
- [x] 4.5 替换启动日志硬编码 `http://` 为动态 `${scheme}://`
- [x] 4.6 `setupGracefulShutdown` 兼容 HTTPS server（`this.server.close()` 在两种形态下语义一致，确认无额外分支需求）
- [x] 4.7 HSTS 开关：`HTTPS_HSTS_ENABLED=true` 时通过现有 helmet 或新中间件注入 `Strict-Transport-Security`

## 5. 管理后台路由（后端）

- [x] 5.1 新建 `src/routes/admin/https.js`，挂载在 `src/app.js` / `admin` 路由入口（按既有模式）
- [x] 5.2 实现 `GET /admin/https/status`（需管理员鉴权）：聚合 `config.https.enabled` + `describeCert(server)` + `describeCert(ca)`；`daysRemaining < 30 || caDaysRemaining < 90` 附加 `warning` 字段
- [x] 5.3 实现 `GET /admin/https/ca`（需管理员鉴权）：hardcode 读取 `${certDir}/ca.crt`，`Content-Type: application/x-x509-ca-cert`，`Content-Disposition: attachment; filename="ca.crt"`
- [x] 5.4 在路由处理器内**物理拒绝**任何私钥访问：代码级禁用拼接路径、不接受文件名参数
- [x] 5.5 关闭状态下（`config.https.enabled=false`）：status 返回 `{ enabled: false }`，ca 下载返回 404

## 6. 管理后台前端（web/admin-spa）

- [x] 6.1 在 `src/utils/http_apis.js` 新增 `getHttpsStatusApi` 与 `downloadCaCertApi`（blob 下载，保留 Authorization 头）
- [x] 6.2 新增 `components/settings/HttpsStatusSection.vue`；在 `SettingsView.vue` 挂接 `activeSection === 'https'`；路由 `/settings/https` 与顶部下拉菜单入口
- [x] 6.3 UI 展示字段：启用状态、端口、SAN 列表、Subject、Issuer、有效期、剩余天数（<30 天琥珀色）、CA 剩余天数（<90 天琥珀色）、下载 ca.crt 按钮
- [x] 6.4 UI 兼容暗黑模式（`dark:` 前缀）与 Tailwind 响应式；保持玻璃态风格
- [x] 6.5 未启用时展示 "HTTPS 未启用"占位，附内联配置步骤

## 7. 部署与容器

- [x] 7.1 更新 `docker-compose.yml`：新增 HTTPS 端口映射（`${HTTPS_BIND_PORT:-3443}:3443`）与完整 HTTPS_* 环境变量；注释说明仅在 `HTTPS_ENABLED=true` 时生效
- [x] 7.2 确认 `data/` volume 挂载覆盖 `data/certs/`（已挂载整个 `data`，证书持久化）
- [x] 7.3 Dockerfile 增加 `data/certs` 目录创建并 `chmod 700`；`EXPOSE 3000 3443`
- [x] 7.4 `README.md` / `README_EN.md` 新增"应用层 HTTPS（私有 CA）"小节，含启用、SAN 变更、回滚指引

## 8. 文档

- [x] 8.1 在 `CLAUDE.md` 故障排除表新增 HTTPS 相关条目（SAN 为空、端口、证书损坏、SDK 信任、SAN 变更、TRUST_PROXY 冲突）
- [x] 8.2 `README.md` / `README_EN.md` 新增 "应用层 HTTPS" 小节，含 macOS/Windows/Linux CA 导入步骤
- [x] 8.3 SDK 信任指引（Node `NODE_EXTRA_CA_CERTS` / Python `REQUESTS_CA_BUNDLE`）写入 README + CLAUDE.md 故障排除；HTTPS 状态视图内也有内联提示
- [x] 8.4 SAN 变更流程（改 env → 删 server.* → 重启）在 README + 故障排除表
- [x] 8.5 回滚流程（`HTTPS_ENABLED=false` + 重启）在 README
- [x] 8.6 明示：`ca.key` 绝不下载（README 注意事项 + 源代码白名单双重保证）、TRUST_PROXY 与 HTTPS 通常互斥、OAuth 回调可能需要重配

## 9. 验证

- [x] 9.1 单元测试：`tests/certificateManager.test.js` 14 用例覆盖 parseSan / CA / server 证书 / 文件权限 / 加载错误分支
- [x] 9.2 `HTTPS_ENABLED=false` 默认分支保持原有 `app.listen` 行为（代码层面 `resolveListener()` 在 enabled=false 时直接返回 `this.app`；整个测试套件在默认配置下继续通过）
- [x] 9.3 E2E：节点内 `https.createServer` 启动 + `https.get` 客户端用 ca.crt 信任链访问 → 返回 200（见 live smoke test）
- [x] 9.4 `validateHttpsPreconditions` 对空 SAN `process.exit(1)` 且 stderr 输出可抄写示例（代码逻辑 + 手工覆盖）
- [x] 9.5 `InvalidPemError` 分支对损坏证书 `process.exit(1)` 且不覆盖磁盘（由 `resolveListener` 分支与 cert manager 测试共同保证）
- [x] 9.6 `MissingServerError` 分支保留 CA 仅重签 server（代码实现 + 手工覆盖：删 server.* 后重启，CA 指纹不变）
- [x] 9.7 `tests/httpsAdminRoute.test.js`：`/admin/https/status` 在 disabled / missing-certs / full-certs 三态下的响应正确
- [x] 9.8 `tests/httpsAdminRoute.test.js`：`/admin/https/ca` MIME / Content-Disposition / 404 分支正确
- [x] 9.9 `tests/httpsAdminRoute.test.js`：SECURITY 回归守护——源代码不含对 `.key` 的字符串引用；不通过 `req.params/query/body` 构造文件路径
- [x] 9.10 TLS 版本强制：节点内 `minVersion='TLSv1.3'` server 拒绝 TLS 1.2 客户端握手（EPROTO / protocol version alert，已手工验证）
- [x] 9.11 `npm run lint` 与 `npm run format:check` 在本变更新增/修改的所有文件上均通过（原有 4 个 pre-existing format 警告与本变更无关）
- [x] 9.12 CLI 指引：管理后台 HTTPS 状态视图 + 故障排除表 + README 均已载入 `NODE_EXTRA_CA_CERTS=data/certs/ca.crt`；CLI 脚本本身在本 scope 内不改（Open Question #3）
