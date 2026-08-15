#!/usr/bin/env node

/**
 * 🔖 版本号发布脚本
 *
 * OpenSpec: fix-upgrade-preflight-with-single-version-source
 *   D7 `package.json` 的 `version` 是唯一权威来源；`VERSION` 与
 *      `package-lock.json` 的两处 `version` 都是它的派生物。三处必须一次性同步，
 *      禁止手工单独编辑其中任何一处 —— 不同步的 lock 版本号正是「一键升级被
 *      ` M package-lock.json` 卡住」的根因。
 *
 * 用法：
 *   npm run version:bump -- 1.3.2
 *   npm run version:bump -- v1.3.2-rc.1
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.join(__dirname, '..')
const PKG_PATH = path.join(ROOT_DIR, 'package.json')
const LOCK_PATH = path.join(ROOT_DIR, 'package-lock.json')
const VERSION_PATH = path.join(ROOT_DIR, 'VERSION')

// 版本号语法复用升级链路的唯一定义（含 prerelease），避免两处规则漂移
// eslint-disable-next-line global-require
const { TAG_RE } = require(path.join(ROOT_DIR, 'src', 'services', 'upgradeService'))

function fail(msg) {
  console.error(`❌ ${msg}`)
  process.exit(1)
}

function main() {
  const raw = (process.argv[2] || '').trim()
  if (!raw) {
    fail(
      '用法：npm run version:bump -- <semver>，例如 npm run version:bump -- 1.3.2（未做任何写入）'
    )
  }

  // 入参校验先于任何写入：非法版本号一律拒绝执行
  const version = raw.startsWith('v') ? raw.slice(1) : raw
  if (!TAG_RE.test(`v${version}`)) {
    fail(`非法版本号：${raw}，应为 MAJOR.MINOR.PATCH[-prerelease]（未做任何写入）`)
  }

  console.log(`🔖 版本号升级为 ${version}`)

  // 1) npm version 同步 package.json 与 package-lock.json（.version 与
  //    .packages[""].version 两处）；--no-git-tag-version：tag 由发版流程单独打
  try {
    execFileSync('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    })
  } catch (e) {
    fail(`npm version 执行失败：${e.message}`)
  }

  // 2) VERSION 文件（供人与部署脚本查看）
  fs.writeFileSync(VERSION_PATH, `${version}\n`)

  // 3) 回读三处校验一致，不一致即非零退出（宁可发版失败，也不留下不一致状态）
  const mismatches = []
  let pkgVersion
  let lockVersion
  let lockRootVersion
  let versionFile
  try {
    pkgVersion = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).version
    const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'))
    lockVersion = lock.version
    lockRootVersion = lock.packages && lock.packages[''] ? lock.packages[''].version : undefined
    versionFile = fs.readFileSync(VERSION_PATH, 'utf8').trim()
  } catch (e) {
    fail(`回读校验失败：${e.message}`)
  }

  if (pkgVersion !== version) {
    mismatches.push(`package.json.version = ${pkgVersion}`)
  }
  if (lockVersion !== version) {
    mismatches.push(`package-lock.json.version = ${lockVersion}`)
  }
  if (lockRootVersion !== version) {
    mismatches.push(`package-lock.json.packages[""].version = ${lockRootVersion}`)
  }
  if (versionFile !== version) {
    mismatches.push(`VERSION = ${versionFile}`)
  }

  if (mismatches.length > 0) {
    fail(`版本号未能同步到位（期望 ${version}）：\n  ${mismatches.join('\n  ')}`)
  }

  console.log('✅ 三处版本号已同步：')
  console.log(`   package.json.version                  = ${pkgVersion}`)
  console.log(`   package-lock.json.version             = ${lockVersion}`)
  console.log(`   package-lock.json.packages[""].version = ${lockRootVersion}`)
  console.log(`   VERSION                               = ${versionFile}`)
  console.log('\n请一并提交 package.json、package-lock.json、VERSION 三个文件。')
}

main()
