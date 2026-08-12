# Tasks: Release Notify with Manual Upgrade

## 1. 进程守护（其余部分的机制前提）

- [x] 1.1 编写 systemd unit（`Restart=always`、`WorkingDirectory=/opt/relay-service`、运行用户与现状一致、避免硬编码 nvm 版本路径），以 `relay-redis.service` 为范本
- [x] 1.2 一次性 cutover：停止现有 nohup 进程 → 确认 28088 释放 → `daemon-reload` + `enable --now`
- [x] 1.3 验证：`.env` 生效（Redis 6380 / `METADATA_BACKEND=sqlite`）、`/health` 200、`metadataSync` 启动日志正常
- [x] 1.4 验证三种重启语义：`exit(0)` 后自动拉起、异常崩溃自动拉起、`systemctl stop` 后保持停止
- [x] 1.5 协调 `scripts/manage.js` 守护态子命令（委派 systemctl 或标注废弃），消除 PID 文件双重管理

## 2. 版本感知

- [x] 2.1 实现远端 tag 枚举（`git ls-remote --tags origin`）+ tag 名白名单校验，统一走全限定 `refs/tags/*`
- [x] 2.2 实现正确的 semver 比较（含 prerelease 优先级），替换 `system.js:72` 现有实现；prerelease 默认不提示
- [x] 2.3 重写 `/admin/check-updates`：替换写死的 `hasUpdate:false`，返回 current/latest/hasUpdate
- [x] 2.4 远端不可达时的降级路径（不抛异常、不阻塞管理台）+ 结果缓存策略

## 3. 变更分析（提示与步骤裁剪共用同一份数据）

- [x] 3.1 实现 commit 区间提取与 conventional commit 分组，过滤纯版本号提交
- [x] 3.2 实现影响面统计（文件数、增删行）
- [x] 3.3 实现步骤裁剪判据：依赖**内容** diff（非 `package.json` 文件 diff）、前端目录变更、后端变更、纯文档变更
- [x] 3.4 用 `v1.2.2..v1.2.3` 作为回归样本校验：应判定「需 build:web、需重启、跳过 npm install」

## 4. 升级执行

- [ ] 4.1 `upgradeService`：流水线编排（fetch → checkout → 按需安装/构建 → 持久化 → exit）
- [ ] 4.2 预检：工作区干净、目标 tag 合法且存在、无并发升级（Redis 互斥锁）
- [ ] 4.3 进度与结果持久化到 Redis（计划、逐步状态、耗时、失败输出尾部）
- [ ] 4.4 失败即中止且不重启，保证服务继续以旧版本运行
- [ ] 4.5 `POST /admin/upgrade` + `GET /admin/upgrade/status`，注册到 `src/routes/admin/index.js`，审计日志
- [x] 4.6 与 `manage.js update` 的关系收敛（避免两份编排实现漂移）

## 5. 管理台提示（L3）

- [x] 5.1 恢复「检查更新」入口
- [x] 5.2 `hasUpdate` 时渲染：版本对比、变更清单（分组）、影响面、将执行的步骤清单（含重启中断会话警示）
- [x] 5.3 升级中/后反馈：轮询状态、跨重启续查、以 `check-updates.current` 等于目标版本判定完成
- [x] 5.4 失败展示：失败步骤 + 输出尾部 + 明确「服务仍运行旧版本」
- [x] 5.5 前端 API 封装与构建（`vite build`；注意 eslint 阻断，先 `eslint --fix`）

## 6. 验收

- [ ] 6.1 端到端：造一个 `v1.2.4` tag（纯后端变更）→ 提示出现且步骤清单显示跳过前端构建 → 一键升级 → 版本变为 1.2.4
- [ ] 6.2 端到端：造一个含前端变更的 tag → 步骤清单包含 build:web → 升级成功
- [ ] 6.3 故障注入：故意引入 eslint 错误的 tag → 升级失败、服务仍旧版本、UI 显示失败步骤与 lint 尾部
- [x] 6.4 故障注入：目标版本启动即崩 → 确认 systemd 反复拉起、journal 留痕、恢复后 UI 可见上次升级记录
- [ ] 6.5 安全：未鉴权访问升级端点应 401；非法 tag 应 400；并发触发应 409
