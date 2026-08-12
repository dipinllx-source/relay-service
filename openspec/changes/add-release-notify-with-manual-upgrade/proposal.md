# Add Release Notify with Manual Upgrade

## Why

三个事实叠加，使「版本感知 + 升级」当前处于比没有更糟的状态：

1. **感知已被拆除，且原本指错对象**：`/admin/check-updates`（`src/routes/admin/system.js:94`）现返回写死的 `hasUpdate:false`（commit `6ae6cab`）。被移除前它查的是 `api.github.com/repos/wei-shaw/claude-relay-service/releases/latest` —— **上游原项目**。本仓已实质分叉（安全加固 P0~P2、备份导出/导入、metadataSync、mass-assignment 修复），上游 release 恒新于本地 ⟹ 永久误报"有新版本"，并把人导向别人的仓库。
2. **升级是手工的且常做无用功**：`scripts/manage.js:198 update()` 已有完整流水线（git pull → npm install → install:web → build:web → restart），但只能 ssh 执行。本会话 8 次部署全靠人工 `pkill + nohup`，其中前端构建仅 3 次真正需要，另 5 次白跑约 15s，且每跑一次都多暴露一次 eslint 阻断风险（实际被阻断过 1 次：9 个 `vue/attributes-order` + prettier error，`vite-plugin-checker` 直接中断 build）。
3. **主服务无任何进程守护**：app 以 `nohup node src/app.js` 裸跑，实测 PID 91967 **PPID=1**，崩溃即永久宕机；而同机 `relay-redis.service` 反而配了 `Restart=on-failure`。约 10 个真实用户（apikey：dipin / langshan / mengde / daobin / haonan / xunzhao / yuyu / chunmei / wenju / 圣涛 …）依赖该服务。

同时有两项事实使方案可以做得很轻：

- `origin` 为 SSH remote（`git@github.com:dipinllx-source/relay-service.git`），`git ls-remote --tags origin` **零凭据**即可枚举远端 tag —— 不需要 GitHub token，不受 API 速率限制，不依赖 HTTP 出网。
- v1.2.2 起已建立 `vX.Y.Z` 分支 + 同名 tag 的发布惯例，tag 可直接充当发布契约。

## What Changes

- **感知**：`/admin/check-updates` 改为以 `git ls-remote --tags origin` 取最大 semver tag，与 `package.json.version` 比较，替换写死的 `hasUpdate:false`。修正 `compareVersions`（`system.js:72`）的 prerelease 处理 —— 现实现 `Number("3-alpha") → NaN` 兜底为 0，会把 `1.2.3-alpha` 判为等于 `1.2.3`。prerelease tag 默认不触发提示。
- **提示（L3 详细度）**：`hasUpdate` 时在管理台展示 ① 版本对比 ② 变更清单（`git log <prev>..<new>`，按 conventional commit 分组，过滤 `chore: 版本号升级` 噪音）③ 影响面与**将执行的步骤清单**（含「重启会中断进行中会话」警示）。恢复被移除的「检查更新」入口。
- **一键升级**：新增 `POST /admin/upgrade`，按 diff 裁剪步骤后执行；进度与结果**持久化到 Redis**（跨进程重启可查）；末步 `process.exit(0)`，由 systemd 以新代码拉起。
- **进程守护**：新增 systemd unit 托管 app（`Restart=always`），并协调 `manage.js` 的 daemon/PID 逻辑，消除与 systemd 的双重管理。

## Non-Goals

- **上游 fork 同步**：不感知、不 merge `wei-shaw/claude-relay-service`。本仓已实质分叉，自动 merge 不可行；如需跟进上游修复，属独立的人工 review 流程（当前连 `upstream` remote 都未配置）。
- **回滚**：本次不提供回滚入口，升级失败由人 ssh 处置。该决定的代价通过「失败反馈必须跨重启可查 + systemd 兜底」补偿（见 design.md D9）。
- **无人值守 / 定时自动升级**：不做。人工挑时机即是排空机制的替代 —— 线上 `/openai/responses` 实测最慢 95420ms，重启会硬切在途 SSE 流。
- **排空（drain）与零停机**：单实例部署，不做。
- **CI 与容器化**：不引入 GitHub Actions（当前 `.github/workflows` 不存在）；仓内 `Dockerfile` / `docker-compose.yml` 维持不使用（机器未装 docker）。构建维持在服务器执行。
- **SQLite schema 逆向迁移**：`_schema_version=1`，本变更不引入 schema 变更，也不为回滚准备 down 迁移。
- **多实例 / 蓝绿部署**：不重构为 releases 目录 + 符号链接布局。

## Impact

- `src/routes/admin/system.js` — `/check-updates` 重写；`compareVersions` 修正（`:72`）
- 新增 `src/services/upgradeService.js` — 版本感知、diff 分析、步骤编排、进度持久化
- 新增 `src/routes/admin/upgrade.js` — `POST /admin/upgrade`、`GET /admin/upgrade/status`
- `src/routes/admin/index.js` — 注册新路由
- `web/admin-spa/src/components/layout/MainLayout.vue` — L3 提示 UI 与「检查更新」入口。`versionInfo` 已含 `latest` / `hasUpdate` / `releaseInfo` 字段（`:414` 定义、`:421` 赋值、`:569` onMounted 调用），当前仅渲染 `current`（`:192`）
- `web/admin-spa/src/utils/http_apis.js` — 升级相关 API（`checkUpdatesApi` 已存在，`:393`）
- 新增 systemd unit + 一次性切换步骤（`relay-redis.service` 可作范本）
- `scripts/manage.js` — daemon/PID 逻辑与 systemd 协调（`PID_FILE`，`:9`）
- **不动**：Redis 数据结构、`metadataSync`、认证与调度热路径、`sortAccountsByPriority`
