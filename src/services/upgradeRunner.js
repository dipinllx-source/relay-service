/**
 * ⬆️ Upgrade Runner — 升级流水线编排（OpenSpec tasks 4.1-4.4）
 *
 * 关键设计（design.md）：
 *   D6 通过 process.exit(0) 结束进程，由 systemd(Restart=always) 以新代码拉起；
 *      不在应用内派生 detached 子进程自举。
 *   D7 进度与结果持久化到 Redis，跨进程重启可查（因末步 exit 会切断 HTTP 连接）。
 *   D9 不做回滚：任一前置步骤失败即中止且【不重启】，服务继续以旧版本运行。
 *
 * 安全：所有 git/npm 调用使用 execFile + 参数数组（不经 shell）；
 *      目标 tag 必须通过白名单校验且存在于 ls-remote 结果集。
 */

const { execFile } = require('child_process')
const redis = require('../models/redis')
const logger = require('../utils/logger')
const upgradeService = require('./upgradeService')

const { ROOT_DIR } = upgradeService
const STATE_KEY = 'upgrade:last_run'
const LOCK_KEY = 'upgrade:lock'
const LOCK_TTL_SEC = parseInt(process.env.UPGRADE_LOCK_TTL_SEC || '1800', 10)
const STATE_TTL_SEC = parseInt(process.env.UPGRADE_STATE_TTL_SEC || String(30 * 86400), 10)
const STEP_TIMEOUT_MS = parseInt(process.env.UPGRADE_STEP_TIMEOUT_MS || '600000', 10)
const EXIT_DELAY_MS = parseInt(process.env.UPGRADE_EXIT_DELAY_MS || '1500', 10)
const TAIL_LIMIT = 4000

function tail(str, n = TAIL_LIMIT) {
  const s = (str || '').toString()
  return s.length > n ? s.slice(-n) : s
}

function run(cmd, args, timeoutMs = STEP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: ROOT_DIR, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, env: process.env },
      (err, stdout, stderr) => {
        const out = `${(stdout || '').toString()}\n${(stderr || '').toString()}`.trim()
        if (err) {
          const e = new Error(`${cmd} ${args.join(' ')} failed`)
          e.output = out
          return reject(e)
        }
        resolve(out)
      }
    )
  })
}

// ── 状态持久化（D7）──────────────────────────────────────────────

async function saveState(state) {
  try {
    const client = redis.getClientSafe ? redis.getClientSafe() : redis.getClient()
    if (!client) {
      return
    }
    await client.set(STATE_KEY, JSON.stringify(state), 'EX', STATE_TTL_SEC)
  } catch (e) {
    logger.warn(`upgradeRunner: saveState failed: ${e.message}`)
  }
}

