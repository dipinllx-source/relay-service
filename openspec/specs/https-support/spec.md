# https-support Specification

## Purpose
TBD - created by archiving change add-https-support. Update Purpose after archive.
## Requirements
### Requirement: HTTPS listener can be toggled via a single configuration flag

系统 SHALL 提供一个环境变量 `HTTPS_ENABLED` 作为启用 HTTPS 的唯一总开关。当 `HTTPS_ENABLED=true` 时，服务以 HTTPS 方式监听指定端口；当 `HTTPS_ENABLED=false` 或未设置时，服务保持原有 HTTP 行为。该开关的变更只在进程启动时读取，运行期间修改无效——必须重启进程方可生效。

#### Scenario: HTTPS 关闭时保持向后兼容

- **WHEN** `HTTPS_ENABLED` 未设置或为 `false`
- **THEN** 服务以 HTTP 监听 `PORT`（默认 3000），行为与本变更前完全一致

#### Scenario: HTTPS 启用时以 HTTPS 协议监听

- **WHEN** `HTTPS_ENABLED=true` 且其余必填配置齐备
- **THEN** 服务以 HTTPS 监听 `HTTPS_PORT`（默认 3443），HTTP 端口不再监听

#### Scenario: 运行时修改不生效

- **WHEN** 进程启动后，管理员修改 `.env` 中 `HTTPS_ENABLED` 的值
- **THEN** 当前进程保持启动时的监听形态不变；变更只有在下次进程重启时生效

### Requirement: HTTPS startup validates mandatory configuration and fails fast on error

启用 HTTPS 时，系统 SHALL 在启动阶段校验所有必需配置项；任何校验失败或证书加载失败必须导致进程以非零状态码退出，**禁止**静默降级到 HTTP。

#### Scenario: 缺少 SAN 配置

- **WHEN** `HTTPS_ENABLED=true` 且 `HTTPS_SAN` 为空或未设置
- **THEN** 进程在启动阶段打印明确错误（提示示例格式 `IP:x.x.x.x,DNS:localhost`）并以非零状态码退出

#### Scenario: 证书文件存在但无法解析

- **WHEN** `data/certs/server.crt` 或 `server.key` 存在但内容损坏/格式错误
- **THEN** 进程打印错误定位到具体文件并以非零状态码退出，不尝试重新生成覆盖原文件

#### Scenario: 证书文件已过期

- **WHEN** 加载的 `server.crt` 的 `notAfter` 早于当前系统时间
- **THEN** 进程打印过期时间并以非零状态码退出；重签证书需由管理员手动删除 `server.crt` 后重启

### Requirement: Private CA and server certificate are auto-generated on first run

系统 SHALL 在 `HTTPS_ENABLED=true` 且证书文件不存在时，使用纯 JavaScript 库（`node-forge`）自动生成符合私有 PKI 规范的根 CA 与服务端证书；生成过程不依赖外部 `openssl` 二进制。

#### Scenario: 首次启动自动生成完整证书链

- **WHEN** `HTTPS_ENABLED=true` 且 `data/certs/` 目录下不存在 `ca.crt` 与 `server.crt`
- **THEN** 系统生成根 CA（有效期按 `HTTPS_CA_VALID_DAYS` 配置，默认 3650 天）并以其签发服务端证书（有效期按 `HTTPS_CERT_VALID_DAYS`，默认 1825 天），SAN 从 `HTTPS_SAN` 解析得到，生成完成后继续正常启动

#### Scenario: 仅 server 证书缺失时使用现有 CA 重签

- **WHEN** `ca.crt`/`ca.key` 存在但 `server.crt`/`server.key` 不存在
- **THEN** 系统使用现有 CA 签发新的 server 证书（SAN 来自当前 `HTTPS_SAN`），**不**重新生成 CA，确保已分发到客户端的根证书信任链继续有效

#### Scenario: SAN 配置要求

- **WHEN** 系统解析 `HTTPS_SAN`
- **THEN** 支持 `IP:<地址>` 与 `DNS:<名称>` 两种前缀，多个条目以英文逗号分隔；无前缀或前缀非法必须导致启动 fail-fast

#### Scenario: 私钥文件权限

- **WHEN** 系统写入任何 `.key` 文件
- **THEN** 文件权限必须设置为仅所有者可读（`0600`），目录权限为 `0700`

### Requirement: Admin HTTP API exposes read-only HTTPS status

系统 SHALL 提供一个 `GET /admin/https/status` 接口供已登录的管理员查询当前 HTTPS 运行态与证书元数据，接口为**只读**，**不**提供启停或重签能力。

#### Scenario: 未登录访问被拒绝

