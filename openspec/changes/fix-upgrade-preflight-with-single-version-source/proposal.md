## Why

管理台一键升级在 47.89.246.67 上**从未成功执行过一次**，且已进入永久不可用状态。2026-08-14 管理员 `YundunRelay` 连续触发三次（14:02:41、14:02:47、14:32:47），全部被同一道预检闸门以 409 拒绝：

```
❌ Upgrade failed (服务仍运行旧版本): 工作区存在未提交改动，已中止升级：
 M package-lock.json
```

### 根因：`npm install` 会重写 lock 的版本号，而这个改动永不消失

仓库内存在**三个版本号来源**，其中一个长期未同步：

| 文件 | 值 | 谁读它 |
|---|---|---|
| `package.json` | `1.2.10` | `upgradeService.getCurrentVersion()`，权威来源 |
| `VERSION` | `1.2.10` | `src/`、`scripts/` 中无任何代码读取（仅 release notes 过滤规则提及） |
| `package-lock.json` | **`1.0.0`** | 无 —— 自 blob `7fe3405` 起从未随发版同步 |

`npm install` 会把 lock 的 `version` 与 `packages[""].version` 强行对齐到 `package.json`。在 47.89.246.67 上隔离验证（复制两文件到 `/tmp` 单独执行 `npm install --package-lock-only`），差异**精确为两行**，与现场 `git diff` 完全一致：

```
-  "version": "1.0.0",          →  +  "version": "1.2.10",
-      "version": "1.0.0",      →  +      "version": "1.2.10",
```

而 `upgradeRunner.js:137` 的预检第 3 步要求 `git status --porcelain` 为空，于是链条闭合：

```
npm install → lock 被改写两行 → porcelain 非空 → 409 中止，一步不走
```

### 为什么它不会自愈

本仓库全部 tag 的 lock 都指向**同一个 blob** `7fe3405af1`（v1.2.2 → v1.3.0 逐一核对）。`git checkout` 只覆盖提交间存在差异的文件，内容一致的文件会把本地改动**原样带过去**。因此脏状态穿透切 tag、穿透升级、穿透重启，必须人工 `git checkout -- package-lock.json` 才能解除。

### 归因：手工部署的收尾动作锁死了自动升级

47.89.246.67 的 `reflog` 仅两条、`bash_history` 仅一条 npm 命令，证据链完整：

```
08-06 01:52  git clone                  lock = 1.0.0，干净
08-13 09:52  git pull --ff              package.json → 1.2.10  (mtime 09:52:49)
08-13 09:53  npm install --omit=dev     lock → 1.2.10          (mtime 09:53:01)  ← 人工，history 第 20 行
                                        ░░ 脏状态自此永久挂住 ░░
08-14 14:02  管理台一键升级 ✗ 409（三次）
```

`upgrade:last_run` 为空、reflog 无 checkout 记录，印证该机从未走过自动升级路径。这不是单机个例：任何用户在任何机器上手工执行一次 `npm install`，都会踩到同一个坑。

### 现行闸门把四类脏文件一视同仁

| 来源 | 例 | 应有处置 | 现状 |
|---|---|---|---|
| npm 再生噪音 | `package-lock.json` 仅 version 差异 | 放行 | ✗ 拒绝 |
| 运维紧急手改 | `M src/services/upgradeRunner.js` | 拒绝并要求人工介入 | ✓ 拒绝 |
| 未跟踪垃圾 | `nohup.out`、临时 json | 放行 | ✗ 拒绝 |
| 未跟踪构建产物 | `web/admin-spa/dist/` | 放行 | ✗ 拒绝 |

2026-08-11 在 43.110.32.63 上拦下的 `M src/services/upgradeRunner.js` 属第二类，闸门**判断正确**；本次拦下的 lock 属第一类，**判断错误**。问题的本质是：闸门只回答了「有没有改动」，而它真正需要回答的是「这个改动要不要人管」。

### 连带缺陷：预检失败在 Redis 中不留任何记录

`upgradeRunner.performUpgrade` 中 `state` 在 `preflight()` **之后**才赋值，而 `catch` 块以 `if (state)` 为前提写状态：

```js
const { current, target } = await preflight(targetTag)   // ← 抛错点
state = { ... }                                          // ← 永不执行
} catch (err) {
  if (state) { ... await saveState(state) }              // ← state undefined，整块跳过
}
```

四类预检失败（非法 tag / 远端无此版本 / 工作区脏 / 已是该版本）全都不写 Redis。管理台刷新后看到的仍是上一次记录，运维只能登服务器翻日志。这直接违背 `manual-upgrade-execution` spec 中「升级的计划、逐步状态与最终结果 SHALL 持久化至 Redis，MUST NOT 仅保存在进程内存中」。CLI 路径（`manage.js:281`）更彻底，用 `console.error` 输出，连日志文件都不落。

### 顺序依赖：单独修版本号会让问题变严重

若只做版本号对齐（提交一份对齐的 lock）而不做预检自愈：现存脏部署的 lock 在新旧 tag 之间将首次出现**内容差异**，`git checkout` 会因「local changes would be overwritten」硬失败，把当前干净的 409 变成一个更难诊断的 git 错误。因此自愈能力 MUST 与版本号治理同批次落地，且自愈逻辑先于 checkout 执行。

