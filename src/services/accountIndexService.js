/**
 * 账户索引服务（`<平台前缀>index` 集合的版本化重建）
 *
 * 为什么需要它：账户列表读取走 `redisClient.getAllIdsByIndex()`，该函数只在索引
 * **为空**时才回退 SCAN 并顺带建索引；索引非空时直接返回 smembers 结果。因此
 * 「实体存在而索引缺失」这一状态不会自愈 —— 该账户在管理台永久不可见。
 * 备份导入路径此前只写实体不写索引（见 backupService D1），正是这一状态的来源。
 *
 * 职责边界：本服务是**兜底**，不是主路径。导入路径负责让还原数据立即可见
 * （backupService 的 indexWriter），本服务负责最终一致 —— 收敛历史脏数据与
 * 未来任何漏写。
 *
 * 对账方式：以本轮 SCAN 到的实体集合为权威，双向修正（实体有索引无 → sadd，
 * 索引有实体无 → srem）。反向 srem 的风险是 SCAN 漏读导致误删索引条目；接受
 * 该风险，因为索引是纯派生数据、下一轮重建即恢复，而孤儿 id 会让「索引数 =
 * 账户数」这个最直观的核对判据失效。
 *
 * 触发时机：启动时按版本标记 `account:index:version` 判断，落后则**后台异步**
 * 重建，不阻塞启动。取「按版本执行」而非 apiKeyIndexService.rebuildHashMap()
 * 那样的「每次启动都跑」，因为本流程含 srem 反向清理。
 */

const redis = require('../models/redis')
const logger = require('../utils/logger')
// 账户前缀表与实体 key 判定复用 storage/metadataSync.js 的权威定义。
// 该表在本仓库已有多份副本（backupService 的对象数组、各账户服务的
// *_KEY_PREFIX 常量）且彼此漂移过，此处不再新增第四份。
const { ACCOUNT_GROUPS, isEntityKey } = require('../storage/metadataSync')

const INDEX_VERSION_KEY = 'account:index:version'
const CURRENT_VERSION = 1
const SADD_CHUNK = 500

let isBuilding = false

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

/**
 * 重建单个前缀的索引集合。
 * MUST 在同一轮内先 SCAN 再 smembers 再算差集，不得跨轮复用扫描结果。
 */
async function rebuildPrefix(client, prefix) {
  const indexKey = `${prefix}index`

  const keys = await redis.scanKeys(`${prefix}*`)
  const liveIds = keys.filter((k) => isEntityKey(k, prefix)).map((k) => k.slice(prefix.length))
  const indexedIds = await client.smembers(indexKey)

  const liveSet = new Set(liveIds)
  const indexedSet = new Set(indexedIds)
  const toAdd = liveIds.filter((id) => !indexedSet.has(id))
  const toRemove = indexedIds.filter((id) => !liveSet.has(id))

  for (const batch of chunk(toAdd, SADD_CHUNK)) {
    // eslint-disable-next-line no-await-in-loop
    await client.sadd(indexKey, ...batch)
  }
  for (const batch of chunk(toRemove, SADD_CHUNK)) {
    // eslint-disable-next-line no-await-in-loop
    await client.srem(indexKey, ...batch)
  }

  // 实体集合非空 → 清空标记（getAllIdsByIndex 可能在还原前打过，TTL 1h）。
  // 实体集合为空时 MUST NOT 主动打 `:empty` —— 那是 getAllIdsByIndex 的职责，
  // 这里重复打会缩短其 TTL 语义。
  if (liveIds.length > 0) {
    await client.del(`${indexKey}:empty`)
  }

  return {
    live: liveIds.length,
    indexed: indexedIds.length,
    added: toAdd.length,
    removed: toRemove.length
  }
}

/**
 * 全量重建 11 类账户前缀的索引。单前缀失败被隔离，不中断其余前缀。
 * 仅当全部前缀成功时才写版本号，使失败的重建在下次启动重试。
 */
async function rebuildAll() {
  if (isBuilding) {
    logger.warn('⚠️ 账户索引正在重建中，跳过')
    return null
  }

  isBuilding = true
  const startTime = Date.now()
  const stats = { prefixes: {}, added: 0, removed: 0, errors: 0 }

  try {
    const client = redis.getClientSafe()
    logger.info('🔨 开始重建账户索引...')

    for (const [prefix] of ACCOUNT_GROUPS) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await rebuildPrefix(client, prefix)
        stats.prefixes[`${prefix}index`] = r
        stats.added += r.added
        stats.removed += r.removed
        if (r.added > 0 || r.removed > 0) {
          logger.info(
            `🔧 ${prefix}index: 实体 ${r.live}，索引 ${r.indexed} → 补写 ${r.added}，清理孤儿 ${r.removed}`
          )
        }
      } catch (e) {
        stats.errors++
        logger.warn(`⚠️ 账户索引重建失败（${prefix}）: ${e.message}`)
      }
      // 每个前缀之后让出 CPU，与 apiKeyIndexService 的批间让出一致
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    if (stats.errors > 0) {
      logger.warn(
        `⚠️ 账户索引重建有 ${stats.errors} 个前缀失败，补写 ${stats.added} / 清理 ${stats.removed}，` +
          `不写入 ${INDEX_VERSION_KEY}（下次启动重试），耗时 ${duration}s`
      )
    } else {
      await client.set(INDEX_VERSION_KEY, CURRENT_VERSION)
      logger.success(
        `✅ 账户索引重建完成：补写 ${stats.added}，清理孤儿 ${stats.removed}，耗时 ${duration}s`
      )
    }
    return stats
  } catch (error) {
    logger.error('❌ 账户索引重建失败:', error)
    throw error
  } finally {
    isBuilding = false
  }
}

/**
 * 启动时检查版本并在落后时后台重建。MUST NOT 阻塞启动。
 */
async function checkAndRebuild() {
  try {
    const client = redis.getClientSafe()
    const version = await client.get(INDEX_VERSION_KEY)
    if (parseInt(version, 10) >= CURRENT_VERSION) {
      logger.info('✅ 账户索引已是最新版本')
      return
    }

    rebuildAll().catch((err) => {
      logger.error('❌ 账户索引重建失败:', err)
    })
  } catch (error) {
    logger.error('❌ 检查账户索引版本失败:', error)
  }
}

module.exports = {
  checkAndRebuild,
  rebuildAll,
  INDEX_VERSION_KEY,
  CURRENT_VERSION
}
