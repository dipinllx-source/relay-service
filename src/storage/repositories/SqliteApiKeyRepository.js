'use strict'

// SqliteApiKeyRepository —— API Key 仓储的 SQLite 实现
//
// 与 Redis 实现保持相同的对外签名，内部采用 Hybrid schema：
// 核心字段走列，其余字段（20+ 个配置/限制/绑定）塞在 `data` JSON 列。
// 这样未来业务层加减字段时，SQLite 这侧零 schema 变更。

const IApiKeyRepository = require('./IApiKeyRepository')

// core 字段直接映射到 SQLite 列；其余字段进 data JSON
// STATS_FIELDS 是 flusher 原子累加的目标——它们以独立列存储
const CORE_FIELDS = new Set(['id', 'name', 'ownerUserId', 'status', 'apiKey'])
const STATS_FIELDS = new Set(['lastUsedAt', 'requestCount', 'totalCost'])

function now() {
  return Date.now()
}

function splitCoreAndData(keyData) {
  const core = {}
  const stats = {}
  const data = {}
  for (const [k, v] of Object.entries(keyData || {})) {
    if (CORE_FIELDS.has(k)) {
      core[k] = v
    } else if (STATS_FIELDS.has(k)) {
      stats[k] = v
    } else {
      data[k] = v
    }
  }
  return { core, stats, data }
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
    // 保持与 Redis 实现一致：apiKey 字段承载哈希值
    apiKey: row.hashed_key,
    name: row.name || '',
    ownerUserId: row.owner_user_id || undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    requestCount: row.request_count || 0,
    totalCost: row.total_cost || 0,
    ...data
  }
}

class SqliteApiKeyRepository extends IApiKeyRepository {
  constructor(db) {
    super()
    if (!db) {
      throw new Error('SqliteApiKeyRepository requires a better-sqlite3 database instance')
    }
    this.db = db

    this.stmts = {
      selectById: db.prepare('SELECT * FROM api_keys WHERE id = ?'),
      selectByHash: db.prepare('SELECT * FROM api_keys WHERE hashed_key = ?'),
      selectAll: db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC'),
      selectAllIds: db.prepare('SELECT id FROM api_keys'),
      insert: db.prepare(
        `INSERT INTO api_keys
           (id, hashed_key, name, owner_user_id, status, data,
            last_used_at, request_count, total_cost,
            created_at, updated_at)
         VALUES (@id, @hashed_key, @name, @owner_user_id, @status, @data,
                 @last_used_at, @request_count, @total_cost,
                 @created_at, @updated_at)`
      ),
      updateCore: db.prepare(
        `UPDATE api_keys
            SET hashed_key    = COALESCE(@hashed_key,    hashed_key),
                name          = COALESCE(@name,          name),
                owner_user_id = COALESCE(@owner_user_id, owner_user_id),
                status        = COALESCE(@status,        status),
                data          = @data,
                last_used_at  = COALESCE(@last_used_at,  last_used_at),
                request_count = COALESCE(@request_count, request_count),
                total_cost    = COALESCE(@total_cost,    total_cost),
                updated_at    = @updated_at
          WHERE id = @id`
      ),
      deleteById: db.prepare('DELETE FROM api_keys WHERE id = ?')
    }
  }

  async save(keyId, keyData, hashedKey = null) {
    const { core, stats, data } = splitCoreAndData(keyData)
    const existing = this.stmts.selectById.get(keyId)
    const effectiveHash = hashedKey || core.apiKey || (existing && existing.hashed_key)
    const ts = now()

    if (!existing) {
      if (!effectiveHash) {
        throw new Error('SqliteApiKeyRepository.save: hashedKey is required on insert')
      }
      this.stmts.insert.run({
        id: keyId,
        hashed_key: effectiveHash,
        name: core.name || '',
        owner_user_id: core.ownerUserId || null,
        status: core.status || 'active',
        data: JSON.stringify(data),
        last_used_at: stats.lastUsedAt !== undefined ? stats.lastUsedAt : null,
        request_count: stats.requestCount !== undefined ? stats.requestCount : 0,
        total_cost: stats.totalCost !== undefined ? stats.totalCost : 0,
        created_at: ts,
        updated_at: ts
      })
      return
    }

    // merge-update：data 字段级合并，保留未提供的旧字段（与 Redis hset 语义一致）
    let mergedData = {}
    try {
      mergedData = { ...JSON.parse(existing.data || '{}'), ...data }
    } catch (_err) {
      mergedData = { ...data }
    }

    this.stmts.updateCore.run({
      id: keyId,
      hashed_key: hashedKey || null,
      name: core.name || null,
      owner_user_id: core.ownerUserId || null,
      status: core.status || null,
      data: JSON.stringify(mergedData),
      last_used_at: stats.lastUsedAt !== undefined ? stats.lastUsedAt : null,
      request_count: stats.requestCount !== undefined ? stats.requestCount : null,
      total_cost: stats.totalCost !== undefined ? stats.totalCost : null,
      updated_at: ts
    })
  }

  async findById(keyId) {
    const row = this.stmts.selectById.get(keyId)
    // Redis 语义：hgetall 在不存在时返回 {}；此处保持一致
    return rowToObject(row) || {}
  }

  async findByHash(hashedKey) {
    const row = this.stmts.selectByHash.get(hashedKey)
    return rowToObject(row)
  }

  async delete(keyId) {
    const info = this.stmts.deleteById.run(keyId)
    return info.changes
  }

  async getAll() {
    const rows = this.stmts.selectAll.all()
    return rows.map((row) => rowToObject(row))
  }

  async scanIds() {
    return this.stmts.selectAllIds.all().map((row) => row.id)
  }
}

module.exports = SqliteApiKeyRepository
module.exports.splitCoreAndData = splitCoreAndData
module.exports.rowToObject = rowToObject
