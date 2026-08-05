# codex-usage-window-display

## ADDED Requirements

### Requirement: 窗口标签按时长动态推导
管理台 Codex 用量窗口标签 SHALL 由该窗口的 `windowMinutes` 推导，而非按 primary/secondary 槽位写死：`300 → '5h'`；`10080 → '周限'`；其他 `< 1440 → 'Nh'`（round(minutes/60)）；其他 `≥ 1440 → 'Nd'`（round(minutes/1440)）；`windowMinutes` 缺失但存在 `usedPercent` 时 SHALL 显示通用标签 `'限额'`。

#### Scenario: 当前线上形态（仅周限，落 primary 槽位）
- **WHEN** 账号数据为 `primary.windowMinutes=10080, usedPercent=38`，secondary 无数据
- **THEN** 显示单条标注为"周限"的进度条（38%），不出现 "5h" 字样

#### Scenario: 上游恢复双窗口
- **WHEN** `primary.windowMinutes=300`、`secondary.windowMinutes=10080`
- **THEN** 两条进度条分别标注 "5h" 与 "周限"，无需代码改动

#### Scenario: 未知窗口时长
- **WHEN** `windowMinutes=4320`（3 天）
- **THEN** 标注为 "3d"

### Requirement: 空窗口不渲染
窗口的 `usedPercent`、`resetAfterSeconds`、`windowMinutes` 均为空或 0 时，该窗口块 SHALL 不渲染；卡片视图与列表视图两处渲染位行为 MUST 一致。

#### Scenario: secondary 全零不渲染
- **WHEN** `secondary.usedPercent=0, resetAfterSeconds=0, windowMinutes=0`（当前线上形态）
- **THEN** 界面不出现空的"周限 0%"占位条

#### Scenario: 完全无数据账号
- **WHEN** 账号无任何 codexUsage 数据
- **THEN** 保持现有"暂无统计"占位显示
