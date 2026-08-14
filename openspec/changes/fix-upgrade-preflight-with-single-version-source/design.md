## Context

一键升级的预检闸门（`upgradeRunner.js` 第 3 步）要求 `git status --porcelain` 完全为空。它想防的是「切 tag 时改动被覆盖或丢失」，但它实际实现的是「工作区有任何字节变化就拒绝」。这两件事之间的落差，正好被 npm 的一个副作用踩中：

```
                            ┌──────────────────────────────────────┐
  package.json  1.2.10 ─────┤ npm install 把 lock 的 version 对齐   │
  VERSION       1.2.10      │ 到 package.json（两行）               │
  package-lock  1.0.0  ◀────┘                                      │
        │                                                          │
        │ git status --porcelain → " M package-lock.json"           │
        ▼                                                          │
  preflight 第 3 步 ──▶ 409「工作区存在未提交改动，已中止升级」 ──────┘
        │
        └─▶ state 尚未赋值 → catch 里 if (state) 整块跳过 → Redis 无记录
```

现场事实（47.89.246.67，v1.2.10，只读取证）：

- 三个版本号来源中 `package-lock.json` 长期停在 `1.0.0`；`VERSION` 虽同步但 `src/`、`scripts/` 中无任何代码读它，权威来源是 `package.json`（`upgradeService.getCurrentVersion()`）。
- 全部 tag（v1.2.2 → v1.3.0）的 lock 指向同一 blob `7fe3405af1`。`git checkout` 只覆盖提交间有差异的文件，所以这份脏改动穿透切 tag、穿透重启，不会自愈。
- 触发者是人：`bash_history` 第 20 行 `npm install --omit=dev`（08-13 09:53），紧跟在 `git pull --ff` 之后。`upgrade:last_run` 为空，reflog 无 checkout 记录 —— 该机从未走过一次自动升级。
- 隔离验证：把两个文件复制到 `/tmp` 单独跑 `npm install --package-lock-only`，产出的 diff 精确等于现场的两行。

依赖事实（决定了本变更的风险面）：

- `upgradeService.depsChanged()` 比较的是 tag 间 `dependencies` / `devDependencies` / `optionalDependencies` 的**内容**（2026-08-12 变更的 D5）。v1.2.2 → v1.3.0 依赖零变更，因此 `npmInstall` 步骤在现实升级中几乎总被裁剪 —— 这既解释了为什么流水线自己不会制造这份噪音，也决定了 `npm ci` 改造的收益很低。
- `manage.js` 的 CLI 升级路径复制了一份自己的 porcelain 检查，只 `console.error`，不落日志文件也不落 Redis。

编号约定：本文件的 `D1`–`Dn` 只在本变更内有效。`src/services/upgradeRunner.js` 头部注释中的 `D6`（`process.exit(0)` + systemd 拉起）指的是归档变更 `2026-08-12-add-release-notify-with-manual-upgrade` 的 design.md。本变更新增或修改代码注释时，凡引用决策 MUST 写成 `D2（fix-upgrade-preflight-with-single-version-source）` 这种带变更名的形式，避免与既有 `D6` 混淆。

## Goals / Non-Goals

Goals：

- 让 `npm install` 产生的 lock 版本号噪音不再阻断升级，且处置过程可追溯、可取回。
- 保持对真实人工改动（`src/**`、真实依赖变更）的阻断能力不下降 —— 判定错误的代价是「自动升级悄悄改了你的工作区」，必须失败闭合。
- 消灭噪音的产生源：确立单一权威版本号来源，`VERSION` 与 lock 的版本字段由发版脚本派生。
- 四类预检失败全部在 Redis 可查，运维不必登服务器翻日志。
- CLI 与 HTTP 两条升级路径共用同一份预检判定。

Non-Goals：

- 不把安装步骤改成 `npm ci`（见本文件 D9）。
- 不引入 `.gitattributes` merge driver 或 lock 文件的自定义 diff 驱动 —— 那解决的是合并冲突，不是本地脏状态。
- 不放宽对 `src/**`、`web/**` 源码改动的阻断，也不提供「强制升级」开关（人工改动就该人工确认，加开关等于把闸门废掉）。
- 不改动升级的重启机制、步骤裁剪逻辑与回滚策略（沿用 `add-release-notify-with-manual-upgrade` 的 D5 / D6 / D9）。
- 不做跨机器的部署状态巡检（哪些机器当前处于脏状态），留待后续。

