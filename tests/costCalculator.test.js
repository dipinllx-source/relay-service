jest.mock('../src/services/pricingService', () => ({
  calculateCost: jest.fn(),
  getModelPricing: jest.fn()
}))

jest.mock('../src/utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn(),
  database: jest.fn(),
  api: jest.fn(),
  security: jest.fn()
}))

describe('CostCalculator', () => {
  let CostCalculator
  let pricingService
  let logger

  beforeEach(() => {
    jest.resetModules()

    pricingService = require('../src/services/pricingService')
    logger = require('../src/utils/logger')
    CostCalculator = require('../src/utils/costCalculator')

    jest.clearAllMocks()
    pricingService.calculateCost.mockReset()
    pricingService.getModelPricing.mockReset()
  })

  it('uses detailed pricing when pricingService returns a complete result', () => {
    pricingService.calculateCost.mockReturnValue({
      hasPricing: true,
      isLongContextRequest: false,
      inputCost: 0.003,
      outputCost: 0.0075,
      cacheCreateCost: 0.00075,
      cacheReadCost: 0.00003,
      totalCost: 0.01128,
      pricing: {
        input: 0.000003,
        output: 0.000015,
        cacheCreate: 0.00000375,
        cacheRead: 0.0000003
      }
    })

    const result = CostCalculator.calculateCost(
      {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 100,
        cache_creation: {
          ephemeral_5m_input_tokens: 200,
          ephemeral_1h_input_tokens: 0
        }
      },
      'claude-sonnet-4-20250514'
    )

    expect(result.usingDynamicPricing).toBe(true)
    expect(result.pricing.input).toBe(3)
    expect(result.pricing.cacheWrite).toBe(3.75)
    expect(result.costs.total).toBeCloseTo(0.01128, 10)
    expect(result.debug.usedFallbackPricing).toBe(false)
    expect(result.debug.pricingSource).toBe('dynamic')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('falls back to unknown pricing for detailed-cache requests with missing model pricing', () => {
    pricingService.calculateCost.mockReturnValue({
      hasPricing: false,
      totalCost: 0,
      isLongContextRequest: false
    })
    pricingService.getModelPricing.mockReturnValue(null)

    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 100,
      cache_creation: {
        ephemeral_5m_input_tokens: 100,
        ephemeral_1h_input_tokens: 100
      }
    }

    const first = CostCalculator.calculateCost(usage, 'kimi-k2.5')
    const second = CostCalculator.calculateCost(usage, 'kimi-k2.5')

    expect(first.usingDynamicPricing).toBe(false)
    expect(first.pricing.input).toBe(3)
    expect(first.pricing.cacheWrite).toBe(3.75)
    expect(first.costs.total).toBeCloseTo(0.01128, 10)
    expect(first.debug.usedFallbackPricing).toBe(true)
    expect(first.debug.pricingSource).toBe('unknown-fallback')
    expect(second.costs.total).toBeCloseTo(first.costs.total, 10)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toContain('kimi-k2.5')
  })

  it('falls back instead of throwing for unknown long-context models', () => {
    pricingService.calculateCost.mockReturnValue({
      hasPricing: false,
      totalCost: 0,
      isLongContextRequest: false
    })
    pricingService.getModelPricing.mockReturnValue(null)

    const result = CostCalculator.calculateCost(
      {
        input_tokens: 250000,
        output_tokens: 1000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      },
      'mystery-model[1m]'
    )

    expect(result.usingDynamicPricing).toBe(false)
    expect(result.costs.total).toBeCloseTo(0.765, 10)
    expect(result.debug.usedFallbackPricing).toBe(true)
    expect(result.debug.isLongContextModel).toBe(true)
    expect(result.debug.pricingSource).toBe('unknown-fallback')
  })

  it('keeps the legacy dynamic-pricing path for regular requests', () => {
    pricingService.getModelPricing.mockReturnValue({
      input_cost_per_token: 0.000002,
      output_cost_per_token: 0.000008,
      cache_creation_input_token_cost: 0.0000025,
      cache_read_input_token_cost: 0.0000002
    })

    const result = CostCalculator.calculateCost(
      {
        input_tokens: 2000,
        output_tokens: 1000,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 250
      },
      'glm-5'
    )

    expect(pricingService.calculateCost).not.toHaveBeenCalled()
    expect(result.usingDynamicPricing).toBe(true)
    expect(result.pricing.input).toBe(2)
    expect(result.pricing.output).toBe(8)
    expect(result.costs.total).toBeCloseTo(0.0133, 10)
    expect(result.debug.usedFallbackPricing).toBe(false)
    expect(result.debug.pricingSource).toBe('dynamic')
  })

  it('legacy path applies service tier prices without supports_service_tier flag', () => {
    pricingService.getModelPricing.mockReturnValue({
      litellm_provider: 'openai',
      input_cost_per_token: 0.000002,
      output_cost_per_token: 0.00001,
      cache_read_input_token_cost: 1e-7,
      input_cost_per_token_priority: 0.000004,
      output_cost_per_token_priority: 0.00002,
      cache_read_input_token_cost_priority: 2e-7,
      input_cost_per_token_above_272k_tokens: 0.000004,
      input_cost_per_token_above_272k_tokens_priority: 0.000008,
      output_cost_per_token_above_272k_tokens_priority: 0.00003
    })

    const usage = {
      input_tokens: 1000,
      output_tokens: 1000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1000
    }

    const standard = CostCalculator.calculateCost(usage, 'gpt-6.1-sol')
    expect(standard.pricing.input).toBeCloseTo(2, 10)
    expect(standard.pricing.output).toBeCloseTo(10, 10)
    expect(standard.debug.serviceTier).toBeNull()

    const priority = CostCalculator.calculateCost(usage, 'gpt-6.1-sol', 'priority')
    expect(priority.pricing.input).toBeCloseTo(4, 10)
    expect(priority.pricing.output).toBeCloseTo(20, 10)
    expect(priority.pricing.cacheRead).toBeCloseTo(0.2, 10)
    expect(priority.debug.serviceTier).toBe('priority')
    expect(priority.costs.total).toBeCloseTo((1000 * 4 + 1000 * 20 + 1000 * 0.2) / 1e6, 12)

    const fast = CostCalculator.calculateCost(usage, 'gpt-6.1-sol', 'fast')
    expect(fast.pricing.input).toBeCloseTo(4, 10)

    const longPriority = CostCalculator.calculateCost(
      { ...usage, input_tokens: 300000 },
      'gpt-6.1-sol',
      'priority'
    )
    expect(longPriority.isLongContextRequest).toBe(true)
    expect(longPriority.debug.longContextThreshold).toBe('272k')
    expect(longPriority.pricing.input).toBeCloseTo(8, 10)
    expect(longPriority.pricing.output).toBeCloseTo(30, 10)
  })

  it('passes service tier to pricingService on the detailed path', () => {
    pricingService.calculateCost.mockReturnValue({
      hasPricing: true,
      isLongContextRequest: false,
      serviceTier: 'priority',
      longContextThreshold: null,
      inputCost: 0.004,
      outputCost: 0.02,
      cacheCreateCost: 0,
      cacheReadCost: 0,
      totalCost: 0.024,
      pricing: { input: 0.000004, output: 0.00002, cacheCreate: 0.000004, cacheRead: 2e-7 }
    })

    const usage = {
      input_tokens: 1000,
      output_tokens: 1000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }
    }
    const result = CostCalculator.calculateCost(usage, 'gpt-6.1-sol', 'priority')

    expect(pricingService.calculateCost).toHaveBeenCalledWith(usage, 'gpt-6.1-sol', 'priority')
    expect(result.debug.serviceTier).toBe('priority')
    expect(result.costs.total).toBeCloseTo(0.024, 10)
  })
})
