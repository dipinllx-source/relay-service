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

const ROOT_DIR = upgradeService.ROOT_DIR
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

// ── 预检（4.2）───────────────────────────────────────────────────

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

  // 3. 工作区必须干净，否则 checkout 会失败或丢改动
  const porcelain = await upgradeService.git(['status', '--porcelain'])
  if (porcelain.trim()) {
    const e = new Error(
      `工作区存在未提交改动，已中止升级：\n${tail(porcelain, 800)}`
    )
    e.statusCode = 409
    throw e
  }

  // 4. 目标不能是当前版本
  const current = upgradeService.getCurrentVersion()
  const target = targetTag.replace(/^v/, '')
  if (upgradeService.compareSemver(current, target) === 0) {
    const e = new Error(`已是该版本: ${current}`)
    e.statusCode = 400
    throw e
  }

  return { current, target, tags }
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

  let state
  try {
    const { current, target } = await preflight(targetTag)

    // 计划步骤（与提示展示同一份数据）
    const fromTag = `v${current}`
    await upgradeService.git(['fetch', '--tags', '--quiet', 'origin'], 60000)
    const diffFacts = await upgradeService.getDiffFacts(fromTag, targetTag)
    const { steps: planned } = await upgradeService.planSteps(fromTag, targetTag, diffFacts)

    state = {
      startedAt: new Date().toISOString(),
      finishedAt: null,
      fromVersion: current,
      toVersion: target,
      targetTag,
      triggeredBy: meta.admin || 'unknown',
      status: 'running',
      plannedSteps: planned.map((s) => ({ name: s.name, label: s.label, needed: s.needed })),
      steps: [],
      result: null,
      error: null,
      willRestart: false
    }
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
      const out = await upgradeService.git(['checkout', '--detach', `refs/tags/${targetTag}`], 60000)
      await mark('checkout', '拉取代码', {
        status: 'success',
        durationMs: Date.now() - tc0,
        tailLog: tail(out, 800)
      })
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
    if (state) {
      state.status = 'failed'
      state.error = err.message
      state.result = 'failed_service_unchanged'
      state.finishedAt = new Date().toISOString()
      await saveState(state)
    }
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
  STATE_KEY,
  LOCK_KEY
}
