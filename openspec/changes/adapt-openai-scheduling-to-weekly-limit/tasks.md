# Tasks — Adapt OpenAI Scheduling to Weekly-Only Limit

## 1. 调度：usage band 排序与硬保护

- [x] 1.1 `config/config.js` 新增 `openai.usageBandWidth`（`OPENAI_USAGE_BAND_WIDTH`，默认 30）与 `openai.usageHardLimit`（`OPENAI_USAGE_HARD_LIMIT`，默认 95），均做 1-100 边界钳制；`.env.example` 补两行带注释的示例
- [x] 1.2 `unifiedOpenAIScheduler` 新增 `_codexUsedPercent(account)`：解析 `codexPrimaryUsedPercent`，非数值/缺失返回 `null`；新增 `_codexUsageBand(account)`：`null → 0`，否则 `floor(percent / bandWidth)`
- [x] 1.3 新增 `_sortAccountsForOpenAI(accounts)`：排序键 `(priority ASC, usageBand ASC, lastUsedAt ASC, createdAt ASC)`，不修改 `commonHelper.sortAccountsByPriority`
- [x] 1.4 新增硬保护过滤：候选池组装完成后剔除 `usedPercent ≥ hardLimit` 的账号；若剔除后池空则放行全部被剔除账号并记 warn 日志（含各账号 percent）
- [x] 1.5 替换 `selectAccountFromGroup`（~L997）与 `_getAllAvailableAccounts` 消费路径的排序调用为 `_sortAccountsForOpenAI`，过滤插在排序前；粘性会话校验路径（`_isAccountAvailable`）不加 usedPercent 判断
- [x] 1.6 单元测试：band 计算（null/0/29.9/30/边界/bandWidth=100）、排序（关闭态输出与 `sortAccountsByPriority` 逐元素一致、同档内 LRU 保持、跨档覆盖 lastUsedAt）、硬保护（部分超限剔除、全部超限池空放行、hardLimit=100 不剔除）

## 2. 展示：动态窗口标签与空窗口隐藏

- [x] 2.1 `AccountsView.vue` 重写 `getCodexWindowLabel`：改为接收窗口对象，按 `windowMinutes` 推导（300→'5h'、10080→'周限'、<1440→'Nh'、≥1440→'Nd'、缺失但有 usedPercent→'限额'）
- [x] 2.2 卡片视图（~L1149）与列表视图（~L1749）两处：primary/secondary 窗口块分别加渲染条件（`usedPercent`/`resetAfterSeconds`/`windowMinutes` 至少一项有效非零），两处调用点同步改标签传参
- [ ] 2.3 重新构建 admin-spa，冒烟验证：当前线上 4 账号应各显示**单条"周限"进度条**（38/20/18/13%），无空的 5h 或周限占位

## 3. 验证与灰度

- [ ] 3.1 关闭态回归：`OPENAI_USAGE_BAND_WIDTH=100` + `OPENAI_USAGE_HARD_LIMIT=100` 启动，对比改动前后选号日志顺序一致
- [ ] 3.2 默认参数上线，观察一周：4 账号 `codexPrimaryUsedPercent` 方差应收敛（新会话流向低档账号）
- [x] 3.3 硬保护演练：Redis 手工将某账号 percent 置 ≥95，验证其被剔除、日志正确；再将全部账号置 ≥95，验证池空放行路径与 warn 日志
