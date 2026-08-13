#!/usr/bin/env node
'use strict'

// 生成 SQLite metadata 数据库的一致性备份（使用 SQLite 内置 .backup API）。
// 备份文件放在 data/backup/metadata-<ISO 时间戳>.db，权限 0600。
// 备份成功后按文件名时间戳排序，仅保留最近 KEEP_COUNT 份（默认 14）。

const path = require('path')
const fs = require('fs')
const config = require('../config/config')

if (config.metadata.backend !== 'sqlite') {
  process.stdout.write('metadata backend is not sqlite; nothing to back up.\n')
  process.exit(0)
}

const { getDb, closeDb } = require('../src/storage/sqlite')

function timestamp() {
  return new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '')
}

const KEEP_COUNT = parseInt(process.env.METADATA_BACKUP_KEEP || '14', 10)

// 保留策略：按文件名时间戳排序（metadata-<ISO>.db 字典序即时间序），删除超出最近 KEEP_COUNT 份的旧文件
function pruneOldBackups(backupDir) {
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => /^metadata-.*\.db$/.test(f))
    .sort() // 文件名内嵌 ISO 时间戳，字典序即时间序
  const excess = files.slice(0, Math.max(0, files.length - KEEP_COUNT))
  for (const f of excess) {
    const full = path.join(backupDir, f)
    try {
      fs.unlinkSync(full)
      process.stdout.write(`pruned old backup: ${f}\n`)
    } catch (e) {
      process.stderr.write(`prune failed (non-fatal): ${f}: ${e.message}\n`)
    }
  }
}

async function main() {
  const db = getDb()
  const dbDir = path.dirname(config.metadata.sqlitePath)
  const backupDir = path.join(dbDir, 'backup')
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  }
  const target = path.join(backupDir, `metadata-${timestamp()}.db`)

  process.stdout.write(`backing up ${config.metadata.sqlitePath}\n  → ${target}\n`)
  await db.backup(target)

  try {
    fs.chmodSync(target, 0o600)
  } catch (_err) {
    // non-fatal
  }

  const { size } = fs.statSync(target)
  process.stdout.write(`done. file size: ${size} bytes\n`)

  pruneOldBackups(backupDir)

  closeDb()
}

main().catch((err) => {
  process.stderr.write(`backup failed: ${err.stack || err.message}\n`)
  process.exit(1)
})
