'use strict'

// SqliteAccountRepository —— 10 个平台账号的统一 SQLite 仓储实现
//
// 所有平台共用 accounts 表，通过 `platform` 列区分；业务字段（credentials、
// proxy、config、platform 独有配置）均存入 `data` JSON 列，与 Redis hash
// 的字段结构 1:1 对应，camelCase 保持不变。

const IAccountRepository = require('./IAccountRepository')

const SUPPORTED_PLATFORMS = new Set([
  'claude',
  'claude-console',
  'gemini',
  'gemini-api',
  'openai',
  'openai-responses',
  'bedrock',
  'azure-openai',
  'ccr',
  'droid',
  'openai-compatible'
])

const CORE_FIELDS = new Set(['id', 'name', 'status'])

function assertPlatform(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform: ${platform}`)
  }
}

function splitCoreAndData(accountData) {
  const core = {}
  const data = {}
  for (const [k, v] of Object.entries(accountData || {})) {
    if (CORE_FIELDS.has(k)) {
      core[k] = v
    } else {
      data[k] = v
    }
  }
  return { core, data }
}

function rowToObject(row) {
  if (!row) {
    return null
  }
  let data = {}
  try {
    data = JSON.parse(row.data || '{}')
  } catch (_err) {
    data = {}
  }
  return {
    id: row.id,
    platform: row.platform,
    name: row.name || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...data
  }
}

class SqliteAccountRepository extends IAccountRepository {
  constructor(db) {
    super()
    if (!db) {
      throw new Error('SqliteAccountRepository requires a better-sqlite3 database instance')
    }
    this.db = db

    this.stmts = {
      selectById: db.prepare('SELECT * FROM accounts WHERE id = ? AND platform = ?'),
      selectByPlatform: db.prepare(
        'SELECT * FROM accounts WHERE platform = ? ORDER BY created_at DESC'
      ),
      insert: db.prepare(
        `INSERT INTO accounts
           (id, platform, name, status, data, created_at, updated_at)
         VALUES (@id, @platform, @name, @status, @data, @created_at, @updated_at)`
      ),
      update: db.prepare(
        `UPDATE accounts
            SET name       = COALESCE(@name,   name),
                status     = COALESCE(@status, status),
                data       = @data,
                updated_at = @updated_at
          WHERE id = @id AND platform = @platform`
      ),
      deleteById: db.prepare('DELETE FROM accounts WHERE id = ? AND platform = ?')
    }
  }

  async save(platform, accountId, accountData) {
    assertPlatform(platform)
    const { core, data } = splitCoreAndData(accountData)
    const existing = this.stmts.selectById.get(accountId, platform)
    const ts = Date.now()

    if (!existing) {
      this.stmts.insert.run({
        id: accountId,
        platform,
        name: core.name || '',
        status: core.status || 'active',
        data: JSON.stringify(data),
        created_at: ts,
        updated_at: ts
      })
      return
    }

    let mergedData = {}
    try {
      mergedData = { ...JSON.parse(existing.data || '{}'), ...data }
    } catch (_err) {
      mergedData = { ...data }
    }

    this.stmts.update.run({
      id: accountId,
      platform,
      name: core.name || null,
      status: core.status || null,
      data: JSON.stringify(mergedData),
      updated_at: ts
    })
  }

  async findById(platform, accountId) {
    assertPlatform(platform)
    const row = this.stmts.selectById.get(accountId, platform)
    return rowToObject(row) || {}
  }

  async getAllByPlatform(platform) {
    assertPlatform(platform)
    return this.stmts.selectByPlatform.all(platform).map((r) => rowToObject(r))
  }

  async delete(platform, accountId) {
    assertPlatform(platform)
    const info = this.stmts.deleteById.run(accountId, platform)
    return info.changes
  }
}

module.exports = SqliteAccountRepository
module.exports.SUPPORTED_PLATFORMS = SUPPORTED_PLATFORMS
