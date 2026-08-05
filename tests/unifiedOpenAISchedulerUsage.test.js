// unifiedOpenAIScheduler 周限用量感知调度单元测试
// 覆盖：band 计算、排序（关闭态等价现状 / 同档 LRU / 跨档覆盖 LRU）、硬保护（剔除 / 池空放行 / 关闭）

jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  api: jest.fn()
}))

const mockConfig = {
  openai: {
    usageBandWidth: 30,
    usageHardLimit: 95
  },
  session: {}
}
jest.mock('../config/config', () => mockConfig)

jest.mock('../src/services/account/openaiAccountService', () => ({}))
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({}))
jest.mock('../src/services/account/openaiCompatibleAccountService', () => ({}))
jest.mock('../src/services/accountGroupService', () => ({}))
jest.mock('../src/models/redis', () => ({}))
jest.mock('../src/utils/upstreamErrorHelper', () => ({
  isTempUnavailable: jest.fn(),
  markTempUnavailable: jest.fn()
}))
jest.mock('../src/utils/commonHelper', () => ({
  isSchedulable: jest.fn(() => true),
  sortAccountsByPriority: jest.requireActual('../src/utils/commonHelper').sortAccountsByPriority
}))

const { sortAccountsByPriority } = require('../src/utils/commonHelper')
const scheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
const logger = require('../src/utils/logger')

const makeAccount = (name, { percent, priority = 50, lastUsedAt, createdAt } = {}) => ({
  name,
  priority,
  lastUsedAt: lastUsedAt || '0',
  createdAt: createdAt || '2026-01-01T00:00:00.000Z',
  ...(percent !== undefined ? { codexPrimaryUsedPercent: String(percent) } : {})
})

beforeEach(() => {
  mockConfig.openai.usageBandWidth = 30
  mockConfig.openai.usageHardLimit = 95
  jest.clearAllMocks()
})

describe('_codexUsedPercent / _codexUsageBand', () => {
  test('缺失字段返回 null，band 为 0', () => {
    const account = makeAccount('a')
    expect(scheduler._codexUsedPercent(account)).toBeNull()
    expect(scheduler._codexUsageBand(account)).toBe(0)
  })

  test('非数值返回 null，band 为 0', () => {
    const account = makeAccount('a', { percent: 'abc' })
    expect(scheduler._codexUsedPercent(account)).toBeNull()
    expect(scheduler._codexUsageBand(account)).toBe(0)
  })

  test('band 边界：0/29.9 落 band 0，30 落 band 1，95 落 band 3（档宽 30）', () => {
    expect(scheduler._codexUsageBand(makeAccount('a', { percent: 0 }))).toBe(0)
    expect(scheduler._codexUsageBand(makeAccount('a', { percent: 29.9 }))).toBe(0)
    expect(scheduler._codexUsageBand(makeAccount('a', { percent: 30 }))).toBe(1)
    expect(scheduler._codexUsageBand(makeAccount('a', { percent: 95 }))).toBe(3)
  })

  test('档宽 100 时全部落 band 0（等效关闭分档）', () => {
    mockConfig.openai.usageBandWidth = 100
    expect(scheduler._codexUsageBand(makeAccount('a', { percent: 99 }))).toBe(0)
    expect(scheduler._codexUsageBand(makeAccount('a', { percent: 1 }))).toBe(0)
  })

  test('负数用量钳制到 band 0', () => {
    expect(scheduler._codexUsageBand(makeAccount('a', { percent: -5 }))).toBe(0)
  })
})