async function getState() {
  try {
    const client = redis.getClientSafe ? redis.getClientSafe() : redis.getClient()
    if (!client) {
      return null
    }
    const raw = await client.get(STATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    logger.warn(`upgradeRunner: getState failed: ${e.message}`)
    return null
  }
}

// ── 互斥锁（4.2）─────────────────────────────────────────────────

async function acquireLock(token) {
  const client = redis.getClientSafe ? redis.getClientSafe() : redis.getClient()
  if (!client) {
    throw new Error('Redis unavailable')
  }
  const ok = await client.set(LOCK_KEY, token, 'EX', LOCK_TTL_SEC, 'NX')
  return ok === 'OK'
}

async function releaseLock(token) {
  try {
    const client = redis.getClientSafe ? redis.getClientSafe() : redis.getClient()
    if (!client) {
      return
    }
    const cur = await client.get(LOCK_KEY)
    if (cur === token) {
      await client.del(LOCK_KEY)
    }
  } catch (_e) {
    /* 锁有 TTL，失败可忽略 */
  }
}

async function isLocked() {
  try {
    const client = redis.getClientSafe ? redis.getClientSafe() : redis.getClient()
    if (!client) {
      return false
    }
    return (await client.exists(LOCK_KEY)) === 1
  } catch (_e) {
    return false
  }
}

// ── 预检（4.2 + fix-upgrade-preflight-with-single-version-source 第 2 组）──

/**
 * 解析 `git status --porcelain` 的一行为 `{ xy, path }`。
 * 无法可靠解析时返回 null 或标记 unparsable —— 由调用方判 blocking（失败闭合）。
 */
function parsePorcelainLine(line) {
  if (typeof line !== 'string' || line.length < 4 || line[2] !== ' ') {
    return null
  }
  const xy = line.slice(0, 2)
  let rest = line.slice(3)
  if (!rest) {
    return null
  }
  // 重命名/复制条目形如 `R  old -> new`：取新路径（旧路径的删除随之发生）
  if (xy.includes('R') || xy.includes('C')) {
    const sep = rest.indexOf(' -> ')
    if (sep < 0) {
      return null
    }
    rest = rest.slice(sep + 4)
  }
  // 带引号路径（core.quotepath 开启或路径含空格/非 ASCII）内含 C 风格转义，
  // 此处不做还原：白名单路径均为纯 ASCII、不会被引号包裹，故一律判不可解析。
  if (rest.startsWith('"')) {
    return { xy, path: rest, unparsable: true }
  }
  return { xy, path: rest }
}

/** 回读 stash ref：栈顶 commit 为主，refs/stash 为校验/兜底。 */
async function readStashRef() {
  try {
    const top = (await upgradeService.git(['stash', 'list', '--format=%H', '-1'])).trim()
    if (top) {
      return top
    }
  } catch (_e) {
    /* 落到 refs/stash 兜底 */
  }
  try {
    const ref = (await upgradeService.git(['rev-parse', '-q', '--verify', 'refs/stash'])).trim()
    return ref || null
  } catch (_e) {
    return null
  }
}

async function preflight(targetTag) {
  // 1. tag 名白名单（拒绝 main / 路径穿越 / 任意 ref）
  if (typeof targetTag !== 'string' || !upgradeService.TAG_RE.test(targetTag)) {
    const e = new Error(`非法的目标版本: ${targetTag}`)
    e.statusCode = 400
    throw e
  }

  // 2. 必须存在于远端 tag 集合（不接受任意 ref）
  const tags = await upgradeService.listRemoteTags()
  if (!tags.includes(targetTag)) {
    const e = new Error(`远端不存在该版本: ${targetTag}`)
    e.statusCode = 400
    throw e
  }

  // 3. 目标不能是当前版本
  //    次序说明：该判定前置于工作区判定，避免为一次注定被拒的升级白 stash 一遍。
  const current = upgradeService.getCurrentVersion()
  const target = targetTag.replace(/^v/, '')
  if (upgradeService.compareSemver(current, target) === 0) {
    const e = new Error(`已是该版本: ${current}`)
    e.statusCode = 400
    throw e
  }

  // 4. 工作区逐文件语义判定：只有「lock 版本号对齐」这一类工具可再生的噪音才放行，
  //    其余一律阻断。-uno：未跟踪文件不参与判定（D4，它们不会让 checkout 失败）。
  const porcelain = await upgradeService.git(['status', '--porcelain', '-uno'])
  const findings = []
  for (const rawLine of porcelain.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim()) {
      continue
    }
    const parsed = parsePorcelainLine(line)
    if (!parsed) {
      findings.push({
        path: line.trim(),
        xy: '??',
        verdict: 'blocking',
        reason: 'unparsable-porcelain-line'
      })
      continue
    }
    if (parsed.unparsable) {
      findings.push({
        path: parsed.path,
        xy: parsed.xy,
        verdict: 'blocking',
        reason: 'unparsable-path'
      })
      continue
    }
    const { noise, reason } = await upgradeService.isLockVersionOnlyChange(parsed.path)
    findings.push({
      path: parsed.path,
      xy: parsed.xy,
      verdict: noise ? 'noise' : 'blocking',
      reason
    })
  }

  const blocking = findings.filter((f) => f.verdict === 'blocking')
  const noiseFindings = findings.filter((f) => f.verdict === 'noise')

  const formatFindings = (list) =>
    list
      .map(
        (f) =>
          `  ${f.xy} ${f.path} → ${f.verdict === 'noise' ? '可自愈噪音' : '需人介入'}（${f.reason}）`
      )
      .join('\n')

  // 4a. 有阻断项 → 409，逐文件给出判定与原因；不提供任何绕过开关（D10）
  if (blocking.length > 0) {
    const e = new Error(
      '工作区存在需人介入的改动，已中止升级' +
        '（仅 package-lock.json 的「版本号对齐」这一类可再生噪音会被自动处置）：\n' +
        `${tail(formatFindings(findings), 1600)}\n` +
        '请逐项确认 `git diff -- <path>`，确认后自行 commit 或 `git stash`，再重试升级。'
    )
    e.statusCode = 409
    e.findings = findings
    throw e
  }

  // 4b. 只有噪音 → 在 checkout 之前以可逆方式处置并留痕（D3：只 stash，不 pop）
  let stashRef = null
  if (noiseFindings.length > 0) {
    const paths = noiseFindings.map((f) => f.path)
    const stashMessage = `<upgrade-preflight> ${targetTag} ${new Date().toISOString()}`
    try {
      await upgradeService.git(['stash', 'push', '-m', stashMessage, '--', ...paths], 60000)
    } catch (err) {
      const e = new Error(
        `预检自愈失败：无法 stash 可再生噪音（${paths.join(', ')}）：${err.message}\n` +
          '已中止升级，未执行 checkout，工作区保持原样。'
      )
      e.statusCode = 409
      e.findings = findings
      throw e
    }

    stashRef = await readStashRef()
    const after = await upgradeService.git(['status', '--porcelain', '-uno'])
    if (!stashRef || after.trim()) {
      const e = new Error(
        '预检自愈未生效：stash 后工作区仍不干净或读不到 stash ref，已中止升级（未执行 checkout）：\n' +
          `${tail(after, 800)}`
      )
      e.statusCode = 409
      e.findings = findings
      throw e
    }

    for (const f of noiseFindings) {
      f.stashRef = stashRef
    }
    logger.info(
      `⬆️ Upgrade preflight 自愈：已 stash ${paths.length} 个可再生噪音文件（${paths.join(', ')}）` +
        ` → stash ${stashRef.slice(0, 12)}，目标 ${targetTag}；不会自动恢复（D3）`
    )
  }

  return { current, target, tags, findings, stashRef }
}

