'use strict'

// RuntimeStatsFlusher —— 将 Redis 侧 apikey:runtime:{id} 的累计统计
// 批量回写到 SQLite api_keys 表。
//
// 流程（每次 flushOnce）：
//   1. SCAN apikey:runtime:*  → keys
//   2. pipeline HGETALL 读出 {request_count, total_cost, last_used_at}
//   3. 在单个 SQLite 事务中累加对应列
//   4. 成功后 HINCRBY 反向扣减已 flush 的增量（避免重复应用）
//
// 调用侧负责：
//   - 在进程启动后调用 start() 开启周期任务
//   - 在 SIGTERM/SIGINT 时调用 flushOnce() 同步最后一次落盘

const RUNTIME_KEY_PREFIX = 'apikey:runtime:'

function toInt(x) {
  const n = Number.parseInt(x, 10)
  return Number.isFinite(n) ? n : 0
}

function toFloat(x) {
  const n = Number.parseFloat(x)
  return Number.isFinite(n) ? n : 0
}

async function scanKeys(client, pattern) {
  const keys = []
  let cursor = '0'
  do {
    // eslint-disable-next-line no-await-in-loop
    const [next, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
    cursor = next
    keys.push(...batch)
  } while (cursor !== '0')
  return keys
}

class RuntimeStatsFlusher {
  constructor({ db, redisClient, logger, intervalSec = 30 }) {
    if (!db) {
      throw new Error('RuntimeStatsFlusher requires a better-sqlite3 db')
    }
    if (!redisClient) {
      throw new Error('RuntimeStatsFlusher requires a redis client')
    }
    if (!logger) {
      throw new Error('RuntimeStatsFlusher requires a logger')
    }
    this.db = db
    this.redis = redisClient
    this.logger = logger
    this.intervalSec = intervalSec
    this.timer = null
    this.running = false
    this.lastSuccessAt = null
    this.lastErrorAt = null
    this.lastErrorMessage = null

    this.updateStmt = db.prepare(
      `UPDATE api_keys
          SET request_count = request_count + @delta_requests,
              total_cost    = total_cost + @delta_cost,
              last_used_at  = CASE
                                WHEN last_used_at IS NULL OR last_used_at < @last_used_at
                                THEN @last_used_at
                                ELSE last_used_at
                              END,
              updated_at    = @updated_at
        WHERE id = @id`
    )
  }

  start() {
    if (this.intervalSec <= 0) {
      this.logger.info('🧮 runtime stats flusher disabled (SQLITE_STATS_FLUSH_INTERVAL=0)')
      return
    }
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => {
      this.flushOnce().catch((err) => {
        this.logger.error(`flusher tick failed: ${err.stack || err.message}`)
      })
    }, this.intervalSec * 1000)
    if (typeof this.timer.unref === 'function') {
      this.timer.unref()
    }
    this.logger.info(`🧮 runtime stats flusher started (every ${this.intervalSec}s)`)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async flushOnce() {
    if (this.running) {
      return { flushed: 0, skipped: 'busy' }
    }
    this.running = true
    try {
      const keys = await scanKeys(this.redis, `${RUNTIME_KEY_PREFIX}*`)
      if (keys.length === 0) {
        this.lastSuccessAt = Date.now()
        return { flushed: 0 }
      }

      const pipeline = this.redis.pipeline()
      keys.forEach((k) => pipeline.hgetall(k))
      const results = await pipeline.exec()

      const batches = []
      for (let i = 0; i < keys.length; i += 1) {
        const [err, data] = results[i]
        if (err || !data) {
          continue
        }
        const id = keys[i].slice(RUNTIME_KEY_PREFIX.length)
        const dr = toInt(data.request_count)
        const dc = toFloat(data.total_cost)
        const lu = toInt(data.last_used_at)
        if (dr === 0 && dc === 0 && lu === 0) {
          continue
        }
        batches.push({ id, dr, dc, lu })
      }

      if (batches.length === 0) {
        this.lastSuccessAt = Date.now()
        return { flushed: 0 }
      }

      const now = Date.now()
      const applyAll = this.db.transaction((items) => {
        for (const b of items) {
          this.updateStmt.run({
            id: b.id,
            delta_requests: b.dr,
            delta_cost: b.dc,
            last_used_at: b.lu || null,
            updated_at: now
          })
        }
      })
      applyAll(batches)

      // 成功后原子扣减 Redis 侧已 flush 的量
      const decPipeline = this.redis.pipeline()
      for (const b of batches) {
        const k = `${RUNTIME_KEY_PREFIX}${b.id}`
        if (b.dr !== 0) {
          decPipeline.hincrby(k, 'request_count', -b.dr)
        }
        if (b.dc !== 0) {
          decPipeline.hincrbyfloat(k, 'total_cost', -b.dc)
        }
      }
      await decPipeline.exec()

      this.lastSuccessAt = Date.now()
      return { flushed: batches.length }
    } catch (err) {
      this.lastErrorAt = Date.now()
      this.lastErrorMessage = err.message
      this.logger.error(`flush error: ${err.stack || err.message}`)
      throw err
    } finally {
      this.running = false
    }
  }

  status() {
    return {
      intervalSec: this.intervalSec,
      running: this.running,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage
    }
  }
}

module.exports = RuntimeStatsFlusher
module.exports.RUNTIME_KEY_PREFIX = RUNTIME_KEY_PREFIX
