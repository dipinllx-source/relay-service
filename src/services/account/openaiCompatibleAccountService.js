/**
 * OpenAI-Compatible 账户服务
 * 管理「通用 OpenAI Chat Completions 兼容」账号（baseUrl + Bearer apiKey + defaultModel + modelMapping）
 * 用于 Claude Code（Anthropic Messages）→ GPT（Chat Completions）适配链路
 * 存储与加密模式对齐 openaiResponsesAccountService.js（直连 Redis）
 */

const { v4: uuidv4 } = require('uuid')
const crypto = require('crypto')
const redis = require('../../models/redis')
const logger = require('../../utils/logger')
const config = require('../../../config/config')
const LRUCache = require('../../utils/lruCache')

class OpenAICompatibleAccountService {
  constructor() {
    this.ENCRYPTION_ALGORITHM = 'aes-256-cbc'
    this.ENCRYPTION_SALT = 'openai-compatible-salt'

    this.ACCOUNT_KEY_PREFIX = 'openai_compatible_account:'
    this.ACCOUNT_INDEX_KEY = 'openai_compatible_account:index'
    this.SHARED_ACCOUNTS_KEY = 'shared_openai_compatible_accounts'

    this._encryptionKeyCache = null
    this._decryptCache = new LRUCache(500)

    setInterval(
      () => {
        this._decryptCache.cleanup()
      },
      10 * 60 * 1000
    )
  }

  // 创建账户
  async createAccount(options = {}) {
    const {
      name = 'OpenAI Compatible Account',
      description = '',
      baseUrl = '', // 必填：兼容端点基础地址，如 https://api.openai.com
      apiKey = '', // 必填：Bearer 密钥
      defaultModel = '', // 当请求未命中映射/覆盖时使用的目标 GPT 模型
      modelMapping = null, // 可选：{ 'claude-*': 'gpt-*' }
      priority = 50,
      proxy = null,
      isActive = true,
      accountType = 'shared',
      schedulable = true,
      rateLimitDuration = 60
    } = options

    if (!baseUrl || !apiKey) {
      throw new Error('Base URL and API Key are required for OpenAI-Compatible account')
    }

    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
    const accountId = uuidv4()

    const accountData = {
      id: accountId,
      platform: 'openai-compatible',
      name,
      description,
      baseUrl: normalizedBaseUrl,
      apiKey: this._encryptSensitiveData(apiKey),
      defaultModel,
      modelMapping: modelMapping ? JSON.stringify(modelMapping) : '',
      priority: priority.toString(),
      proxy: proxy ? JSON.stringify(proxy) : '',
      isActive: isActive.toString(),
      accountType,
      schedulable: schedulable.toString(),
      createdAt: new Date().toISOString(),
      lastUsedAt: '',
      status: 'active',
      errorMessage: '',
      rateLimitedAt: '',
      rateLimitStatus: '',
      rateLimitDuration: rateLimitDuration.toString()
    }

    await this._saveAccount(accountId, accountData)
    logger.success(`Created OpenAI-Compatible account: ${name} (${accountId})`)

    return { ...accountData, apiKey: '***' }
  }

  // 获取账户（解密 apiKey、解析 JSON 字段）
  async getAccount(accountId) {
    const client = redis.getClientSafe()
    const key = `${this.ACCOUNT_KEY_PREFIX}${accountId}`
    const accountData = await client.hgetall(key)

    if (!accountData || !accountData.id) {
      return null
    }

    accountData.apiKey = this._decryptSensitiveData(accountData.apiKey)
    accountData.proxy = this._parseJson(accountData.proxy, null)
    accountData.modelMapping = this._parseJson(accountData.modelMapping, null)

    return accountData
  }

  // 更新账户
  async updateAccount(accountId, updates) {
    const account = await this.getAccount(accountId)
    if (!account) {
      throw new Error('Account not found')
    }

    if (updates.apiKey) {
      updates.apiKey = this._encryptSensitiveData(updates.apiKey)
    }
    if (updates.proxy !== undefined) {
      updates.proxy = updates.proxy ? JSON.stringify(updates.proxy) : ''
    }
    if (updates.modelMapping !== undefined) {
      updates.modelMapping = updates.modelMapping ? JSON.stringify(updates.modelMapping) : ''
    }
    if (updates.baseUrl) {
      updates.baseUrl = updates.baseUrl.endsWith('/')
        ? updates.baseUrl.slice(0, -1)
        : updates.baseUrl
    }

    const client = redis.getClientSafe()
    const key = `${this.ACCOUNT_KEY_PREFIX}${accountId}`
    await client.hset(key, updates)

    // accountType 变更时同步共享集合
    if (updates.accountType) {
      if (updates.accountType === 'shared') {
        await client.sadd(this.SHARED_ACCOUNTS_KEY, accountId)
      } else {
        await client.srem(this.SHARED_ACCOUNTS_KEY, accountId)
      }
    }

    logger.info(`📝 Updated OpenAI-Compatible account: ${account.name}`)
    return { success: true }
  }

