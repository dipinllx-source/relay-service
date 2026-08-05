/**
 * Admin Routes - 备份导出/导入（Web 端）
 *
 * 范围：API Keys + 各类账户 + 管理员凭据；密钥保留加密形态；导入跳过冲突。
 * 全部端点需 admin 鉴权。
 */

const express = require('express')

const { authenticateAdmin } = require('../../middleware/auth')
const logger = require('../../utils/logger')
const backupService = require('../../services/backupService')

const router = express.Router()

// 📤 导出备份 —— 返回 JSON 附件（含加密形态的敏感字段）
router.get('/backup/export', authenticateAdmin, async (req, res) => {
  try {
    const backup = await backupService.exportBackup({
      includeApiKeys: true,
      includeAccounts: true,
      includeAdmins: true
    })
    const summary = backupService.summarize(backup)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `relay-backup-${stamp}.json`

    logger.security(
      `📤 Backup exported by admin ${req.admin?.username || 'unknown'}: apiKeys=${summary.apiKeys}, accounts=${summary.accounts}, admins=${summary.admins}`
    )

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(JSON.stringify(backup, null, 2))
  } catch (err) {
    logger.error(`/admin/backup/export failed: ${err.stack || err.message}`)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// 📋 导出摘要（不含数据，仅统计各类条目数，供 UI 预览）
router.get('/backup/summary', authenticateAdmin, async (req, res) => {
  try {
    const backup = await backupService.exportBackup()
    return res.json({ success: true, data: backupService.summarize(backup) })
  } catch (err) {
    logger.error(`/admin/backup/summary failed: ${err.stack || err.message}`)
    return res.status(500).json({ success: false, message: err.message })
  }
})

// 📥 导入备份 —— body 为备份 JSON；跳过冲突（不覆盖已存在条目）
router.post('/backup/import', authenticateAdmin, async (req, res) => {
  try {
    const backup = req.body
    if (!backup || typeof backup !== 'object' || !backup.metadata || !backup.data) {
      return res.status(400).json({
        success: false,
        message: 'Invalid backup file: missing metadata/data'
      })
    }

    const stats = await backupService.importBackup(backup, { skipConflicts: true })

    logger.security(
      `📥 Backup imported by admin ${req.admin?.username || 'unknown'}: ` +
        `apiKeys(+${stats.apiKeys.imported}/skip ${stats.apiKeys.skipped}), ` +
        `accounts(+${stats.accounts.imported}/skip ${stats.accounts.skipped}), ` +
        `admins(+${stats.admins.imported}/skip ${stats.admins.skipped})`
    )

    return res.json({ success: true, data: stats })
  } catch (err) {
    logger.error(`/admin/backup/import failed: ${err.stack || err.message}`)
    return res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