## Decisions

### D1：判定边界 = 语义判定 + 路径白名单 + 失败闭合

预检不再问「有没有改动」，改为逐文件问「这个改动要不要人管」。判定只对白名单路径开放：

```
package-lock.json
web/admin-spa/package-lock.json
```

对白名单内的文件：取 HEAD 版本与工作区版本，两侧 `JSON.parse`，把 `.version` 与 `.packages[""].version` 归一化为同一占位值后深比较，**完全相等**才判为噪音（noise）。白名单外的任何脏路径，一律判为阻断（blocking）。

以下任一情形直接判 blocking，不做补救尝试：解析失败、缺少被归一化的字段、归一化后仍存在其他字段差异、文件在 HEAD 中不存在。

考虑过并否决的替代方案：

| 方案 | 做法 | 否决理由 |
|---|---|---|
| A-1 路径白名单 | 只要脏文件名是 `package-lock.json` 就放行 | 真实依赖变更（有人手工加了个包）会被静默丢掉，代价不可接受 |
| B-1 行级 diff 匹配 | 用正则匹配 `-  "version": ...` / `+  "version": ...` 且 diff 只有这两组 | 依赖 diff 文本格式与上下文行数，npm 换 lockfileVersion 或字段顺序即失效；且无法表达「只有 version 变了」这个语义 |
| C 关闭闸门 | 直接删掉第 3 步 | 2026-08-11 在 43.110.32.63 上拦下的 `M src/services/upgradeRunner.js` 正是闸门该拦的，删掉等于把这类事故放行 |

选 B-2 的核心理由：判据落在**数据结构语义**而非文本表现上，npm 改格式不影响正确性；且它能精确表达「依赖树没变，只有版本号被对齐」这一唯一可安全放行的情形。

### D2：噪音判定的第二个必要条件 —— 版本号必须指向 `package.json`

仅「只有 version 字段不同」还不够。有人可能手工把 lock 的 version 改成任意值。因此追加必要条件：工作区侧 lock 的 `version` MUST 严格等于 `package.json` 的 `version`（同一次读取，不走 require 缓存）。

这条件把「npm 对齐产物」与「人为乱改」区分开：前者必然等于 `package.json`，后者不必然。两个条件同时满足才判 noise。

### D3：处置动作 = `git stash push`，不自动 pop

判为 noise 的文件在 `checkout` **之前**处置：

```
git stash push -m "<upgrade-preflight> <targetTag> <ISO 时间>" -- <noise paths…>
```

stash ref 写入升级状态与日志。**不自动 pop**：pop 会把工作区重新弄脏，下一次升级又被拦；而升级完成后新 tag 的 lock 已是对齐版本，这份改动本就没有恢复价值。

选 stash 而非 `git checkout -- <paths>` 的理由是可逆性 —— 判定逻辑万一有误，改动仍可从 `git stash list` 取回；`git checkout --` 是不可逆的丢弃。代价是 stash 会缓慢堆积，用 message 前缀 `<upgrade-preflight>` 使其可识别、可批量清理（清理动作留给运维，不自动做）。

处置 MUST 在 checkout 之前完成，且 MUST 记录到状态里。「自动升级悄悄改了工作区且不留痕」是本决策最需要避免的失败模式。

### D4：未跟踪文件不再参与预检判定

`git status --porcelain` → `git status --porcelain -uno`。

原注释宣称的理由是「否则 checkout 会失败或丢改动」，这对未跟踪文件不成立：`git checkout` 既不会因未跟踪文件失败（除非目标提交要新建同名文件，那属于 blocking 的合理范畴，会以 git 自身报错暴露），也不会删除它们。现网会出现的未跟踪文件是 `nohup.out`、临时 json、`web/admin-spa/dist/` 之类，拿它们拦升级纯属误伤。

### D5：`state` 初始化提前，预检失败也落 Redis

