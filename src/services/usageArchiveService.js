'use strict'

// UsageArchiveService —— 把 Redis 中按日累计的 usage hash 归档到 SQLite usage_daily
//
// 归档粒度：(keyId, model, date)。数据源：
//   - 索引：SET  usage:keymodel:daily:index:{date}  → `${keyId}:${model}` 列表
//   - 明细：HASH usage:{keyId}:model:daily:{date}:{model}
//           字段 requests / inputTokens / outputTokens / realCostMicro / ratedCostMicro
//
// 目标表 usage_daily 的主键 (scope, id, model, date) 决定幂等：
//   INSERT OR REPLACE 重复执行结果一致，可安全补跑。

const REQUIRED_LOGGER_METHODS = ['info', 'warn', 'error']

function toInt(x) {
  const n = Number.parseInt(x, 10)
  return Number.isFinite(n) ? n : 0
}

class UsageArchiveService {
  constructor({ db, redisClient, logger }) {
    if (!db) {
      throw new Error('UsageArchiveService requires a db')
    }
    if (!redisClient) {
      throw new Error('UsageArchiveService requires a redis client')
    }
    if (!logger || REQUIRED_LOGGER_METHODS.some((m) => typeof logger[m] !== 'function')) {
      throw new Error('UsageArchiveService requires a logger with info/warn/error')
    }
    this.db = db
    this.redis = redisClient
    this.logger = logger

    this.lastSuccessAt = null
    this.lastErrorAt = null
    this.lastErrorMessage = null

    this.upsertStmt = db.prepare(
      `INSERT OR REPLACE INTO usage_daily
         (scope, id, model, date, request_count, input_tokens, output_tokens, cost)
       VALUES ('apikey', @id, @model, @date, @request_count, @input_tokens, @output_tokens, @cost)`
    )
  }

  async archiveDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(
        `UsageArchiveService.archiveDate: invalid date format "${date}" (expect YYYY-MM-DD)`
      )
    }
    const indexKey = `usage:keymodel:daily:index:${date}`
    const members = await this.redis.smembers(indexKey)
    if (!members || members.length === 0) {
      this.lastSuccessAt = Date.now()
      return { date, archived: 0 }
    }

    const pipeline = this.redis.pipeline()
    for (const m of members) {
      const sep = m.indexOf(':')
      if (sep <= 0) {
        continue
      }
      const keyId = m.slice(0, sep)
      const model = m.slice(sep + 1)
      pipeline.hgetall(`usage:${keyId}:model:daily:${date}:${model}`)
    }
    const results = await pipeline.exec()

    const rows = []
    let ri = 0
    for (const m of members) {
      const sep = m.indexOf(':')
      if (sep <= 0) {
        continue
      }
      const keyId = m.slice(0, sep)
      const model = m.slice(sep + 1)
      const [err, hash] = results[ri] || [new Error('pipeline out of range'), null]
      ri += 1
      if (err || !hash) {
        continue
      }
      const requestCount = toInt(hash.requests)
      const inputTokens = toInt(hash.inputTokens)
      const outputTokens = toInt(hash.outputTokens)
      const realMicro = toInt(hash.realCostMicro)
      const ratedMicro = toInt(hash.ratedCostMicro)
      // 优先使用真实成本；回退到基于定价的成本
      const costMicro = realMicro > 0 ? realMicro : ratedMicro
      rows.push({
        id: keyId,
        model,
        date,
        request_count: requestCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost: costMicro / 1e6
      })
    }

    if (rows.length === 0) {
      this.lastSuccessAt = Date.now()
      return { date, archived: 0 }
    }

    const apply = this.db.transaction((items) => {
      for (const r of items) {
        this.upsertStmt.run(r)
      }
    })
    try {
      apply(rows)
      this.lastSuccessAt = Date.now()
      this.logger.info(`📊 usage archive: ${date} — ${rows.length} rows persisted`)
      return { date, archived: rows.length }
    } catch (err) {
      this.lastErrorAt = Date.now()
      this.lastErrorMessage = err.message
      this.logger.error(`usage archive for ${date} failed: ${err.stack || err.message}`)
      throw err
    }
  }

  async archivePastDays(n, referenceDate = null) {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error('archivePastDays: n must be a positive integer')
    }
    const results = []
    const base = referenceDate ? new Date(`${referenceDate}T00:00:00Z`) : new Date()
    for (let i = 1; i <= n; i += 1) {
      const d = new Date(base.getTime())
      d.setUTCDate(d.getUTCDate() - i)
      const yyyy = d.getUTCFullYear()
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(d.getUTCDate()).padStart(2, '0')
      const dateStr = `${yyyy}-${mm}-${dd}`
      try {
        // eslint-disable-next-line no-await-in-loop
        results.push(await this.archiveDate(dateStr))
      } catch (err) {
        results.push({ date: dateStr, archived: 0, error: err.message })
      }
    }
    return results
  }

  async archiveYesterday() {
    const [first] = await this.archivePastDays(1)
    return first
  }

  status() {
    return {
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage
    }
  }
}

module.exports = UsageArchiveService
