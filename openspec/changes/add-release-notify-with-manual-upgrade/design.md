# Design: Release Notify with Manual Upgrade

## Context

单机、单实例部署（`/opt/relay-service`，HTTP 28088），无进程管理器，无 CI。数据面：Redis 6380（有 systemd 托管、AOF everysec + RDB）+ SQLite `data/metadata.db`（`METADATA_BACKEND=sqlite`，由 `src/storage/metadataSync.js` 每 15s 从 Redis 对账）。约 10 个真实用户在用，服务承载长时 SSE 流（实测最慢 95420ms）。

发布现状：9 个 `vX.Y.Z` release 分支，但仅 2 个 tag（v1.2.2、v1.2.3）—— tag 惯例自 v1.2.2 才建立。

## 决策

### D1 感知源 = `git ls-remote --tags origin`

`origin` 是 SSH remote，复用既有 deploy key，**零额外凭据**。

被否方案：
- **GitHub REST API**：私有仓库需 token（新增机密管理）、有速率限制、依赖 HTTP 出网。且旧实现正是走这条路并指错了仓库。
- **托管 version.json 清单**：需额外托管与发布纪律，收益仅是「可放任意元数据」，而元数据可从 git 直接算出。

### D2 发布契约 = tag；机器只解析全限定 `refs/tags/*`

实测证据：`git rev-parse v1.2.3` 输出 `warning: refname 'v1.2.3' is ambiguous.` —— 因同时存在分支与 tag `v1.2.3`。推 tag 时也已踩过 `error: src refspec v1.2.3 matches more than one`。

二者性质不同：分支可移动（可能后续打 hotfix），tag 约定冻结。若某日分支 `v1.2.3` 前进而 tag 不变，裸名 `v1.2.3` 将成为**真歧义**，自动化可能静默部署非目标代码。

因此：tag = 发布权威，分支 = 维护线。所有 git 操作（解析、checkout、diff）MUST 使用 `refs/tags/<tag>`，禁止裸名。

被否方案：以分支为契约 —— 需额外区分「分支最新」与「发布点」，且与同名 tag 歧义未解。

### D3 版本比较 = 完整 semver（含 prerelease 优先级）

现 `compareVersions`（`system.js:72`）按 `.` 分割后 `Number()`：`"1.2.3-alpha".split(".")` → `["1","2","3-alpha"]` → `Number("3-alpha")` = `NaN` → 兜底 0，导致 `1.2.3-alpha == 1.2.3`。历史存在 `v1.1.0-alpha` / `v1.2.0-alpha`，该缺陷会真实触发。

规则：`1.2.4-rc.1 < 1.2.4`；prerelease tag 默认**不**触发提示（避免把 alpha 推给生产），可由开关放开。

### D4 release notes 来源 = `git log <prev>..<new>`

实测：tag 是**轻量** tag（`git cat-file -t refs/tags/v1.2.3` → `commit`，非 `tag` 对象），无 annotation。且被打标的 commit 恰是版本号提交，message 为 `chore: 版本号升级为 1.2.3`，零信息量。

而 commit 区间信息量充足且免费：
```
git log --oneline refs/tags/v1.2.2..refs/tags/v1.2.3
  0d39be2 chore: 版本号升级为 1.2.3                    ← 过滤
  36f55e1 feat: 账户与 APIKey 全量持久化到 SQLite       ← 展示
  acefa1a fix: 账户删除相关缺陷与 mass-assignment 加固  ← 展示
```
commit message 已是 conventional commits 风格（`feat:` / `fix:` / `chore:` / `security:` / `refactor:`），可自动分组并过滤版本号噪音。

被否方案：改用附注 tag（`git tag -a`）—— 人工成本更高；且不改也已够用。可作为后续可选增强，不阻塞本变更。

### D5 步骤裁剪判据 = 依赖**内容** diff，而非 `package.json` 文件 diff

反例（实测 v1.2.2→v1.2.3）：朴素规则「`package.json` 变了 → npm install」判定为**需要**，但该次变更只改了 `version` 字段。由于每次发版必然改 version，此规则恒为真，裁剪永不生效。

正确判据：
| 步骤 | 触发条件 |
|---|---|
| `npm install` | 根 `package.json` 的 `dependencies`/`devDependencies` **键值集合**发生变化 |
| `install:web` | `web/admin-spa/package.json` 的依赖集合变化 |
| `build:web` | `web/admin-spa/**`（除其 `package.json` 外）有变更 |
| 重启 | `src/**`、`config/**`、根 `package.json` 有变更 |
| 无操作 | 仅 `*.md` / `openspec/**` 变更 |

收益回测：本会话 8 次部署中 5 次可跳过 `build:web`（每次约 15s，且规避一类失败模式）。

### D6 重启机制 = systemd 托管 + `Restart=always` + 进程 `exit(0)`

核心约束（「拔自己插头」问题）：触发升级的 HTTP 请求由**即将被重启的进程**提供服务，该进程无法在自己死后再启动自己。

选定：由 systemd 承担复活职责，应用侧只需在流水线成功后 `process.exit(0)`；systemd 立即以新代码拉起。

`Restart=always` 而非 `on-failure`：`exit(0)` 属正常退出，`on-failure` 不会拉起。`systemctl stop` 仍能正常停止（systemd 区分显式停止与进程自退）。

被否方案：
- **detached 子进程自举**（`spawn(detached, unref)` → sleep → kill 父 → 启新）：等于手搓一个简陋 init；子进程失败无人兜底、信号与日志需自管。
- **外部 agent 轮询标志位**：多一个常驻组件要维护。
- **只 pull+build，人工重启**：一键名不副实，仍需 ssh。

