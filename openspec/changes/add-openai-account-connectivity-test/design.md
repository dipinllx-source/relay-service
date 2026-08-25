## Context

现有连通性测试有两个「面」，本变更只补前者：

```
   手动测试（本变更范围）                  定时测试（不在范围）
   ─────────────────────                   ────────────────
   前端 UnifiedTestModal                   accountTestSchedulerService
     endpoints[platform] ──▶ POST /test      _testXxxAccount()
                                                 └─ claude 已实现，openai 仍 stub
```

claude 的手动测试实现路径，是本变更要对齐的模板：

```
   POST /admin/claude-accounts/:id/test   (claudeAccounts.js:1042)
        │  res 直接透传给服务层
        ▼
   claudeRelayService.testAccountConnection(accountId, res, model)
        │
        ├─ _prepareAccountForTest(accountId)
        │     getAccount → getValidAccessToken → _getProxyAgent
        │
        ├─ createClaudeTestPayload(model, {stream:true})
        ├─ 复用现有流式请求方法 _makeClaudeStreamRequestWithUsageCapture
        └─ _createTestStreamTransformer 把上游格式转成前端期望的 SSE 事件
```

关键差异：**openai(Codex) 账户的出站，和 claude 不是一套东西**。Codex 请求逻辑现在内联写死在 `openaiRoutes.js`，没有抽成 relay service，所以本变更需要新建一个可复用的测试方法。

## Codex 出站请求的确切构造（来自 openaiRoutes.js）

```
   POST https://chatgpt.com/backend-api/codex/responses
   headers:
     authorization:      Bearer <解密后的 accessToken>
     chatgpt-account-id: account.accountId || account.chatgptUserId || accountId
     host:               chatgpt.com
     accept:             text/event-stream   (流式) / application/json
     content-type:       application/json
   body:                 Responses API 格式，且强制 store=false
   proxy:                account.proxy → createProxyAgent
```

正常业务里 body 是 Codex CLI **透传**过来的，relay 只补 header + `store=false`。测试时没有客户端 body，必须自己造一个合法的 Responses payload。

## 模型清单：实测结论（本设计的基础事实）

**上游存在可用的模型清单接口**，已在 43.110.32.63 用真实 Codex 账户（Dipin-chatGPT-Plus）实测确认：

```
   GET https://chatgpt.com/backend-api/codex/models?client_version=<v>
   headers: authorization: Bearer <access_token>     ← 唯一必需的头
```

实测行为：

| client_version | 返回模型数 | 首个模型 |
|---|---|---|
| 缺省（不传） | — | 400 `{'loc': ('query','client_version'), 'msg': 'Field required'}` |
| 0.38.0 / 0.50.0 / 0.89.0 / 0.90.0 / 0.95.0 | 0 | — |
| 0.99.0 | 3 | `gpt-5.4` |
| 0.100.0 / 0.110.0 | 4 | `gpt-5.4` |
| 0.139.0（本机主力流量版本） | 5 | `gpt-5.5` |
| **0.144.5（本机最新流量版本）** | **8** | **`gpt-5.6-sol`** |
| 0.149.1（npm `@openai/codex` latest） | 8 | `gpt-5.6-sol` |
| 0.160.0 / 1.0.0 / 1.2.0 / 2.0.0 / 9.9.9 | 8 | `gpt-5.6-sol` |

四条关键性质：

1. `client_version` 是**必填** query 参数，缺失直接 400。
2. 服务端按 `client_version` 做**真·语义版本比较并细粒度裁剪**清单：版本越新解锁越多模型，低版本返回空数组或部分清单（**不是报错**）。这本质是**能力门控**——上游只回该客户端版本支持的模型。
3. 当前在 `0.144.5` 及以上饱和为 8 个。注意 `0.139.0` 只给 5 个、`0.99.0` 只给 3 个，**版本落后会静默拿到不完整清单**。
4. `user-agent`、`originator`、`chatgpt-account-id` 实测**均非必需**，仅 `Authorization` 必需。

**「固定填 1.0.0」是个陷阱**：`1.0.0` 今天能拿全量，仅因真实 Codex CLI 版本仍停留在 `0.x`（语义比较下 `1.0.0` > 所有 `0.x`）。一旦 Codex CLI 进入 `1.x`，写死的 `1.0.0` 就会变成**降级**并静默截断清单。这正是本设计必须做**版本自动升级**的根本原因。


上游当前全量清单（返回体还含 `display_name` / `context_window` / `supported_reasoning_levels` 等，信息量优于 Claude 的 `/v1/models`）：

