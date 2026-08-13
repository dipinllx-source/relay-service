#!/usr/bin/env node
'use strict'

// 从文件级备份还原 SQLite metadata 数据库（配合 scripts/backup-metadata.js）。
//
// 用法：npm run data:restore -- --input=data/backup/metadata-<timestamp>.db
//
// 安全流程：
//   1. PRAGMA integrity_check 校验备份文件本身；
//   2. 检测 relay-app 运行中则拒绝（避免 better-sqlite3 打开中的 db 被替换）；
//   3. 覆盖前把现库复制为 data/metadata.db.pre-restore.<ts>；
//   4. 一并清掉陈旧的 -wal / -shm 附属文件（移入 pre-restore 备份旁），防止
//      新库被旧 WAL 污染；
//   5. 复制完成后提示启动命令。

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const config = require('../config/config')

if (config.metadata.backend !== 'sqlite') {
  process.stdout.write('metadata backend is not sqlite; nothing to restore.\n')
  process.exit(0)
}

function fail(msg) {
  process.stderr.write(`${msg}\n`)
  process.exit(1)
}

function timestamp() {
  return new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '')
}

function parseArgs() {
  let input = null
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--input=')) {
      input = arg.slice('--input='.length)
    }
  }
  return { input }
}

function checkIntegrity(file) {
  // eslint-disable-next-line global-require
  const Database = require('better-sqlite3')
  let db
  try {
    db = new Database(file, { readonly: true })
    const rows = db.prepare('PRAGMA integrity_check').all()
    const ok = rows.length === 1 && String(rows[0].integrity_check).toLowerCase() === 'ok'
    if (!ok) {
      fail(`integrity_check failed for ${file}:\n${JSON.stringify(rows, null, 2)}`)
    }
  } catch (e) {
    fail(`cannot open backup file ${file}: ${e.message}`)
  } finally {
    if (db) {
      db.close()
    }
  }
}

function serviceIsActive() {
  try {
    const out = execSync('systemctl is-active relay-app', {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return String(out).trim() === 'active'
  } catch (e) {
    // is-active 对 inactive/failed 返回非零退出码；systemctl 不存在时同样走这里。
    const out = String(e.stdout || '').trim()
    if (out === 'active') {
      return true
    }
    return false
  }
}

function main() {
  const { input } = parseArgs()
  if (!input) {
    fail(
      'usage: npm run data:restore -- --input=<backup-file>\n' +
        '  e.g. npm run data:restore -- --input=data/backup/metadata-2026-08-13T02-00-00.db'
    )
  }

  const source = path.resolve(input)
  if (!fs.existsSync(source)) {
    fail(`backup file not found: ${source}`)
  }

  process.stdout.write(`checking integrity of ${source} ...\n`)
  checkIntegrity(source)
  process.stdout.write('integrity_check: ok\n')

  if (serviceIsActive()) {
    fail(
      'relay-app is running. Stop it first:\n' +
        '  systemctl stop relay-app\n' +
        'then re-run this command, and start it again afterwards.'
    )
  }

  const target = path.resolve(config.metadata.sqlitePath)
  const ts = timestamp()

  // 覆盖前备份现库与附属 WAL/SHM 文件
  if (fs.existsSync(target)) {
    const preRestore = `${target}.pre-restore.${ts}`
    fs.copyFileSync(target, preRestore)
    process.stdout.write(`current db saved to ${preRestore}\n`)
  }
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${target}${suffix}`
    if (fs.existsSync(sidecar)) {
      const aside = `${target}.pre-restore.${ts}${suffix}`
      fs.renameSync(sidecar, aside)
      process.stdout.write(`stale ${path.basename(sidecar)} moved to ${aside}\n`)
    }
  }

  fs.copyFileSync(source, target)
  try {
    fs.chmodSync(target, 0o600)
  } catch (_err) {
    // non-fatal
  }

  process.stdout.write(`restored ${source}\n  → ${target}\n`)
  process.stdout.write('\nnext steps:\n  systemctl start relay-app\n')
  process.stdout.write(
    '  # 启动后 metadataSync 以 Redis 为准对账；若 Redis 也为空，\n' +
      '  # 空 Redis 护栏会保住 SQLite 数据，可再用 Web 备份导入恢复 Redis。\n'
  )
}

main()