describe('_sortAccountsForOpenAI', () => {
  test('关闭态（档宽 100）排序结果与 sortAccountsByPriority 逐元素一致', () => {
    mockConfig.openai.usageBandWidth = 100
    const accounts = [
      makeAccount('c', { percent: 90, priority: 50, lastUsedAt: '2026-07-30T03:00:00.000Z' }),
      makeAccount('a', { percent: 10, priority: 40, lastUsedAt: '2026-07-30T01:00:00.000Z' }),
      makeAccount('b', { percent: 50, priority: 50, lastUsedAt: '2026-07-30T02:00:00.000Z' }),
      makeAccount('d', { priority: 50, lastUsedAt: '2026-07-30T04:00:00.000Z' })
    ]
    const expected = sortAccountsByPriority(accounts).map((a) => a.name)
    const actual = scheduler._sortAccountsForOpenAI(accounts).map((a) => a.name)
    expect(actual).toEqual(expected)
  })

  test('同优先级不同档：低档优先，无视 lastUsedAt', () => {
    const low = makeAccount('low', { percent: 13, lastUsedAt: '2026-07-30T09:00:00.000Z' })
    const high = makeAccount('high', { percent: 55, lastUsedAt: '2026-07-30T01:00:00.000Z' })
    const sorted = scheduler._sortAccountsForOpenAI([high, low])
    expect(sorted.map((a) => a.name)).toEqual(['low', 'high'])
  })

  test('同档内保持 LRU（lastUsedAt ASC）', () => {
    const older = makeAccount('older', { percent: 20, lastUsedAt: '2026-07-30T01:00:00.000Z' })
    const newer = makeAccount('newer', { percent: 13, lastUsedAt: '2026-07-30T09:00:00.000Z' })
    const sorted = scheduler._sortAccountsForOpenAI([newer, older])
    expect(sorted.map((a) => a.name)).toEqual(['older', 'newer'])
  })

  test('priority 仍是第一排序键，高档低 priority 优先于低档高 priority', () => {
    const vip = makeAccount('vip', { percent: 80, priority: 10 })
    const normal = makeAccount('normal', { percent: 5, priority: 50 })
    const sorted = scheduler._sortAccountsForOpenAI([normal, vip])
    expect(sorted.map((a) => a.name)).toEqual(['vip', 'normal'])
  })

  test('缺数据账号按 band 0 参与排序，不被惩罚', () => {
    const noData = makeAccount('noData', { lastUsedAt: '2026-07-30T01:00:00.000Z' })
    const used = makeAccount('used', { percent: 55, lastUsedAt: '2026-07-30T02:00:00.000Z' })
    const sorted = scheduler._sortAccountsForOpenAI([used, noData])
    expect(sorted.map((a) => a.name)).toEqual(['noData', 'used'])
  })

  test('不修改入参数组', () => {
    const accounts = [makeAccount('b', { percent: 55 }), makeAccount('a', { percent: 5 })]
    scheduler._sortAccountsForOpenAI(accounts)
    expect(accounts.map((a) => a.name)).toEqual(['b', 'a'])
  })
})

describe('_applyUsageHardLimit', () => {
  test('部分账号超限：仅剔除超限账号', () => {
    const ok = makeAccount('ok', { percent: 40 })
    const over = makeAccount('over', { percent: 96 })
    const result = scheduler._applyUsageHardLimit([ok, over])
    expect(result.map((a) => a.name)).toEqual(['ok'])
  })

  test('阈值为边界值：等于阈值即剔除', () => {
    const at = makeAccount('at', { percent: 95 })
    const under = makeAccount('under', { percent: 94.9 })
    const result = scheduler._applyUsageHardLimit([at, under])
    expect(result.map((a) => a.name)).toEqual(['under'])
  })

  test('全部超限：池空放行全部并记 warn', () => {
    const a = makeAccount('a', { percent: 97 })
    const b = makeAccount('b', { percent: 99 })
    const result = scheduler._applyUsageHardLimit([a, b])
    expect(result.map((x) => x.name)).toEqual(['a', 'b'])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('usage hard limit'))
  })

  test('缺数据账号不受硬保护影响', () => {
    const noData = makeAccount('noData')
    const over = makeAccount('over', { percent: 98 })
    const result = scheduler._applyUsageHardLimit([noData, over])
    expect(result.map((a) => a.name)).toEqual(['noData'])
  })

  test('hardLimit=100 时不剔除任何账号', () => {
    mockConfig.openai.usageHardLimit = 100
    const over = makeAccount('over', { percent: 99.9 })
    const result = scheduler._applyUsageHardLimit([over])
    expect(result.map((a) => a.name)).toEqual(['over'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('空数组直接返回', () => {
    expect(scheduler._applyUsageHardLimit([])).toEqual([])
  })
})
