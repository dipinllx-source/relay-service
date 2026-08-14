## ADDED Requirements

### Requirement: 预检以语义判定区分可再生噪音与人工改动
升级预检 SHALL 对每个已跟踪的脏文件逐一判定其改动是「工具可再生的噪音」还是「需要人介入的改动」，MUST NOT 仅以「工作区是否有字节变化」作为判据。可判为噪音的路径 SHALL 限定于显式白名单 `package-lock.json` 与 `web/admin-spa/package-lock.json`；白名单外的任何路径 MUST 判为阻断。

对白名单内的文件，判为噪音 SHALL 同时满足两个条件：其一，HEAD 版本与工作区版本在将 `version` 与 `packages[""].version` 归一化为同一占位值后深比较**完全相等**；其二，工作区版本的 `version` 严格等于 `package.json` 的 `version`。判定 MUST 失败闭合 —— 解析失败、字段缺失、存在其他字段差异、文件在 HEAD 中不存在，以及任何未预期异常，一律判为阻断。

未跟踪文件 SHALL NOT 参与预检判定（`git status --porcelain -uno`）：除目标提交恰好要新建同名文件这一情形外（该情形由 `checkout` 自身报错暴露，并由既有的原子回退兜住），它们既不会导致 `checkout` 失败，也不会被 `checkout` 删除。

存在阻断项时 SHALL 中止升级并返回 409，报错 SHALL 逐文件给出判定结果与判定原因，并给出可执行的后续命令建议。MUST NOT 提供「忽略并继续」之类的绕过开关。

#### Scenario: npm install 造成的 lock 版本号对齐被放行
- **WHEN** 工作区因执行过 `npm install` 而出现 ` M package-lock.json`，其与 HEAD 的差异仅为 `version` 与 `packages[""].version` 两处，且其值等于 `package.json` 的 `version`
- **THEN** 该文件 SHALL 判为噪音
- **AND** 升级 SHALL 继续执行，不返回 409

#### Scenario: lock 出现真实依赖变更时阻断
- **WHEN** `package-lock.json` 的 `packages` 中增删了依赖条目，即使其 `version` 字段与 `package.json` 一致
- **THEN** 归一化深比较不相等，该文件 SHALL 判为阻断
- **AND** SHALL 返回 409 且 MUST NOT 丢弃或 stash 该改动

#### Scenario: lock 版本号被人为改成任意值时阻断
- **WHEN** `package-lock.json` 除 `version` 两处外无其他差异，但其值不等于 `package.json` 的 `version`
- **THEN** 该文件 SHALL 判为阻断（不能证明其为 npm 对齐产物）

#### Scenario: lock 无法解析时阻断
- **WHEN** `package-lock.json` 的工作区版本或 HEAD 版本 `JSON.parse` 失败
- **THEN** SHALL 判为阻断，MUST NOT 因判定过程异常而放行，也 MUST NOT 抛出未捕获异常

#### Scenario: 源码手改仍然阻断
- **WHEN** 工作区存在 ` M src/services/upgradeRunner.js`
- **THEN** 该文件因不在白名单内 SHALL 判为阻断，返回 409
- **AND** 报错 SHALL 指出具体文件与原因，且该改动 MUST 保持原样不被处置

#### Scenario: 未跟踪文件不阻断升级
- **WHEN** 工作区存在未跟踪的 `nohup.out` 与 `web/admin-spa/dist/**`，无其他脏文件
- **THEN** 预检 SHALL 通过，升级正常执行
- **AND** 升级完成后这些文件 SHALL 仍存在于原位置

### Requirement: 噪音改动以可逆方式处置并留痕
判为噪音的文件 SHALL 在执行 `checkout` **之前**被处置，处置方式 SHALL 为 `git stash push` 并携带可识别的 message 前缀 `<upgrade-preflight>`（含目标 tag 与时间）；MUST NOT 使用 `git checkout --` 等不可逆的丢弃方式，使得判定万一有误时改动仍可从 `git stash list` 取回。

处置结果 SHALL 同时写入升级状态与日志，包含文件清单与 stash ref；MUST NOT 静默修改工作区。流水线 MUST NOT 在任何分支（含成功、失败、原子回退）自动执行 `git stash pop` 或 `git stash apply` —— 恢复会重新弄脏工作区，而目标 tag 的 lock 已是对齐版本。

`git stash push` 自身失败时 SHALL 中止升级，MUST NOT 带着未处置的脏工作区继续执行 `checkout`。

#### Scenario: 自愈后可追溯
- **WHEN** 预检把 `package-lock.json` 判为噪音并完成处置
- **THEN** `git stash list` SHALL 存在一条以 `<upgrade-preflight>` 开头的记录
- **AND** 升级状态中 SHALL 可读到该文件清单与对应的 stash ref
- **AND** 日志中 SHALL 有相应记录