把 `state` 的初始化从 `preflight()` 之后挪到 `acquireLock()` 之后、`preflight()` 之前，初始 `status: 'preflight'`。这样 `catch` 块里的 `if (state)` 恒成立，四类预检失败（非法 tag / 远端无此版本 / 工作区脏 / 已是该版本）全部写入 `upgrade:last_run`。

状态新增可选字段 `preflightFindings`：脏文件清单、每项判定（noise / blocking）、判 blocking 的原因、处置结果与 stash ref。它同时服务两个目的：管理台能直接告诉运维「哪个文件、为什么被拦」；自愈发生时留下审计痕迹。

这不是新增能力，而是补上既有 spec 的窟窿 —— `manual-upgrade-execution` 已经要求「升级的计划、逐步状态与最终结果 SHALL 持久化至 Redis，MUST NOT 仅保存在进程内存中」。

### D6：CLI 复用 `upgradeRunner.preflight()`

`manage.js` 删除自己的 `execSync('git status --porcelain')` 内联检查，改调 `upgradeRunner.preflight()`。

两份判定逻辑必然漂移，本次就是证据：HTTP 路径的报错进了日志与（本应进）Redis，CLI 路径只 `console.error`，事后无痕。合并后 CLI 也自动获得语义判定、自愈与状态持久化。

保留两条路径在重启机制上的差异（CLI 走 `systemctl restart`，HTTP 走 `process.exit(0)`）—— 那是 2026-08-12 变更 D11 划定的职责边界，与预检无关。

### D7：版本号单一权威来源 = `package.json.version`

确立三者关系：`package.json.version` 是唯一权威；`VERSION` 与 `package-lock.json` 的版本字段是它的**派生物**，由发版脚本同步，不允许手工单独编辑。

新增 `scripts/bump-version.js`，暴露为 `npm run version:bump -- <semver>`：

1. `npm version <semver> --no-git-tag-version` —— 同时改 `package.json` 与 lock 的两处 version（借 npm 自己的行为，不手写 JSON 序列化，避免格式漂移）；
2. 写 `VERSION`；
3. 回读三处并校验一致，不一致则非零退出。

不删 `VERSION` 文件：release notes 的过滤规则（`release-version-awareness` spec 中 `L3 级升级提示内容`）明确提到 `chore:` 且只动 `package.json` / `VERSION` 的提交要被过滤掉，删文件会破坏这条已生效的约定，收益也不对等。

### D8：一次性提交版本对齐的 lock，且必须与自愈同批次落地

本变更包含一次 `package-lock.json` 的版本对齐提交（内容仅两处 version，依赖树不动），从源头消灭噪音。

关键约束：**这个提交 MUST NOT 单独发布**。若只对齐版本号而不带自愈能力，现存脏部署的 lock 在新旧 tag 之间将首次出现内容差异，`git checkout` 会以「local changes would be overwritten by checkout」硬失败 —— 把现在这个语义清晰的 409 换成一个更难诊断的 git 错误。顺序上，自愈逻辑也 MUST 在 checkout 之前执行。

D7 + D8 落地后，稳态下 `npm install` 不再产生任何 lock 差异，D1–D3 的自愈能力退化为安全网：覆盖老部署、覆盖发版脚本被绕过的情况、覆盖 npm 未来引入新的版本派生字段。这是有意为之 —— 治源与兜底都要，只治源就没有对存量部署的解封路径。

### D9：本变更不改用 `npm ci`

`npm ci` 是「lock 漂移」的教科书解法：它不重写 lock，也容忍 lock 的 version 与 `package.json` 不一致（现场 `npm ci --dry-run` 退出码 0 已验证）。但它在本场景不可直接采用：

- `npm ci` 会先删空 `node_modules`（现场约 177M）。升级是在**活进程内**执行的 —— 进程还在处理转发请求，代码中又有十余处 `global-require` 式的惰性 `require`，安装窗口内命中任一处就会因模块解析失败而抛错。
- 一旦进程在安装中途崩溃，systemd `Restart=always` 会把它拉起到一棵半装好的依赖树上，形成崩溃循环 —— 比现在这个「拒绝升级但服务照常」的失败模式严重得多。
- 收益本就很低：`depsChanged` 判据下依赖极少变更，`npmInstall` 步骤在现实升级中几乎总被裁剪，`npm ci` 大多数时候根本不会执行。

