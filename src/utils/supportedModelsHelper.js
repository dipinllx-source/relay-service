/**
 * 账号 supportedModels 字段的统一解析
 *
 * claude-console / ccr / azure 这类账号的 supportedModels 有两种历史格式：
 *   - 数组：['claude-sonnet-4-5'] —— 表示支持这些模型，不做改名
 *   - 映射：{ '客户端模型名': '上游模型名' }
 * 空数组/空对象表示「支持全部」。
 *
 * 统一归一为映射表，key 恒为「客户端侧模型名」。
 */

function buildModelMappingFromSupportedModels(supportedModels) {
  if (!supportedModels) {
    return null
  }

  if (Array.isArray(supportedModels)) {
    const mapping = {}
    for (const model of supportedModels) {
      if (typeof model === 'string' && model.trim()) {
        mapping[model.trim()] = model.trim()
      }
    }
    return Object.keys(mapping).length ? mapping : null
  }

  if (typeof supportedModels === 'object') {
    const mapping = {}
    for (const [from, to] of Object.entries(supportedModels)) {
      if (typeof from === 'string' && typeof to === 'string' && from.trim() && to.trim()) {
        mapping[from.trim()] = to.trim()
      }
    }
    return Object.keys(mapping).length ? mapping : null
  }

  return null
}

module.exports = {
  buildModelMappingFromSupportedModels
}
