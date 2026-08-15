/**
 * ⬆️ Upgrade Service — 版本感知 / 变更分析 / 升级编排
 *
 * OpenSpec: add-release-notify-with-manual-upgrade
 *   - release-version-awareness   (tasks 2.1-2.4)
 *   - manual-upgrade-execution    (tasks 3.1-3.4, 4.x)
 *
 * 设计要点（见 design.md）：
 *   D1 感知源 = git ls-remote --tags origin（零凭据，不用 GitHub API）
 *   D2 tag 为发布契约；一律使用全限定 refs/tags/*（分支与 tag 同名会产生歧义）
 *   D3 完整 semver 比较，含 prerelease 优先级；prerelease 默认不提示
 *   D4 release notes 取 git log <prev>..<new>（tag 是轻量 tag，无 annotation）
 *   D5 步骤裁剪依据依赖"内容"diff，而非 package.json 文件 diff
 */

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const logger = require('../utils/logger')

const ROOT_DIR = path.join(__dirname, '..', '..')

// tag 名白名单：vMAJOR.MINOR.PATCH[-prerelease]
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

const GIT_TIMEOUT_MS = parseInt(process.env.UPGRADE_GIT_TIMEOUT_MS || '20000', 10)

/**
 * 执行 git 命令。使用 execFile + 参数数组（不经 shell），避免注入。
 */
function git(args, timeoutMs = GIT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: ROOT_DIR, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(
            `git ${args.join(' ')} failed: ${(stderr || err.message || '').toString().trim()}`
          )
          e.stderr = (stderr || '').toString()
          return reject(e)
        }
        resolve((stdout || '').toString())
      }
    )
  })
}

// ── semver ────────────────────────────────────────────────────────

/** 解析版本字符串（可带 v 前缀）。非法返回 null。 */
function parseSemver(input) {
  if (typeof input !== 'string') {
    return null
  }
  const s = input.trim()
  const m = TAG_RE.exec(s.startsWith('v') ? s : `v${s}`)
  if (!m) {
    return null
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
    raw: s.replace(/^v/, '')
  }
}

