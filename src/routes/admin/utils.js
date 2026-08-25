/**
 * Admin Routes - 共享工具函数
 * 供各个子路由模块导入使用
 */

const logger = require('../../utils/logger')
const redis = require('../../models/redis')
// 分组 key 形状复用 accountGroupService 上的常量（GROUP_PREFIX /
// REVERSE_INDEX_PREFIX），MUST NOT 在此另抄字面量
const accountGroupService = require('../../services/accountGroupService')

/**
 * 处理可为空的时间字段
 * @param {*} value - 输入值
 * @returns {string|null} 规范化后的值
 */
function normalizeNullableDate(value) {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  return value
}

/**
 * 映射前端的 expiresAt 字段到后端的 subscriptionExpiresAt 字段
 * @param {Object} updates - 更新对象
 * @param {string} accountType - 账户类型 (如 'Claude', 'OpenAI' 等)
 * @param {string} accountId - 账户 ID
 * @returns {Object} 映射后的更新对象
 */
function mapExpiryField(updates, accountType, accountId) {
  const mappedUpdates = { ...updates }
  if ('expiresAt' in mappedUpdates) {
    mappedUpdates.subscriptionExpiresAt = mappedUpdates.expiresAt
    delete mappedUpdates.expiresAt
    logger.info(
      `Mapping expiresAt to subscriptionExpiresAt for ${accountType} account ${accountId}`
    )
  }
  return mappedUpdates
}

/**
 * 剔除更新数据里指向「已不存在分组」的引用（悬空 groupId 自动解绑）
 *
 * 背景：跨实例还原（旧格式备份不含分组数据）或分组被并发删除后，账户实体上会
 * 留下指向不存在分组的 groupId / groupIds。管理台编辑该账户时表单会把这个值原样
 * 提交回来，`accountGroupService.addAccountToGroup()` 拿不到分组便抛「分组不存在」，
 * 被路由的 catch 冒泡成 500 —— 于是这个账户在后台变成「永远存不下去」的状态。
 *
 * 这里在绑定之前把悬空引用剔除并 warn，让保存继续完成。
 * MUST NOT 改动 `accountGroupService.updateGroup()` 的报错行为：直接更新一个不存在
 * 的分组本就该失败，缺陷只在账户保存流程把它冒泡成 500。
 *
 * @param {Object} updates - 待写入的更新对象（原地修改；调用方传入的是 mapExpiryField 的浅拷贝）
 * @param {string} platform - 分组平台（用于定位反向索引 key，如 'claude' / 'openai'）
 * @param {string} accountId - 账户 ID
 * @returns {Promise<Array<string>>} 被剔除的分组 ID 列表
 */
async function pruneDanglingGroupRefs(updates, platform, accountId) {
  if (!updates || typeof updates !== 'object') {
    return []
  }

  const refs = new Set()
  if (typeof updates.groupId === 'string' && updates.groupId) {
    refs.add(updates.groupId)
  }
  if (Array.isArray(updates.groupIds)) {
    for (const gid of updates.groupIds) {
      if (typeof gid === 'string' && gid) {
        refs.add(gid)
      }
    }
  }
  if (refs.size === 0) {
    return []
  }

  const client = redis.getClientSafe()
  const dangling = new Set()
  for (const gid of refs) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await client.exists(`${accountGroupService.GROUP_PREFIX}${gid}`)
    if (!exists) {
      dangling.add(gid)
    }
  }
  if (dangling.size === 0) {
    return []
  }

  if (typeof updates.groupId === 'string' && dangling.has(updates.groupId)) {
    delete updates.groupId
  }
  if (Array.isArray(updates.groupIds)) {
    updates.groupIds = updates.groupIds.filter((gid) => !dangling.has(gid))
  }

  // 反向索引里的同一批残留 gid 一并清掉，否则账户列表仍会显示这个幽灵分组
  if (platform) {
    const reverseKey = `${accountGroupService.REVERSE_INDEX_PREFIX}${platform}:${accountId}`
    try {
      await client.srem(reverseKey, ...dangling)
    } catch (e) {
      logger.warn(`清理反向索引残留失败 ${reverseKey}: ${e.message}`)
    }
  }

  logger.warn(
    `⚠️ 账户 ${accountId} 的分组引用已自动解除绑定（分组不存在）: ${[...dangling].join(', ')}`
  )
  return [...dangling]
}

/**
 * 格式化账户数据，确保前端获取正确的过期时间字段
 * 将 subscriptionExpiresAt（订阅过期时间）映射到 expiresAt 供前端使用
 * 保留原始的 tokenExpiresAt（OAuth token过期时间）供内部使用
 * @param {Object} account - 账户对象
 * @returns {Object} 格式化后的账户对象
 */
function formatAccountExpiry(account) {
  if (!account || typeof account !== 'object') {
    return account
  }

  const rawSubscription = Object.prototype.hasOwnProperty.call(account, 'subscriptionExpiresAt')
    ? account.subscriptionExpiresAt
    : null

  const rawToken = Object.prototype.hasOwnProperty.call(account, 'tokenExpiresAt')
    ? account.tokenExpiresAt
    : account.expiresAt

  const subscriptionExpiresAt = normalizeNullableDate(rawSubscription)
  const tokenExpiresAt = normalizeNullableDate(rawToken)

  return {
    ...account,
    subscriptionExpiresAt,
    tokenExpiresAt,
    expiresAt: subscriptionExpiresAt
  }
}

module.exports = {
  normalizeNullableDate,
  mapExpiryField,
  pruneDanglingGroupRefs,
  formatAccountExpiry
}
