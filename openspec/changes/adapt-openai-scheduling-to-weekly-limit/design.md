# Design — Adapt OpenAI Scheduling to Weekly-Only Limit

## D1. 分档 + 档内 LRU，而非直接排序或加权打分

| 备选 | 否决理由 |
|------|----------|
| 按 `usedPercent ASC` 直接排序 | 羊群效应：所有新会话涌向最低用量账号，直到其超过次低者再集体迁移，用量曲线锯齿状爬升；粘性会话使"回头"极慢 |
| `score = w1·priority + w2·usedPercent` 加权 | 两个量纲无自然换算关系，权重系数变成不可解释的玄学旋钮 |
| **分档（选定）** | 档间引导流量流向低用量，档内保留 LRU 轮换避免羊群；全部账号落在同档时行为与现状完全一致（低压力零扰动） |

排序键：`(priority ASC, usageBand ASC, lastUsedAt ASC, createdAt ASC)`
`usageBand = usedPercent == null ? 0 : floor(usedPercent / OPENAI_USAGE_BAND_WIDTH)`

## D2. OpenAI 专属比较器，不动共享函数

`sortAccountsByPriority`（`commonHelper.js` L217）被 Claude/Gemini 调度器共用（代码注释明示"与 Claude/Gemini 调度保持一致"）。改动收敛在 `unifiedOpenAIScheduler` 内部新增 `_sortAccountsForOpenAI()`，仅替换本调度器内的两处排序调用。

## D3. 数据新鲜度：使用驱动更新，过期方向安全

`codexPrimaryUsedPercent` 仅在该账号跑过请求时刷新（`openaiRoutes.js` L411 从响应头抓取）。闲置账号数据过期，但：
- 周限窗口衰减极慢，闲置即不涨，**过期方向 = 低估 = 更愿意选它 = 选中后立刻刷新**，形成自愈回路
- 唯一盲区：账号在 relay 之外被直接使用，接受
- 缺数据（新账号、openai-responses 类型无 codex 字段）按 band 0 处理，不惩罚

## D4. 硬保护阈值与池空放行

`usedPercent ≥ OPENAI_USAGE_HARD_LIMIT`（默认 95）的账号从候选池剔除——周限撞墙后重置要等最长 7 天，提前 5% 拦截优于撞 429。

**池空放行（已拍板）**：剔除导致候选池为空时，放行全部被剔除账号并记 warn 日志。理由：对齐现有"撞 429 → `markAccountRateLimited(resets_in_seconds)`"的兜底路径，不引入新的 402 拒绝语义；榨干配额优于提前拒绝服务。

**粘性会话不受硬保护影响（本期明确不做）**：`_isAccountAvailable` 的粘性校验路径不加 usedPercent 判断。破除粘性 = Codex prompt cache 全灭（线上单请求 cache_read 12 万 token 级），代价大于收益。观察新会话自然分流一周后再评估。

## D5. 窗口标签动态推导

```
windowMinutes → 标签
    300       → '5h'
   10080      → '周限'
   < 1440     → 'Nh'（round(minutes/60) 小时）
   ≥ 1440     → 'Nd'（round(minutes/1440) 天）
   缺失但有 usedPercent → '限额'（通用兜底）
```

窗口块渲染条件：`usedPercent`、`resetAfterSeconds`、`windowMinutes` 至少一项为有效非零值，否则整块不渲染。当前线上数据（primary=10080、secondary 全 0）渲染结果 = 单条正确标注的"周限"进度条；若上游恢复双窗口（primary=300 + secondary=10080）则自动回到两条正确标注，零改动。

## D6. 配置开关与回滚

| 环境变量 | 默认 | 语义 |
|----------|------|------|
| `OPENAI_USAGE_BAND_WIDTH` | 30 | 档宽百分比，取值 1-100，设 100 → 全部落 band 0 → 等效关闭分档 |
| `OPENAI_USAGE_HARD_LIMIT` | 95 | 硬保护阈值，取值 1-100，设 100 → 不剔除任何账号 |

两项均设 100 时，排序退化为 `(priority, lastUsedAt, createdAt)`、候选池无剔除，与改动前行为**严格一致**——这是回归验证的基线，也是回滚手段（改 .env 重启即可，无需回代码）。