/** 比较 prerelease 标识符序列（semver 规则）。 */
function comparePrerelease(a, b) {
  // 无 prerelease > 有 prerelease（1.2.4 > 1.2.4-rc.1）
  if (a.length === 0 && b.length === 0) {
    return 0
  }
  if (a.length === 0) {
    return 1
  }
  if (b.length === 0) {
    return -1
  }
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) {
      return -1
    }
    if (y === undefined) {
      return 1
    }
    const xNum = /^\d+$/.test(x)
    const yNum = /^\d+$/.test(y)
    if (xNum && yNum) {
      const d = Number(x) - Number(y)
      if (d !== 0) {
        return d < 0 ? -1 : 1
      }
    } else if (xNum !== yNum) {
      // 数字标识符优先级低于字母标识符
      return xNum ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/**
 * semver 比较：a < b → 负数；a === b → 0；a > b → 正数。
 * 修复旧实现 Number("3-alpha") → NaN 把 1.2.3-alpha 判为等于 1.2.3 的缺陷。
 */
function compareSemver(aRaw, bRaw) {
  const a = parseSemver(aRaw)
  const b = parseSemver(bRaw)
  if (!a || !b) {
    return 0
  }
  if (a.major !== b.major) {
    return a.major - b.major
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor
  }
  if (a.patch !== b.patch) {
    return a.patch - b.patch
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

// ── 版本感知 ──────────────────────────────────────────────────────

function getCurrentVersion() {
  try {
    // 不缓存 require：升级后进程会重启，届时重新加载
    const pkgPath = path.join(ROOT_DIR, 'package.json')
    delete require.cache[require.resolve(pkgPath)]
    const pkg = require(pkgPath)
    return pkg && pkg.version ? String(pkg.version) : '0.0.0'
  } catch (e) {
    logger.warn(`upgradeService: read package.json version failed: ${e.message}`)
    return '0.0.0'
  }
}

/** 枚举远端 tag（零凭据，走 SSH remote）。返回合法 tag 名数组。 */
async function listRemoteTags() {
  const out = await git(['ls-remote', '--tags', 'origin'])
  const tags = new Set()
  for (const line of out.split('\n')) {
    const m = /refs\/tags\/(\S+)$/.exec(line.trim())
    if (!m) {
      continue
    }
    const name = m[1]
    if (name.endsWith('^{}')) {
      continue // 附注 tag 的解引用行
    }
    if (TAG_RE.test(name)) {
      tags.add(name)
    }
  }
  return Array.from(tags)
}

/** 选出最大 semver tag。allowPrerelease=false 时排除 prerelease。 */
function pickLatestTag(tags, allowPrerelease = false) {
  const candidates = tags.filter((t) => {
    const v = parseSemver(t)
    if (!v) {
      return false
    }
    return allowPrerelease || v.prerelease.length === 0
  })
  if (candidates.length === 0) {
    return null
  }
  return candidates.sort((a, b) => compareSemver(a, b)).pop()
}

// ── 变更分析（提示与步骤裁剪共用）─────────────────────────────────

const CONVENTIONAL_RE =
  /^(feat|fix|security|perf|refactor|chore|docs|test|build|ci|style|revert)(\([^)]*\))?!?:\s*(.+)$/i

/** 判断是否为"纯版本号提交"（应从变更清单过滤）。 */
async function isVersionBumpCommit(sha) {
  try {
    const files = (await git(['show', '--name-only', '--pretty=format:', sha]))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (files.length === 0) {
      return false
    }
    return files.every((f) => f === 'package.json' || f === 'VERSION' || f === 'package-lock.json')
  } catch (_e) {
    return false
  }
}

/**
 * 取 from..to 的 commit 列表并按 conventional type 分组，过滤纯版本号提交。
 */
async function getChangelog(fromTag, toTag) {
  const range = `refs/tags/${fromTag}..refs/tags/${toTag}`
  let raw = ''
  try {
    // 以 NUL(%x00) 分隔记录、US(%x1f) 分隔字段：
    // commit message 可能含多行正文，若按换行分隔会把单条记录拆散（实测 36f55e1 曾被漏掉）
    raw = await git(['log', '--no-merges', '--pretty=format:%H%x1f%s%x00', range])
  } catch (e) {
    return { available: false, reason: e.message, groups: {}, total: 0, filtered: 0 }
  }

  const groups = {}
  let total = 0
  let filtered = 0

  for (const record of raw.split('\x00')) {
    if (!record.trim()) {
      continue
    }
    const [sha, subject] = record.replace(/^\n+/, '').split('\x1f')
    if (!sha || !subject) {
      continue
    }
    total++
    // eslint-disable-next-line no-await-in-loop
    if (await isVersionBumpCommit(sha)) {
      filtered++
      continue
    }
    const m = CONVENTIONAL_RE.exec(subject.trim())
    const type = m ? m[1].toLowerCase() : 'other'
    const text = m ? m[3].trim() : subject.trim()
    if (!groups[type]) {
      groups[type] = []
    }
    groups[type].push({ sha: sha.slice(0, 7), subject: text })
  }

  return { available: true, groups, total, filtered }
}

/** 取 from..to 的变更文件与 diffstat。 */
async function getDiffFacts(fromTag, toTag) {
  const range = `refs/tags/${fromTag}..refs/tags/${toTag}`
  const files = (await git(['diff', '--name-only', range]))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  let insertions = 0
  let deletions = 0
  try {
    const numstat = await git(['diff', '--numstat', range])
    for (const line of numstat.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2) {
        const a = parseInt(parts[0], 10)
        const d = parseInt(parts[1], 10)
        if (Number.isFinite(a)) {
          insertions += a
        }
        if (Number.isFinite(d)) {
          deletions += d
        }
      }
    }
  } catch (_e) {
    /* diffstat 失败不阻塞 */
  }

  return { files, fileCount: files.length, insertions, deletions }
}

/**
 * 判断某个 package.json 的依赖"内容"是否变化（D5 核心）。
 * 关键：仅 version 字段变化不算依赖变化，否则每次发版都会误判需要 npm install。
 */
async function depsChanged(pkgPath, fromTag, toTag) {
  const readAt = async (ref) => {
    try {
      const raw = await git(['show', `refs/tags/${ref}:${pkgPath}`])
      const json = JSON.parse(raw)
      return {
        dependencies: json.dependencies || {},
        devDependencies: json.devDependencies || {},
        optionalDependencies: json.optionalDependencies || {}
      }
    } catch (_e) {
      return null
    }
  }
  const a = await readAt(fromTag)
  const b = await readAt(toTag)
  if (!a || !b) {
    // 读不到（新增/删除文件）时保守判定为已变化
    return true
  }
  return JSON.stringify(a) !== JSON.stringify(b)
}

// ── lock 噪音语义判定（fix-upgrade-preflight-with-single-version-source）────
//
// 背景：npm install 会把 package-lock.json 的 .version 与 .packages[""].version
// 对齐到 package.json 的版本，产生一条与依赖树无关的"噪音"改动，卡住升级预检。
//
// D1 白名单 + 语义判定 + 失败闭合：只有白名单内的 lock 文件、且两侧除版本字段外
//    完全一致时才判为噪音；任何读取/解析/未预期异常一律判 blocking。
// D2 工作区侧 lock 的 version 必须等于 package.json 的 version，否则不是"对齐"
//    而是人为篡改，必须拦。

/** D1 噪音白名单：唯一定义处，预检不得另行硬编码路径。 */
const LOCK_NOISE_PATHS = ['package-lock.json', 'web/admin-spa/package-lock.json']

/** 版本字段归一化占位值（仅用于深比较，不落盘）。 */
const VERSION_PLACEHOLDER = '\u0000<normalized-version>'

/**
 * 读取指定 ref 下的文件内容。文件不存在（或该 ref 无此路径）返回 null，
 * 不抛错——由调用方决定是否判 blocking。
 */
async function readFileAtRef(ref, relPath) {
  try {
    return await git(['show', `${ref}:${relPath}`])
  } catch (_e) {
    return null
  }
}

/** 不依赖键序的深比较（JSON.stringify 受键序影响，不可靠）。 */
function deepEqual(a, b) {
  if (a === b) {
    return true
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false
  }
  if (typeof a !== 'object') {
    return false
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false
    }
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) {
    return false
  }
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
}

