/**
 * LiteLLM 计费规则的 JS 实现
 *
 * 对齐 BerriAI/litellm `litellm_core_utils/llm_cost_calc/utils.py`：
 * - get_service_tier_cost_key：按服务档位拼接价格键（如 input_cost_per_token_priority）
 * - get_cost_per_unit：档位价格键缺失时回退到标准价格键
 * - generic_cost_per_token：按 input_cost_per_token_above_<N>k_tokens 阈值键选择长上下文价格，
 *   并优先使用带档位的阈值键；缓存价格缺失时按输入价计费
 *
 * 不依赖任何"是否支持档位"的标记：价格表里有对应键就用，没有就回退。
 */

// 与 LiteLLM _SERVICE_TIER_TO_COST_KEY_SUFFIX 保持一致（fast 归一为 priority）
const SERVICE_TIER_TO_COST_KEY_SUFFIX = Object.freeze({
  flex: 'flex',
  balanced: 'balanced',
  priority: 'priority',
  fast: 'priority',
  ultrafast: 'ultrafast'
})

const SERVICE_TIER_SUFFIXES = Object.freeze(
  [...new Set(Object.values(SERVICE_TIER_TO_COST_KEY_SUFFIX))].sort().map((s) => `_${s}`)
)
const BATCH_KEY_SUFFIX = '_batches'
const NON_STANDARD_THRESHOLD_SUFFIXES = Object.freeze([...SERVICE_TIER_SUFFIXES, BATCH_KEY_SUFFIX])

// 阈值按 >= 计费的供应商（LiteLLM _INCLUSIVE_THRESHOLD_PROVIDERS）
const INCLUSIVE_THRESHOLD_PROVIDERS = new Set(['xai'])

// Claude Prompt Caching 官方倍率（基于输入价格）— 仅作为价格表缺失字段时的兜底
const CLAUDE_CACHE_MULTIPLIERS = Object.freeze({
  write5m: 1.25,
  write1h: 2,
  read: 0.1
})

/**
 * 归一化服务档位：返回 LiteLLM 识别的档位名（小写），无法识别（含 auto/default/scale/null）返回 null
 */
function normalizeServiceTier(serviceTier) {
  if (typeof serviceTier !== 'string') {
    return null
  }
  const tier = serviceTier.trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(SERVICE_TIER_TO_COST_KEY_SUFFIX, tier) ? tier : null
}

/**
 * 对应 LiteLLM get_service_tier_cost_key
 */
