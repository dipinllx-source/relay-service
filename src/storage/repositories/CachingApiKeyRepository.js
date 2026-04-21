'use strict'

// CachingApiKeyRepository —— 在 inner repository 前加一层 Redis 缓存
//
// - findByHash / findById 走 read-through：缓存未命中时回落 inner 并异步回写
// - save / delete 在写入 inner 后主动失效对应的 id 和 hash 两个缓存键
// - getAll / scanIds 全量遍历不走缓存（命中率低、TTL 后过期策略复杂）

const IApiKeyRepository = require('./IApiKeyRepository')

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

class CachingApiKeyRepository extends IApiKeyRepository {
  constructor(inner, redisClient, { ttlSec = DEFAULT_TTL_SEC } = {}) {
    super()
    if (!inner) {
      throw new Error('CachingApiKeyRepository requires an inner repository')
    }
    if (!redisClient) {
      throw new Error('CachingApiKeyRepository requires a redis client')
    }
    this.inner = inner
    this.redis = redisClient
    this.ttlSec = ttlSec
  }

  _keyByHash(hash) {
    return `apikey:cache:hash:${hash}`
  }

  _keyById(id) {
    return `apikey:cache:id:${id}`
  }

  async findByHash(hashedKey) {
    const cached = await this.redis.get(this._keyByHash(hashedKey))
    const parsed = safeParse(cached)
    if (parsed) {
      return parsed
    }
    const record = await this.inner.findByHash(hashedKey)
    if (record) {
      await this.redis.setex(this._keyByHash(hashedKey), this.ttlSec, JSON.stringify(record))
    }
    return record
  }

  async findById(keyId) {
    const cached = await this.redis.get(this._keyById(keyId))
    const parsed = safeParse(cached)
    if (parsed) {
      return parsed
    }
    const record = await this.inner.findById(keyId)
    if (record && Object.keys(record).length > 0) {
      await this.redis.setex(this._keyById(keyId), this.ttlSec, JSON.stringify(record))
    }
    return record
  }

  async save(keyId, keyData, hashedKey = null) {
    // 在写入前拿到旧 hash，用于准确失效
    const before = await this.inner.findById(keyId)
    await this.inner.save(keyId, keyData, hashedKey)
    const invalidations = new Set([this._keyById(keyId)])
    if (before && before.apiKey) {
      invalidations.add(this._keyByHash(before.apiKey))
    }
    if (hashedKey) {
      invalidations.add(this._keyByHash(hashedKey))
    }
    if (invalidations.size > 0) {
      await this.redis.del(...invalidations)
    }
  }

  async delete(keyId) {
    const before = await this.inner.findById(keyId)
    const count = await this.inner.delete(keyId)
    const invalidations = [this._keyById(keyId)]
    if (before && before.apiKey) {
      invalidations.push(this._keyByHash(before.apiKey))
    }
    await this.redis.del(...invalidations)
    return count
  }

  async getAll() {
    return this.inner.getAll()
  }

  async scanIds() {
    return this.inner.scanIds()
  }
}

module.exports = CachingApiKeyRepository
