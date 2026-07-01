// Tests for fetchAvailableModels() — 上游动态模型列表 + TTL 缓存 + 失败短缓存

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}))

jest.mock('../../../src/models/redis', () => ({
  getClaudeAccount: jest.fn(),
  setClaudeAccount: jest.fn(),
  getAllClaudeAccounts: jest.fn(),
  getClientSafe: () => ({
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK')
  })
}))

jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  authDetail: jest.fn()
}))

jest.mock('../../../src/utils/tokenRefreshLogger', () => ({
  logRefreshStart: jest.fn(),
  logRefreshSuccess: jest.fn(),
  logRefreshError: jest.fn(),
  logRefreshSkipped: jest.fn(),
  logTokenUsage: jest.fn()
}))

jest.mock('../../../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn(() => null),
  getProxyDescription: jest.fn(() => 'none')
}))

const axios = require('axios')
const redis = require('../../../src/models/redis')
// IMPORTANT: require service AFTER mocks are set up
const claudeAccountService = require('../../../src/services/account/claudeAccountService')

function makeAccount(overrides = {}) {
  return {
    id: 'acc-1',
    name: 'TestAccount',
    proxy: '',
    isActive: 'true',
    status: 'active',
    schedulable: 'true',
    ...overrides
  }
}

function upstreamModels(ids) {
  return {
    status: 200,
    data: { data: ids.map((id) => ({ id, type: 'model', display_name: id })) }
  }
}

beforeEach(() => {
  axios.get.mockReset()
  redis.getAllClaudeAccounts.mockReset()
  claudeAccountService._modelsCache = { data: null, fetchedAt: 0, failedAt: 0 }
  jest.spyOn(claudeAccountService, 'getValidAccessToken').mockResolvedValue('TEST_TOKEN')
  jest.spyOn(claudeAccountService, 'isSubscriptionExpired').mockReturnValue(false)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('fetchAvailableModels', () => {
  test('成功拉取并规范化为 OpenAI list 条目', async () => {
    redis.getAllClaudeAccounts.mockResolvedValue([makeAccount()])
    axios.get.mockResolvedValue(upstreamModels(['claude-fable-5', 'claude-opus-4-8']))

    const models = await claudeAccountService.fetchAvailableModels()

    expect(models).toHaveLength(2)
    expect(models[0]).toMatchObject({
      id: 'claude-fable-5',
      object: 'model',
      owned_by: 'anthropic'
    })
    expect(typeof models[0].created).toBe('number')

    const [url, axiosConfig] = axios.get.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=100')
    expect(axiosConfig.headers.Authorization).toBe('Bearer TEST_TOKEN')
    expect(axiosConfig.headers['anthropic-beta']).toBe('oauth-2025-04-20')
    expect(axiosConfig.headers['anthropic-version']).toBeDefined()
  })

  test('无可用账户返回 null 且不请求上游', async () => {
    redis.getAllClaudeAccounts.mockResolvedValue([
      makeAccount({ isActive: 'false' }),
      makeAccount({ id: 'acc-2', status: 'error' }),
      makeAccount({ id: 'acc-3', schedulable: 'false' })
    ])

    const models = await claudeAccountService.fetchAvailableModels()

    expect(models).toBeNull()
    expect(axios.get).not.toHaveBeenCalled()
  })

  test('上游异常返回 null 不抛出', async () => {
    redis.getAllClaudeAccounts.mockResolvedValue([makeAccount()])
    axios.get.mockRejectedValue(
      Object.assign(new Error('Request failed'), { response: { status: 500 } })
    )

    await expect(claudeAccountService.fetchAvailableModels()).resolves.toBeNull()
  })

  test('上游空列表视为失败返回 null', async () => {
    redis.getAllClaudeAccounts.mockResolvedValue([makeAccount()])
    axios.get.mockResolvedValue({ status: 200, data: { data: [] } })

    await expect(claudeAccountService.fetchAvailableModels()).resolves.toBeNull()
  })

  test('成功结果缓存命中时不重复请求上游', async () => {
    redis.getAllClaudeAccounts.mockResolvedValue([makeAccount()])
    axios.get.mockResolvedValue(upstreamModels(['claude-fable-5']))

    const first = await claudeAccountService.fetchAvailableModels()
    const second = await claudeAccountService.fetchAvailableModels()

    expect(first).toEqual(second)
    expect(axios.get).toHaveBeenCalledTimes(1)
    expect(redis.getAllClaudeAccounts).toHaveBeenCalledTimes(1)
  })

  test('失败结果短缓存：窗口内直接返回 null 不再请求', async () => {
    redis.getAllClaudeAccounts.mockResolvedValue([makeAccount()])
    axios.get.mockRejectedValue(new Error('timeout'))

    await claudeAccountService.fetchAvailableModels()
    await claudeAccountService.fetchAvailableModels()

    expect(axios.get).toHaveBeenCalledTimes(1)
  })

  test('失败短缓存过期后重新尝试', async () => {
    redis.getAllClaudeAccounts.mockResolvedValue([makeAccount()])
    axios.get.mockRejectedValueOnce(new Error('timeout'))
    axios.get.mockResolvedValueOnce(upstreamModels(['claude-fable-5']))

    await claudeAccountService.fetchAvailableModels()
    claudeAccountService._modelsCache.failedAt = Date.now() - 120 * 1000

    const models = await claudeAccountService.fetchAvailableModels()
    expect(models).toHaveLength(1)
    expect(axios.get).toHaveBeenCalledTimes(2)
  })
})
