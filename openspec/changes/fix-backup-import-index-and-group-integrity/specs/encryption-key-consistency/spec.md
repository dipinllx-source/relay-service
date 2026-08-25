## ADDED Requirements

### Requirement: 启动时必须主动核对 ENCRYPTION_KEY 与库中已有密文的一致性

服务启动时 SHALL 抽样试解本机已有账户的密文字段，用以判定当前 `ENCRYPTION_KEY` 是否与库中密文所绑定的密钥一致；判定为不一致时 SHALL 记录 error 级日志并列出受影响的平台。

备份文件中的凭据是密文，且与导出机的 `ENCRYPTION_KEY` 硬绑定。跨机迁移的前置条件是「目标机沿用源机的该值」。该前置条件靠运维纪律保障，本要求的作用是让违反它的后果**不能安静地存在**：今天密钥错配的唯一表征是上游请求 401，而后台只显示「账号异常」，全链路没有一处指向密钥。

判定 MUST NOT 依赖解密函数抛出异常。`commonHelper.js` 的 `decrypt` 在失败时 `return text`（返回密文原文），`claudeAccountService` 的解密路径在失败时返回 `encryptedData`，二者都不抛错。因此判定 SHALL 基于**明文合理性**：聚合型 JSON 字段（如 `claudeAiOauth` / `openaiOauth` / `geminiOauth`）解出后必须能被 `JSON.parse` 接受，单值字段必须由可打印字符构成或匹配已知前缀。

自检 MUST NOT 阻断启动。一次配置失手不应升级为服务不可用 —— 库里可能只有一部分账户属于错配密钥，阻断会把局部故障放大成全局故障。

#### Scenario: 密钥与已有密文不一致

- **WHEN** 服务启动且库中已有账户密文，而当前 `ENCRYPTION_KEY` 无法解开抽样字段
- **THEN** 系统 SHALL 记录一条 error 级日志，明确指出当前 `ENCRYPTION_KEY` 与库中已有密文不匹配
- **AND** 日志 SHALL 列出受影响的平台与各平台的抽样失败数
- **AND** 服务 SHALL 继续正常启动，MUST NOT 因自检失败退出或拒绝服务

#### Scenario: 密钥一致

- **WHEN** 抽样字段全部能被当前 `ENCRYPTION_KEY` 解出合理明文
- **THEN** 系统 SHALL 以 info 级记录自检通过与抽样条数
- **AND** MUST NOT 产生任何 error 或 warn 级噪音

#### Scenario: 库中没有可供抽样的密文

- **WHEN** 实例为全新部署，或所有账户的密文字段均为空
- **THEN** 自检 SHALL 判定为「无法判定」并以 info 级记录跳过原因
- **AND** MUST NOT 报告为不一致（无密文可解不等于密钥错误，这是新装机器的正常状态）

#### Scenario: 遇到与密钥无关的不可解密形态

- **WHEN** 抽样命中的字段是 legacy `createDecipher` 形态（裸 hex、无 `iv:` 前缀），该形态在当前 Node 版本上无论密钥正确与否都解不开
- **THEN** 该字段 SHALL 被排除在一致性判定之外，另行以 warn 级单独报告
- **AND** MUST NOT 被计入密钥不一致的证据

#### Scenario: 判定不因单次抽样失败而下结论

- **WHEN** 某个平台的抽样字段解密失败
- **THEN** 系统 SHALL 对该平台追加抽样后再下结论，MUST NOT 仅凭单一字段判定整机密钥错配
- **AND** 判定逻辑 SHALL 优先选取聚合型 JSON 字段作为探针，因为 AES-256-CBC 无 MAC，错误密钥仍有约 1/256 的概率通过 padding 校验而产出乱码明文

### Requirement: 密钥自检的输出必须可定位且不得泄露密钥或密文

自检的日志与任何对外输出 MUST NOT 包含 `ENCRYPTION_KEY` 的明文、密文字段的原值或解密所得的明文；同时 SHALL 输出足以定位问题的信息：平台、账户标识、字段路径与判定结论。

密钥指纹若用于展示，MUST NOT 直接取 `sha256(ENCRYPTION_KEY)` —— 该摘要正是 bedrock 账户服务使用的 AES-256 密钥（`bedrockAccountService.js:668` 的 `_encryptionKeyCache`），把它写进日志等于把一把可用密钥写进日志。

| 允许输出 | 禁止输出 |
|---|---|
| 平台名、账户 id / name、字段路径 | 字段的密文原值 |
| 判定结论与各平台抽样失败数 | 解密所得的明文（含部分片段） |
| 经 scrypt 派生并截断的密钥指纹 | `ENCRYPTION_KEY` 明文、`sha256(ENCRYPTION_KEY)` |

#### Scenario: 报告不一致时的输出内容

- **WHEN** 自检判定密钥不一致并写日志
- **THEN** 日志 SHALL 包含受影响平台、抽样账户标识与字段路径
- **AND** 日志 MUST NOT 包含密钥明文、密文原值或解密所得明文

#### Scenario: 展示密钥指纹

- **WHEN** 自检需要在日志中标识当前所用密钥
- **THEN** 指纹 SHALL 由 `ENCRYPTION_KEY` 经 scrypt 派生后截断得到
- **AND** MUST NOT 使用 `sha256(ENCRYPTION_KEY)`，因为该值本身即 bedrock 账户的 AES 密钥