unit 编写注意：
- `node` 位于 nvm 路径 `/root/.nvm/versions/node/v24.15.0/bin/node`，**版本升级会变**。应以稳定符号链接或 `Environment=PATH=` 方式规避硬编码失效。
- `WorkingDirectory=/opt/relay-service` 必需 —— `config/config.js:2` 用 `dotenv` 从 cwd 读 `.env`。
- 当前进程以 `root` 运行；unit 保持一致以免文件属主/权限漂移（升级需要 `git` 与写 `node_modules`、`dist` 的权限）。
- `relay-redis.service` 可作范本（`Type=simple` / `Restart=` / `LimitNOFILE=65535`）。

### D7 升级进度持久化到 Redis

流水线末步 `process.exit(0)` 会切断 HTTP 连接，最终结果无法通过该响应送达。若进度仅存内存，重启后全部丢失，人看到的是「转圈后断开」的黑箱 —— 在**无回滚**前提下不可接受。

选定：进度与结果写 Redis（如 `upgrade:last_run`），结构含 `{ startedAt, fromVersion, toVersion, plannedSteps, steps:[{name, status, durationMs, tailLog}], result, error, finishedAt }`。

关键使能条件：admin 会话 token 存于 Redis（`session:<token>`），而 Redis 是独立 systemd 服务、**不受 app 重启影响** ⟹ 前端 token 跨升级仍然有效，可在重启后继续轮询状态。

升级完成判定：轮询 `GET /admin/check-updates` 的 `current` 是否已等于目标版本（该端点需 admin 鉴权，且直接证明新代码在跑）。优于轮询 `/health` —— `/health` 已被安全加固为对非可信来源仅返回 `{status,timestamp}`。

被否方案：SSE 流式推日志 —— 无法跨越 `exit(0)` 边界，刷新即失忆。（可作为持久化之上的可选增强。）

### D8 构建位置 = 服务器

`web/admin-spa/dist` 被 gitignore ⟹ 产物不入库 ⟹ 服务器必须自行构建。维持现状，不引入 CI。

接受的风险（因人工触发、人在场，失败可被立即发现）：
- `vite-plugin-checker` 会跑 eslint 并**阻断** build（本会话真实发生）。缓解：失败时把 lint 输出尾部回传到 UI，并保证**服务未重启、仍运行旧版本**。
- 机器仅 3.5G 内存，vite build 峰值不小。缓解：构建串行执行，失败即中止。

被否方案：CI 产出 artifact（需新增 CI 设施 + 私有仓库产物下载凭据）；dist 入库（仓库污染、二进制冲突）。

### D9 不做回滚 —— 及其代价补偿

后果：升级失败后人是唯一恢复者。因此以下两点从「增强」升级为「必需」：
1. 失败反馈必须诚实且**跨重启可查**（D7）。
2. systemd 必须存在（D6）—— 「新版本起不来」时，`Restart=always` 反复重试 + `systemctl status`/journal 留痕是唯一兜底；否则旧进程已退出、新代码起不来，连能显示错误的页面都没有。

### D10 不做无人值守 —— 人工挑时机替代排空

重启会硬切在途 SSE（实测最慢 95420ms 的 `/openai/responses`）。L3 提示中显式标注「重启会中断进行中会话」，把时机判断交给人，从而无需实现 drain。

### D11 manage.js 与 systemd 的职责边界

`scripts/manage.js:9` 维护自己的 `PID_FILE`；引入 systemd 后两者会双重管理同一进程（systemd 拉起的进程不写该 PID 文件，`manage.js status/stop` 将失准）。

方向：daemon 相关子命令（`start -d` / `restart -d` / `stop` / `status`）委派给 `systemctl`，或明确标注废弃仅保留前台调试用途。`update` 子命令与新的 `POST /admin/upgrade` 应共用同一套编排逻辑，避免两份实现漂移。

## 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| systemd 切换期双进程 | 端口冲突 / 数据竞争 | 切换前先停 nohup 进程并确认 28088 释放，再 `enable --now` |
| nvm node 路径变更 | unit 失效、服务起不来 | 不硬编码具体版本路径（符号链接或 PATH） |
| 特权：node 以 root 调 git/systemctl | 越权面扩大 | 升级端点仅 admin 鉴权 + 审计日志；不接受任何客户端传入的 ref/命令参数（仅接受目标 tag 并对其做白名单校验） |
| 目标 tag 注入 | 任意 ref checkout | tag 必须来自 ls-remote 结果集，且匹配 `^v\d+\.\d+\.\d+(-[\w.]+)?$` |
| 升级中并发触发 | 流水线交叉 | Redis 互斥锁 + 进行中直接拒绝 |
| 工作区不干净 | checkout 失败 | 预检 `git status --porcelain`，非空则中止并提示（当前 `dist`/`node_modules`/`data`/`logs` 均已 gitignore，正常应为空） |

## 迁移 / 切换

一次性 cutover（需短暂停机）：写入 unit → `daemon-reload` → 停止现有 nohup 进程 → `systemctl enable --now` → 验证 28088 与 `/health` → 确认 `metadataSync` 与 Redis 连接正常。

服务器当前位于 `main` 分支且与 `origin/main` 无分叉。改为 tag 契约后，部署态将变为 detached HEAD at `refs/tags/vX.Y.Z`；这对部署目标是可取的（不可意外产生本地提交）。

## 待定 / 后续

- 是否把 `manage.js update` 改为直接调用 `upgradeService`（消除双实现）
- 是否引入附注 tag 以承载正式发布说明（D4 备选）
- prerelease 提示开关的默认值与暴露位置
