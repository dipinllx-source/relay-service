## Why

管理台的控件规格在全站范围内发散：实测 `.vue` 文件中有 415 个 `<button>`，而引用统一按钮类的只有 51 处（约 12%）；手写的 `px-* py-*` 内边距组合有 33 种不同写法；圆角变体 7 种并存（`rounded-lg` 507 次、`rounded-full` 259 次、`rounded` 209 次、`rounded-xl` 125 次、`rounded-md` 114 次、`rounded-2xl` 32 次、`rounded-3xl` 6 次）。同一行里出现 4 种控件高度、3 种圆角是常态，个别位置还有被 flex 拉伸到 92px 的按钮和文字被挤成竖排的按钮。

根因不在各页面「写得随意」，而在基础设施缺了一块：全局类 `.btn`（`assets/styles/components.css:112`）只定义了 `font-weight`、`border-radius`、`border`、`cursor`、`transition`、`position`、`overflow`、`letter-spacing`，**没有 padding、height、font-size**。任何调用点想让按钮有正常尺寸都必须自己补内边距，于是必然发散。雪上加霜的是样式定义有三份：`main.js` 同时引入 `main.css`（内部 `@import components.css`）与 `global.css`，而 `global.css` 内部把 `.btn` 重复定义了两遍（247 行与 423 行）、`.form-input` 也重复两遍（324 行与 499 行），级联结果不可预测。

因此只替换页面类名是治标 —— 下一个功能照样会写出第 34 种内边距。必须先让样式来源唯一、给基础类补上尺寸规格，各页面才有可复用的东西。

与规格发散并存的还有三类问题：真实数据下恒定不变的表格列与恒为空的数据块仍在占据版面；未启用能力（用户体系）的页面仍可通过手敲 URL 到达并显示一整屏空数据；若干页面与组件缺暗色覆盖，暗色模式下白卡压深底。

## What Changes

- **建立单一样式来源**：移除 `global.css` 中重复两遍的样式段，使 `.btn`、`.form-input`、`.card`、`.stat-card` 各自只有一处定义。
- **给基础控件类补齐尺寸规格**：为 `.btn` 增加 sm / md / lg 尺寸变体，明确 height、padding、font-size。尺寸取值不必从零设计 —— `LandingView` 与 `StartView` 中两份字节相同的 scoped `.btn` 已有完整内边距规格，将其提升为全局基线。
- **统一控件规格**：按钮 / 输入框 / 下拉 / 分段器统一为一档高度与圆角，行内小按钮统一为另一档；卡片圆角与内边距统一；开关收敛为单一尺寸与单一选中色（当前有两种尺寸、7 种选中色、4 种实现方式，其中一处是手写 `button role="switch"`）。
- **统一表格呈现**：表头与单元格内边距一致；数值列右对齐并使用等宽数字且可排序；真实数据下恒定不变的列降级为行内次要信息而非独占列；分页收敛为单一实现并置于卡片内。
- **移除空转数据块**：恒为零值的账户余额区块整行移除；可由其他指标推导的汇总卡不再独占卡片；与已高亮控件重复的说明文案、独占整行的「共 N 个」元信息并入标题行。
- **对外展示页视觉归统**：统计页、落地页、教程页、引导页改用与管理台一致的底色、卡片与控件规格，品牌色仅保留为主按钮与高亮色，不再使用全屏渐变与独立的圆角体系。
- **未启用能力不可达**：用户体系未启用时不注册对应路由、不注入导航项，手敲 URL 落到未找到而非显示一屏空数据；依赖未启用特性的表格列不再渲染。
- **暗色模式全覆盖**：为缺少暗色变体的页面与组件补齐；主题相关的两个顶栏控件合并为单一入口（两者功能不重叠，配色方案与明暗模式均保留）；移除重复调用的主题初始化。
- **修复渲染缺陷**：flex 容器缺少居中导致按钮被纵向拉伸；表头与单元格宽度约束自相矛盾；展开行跨列数与实际列数不符；加载态与空态同时渲染。
- **移除不生效的交互控件**：登录页「记住我」勾选框未参与任何请求与会话逻辑，属纯装饰。
- **收敛重复实现**：两个使用记录页 93% 同构，抽为共用表格组件；落地页与教程页的导航与页脚 82% 相同，抽为共用布局；统计卡三套实现收敛为一套。
- **移除死代码**：无路由且无引用的余额脚本页及其专属接口函数、零引用的统计卡与标签栏组件、仅存于注释的限额徽章组件、主题组件中无调用点的两个模式分支、遗留的调试输出与图表占位。
- **BREAKING**：用户体系未启用时 `/user-management` 与 API Keys 已删除子页的路由不再存在，此前依赖手敲 URL 访问这两页的操作方式失效。

