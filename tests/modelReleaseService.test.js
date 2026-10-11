/**
 * modelReleaseService 测试：官方模型价格列表的筛选、合并与排序
 */

jest.mock('../src/utils/logger', () => ({
  api: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn()
}))

const modelReleaseService = require('../src/services/modelReleaseService')

const { ModelReleaseService, extractReleaseEntries } = modelReleaseService

const price = (input, output, extra = {}) => ({
  input_cost_per_token: input / 1e6,
  output_cost_per_token: output / 1e6,
  ...extra
})

describe('extractReleaseEntries', () => {
  it('只抽取官方厂商且带发布日期的模型', () => {
    const entries = extractReleaseEntries({
      anthropic: {
        models: {
          'claude-opus-5': {
            id: 'claude-opus-5',
            name: 'Claude Opus 5',
            release_date: '2026-07-24'
          },
          'no-date': { id: 'no-date' }
        }
      },
      openrouter: {
        models: { 'anthropic/claude-opus-5': { id: 'x', release_date: '2026-07-24' } }
      }
    })
    expect(entries).toEqual([
      {
        provider: 'anthropic',
        id: 'claude-opus-5',
        name: 'Claude Opus 5',
        releaseDate: '2026-07-24'
      }
    ])
  })

  it('非对象输入返回空数组', () => {
    expect(extractReleaseEntries(null)).toEqual([])
    expect(extractReleaseEntries('x')).toEqual([])
  })
})

describe('buildOfficialPriceList', () => {
  const service = new ModelReleaseService()
  const catalog = {
    models: [
      { provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'S 4.5', releaseDate: '2025-09-29' },
      {
        provider: 'anthropic',
        id: 'claude-sonnet-4-5-20250929',
        name: 'S 4.5 snap',
        releaseDate: '2025-09-29'
      },
      { provider: 'openai', id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', releaseDate: '2026-09-29' },
      { provider: 'openai', id: 'gpt-5.5', name: 'GPT-5.5', releaseDate: '2026-04-23' },
      { provider: 'openai', id: 'gpt-5.5-2026-04-23', name: 'snap', releaseDate: '2026-04-23' },
      { provider: 'google', id: 'gemini-3.8-flash', name: 'Gemini 3.8', releaseDate: '2026-09-02' },
      { provider: 'xai', id: 'grok-4.7', name: 'Grok 4.7', releaseDate: '2026-09-21' },
      { provider: 'openai', id: 'gpt-image-2', name: 'Image', releaseDate: '2026-04-21' },
      { provider: 'openai', id: 'no-price-model', name: 'np', releaseDate: '2026-10-01' },
      { provider: 'unknown', id: 'foo', name: 'foo', releaseDate: '2026-10-05' }
    ]
  }
  const pricingData = {
    'claude-sonnet-4-5': price(3, 15, { cache_creation_input_token_cost: 3.75e-6 }),
    'claude-sonnet-4-5-20250929': price(3, 15),
    'gpt-6.1-sol': price(5, 30, { max_input_tokens: 1050000, max_tokens: 128000 }),
    'gpt-5.5': price(5, 30),
    'gpt-5.5-2026-04-23': price(6, 30),
    'gemini/gemini-3.8-flash': price(0.5, 3),
    'XAI/Grok-4.7': price(3, 15),
    'gpt-image-2': { input_cost_per_image: 0.04 },
    foo: price(1, 1)
  }

  const list = service.buildOfficialPriceList(pricingData, catalog)
  const ids = list.map((item) => item.id)

  it('按发布日期倒序', () => {
    expect(ids).toEqual([
      'gpt-6.1-sol',
      'grok-4.7',
      'gemini-3.8-flash',
      'gpt-5.5',
      'gpt-5.5-2026-04-23',
      'claude-sonnet-4-5'
    ])
  })

  it('跳过无 token 单价、无价格或非官方厂商的模型', () => {
    expect(ids).not.toContain('gpt-image-2')
    expect(ids).not.toContain('no-price-model')
    expect(ids).not.toContain('foo')
  })

  it('同日同价的日期快照并入别名，价格不同则保留', () => {
    const sonnet = list.find((item) => item.id === 'claude-sonnet-4-5')
    expect(sonnet.aliases).toEqual(['claude-sonnet-4-5-20250929'])
    expect(list.find((item) => item.id === 'gpt-5.5').aliases).toEqual([])
  })

  it('裸 id 缺失时按厂商前缀与大小写不敏感查找价格', () => {
    expect(list.find((item) => item.id === 'gemini-3.8-flash').pricingKey).toBe(
      'gemini/gemini-3.8-flash'
    )
    expect(list.find((item) => item.id === 'grok-4.7').pricingKey).toBe('XAI/Grok-4.7')
  })

  it('价格换算为 $/MTok，上下文优先取 max_input_tokens', () => {
    const sol = list.find((item) => item.id === 'gpt-6.1-sol')
    expect(sol.inputCost).toBeCloseTo(5)
    expect(sol.outputCost).toBeCloseTo(30)
    expect(sol.cacheReadCost).toBeNull()
    expect(sol.contextWindow).toBe(1050000)
    expect(sol.platform).toBe('openai')
    expect(list.find((item) => item.id === 'claude-sonnet-4-5').cacheCreateCost).toBeCloseTo(3.75)
  })

  it('价格表为空时返回空列表', () => {
    expect(service.buildOfficialPriceList(null, catalog)).toEqual([])
  })
})
