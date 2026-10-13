// 空闲账号用量刷新服务单元测试
// 覆盖：资格筛选（只看 lastUsedAt 是否在 5h 之前）、每轮最多 2 个、无符合条件账号不处理、
//       处理后（成功/失败）lastUsedAt 更新为当前时间从而 5h 内不重复处理、锁互斥、并发重入、配置回退

jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

const mockConfig = {
  accountUsageRefresh: {
    enabled: true,
    intervalMs: 60000,
    idleHours: 5,
    maxPerTick: 2,
    model: null
  }
}
jest.mock('../config/config', () => mockConfig)

// 内存版 Redis（仅用于多实例互斥锁）：SET(PX, NX) / 锁释放 eval
const mockStore = new Map()
const mockRedisClient = {
  set: jest.fn(async (key, value, ...args) => {
    if (args.includes('NX') && mockStore.has(key)) {
      return null
    }
    mockStore.set(key, value)
    return 'OK'
  }),
  eval: jest.fn(async (_script, _numKeys, key, token) => {
    if (mockStore.get(key) === token) {
      mockStore.delete(key)
      return 1
    }
    return 0
  })
}
jest.mock('../src/models/redis', () => ({
  getClientSafe: () => mockRedisClient
}))

jest.mock('../src/services/account/openaiAccountService', () => ({
  getAllAccounts: jest.fn(),
  getAccount: jest.fn(),
  updateAccountUsage: jest.fn()
}))

jest.mock('../src/utils/upstreamErrorHelper', () => ({
  isTempUnavailable: jest.fn()
}))

jest.mock('../src/services/relay/openaiRelayService', () => ({
  probeAccountUsage: jest.fn()
}))

const openaiAccountService = require('../src/services/account/openaiAccountService')
const upstreamErrorHelper = require('../src/utils/upstreamErrorHelper')
const openaiRelayService = require('../src/services/relay/openaiRelayService')
const { AccountUsageRefreshService } = require('../src/services/accountUsageRefreshService')

const NOW = Date.parse('2026-10-13T12:00:00Z')
const HOUR = 3600 * 1000
const hoursAgo = (h) => new Date(NOW - h * HOUR).toISOString()

// 模拟账号存储：getAllAccounts 读出当前数据，updateAccountUsage 把 lastUsedAt 写成"当前时间"（mockClock）
let mockAccounts = []
let mockClock = NOW
const setAccounts = (list) => {
  mockAccounts = list
}
const lastUsedOf = (id) => mockAccounts.find((a) => a.id === id).lastUsedAt

const makeAccount = (id, overrides = {}) => ({
  id,
  name: `acc-${id}`,
  isActive: true,
  schedulable: true,
  status: 'active',
  lastUsedAt: hoursAgo(6),
  rateLimitStatus: { isRateLimited: false },
  ...overrides
})

const probeOk = {
  success: true,
  rateLimited: false,
  reachable: true,
  usageUpdated: true,
  error: null
}
const probeFail = {
  success: false,
  rateLimited: false,
  reachable: false,
  usageUpdated: false,
  error: 'token invalid'
}

let service

beforeEach(() => {
  jest.clearAllMocks()
  mockStore.clear()
  mockAccounts = []
  mockClock = NOW
  openaiAccountService.getAllAccounts.mockImplementation(async () =>
    mockAccounts.map((a) => ({ ...a }))
  )
  openaiAccountService.updateAccountUsage.mockImplementation(async (id) => {
    const account = mockAccounts.find((a) => a.id === id)
    if (account) {
      account.lastUsedAt = new Date(mockClock).toISOString()
    }
  })
  openaiAccountService.getAccount.mockResolvedValue({ codexPrimaryUsedPercent: '12' })
  upstreamErrorHelper.isTempUnavailable.mockResolvedValue(false)
  openaiRelayService.probeAccountUsage.mockResolvedValue(probeOk)
  mockConfig.accountUsageRefresh.maxPerTick = 2
  service = new AccountUsageRefreshService()
})

