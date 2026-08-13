/**
 * 🗄️ Backup Service
 *
 * 为「存储健康」页面提供备份的 Web 端导出/导入能力。
 * 范围：API Keys + 各类账户 + tags + 管理员凭据。
 * 密钥策略：保留加密形态（原样导出/导入，与当前 encryptionKey 绑定，同环境可直接恢复）。
 * 导入策略：跳过冲突（已存在的 key 不覆盖）。
 *
 * 实体类型（v2.1）：账户实体按 storageType 分流——
 *   - hash（10 类）：hgetall 导出为 { __key, ...fields }，导入 hset 写回
 *   - string（bedrock）：get 导出为 { __key, __type: 'string', value }，导入 set 写回
 * storageType 表与 src/storage/metadataSync.js 的 ACCOUNT_GROUPS 保持一致。
 * 单实体读写失败被隔离（warn + errors 计数），不会使整个导出/导入失败。
 *
 * SQLite 贯通：METADATA_BACKEND=sqlite 时导入完成后同步触发一次
 * metadataSync.reconcileAll()，使还原数据立即落入 SQLite；随后清理各索引
 * 的 :empty 空标记与 read-through 缓存键（account:cache:* / apikey:cache:*）。
 */

const fs = require('fs')
const path = require('path')
const redis = require('../models/redis')
const logger = require('../utils/logger')
const config = require('../../config/config')

const BACKUP_VERSION = '2.1'

// 需要备份的「账户类」实体前缀（与各账户服务 ACCOUNT_KEY_PREFIX 保持一致）
// storageType 与 src/storage/metadataSync.js 逐字对齐：
//   hash   → 实体为 Redis hash（hgetall / hset）
//   string → 实体为 JSON 字符串（get / set），目前仅 bedrock
const ACCOUNT_GROUPS = [
  { name: 'claude', prefix: 'claude:account:', storageType: 'hash' },
  { name: 'claudeConsole', prefix: 'claude_console_account:', storageType: 'hash' },
  { name: 'gemini', prefix: 'gemini_account:', storageType: 'hash' },
  { name: 'geminiApi', prefix: 'gemini_api_account:', storageType: 'hash' },
  { name: 'openai', prefix: 'openai:account:', storageType: 'hash' },
  { name: 'openaiResponses', prefix: 'openai_responses_account:', storageType: 'hash' },
  { name: 'openaiCompatible', prefix: 'openai_compatible_account:', storageType: 'hash' },
  { name: 'azureOpenai', prefix: 'azure_openai:account:', storageType: 'hash' },
  { name: 'ccr', prefix: 'ccr_account:', storageType: 'hash' },
  { name: 'bedrock', prefix: 'bedrock_account:', storageType: 'string' },
  { name: 'droid', prefix: 'droid:account:', storageType: 'hash' }
]

// 判断某个 key 是否为「实体 key」而非派生/索引/运行时 key。
// 实体 key 形如 `${prefix}${uuid}`，去掉前缀后不应再包含冒号，且不是 index/empty 等保留名。
function isEntityKey(fullKey, prefix) {
  const rest = fullKey.slice(prefix.length)
  if (!rest) {
    return false
  }
  if (rest.includes(':')) {
    return false
  }
  if (rest === 'index' || rest === 'empty' || rest === 'hash_map') {
    return false
  }
  return true
}

async function scanEntityKeys(client, prefix) {
  const all = await client.keys(`${prefix}*`)
  return all.filter((k) => isEntityKey(k, prefix))
}

