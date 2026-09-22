/**
 * 模型列表过滤器
 *
 * 各 models 端点共用的三层过滤，抽成纯函数便于测试：
 *   1. 权限分段：按模型的 owned_by 段校验 API Key 是否有对应服务权限
 *   2. 账号裁剪：绑定了 console/ccr 这类有 supportedModels 的账号时，取交集
 *   3. 模型限制：restrictedModels 黑名单
 *
 * 注意：这里只裁剪「列表」。实际推理请求的权限拦截在各自的 handler 里
 * （如 api.js 的 handleMessagesRequest），两者用的是同一个 hasPermission。
 */

const config = require('../../config/config')
const apiKeyService = require('../services/apiKeyService')

// 模型 owned_by → API Key permission 服务名
const PERMISSION_BY_OWNER = {
  anthropic: 'claude',
  openai: 'openai',
  google: 'gemini'
}

function isPermissionFilterEnabled() {
  return config.models?.enforcePermissionFilter !== false
}

/**
 * 该 Key 有权访问的 owned_by 集合
 */
function getAllowedOwners(permissions) {
  const owners = new Set()
  for (const [owner, service] of Object.entries(PERMISSION_BY_OWNER)) {
    if (apiKeyService.hasPermission(permissions, service)) {
      owners.add(owner)
    }
  }
  return owners
}

/**
 * 权限分段过滤
 * @returns {{ models: Array, denied: boolean }} denied=true 表示三段都无权限，调用方应返回 403
 */
function filterByPermission(models, apiKeyData) {
  if (!isPermissionFilterEnabled()) {
    return { models, denied: false }
  }

  const allowedOwners = getAllowedOwners(apiKeyData?.permissions)
  if (allowedOwners.size === 0) {
    return { models: [], denied: true }
  }

  // owned_by 不在映射表里的（未来新增 provider）默认放行，避免新模型被静默吞掉
  const filtered = models.filter(
    (model) => !PERMISSION_BY_OWNER[model?.owned_by] || allowedOwners.has(model.owned_by)
  )
  return { models: filtered, denied: false }
}

/**
 * 账号级裁剪：accountScope 为 null 表示不裁剪
 */
function filterByAccountScope(models, accountScope) {
  if (!accountScope || accountScope.size === 0) {
    return models
  }
  return models.filter((model) => accountScope.has(model?.id))
}

/**
 * 模型限制：restrictedModels 按黑名单语义过滤
 */
function filterByRestriction(models, apiKeyData) {
  if (!apiKeyData?.enableModelRestriction || !(apiKeyData.restrictedModels?.length > 0)) {
    return models
  }
  return models.filter((model) => !apiKeyData.restrictedModels.includes(model?.id))
}

/**
 * 三层过滤的组合入口
 * @param {Array} models
 * @param {object} apiKeyData
 * @param {object} [options]
 * @param {Set<string>|null} [options.accountScope] - 绑定账号支持的模型 id 集合
 * @param {boolean} [options.skipPermissionFilter] - 端点入口已单独校验过权限时置 true
 * @returns {{ models: Array, denied: boolean }}
 */
function filterModelsForApiKey(models, apiKeyData, options = {}) {
  const { accountScope = null, skipPermissionFilter = false } = options
  const source = Array.isArray(models) ? models : []

  let result = source
  if (!skipPermissionFilter) {
    const permissionResult = filterByPermission(source, apiKeyData)
    if (permissionResult.denied) {
      return { models: [], denied: true }
    }
    result = permissionResult.models
  }

  result = filterByAccountScope(result, accountScope)
  result = filterByRestriction(result, apiKeyData)

  return { models: result, denied: false }
}

module.exports = {
  PERMISSION_BY_OWNER,
  isPermissionFilterEnabled,
  getAllowedOwners,
  filterByPermission,
  filterByAccountScope,
  filterByRestriction,
  filterModelsForApiKey
}
