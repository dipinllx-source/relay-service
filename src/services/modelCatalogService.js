/**
 * 模型清单服务（Model Catalog）
 *
 * 职责边界：
 *   - account service 负责「怎么问上游」（挑账号、拿 token、走代理、发请求）
 *   - 本服务负责「什么时候问、存哪里、失败怎么办」
 *
 * 设计要点：
 *   1. 模型清单全局通用、变更频率低 —— 全局每天只拉一次上游，不按账号维度拉取，
 *      也不使用定时器：完全懒加载，由请求触发，靠 Redis 里的时间戳做全局节流。
 *   2. 清单持久化在 Redis：重启不丢、多进程共享、管理台可展示元信息。
 *   3. 请求路径永不阻塞：记录过期时先返回旧清单，刷新放到后台。
 *   4. stale-while-error：拉取失败继续用上一份清单，只记 lastError；
 *      只有从未成功过时才返回 null，由调用方回落静态清单。
 *   5. 三重闸门约束上游调用频次：分布式锁 + 成功节流(24h) + 失败节流(30min)。
 */

const crypto = require('crypto')
const redis = require('../models/redis')
const logger = require('../utils/logger')
const config = require('../../config/config')

const SEGMENTS = ['claude', 'openai']
const CATALOG_KEY_PREFIX = 'models:catalog:'
const LOCK_KEY = 'models:catalog:lock'
const LOCK_TTL_SECONDS = 120

const DEFAULT_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_FAILURE_RETRY_MS = 30 * 60 * 1000
// 进程内 L1：避免同一秒内的多个请求反复打 Redis，过短的窗口不影响全局节流语义
const MEMORY_TTL_MS = 60 * 1000