## What Changes

- **预检工作区判定改为语义判定（B-2）**：新增判据「lock 文件的改动是否仅为 version 字段对齐」。判定范围锚定 `package-lock.json` 与 `web/admin-spa/package-lock.json`；对这两个文件，读取 HEAD 版本与工作区版本并 `JSON.parse`，将两侧的 `.version` 与 `.packages[""].version` 归一化为同一占位值后深比较，**完全相等**才判为噪音；且工作区的 `version` MUST 等于 `package.json` 的 `version`（证明其为 npm 对齐产物而非人为乱改）。任何解析失败、任何其他字段差异、任何名单外路径 → **失败闭合**，判为阻断性改动。
- **噪音的处置动作 = `git stash push`（可逆）**：判为噪音的文件在 checkout 之前 `git stash push -m "<upgrade-preflight> <tag> <时间>" -- <paths>`，记录 stash ref 到升级状态与日志，**不自动 pop**（pop 会重新弄脏工作区）。选 stash 而非 `git checkout --` 的理由：判定逻辑万一有误，改动仍可从 `git stash list` 取回。
- **未跟踪文件不再参与预检判定**：`git status --porcelain` 改为 `--porcelain -uno`。除目标提交恰好要新建同名文件这一极低概率情形（由 `checkout` 自身报错暴露，并由既有原子回退兜住），未跟踪文件既不会导致 `checkout` 失败也不会丢失，现行闸门注释宣称的理由（"否则 checkout 会失败或丢改动"）对其不成立。
- **阻断时的报错给出可执行指引**：现文案只说「有改动」。改为列出逐文件判定结果（噪音 / 阻断）与建议命令，便于运维自决。
- **预检失败可观测**：`state` 的初始化提前到 `acquireLock` 之后、`preflight` 之前（`status: 'preflight'`），使全部四类预检失败均落 Redis；状态中新增 `preflightFindings`（脏文件清单 + 每项判定 + 处置结果 + stash ref）。
- **CLI 与 HTTP 共用同一预检实现**：`manage.js` 删除自己的 `git status --porcelain` 内联检查，改调 `upgradeRunner.preflight()`，消除两份判定逻辑漂移。
- **版本号单一权威来源 + 发版脚本（A）**：确立 `package.json.version` 为唯一权威；`VERSION` 与 `package-lock.json` 的版本字段由发版脚本派生。新增 `scripts/bump-version.js`（`npm run version:bump -- <semver>`）：内部走 `npm version <x> --no-git-tag-version` 同步 package.json + lock，再写 `VERSION`，最后校验三处一致。一次性提交一份版本对齐的 `package-lock.json`，消除脏源。
- **不在本变更内改用 `npm ci`**：见 design.md D9（活进程下删空 `node_modules` 的风险需单独设计）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `manual-upgrade-execution`：修改「构建失败不得影响在运行的服务」中的工作区不干净场景，新增预检语义判定与自愈能力；修改「升级进度跨进程重启可查」以覆盖预检阶段失败。
- `release-version-awareness`：新增版本号单一权威来源与发版同步要求。

## Impact

**代码**：
- `src/services/upgradeRunner.js` — 预检语义判定与 stash 自愈、`state` 初始化提前、`preflightFindings`、报错文案
- `src/services/upgradeService.js` — 新增 lock 语义比对 helper（供预检调用）
- `scripts/manage.js` — 删除内联 porcelain 检查，复用 `upgradeRunner.preflight()`
- `scripts/bump-version.js` — 新增；`package.json` 增加 `version:bump` script
- `package-lock.json` — 一次性版本对齐提交（内容仅 version 两处，依赖树不动）
- `VERSION` — 纳入发版脚本管理

**数据**：无 schema 变更。Redis `upgrade:last_run` 结构新增可选字段 `preflightFindings`，旧记录缺该字段不影响读取。

**行为变化**：
- `npm install` 造成的 lock 噪音不再阻断升级，改为 stash 后继续，并在状态与日志中留痕。
- 未跟踪文件不再阻断升级。
- 运维对已跟踪文件（如 `src/**`）的手改**仍然阻断**，行为不变。
- lock 出现真实依赖变更时**阻断**（语义判定失败闭合），不会被误丢。
- 四类预检失败均可在管理台查询到，不必登服务器翻日志。

**部署顺序约束**：47.89.246.67 当前运行 v1.2.10 旧代码，自愈能力只在升级完成后才生效，存在鸡生蛋问题 —— 该机 MUST 先人工执行一次 `git checkout -- package-lock.json` 解封（已验证：v1.2.10→v1.3.0 依赖零变更、前端零变更，`npmInstall` 与 `buildWeb` 均被裁剪，升级路径仅 checkout + restart）。此后自愈能力接管。

**验证**：详见 tasks.md 第 5 组（含噪音自愈、手改仍拦、真实依赖变更仍拦、未跟踪不阻断、预检失败可查五项实测）。

**回滚**：`git revert` 本变更提交 + `systemctl restart relay-service`。已 stash 的改动不受回滚影响，仍可 `git stash list` 取回。版本对齐的 lock 若需回退，`git revert` 即恢复 `1.0.0`，但届时脏源与自锁将同时回归。
