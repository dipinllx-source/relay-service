'use strict'

// SQLite DDL 与 schema 版本管理。
// 所有 CREATE 语句均幂等（IF NOT EXISTS），启动时重复执行无副作用。
// 未来 schema 升级：新增迁移步骤并递增 CURRENT_SCHEMA_VERSION。

const CURRENT_SCHEMA_VERSION = 1

const DDL = [
  `CREATE TABLE IF NOT EXISTS _schema_version (
     version    INTEGER PRIMARY KEY,
     applied_at INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS api_keys (
     id                 TEXT PRIMARY KEY,
     hashed_key         TEXT NOT NULL UNIQUE,
     name               TEXT NOT NULL,
     description        TEXT,
     permissions        TEXT,
     allowed_models     TEXT,
     blocked_models     TEXT,
     client_limits      TEXT,
     daily_cost_limit   REAL    NOT NULL DEFAULT 0,
     monthly_cost_limit REAL    NOT NULL DEFAULT 0,
     total_cost_limit   REAL    NOT NULL DEFAULT 0,
     concurrency_limit  INTEGER NOT NULL DEFAULT 0,
     expires_at         INTEGER,
     owner_user_id      TEXT,
     last_used_at       INTEGER,
     request_count      INTEGER NOT NULL DEFAULT 0,
     total_cost         REAL    NOT NULL DEFAULT 0,
     status             TEXT    NOT NULL DEFAULT 'active',
     metadata           TEXT,
     created_at         INTEGER NOT NULL,
     updated_at         INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_owner  ON api_keys(owner_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status)`,

  `CREATE TABLE IF NOT EXISTS accounts (
     id          TEXT PRIMARY KEY,
     platform    TEXT NOT NULL,
     name        TEXT NOT NULL,
     description TEXT,
     status      TEXT NOT NULL DEFAULT 'active',
     proxy       TEXT,
     credentials TEXT,
     config      TEXT,
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL
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