function getServiceTierCostKey(baseKey, serviceTier) {
  const tier = normalizeServiceTier(serviceTier)
  if (!tier) {
    return baseKey
  }
  return `${baseKey}_${SERVICE_TIER_TO_COST_KEY_SUFFIX[tier]}`
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * 对应 LiteLLM get_cost_per_unit：键缺失时，若键里带档位后缀则回退到去掉后缀的标准键
 */
function getCostPerUnit(pricing, costKey, defaultValue = 0) {
  if (!pricing) {
    return defaultValue
  }

  const direct = toNumber(pricing[costKey])
  if (direct !== undefined) {
    return direct
  }

  if (pricing[costKey] === undefined || pricing[costKey] === null) {
    for (const suffix of SERVICE_TIER_SUFFIXES) {
      if (costKey.includes(suffix)) {
        const fallback = toNumber(pricing[costKey.replace(suffix, '')])
        if (fallback !== undefined) {
          return fallback
        }
        break // 与 LiteLLM 一致：只尝试第一个匹配的后缀
      }
    }
  }

  return defaultValue
}

function parseTokenThreshold(threshold) {
  const value = parseFloat(String(threshold).replace('k', ''))
  return String(threshold).includes('k') ? value * 1000 : value
}

function parseAboveTokenThreshold(key) {
  return parseTokenThreshold(key.split('_above_')[1].split('_tokens')[0])
}

/**
 * 选出本次请求命中的长上下文阈值（如 "272k"），未命中返回 null
 * 对应 LiteLLM generic_cost_per_token 中的 threshold_keys 选择逻辑
 */
function findLongContextThreshold(pricing, promptTokens, serviceTier, inclusive = false) {
  if (!pricing || !(promptTokens > 0)) {
    return null
  }

  const tierKeySuffix = getServiceTierCostKey('', serviceTier)
  const thresholdKeys = Object.keys(pricing).filter(
    (k) =>
      k.startsWith('input_cost_per_token_above_') &&
      (!NON_STANDARD_THRESHOLD_SUFFIXES.some((suffix) => k.endsWith(suffix)) ||
        (tierKeySuffix !== '' && k.endsWith(tierKeySuffix)))
  )

  const sorted = thresholdKeys
    .map((key) => {
      try {
        return { key, threshold: parseAboveTokenThreshold(key) }
      } catch (_) {
        return null
      }
    })
    .filter((item) => item && Number.isFinite(item.threshold))
    .sort((a, b) => b.threshold - a.threshold)

  for (const { key, threshold } of sorted) {
    if (pricing[key] === null || pricing[key] === undefined) {
      continue
    }
    const exceeds = promptTokens > threshold || (inclusive && promptTokens === threshold)
    if (exceeds) {
      return key.split('_above_')[1].split('_tokens')[0]
    }
  }

  return null
}

function isClaudePricing(modelName, pricing) {
  return (
    (typeof modelName === 'string' && modelName.toLowerCase().includes('claude')) ||
    (typeof pricing?.litellm_provider === 'string' &&
      pricing.litellm_provider.toLowerCase().includes('anthropic'))
  )
}

/**
 * 解析单价（per token），对应 LiteLLM generic_cost_per_token 的价格选择部分
 *
 * @param {Object} pricing - 价格表中的模型条目
 * @param {Object} options
 * @param {string} options.modelName - 模型名（用于识别 Claude）
 * @param {number} options.promptTokens - 总输入 tokens（含缓存创建/读取），用于判断长上下文阈值
 * @param {string|null} options.serviceTier - 请求的服务档位
 * @param {boolean} [options.applyLongContextThresholds] - 是否按阈值键选择长上下文价格（默认非 Claude 才套用）
 * @returns {{input:number, output:number, cacheCreate:number, cacheRead:number, ephemeral1h:number,
 *   serviceTier:string|null, longContextThreshold:string|null, isClaude:boolean, missingCacheRates:Object}}
 */
function resolveTokenRates(pricing, options = {}) {
  const { modelName = '', promptTokens = 0 } = options
  const serviceTier = normalizeServiceTier(options.serviceTier)
  const isClaude = isClaudePricing(modelName, pricing)
  // Claude 官方为统一价格（上下文长度不加价），默认不套用阈值键；其他模型按 LiteLLM 规则套用
  const applyLongContextThresholds =
    typeof options.applyLongContextThresholds === 'boolean'
      ? options.applyLongContextThresholds
      : !isClaude

  let input = getCostPerUnit(pricing, getServiceTierCostKey('input_cost_per_token', serviceTier), 0)
  let output = getCostPerUnit(
    pricing,
    getServiceTierCostKey('output_cost_per_token', serviceTier),
    0
  )

  // 图片生成模型没有 output_cost_per_token 时，用 output_cost_per_image_token（与 LiteLLM 一致）
  if (!output) {
    const imageOutput = getCostPerUnit(pricing, 'output_cost_per_image_token', null)
    if (imageOutput !== null) {
      output = imageOutput
    }
  }

  let cacheCreate = getCostPerUnit(
    pricing,
    getServiceTierCostKey('cache_creation_input_token_cost', serviceTier),
    null
  )
  let ephemeral1h = getCostPerUnit(pricing, 'cache_creation_input_token_cost_above_1hr', null)
  let cacheRead = getCostPerUnit(
    pricing,
    getServiceTierCostKey('cache_read_input_token_cost', serviceTier),
    null
  )

  let longContextThreshold = null
  if (applyLongContextThresholds) {
    const provider =
      typeof pricing?.litellm_provider === 'string' ? pricing.litellm_provider.toLowerCase() : ''
    longContextThreshold = findLongContextThreshold(
      pricing,
      promptTokens,
      serviceTier,
      INCLUSIVE_THRESHOLD_PROVIDERS.has(provider)
    )
  }

  if (longContextThreshold) {
    const t = longContextThreshold
    const tiered = (key) => getServiceTierCostKey(key, serviceTier)
    input = getCostPerUnit(pricing, tiered(`input_cost_per_token_above_${t}_tokens`), input)
    output = getCostPerUnit(pricing, tiered(`output_cost_per_token_above_${t}_tokens`), output)
    cacheCreate = getCostPerUnit(
      pricing,
      tiered(`cache_creation_input_token_cost_above_${t}_tokens`),
      cacheCreate
    )
    ephemeral1h = getCostPerUnit(
      pricing,
      tiered(`cache_creation_input_token_cost_above_1hr_above_${t}_tokens`),
      ephemeral1h
    )
    cacheRead = getCostPerUnit(
      pricing,
      tiered(`cache_read_input_token_cost_above_${t}_tokens`),
      cacheRead
    )
  }

  const missingCacheRates = {
    cacheCreate: cacheCreate === null,
    cacheRead: cacheRead === null,
    ephemeral1h: ephemeral1h === null
  }

  // 缓存价格缺失：LiteLLM 按输入价计费；Claude 沿用官方倍率兜底
  if (cacheCreate === null) {
    cacheCreate = isClaude ? input * CLAUDE_CACHE_MULTIPLIERS.write5m : input
  }
  if (cacheRead === null) {
    cacheRead = isClaude ? input * CLAUDE_CACHE_MULTIPLIERS.read : input
  }
  if (ephemeral1h === null) {
    ephemeral1h = isClaude ? input * CLAUDE_CACHE_MULTIPLIERS.write1h : cacheCreate
  }

  return {
    input,
    output,
    cacheCreate,
    cacheRead,
    ephemeral1h,
    serviceTier,
    longContextThreshold,
    isClaude,
    missingCacheRates
  }
}

/**
 * 价格条目是否带有可用于 token 计费的单价
 */
function hasTokenPricing(pricing) {
  return (
    !!pricing &&
    typeof pricing === 'object' &&
    (toNumber(pricing.input_cost_per_token) !== undefined ||
      toNumber(pricing.output_cost_per_token) !== undefined)
  )
}

module.exports = {
  SERVICE_TIER_TO_COST_KEY_SUFFIX,
  SERVICE_TIER_SUFFIXES,
  CLAUDE_CACHE_MULTIPLIERS,
  normalizeServiceTier,
  getServiceTierCostKey,
  getCostPerUnit,
  findLongContextThreshold,
  isClaudePricing,
  resolveTokenRates,
  hasTokenPricing
}