## Capabilities

### New Capabilities

- `admin-ui-control-baseline`: 控件规格的单一基线 —— 样式定义来源唯一、基础类具备完整尺寸规格、同类控件在全站（含对外展示页）使用同一档高度与圆角，且可交互控件必须产生实际效果。
- `admin-table-presentation`: 表格的呈现规则 —— 表头与单元格内边距一致、数值列对齐与排序、恒定值列的降级方式、分页实现与位置的统一。
- `admin-ui-information-density`: 数据区块的呈现密度 —— 无数据时不占位、可推导指标不独占版面、冗余与重复文案的合并规则。
- `admin-capability-exposure`: 未启用能力的暴露规则 —— 路由注册、导航注入与依赖特性的分支渲染必须与能力开关状态一致。
- `admin-ui-theme-coverage`: 暗色模式的覆盖完整性与主题入口的唯一性。
- `admin-spa-code-consolidation`: 前端代码的收敛 —— 死代码移除、同构页面与重复布局抽取为共用实现。

### Modified Capabilities

<!-- 现有 specs（backup-restore、manual-upgrade-execution、release-version-awareness、service-process-supervision）均为后端能力，与本次纯前端变更无关，无既有需求发生变化。 -->

## Impact

**样式基础设施**

- `web/admin-spa/src/assets/styles/global.css`：移除重复定义段。
- `web/admin-spa/src/assets/styles/components.css`：为 `.btn` 补尺寸变体，明确卡片与表格的基线规格。

**视图**（`web/admin-spa/src/views/`）

- 管理页：`DashboardView`、`ApiKeysView`、`AccountsView`、`RequestDetailsView`、`SettingsView`、`ApiKeyUsageRecordsView`、`AccountUsageRecordsView`、`UserManagementView`、`UserDashboardView`。
- 对外页：`ApiStatsView`、`LandingView`、`TutorialLandingView`、`TutorialView`、`StartView`、`LoginView`、`UserLoginView`。
- 删除：`BalanceScriptsView`。

**组件**（`web/admin-spa/src/components/`）

- 新增共用实现：使用记录表格、对外页导航与页脚布局。
- 修改：`layout/MainLayout`、`common/ThemeToggle`、`accounts/`、`apikeys/`、`settings/`、`user/` 下相关组件。
- 删除：`common/StatCard.vue`、`layout/TabBar.vue`、`apikeys/LimitBadge.vue`。

**路由与接口**

- `router/index.js`：用户管理与已删除子页改为按能力开关条件注册。
- `utils/http_apis.js`：移除随余额脚本页一并失效的三个接口函数。

**部署**

- 纯前端变更，需重新构建并发布 SPA 产物，无需重启后端。改动均在 git 版本控制内，可按提交回滚。

**风险**

- 改动面覆盖几乎全部前端视图，回归范围大。需按「样式来源 → 基础类 → 逐页替换 → 删死代码」的顺序推进，每步可独立验证与回滚。
- 视觉变化明显（对外页归统、控件尺寸变化、表格列减少），使用者需要重新适应，属预期内的取舍。
