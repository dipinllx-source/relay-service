/**
 * LiteLLM 计费规则 JS 实现测试
 *
 * 对齐 BerriAI/litellm litellm_core_utils/llm_cost_calc/utils.py：
 * - 档位价格键存在就用，缺失回退标准价（不依赖 supports_service_tier 标记）
 * - input_cost_per_token_above_<N>k_tokens 阈值键（优先带档位的阈值键）
 * - Claude 统一价格，不套用阈值
 */
const path = require('path')
const fs = require('fs')
const {
  normalizeServiceTier,
  getServiceTierCostKey,
  getCostPerUnit,
  findLongContextThreshold,
  resolveTokenRates,
  hasTokenPricing
} = require('../src/utils/litellmPricing')

const snapshot = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'resources', 'model-pricing', 'model_prices_and_context_window.json'),
    'utf8'
  )
)

describe('litellmPricing - 档位归一化', () => {
  it('识别 flex/balanced/priority/fast/ultrafast（大小写不敏感）', () => {
    expect(normalizeServiceTier('priority')).toBe('priority')
    expect(normalizeServiceTier(' Flex ')).toBe('flex')
    expect(normalizeServiceTier('FAST')).toBe('fast')
    expect(normalizeServiceTier('ultrafast')).toBe('ultrafast')
    expect(normalizeServiceTier('balanced')).toBe('balanced')
  })

  it('auto/default/scale/空值视为标准档位', () => {
    for (const tier of ['auto', 'default', 'scale', '', null, undefined, 123]) {
      expect(normalizeServiceTier(tier)).toBeNull()
    }
  })

  it('fast 映射到 priority 价格键', () => {
    expect(getServiceTierCostKey('input_cost_per_token', 'fast')).toBe(
      'input_cost_per_token_priority'
    )
    expect(getServiceTierCostKey('input_cost_per_token', 'auto')).toBe('input_cost_per_token')
  })
})

describe('litellmPricing - getCostPerUnit 回退', () => {
  const pricing = {
    input_cost_per_token: 0.000002,
    input_cost_per_token_priority: 0.000004,
    cache_read_input_token_cost: 0
  }

  it('档位键存在时直接使用', () => {
    expect(getCostPerUnit(pricing, 'input_cost_per_token_priority')).toBe(0.000004)
  })

  it('档位键缺失时回退去掉后缀的标准键', () => {
    expect(getCostPerUnit(pricing, 'input_cost_per_token_flex')).toBe(0.000002)
  })

  it('显式 0 保持为 0，不回退', () => {
    expect(getCostPerUnit(pricing, 'cache_read_input_token_cost', 1)).toBe(0)
  })

  it('完全缺失时返回默认值', () => {
    expect(getCostPerUnit(pricing, 'output_cost_per_token', null)).toBeNull()
  })
})

describe('litellmPricing - gpt-6.1-sol（LiteLLM 快照，无 supports_service_tier 标记）', () => {
  const pricing = snapshot['gpt-6.1-sol']

  it('快照中存在该模型', () => {
    expect(pricing).toBeDefined()
    expect(pricing.supports_service_tier).toBeUndefined()
  })

  it('未传档位按标准价', () => {
    const rates = resolveTokenRates(pricing, { modelName: 'gpt-6.1-sol', promptTokens: 1000 })
    expect(rates.serviceTier).toBeNull()
    expect(rates.input).toBeCloseTo(0.000002, 12)
    expect(rates.output).toBeCloseTo(0.00001, 12)
    expect(rates.cacheRead).toBeCloseTo(1e-7, 14)
    expect(rates.longContextThreshold).toBeNull()
  })

  it('auto/default 按标准价', () => {
    for (const tier of ['auto', 'default']) {
      const rates = resolveTokenRates(pricing, {
        modelName: 'gpt-6.1-sol',
        promptTokens: 1000,
        serviceTier: tier
      })
      expect(rates.input).toBeCloseTo(0.000002, 12)
    }
  })

  it('priority 按 2x 档位价', () => {
    const rates = resolveTokenRates(pricing, {
      modelName: 'gpt-6.1-sol',
      promptTokens: 1000,
      serviceTier: 'priority'
    })
    expect(rates.serviceTier).toBe('priority')
    expect(rates.input).toBeCloseTo(0.000004, 12)
    expect(rates.output).toBeCloseTo(0.00002, 12)
    expect(rates.cacheRead).toBeCloseTo(2e-7, 14)
  })

  it('fast 等同 priority', () => {
    const rates = resolveTokenRates(pricing, {
      modelName: 'gpt-6.1-sol',
      promptTokens: 1000,
      serviceTier: 'fast'
    })
    expect(rates.input).toBeCloseTo(0.000004, 12)
    expect(rates.output).toBeCloseTo(0.00002, 12)
  })

  it('flex 按半价', () => {
    const rates = resolveTokenRates(pricing, {
      modelName: 'gpt-6.1-sol',
      promptTokens: 1000,
      serviceTier: 'flex'
    })
    expect(rates.input).toBeCloseTo(0.000001, 12)
    expect(rates.output).toBeCloseTo(0.000005, 12)
    expect(rates.cacheRead).toBeCloseTo(5e-8, 14)
  })

  it('ultrafast 按 6x 档位价', () => {
    const rates = resolveTokenRates(pricing, {
      modelName: 'gpt-6.1-sol',
      promptTokens: 1000,
      serviceTier: 'ultrafast'
    })
    expect(rates.input).toBeCloseTo(0.000012, 12)
    expect(rates.output).toBeCloseTo(0.00006, 12)
    expect(rates.cacheRead).toBeCloseTo(6e-7, 14)
  })

  it('超过 272K 按长上下文价（标准档）', () => {
    const rates = resolveTokenRates(pricing, { modelName: 'gpt-6.1-sol', promptTokens: 300000 })
    expect(rates.longContextThreshold).toBe('272k')
    expect(rates.input).toBeCloseTo(0.000004, 12)
    expect(rates.output).toBeCloseTo(0.000015, 12)
    expect(rates.cacheRead).toBeCloseTo(2e-7, 14)
  })

  it('超过 272K + priority 优先使用带档位的阈值键', () => {
    const rates = resolveTokenRates(pricing, {
      modelName: 'gpt-6.1-sol',
      promptTokens: 300000,
      serviceTier: 'priority'
    })
    expect(rates.longContextThreshold).toBe('272k')
    expect(rates.input).toBeCloseTo(0.000008, 12)
    expect(rates.output).toBeCloseTo(0.00003, 12)
    expect(rates.cacheRead).toBeCloseTo(4e-7, 14)
  })

  it('正好 272K 不触发阈值（非 xai 为严格大于）', () => {
    const rates = resolveTokenRates(pricing, { modelName: 'gpt-6.1-sol', promptTokens: 272000 })
    expect(rates.longContextThreshold).toBeNull()
  })
})