/** 深拷贝并把两处 version 归一化为占位值（不原地改动传入对象）。 */
function normalizeLockVersions(lock) {
  const copy = JSON.parse(JSON.stringify(lock))
  copy.version = VERSION_PLACEHOLDER
  copy.packages[''].version = VERSION_PLACEHOLDER
  return copy
}

/**
 * 判断工作区里某个改动文件是否"仅为 lock 版本号对齐"的噪音。
 *
 * @param {string} relPath 相对仓库根的路径（porcelain 输出的路径）
 * @param {{ headRef?: string }} [opts]
 * @returns {Promise<{ noise: boolean, reason: string }>}
 *   reason ∈ path-not-whitelisted | parse-failed | missing-version-field |
 *            other-fields-differ | version-mismatch-package-json |
 *            lock-version-alignment | unexpected-error: <msg>
 */
async function isLockVersionOnlyChange(relPath, { headRef = 'HEAD' } = {}) {
  try {
    if (!LOCK_NOISE_PATHS.includes(relPath)) {
      return { noise: false, reason: 'path-not-whitelisted' }
    }

    // HEAD 侧
    const headRaw = await readFileAtRef(headRef, relPath)
    if (headRaw === null) {
      return { noise: false, reason: 'parse-failed' }
    }
    // 工作区侧
    let workRaw
    try {
      workRaw = fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8')
    } catch (_e) {
      return { noise: false, reason: 'parse-failed' }
    }

    let head
    let work
    try {
      head = JSON.parse(headRaw)
      work = JSON.parse(workRaw)
    } catch (_e) {
      return { noise: false, reason: 'parse-failed' }
    }

    const hasVersionFields = (lock) =>
      lock &&
      typeof lock === 'object' &&
      typeof lock.version === 'string' &&
      lock.packages &&
      typeof lock.packages === 'object' &&
      lock.packages[''] &&
      typeof lock.packages[''] === 'object' &&
      typeof lock.packages[''].version === 'string'

    if (!hasVersionFields(head) || !hasVersionFields(work)) {
      return { noise: false, reason: 'missing-version-field' }
    }

    if (!deepEqual(normalizeLockVersions(head), normalizeLockVersions(work))) {
      return { noise: false, reason: 'other-fields-differ' }
    }

    // D2：工作区侧的版本必须与唯一权威来源 package.json 一致
    const pkgVersion = getCurrentVersion()
    if (work.version !== pkgVersion || work.packages[''].version !== pkgVersion) {
      return { noise: false, reason: 'version-mismatch-package-json' }
    }

    return { noise: true, reason: 'lock-version-alignment' }
  } catch (e) {
    // D1 失败闭合：判定器自身出问题时一律当作 blocking，绝不放行
    return { noise: false, reason: `unexpected-error: ${e && e.message ? e.message : e}` }
  }
}

const WEB_DIR = 'web/admin-spa/'
const WEB_PKG = 'web/admin-spa/package.json'

/**
 * 依据变更内容裁剪升级步骤（D5）。
 * 返回步骤计划数组，每项 { name, label, needed, reason, warning? }
 */