要做也得配套设计（安装到影子目录后原子切换，或安装期间摘流量），量级足够单独一个变更。因此本变更保持 `npm install --no-audit --no-fund` 不动，D7 + D8 从源头解决了 lock 漂移，`npm ci` 的必要性随之下降。

### D10：阻断时给可执行指引，但不猜测运维意图

现文案只说「工作区存在未提交改动」，运维得自己去 diff。改为输出逐文件判定结果与建议命令，例如被拦的是 `src/services/upgradeRunner.js` 时提示先 `git diff` 确认、再自行决定 commit 或 stash。

不做的是：不自动 stash 阻断类改动、不提供「忽略并继续」的一键按钮。一旦允许绕过，闸门就形同不存在，而它拦对过（2026-08-11）。指引的作用是让人更快做决定，不是替人做决定。

## Risks / Trade-offs

- **语义判定误判为 noise** —— 后果是改动被 stash。缓解：D1 的失败闭合（任何异常一律 blocking）+ D2 的版本号锚定 + D3 选 stash 而非丢弃，三层叠加；且判定与处置全部落 `preflightFindings`，事后可复盘。
- **语义判定误判为 blocking** —— 后果是升级被拦，等于回到现状，不产生新伤害。这是刻意选择的偏向。
- **stash 堆积** —— 每次自愈留一条 stash。用 message 前缀使其可识别；不自动清理（自动删 stash 与「可取回」的设计初衷冲突）。若堆积成为实际困扰，再单独做保留策略。
- **`-uno` 放行未跟踪文件后，目标 tag 新增同名文件会导致 checkout 报错** —— 概率极低（要恰好同名），且 git 自身报错清晰，会被现有的原子回退兜住（`git checkout --detach originRef`）。
- **`preflightFindings` 让 `upgrade:last_run` 体积增长** —— 只存脏文件清单与判定结论，不存 diff 内容，量级可忽略。
- **CLI 与 HTTP 合并预检后，CLI 也会产生 stash** —— 属预期行为，CLI 输出需同样打印 stash ref。
- **发版脚本被绕过**（有人手工改 `package.json` 后直接打 tag）—— 噪音会重新出现，但此时 D1–D3 的兜底接管，不会再锁死升级。这正是保留兜底的理由。

## Migration Plan

存量脏部署存在鸡生蛋问题：自愈能力只在升级完成后才生效，而升级正被它自己要修的缺陷拦住。顺序如下：

1. **解封存量机器**（人工，一次性）。47.89.246.67 执行 `cd /opt/relay-service && git checkout -- package-lock.json`。安全性已验证：工作区 lock 与 HEAD 仅差两行 version、依赖树完全相同；v1.2.10 → v1.3.0 依赖零变更、前端零变更，`npmInstall` 与 `buildWeb` 均被裁剪，升级路径只剩 checkout + restart。
2. **发布带本变更的新 tag**（D7 的脚本、D8 的对齐 lock、D1–D6 的预检改造同批次）。
3. 存量机器一键升级到该 tag。升级完成后自愈能力生效，此后手工 `npm install` 不再锁死升级。
4. 后续发版全部走 `npm run version:bump -- <semver>`，三处版本号一致由脚本保证。

排查现存机器是否处于同一状态：`cd /opt/relay-service && git status --porcelain -uno` 若输出 ` M package-lock.json`，即为同一问题（用 `-uno` 排除 `nohup.out`、`dist/` 之类未跟踪文件造成的假阳性）；`redis-cli GET upgrade:last_run` 为空则说明该机从未成功执行过一键升级。

## Open Questions

- 是否需要一个只读的「部署健康」端点，把工作区脏状态、三处版本号一致性、`upgrade:last_run` 结果聚合成一次调用？本变更不含，但存量排查明显需要它。
- `<upgrade-preflight>` stash 的保留策略（数量上限 / 保留天数）是否值得做？先观察实际堆积速度。
- `npm ci` 的影子目录方案（安装到 `node_modules.next` 后原子 rename）是否值得单独立项？取决于依赖变更的实际频率 —— 目前看极低。
- `VERSION` 文件既然无代码读取，长期是否该收敛掉？涉及 release notes 过滤规则，需与 `release-version-awareness` 一并评估。
