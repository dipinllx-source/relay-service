'use strict'

// SQLite DDL 与 schema 版本管理。
//
// 采取 Hybrid 存储策略：
// - 核心字段以列存在（id / hashed_key / name / owner_user_id / status / timestamps）
//   → 可建索引、可 JOIN、可用 SQL 查询
// - 其余业务字段（20+ 个细粒度配置、限制、绑定关系等）存 `data` TEXT 列，内容为
//   JSON 字符串，与当前 Redis hash 的字段结构 1:1 对应，camelCase 保持不变
//   → Repository 层零字段转换；新字段无 schema 变更
//
// 所有 CREATE 语句均幂等（IF NOT EXISTS），启动时重复执行无副作用。

const CURRENT_SCHEMA_VERSION = 1

const DDL = [
  `CREATE TABLE IF NOT EXISTS _schema_version (
     version    INTEGER PRIMARY KEY,
     applied_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS api_keys (
     id            TEXT PRIMARY KEY,
     hashed_key    TEXT NOT NULL UNIQUE,
     name          TEXT NOT NULL,
     owner_user_id TEXT,
     status        TEXT NOT NULL DEFAULT 'active',
     data          TEXT NOT NULL DEFAULT '{}',
     created_at    INTEGER NOT NULL,
     updated_at    INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_owner  ON api_keys(owner_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status)`,

  // accounts: 10 platforms (claude, claude-console, gemini, gemini-api, openai,
  // openai-responses, bedrock, azure-openai, ccr, droid) distinguished by `platform`.
  `CREATE TABLE IF NOT EXISTS accounts (
     id         TEXT PRIMARY KEY,
     platform   TEXT NOT NULL,
     name       TEXT NOT NULL,
     status     TEXT NOT NULL DEFAULT 'active',
     data       TEXT NOT NULL DEFAULT '{}',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform)`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_status   ON accounts(status)`,

  `CREATE TABLE IF NOT EXISTS tags (
     name       TEXT PRIMARY KEY,
     created_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS api_key_tags (
     api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
     tag_name   TEXT NOT NULL REFERENCES tags(name)   ON DELETE CASCADE,
     PRIMARY KEY (api_key_id, tag_name)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_api_key_tags_tag ON api_key_tags(tag_name)`,

  `CREATE TABLE IF NOT EXISTS usage_daily (
     scope         TEXT NOT NULL,
     id            TEXT NOT NULL,
     model         TEXT NOT NULL DEFAULT '',
     date          TEXT NOT NULL,
     request_count INTEGER NOT NULL DEFAULT 0,
     input_tokens  INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     cost          REAL    NOT NULL DEFAULT 0,
     PRIMARY KEY (scope, id, model, date)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_usage_daily_date  ON usage_daily(date)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_daily_scope ON usage_daily(scope, id, date)`
]

function initSchema(db) {
  const apply = db.transaction(() => {
    for (const stmt of DDL) {
      db.exec(stmt)
    }
    const row = db.prepare('SELECT MAX(version) AS v FROM _schema_version').get()
    if (!row || row.v === null || row.v < CURRENT_SCHEMA_VERSION) {
      db.prepare('INSERT OR IGNORE INTO _schema_version (version, applied_at) VALUES (?, ?)').run(
        CURRENT_SCHEMA_VERSION,
        Date.now()
      )
    }
  })
  apply()
}

function getSchemaVersion(db) {
  const row = db.prepare('SELECT MAX(version) AS v FROM _schema_version').get()
  return row && row.v !== null ? row.v : 0
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  DDL,
  initSchema,
  getSchemaVersion
}
