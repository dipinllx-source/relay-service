/**
 * 空闲账号用量刷新服务
 *
 * 为什么需要：Codex 账号的额度（codexUsage）只能从真实请求的响应头里拿到。
 * 调度器按"用量档位 → lastUsedAt"排序，若某账号长时间没被选中，它的用量快照会一直停留在
 * 旧值（例如几天前的 72%），导致它一直落在高档位、继续不被选中 —— 形成"越旧越不用"的死循环，
 * 负载均衡失真。本服务每分钟扫描一次，对 lastUsedAt 超过阈值（默认 5 小时）的账号发一次
 * 最小探测请求，刷新用量快照并更新 lastUsedAt。
 *
 * 处理规则：
 *   - 只看账号自身记录的最后使用时间（lastUsedAt），不引入额外标识
 *   - 每轮最多处理 maxPerTick（默认 2）个 lastUsedAt 在阈值之前的账号，最久未用的优先，串行执行；
 *     没有符合条件的账号则本轮不做任何事
 *   - 账号处理后（无论探测成功或失败）lastUsedAt 都更新为当前时间，因此阈值内不会重复处理
 *   - 仅处理激活、可调度、未限流、未临时不可用、状态正常的 OpenAI (Codex OAuth) 账号
 *   - Redis 锁保证多实例部署时同一时刻只有一个实例执行
 */

const crypto = require('crypto')
const logger = require('../utils/logger')
const config = require('../../config/config')
const redis = require('../models/redis')
const openaiAccountService = require('./account/openaiAccountService')
const upstreamErrorHelper = require('../utils/upstreamErrorHelper')
const { isSchedulable } = require('../utils/commonHelper')

const LOCK_KEY = 'lock:account_usage_refresh'
const LOCK_TTL_MS = 5 * 60 * 1000
const UNUSABLE_STATUSES = new Set(['error', 'unauthorized', 'blocked'])

// config/config.js 不入库（升级不会带上新配置段），缺失时直接读环境变量，保证老部署也能用 env 调参
function readEnvSettings() {
  const { env } = process
  return {
    enabled: env.ACCOUNT_USAGE_REFRESH_ENABLED !== 'false',
    idleHours: parseFloat(env.ACCOUNT_USAGE_REFRESH_IDLE_HOURS),
    maxPerTick: parseInt(env.ACCOUNT_USAGE_REFRESH_MAX_PER_TICK),
    model: env.ACCOUNT_USAGE_REFRESH_MODEL || null
  }
}

function getSettings() {
  const raw = config.accountUsageRefresh || readEnvSettings()
  const positive = (value, fallback) => {
    const num = Number(value)
    return Number.isFinite(num) && num > 0 ? num : fallback
  }
  return {
    enabled: raw.enabled !== false,
    intervalMs: positive(raw.intervalMs, 60 * 1000),
    idleMs: positive(raw.idleHours, 5) * 60 * 60 * 1000,
    maxPerTick: Math.floor(positive(raw.maxPerTick, 2)),
    model: raw.model || null
  }
}