describe('litellmPricing - 阈值与缓存兜底', () => {
  it('档位阈值键不参与标准档的阈值选择', () => {
    const pricing = {
      input_cost_per_token: 1,
      input_cost_per_token_above_100k_tokens_priority: 5,
      input_cost_per_token_above_100k_tokens_batches: 0.5
    }
    expect(findLongContextThreshold(pricing, 200000, null)).toBeNull()
    expect(findLongContextThreshold(pricing, 200000, 'priority')).toBe('100k')
  })

  it('多个阈值时选命中的最高阈值', () => {
    const pricing = {
      input_cost_per_token: 1,
      input_cost_per_token_above_128k_tokens: 2,
      input_cost_per_token_above_256k_tokens: 3
    }
    expect(findLongContextThreshold(pricing, 200000, null)).toBe('128k')
    expect(findLongContextThreshold(pricing, 300000, null)).toBe('256k')
  })

  it('xai 阈值按 >= 计算', () => {
    const pricing = {
      litellm_provider: 'xai',
      input_cost_per_token: 1,
      input_cost_per_token_above_128k_tokens: 2
    }
    const rates = resolveTokenRates(pricing, { modelName: 'grok-x', promptTokens: 128000 })
    expect(rates.longContextThreshold).toBe('128k')
    expect(rates.input).toBe(2)
  })

  it('非 Claude 模型缺失缓存价格时按输入价计', () => {
    const rates = resolveTokenRates(
      { input_cost_per_token: 0.00003, output_cost_per_token: 0.00018 },
      { modelName: 'gpt-5.4-pro', promptTokens: 1000 }
    )
    expect(rates.cacheRead).toBe(0.00003)
    expect(rates.cacheCreate).toBe(0.00003)
    expect(rates.ephemeral1h).toBe(0.00003)
    expect(rates.missingCacheRates.cacheRead).toBe(true)
  })

  it('Claude 缺失缓存价格时按官方倍率推导，且不套用阈值', () => {
    const rates = resolveTokenRates(
      {
        litellm_provider: 'anthropic',
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
        input_cost_per_token_above_200k_tokens: 0.000006
      },
      { modelName: 'claude-sonnet-x', promptTokens: 500000 }
    )
    expect(rates.isClaude).toBe(true)
    expect(rates.longContextThreshold).toBeNull()
    expect(rates.input).toBe(0.000003)
    expect(rates.cacheCreate).toBeCloseTo(0.00000375, 12)
    expect(rates.cacheRead).toBeCloseTo(0.0000003, 12)
    expect(rates.ephemeral1h).toBeCloseTo(0.000006, 12)
  })

  it('缺失 output_cost_per_token 时使用 output_cost_per_image_token', () => {
    const rates = resolveTokenRates(
      { input_cost_per_token: 0.000005, output_cost_per_image_token: 0.00004 },
      { modelName: 'gpt-image-x' }
    )
    expect(rates.output).toBe(0.00004)
  })

  it('hasTokenPricing 识别无价条目', () => {
    expect(hasTokenPricing({ litellm_provider: 'chatgpt', mode: 'responses' })).toBe(false)
    expect(hasTokenPricing({ input_cost_per_token: 0 })).toBe(true)
    expect(hasTokenPricing(null)).toBe(false)
  })
})