| slug | display_name | context_window |
|---|---|---|
| `gpt-5.6-sol` | GPT-5.6-Sol | 272000 |
| `gpt-5.6-terra` | GPT-5.6-Terra | 272000 |
| `gpt-5.6-luna` | GPT-5.6-Luna | 272000 |
| `gpt-5.5` | GPT-5.5 | 272000 |
| `gpt-5.4` | GPT-5.4 | 272000 |
| `gpt-5.4-mini` | GPT-5.4-Mini | 272000 |
| `gpt-5.3-codex-spark` | GPT-5.3-Codex-Spark | 128000 |
| `codex-auto-review` | Codex Auto Review | 272000 |

**静态列表已严重过期**：

| 静态列表 | 条目数 | 上游已不存在 |
|---|---|---|
| `config/models.js` `OPENAI_MODELS` | 14 | **12**（`gpt-5`、`gpt-5-mini`、`gpt-5-nano`、`gpt-5.1`、`gpt-5.1-codex`、`gpt-5.1-codex-max`、`gpt-5.1-codex-mini`、`gpt-5.2`、`gpt-5.2-codex`、`gpt-5.3-codex`、`gpt-5.4-pro`、`codex-mini`） |
| `modelService.js` `openai.models` | 10 | **8**（含 `gpt-5-codex`、`gpt-5.1-2025-11-13`、`gpt-5-2025-08-07` 等） |

上游有、两份静态列表都缺的 6 个：`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`、`gpt-5.4-mini`、`codex-auto-review`。

## 被本次实测推翻的两个前序判断

本设计此前的两条结论已作废，在此显式记录以免回退：

**作废一：「合并两份静态列表」方向错误。** 两份列表分别有 12/14 与 8/10 的条目在上游已不存在，合并只会产出一份更大的过期列表。正确方向是动态拉取 + 静态兜底。

**作废二：「默认测试模型必须是 codex 命名系列」约束错误。** 上游命名已从 `gpt-5-codex` 迁移到 `gpt-5.6-sol` 这类点号命名，8 个里仅 1 个带 `codex` 字样。而归一化规则是 `startsWith('gpt-5-')`，`gpt-5.6-sol` 属 `gpt-5.` 开头，**不会被归一化**。强制 codex 命名反而会把默认值锁死在 `gpt-5.3-codex-spark`（128k 上下文的旧模型），而非真正最新的 `gpt-5.6-sol`。归一化的坑只对遗留的 `gpt-5-mini` / `gpt-5-nano` / `gpt-5-2025-08-07` 成立，与当前上游模型无关。

## Decisions

### Decision 1：新建 `openaiRelayService`，把 Codex 出站构造抽成可复用方法

做法对齐 claude：

- `_prepareAccountForTest(accountId)` → `{ account, accessToken, proxyAgent }`
- `testAccountConnection(accountId, res, model)`（SSE），供 admin 路由直接透传 `res`

**与 claude 的三处实现差异**（照抄 claude 会踩坑）：

1. `openaiAccountService` **没有** `getValidAccessToken`。取有效 token 的既有模式是：`getAccount(id)` → `isTokenExpired(account)` 为真则 `refreshAccountToken(id)` 后再 `getAccount(id)`。
2. `openaiAccountService.getAccount()` **不解密** `accessToken`（源码注释明确「在 openaiRoutes.js 中单独解密」）。必须显式 `openaiAccountService.decrypt(account.accessToken)`。
3. 代理构造用 openai 侧的 `createProxyAgent(account.proxy)` / `ProxyHelper`，不是 claude 的 `_getProxyAgent`。

```
   testAccountConnection(accountId, res, model)
        ├─ _prepareAccountForTest
        │     getAccount → isTokenExpired? → refreshAccountToken → getAccount
        │     → decrypt(accessToken) → createProxyAgent(account.proxy)
        ├─ 造最小 Responses payload（Decision 2）
        ├─ POST chatgpt.com/backend-api/codex/responses  (stream, store:false)
        └─ 解析 SSE → 转成前端 UnifiedTestModal 期望的事件
```

未来做定时测试时只需再加 `testAccountConnectionSync`，并把 scheduler 的 `_testOpenAIAccount` 指过来——本变更留好 seam，不实现。

### Decision 2：测试 payload 用最小 Responses 体

`createOpenAITestPayload(model)` 产出 Responses 格式，测试时补 `store: false`：

```json
{ "model": "...", "input": [{"role":"user","content":"hi"}], "max_output_tokens": 100, "stream": true }
```

**最小 payload 即可**，不补 `instructions` / `tools`（真实 Codex CLI 会带那段超长 system prompt，但那是 CLI 行为，非上游硬性要求）。