function parseTimestamp(value) {
  if (!value) {
    return 0
  }
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

class ModelCatalogService {
  constructor() {
    this._memory = new Map() // segment -> { record, readAt }
    this._inFlight = new Map() // segment -> Promise
  }

  get successTtlMs() {
    return config.models?.catalogSuccessTtlMs || DEFAULT_SUCCESS_TTL_MS
  }

  get failureRetryMs() {
    return config.models?.catalogFailureRetryMs || DEFAULT_FAILURE_RETRY_MS
  }

  get segments() {
    return [...SEGMENTS]
  }

  _key(segment) {
    return `${CATALOG_KEY_PREFIX}${segment}`
  }

  // 懒加载 require，避免与 account service 形成循环依赖
  _fetchUpstream(segment) {
    if (segment === 'claude') {
      return require('./account/claudeAccountService').fetchAvailableModels()
    }
    if (segment === 'openai') {
      return require('./account/openaiAccountService').fetchAvailableModels()
    }
    throw new Error(`Unknown model catalog segment: ${segment}`)
  }

  // 手动强制刷新时，必须先清掉 account service 自带的短缓存，否则拿回的还是旧值
  _clearUpstreamCache(segment) {
    try {
      const service =
        segment === 'claude'
          ? require('./account/claudeAccountService')
          : require('./account/openaiAccountService')
      if (typeof service.clearModelsCache === 'function') {
        service.clearModelsCache()
      }
    } catch (error) {
      logger.warn(`⚠️ Failed to clear upstream models cache (${segment}): ${error.message}`)
    }
  }

  async _readRecord(segment, { allowMemory = true } = {}) {
    const cached = this._memory.get(segment)
    if (allowMemory && cached && Date.now() - cached.readAt < MEMORY_TTL_MS) {
      return cached.record
    }

    let record = null
    try {
      const raw = await redis.get(this._key(segment))
      if (raw) {
        record = JSON.parse(raw)
      }
    } catch (error) {
      logger.warn(`⚠️ Failed to read model catalog (${segment}): ${error.message}`)
      // Redis 抖动时宁可用进程内的旧值，也不要把清单判成「不存在」
      return cached ? cached.record : null
    }

    this._memory.set(segment, { record, readAt: Date.now() })
    return record
  }

  async _writeRecord(segment, record) {
    try {
      await redis.set(this._key(segment), JSON.stringify(record))
    } catch (error) {
      logger.warn(`⚠️ Failed to persist model catalog (${segment}): ${error.message}`)
    }
    this._memory.set(segment, { record, readAt: Date.now() })
  }

  _isFresh(record) {
    const fetchedAt = parseTimestamp(record?.fetchedAt)
    return fetchedAt > 0 && Date.now() - fetchedAt < this.successTtlMs
  }

  _canRetry(record) {
    const lastAttemptAt = parseTimestamp(record?.lastAttemptAt)
    if (lastAttemptAt === 0) {
      return true
    }
    return Date.now() - lastAttemptAt >= this.failureRetryMs
  }

  async _acquireLock(token) {
    try {
      const result = await redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_SECONDS, 'NX')
      return result === 'OK'
    } catch (error) {
      // 锁本身只是防重，Redis 异常时不应该把刷新彻底卡死
      logger.warn(`⚠️ Model catalog lock unavailable, proceeding without it: ${error.message}`)
      return true
    }
  }

  async _releaseLock(token) {
    try {
      const current = await redis.get(LOCK_KEY)
      if (current === token) {
        await redis.del(LOCK_KEY)
      }
    } catch (error) {
      logger.debug(`Model catalog lock release skipped: ${error.message}`)
    }
  }

  _refreshInBackground(segment) {
    if (this._inFlight.has(segment)) {
      return
    }
    const task = this.refresh({ segments: [segment], trigger: 'lazy' })
      .catch((error) => {
        logger.warn(`⚠️ Background model catalog refresh failed (${segment}): ${error.message}`)
      })
      .finally(() => {
        this._inFlight.delete(segment)
      })
    this._inFlight.set(segment, task)
  }

  /**
   * 取某一段的模型清单
   * @returns {Promise<Array|null>} null 表示调用方应回落静态清单
   */
  async getModels(segment) {
    const record = await this._readRecord(segment)

    // 过期就在后台刷新，本次请求照常返回旧清单，绝不阻塞请求路径
    if (!this._isFresh(record) && this._canRetry(record)) {
      this._refreshInBackground(segment)
    }

    return Array.isArray(record?.models) && record.models.length > 0 ? record.models : null
  }

  getClaudeModels() {
    return this.getModels('claude')
  }

  getOpenAIModels() {
    return this.getModels('openai')
  }

  /**
   * 刷新清单
   * @param {object} [options]
   * @param {string[]} [options.segments] - 要刷新的段，默认全部
   * @param {boolean} [options.force] - 跳过成功/失败节流（管理台手动刷新用），仍然走锁
   * @param {string} [options.trigger] - 触发来源，仅用于记录
   */
  async refresh({ segments = SEGMENTS, force = false, trigger = 'manual' } = {}) {
    const results = {}
    for (const segment of segments) {
      results[segment] = await this._refreshSegment(segment, { force, trigger })
    }
    return results
  }

  async _refreshSegment(segment, { force = false, trigger = 'manual' } = {}) {
    const record = await this._readRecord(segment, { allowMemory: false })
    const currentCount = Array.isArray(record?.models) ? record.models.length : 0

    if (!force) {
      if (this._isFresh(record)) {
        return { segment, updated: false, reason: 'fresh', count: currentCount }
      }
      if (!this._canRetry(record)) {
        return { segment, updated: false, reason: 'retry-throttled', count: currentCount }
      }
    }

    const token = crypto.randomBytes(8).toString('hex')
    const locked = await this._acquireLock(token)
    if (!locked) {
      return { segment, updated: false, reason: 'locked', count: currentCount }
    }

    try {
      if (force) {
        this._clearUpstreamCache(segment)
      }

      const attemptAt = new Date().toISOString()
      let models = null
      let failure = null

      try {
        models = await this._fetchUpstream(segment)
      } catch (error) {
        failure = error.message || String(error)
      }

      if (Array.isArray(models) && models.length > 0) {
        await this._writeRecord(segment, {
          models,
          count: models.length,
          source: 'upstream',
          fetchedAt: attemptAt,
          lastAttemptAt: attemptAt,
          lastError: null,
          trigger
        })
        logger.info(
          `📋 Model catalog updated (${segment}): ${models.length} models, trigger=${trigger}`
        )
        return { segment, updated: true, reason: 'upstream', count: models.length }
      }

      // stale-while-error：失败不清空旧清单，只记录这次尝试
      const reason = failure || 'upstream returned no usable models'
      await this._writeRecord(segment, {
        ...(record || {}),
        models: record?.models || [],
        count: currentCount,
        source: record?.source || null,
        fetchedAt: record?.fetchedAt || null,
        lastAttemptAt: attemptAt,
        lastError: reason,
        trigger
      })
      logger.warn(
        `⚠️ Model catalog refresh failed (${segment}): ${reason}; keeping ${currentCount} cached model(s)`
      )
      return { segment, updated: false, reason: 'failed', error: reason, count: currentCount }
    } finally {
      await this._releaseLock(token)
    }
  }

  /**
   * 管理台用：每段的清单元信息（不含完整模型数组）
   */
  async getStatus() {
    const status = {}
    for (const segment of SEGMENTS) {
      const record = await this._readRecord(segment, { allowMemory: false })
      const fetchedAt = parseTimestamp(record?.fetchedAt)
      status[segment] = {
        count: Array.isArray(record?.models) ? record.models.length : 0,
        source: record?.source || 'fallback',
        fetchedAt: record?.fetchedAt || null,
        ageMs: fetchedAt > 0 ? Date.now() - fetchedAt : null,
        fresh: this._isFresh(record),
        lastAttemptAt: record?.lastAttemptAt || null,
        lastError: record?.lastError || null,
        trigger: record?.trigger || null
      }
    }
    status.successTtlMs = this.successTtlMs
    status.failureRetryMs = this.failureRetryMs
    return status
  }

  /**
   * 管理台用：完整清单（含模型数组）
   */
  async getCatalog() {
    const catalog = {}
    for (const segment of SEGMENTS) {
      const record = await this._readRecord(segment, { allowMemory: false })
      catalog[segment] = record || null
    }
    return catalog
  }

  // 测试用：清掉进程内 L1
  clearMemoryCache() {
    this._memory.clear()
  }
}

module.exports = new ModelCatalogService()
