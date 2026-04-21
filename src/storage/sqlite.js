'use strict'

// Source-of-truth 元数据的 SQLite 连接。
// 仅在 METADATA_BACKEND=sqlite 时被 require；Redis 后端不触达 better-sqlite3。

const path = require('path')
const fs = require('fs')
const config = require('../../config/config')
const logger = require('../utils/logger')
const { initSchema } = require('./schema')

let dbInstance = null

function tightenDirPerms(dir, mode) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode })
    return
  }
  try {
    fs.chmodSync(dir, mode)
  } catch (err) {
    logger.warn(`⚠️  无法收紧目录权限 ${dir}: ${err.message}`)
  }
}

function tightenFilePerms(file, mode) {
  try {
    fs.chmodSync(file, mode)
  } catch (err) {
    logger.warn(`⚠️  无法收紧文件权限 ${file}: ${err.message}`)
  }
}

function openDatabase() {
  const { sqlitePath } = config.metadata
  const dbDir = path.dirname(sqlitePath)

  tightenDirPerms(dbDir, 0o700)
  tightenDirPerms(path.join(dbDir, 'backup'), 0o700)

  // 延迟 require：只有真正需要时才加载 native 模块
  // eslint-disable-next-line global-require
  const Database = require('better-sqlite3')
  const db = new Database(sqlitePath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('cache_size = -8000')
  db.pragma('wal_autocheckpoint = 1000')

  tightenFilePerms(sqlitePath, 0o600)

  initSchema(db)

  logger.info(`🗄️  SQLite metadata ready at ${sqlitePath} (WAL, foreign_keys=ON)`)
  return db
}

function getDb() {
  if (!dbInstance) {
    dbInstance = openDatabase()
  }
  return dbInstance
}

function closeDb() {
  if (dbInstance) {
    try {
      dbInstance.pragma('wal_checkpoint(PASSIVE)')
    } catch (err) {
      logger.warn(`⚠️  WAL checkpoint on close failed: ${err.message}`)
    }
    dbInstance.close()
    dbInstance = null
  }
}

module.exports = {
  getDb,
  closeDb
}
