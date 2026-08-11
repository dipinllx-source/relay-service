/**
 * 🔁 Metadata Sync (Redis → SQLite)
 *
 * 将 Redis 中的全部账户与 API Key 实体持续同步（对账）到 SQLite，使 SQLite 成为
 * 承载全部元数据的权威持久层（含备份/灾备价值）。
 *
 * 设计：
 *   - 启动时全量回填 + 周期对账（默认 15s，可用 METADATA_SYNC_INTERVAL_MS 调整）。
 *   - 覆盖全部 11 类账户前缀 + apikey:*；账户 id 以 Redis key 的 UUID 为权威。
 *   - 含删除对账：SQLite 中存在、Redis 中已不存在的实体会被移除。
 *   - bedrock 账户在 Redis 中以 JSON 字符串（client.set）存储，单独走 get+parse。
 *   - 仅在 metadata.backend === 'sqlite' 时启用。
 *   - 单实体错误被隔离，不影响整体同步。读热路径不受影响（Redis 仍为运行时缓存）。
 */

const redis = require('../models/redis')
const logger = require('../utils/logger')
const config = require('../../config/config')

// [prefix, sqlitePlatform, storageType]
const ACCOUNT_GROUPS = [
  ['claude:account:', 'claude', 'hash'],
  ['claude_console_account:', 'claude-console', 'hash'],
  ['gemini_account:', 'gemini', 'hash'],
  ['gemini_api_account:', 'gemini-api', 'hash'],
  ['openai:account:', 'openai', 'hash'],
  ['openai_responses_account:', 'openai-responses', 'hash'],
  ['openai_compatible_account:', 'openai-compatible', 'hash'],
  ['azure_openai:account:', 'azure-openai', 'hash'],
  ['ccr_account:', 'ccr', 'hash'],
  ['bedrock_account:', 'bedrock', 'string'],
  ['droid:account:', 'droid', 'hash']
]

function isEntityKey(fullKey, prefix) {
  const rest = fullKey.slice(prefix.length)
  if (!rest || rest.includes(':')) {
    return false
  }
  if (rest === 'index' || rest === 'empty' || rest === 'hash_map') {
    return false
  }
  return true
}

let _repos = null
function getSqliteRepos() {
  if (_repos) {
    return _repos
  }
  // eslint-disable-next-line global-require
  const { getDb } = require('./sqlite')
  // eslint-disable-next-line global-require
  const SqliteAccountRepository = require('./repositories/SqliteAccountRepository')
  // eslint-disable-next-line global-require
  const SqliteApiKeyRepository = require('./repositories/SqliteApiKeyRepository')
  const db = getDb()
  _repos = {
    accountRepo: new SqliteAccountRepository(db),
    apiKeyRepo: new SqliteApiKeyRepository(db)
  }
  return _repos
}

async function reconcileAccounts(client, accountRepo) {
  const stats = { upserted: 0, removed: 0, errors: 0 }
  for (const [prefix, platform, storageType] of ACCOUNT_GROUPS) {
    let keys = []
    try {
      keys = (await client.keys(`${prefix}*`)).filter((k) => isEntityKey(k, prefix))
    } catch (e) {
      logger.warn(`metadataSync: keys(${prefix}) failed: ${e.message}`)
      continue
    }
    const liveIds = new Set()
    for (const key of keys) {
      const uuid = key.slice(prefix.length)
      try {
        let dataObj
        if (storageType === 'string') {
          const raw = await client.get(key)
          if (!raw) {
            continue
          }
          dataObj = typeof raw === 'string' ? JSON.parse(raw) : raw
        } else {
          dataObj = await client.hgetall(key)
          if (!dataObj || Object.keys(dataObj).length === 0) {
            continue
          }
        }
        // 以 Redis key 的 UUID 为权威 id
        dataObj.id = uuid
        liveIds.add(uuid)
        await accountRepo.save(platform, uuid, dataObj)
        stats.upserted++
      } catch (e) {
        stats.errors++
        logger.warn(`metadataSync: save account ${platform}/${uuid} failed: ${e.message}`)
      }
    }
    // 删除对账：SQLite 有、Redis 无
    try {
      const rows = await accountRepo.getAllByPlatform(platform)
      for (const row of rows) {
        if (row && row.id && !liveIds.has(row.id)) {
          await accountRepo.delete(platform, row.id)
          stats.removed++
        }
      }
    } catch (e) {
      logger.warn(`metadataSync: reconcile-delete ${platform} failed: ${e.message}`)
    }
  }
  return stats
}

async function reconcileApiKeys(client, apiKeyRepo) {
  const stats = { upserted: 0, removed: 0, errors: 0 }
  let keys = []
  try {
    keys = (await client.keys('apikey:*')).filter(
      (k) => k !== 'apikey:hash_map' && isEntityKey(k, 'apikey:')
    )
  } catch (e) {
    logger.warn(`metadataSync: keys(apikey:) failed: ${e.message}`)
    return stats
  }
  const liveIds = new Set()
  for (const key of keys) {
    const id = key.slice('apikey:'.length)
    try {
      const data = await client.hgetall(key)
      if (!data || Object.keys(data).length === 0) {
        continue
      }
      const hashedKey = data.apiKey || null
      liveIds.add(id)
      await apiKeyRepo.save(id, data, hashedKey)
      stats.upserted++
    } catch (e) {
      stats.errors++
      logger.warn(`metadataSync: save apikey ${id} failed: ${e.message}`)
    }
  }
  try {
    const rows = await apiKeyRepo.getAll()
    for (const row of rows) {
      if (row && row.id && !liveIds.has(row.id)) {
        await apiKeyRepo.delete(row.id)
        stats.removed++
      }
    }
  } catch (e) {
    logger.warn(`metadataSync: reconcile-delete apikeys failed: ${e.message}`)
  }
  return stats
}

let _running = false
async function reconcileAll() {
  if (_running) {
    return null
  }
  _running = true
  try {
    const client = redis.getClientSafe ? redis.getClientSafe() : redis.getClient()
    if (!client) {
      return null
    }
    const { accountRepo, apiKeyRepo } = getSqliteRepos()
    const acc = await reconcileAccounts(client, accountRepo)
    const keys = await reconcileApiKeys(client, apiKeyRepo)
    return { accounts: acc, apiKeys: keys }
  } catch (e) {
    logger.error(`metadataSync: reconcileAll failed: ${e.message}`)
    return null
  } finally {
    _running = false
  }
}

let _timer = null
function start() {
  if (config.metadata.backend !== 'sqlite') {
    logger.info('🔁 metadataSync skipped (metadata backend is not sqlite)')
    return
  }
  const intervalMs = parseInt(process.env.METADATA_SYNC_INTERVAL_MS || '15000', 10)
  // 启动全量回填
  reconcileAll()
    .then((r) => {
      if (r) {
        logger.success(
          `🔁 metadataSync initial backfill: accounts(+${r.accounts.upserted}/-${r.accounts.removed}), apiKeys(+${r.apiKeys.upserted}/-${r.apiKeys.removed})`
        )
      }
    })
    .catch(() => {})
  _timer = setInterval(() => {
    reconcileAll().catch(() => {})
  }, intervalMs)
  if (_timer.unref) {
    _timer.unref()
  }
  logger.info(`🔁 metadataSync started (Redis → SQLite every ${intervalMs}ms)`)
}

function stop() {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
}

module.exports = { start, stop, reconcileAll }
