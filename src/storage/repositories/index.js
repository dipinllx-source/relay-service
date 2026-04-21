'use strict'

// 仓储装配点——业务代码只从此处获取 Repository 实例。
// 根据 config.metadata.backend 在启动时决定采用 Redis 还是 SQLite 实现。

const config = require('../../../config/config')
const logger = require('../../utils/logger')

const RedisApiKeyRepository = require('./RedisApiKeyRepository')
const RedisAccountRepository = require('./RedisAccountRepository')
const RedisTagRepository = require('./RedisTagRepository')

let cache = null

function assembleRedis() {
  return {
    backend: 'redis',
    apiKeyRepository: new RedisApiKeyRepository(),
    accountRepository: new RedisAccountRepository(),
    tagRepository: new RedisTagRepository()
  }
}

function assembleSqlite() {
  // SQLite backend 装配：延迟 require 避免 Redis-only 部署误触 native binding 路径
  // eslint-disable-next-line global-require
  const { getDb } = require('../sqlite')
  // eslint-disable-next-line global-require
  const redis = require('../../models/redis')
  // eslint-disable-next-line global-require
  const SqliteApiKeyRepository = require('./SqliteApiKeyRepository')
  // eslint-disable-next-line global-require
  const SqliteAccountRepository = require('./SqliteAccountRepository')
  // eslint-disable-next-line global-require
  const SqliteTagRepository = require('./SqliteTagRepository')
  // eslint-disable-next-line global-require
  const CachingApiKeyRepository = require('./CachingApiKeyRepository')
  // eslint-disable-next-line global-require
  const CachingAccountRepository = require('./CachingAccountRepository')

  const db = getDb()
  const redisClient = redis.getClientSafe()

  return {
    backend: 'sqlite',
    apiKeyRepository: new CachingApiKeyRepository(new SqliteApiKeyRepository(db), redisClient),
    accountRepository: new CachingAccountRepository(new SqliteAccountRepository(db), redisClient),
    // tags 全局集合变动极少、查询主要在管理后台，不加缓存
    tagRepository: new SqliteTagRepository(db)
  }
}

function assemble() {
  const { backend } = config.metadata

  if (backend === 'sqlite') {
    try {
      const repos = assembleSqlite()
      logger.info('🗄️  repositories wired with SQLite backend (Redis used as read-through cache)')
      return repos
    } catch (err) {
      logger.error(`❌ Failed to assemble SQLite repositories: ${err.message}`)
      logger.warn('⚠️  Falling back to Redis backend — check METADATA_BACKEND / SQLITE_PATH')
      return assembleRedis()
    }
  }

  if (backend !== 'redis') {
    throw new Error(`Invalid METADATA_BACKEND="${backend}"; expected "redis" or "sqlite"`)
  }

  return assembleRedis()
}

function getRepositories() {
  if (!cache) {
    cache = assemble()
  }
  return cache
}

function resetRepositories() {
  cache = null
}

module.exports = {
  getRepositories,
  resetRepositories
}
