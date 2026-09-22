/**
 * API Key 的账号级模型范围
 *
 * 绑定了 claude-console / ccr 这类账号的 Key，其可用模型是全局清单的真子集
 * （由账号上的 supportedModels 决定）。这里只做「列表裁剪」的取值，
 * 不触发任何上游请求，只读 Redis 上账号已有的字段。
 *
 * 返回 null 表示不裁剪：没绑这类账号、绑的是分组（成员异构）、
 * 账号读不到，或账号 supportedModels 为空（= 支持全部）。
 */

const logger = require('./logger')
const { buildModelMappingFromSupportedModels } = require('./supportedModelsHelper')

async function getApiKeyModelScope(apiKeyData) {
  const accountId = apiKeyData?.claudeConsoleAccountId
  if (!accountId || String(accountId).startsWith('group:')) {
    return null
  }

  try {
    const claudeConsoleAccountService = require('../services/account/claudeConsoleAccountService')
    const account = await claudeConsoleAccountService.getAccount(accountId)
    if (!account) {
      return null
    }

    const mapping = buildModelMappingFromSupportedModels(account.supportedModels)
    if (!mapping) {
      return null
    }

    return new Set(Object.keys(mapping))
  } catch (error) {
    // 裁剪失败不应该让整个 models 端点挂掉，退化为「不裁剪」
    logger.warn(`⚠️ Failed to resolve account model scope: ${error.message}`)
    return null
  }
}

module.exports = {
  getApiKeyModelScope
}
