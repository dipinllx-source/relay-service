#!/usr/bin/env node

const { spawn, exec, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const process = require('process')

const ROOT_DIR = path.join(__dirname, '..')
const PID_FILE = path.join(__dirname, '..', 'claude-relay-service.pid')
const LOG_FILE = path.join(__dirname, '..', 'logs', 'service.log')
const ERROR_LOG_FILE = path.join(__dirname, '..', 'logs', 'service-error.log')
const APP_FILE = path.join(__dirname, '..', 'src', 'app.js')

// 🔗 systemd 托管单元（OpenSpec: service-process-supervision）
// 服务已由 systemd 托管；进程生命周期以 systemd 为唯一真相来源，
// 本脚本不再并行维护 PID 状态（PID 文件仅用于非 systemd 的前台调试回退）。
const SYSTEMD_UNIT = 'relay-app.service'

function systemdAvailable() {
  try {
    execSync('command -v systemctl', { stdio: 'ignore' })
    execSync(`systemctl cat ${SYSTEMD_UNIT}`, { stdio: 'ignore' })
    return true
  } catch (_e) {
    return false
  }
}

function systemdStatus() {
  try {
    const active = execSync(`systemctl is-active ${SYSTEMD_UNIT}`, { encoding: 'utf8' }).trim()
    const mainPid = parseInt(
      execSync(`systemctl show ${SYSTEMD_UNIT} -p MainPID --value`, { encoding: 'utf8' }).trim(),
      10
    )
    return {
      active: active === 'active',
      pid: Number.isFinite(mainPid) && mainPid > 0 ? mainPid : null
    }
  } catch (_e) {
    return { active: false, pid: null }
  }
}

function runSystemctl(action) {
  console.log(`🔗 委派 systemd: systemctl ${action} ${SYSTEMD_UNIT}`)
  execSync(`systemctl ${action} ${SYSTEMD_UNIT}`, { stdio: 'inherit' })
}

class ServiceManager {
  constructor() {
    this.ensureLogDir()
  }

  ensureLogDir() {
    const logDir = path.dirname(LOG_FILE)
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }
  }

  getPid() {
    try {
      if (fs.existsSync(PID_FILE)) {
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim())
        return pid
      }
    } catch (error) {
      console.error('读取PID文件失败:', error.message)
    }
    return null
  }

  isProcessRunning(pid) {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return false
    }
  }

  writePid(pid) {
    try {
      fs.writeFileSync(PID_FILE, pid.toString())
      console.log(`✅ PID ${pid} 已保存到 ${PID_FILE}`)
    } catch (error) {
      console.error('写入PID文件失败:', error.message)
    }
  }

  removePidFile() {
    try {
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE)
        console.log('🗑️  已清理PID文件')
      }
    } catch (error) {
      console.error('清理PID文件失败:', error.message)
    }
  }

  getStatus() {
    // systemd 为守护态的唯一真相来源，避免与自有 PID 文件产生双份状态
    if (systemdAvailable()) {
      const sd = systemdStatus()
      return { running: sd.active, pid: sd.pid, managedBy: 'systemd' }
    }
    const pid = this.getPid()
    if (pid && this.isProcessRunning(pid)) {
      return { running: true, pid, managedBy: 'pidfile' }
    }
    return { running: false, pid: null, managedBy: 'pidfile' }
  }

  start(daemon = false) {
    const status = this.getStatus()
    if (status.running) {
      console.log(`⚠️  服务已在运行中 (PID: ${status.pid})`)
      return false
    }

    // 守护态启动委派 systemd（保证与 Restart=always 语义一致）
    if (daemon && systemdAvailable()) {
      runSystemctl('start')
      return true
    }

    console.log('🚀 启动 Claude Relay Service...')

    if (daemon) {
      // 后台运行模式 - 使用nohup实现真正的后台运行
      const { exec: execChild } = require('child_process')

      const command = `nohup node "${APP_FILE}" > "${LOG_FILE}" 2> "${ERROR_LOG_FILE}" & echo $!`

      execChild(command, (error, stdout) => {
        if (error) {
          console.error('❌ 后台启动失败:', error.message)
          return
        }

        const pid = parseInt(stdout.trim())
        if (pid && !isNaN(pid)) {
          this.writePid(pid)
          console.log(`🔄 服务已在后台启动 (PID: ${pid})`)
          console.log(`📝 日志文件: ${LOG_FILE}`)
          console.log(`❌ 错误日志: ${ERROR_LOG_FILE}`)
          console.log('✅ 终端现在可以安全关闭')
        } else {
          console.error('❌ 无法获取进程ID')
        }
      })

      // 给exec一点时间执行
      setTimeout(() => {
        process.exit(0)
      }, 1000)
    } else {
      // 前台运行模式
      const child = spawn('node', [APP_FILE], {
        stdio: 'inherit'
      })

      console.log(`🔄 服务已启动 (PID: ${child.pid})`)

      this.writePid(child.pid)

      // 监听进程退出
      child.on('exit', (code, signal) => {
        this.removePidFile()
        if (code !== 0) {
          console.log(`💥 进程退出 (代码: ${code}, 信号: ${signal})`)
        }
      })

      child.on('error', (error) => {
        console.error('❌ 启动失败:', error.message)
        this.removePidFile()
      })
    }

    return true
  }

  stop() {
    // 由 systemd 托管时必须走 systemctl，否则 Restart=always 会立即重新拉起
    if (systemdAvailable()) {
      runSystemctl('stop')
      return true
    }

    const status = this.getStatus()
    if (!status.running) {
      console.log('⚠️  服务未在运行')
      this.removePidFile() // 清理可能存在的过期PID文件
      return false
    }

    console.log(`🛑 停止服务 (PID: ${status.pid})...`)

    try {
      // 优雅关闭：先发送SIGTERM
      process.kill(status.pid, 'SIGTERM')

      // 等待进程退出
      let attempts = 0
      const maxAttempts = 30 // 30秒超时

      const checkExit = setInterval(() => {
        attempts++
        if (!this.isProcessRunning(status.pid)) {
          clearInterval(checkExit)
          console.log('✅ 服务已停止')
          this.removePidFile()
          return
        }

        if (attempts >= maxAttempts) {
          clearInterval(checkExit)
          console.log('⚠️  优雅关闭超时，强制终止进程...')
          try {
            process.kill(status.pid, 'SIGKILL')
            console.log('✅ 服务已强制停止')
          } catch (error) {
            console.error('❌ 强制停止失败:', error.message)
          }
          this.removePidFile()
        }
      }, 1000)
    } catch (error) {
      console.error('❌ 停止服务失败:', error.message)
      this.removePidFile()
      return false
    }

    return true
  }

  restart(daemon = false) {
    console.log('🔄 重启服务...')

    if (systemdAvailable()) {
      runSystemctl('restart')
      return true
    }
    this.stop()
    // 等待停止完成
    setTimeout(() => {
      this.start(daemon)
    }, 2000)

    return true
  }

  async update() {
    console.log('⬆️  更新 Claude Relay Service...')

    // OpenSpec task 4.6：与 Web 端 POST /admin/upgrade 共用同一套「版本感知 + 步骤裁剪」
    // 逻辑（src/services/upgradeService.js），避免两份编排实现漂移。
    // 差异仅在于：CLI 是独立于服务进程的外部进程，无法用 process.exit(0) 换代码，
    // 故最后以 systemctl restart 重启（Web 端由服务进程 exit + systemd 拉起）。
    // eslint-disable-next-line global-require
    const upgradeService = require(path.join(ROOT_DIR, 'src', 'services', 'upgradeService'))
    // fix-upgrade-preflight-with-single-version-source D6：工作区预检（逐文件语义
    // 判定 + 噪音可逆处置）只有一份实现，CLI 与 HTTP 共用 upgradeRunner.preflight()。
    // eslint-disable-next-line global-require
    const upgradeRunner = require(path.join(ROOT_DIR, 'src', 'services', 'upgradeRunner'))

    let info
    try {
      info = await upgradeService.checkForUpdates()
    } catch (e) {
      console.error(`❌ 检查更新失败：${e.message}`)
      return false
    }
    if (!info.hasUpdate || !info.latestTag) {
      console.log(`✅ 当前已是最新版本 (v${info.current})${info.error ? `（${info.error}）` : ''}`)
      return true
    }

    const fromTag = `v${info.current}`
    console.log(`\n发现新版本：v${info.current} → ${info.latest}`)

    // 预检：判定结论与逐文件报错文案与 HTTP 路径一致（同一份实现）
    let pre
    try {
      pre = await upgradeRunner.preflight(info.latestTag)
    } catch (e) {
      console.error(`❌ ${e.message}`)
      return false
    }
    const noise = (pre.findings || []).filter((f) => f.verdict === 'noise')
    if (noise.length > 0) {
      console.log(
        `\n🧹 预检自愈：已 stash ${noise.length} 个可再生噪音文件（${noise
          .map((f) => f.path)
          .join(', ')}）→ stash ${String(pre.stashRef || '').slice(
          0,
          12
        )}，不会自动恢复（git stash list 可查）`
      )
    }

    const plan = (info.plannedSteps || []).reduce((m, st) => ((m[st.name] = st.needed), m), {})
    const runIf = (need, desc, cmd) => {
      if (!need) {
        console.log(`⏭️  跳过：${desc}`)
        return
      }
      console.log(`\n▶️  ${desc}: ${cmd}`)
      execSync(cmd, { cwd: ROOT_DIR, stdio: 'inherit' })
    }

    try {
      console.log(`\n▶️  拉取代码: git checkout --detach refs/tags/${info.latestTag}`)
      execSync('git fetch --tags --quiet origin', { cwd: ROOT_DIR, stdio: 'inherit' })
      execSync(`git checkout --detach refs/tags/${info.latestTag}`, {
        cwd: ROOT_DIR,
        stdio: 'inherit'
      })
      runIf(plan.npmInstall, '安装后端依赖', 'npm install --no-audit --no-fund')
      runIf(plan.npmInstallWeb, '安装前端依赖', 'npm run install:web')
      runIf(plan.buildWeb, '重建前端', 'npm run build:web')
    } catch (error) {
      console.error(`\n❌ 升级失败，正在回退工作区到 ${fromTag}（服务仍运行旧版本）`)
      try {
        execSync(`git checkout --detach refs/tags/${fromTag}`, { cwd: ROOT_DIR, stdio: 'inherit' })
      } catch (revErr) {
        console.error(`⚠️  回退失败，请手动处理: ${revErr.message}`)
      }
      return false
    }

    if (plan.restart) {
      console.log('\n✅ 代码已更新，正在重启服务...')
      this.restart(true)
    } else {
      console.log('\n✅ 更新完成（本次变更无需重启）')
    }
    return true
  }

  status() {
    const status = this.getStatus()
    if (status.running) {
      console.log(`✅ 服务正在运行 (PID: ${status.pid})`)

      // 显示进程信息
      exec(`ps -p ${status.pid} -o pid,ppid,pcpu,pmem,etime,cmd --no-headers`, (error, stdout) => {
        if (!error && stdout.trim()) {
          console.log('\n📊 进程信息:')
          console.log('PID\tPPID\tCPU%\tMEM%\tTIME\t\tCOMMAND')
          console.log(stdout.trim())
        }
      })
    } else {
      console.log('❌ 服务未运行')
    }
    return status.running
  }

  logs(lines = 50) {
    console.log(`📖 最近 ${lines} 行日志:\n`)

    exec(`tail -n ${lines} ${LOG_FILE}`, (error, stdout) => {
      if (error) {
        console.error('读取日志失败:', error.message)
        return
      }
      console.log(stdout)
    })
  }

  help() {
    console.log(`
🔧 Claude Relay Service 进程管理器

用法: npm run service <command> [options]

重要提示：
  如果要传递参数，请在npm run命令中使用 -- 分隔符
  npm run service <command> -- [options]

命令:
  start [-d|--daemon]   启动服务 (-d: 后台运行)
  stop                  停止服务
  restart [-d|--daemon] 重启服务 (-d: 后台运行)
  update                更新服务 (git pull → 装依赖 → 构建前端 → 后台重启)
  status                查看服务状态
  logs [lines]          查看日志 (默认50行)
  help                  显示帮助信息

命令缩写:
  s, start              启动服务
  r, restart            重启服务
  u, update             更新服务
  st, status            查看状态
  l, log, logs          查看日志
  halt, stop            停止服务
  h, help               显示帮助

示例:
  npm run service start              # 前台启动
  npm run service -- start -d        # 后台启动（正确方式）
  npm run service:start:d            # 后台启动（推荐快捷方式）
  npm run service:daemon             # 后台启动（推荐快捷方式）
  npm run service stop               # 停止服务
  npm run service -- restart -d      # 后台重启（正确方式）
  npm run service:restart:d          # 后台重启（推荐快捷方式）
  npm run service status             # 查看状态
  npm run service logs               # 查看日志
  npm run service -- logs 100        # 查看最近100行日志

推荐的快捷方式（无需 -- 分隔符）:
  npm run service:start:d            # 等同于 npm run service -- start -d
  npm run service:restart:d          # 等同于 npm run service -- restart -d
  npm run service:daemon             # 等同于 npm run service -- start -d

直接使用脚本（推荐）:
  node scripts/manage.js start -d    # 后台启动
  node scripts/manage.js restart -d  # 后台重启
  node scripts/manage.js status      # 查看状态
  node scripts/manage.js logs 100    # 查看最近100行日志

文件位置:
  PID文件: ${PID_FILE}
  日志文件: ${LOG_FILE}
  错误日志: ${ERROR_LOG_FILE}
        `)
  }
}

// 主程序
async function main() {
  const manager = new ServiceManager()
  const args = process.argv.slice(2)
  const command = args[0]
  const isDaemon = args.includes('-d') || args.includes('--daemon')

  switch (command) {
    case 'start':
    case 's':
      manager.start(isDaemon)
      break
    case 'stop':
    case 'halt':
      manager.stop()
      break
    case 'restart':
    case 'r':
      manager.restart(isDaemon)
      break
    case 'update':
    case 'u':
      await manager.update()
      break
    case 'status':
    case 'st':
      manager.status()
      break
    case 'logs':
    case 'log':
    case 'l': {
      const lines = parseInt(args[1]) || 50
      manager.logs(lines)
      break
    }
    case 'help':
    case '--help':
    case '-h':
    case 'h':
      manager.help()
      break
    default:
      console.log('❌ 未知命令:', command)
      manager.help()
      process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = ServiceManager
