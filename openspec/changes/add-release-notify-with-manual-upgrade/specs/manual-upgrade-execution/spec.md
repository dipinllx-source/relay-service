# manual-upgrade-execution

## ADDED Requirements

### Requirement: 人工触发的升级端点
升级 SHALL 仅由管理台显式操作触发（`POST /admin/upgrade`，需 admin 鉴权）；MUST NOT 存在定时或事件驱动的自动升级路径。目标版本 SHALL 由服务端从远端 tag 集合中选定或校验，客户端传入的目标 tag MUST 通过 `^v\d+\.\d+\.\d+(-[\w.]+)?$` 校验且 MUST 存在于 `git ls-remote` 结果集中；MUST NOT 接受任意 ref、路径或命令参数。

#### Scenario: 正常触发
- **WHEN** 管理员在提示界面点击升级，目标 `v1.2.4` 存在于远端 tag 集合
- **THEN** 服务端受理并返回受理凭据，随后按裁剪后的步骤执行

#### Scenario: 拒绝非法目标
- **WHEN** 请求目标为 `main`、`../etc/passwd` 或远端不存在的 `v9.9.9`
- **THEN** 返回 400 且不执行任何 git 操作

#### Scenario: 并发触发互斥
- **WHEN** 已有升级在执行中，再次触发
- **THEN** 返回 409 并提示进行中，MUST NOT 启动第二条流水线

### Requirement: 按变更内容裁剪升级步骤
升级流水线 SHALL 依据 `refs/tags/<from>..refs/tags/<to>` 的变更文件与依赖内容决定执行哪些步骤：根 `package.json` 的 `dependencies`/`devDependencies` 键值集合变化时才执行 `npm install`；`web/admin-spa/package.json` 依赖集合变化时才执行 `install:web`；`web/admin-spa/**`（除其 `package.json`）变更时才执行 `build:web`。MUST NOT 仅因 `package.json` 文件被修改（如仅 `version` 字段）就判定需要安装依赖。

#### Scenario: 仅版本号变更不触发依赖安装
- **WHEN** 区间内 `package.json` 仅 `version` 字段变化，依赖集合未变
- **THEN** 跳过 `npm install`，并在步骤清单中标记为「已跳过（依赖未变）」

#### Scenario: 纯后端变更跳过前端构建
- **WHEN** 区间内仅 `src/**` 变更
- **THEN** 跳过 `install:web` 与 `build:web`，仅拉取代码后重启

#### Scenario: 纯文档变更无需重启
- **WHEN** 区间内仅 `*.md` 与 `openspec/**` 变更
- **THEN** 完成代码更新后 SHALL NOT 重启服务

### Requirement: 构建失败不得影响在运行的服务
任一前置步骤（拉取、依赖安装、前端构建）失败时，流水线 SHALL 中止且 MUST NOT 重启服务；服务 MUST 继续以升级前的版本运行。失败结果 SHALL 记录失败步骤名与输出尾部。

#### Scenario: eslint 阻断前端构建
- **WHEN** `build:web` 因 `vite-plugin-checker` 报告 eslint 错误而失败
- **THEN** 流水线中止、服务未重启、`/admin/check-updates` 的 `current` 仍为旧版本，且状态中可读到该步骤失败与 lint 输出尾部

#### Scenario: 工作区不干净
- **WHEN** 升级前 `git status --porcelain` 非空
- **THEN** 中止并提示，MUST NOT 执行 checkout

### Requirement: 升级进度跨进程重启可查
升级的计划、逐步状态与最终结果 SHALL 持久化至 Redis，MUST NOT 仅保存在进程内存中。重启后 `GET /admin/upgrade/status` SHALL 仍能返回上一次升级的完整记录，包含每步的状态、耗时与失败输出尾部。

#### Scenario: 重启后仍可查看结果
- **WHEN** 升级成功并触发进程退出与重启，管理员随后刷新页面
- **THEN** 界面 SHALL 显示上一次升级的最终结果与各步骤明细，而非空白

#### Scenario: 以版本变化确认升级完成
- **WHEN** 前端在重启后轮询 `GET /admin/check-updates`
- **THEN** 当 `current` 等于目标版本时判定升级完成（该判定 MUST 基于鉴权端点，MUST NOT 依赖 `/health` 的非可信来源精简响应）

### Requirement: 通过退出进程完成版本切换
所有前置步骤成功后，升级 SHALL 通过 `process.exit(0)` 结束当前进程以交由进程管理器加载新代码；MUST NOT 通过在应用内派生 detached 子进程来自行重启。退出前 SHALL 先完成状态持久化并向客户端返回明确的「即将重启」响应。

#### Scenario: 退出前状态已落盘
- **WHEN** 流水线成功、即将退出
- **THEN** Redis 中已存在标记为「等待重启」的记录，客户端已收到重启中的响应
