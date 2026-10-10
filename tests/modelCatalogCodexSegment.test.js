// modelCatalogService — codex 段（Codex 原生目录）

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
  fetchAvailableModels: jest.fn(async () => [{ id: 'claude-x', owned_by: 'anthropic' }]),
  clearModelsCache: jest.fn()
}))

jest.mock('../src/services/account/openaiAccountService', () => ({
  fetchAvailableModels: jest.fn(async () => [{ id: 'gpt-6.1-sol', owned_by: 'openai' }]),
  fetchCodexNativeModels: jest.fn(),
  clearModelsCache: jest.fn()
}))

const redis = require('../src/models/redis')
const openaiAccountService = require('../src/services/account/openaiAccountService')
const catalog = require('../src/services/modelCatalogService')

const CODEX_KEY = 'models:catalog:codex'
const NATIVE = [{ slug: 'gpt-6.1-sol', model_messages: { instructions_template: 'x' } }]

beforeEach(() => {
  redis.__store.clear()
  catalog.clearMemoryCache()
  catalog._inFlight.clear()
  jest.clearAllMocks()
})

describe('modelCatalogService codex 段', () => {
  test('首次使用时同步等待刷新，并持久化到 models:catalog:codex', async () => {
    openaiAccountService.fetchCodexNativeModels.mockResolvedValue(NATIVE)

    const models = await catalog.getCodexModels()

    expect(models).toEqual(NATIVE)
    expect(openaiAccountService.fetchCodexNativeModels).toHaveBeenCalledTimes(1)
    expect(JSON.parse(redis.__store.get(CODEX_KEY)).models).toEqual(NATIVE)
  })

  test('已有新鲜记录时直接返回，不打上游', async () => {
    const now = new Date().toISOString()
    redis.__store.set(
      CODEX_KEY,
      JSON.stringify({ models: NATIVE, fetchedAt: now, lastAttemptAt: now })
    )

    const models = await catalog.getCodexModels()

    expect(models).toEqual(NATIVE)
    expect(openaiAccountService.fetchCodexNativeModels).not.toHaveBeenCalled()
  })

  test('上游不可用且从未成功过时返回 null', async () => {
    openaiAccountService.fetchCodexNativeModels.mockResolvedValue(null)

    expect(await catalog.getCodexModels()).toBeNull()
  })

  test('首次等待超时返回 null，不无限阻塞', async () => {
    openaiAccountService.fetchCodexNativeModels.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(NATIVE), 200))
    )

    expect(await catalog.getCodexModels({ waitMs: 20 })).toBeNull()
  })

  test('默认刷新包含 codex 段；codex 段强制刷新不重复清上游缓存', async () => {
    openaiAccountService.fetchCodexNativeModels.mockResolvedValue(NATIVE)

    const results = await catalog.refresh({ force: true, trigger: 'admin' })

    expect(Object.keys(results)).toEqual(['claude', 'openai', 'codex'])
    expect(results.codex.updated).toBe(true)
    // 只有 openai 段清了一次
    expect(openaiAccountService.clearModelsCache).toHaveBeenCalledTimes(1)
  })

  test('管理台状态与完整清单不暴露 codex 段', async () => {
    const status = await catalog.getStatus()
    const full = await catalog.getCatalog()

    expect(status.codex).toBeUndefined()
    expect(full.codex).toBeUndefined()
  })
})