describe('资格筛选', () => {
  test('只处理最后使用时间在 5 小时之前且状态可用的账号', async () => {
    setAccounts([
      makeAccount('idle'),
      makeAccount('recent', { lastUsedAt: hoursAgo(4.9) }),
      makeAccount('inactive', { isActive: false }),
      makeAccount('disabled', { schedulable: 'false' }),
      makeAccount('error', { status: 'error' }),
      makeAccount('unauthorized', { status: 'unauthorized' }),
      makeAccount('limited', { rateLimitStatus: { isRateLimited: true } })
    ])
    mockConfig.accountUsageRefresh.maxPerTick = 10

    const result = await service.runOnce(NOW)

    expect(result.refreshed).toEqual(['idle'])
    expect(openaiRelayService.probeAccountUsage).toHaveBeenCalledTimes(1)
    expect(openaiRelayService.probeAccountUsage).toHaveBeenCalledWith('idle', null)
  })

  test('5 小时边界：恰好 5 小时算超过，差 1 秒不算', async () => {
    setAccounts([
      makeAccount('edge', { lastUsedAt: hoursAgo(5) }),
      makeAccount('almost', { lastUsedAt: new Date(NOW - 5 * HOUR + 1000).toISOString() })
    ])
    const result = await service.runOnce(NOW)
    expect(result.refreshed).toEqual(['edge'])
  })

  test('从未使用过的账号（无 lastUsedAt）视为超过 5 小时', async () => {
    setAccounts([makeAccount('never', { lastUsedAt: undefined })])
    const result = await service.runOnce(NOW)
    expect(result.refreshed).toEqual(['never'])
  })

  test('临时不可用的账号跳过', async () => {
    upstreamErrorHelper.isTempUnavailable.mockResolvedValue(true)
    setAccounts([makeAccount('temp')])
    const result = await service.runOnce(NOW)
    expect(result.refreshed).toEqual([])
    expect(openaiRelayService.probeAccountUsage).not.toHaveBeenCalled()
  })
})

describe('每轮上限与无候选', () => {
  test('5 个符合条件时本轮只处理最久未用的 2 个，其余留到下一轮', async () => {
    setAccounts([
      makeAccount('b', { lastUsedAt: hoursAgo(10) }),
      makeAccount('c', { lastUsedAt: hoursAgo(8) }),
      makeAccount('a', { lastUsedAt: hoursAgo(72) }),
      makeAccount('d', { lastUsedAt: hoursAgo(7) }),
      makeAccount('e', { lastUsedAt: hoursAgo(6) })
    ])

    const first = await service.runOnce(NOW)
    expect(first.refreshed).toEqual(['a', 'b'])
    expect(openaiRelayService.probeAccountUsage).toHaveBeenCalledTimes(2)

    // a、b 的 lastUsedAt 已更新为当前时间；下一轮继续处理 c、d
    expect(lastUsedOf('a')).toBe(new Date(NOW).toISOString())
    expect(lastUsedOf('b')).toBe(new Date(NOW).toISOString())
    mockClock = NOW + 60 * 1000
    const second = await service.runOnce(mockClock)
    expect(second.refreshed).toEqual(['c', 'd'])

    mockClock = NOW + 2 * 60 * 1000
    const third = await service.runOnce(mockClock)
    expect(third.refreshed).toEqual(['e'])

    // 全部处理过：之后 5 小时内的轮次什么都不做
    mockClock = NOW + 3 * 60 * 1000
    expect(await service.runOnce(mockClock)).toEqual({ refreshed: [], failed: [] })
    expect(openaiRelayService.probeAccountUsage).toHaveBeenCalledTimes(5)
  })

  test('没有符合条件的账号时不做任何处理', async () => {
    setAccounts([
      makeAccount('r1', { lastUsedAt: hoursAgo(1) }),
      makeAccount('r2', { lastUsedAt: hoursAgo(4) })
    ])
    const result = await service.runOnce(NOW)
    expect(result).toEqual({ refreshed: [], failed: [] })
    expect(openaiRelayService.probeAccountUsage).not.toHaveBeenCalled()
    expect(openaiAccountService.updateAccountUsage).not.toHaveBeenCalled()
  })
})

