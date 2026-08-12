/**
 * Admin Routes - 一键升级（OpenSpec task 4.5）
 *
 * POST /admin/upgrade         触发升级（人工，需 admin 鉴权）
 * GET  /admin/upgrade/status  查询升级状态（跨进程重启可查）
 *
 * 安全：目标 tag 由服务端校验（白名单 + 必须存在于远端 tag 集合）；
 *      不接受任意 ref / 路径 / 命令参数。
 */

const express = require('express')

const { authenticateAdmin } = require('../../middleware/auth')
const logger = require('../../utils/logger')
const upgradeService = require('../../services/upgradeService')
const upgradeRunner = require('../../services/upgradeRunner')

const router = express.Router()

// 📋 升级状态（含上一次升级的完整记录，重启后仍可查）
router.get('/upgrade/status', authenticateAdmin, async (req, res) => {
  try {
    const [state, running] = await Promise.all([
      upgradeRunner.getState(),
      upgradeRunner.isLocked()
    ])
    return res.json({
      success: true,
      data: {
        running,
        currentVersion: upgradeService.getCurrentVersion(),
        lastRun: state || null
      }
    })
  } catch (error) {
    logger.error(`/admin/upgrade/status failed: ${error.message}`)
    return res.status(500).json({ success: false, message: error.message })
  }
})

// ⬆️ 触发升级
router.post('/upgrade', authenticateAdmin, async (req, res) => {
  const admin = req.admin ? req.admin.username : 'unknown'
  try {
    // 目标版本：未指定时由服务端解析远端最新 tag
    let targetTag = req.body && typeof req.body.targetTag === 'string' ? req.body.targetTag.trim() : ''

    if (!targetTag) {
      const info = await upgradeService.checkForUpdates()
      if (!info.hasUpdate || !info.latestTag) {
        return res.status(400).json({
          success: false,
          message: info.error || '当前已是最新版本，无需升级'
        })
      }
      targetTag = info.latestTag
    }

    logger.security(`⬆️ Upgrade requested by admin ${admin}: target=${targetTag}`)

    // 注意：performUpgrade 在成功且需要重启时会安排 process.exit(0)，
    // 因此必须先 await 其完成（步骤执行完毕、状态已落盘）再返回响应。
    const result = await upgradeRunner.performUpgrade(targetTag, { admin })

    return res.json({
      success: true,
      data: {
        fromVersion: result.fromVersion,
        toVersion: result.toVersion,
        targetTag: result.targetTag,
        restarting: result.willRestart,
        steps: result.steps,
        message: result.willRestart
          ? '升级步骤已完成，服务正在重启以加载新代码'
          : '升级已完成（本次变更无需重启）'
      }
    })
  } catch (error) {
    const status = error.statusCode || 500
    logger.error(`❌ /admin/upgrade failed for admin ${admin}: ${error.message}`)
    return res.status(status).json({
      success: false,
      message: error.message,
      note: '服务仍以升级前的版本运行'
    })
  }
})

module.exports = router