function parseTime(value) {
  if (!value) {
    return 0
  }
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

class AccountUsageRefreshService {
  constructor() {
    this.timer = null
    this.running = false
  }

  start() {
    if (this.timer) {
      return
    }
    const settings = getSettings()
    if (!settings.enabled) {
      logger.info('📊 Account usage refresh service disabled')
      return
    }
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        logger.error('❌ Account usage refresh tick failed:', error)
      })
    }, settings.intervalMs)
    if (typeof this.timer.unref === 'function') {
      this.timer.unref()
    }
    logger.info(
      `📊 Account usage refresh service started (every ${Math.round(settings.intervalMs / 1000)}s, idle threshold ${settings.idleMs / 3600000}h, max ${settings.maxPerTick}/tick)`
    )
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * 判断账号是否需要（且适合）探测
   */
  async isEligible(account, now, settings) {
    if (!account || !account.id) {
      return false
    }
    if (account.isActive !== true && account.isActive !== 'true') {
      return false
    }
    if (UNUSABLE_STATUSES.has(account.status)) {
      return false
    }
    // 管理员手动停调度的账号不参与负载均衡，也不替它消耗额度
    if (!isSchedulable(account.schedulable)) {
      return false
    }
    if (account.rateLimitStatus?.isRateLimited) {
      return false
    }
    if (now - parseTime(account.lastUsedAt) < settings.idleMs) {
      return false
    }
    try {
      if (await upstreamErrorHelper.isTempUnavailable(account.id, 'openai')) {
        return false
      }
    } catch (error) {
      logger.debug(`📊 Temp-unavailable check failed for ${account.id}: ${error.message}`)
    }
    return true
  }

  async _acquireLock() {
    const token = crypto.randomBytes(8).toString('hex')
    const client = redis.getClientSafe()
    const result = await client.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX')
    return result === 'OK' ? token : null
  }

  async _releaseLock(token) {
    try {
      const client = redis.getClientSafe()
      // 只释放自己持有的锁
      await client.eval(
        'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0',
        1,
        LOCK_KEY,
        token
      )
    } catch (error) {
      logger.warn(`⚠️ Failed to release account usage refresh lock: ${error.message}`)
    }
  }

  /**
   * 执行一轮扫描
   * @returns {Promise<{skipped?: string, refreshed: string[], failed: string[]}>}
   */
  async runOnce(now = Date.now()) {
    const summary = { refreshed: [], failed: [] }
    if (this.running) {
      return { ...summary, skipped: 'running' }
    }
    this.running = true
    let lockToken = null
    try {
      lockToken = await this._acquireLock()
      if (!lockToken) {
        return { ...summary, skipped: 'locked' }
      }

      const settings = getSettings()
      const accounts = await openaiAccountService.getAllAccounts()

      const candidates = []
      for (const account of accounts || []) {
        if (await this.isEligible(account, now, settings)) {
          candidates.push(account)
        }
      }
      // 最久未用的优先
      candidates.sort((a, b) => parseTime(a.lastUsedAt) - parseTime(b.lastUsedAt))

      // 没有符合条件的账号：本轮不处理
      for (const account of candidates.slice(0, settings.maxPerTick)) {
        const ok = await this.refreshAccount(account, settings, now)
        ;(ok ? summary.refreshed : summary.failed).push(account.id)
      }
      return summary
    } finally {
      if (lockToken) {
        await this._releaseLock(lockToken)
      }
      this.running = false
    }
  }

  /**
   * 探测单个账号；处理后无论成败都把 lastUsedAt 更新为当前时间
   * @returns {Promise<boolean>} 是否可达（成功或 429 限流都说明鉴权正常且带回了额度头）
   */
  async refreshAccount(account, settings = getSettings(), now = Date.now()) {
    // 延迟加载，避免与 relay/scheduler 之间形成启动期循环依赖
    const openaiRelayService = require('./relay/openaiRelayService')
    const idleHours = account.lastUsedAt
      ? ((now - parseTime(account.lastUsedAt)) / 3600000).toFixed(1)
      : 'never'

    let result
    try {
      result = await openaiRelayService.probeAccountUsage(account.id, settings.model)
    } catch (error) {
      result = { reachable: false, usageUpdated: false, error: error.message }
    }

    try {
      await openaiAccountService.updateAccountUsage(account.id, 0)
    } catch (error) {
      logger.warn(`⚠️ Failed to update lastUsedAt for ${account.id}: ${error.message}`)
    }

    if (!result.reachable) {
      logger.warn(
        `📊 Idle usage refresh failed: ${account.name} (${account.id}), idle ${idleHours}h - ${result.error}; next attempt after ${settings.idleMs / 3600000}h`
      )
      return false
    }

    let usageText = ''
    if (result.usageUpdated) {
      try {
        const fresh = await openaiAccountService.getAccount(account.id)
        if (fresh && fresh.codexPrimaryUsedPercent !== undefined) {
          usageText = `, primary used ${fresh.codexPrimaryUsedPercent}%`
        }
      } catch {
        // 仅用于日志，忽略
      }
    }
    logger.info(
      `📊 Idle usage refreshed: ${account.name} (${account.id}), idle ${idleHours}h${result.rateLimited ? ', rate limited' : ''}${result.usageUpdated ? usageText : ', no usage headers'}`
    )
    return true
  }
}

module.exports = new AccountUsageRefreshService()
module.exports.AccountUsageRefreshService = AccountUsageRefreshService
module.exports.getSettings = getSettings