**实施期实测修正（重要）**：`createOpenAITestPayload` 会产出 `max_output_tokens`，而 Codex backend **明确拒绝该参数**：

```
   POST /backend-api/codex/responses
   → 400 {"detail":"Unsupported parameter: max_output_tokens"}
```

该参数在公开 Responses API 上可用，但在 Codex backend 上会导致整个请求被拒。因此实现 MUST 在构造 payload 后**剔除** `max_output_tokens`。剔除后实测成功返回 `"Hi! How can I help?"`（模型 `gpt-5.6-sol`，耗时 1949ms）。

这条修正的方向与原先设想相反：原本预留的兜底是「若因**缺**字段被拒则补齐」，实际遇到的是「**多**了一个不被支持的参数」。若不剔除，测试会对一张完全正常的账户报失败 —— 正是本设计一直要防的假阳性。

### Decision 3：模型清单改为上游动态拉取，静态列表退化为纯兜底

新增 `openaiAccountService.fetchAvailableModels()`，对称照搬 `claudeAccountService.fetchAvailableModels()` 的成熟范式：

```
   fetchAvailableModels()
        ├─ 命中成功缓存（TTL 1h）→ 直接返回
        ├─ 命中失败缓存（TTL 1min）→ 返回 null（避免高频重试打上游）
        ├─ 从 openai 账户中挑一个可用的
        │     isActive === 'true' && status !== 'error'
        │     && schedulable !== 'false' && 未过期
        ├─ 取有效 accessToken（按 Decision 1 的取法，注意需解密）
        ├─ GET /backend-api/codex/models?client_version=<自动解析值，见 Decision 3b>
        └─ 映射 slug/display_name → 选项，写入缓存
              空数组 → 记 warn + 失败缓存 + 返回 null（由调用处兜底）
```

消费侧对齐 claude 的既有写法：`apiStats.js` 的 `GET /apiStats/models` 已有 `getDynamicClaudeModelOptions()` 与 `claudeSource: 'upstream' | 'fallback'` 标记位，openai 段照此加一份 `openaiSource`。`modelService.getAllModels()` 也已支持传入动态列表替换静态段（当前仅 claude 段可替换，需扩展到 openai 段）。

**代理**：拉取清单同样要走账户配置的代理，否则内网/受限出口环境拉取必失败。

### Decision 3b：`client_version` 自动升级（三源取最大 + 单调不降）

`client_version` MUST NOT 写死或仅依赖人工配置。原因见前文实测：上游按语义版本做**能力门控**，版本落后会**静默**拿到不完整清单（`0.139.0` 只给 5 个、`0.99.0` 只给 3 个），而写死 `1.0.0` 在 Codex CLI 进入 `1.x` 后会由「够用」变成「降级」，且这种退化不报错、无从察觉。

本仓库已有一套成熟的**从真实流量自动学习客户端版本**的机制可以照搬——`claudeRelayService.captureAndGetUnifiedUserAgent()`：

```
   claude 现有范式（可直接复用其版本比较工具）
   ────────────────────────────────────────────
   Redis key: claude_code_user_agent:daily   TTL 90000s(25h)
        ├─ 无缓存        → setex 存入
        ├─ 有缓存 且更新  → setex 覆盖（compareSemanticVersions > 0）
        └─ 有缓存 不更新  → 仅 expire 续期
   配套：compareClaudeCodeVersions / compareSemanticVersions
   管理端：GET /admin/claude-code-version（含 ttlSeconds）
           POST /admin/claude-code-version/clear
```

Codex 侧完全对称，且**流量里本来就带版本**：本机日志实测到 `codex_exec/0.139.0`（2698 次）与 `codex_exec/0.144.5`（8 次）。`openaiRoutes.js` 与 `codexCliValidator.js` 里也已有现成的识别正则 `/^(codex_vscode|codex_cli_rs|codex_exec)\/[\d.]+/i`。

**决策：`client_version` 由三个来源取最大值，并保证单调不降。**

```
   resolveCodexClientVersion()
        │
        ├─ ① 流量学习（主源，零外部依赖）
        │     从 Codex 请求 UA 提取版本 → Redis 存最大值 + TTL 续期
        │     实测本机可得 0.144.5 → 全量 8 个模型
        │
        ├─ ② npm registry（补充源，覆盖「本地客户端落后」）
        │     GET registry.npmjs.org/@openai/codex/latest → dist-tags.latest
        │     实测 0.149.1，响应仅 3.5KB；长 TTL 缓存（如 24h）
        │     失败静默跳过，绝不阻塞
        │
        └─ ③ 兜底常量（floor，保证首次冷启动可用）
              取一个已验证能拿全量的值（当前 0.144.5）

        取三者语义版本最大值 → 单调写回 Redis（只升不降）
```