// 读取一组实体（按 storageType 分流），单实体失败隔离。
// 返回 { items, errors }：
//   hash   → { __key, ...fields }
//   string → { __key, __type: 'string', value }
async function dumpEntityGroup(client, keys, storageType) {
  const items = []
  let errors = 0
  for (const key of keys) {
    try {
      if (storageType === 'string') {
        // eslint-disable-next-line no-await-in-loop
        const value = await client.get(key)
        if (value !== null && value !== undefined && value !== '') {
          items.push({ __key: key, __type: 'string', value })
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        const data = await client.hgetall(key)
        if (data && Object.keys(data).length > 0) {
          items.push({ __key: key, ...data })
        }
      }
    } catch (e) {
      errors++
      logger.warn(`backup export: dump ${key} (${storageType}) failed: ${e.message}`)
    }
  }
  return { items, errors }
}

/**
 * 导出全部备份数据（保留加密形态，不脱敏）。
 * @param {Object} opts { includeApiKeys, includeAccounts, includeAdmins }
 */
async function exportBackup(opts = {}) {
  const includeApiKeys = opts.includeApiKeys !== false
  const includeAccounts = opts.includeAccounts !== false
  const includeAdmins = opts.includeAdmins !== false

  const client = redis.getClient()
  if (!client) {
    throw new Error('Redis client unavailable')
  }

  const backup = {
    metadata: {
      version: BACKUP_VERSION,
      exportDate: new Date().toISOString(),
      sanitized: false,
      generatedBy: 'web',
      backend: config.metadata.backend,
      scope: { apiKeys: includeApiKeys, accounts: includeAccounts, admins: includeAdmins }
    },
    data: {},
    errors: { apiKeys: 0, accounts: 0, tags: 0 }
  }

  // API Keys（包含 apikey:hash_map 以保证哈希映射可用）
  if (includeApiKeys) {
    const allApiKeys = await client.keys('apikey:*')
    const entityKeys = allApiKeys.filter(
      (k) => k === 'apikey:hash_map' || isEntityKey(k, 'apikey:')
    )
    const { items, errors } = await dumpEntityGroup(client, entityKeys, 'hash')
    backup.data.apiKeys = items
    backup.errors.apiKeys += errors

    // tags：全局 tag 集合 + 每个 tag 的 keyId 索引集合
    const tags = { all: [], byTag: {} }
    try {
      tags.all = await client.smembers('apikey:tags:all')
      for (const tag of tags.all) {
        try {
          // eslint-disable-next-line no-await-in-loop
          tags.byTag[tag] = await client.smembers(`apikey:tag:${tag}`)
        } catch (e) {
          backup.errors.tags++
          logger.warn(`backup export: dump apikey:tag:${tag} failed: ${e.message}`)
        }
      }
    } catch (e) {
      backup.errors.tags++
      logger.warn(`backup export: dump apikey:tags:all failed: ${e.message}`)
    }
    backup.data.tags = tags
  }

  // 账户（各类型，按 storageType 分流）
  if (includeAccounts) {
    backup.data.accounts = {}
    for (const group of ACCOUNT_GROUPS) {
      // eslint-disable-next-line no-await-in-loop
      const keys = await scanEntityKeys(client, group.prefix)
      // eslint-disable-next-line no-await-in-loop
      const { items, errors } = await dumpEntityGroup(client, keys, group.storageType)
      backup.data.accounts[group.name] = items
      backup.errors.accounts += errors
    }
  }

  // 管理员凭据：真实源为 data/init.json，运行时缓存为 session:admin_credentials
  if (includeAdmins) {
    const admins = { initJson: null, sessionCredentials: null }
    try {
      const initPath = path.join(__dirname, '../../data/init.json')
      if (fs.existsSync(initPath)) {
        admins.initJson = JSON.parse(fs.readFileSync(initPath, 'utf8'))
      }
    } catch (e) {
      logger.warn(`backup: read init.json failed: ${e.message}`)
    }
    try {
      const cred = await client.hgetall('session:admin_credentials')
      if (cred && Object.keys(cred).length > 0) {
        admins.sessionCredentials = cred
      }
    } catch (e) {
      logger.warn(`backup: read admin_credentials failed: ${e.message}`)
    }
    backup.data.admins = admins
  }

  return backup
}

/**
 * 导入备份（跳过冲突：已存在的 key/凭据不覆盖）。
 * 兼容 2.0（无 __type，全按 hash）与 2.1（string 实体带 __type）。
 * @returns {Object} 统计信息
 */
async function importBackup(backup, _opts = {}) {
  if (!backup || typeof backup !== 'object' || !backup.metadata || !backup.data) {
    throw new Error('Invalid backup file format')
  }
  if (backup.metadata.sanitized) {
    throw new Error('Backup is sanitized (secrets redacted); cannot be used to restore')
  }

  const client = redis.getClient()
  if (!client) {
    throw new Error('Redis client unavailable')
  }

  const stats = {
    apiKeys: { imported: 0, skipped: 0, errors: 0 },
    accounts: { imported: 0, skipped: 0, errors: 0 },
    tags: { imported: 0, skipped: 0, errors: 0 },
    admins: { imported: 0, skipped: 0, errors: 0 }
  }

  // 通用：写回一组实体（跳过已存在；按 __type 分流写入方式）
  async function restoreEntityItems(items, bucket) {
    if (!Array.isArray(items)) {
      return
    }
    for (const item of items) {
      const key = item && item.__key
      if (!key || typeof key !== 'string') {
        bucket.errors++
        continue
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const exists = await client.exists(key)
        if (exists) {
          bucket.skipped++
          continue
        }
        if (item.__type === 'string') {
          // string 实体（bedrock）：value 必须是 JSON 字符串，set 原样写回
          if (typeof item.value !== 'string' || !item.value) {
            bucket.errors++
            logger.warn(`backup import: string entity ${key} has invalid value`)
            continue
          }
          // eslint-disable-next-line no-await-in-loop
          await client.set(key, item.value)
        } else {
          const fields = {}
          for (const [k, v] of Object.entries(item)) {
            if (k === '__key' || k === '__type') {
              continue
            }
            fields[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v
          }
          if (Object.keys(fields).length === 0) {
            bucket.skipped++
            continue
          }
          // eslint-disable-next-line no-await-in-loop
          await client.hset(key, fields)
        }
        bucket.imported++
      } catch (e) {
        logger.error(`backup import: failed for ${key}: ${e.message}`)
        bucket.errors++
      }
    }
  }

  // API Keys
  if (backup.data.apiKeys) {
    await restoreEntityItems(backup.data.apiKeys, stats.apiKeys)
  }

  // tags：set 天然幂等，按成员合并写回（已在集合中的成员计 skipped）
  if (backup.data.tags && typeof backup.data.tags === 'object') {
    const { all, byTag } = backup.data.tags
    if (Array.isArray(all)) {
      for (const tag of all) {
        if (typeof tag !== 'string' || !tag) {
          stats.tags.errors++
          continue
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          const added = await client.sadd('apikey:tags:all', tag)
          if (added > 0) {
            stats.tags.imported++
          } else {
            stats.tags.skipped++
          }
          const members = byTag && Array.isArray(byTag[tag]) ? byTag[tag] : []
          if (members.length > 0) {
            // eslint-disable-next-line no-await-in-loop
            await client.sadd(`apikey:tag:${tag}`, members)
          }
        } catch (e) {
          stats.tags.errors++
          logger.error(`backup import: tag ${tag} failed: ${e.message}`)
        }
      }
    }
  }

  // 账户
  if (backup.data.accounts && typeof backup.data.accounts === 'object') {
    for (const group of ACCOUNT_GROUPS) {
      // eslint-disable-next-line no-await-in-loop
      await restoreEntityItems(backup.data.accounts[group.name], stats.accounts)
    }
  }

  // 管理员：跳过冲突——仅当当前无管理员凭据时才恢复
  if (backup.data.admins) {
    try {
      const existing = await client.hgetall('session:admin_credentials')
      const hasExisting = existing && Object.keys(existing).length > 0
      const initPath = path.join(__dirname, '../../data/init.json')
      const initExists = fs.existsSync(initPath)

      if (hasExisting || initExists) {
        // 已存在管理员 → 跳过（不覆盖）
        stats.admins.skipped++
      } else {
        if (backup.data.admins.initJson) {
          fs.writeFileSync(initPath, JSON.stringify(backup.data.admins.initJson, null, 2), {
            mode: 0o600
          })
        }
        if (backup.data.admins.sessionCredentials) {
          await client.hset('session:admin_credentials', backup.data.admins.sessionCredentials)
        }
        stats.admins.imported++
      }
    } catch (e) {
      logger.error(`backup import: admin restore failed: ${e.message}`)
      stats.admins.errors++
    }
  }

  // ── SQLite 贯通 + 索引/缓存清理 ─────────────────────────────────────
  // backend=sqlite 时立即对账落库；失败必须显式抛出（数据未落 SQLite 不能静默成功）。
  // reconcileAll 在定时轮正在运行时返回 null（互斥），短暂等待重试。
  if (config.metadata.backend === 'sqlite') {
    // eslint-disable-next-line global-require
    const metadataSync = require('../storage/metadataSync')
    let result = null
    for (let attempt = 1; attempt <= 3 && !result; attempt++) {
      result = await metadataSync.reconcileAll()
      if (!result && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
    if (!result) {
      throw new Error(
        'backup import: metadataSync.reconcileAll() did not complete (SQLite may be out of sync); ' +
          'data is in Redis and will be reconciled by the periodic sync'
      )
    }
    logger.info('📥 backup import: metadataSync.reconcileAll() completed (SQLite in sync)')
  }

  // 清理索引空标记（还原前可能被 getAllIdsByIndex 打上 <index>:empty，TTL 1h）
  try {
    const emptyMarkers = ACCOUNT_GROUPS.map((g) => `${g.prefix}index:empty`)
    emptyMarkers.push('apikey:index:empty')
    emptyMarkers.push('apikey:index:version') // 触发 apiKeyIndexService 下次校验时重建
    await client.del(...emptyMarkers)
  } catch (e) {
    logger.warn(`backup import: clear index empty markers failed: ${e.message}`)
  }

  // 失效 read-through 缓存（account:cache:* / apikey:cache:*，TTL 60s，主动清理避免读旧值）
  try {
    for (const pattern of ['account:cache:*', 'apikey:cache:*']) {
      let cursor = '0'
      do {
        // eslint-disable-next-line no-await-in-loop
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
        cursor = next
        if (keys.length > 0) {
          // eslint-disable-next-line no-await-in-loop
          await client.del(...keys)
        }
      } while (cursor !== '0')
    }
  } catch (e) {
    logger.warn(`backup import: invalidate read-through cache failed: ${e.message}`)
  }

  return stats
}

// 统计各分组条目数（用于导出摘要 / UI 展示）
function summarize(backup) {
  const s = { apiKeys: 0, accounts: 0, tags: 0, admins: 0 }
  if (backup?.data?.apiKeys) {
    s.apiKeys = backup.data.apiKeys.filter((x) => x.__key !== 'apikey:hash_map').length
  }
  if (backup?.data?.accounts) {
    for (const group of ACCOUNT_GROUPS) {
      const arr = backup.data.accounts[group.name]
      if (Array.isArray(arr)) {
        s.accounts += arr.length
      }
    }
  }
  if (backup?.data?.tags && Array.isArray(backup.data.tags.all)) {
    s.tags = backup.data.tags.all.length
  }
  if (backup?.data?.admins) {
    s.admins = backup.data.admins.initJson || backup.data.admins.sessionCredentials ? 1 : 0
  }
  return s
}

module.exports = {
  BACKUP_VERSION,
  exportBackup,
  importBackup,
  summarize
}
