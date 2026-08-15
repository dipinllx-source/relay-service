## 1. lock 语义比对 helper

- [x] 1.1 `src/services/upgradeService.js` 新增常量 `LOCK_NOISE_PATHS = ['package-lock.json', 'web/admin-spa/package-lock.json']`（D1 白名单，唯一定义处，预检不得另行硬编码路径）
- [x] 1.2 新增 `readFileAtRef(ref, relPath)`：`git show <ref>:<relPath>` 读取指定 ref 的文件内容，文件不存在时返回 `null`（不抛错，由调用方判 blocking）
- [x] 1.3 新增 `isLockVersionOnlyChange(relPath, { headRef = 'HEAD' })`，返回 `{ noise: boolean, reason: string }`：
  - 路径不在 `LOCK_NOISE_PATHS` → `{ noise: false, reason: 'path-not-whitelisted' }`
  - HEAD 侧或工作区侧读取/`JSON.parse` 失败 → `{ noise: false, reason: 'parse-failed' }`
  - 任一侧缺 `.version` 或 `.packages[""]` → `{ noise: false, reason: 'missing-version-field' }`
  - 两侧 `.version` 与 `.packages[""].version` 归一化为同一占位值后深比较不相等 → `{ noise: false, reason: 'other-fields-differ' }`
  - 工作区侧 `.version !== package.json` 的 `version`（复用 `getCurrentVersion()`，须绕开 require 缓存）→ `{ noise: false, reason: 'version-mismatch-package-json' }`（D2）
  - 以上全部通过 → `{ noise: true, reason: 'lock-version-alignment' }`
- [x] 1.4 深比较用不依赖键序的实现（`JSON.stringify` 不可靠）；归一化 MUST 在深拷贝上做，不得原地改动已解析对象
- [x] 1.5 `isLockVersionOnlyChange` 内部任何未预期异常一律捕获并返回 `{ noise: false, reason: 'unexpected-error: <msg>' }`（D1 失败闭合），不向上抛

## 2. 预检判定与自愈

- [x] 2.1 `src/services/upgradeRunner.js` 预检第 3 步的 `git status --porcelain` 改为 `git status --porcelain -uno`（D4），同步更新那条已失真的注释（"否则 checkout 会失败或丢改动" 对未跟踪文件不成立）
- [x] 2.2 解析 porcelain 输出为 `{ xy, path }` 列表；正确处理重命名条目（`R  old -> new`）与带引号路径（`core.quotepath`），任何无法可靠解析的行判 blocking
- [x] 2.3 逐条调用 `isLockVersionOnlyChange` 分流成 `noise[]` 与 `blocking[]`
- [x] 2.4 `blocking` 非空 → 抛 409，`message` 按 D10 列出逐文件判定结果与 `reason`，并附建议命令（`git diff -- <path>` 确认后自行 commit 或 stash）；MUST NOT 提供绕过开关
- [x] 2.5 `blocking` 为空且 `noise` 非空 → 在 `checkout` **之前**执行 `git stash push -m "<upgrade-preflight> <targetTag> <ISO 时间>" -- <noise paths…>`（D3）
- [x] 2.6 stash 后回读 `git stash list --format=%H -1` 取 stash ref 与 `git rev-parse -q --verify refs/stash`，写入返回结果；stash 命令失败 → 抛 409（MUST NOT 带着脏工作区继续 checkout）
- [x] 2.7 `logger.info` 记录自愈：文件清单、stash ref、目标 tag；MUST NOT 静默处置
- [x] 2.8 **不自动 pop**（D3）：确认全流程无 `git stash pop` / `git stash apply`，包括失败分支的原子回退路径
- [x] 2.9 `preflight()` 返回值扩展为携带 `findings`（`[{ path, xy, verdict: 'noise'|'blocking', reason }]`）与 `stashRef`，供 2.4 报错与第 3 组状态写入复用

## 3. 预检可观测性与报错文案

- [x] 3.1 `performUpgrade` 中 `state` 的初始化从 `preflight()` 之后移到 `acquireLock()` 之后、`preflight()` 之前，初始 `status: 'preflight'`、`startedAt` 就位、`targetTag` 就位、`steps` 暂为空（D5）
- [x] 3.2 `preflight()` 成功后再补齐 `current` / `target` / `steps` / `status: 'running'` 并 `saveState`（保持原有 running 语义不变）
- [x] 3.3 `state` 增加可选字段 `preflightFindings`（取 2.9 的 `findings` + `stashRef`）；成功与失败路径都写
- [x] 3.4 `catch` 块中的 `if (state)` 现已恒成立；确认四类预检失败（非法 tag / 远端无此版本 / 工作区脏 / 已是该版本）都会写 `status: 'failed'` + `error` 到 `upgrade:last_run`
- [x] 3.5 确认 `acquireLock` 本身失败（并发升级）时的行为未被本次改动破坏 —— 该分支 MUST NOT 覆写上一次的 `upgrade:last_run`
- [x] 3.6 `web/admin-spa` 升级状态视图展示 `preflightFindings`：逐文件 path + verdict + reason，noise 项附 stash ref；`cd web/admin-spa && npx eslint --fix && npx vite build`
- [x] 3.7 旧记录（无 `preflightFindings` 字段）在前端与后端读取路径均不报错（向后兼容）