三源各自的必要性：

| 源 | 解决的问题 | 缺它的后果 |
|---|---|---|
| ① 流量学习 | 自动跟随实际客户端升级，零外网依赖 | 需人工改配置，回到原问题 |
| ② npm latest | 本地客户端版本落后于官方发布时仍能拿全量 | 车队停在 `0.139.0` 就只有 5 个模型 |
| ③ floor 常量 | 冷启动、无流量、无外网时可用 | 首次部署即拿到空清单或部分清单 |

**单调不降**是硬约束：`0.144.5` 观测到之后，即使随后只见到 `0.139.0` 的请求，也 MUST NOT 回退——否则清单会随流量抖动而反复缩水。实现上沿用 claude 的做法：仅当新版本语义更大时覆盖，否则只续期 TTL。

**不采用谎报 `9.9.9`**：实测虽通且天然抗未来门控，但虚报客户端版本会让上游返回该版本并不真实支持的模型能力，属于欺骗上游，不宜写进产品代码。三源取最大已能自动跟进真实最新版。

**空结果与部分结果的处理**：

- 拿到**空数组** → MUST 记 warn（提示解析出的版本过低）+ 落入失败缓存 + 返回 null 由调用处兜底静态，MUST NOT 静默当作「上游没有模型」。
- 拿到**非空但可能不完整**的清单 → 无法从响应本身判断是否完整，故 SHALL 在日志中一并记录本次使用的 `client_version` 与返回条数，便于事后核对是否因版本落后而缩水。

管理端可观测性：照 `claude-code-version` 的样子提供查看当前解析出的 Codex 版本、各源取值与 TTL 的只读入口，并支持清缓存以强制重新解析。


### Decision 3c：静态兜底列表直接订正为上游真值，不做并集

既然已确认 12/14 与 8/10 过期，兜底列表 SHALL 直接替换为实测到的 8 个上游模型，**不与旧列表求并集**——并集会把已下线模型留在下拉框里，用户选了必然失败。

顺带清理：`codex-mini` 在 `data/model_pricing.json` 中**查无定价**（union 里唯一缺失项），上游也不存在，SHALL 从 openai 列表移除。注意它同时出现在 Azure 的 `ALLOWED_MODELS` 与 `AccountForm.vue` 的 Azure 分支里，那是 Azure 部署名、**不属本次范围，不得改动**。

### Decision 4：`PLATFORM_TEST_MODELS` 必须补 `openai` 键（不补会静默送出 Claude 模型）

测试下拉框的数据源链路：

```
   config/models.js  PLATFORM_TEST_MODELS
        │
        ▼  GET /apiStats/models   →  data.platforms[platform]
   UnifiedTestModal
        availableModels = platforms[platform] || []
        defaultModel    = availableModels[0].value        ← 取列表头部
                          ↓ 列表为空时
                          platformFallbackModels[platform]
                          ↓ 该键不存在时
                          platformFallbackModels.claude
```

`PLATFORM_TEST_MODELS` 现在**没有 `openai` 键**（只有 `openai-responses`），`platformFallbackModels` 也**没有 `openai`**。若只加端点映射而不补这两处，链路会退化成：

```
   platforms['openai'] → undefined → availableModels = []
        → platformFallbackModels['openai'] → undefined
        → platformFallbackModels.claude → 'claude-sonnet-4-5-20250929'
```

即：Codex 账户的测试会把一个 **Claude 模型名**送给 `chatgpt.com/backend-api/codex/responses`，且下拉框为空。这是会导致功能静默失效的硬约束，故在 spec 中单列一条 Requirement。

**排序即默认值**：因为默认取 `availableModels[0]`，清单顺序决定默认模型。上游返回天然是最新在前（首项 `gpt-5.6-sol`，描述 "Latest frontier agentic coding model"），故直接沿用上游顺序即可满足「默认取最新模型」，无需额外排序逻辑。兜底列表也 SHALL 保持最新在前。

### Decision 5：429 计入账户限流状态

**测试触发的 429 要计入账户限流状态**，复用 `unifiedOpenAIScheduler.markAccountRateLimited`，与业务请求遇 429 的处理一致。理由：测试打的是与业务**同一份 Codex 配额**，测试撞到的限流对调度器同样是真实事实；隐瞒它会让调度继续把业务请求投给一张已限流的账户。

