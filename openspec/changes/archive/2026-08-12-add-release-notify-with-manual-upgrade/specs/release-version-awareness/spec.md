# release-version-awareness

## ADDED Requirements

### Requirement: 以远端 tag 为发布权威来源
版本感知 SHALL 通过 `git ls-remote --tags origin` 枚举远端 tag，取符合 `^v\d+\.\d+\.\d+(-[\w.]+)?$` 的最大 semver 作为最新发布版本；MUST NOT 请求 GitHub HTTP API，MUST NOT 依赖任何额外凭据。所有后续 git 操作 MUST 使用全限定引用 `refs/tags/<tag>`，MUST NOT 使用裸 tag 名。

#### Scenario: 已是最新版本
- **WHEN** `package.json.version = 1.2.3`，远端最大 tag 为 `v1.2.3`
- **THEN** `/admin/check-updates` 返回 `hasUpdate: false`，`current` 与 `latest` 均为 `1.2.3`

#### Scenario: 存在新版本
- **WHEN** 本地 `1.2.3`，远端存在 `v1.2.4`
- **THEN** 返回 `hasUpdate: true`、`latest: "1.2.4"`，并附带变更清单与影响面

#### Scenario: 同名分支与 tag 并存不产生歧义
- **WHEN** 远端同时存在分支 `v1.2.4` 与 tag `v1.2.4`，且分支已前进到额外 commit
- **THEN** 感知与后续升级 MUST 仅采用 `refs/tags/v1.2.4` 所指 commit，不受分支位置影响

#### Scenario: 远端不可达
- **WHEN** `git ls-remote` 失败（网络或鉴权异常）
- **THEN** 返回 `hasUpdate: false` 并携带错误说明，MUST NOT 抛出未捕获异常，MUST NOT 阻塞管理台加载

### Requirement: semver 比较正确处理 prerelease
版本比较 SHALL 遵循 semver 优先级，`1.2.4-rc.1` MUST 判定小于 `1.2.4`；MUST NOT 因 `Number("4-rc.1")` 为 `NaN` 而将 prerelease 判定为等于正式版。prerelease tag 默认 SHALL NOT 触发升级提示。

#### Scenario: prerelease 不误判为正式版
- **WHEN** 本地 `1.2.4`，远端最大 tag 为 `v1.2.4-rc.1`
- **THEN** `hasUpdate: false`（prerelease 更旧，且默认不提示）

#### Scenario: 正式版发布后提示
- **WHEN** 本地 `1.2.4-rc.1`，远端存在 `v1.2.4`
- **THEN** `hasUpdate: true`

### Requirement: L3 级升级提示内容
`hasUpdate` 为真时，响应 SHALL 包含：当前与目标版本、变更清单、影响面统计、以及本次升级将执行的步骤清单。变更清单 SHALL 取 `git log refs/tags/<current>..refs/tags/<latest>`，按 conventional commit 类型分组，并 SHALL 过滤纯版本号提交（`chore:` 且仅改 `package.json`/`VERSION`）。步骤清单中「重启服务」项 SHALL 携带会中断进行中会话的警示标记。

#### Scenario: 展示有意义的变更而非版本号提交
- **WHEN** `v1.2.2..v1.2.3` 区间含 3 个提交，其中 `0d39be2 chore: 版本号升级为 1.2.3` 为版本号提交
- **THEN** 清单展示 `feat: 账户与 APIKey 全量持久化到 SQLite` 与 `fix: 账户删除相关缺陷与 mass-assignment 加固`，版本号提交被折叠或过滤

#### Scenario: 本地版本无对应 tag
- **WHEN** `package.json.version` 在远端无同名 tag（如本地为未发布的开发态）
- **THEN** 变更清单降级为「无法比对」，其余字段（current/latest/hasUpdate）仍 MUST 正常返回
