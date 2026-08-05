/**
 * 🗄️ Backup Service
 *
 * 为「存储健康」页面提供备份的 Web 端导出/导入能力。
 * 范围：API Keys + 各类账户 + 管理员凭据。
 * 密钥策略：保留加密形态（原样导出/导入，与当前 encryptionKey 绑定，同环境可直接恢复）。
 * 导入策略：跳过冲突（已存在的 key 不覆盖）。
 *
 * 说明：账户实体以「完整 Redis key + hash 字段」形式存储，导入时按同一 key 写回，
 * 避免脚本 data-transfer.js 中导出/导入前缀不一致的历史隐患，并覆盖全部账户类型。
 */

const fs = require('fs')
const path = require('path')
const redis = require('../models/redis')
const logger = require('../utils/logger')

const BACKUP_VERSION = '2.0'

// 需要备份的「账户类」hash 实体前缀（与各账户服务 ACCOUNT_KEY_PREFIX 保持一致）
const ACCOUNT_GROUPS = [
  { name: 'claude', prefix: 'claude:account:' },
  { name: 'claudeConsole', prefix: 'claude_console_account:' },
  { name: 'gemini', prefix: 'gemini_account:' },
  { name: 'geminiApi', prefix: 'gemini_api_account:' },
  { name: 'openai', prefix: 'openai:account:' },
  { name: 'openaiResponses', prefix: 'openai_responses_account:' },
  { name: 'openaiCompatible', prefix: 'openai_compatible_account:' },
  { name: 'azureOpenai', prefix: 'azure_openai:account:' },
  { name: 'ccr', prefix: 'ccr_account:' },
  { name: 'bedrock', prefix: 'bedrock_account:' },
  { name: 'droid', prefix: 'droid:account:' }
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

// 读取一组 hash 实体：返回 [{ __key, ...fields }]
async function dumpHashGroup(client, keys) {
  const items = []
  for (const key of keys) {
    // eslint-disable-next-line no-await-in-loop
    const data = await client.hgetall(key)
    if (data && Object.keys(data).length > 0) {
      items.push({ __key: key, ...data })
    }
  }
  return items
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
      scope: { apiKeys: includeApiKeys, accounts: includeAccounts, admins: includeAdmins }
    },
    data: {}
  }

  // API Keys（包含 apikey:hash_map 以保证哈希映射可用）
  if (includeApiKeys) {
    const allApiKeys = await client.keys('apikey:*')
    const entityKeys = allApiKeys.filter(
      (k) => k === 'apikey:hash_map' || isEntityKey(k, 'apikey:')
    )
    backup.data.apiKeys = await dumpHashGroup(client, entityKeys)
  }

  // 账户（各类型）
  if (includeAccounts) {
    backup.data.accounts = {}
    for (const group of ACCOUNT_GROUPS) {
      // eslint-disable-next-line no-await-in-loop
      const keys = await scanEntityKeys(client, group.prefix)
      // eslint-disable-next-line no-await-in-loop
      backup.data.accounts[group.name] = await dumpHashGroup(client, keys)
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
 * @returns {Object} 统计信息
 */
async function importBackup(backup, opts = {}) {
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
    admins: { imported: 0, skipped: 0, errors: 0 }
  }

  // 通用：写回一组 hash 实体（跳过已存在）
  async function restoreHashItems(items, bucket) {
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
        const fields = {}
        for (const [k, v] of Object.entries(item)) {
          if (k === '__key') {
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
        bucket.imported++
      } catch (e) {
        logger.error(`backup import: failed for ${key}: ${e.message}`)
        bucket.errors++
      }
    }
  }

  // API Keys
  if (backup.data.apiKeys) {
    await restoreHashItems(backup.data.apiKeys, stats.apiKeys)
  }

  // 账户
  if (backup.data.accounts && typeof backup.data.accounts === 'object') {
    for (const group of ACCOUNT_GROUPS) {
      // eslint-disable-next-line no-await-in-loop
      await restoreHashItems(backup.data.accounts[group.name], stats.accounts)
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
          fs.writeFileSync(
            initPath,
            JSON.stringify(backup.data.admins.initJson, null, 2),
            { mode: 0o600 }
          )
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

  return stats
}

// 统计各分组条目数（用于导出摘要 / UI 展示）
function summarize(backup) {
  const s = { apiKeys: 0, accounts: 0, admins: 0 }
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