async function planSteps(fromTag, toTag, diffFacts) {
  const { files } = diffFacts
  const has = (pred) => files.some(pred)

  const rootDeps = await depsChanged('package.json', fromTag, toTag)
  const webDeps = files.includes(WEB_PKG) ? await depsChanged(WEB_PKG, fromTag, toTag) : false

  // 前端源码变更（排除其 package.json 自身）
  const webSrcChanged = has((f) => f.startsWith(WEB_DIR) && f !== WEB_PKG)
  // 运行时相关变更（决定是否必须重启）
  // 注意：仅 src/ 与 config/ 会被 node 进程加载；scripts/ 等属工具链，
  // 变更本身不需要重启，但也不能落入"什么都不做"的空档（见下方 needsRestart 兜底）。
  const runtimeChanged = has(
    (f) => f.startsWith('src/') || f.startsWith('config/') || f === 'package.json'
  )
  // 非运行时变更（文档、规格、工具脚本、systemd 归档等）
  const NON_RUNTIME_RE = /^(openspec\/|scripts\/|docs\/|\.github\/)/
  const onlyNonRuntime =
    files.length > 0 && files.every((f) => f.endsWith('.md') || NON_RUNTIME_RE.test(f))
  // 保留原变量名以兼容返回值语义
  const onlyDocs = onlyNonRuntime

  const steps = [
    {
      name: 'checkout',
      label: '拉取代码',
      needed: true,
      reason: `切换到 refs/tags/${toTag}`
    },
    {
      name: 'npmInstall',
      label: '安装后端依赖',
      needed: rootDeps,
      reason: rootDeps ? '根依赖集合已变化' : '依赖未变，跳过'
    },
    {
      name: 'npmInstallWeb',
      label: '安装前端依赖',
      needed: webDeps,
      reason: webDeps ? '前端依赖集合已变化' : '依赖未变，跳过'
    },
    {
      name: 'buildWeb',
      label: '重建前端',
      needed: webSrcChanged,
      reason: webSrcChanged ? '前端源码已变化（约 15 秒）' : '前端未变，跳过'
    },
    {
      name: 'restart',
      label: '重启服务',
      needed: !onlyNonRuntime && (runtimeChanged || webSrcChanged || rootDeps || webDeps),
      reason: onlyNonRuntime
        ? '仅文档/工具链变更，无需重启'
        : runtimeChanged || rootDeps
          ? '加载新代码'
          : '应用新前端产物',
      warning: '会中断进行中的会话'
    }
  ]

  return { steps, onlyDocs }
}

// ── 对外：感知 + 提示载荷 ─────────────────────────────────────────

/**
 * 检查更新，返回 L3 详细度载荷。
 * 远端不可达时降级：hasUpdate=false + error 说明，不抛异常（spec 要求）。
 */
async function checkForUpdates(options = {}) {
  const allowPrerelease =
    options.allowPrerelease !== undefined
      ? options.allowPrerelease
      : String(process.env.UPGRADE_ALLOW_PRERELEASE || 'false') === 'true'

  const current = getCurrentVersion()
  const base = {
    current,
    latest: current,
    hasUpdate: false,
    latestTag: null,
    changelog: null,
    impact: null,
    plannedSteps: null,
    error: null,
    checkedAt: new Date().toISOString()
  }

  let tags
  try {
    tags = await listRemoteTags()
  } catch (e) {
    logger.warn(`upgradeService: ls-remote failed: ${e.message}`)
    return { ...base, error: `无法访问远端仓库: ${e.message}` }
  }

  const latestTag = pickLatestTag(tags, allowPrerelease)
  if (!latestTag) {
    return { ...base, error: '远端未找到符合 vX.Y.Z 规范的 tag' }
  }

  const latest = latestTag.replace(/^v/, '')
  const hasUpdate = compareSemver(current, latest) < 0
  const result = { ...base, latest, latestTag, hasUpdate }

  if (!hasUpdate) {
    return result
  }

  // 有更新：补齐变更清单 + 影响面 + 步骤计划
  const currentTag = `v${current}`
  const hasCurrentTag = tags.includes(currentTag)

  if (!hasCurrentTag) {
    // 本地版本在远端无对应 tag（开发态）：清单降级，其余字段仍正常返回
    result.changelog = { available: false, reason: `远端无对应 tag ${currentTag}，无法比对` }
    return result
  }

  try {
    // 需要本地存在这两个 tag 对象才能算 diff/log
    await git(['fetch', '--tags', '--quiet', 'origin'], 60000)
    const diffFacts = await getDiffFacts(currentTag, latestTag)
    const { steps } = await planSteps(currentTag, latestTag, diffFacts)
    result.changelog = await getChangelog(currentTag, latestTag)
    result.impact = {
      fileCount: diffFacts.fileCount,
      insertions: diffFacts.insertions,
      deletions: diffFacts.deletions
    }
    result.plannedSteps = steps
  } catch (e) {
    logger.warn(`upgradeService: analyze ${currentTag}..${latestTag} failed: ${e.message}`)
    result.changelog = { available: false, reason: `分析失败: ${e.message}` }
  }

  return result
}

module.exports = {
  // 感知
  checkForUpdates,
  getCurrentVersion,
  listRemoteTags,
  pickLatestTag,
  // semver
  parseSemver,
  compareSemver,
  // 分析
  getChangelog,
  getDiffFacts,
  depsChanged,
  planSteps,
  // 预检语义判定（fix-upgrade-preflight-with-single-version-source）
  LOCK_NOISE_PATHS,
  isLockVersionOnlyChange,
  readFileAtRef,
  // 内部工具（供后续升级执行与测试复用）
  git,
  TAG_RE,
  ROOT_DIR
}