- **WHEN** 未携带有效管理员 session 或 token 访问 `/admin/https/status`
- **THEN** 响应 401，并在响应体中明确拒绝原因

#### Scenario: HTTPS 未启用时的响应

- **WHEN** 已登录管理员访问 `/admin/https/status`，且 `HTTPS_ENABLED=false`
- **THEN** 响应 200 并返回 `{ enabled: false }`，不返回证书字段

#### Scenario: HTTPS 启用时的响应

- **WHEN** 已登录管理员访问 `/admin/https/status`，且 HTTPS 正常启动
- **THEN** 响应 200 并返回至少以下字段：`enabled: true`、`port`、`certSubject`、`certSan[]`、`certIssuer`、`certNotBefore`、`certNotAfter`、`certDaysRemaining`、`caSubject`、`caNotAfter`、`caDaysRemaining`

#### Scenario: 临近过期提示

- **WHEN** 证书 `certDaysRemaining` 小于 30 或 `caDaysRemaining` 小于 90
- **THEN** 响应体增加 `warning` 字段明示临近过期（具体阈值可由 design 约定，但必须体现在响应中）

### Requirement: Admin HTTP API exposes CA public certificate download

系统 SHALL 提供一个 `GET /admin/https/ca` 接口，供已登录管理员下载根 CA 的**公钥证书** (`ca.crt`) 以便分发至客户端信任库；该接口**绝不**以任何形式（下载、预览、日志、错误提示）暴露 `ca.key` 或任何其他私钥内容。

#### Scenario: 已登录管理员下载 ca.crt

- **WHEN** 已登录管理员访问 `/admin/https/ca`
- **THEN** 响应 200，`Content-Type: application/x-x509-ca-cert`，`Content-Disposition: attachment; filename="ca.crt"`，响应体为 CA 公钥 PEM

#### Scenario: 未登录访问被拒绝

- **WHEN** 未携带有效管理员 session 或 token 访问 `/admin/https/ca`
- **THEN** 响应 401

#### Scenario: HTTPS 未启用或无 CA 时

- **WHEN** 已登录管理员访问 `/admin/https/ca`，但 `HTTPS_ENABLED=false` 或 `ca.crt` 不存在
- **THEN** 响应 404，响应体说明当前未生成 CA

#### Scenario: 私钥保护

- **WHEN** 任何请求以任何路径或参数尝试获取 `ca.key`、`server.key` 或其他私钥文件
- **THEN** 系统拒绝返回私钥内容；在源代码层面不存在任何读取并返回 `*.key` 的路径

### Requirement: Startup logs reflect actual protocol scheme

系统 SHALL 在启动日志中输出与实际监听协议一致的 URL scheme，不得在 HTTPS 启用时仍输出 `http://` 前缀。

#### Scenario: HTTP 模式日志

- **WHEN** `HTTPS_ENABLED=false` 进程启动成功
- **THEN** 启动日志中 Web / API / Admin / Health / Metrics 的 URL 均以 `http://` 开头

#### Scenario: HTTPS 模式日志

- **WHEN** `HTTPS_ENABLED=true` 进程启动成功
- **THEN** 启动日志中上述 URL 均以 `https://` 开头，且端口部分使用 `HTTPS_PORT` 值

### Requirement: Graceful shutdown closes HTTPS listener cleanly

系统 SHALL 在收到 `SIGTERM`/`SIGINT` 时，对 HTTPS 监听 socket 执行与原 HTTP 路径等价的优雅关闭流程，确保进行中的请求按现有超时配置完成后再退出。

#### Scenario: HTTPS 模式下收到终止信号

- **WHEN** HTTPS 进程收到 `SIGTERM`
- **THEN** 停止接受新连接，已在处理的请求按现有 server timeout 运行完毕，随后关闭 Redis 连接与清理任务并退出，退出码为 0

### Requirement: TLS version and cipher baseline

系统 SHALL 默认启用最小 TLS 版本 `TLSv1.2`，**不**接受 SSLv3/TLSv1.0/TLSv1.1 的客户端连接；系统 MAY 通过 `HTTPS_MIN_TLS_VERSION` 覆盖（`TLSv1.2` 或 `TLSv1.3`）。

#### Scenario: 默认最小版本

- **WHEN** `HTTPS_MIN_TLS_VERSION` 未设置
- **THEN** server 以 `minVersion='TLSv1.2'` 启动；使用 TLS 1.0/1.1 的客户端握手将被拒绝

#### Scenario: 覆盖为更高版本

- **WHEN** `HTTPS_MIN_TLS_VERSION=TLSv1.3`
- **THEN** server 以 `minVersion='TLSv1.3'` 启动；低于 1.3 的客户端握手将被拒绝

