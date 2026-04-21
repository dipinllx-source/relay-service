'use strict'

// CachingAccountRepository —— 在 inner repository 前加一层 Redis 缓存

const IAccountRepository = require('./IAccountRepository')

const DEFAULT_TTL_SEC = 60

function safeParse(s) {
  if (!s) {
    return null
  }
  try {
    return JSON.parse(s)
  } catch (_err) {
    return null
  }
}

class CachingAccountRepository extends IAccountRepository {
  constructor(inner, redisClient, { ttlSec = DEFAULT_TTL_SEC } = {}) {
    super()
    if (!inner) {
      throw new Error('CachingAccountRepository requires an inner repository')
    }
    if (!redisClient) {
      throw new Error('CachingAccountRepository requires a redis client')
    }
    this.inner = inner
    this.redis = redisClient
    this.ttlSec = ttlSec
  }

  _cacheKey(platform, id) {
    return `account:cache:${platform}:${id}`
  }

  async save(platform, accountId, accountData) {
    await this.inner.save(platform, accountId, accountData)
    await this.redis.del(this._cacheKey(platform, accountId))
  }

  async findById(platform, accountId) {
    const k = this._cacheKey(platform, accountId)
    const cached = await this.redis.get(k)
    const parsed = safeParse(cached)
    if (parsed) {
      return parsed
    }
    const record = await this.inner.findById(platform, accountId)
    if (record && Object.keys(record).length > 0) {
      await this.redis.setex(k, this.ttlSec, JSON.stringify(record))
    }
    return record
  }

  async getAllByPlatform(platform) {
    // 全量遍历不缓存
    return this.inner.getAllByPlatform(platform)
  }

  async delete(platform, accountId) {
    const count = await this.inner.delete(platform, accountId)
    await this.redis.del(this._cacheKey(platform, accountId))
    return count
  }
}

module.exports = CachingAccountRepository