describe('结果处理', () => {
  test('成功后 lastUsedAt 更新为当前时间，5 小时内不再处理', async () => {
    setAccounts([makeAccount('ok')])
    await service.runOnce(NOW)
    expect(openaiAccountService.updateAccountUsage).toHaveBeenCalledWith('ok', 0)
    expect(lastUsedOf('ok')).toBe(new Date(NOW).toISOString())

    mockClock = NOW + 4.9 * HOUR
    expect(await service.runOnce(mockClock)).toEqual({ refreshed: [], failed: [] })
    expect(openaiRelayService.probeAccountUsage).toHaveBeenCalledTimes(1)
  })

  test('429 限流也算可达：lastUsedAt 更新', async () => {
    openaiRelayService.probeAccountUsage.mockResolvedValue({
      success: false,
      rateLimited: true,
      reachable: true,
      usageUpdated: true,
      error: '账户可达但已被限流'
    })
    setAccounts([makeAccount('rl')])
    const result = await service.runOnce(NOW)
    expect(result.refreshed).toEqual(['rl'])
    expect(lastUsedOf('rl')).toBe(new Date(NOW).toISOString())
  })

  test('失败也更新 lastUsedAt：5 小时内不再处理，5 小时后才再次处理', async () => {
    openaiRelayService.probeAccountUsage.mockResolvedValue(probeFail)
    setAccounts([makeAccount('bad')])

    const first = await service.runOnce(NOW)
    expect(first.failed).toEqual(['bad'])
    expect(lastUsedOf('bad')).toBe(new Date(NOW).toISOString())

    mockClock = NOW + 4.9 * HOUR
    expect(await service.runOnce(mockClock)).toEqual({ refreshed: [], failed: [] })
    expect(openaiRelayService.probeAccountUsage).toHaveBeenCalledTimes(1)

    mockClock = NOW + 5 * HOUR
    const after = await service.runOnce(mockClock)
    expect(after.failed).toEqual(['bad'])
    expect(openaiRelayService.probeAccountUsage).toHaveBeenCalledTimes(2)
  })

  test('探测抛异常按失败处理，同样更新 lastUsedAt', async () => {
    openaiRelayService.probeAccountUsage.mockRejectedValue(new Error('boom'))
    setAccounts([makeAccount('throw')])
    const result = await service.runOnce(NOW)
    expect(result.failed).toEqual(['throw'])
    expect(lastUsedOf('throw')).toBe(new Date(NOW).toISOString())
  })

  test('不写入任何额外的账号标识（Redis 只有互斥锁，且本轮结束已释放）', async () => {
    setAccounts([makeAccount('x'), makeAccount('y')])
    await service.runOnce(NOW)
    expect(mockStore.size).toBe(0)
  })
})

describe('互斥', () => {
  test('拿不到 Redis 锁时跳过本轮', async () => {
    mockStore.set('lock:account_usage_refresh', 'other-instance')
    const result = await service.runOnce(NOW)
    expect(result.skipped).toBe('locked')
    expect(openaiAccountService.getAllAccounts).not.toHaveBeenCalled()
    expect(mockStore.get('lock:account_usage_refresh')).toBe('other-instance')
  })

  test('上一轮未结束时不重入，结束后释放锁', async () => {
    let release
    openaiAccountService.getAllAccounts.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([])
      })
    )
    const first = service.runOnce(NOW)
    const second = await service.runOnce(NOW)
    expect(second.skipped).toBe('running')
    release()
    await first
    expect(mockStore.has('lock:account_usage_refresh')).toBe(false)
    expect(service.running).toBe(false)
  })
})

describe('配置回退', () => {
  const { getSettings } = require('../src/services/accountUsageRefreshService')
  const saved = mockConfig.accountUsageRefresh

  afterEach(() => {
    mockConfig.accountUsageRefresh = saved
    delete process.env.ACCOUNT_USAGE_REFRESH_IDLE_HOURS
    delete process.env.ACCOUNT_USAGE_REFRESH_ENABLED
  })

  test('config 缺少配置段时读取环境变量，默认每轮 2 个', () => {
    delete mockConfig.accountUsageRefresh
    process.env.ACCOUNT_USAGE_REFRESH_IDLE_HOURS = '3'
    const settings = getSettings()
    expect(settings.enabled).toBe(true)
    expect(settings.idleMs).toBe(3 * HOUR)
    expect(settings.maxPerTick).toBe(2)
    expect(settings.intervalMs).toBe(60000)
  })

  test('默认阈值 5 小时', () => {
    delete mockConfig.accountUsageRefresh
    expect(getSettings().idleMs).toBe(5 * HOUR)
  })

  test('环境变量可关闭', () => {
    delete mockConfig.accountUsageRefresh
    process.env.ACCOUNT_USAGE_REFRESH_ENABLED = 'false'
    expect(getSettings().enabled).toBe(false)
  })
})
