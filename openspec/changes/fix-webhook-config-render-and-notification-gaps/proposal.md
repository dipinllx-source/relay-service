## Why

管理台「通知设置」页当前在生产环境完全白屏：后端返回的 webhook 配置缺 `retrySettings` 字段，前端赋值时未兜底，模板无条件读三层属性导致渲染抛错，整段消失。同一功能域还有一类通知（`accountEvent`）被入口判断静默丢弃 —— 代码在发送、用户永远收不到、日志里没有任何痕迹。

这两个缺陷都不是「不好看」，而是功能已经不可用或结果错误，且都源于同一个模式：**配置结构与实际代码约定不一致时，系统选择崩溃或静默失败，而不是降级**。附带存在若干写入后从不被读取、或与实际行为矛盾的配置项，它们会持续误导使用者。

## What Changes

- **修复通知设置页白屏**：webhook 配置在缺字段时必须降级为默认值而非崩溃。后端返回前与默认配置做键级合并；前端赋值对嵌套对象同样兜底；模板对嵌套属性做安全访问。三处均补，任一环节回退都不再导致整页不可用。
- **修复 `accountEvent` 通知被静默丢弃**：将该类型补入默认通知类型注册表，并在设置页暴露对应开关。同时给「因类型未开启而拦截」的分支补日志，使此类丢弃可观测。
- **移除无触发源的通知类型**：`quotaWarning`、`systemError`、`securityAlert` 三类在后端有定义、UI 有开关，但全仓无任何发送调用点，属永不触发的空开关，从默认注册表与 UI 中移除。
- **移除失效配置项 `retrySettings.timeout`**：该字段写入配置后从不被读取，实际超时一律取平台级配置。删除对应输入项，超时语义收归平台级。
- **修正 `serviceRates.baseService` 的语义矛盾**：该字段不参与任何计费计算，但 UI 声称「以 X 为基准（倍率 1.0）」，该说法可被配置直接推翻。改为不再提交该字段并将说明改为静态文案。
- **BREAKING**：移除三个通知类型与 `retrySettings.timeout` 后，已存储的旧配置中这些键将被忽略。因它们本就不产生任何行为，不影响实际通知投递。

## Capabilities

### New Capabilities

- `webhook-config-integrity`: webhook 配置的结构完整性与渲染韧性 —— 配置缺失字段时的默认值合并策略，以及前端在配置不完整时必须保持可用而非白屏。
- `webhook-notification-delivery`: 通知类型注册表与实际发送调用点的一致性 —— 注册表必须覆盖所有实际发送的类型、不得包含无触发源的类型，以及类型级拦截的可观测性。
- `settings-field-consistency`: 管理台设置项与后端实际行为的一致性 —— 配置项要么被真实读取生效，要么不应作为可编辑项暴露；说明文案不得与实际计算逻辑矛盾。

### Modified Capabilities

<!-- 现有 specs（backup-restore、manual-upgrade-execution、release-version-awareness、service-process-supervision）与本次变更无关，无既有需求发生变化。 -->

## Impact

**后端**

- `src/services/webhookConfigService.js`：`getConfig()` 的返回值合并策略；`getDefaultConfig()` 的通知类型注册表增删。
- `src/services/webhookService.js`：类型级拦截分支的日志补充；`sendToPlatform` 的 retrySettings 取值收窄。
- `src/services/serviceRatesService.js` 与 `src/routes/admin/serviceRates.js`：`baseService` 字段的接收与存储。

**前端**（`web/admin-spa`）

- `views/SettingsView.vue`：`loadWebhookConfig` 的赋值兜底、webhook 段模板的安全访问、通知类型开关列表、高级设置中超时输入项的移除、服务倍率说明文案。

**接口与数据**

- `GET /admin/webhook/config` 响应结构补齐缺失字段（对调用方是增量，不破坏既有字段）。
- Redis 中已存储的 webhook 配置无需迁移，读取时按默认值合并即可兼容。

**部署**

- 后端改动需重启常驻进程方可生效；前端改动需重新构建并发布 SPA 产物。两者均在 git 版本控制内，可按提交回滚。

**风险**

- 通知类型注册表增删会改变设置页展示项，需确认无外部系统依赖被移除的三个类型（已核查：全仓无发送调用点）。
- `baseService` 停止提交后，若未来要引入真正的基准校验，需重新设计，届时属新变更。