结果语义与副作用是两件事，二者并存：测试**结果** SHALL 表达为「账户可达但已被限流（剩余重置时间 X）」而非「连接失败」；**副作用**是标记该账户限流。

### Decision 6：SSE 事件解析对齐 Responses 格式

Codex `/responses` 流式事件是 Responses API 格式，与 claude 不同：

- 文本增量：`response.output_text.delta`（取 `delta`）
- 完成 / 取模型：`response.completed`（取 `response.model`）
- 错误：事件 `error`，看 `error.type`（`rate_limit_error` / `usage_limit_reached` / `rate_limit_exceeded`）

测试的 stream transformer 把上述事件转成 `UnifiedTestModal` 期望的 `{type:'...'}` SSE，与 claude 的 `_createTestStreamTransformer` 角色相同但解析规则不同。

## Risks / Trade-offs

| 风险 | 说明 | 缓解 |
|---|---|---|
| 上游按 `client_version` 静默返回不完整清单 | 版本落后不报错，只是少给模型（`0.139.0`→5 个、`0.99.0`→3 个），极易被误认为「上游就这些」 | 三源取最大 + 单调不降；日志同时记录所用版本与返回条数 |
| 写死版本随时间劣化 | 写死 `1.0.0` 在 CLI 进入 `1.x` 后变成降级 | 不写死，自动升级（Decision 3b） |
| npm registry 不可达 | 补充源失效 | 静默跳过、绝不阻塞；仍有流量学习与 floor 兜底 |
| 流量版本抖动导致清单缩水 | 新旧客户端混跑，若取最近值会来回变 | 单调不降，仅当语义版本更大才覆盖 |
| 上游返回空清单 | 解析出的版本过低 | 记 warn + 失败缓存 + 回退静态，不静默 |
| 动态拉取失败影响下拉框可用性 | 上游不可达 / 无可用账户 | 沿用 claude 范式：失败返回 null，调用处回退静态列表，并用 `openaiSource` 标记来源 |
| 拉取清单需要一张可用账户的 token | 账户全不可用时拿不到清单 | 与 claude 行为一致：记 warn 并兜底静态 |
| 未走代理导致拉取失败 | 受限出口环境 | 拉取必须复用账户代理配置 |
| 缺 `openai` 键致静默送出 Claude 模型 | 只加端点不补模型配置就会发生 | Decision 4 单列 Requirement + 实测校验 |
| 兜底列表若做并集 | 已下线模型留在下拉框，选中必失败 | 直接替换为上游真值，不求并集 |
| 测试消耗周限额 | 每次点测吃 Codex 配额 | 极小 `max_output_tokens`；界面提示 |
| 测试把账户标记为限流 | 一次点测可能让账户短期不参与调度 | 有意为之；结果文案需说明已标记限流及重置时间 |
| accessToken 处理照抄 claude | claude 的 getAccount 解密、openai 不解密 | Decision 1 三处差异已固化 |
| 动到 openaiRoutes 抽取逻辑 | 可能影响正常业务链路 | 以「新增方法、不改原路径行为」为约束，原 CLI 请求路径回归验证 |
| 误改 Azure 模型列表 | `codex-mini` 同时存在于 Azure 列表 | 明确 Azure 的 `ALLOWED_MODELS` / `AccountForm.vue` Azure 分支不在范围 |

## Migration / Rollout

对连通性测试功能是纯增量。对模型清单是**行为变更**：openai 段由静态改为「上游优先 + 静态兜底」，且静态兜底内容被订正。回滚路径：移除 `fetchAvailableModels` 调用即退回纯静态；订正后的静态列表本身也比原列表更贴近上游，回滚不会更糟。无数据迁移。

## Resolved Questions

| 问题 | 结论 |
|---|---|
| 最小 Responses payload 是否够用 | **够用**，不补 `instructions` / `tools`；400 仅作兜底（Decision 2） |
| 默认测试模型取哪个 | 取上游清单**首项**（当前 `gpt-5.6-sol`）；原「必须 codex 命名」约束已作废（Decision 4） |
| 测试触发的 429 是否计入限流 | **计入**，复用 `markAccountRateLimited`；结果语义仍为「可达但限流」（Decision 5） |
| 能否通过 Codex 上游动态获取模型清单 | **能**，`GET /backend-api/codex/models?client_version=`，已实测（Decision 3） |
| 两份静态列表如何合并 | **不合并**，改动态拉取 + 静态兜底订正为上游真值（Decision 3c） |
| `client_version` 如何取值 | **自动升级**：流量学习 + npm latest + floor 常量，三源取语义版本最大且单调不降；不写死、不谎报 `9.9.9`（Decision 3b） |

## Open Questions

无。