  // 删除账户
  async deleteAccount(accountId) {
    const client = redis.getClientSafe()
    const key = `${this.ACCOUNT_KEY_PREFIX}${accountId}`

    await client.srem(this.SHARED_ACCOUNTS_KEY, accountId)
    await redis.removeFromIndex(this.ACCOUNT_INDEX_KEY, accountId)
    await client.del(key)

    logger.info(`🗑️ Deleted OpenAI-Compatible account: ${accountId}`)
    return { success: true }
  }

  // 获取所有账户（隐藏敏感信息）
  async getAllAccounts(includeInactive = false) {
    const client = redis.getClientSafe()

    const accountIds = await redis.getAllIdsByIndex(
      this.ACCOUNT_INDEX_KEY,
      `${this.ACCOUNT_KEY_PREFIX}*`,
      /^openai_compatible_account:(.+)$/
    )
    if (accountIds.length === 0) {
      return []
    }

    const keys = accountIds.map((id) => `${this.ACCOUNT_KEY_PREFIX}${id}`)
    const pipeline = client.pipeline()
    keys.forEach((key) => pipeline.hgetall(key))
    const results = await pipeline.exec()

    const accounts = []
    results.forEach(([err, accountData]) => {
      if (err || !accountData || !accountData.id) {
        return
      }
      if (!includeInactive && accountData.isActive !== 'true') {
        return
      }

      accountData.apiKey = '***'
      accountData.proxy = this._parseJson(accountData.proxy, null)
      accountData.modelMapping = this._parseJson(accountData.modelMapping, null)
      accountData.schedulable = accountData.schedulable !== 'false'
      accountData.isActive = accountData.isActive === 'true'
      accountData.platform = accountData.platform || 'openai-compatible'

      accounts.push(accountData)
    })

    return accounts
  }

  // 记录最近使用时间
  async updateAccountUsage(accountId) {
    const client = redis.getClientSafe()
    const key = `${this.ACCOUNT_KEY_PREFIX}${accountId}`
    await client.hset(key, { lastUsedAt: new Date().toISOString() })
  }

  // 标记账户限流（防止继续被调度）
  async markAccountRateLimited(accountId, duration = null) {
    const account = await this.getAccount(accountId)
    if (!account) {
      return
    }
    const rateLimitDuration = duration || parseInt(account.rateLimitDuration, 10) || 60
    const now = new Date()
    const resetAt = new Date(now.getTime() + rateLimitDuration * 60000)

    await this.updateAccount(accountId, {
      rateLimitedAt: now.toISOString(),
      rateLimitStatus: 'limited',
      status: 'rateLimited',
      schedulable: 'false',
      errorMessage: `Rate limited until ${resetAt.toISOString()}`
    })
    logger.warn(
      `⏳ OpenAI-Compatible account ${account.name} rate limited for ${rateLimitDuration}min`
    )
  }

  // ---------- 私有 ----------

  _parseJson(value, fallback) {
    if (!value) {
      return fallback
    }
    try {
      return JSON.parse(value)
    } catch (e) {
      return fallback
    }
  }

  async _saveAccount(accountId, accountData) {
    const client = redis.getClientSafe()
    const key = `${this.ACCOUNT_KEY_PREFIX}${accountId}`

    await client.hset(key, accountData)
    await redis.addToIndex(this.ACCOUNT_INDEX_KEY, accountId)
    if (accountData.accountType === 'shared') {
      await client.sadd(this.SHARED_ACCOUNTS_KEY, accountId)
    }
  }

  _encryptSensitiveData(text) {
    if (!text) {
      return ''
    }
    const key = this._getEncryptionKey()
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, key, iv)
    let encrypted = cipher.update(text)
    encrypted = Buffer.concat([encrypted, cipher.final()])
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`
  }

  _decryptSensitiveData(text) {
    if (!text || text === '') {
      return ''
    }
    const cacheKey = crypto.createHash('sha256').update(text).digest('hex')
    const cached = this._decryptCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }
    try {
      const key = this._getEncryptionKey()
      const [ivHex, encryptedHex] = text.split(':')
      const iv = Buffer.from(ivHex, 'hex')
      const encryptedText = Buffer.from(encryptedHex, 'hex')
      const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, key, iv)
      let decrypted = decipher.update(encryptedText)
      decrypted = Buffer.concat([decrypted, decipher.final()])
      const result = decrypted.toString()
      this._decryptCache.set(cacheKey, result, 5 * 60 * 1000)
      return result
    } catch (error) {
      logger.error('OpenAI-Compatible decryption error:', error)
      return ''
    }
  }

  _getEncryptionKey() {
    if (!this._encryptionKeyCache) {
      this._encryptionKeyCache = crypto.scryptSync(
        config.security.encryptionKey,
        this.ENCRYPTION_SALT,
        32
      )
    }
    return this._encryptionKeyCache
  }
}

module.exports = new OpenAICompatibleAccountService()