#### Scenario: 升级完成后不恢复被 stash 的改动
- **WHEN** 升级成功完成并重启
- **THEN** 工作区 SHALL 保持干净，被 stash 的改动 SHALL NOT 被自动恢复
- **AND** 下一次升级 SHALL NOT 因该改动再次被拦

#### Scenario: stash 失败时不继续
- **WHEN** `git stash push` 返回非零
- **THEN** 流水线 SHALL 中止并返回 409，MUST NOT 执行 `git checkout`

### Requirement: 预检判定在 CLI 与 HTTP 路径唯一实现
工作区预检的判定与处置 SHALL 只存在一份实现，HTTP 升级端点与 `scripts/manage.js` 的 CLI 升级路径 SHALL 共用之；MUST NOT 各自维护独立的 `git status` 检查逻辑。两条路径在判定结论、报错文案与状态持久化上 SHALL 表现一致；两者在重启机制上的差异（CLI 走进程管理器 restart，HTTP 走 `process.exit(0)`）SHALL 保持不变。

#### Scenario: CLI 与 HTTP 判定一致
- **WHEN** 同一份脏工作区分别经 HTTP 端点与 CLI 触发升级
- **THEN** 两者 SHALL 给出相同的判定结论与相同的逐文件报错文案
- **AND** 两者 SHALL 同样把预检结果持久化到 Redis

## MODIFIED Requirements

### Requirement: 构建失败不得影响在运行的服务
任一前置步骤（拉取、依赖安装、前端构建）失败时，流水线 SHALL 中止且 MUST NOT 重启服务；服务 MUST 继续以升级前的版本运行。失败结果 SHALL 记录失败步骤名与输出尾部。

#### Scenario: eslint 阻断前端构建
- **WHEN** `build:web` 因 `vite-plugin-checker` 报告 eslint 错误而失败
- **THEN** 流水线中止、服务未重启、`/admin/check-updates` 的 `current` 仍为旧版本，且状态中可读到该步骤失败与 lint 输出尾部

#### Scenario: 工作区存在需人介入的改动
- **WHEN** 升级前存在已跟踪的脏文件，且其中至少一项按语义判定为阻断（白名单外路径，或白名单内但非纯版本号对齐）
- **THEN** 中止并返回 409，MUST NOT 执行 checkout
- **AND** 报错 SHALL 逐文件列出判定结果与原因

#### Scenario: 工作区仅有可再生噪音
- **WHEN** 升级前的已跟踪脏文件全部按语义判定为噪音
- **THEN** SHALL NOT 中止；噪音先以可逆方式处置并留痕，随后正常执行 checkout

### Requirement: 升级进度跨进程重启可查
升级的计划、逐步状态与最终结果 SHALL 持久化至 Redis，MUST NOT 仅保存在进程内存中。该要求 SHALL 覆盖预检阶段：升级状态 SHALL 在获取互斥锁之后、执行预检之前即完成初始化（初始状态标记为预检中），使得全部预检失败情形 —— 非法 tag、远端不存在该 tag、工作区存在需人介入的改动、当前已是目标版本 —— 均写入持久化记录；MUST NOT 出现「失败了但记录仍是上一次结果」的情形。

持久化记录 SHALL 包含预检发现（脏文件清单、每项判定结论与原因、处置结果与 stash ref）。重启后 `GET /admin/upgrade/status` SHALL 仍能返回上一次升级的完整记录，包含每步的状态、耗时与失败输出尾部。因并发互斥而被拒绝的触发 MUST NOT 覆写上一次的升级记录。

#### Scenario: 重启后仍可查看结果
- **WHEN** 升级成功并触发进程退出与重启，管理员随后刷新页面
- **THEN** 界面 SHALL 显示上一次升级的最终结果与各步骤明细，而非空白

#### Scenario: 预检失败可在管理台查询
- **WHEN** 升级因预检失败被拒（四类情形任一）
- **THEN** 持久化记录 SHALL 更新为本次的失败状态与失败原因
- **AND** 管理员刷新页面 SHALL 看到本次失败而非上一次的记录，不必登录服务器翻日志

#### Scenario: 并发拒绝不覆盖历史记录
- **WHEN** 已有升级在执行中，再次触发并被 409 拒绝
- **THEN** 持久化记录 SHALL 保持为进行中的那次，MUST NOT 被该次拒绝覆写

#### Scenario: 以版本变化确认升级完成
- **WHEN** 前端在重启后轮询 `GET /admin/check-updates`
- **THEN** 当 `current` 等于目标版本时判定升级完成（该判定 MUST 基于鉴权端点，MUST NOT 依赖 `/health` 的非可信来源精简响应）
