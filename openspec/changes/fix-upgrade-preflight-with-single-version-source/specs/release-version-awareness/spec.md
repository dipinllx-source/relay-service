## ADDED Requirements

### Requirement: 版本号单一权威来源
仓库中 `package.json` 的 `version` SHALL 是版本号的唯一权威来源。`VERSION` 文件与 `package-lock.json`（含 `web/admin-spa/package-lock.json`）中的版本字段 SHALL 视为其派生物，MUST NOT 被手工单独编辑，MUST NOT 与权威来源长期不一致。

发版 SHALL 通过统一的发版脚本（`npm run version:bump -- <semver>`）改版本号：脚本 SHALL 同步 `package.json` 与 lock 的版本字段、写入 `VERSION`，并在结束前回读三处校验一致，不一致时 SHALL 以非零状态码退出且 MUST NOT 留下部分写入的状态。入参 MUST 通过与发布 tag 相同的 semver 校验（允许 prerelease），非法入参 SHALL 被拒绝且不产生任何写入。

在干净工作区上执行 `npm install` SHALL NOT 产生版本字段差异 —— 这是「三处一致」这一约束的可观测判据，也是升级预检不被自身工具链噪音阻断的前提。

`VERSION` 文件 SHALL 保留：`L3 级升级提示内容` 依赖「`chore:` 且仅改 `package.json`/`VERSION`」这一过滤规则来折叠纯版本号提交。

#### Scenario: 发版脚本同步三处版本号
- **WHEN** 执行 `npm run version:bump -- 1.3.1`
- **THEN** `package.json` 的 `version`、`VERSION` 的内容、`package-lock.json` 的 `version` 与 `packages[""].version` SHALL 全部为 `1.3.1`
- **AND** 脚本 SHALL 以零状态码退出

#### Scenario: 三处不一致时发版脚本失败
- **WHEN** 脚本回读校验发现任一处与权威来源不一致
- **THEN** SHALL 以非零状态码退出并指出不一致的位置

#### Scenario: 拒绝非法版本号入参
- **WHEN** 执行 `npm run version:bump -- main` 或 `npm run version:bump -- 1.3`
- **THEN** SHALL 拒绝执行，MUST NOT 修改任何文件

#### Scenario: npm install 不再产生版本号噪音
- **WHEN** 在干净工作区上执行 `npm install`
- **THEN** `git status --porcelain -uno` SHALL 为空

#### Scenario: 存量偏差可被发现
- **WHEN** 某部署的 `package-lock.json` 版本字段与 `package.json` 不一致（历史遗留）
- **THEN** 该状态 SHALL 可通过一次 `npm install` 后的 `git status --porcelain -uno` 非空被识别出来，并按升级预检的语义判定归类为可再生噪音
