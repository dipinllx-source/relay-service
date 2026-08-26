## ADDED Requirements

### Requirement: 配置读取时的默认值合并
后端返回 webhook 配置前 MUST 将持久化配置与默认配置做键级合并，确保 `notificationTypes`、`retrySettings` 等嵌套对象始终存在且键完整。

合并 MUST 保留持久化配置中已有的键值，仅为缺失的键补充默认值，不得用默认值覆盖用户已保存的设置。

#### Scenario: 持久化配置缺少嵌套对象
- **WHEN** Redis 中存储的 webhook 配置不含 `retrySettings` 键
- **THEN** `GET /admin/webhook/config` 的响应中 `retrySettings` 存在且为默认值
- **AND** 响应中 `enabled`、`platforms` 等已存在的键保持持久化的原值

#### Scenario: 持久化配置的嵌套对象缺少部分键
- **WHEN** 持久化配置的 `notificationTypes` 只含部分类型键
- **THEN** 响应中该对象补齐所有默认类型键
- **AND** 持久化配置中已存在的类型键保留其原有布尔值

#### Scenario: 配置完整时不改变任何值
- **WHEN** 持久化配置已包含全部默认键
- **THEN** 响应内容与持久化配置一致，合并不引入任何值变化

### Requirement: 配置不完整时的页面可用性
通知设置页 MUST 在 webhook 配置缺失任意嵌套字段时仍然完整渲染，不得因属性访问异常导致页面空白。

前端将接口返回值写入本地状态时 MUST 对嵌套对象逐一兜底，模板访问嵌套属性时 MUST 使用安全访问方式。

#### Scenario: 接口返回缺字段时页面仍可用
- **WHEN** 接口返回的配置不含 `retrySettings`
- **THEN** 通知设置页正常显示主开关、通知类型、平台列表与高级设置
- **AND** 浏览器控制台无属性访问类型错误

#### Scenario: 直接访问与站内导航行为一致
- **WHEN** 用户直接以 URL 打开通知设置页，或从顶栏下拉进入该页
- **THEN** 两种进入方式渲染出相同且完整的内容

#### Scenario: 接口失败时给出可见反馈
- **WHEN** 获取 webhook 配置的请求失败
- **THEN** 页面结构仍然渲染并提示加载失败
- **AND** 页面不出现空白内容区