## 4. CLI 路径统一与版本号治理

- [x] 4.1 `scripts/manage.js` 删除内联的 `execSync('git status --porcelain')` 检查块，改调 `upgradeRunner.preflight()`（D6）
- [x] 4.2 CLI 输出对齐 HTTP 语义：blocking 时打印同一份逐文件判定文案；noise 自愈时打印 stash ref
- [x] 4.3 确认 CLI 仍走 `this.restart(true)`（systemctl）而非 `process.exit(0)`，职责边界不变（沿用 `add-release-notify-with-manual-upgrade` 的 D11）
- [x] 4.4 新增 `scripts/bump-version.js`（D7）：`npm version <semver> --no-git-tag-version` 同步 `package.json` + lock 两处 version → 写 `VERSION` → 回读三处校验一致，不一致非零退出
- [x] 4.5 `scripts/bump-version.js` 校验入参为合法 semver（复用 `upgradeService` 中 `TAG_RE` 的语义，允许 prerelease），非法则拒绝执行且不落任何写入
- [x] 4.6 `package.json` 增加 `"version:bump": "node scripts/bump-version.js"`
- [x] 4.7 一次性提交版本对齐的 `package-lock.json`（`version` 与 `packages[""].version` → 当前 `package.json` 版本）；`git diff --stat` MUST 只显示这两行，依赖树零变更（D8）
- [x] 4.8 `CLAUDE.md` 补两条：发版必须走 `npm run version:bump`，禁止手工单独编辑 `VERSION` 或 lock 的 version 字段；`package.json.version` 为唯一权威来源
- [x] 4.9 4.7 的对齐提交 MUST NOT 单独发布 —— 与第 1~3 组同批次进同一个 tag（D8 的顺序约束，在 PR 描述中写明）

## 5. 验证

- [x] 5.1 `npm run lint` 与 `npm run format` 全通过（仅检查本变更触及的文件）
- [x] 5.2 `npm test` 全绿；新增 `isLockVersionOnlyChange` 单测覆盖 6 个返回分支（白名单外 / 解析失败 / 缺字段 / 其他字段差异 / version 与 package.json 不符 / 判 noise）
- [x] 5.3 **噪音自愈**：干净工作区上执行 `npm install` 造出 ` M package-lock.json`，触发升级 → 预检放行并 stash，升级走完；`git stash list` 存在 `<upgrade-preflight>` 条目，`upgrade:last_run.preflightFindings` 记录该文件为 noise
- [x] 5.4 **手改仍拦**：手工改一行 `src/services/upgradeRunner.js`，触发升级 → 409 阻断，报错文案列出该文件与 `reason: path-not-whitelisted`，工作区改动**未被** stash（逐字比对改动仍在）
- [x] 5.5 **真实依赖变更仍拦**：手工在 lock 中增删一个依赖条目（保持 version 字段与 `package.json` 一致），触发升级 → 409 阻断，`reason: other-fields-differ`，改动未被丢弃；再单独构造「lock 的 version 改成任意值」→ `reason: version-mismatch-package-json`（D2 覆盖）
- [x] 5.6 **未跟踪不阻断**：`touch nohup.out` 与 `mkdir -p web/admin-spa/dist && touch web/admin-spa/dist/x.js`，触发升级 → 正常执行，两个文件升级后仍在原处（D4）
- [x] 5.7 **预检失败可查**：分别构造非法 tag、远端不存在的 tag、工作区脏、已是目标版本四种情形，每次触发后 `redis-cli GET upgrade:last_run` 均为本次记录（`status: 'failed'` + 对应 `error`），且管理台刷新后显示的是本次而非上一次
- [x] 5.8 **CLI 等价性**：同样用 5.3 与 5.4 两个场景走 `node scripts/manage.js` 升级路径，判定结论与文案与 HTTP 路径一致
- [x] 5.9 **发版脚本**：`npm run version:bump -- <下一个版本>` 后 `package.json` / `VERSION` / lock 三处一致；再执行一次 `npm install`，`git status --porcelain -uno` 为空（证明噪音源已消除，D7 + D8 生效）
- [x] 5.10 **回退演练**：在测试机上 `git revert` 本变更提交后重启，确认服务正常启动，已 stash 的改动仍可 `git stash list` 取回

## 6. 上线与归档

- [x] 6.1 解封存量机器（人工、一次性）：47.89.246.67 执行 `cd /opt/relay-service && git checkout -- package-lock.json`，`git status --porcelain -uno` 应为空
- [ ] 6.2 发布携带本变更的新 tag；推 tag 用全限定引用 `git push origin refs/tags/vX.Y.Z`
- [ ] 6.3 存量机器经管理台一键升级到该 tag；`upgrade:last_run.status === 'success'`，`/health` 200，`getCurrentVersion()` 为新版本
- [ ] 6.4 升级后在该机复跑 5.3（`npm install` → 触发升级），确认自愈已接管，不再需要人工介入
- [ ] 6.5 巡检其余部署机器：`git status --porcelain -uno` 出现 ` M package-lock.json` 即为同一问题，按 6.1 → 6.3 处置
- [ ] 6.6 PR merge 后运行 `openspec archive fix-upgrade-preflight-with-single-version-source`