// ── 流水线（4.1、4.4）────────────────────────────────────────────

/**
 * 执行升级。成功时以 process.exit(0) 结束进程（由 systemd 拉起新代码）。
 * 任一前置步骤失败：中止、不重启、服务继续以旧版本运行。
 */
async function performUpgrade(targetTag, meta = {}) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  if (!(await acquireLock(token))) {
    const e = new Error('已有升级正在进行中')
    e.statusCode = 409
    throw e
  }

  // 预检可观测性（本变更 D5）：状态在拿到锁之后、预检之前就初始化并落盘，
  // 使四类预检失败（非法 tag / 远端无此 tag / 工作区需人介入 / 已是该版本）
  // 都能写进 upgrade:last_run，而不是留着上一次的记录。
  const state = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    fromVersion: null,
    toVersion: null,
    targetTag,
    triggeredBy: meta.admin || 'unknown',
    status: 'preflight',
    plannedSteps: [],
    steps: [],
    preflightFindings: null,
    result: null,
    error: null,
    willRestart: false
  }
  await saveState(state)

  // 流水线原子性：记录起始 ref；checkout 后若后续步骤失败需回退，
  // 保证「服务继续以旧版本运行」的承诺不被破坏（工作区不会停在坏版本）。
  let checkedOut = false
  let originRef = null
  try {
    const { current, target, findings, stashRef } = await preflight(targetTag)
    state.preflightFindings = { files: findings, stashRef }

    try {
      originRef = (await upgradeService.git(['rev-parse', 'HEAD'])).trim()
    } catch (_e) {
      originRef = null
    }

    // 计划步骤（与提示展示同一份数据）
    const fromTag = `v${current}`
    await upgradeService.git(['fetch', '--tags', '--quiet', 'origin'], 60000)
    const diffFacts = await upgradeService.getDiffFacts(fromTag, targetTag)
    const { steps: planned } = await upgradeService.planSteps(fromTag, targetTag, diffFacts)

    state.fromVersion = current
    state.toVersion = target
    state.status = 'running'
    state.plannedSteps = planned.map((s) => ({ name: s.name, label: s.label, needed: s.needed }))
    state.steps = []
    await saveState(state)

    const mark = async (name, label, patch) => {
      const idx = state.steps.findIndex((s) => s.name === name)
      const entry = { name, label, ...patch }
      if (idx >= 0) {
        state.steps[idx] = { ...state.steps[idx], ...entry }
      } else {
        state.steps.push(entry)
      }
      await saveState(state)
    }

    const needed = (name) => {
      const s = planned.find((x) => x.name === name)
      return Boolean(s && s.needed)
    }

    const execStep = async (name, label, cmd, args) => {
      if (!needed(name)) {
        await mark(name, label, { status: 'skipped', durationMs: 0 })
        return
      }
      await mark(name, label, { status: 'running', startedAt: new Date().toISOString() })
      const t0 = Date.now()
      try {
        const out = await run(cmd, args)
        await mark(name, label, {
          status: 'success',
          durationMs: Date.now() - t0,
          tailLog: tail(out, 1200)
        })
      } catch (err) {
        await mark(name, label, {
          status: 'failed',
          durationMs: Date.now() - t0,
          tailLog: tail(err.output || err.message)
        })
        throw err
      }
    }

    // 1) checkout 到目标 tag（全限定 ref，detached HEAD）
    await mark('checkout', '拉取代码', { status: 'running' })
    const tc0 = Date.now()
    try {
      const out = await upgradeService.git(
        ['checkout', '--detach', `refs/tags/${targetTag}`],
        60000
      )
      await mark('checkout', '拉取代码', {
        status: 'success',
        durationMs: Date.now() - tc0,
        tailLog: tail(out, 800)
      })
      checkedOut = true
    } catch (err) {
      await mark('checkout', '拉取代码', {
        status: 'failed',
        durationMs: Date.now() - tc0,
        tailLog: tail(err.stderr || err.message)
      })
      throw err
    }

    // 2) 依赖与前端构建（按裁剪结果）
    await execStep('npmInstall', '安装后端依赖', 'npm', ['install', '--no-audit', '--no-fund'])
    await execStep('npmInstallWeb', '安装前端依赖', 'npm', ['run', 'install:web'])
    await execStep('buildWeb', '重建前端', 'npm', ['run', 'build:web'])

    // 3) 完成：决定是否需要重启
    const willRestart = needed('restart')
    state.status = 'success'
    state.result = willRestart ? 'restarting' : 'completed_no_restart'
    state.willRestart = willRestart
    state.finishedAt = new Date().toISOString()
    await mark('restart', '重启服务', {
      status: willRestart ? 'pending_restart' : 'skipped',
      durationMs: 0
    })
    await saveState(state)

    logger.success(
      `⬆️ Upgrade ${current} → ${target} 步骤完成，${willRestart ? '即将退出以加载新代码' : '无需重启'}`
    )

    await releaseLock(token)

    if (willRestart) {
      // 给 HTTP 响应留出发送窗口，然后主动退出；由 systemd 以新代码拉起（D6）
      setTimeout(() => {
        logger.warn('⬆️ Upgrade: exiting process(0) for systemd to restart with new code')
        process.exit(0)
      }, EXIT_DELAY_MS)
    }

    return { ...state }
  } catch (err) {
    // 流水线原子性回退：若已切到目标 tag 但后续步骤失败，回退工作区到起始 ref，
    // 确保进程即便之后被 systemd 重启也仍加载旧版本代码（D9 的必要保障）。
    if (checkedOut && originRef) {
      try {
        await upgradeService.git(['checkout', '--detach', originRef], 60000)
        logger.warn(`⬆️ Upgrade failed: 工作区已回退到 ${originRef.slice(0, 7)}（旧版本）`)
        const idx = state.steps.findIndex((x) => x.name === 'checkout')
        if (idx >= 0) {
          state.steps[idx].status = 'reverted'
        }
        state.result = 'failed_reverted_to_previous'
      } catch (revErr) {
        logger.error(`❌ Upgrade 回退失败，工作区可能停在坏版本: ${revErr.message}`)
        state.result = 'failed_revert_error'
        state.revertError = revErr.message
      }
    }
    // 预检阻断时把逐文件判定结果一并落盘（state 在预检前已就位，恒可写）
    if (err && err.findings && !state.preflightFindings) {
      state.preflightFindings = { files: err.findings, stashRef: null }
    }
    state.status = 'failed'
    state.error = err.message
    if (!state.result || state.result === 'running') {
      state.result = 'failed_service_unchanged'
    }
    state.finishedAt = new Date().toISOString()
    await saveState(state)
    await releaseLock(token)
    logger.error(`❌ Upgrade failed (服务仍运行旧版本): ${err.message}`)
    throw err
  }
}

module.exports = {
  performUpgrade,
  getState,
  isLocked,
  preflight,
  // 供测试复用的内部工具
  parsePorcelainLine,
  STATE_KEY,
  LOCK_KEY
}
