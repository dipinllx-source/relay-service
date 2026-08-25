/**
 * Admin Routes - 存储健康状态（只读）
 *
 * 不在此处暴露任何写入、重置或删除入口；运维脚本请通过 CLI 运行
 * （npm run data:backup / data:migrate / ...）。
 */

const express = require('express')

const { authenticateAdmin } = require('../../middleware/auth')
const logger = require('../../utils/logger')
const config = require('../../../config/config')
const redis = require('../../models/redis')
const StorageStatusService = require('../../services/storageStatusService')
// 只用它的 keyFingerprint()（D14）：纯派生、只读、进程内已缓存，不触发任何自检动作
const encryptionKeyCheckService = require('../../services/encryptionKeyCheckService')

const router = express.Router()

// Lazy-constructed service: SQLite backend 下需要 getDb，Redis-only 部署没必要加载
let svc = null
function getSvc() {
  if (svc) {
    return svc
  }
  const params = {
    config,
    redisClient: redis.getClientSafe?.() ?? null,
    logger
  }
  if (config.metadata.backend === 'sqlite') {
    // eslint-disable-next-line global-require
    const { getDb } = require('../../storage/sqlite')
    params.getDb = getDb
  }
  svc = new StorageStatusService(params)
  return svc
}

// 由 app.js 在 flusher 启动后调用，把实例注入进来，用于面板展示其 status
function setFlusher(flusher) {
  getSvc().setFlusher(flusher)
}

router.get('/storage/status', authenticateAdmin, async (req, res) => {
  try {
    const data = await getSvc().snapshot()
    // 🔑 密钥指纹（D14）：备份面板要在**点导出之前**就显示本机指纹，好让运维拿它跟
    // 备份文件里声明的指纹对一眼 —— 事后核对救不了已经投错机器的那次导入。
    //
    // 为什么挂在这个接口上而不是让面板去调 `/backup/summary`：后者内部会跑一次完整的
    // `exportBackup()`（全库 dump）才算出摘要，作为面板挂载时的自动请求代价过高；而本
    // 接口本就是面板的数据源、且已在定时轮询。`/backup/summary` 同样带该字段，供 CLI /
    // 脚本核对（两处取的都是同一个 `keyFingerprint()`，值在进程内已缓存）。
    //
    // 只带指纹与派生方式，MUST NOT 带密钥本身；本接口在 `authenticateAdmin` 之后。
    data.encryption = {
      keyFingerprint: encryptionKeyCheckService.keyFingerprint(),
      algorithm: encryptionKeyCheckService.FINGERPRINT_ALGORITHM
    }
    return res.json({ success: true, data })
  } catch (err) {
    logger.error(`/admin/storage/status failed: ${err.stack || err.message}`)
    return res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
module.exports.setFlusher = setFlusher
