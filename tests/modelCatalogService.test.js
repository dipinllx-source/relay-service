// modelCatalogService — 全局日限流 + Redis 持久化 + stale-while-error + 分布式锁

jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

jest.mock('../config/config', () => ({
  models: {
    catalogSuccessTtlMs: 24 * 60 * 60 * 1000,
    catalogFailureRetryMs: 30 * 60 * 1000
  }
}))

jest.mock('../src/models/redis', () => {
  const store = new Map()
  return {
    __store: store,
    get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key, value, ...args) => {
      if (args.includes('NX') && store.has(key)) {
        return null
      }
      store.set(key, value)
      return 'OK'
    }),
    del: jest.fn(async (...keys) => {
      let removed = 0
      for (const key of keys) {
        if (store.delete(key)) {
          removed += 1
        }
      }
      return removed
    })
  }
})

jest.mock('../src/services/account/claudeAccountService', () => ({
  fetchAvailableModels: jest.fn(),
  clearModelsCache: jest.fn()
}))

jest.mock('../src/services/account/openaiAccountService', () => ({
  fetchAvailableModels: jest.fn(),
  clearModelsCache: jest.fn()
}))

const redis = require('../src/models/redis')
const claudeAccountService = require('../src/services/account/claudeAccountService')
const catalog = require('../src/services/modelCatalogService')

const CLAUDE_KEY = 'models:catalog:claude'
const LOCK_KEY = 'models:catalog:lock'

const UPSTREAM = [
  { id: 'claude-opus-5', object: 'model', created: 1, owned_by: 'anthropic' },
  { id: 'claude-sonnet-5', object: 'model', created: 1, owned_by: 'anthropic' }
]

function writeRecord(record) {
  redis.__store.set(CLAUDE_KEY, JSON.stringify(record))
}

function readRecord() {
  const raw = redis.__store.get(CLAUDE_KEY)
  return raw ? JSON.parse(raw) : null
}

// 等后台刷新跑完（_refreshInBackground 是 fire-and-forget）
async function flushBackground() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
    await new Promise((resolve) => setImmediate(resolve))
  }
}

beforeEach(() => {
  redis.__store.clear()
  catalog.clearMemoryCache()
  claudeAccountService.fetchAvailableModels.mockReset()
  claudeAccountService.clearModelsCache.mockReset()
})

describe('modelCatalogService', () => {
  test('冷启动：先返回 null 让调用方兜底，后台补齐清单', async () => {
    claudeAccountService.fetchAvailableModels.mockResolvedValue(UPSTREAM)

    const first = await catalog.getClaudeModels()
    expect(first).toBeNull()

    await flushBackground()

    expect(claudeAccountService.fetchAvailableModels).toHaveBeenCalledTimes(1)
    const record = readRecord()
    expect(record.count).toBe(2)
    expect(record.source).toBe('upstream')

    catalog.clearMemoryCache()
    const second = await catalog.getClaudeModels()
    expect(second.map((m) => m.id)).toEqual(['claude-opus-5', 'claude-sonnet-5'])
  })

  test('清单新鲜时不打上游（全局日限流）', async () => {
    writeRecord({
      models: UPSTREAM,
      count: 2,
      source: 'upstream',
      fetchedAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      lastError: null
    })

    const models = await catalog.getClaudeModels()
    await flushBackground()

    expect(models).toHaveLength(2)
    expect(claudeAccountService.fetchAvailableModels).not.toHaveBeenCalled()
  })

  test('清单过期：本次照常返回旧清单，刷新在后台进行', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    writeRecord({
      models: [{ id: 'claude-old', object: 'model', created: 1, owned_by: 'anthropic' }],
      count: 1,
      source: 'upstream',
      fetchedAt: old,
      lastAttemptAt: old,
      lastError: null
    })
    claudeAccountService.fetchAvailableModels.mockResolvedValue(UPSTREAM)

    const models = await catalog.getClaudeModels()
    expect(models.map((m) => m.id)).toEqual(['claude-old'])

    await flushBackground()
    expect(claudeAccountService.fetchAvailableModels).toHaveBeenCalledTimes(1)
    expect(readRecord().count).toBe(2)
  })

  test('stale-while-error：刷新失败保留旧清单并记录 lastError', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    writeRecord({
      models: UPSTREAM,
      count: 2,
      source: 'upstream',
      fetchedAt: old,
      lastAttemptAt: old,
      lastError: null
    })
    claudeAccountService.fetchAvailableModels.mockRejectedValue(new Error('upstream 503'))

    const result = await catalog.refresh({ segments: ['claude'] })

    expect(result.claude.updated).toBe(false)
    expect(result.claude.error).toContain('upstream 503')
    const record = readRecord()
    expect(record.models).toHaveLength(2)
    expect(record.lastError).toContain('upstream 503')
    expect(record.fetchedAt).toBe(old)
  })

  test('失败节流：失败后短时间内不再打上游', async () => {
    claudeAccountService.fetchAvailableModels.mockResolvedValue(null)

    await catalog.refresh({ segments: ['claude'] })
    expect(claudeAccountService.fetchAvailableModels).toHaveBeenCalledTimes(1)

    const second = await catalog.refresh({ segments: ['claude'] })
    expect(second.claude.reason).toBe('retry-throttled')
    expect(claudeAccountService.fetchAvailableModels).toHaveBeenCalledTimes(1)
  })

  test('force 刷新跳过节流，并清掉 account service 的短缓存', async () => {
    writeRecord({
      models: UPSTREAM,
      count: 2,
      source: 'upstream',
      fetchedAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      lastError: null
    })
    claudeAccountService.fetchAvailableModels.mockResolvedValue(UPSTREAM)

    const result = await catalog.refresh({ segments: ['claude'], force: true, trigger: 'admin' })

    expect(result.claude.updated).toBe(true)
    expect(claudeAccountService.clearModelsCache).toHaveBeenCalledTimes(1)
    expect(readRecord().trigger).toBe('admin')
  })

  test('分布式锁：已有刷新在跑时直接跳过', async () => {
    redis.__store.set(LOCK_KEY, 'someone-else')
    claudeAccountService.fetchAvailableModels.mockResolvedValue(UPSTREAM)

    const result = await catalog.refresh({ segments: ['claude'], force: true })

    expect(result.claude.reason).toBe('locked')
    expect(claudeAccountService.fetchAvailableModels).not.toHaveBeenCalled()
    // 不是自己拿的锁，不能删
    expect(redis.__store.get(LOCK_KEY)).toBe('someone-else')
  })

  test('getStatus 汇报条数/来源/新鲜度/错误', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    writeRecord({
      models: UPSTREAM,
      count: 2,
      source: 'upstream',
      fetchedAt: old,
      lastAttemptAt: old,
      lastError: 'boom'
    })

    const status = await catalog.getStatus()
    expect(status.claude.count).toBe(2)
    expect(status.claude.fresh).toBe(false)
    expect(status.claude.lastError).toBe('boom')
    expect(status.openai.count).toBe(0)
    expect(status.openai.source).toBe('fallback')
    expect(status.successTtlMs).toBe(24 * 60 * 60 * 1000)
  })
})
