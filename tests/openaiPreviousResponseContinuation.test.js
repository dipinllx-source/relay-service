// HTTP previous_response_id 续链约束单元测试
// 对齐 sub2api v0.1.180（commit c374ff295）的行为：
// 带 previous_response_id 的 HTTP 请求只能落到 API key 上游（relay 的 openai-responses 账号），
// OAuth/Codex 账号被跳过而不是静默丢弃续链状态；没有可用 API key 上游时返回 400。

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

jest.mock('../src/services/account/openaiAccountService', () => ({
  getAccount: jest.fn(),
  isTokenExpired: jest.fn(() => false)
}))
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn(),
  isSubscriptionExpired: jest.fn(() => false),
  checkAndClearRateLimit: jest.fn(() => true)
}))
jest.mock('../src/services/account/openaiCompatibleAccountService', () => ({}))
jest.mock('../src/services/accountGroupService', () => ({}))
jest.mock('../src/models/redis', () => ({}))
jest.mock('../src/utils/upstreamErrorHelper', () => ({
  isTempUnavailable: jest.fn(async () => false),
  markTempUnavailable: jest.fn()
}))
jest.mock('../src/utils/commonHelper', () => ({
  isSchedulable: jest.fn(() => true),
  sortAccountsByPriority: jest.requireActual('../src/utils/commonHelper').sortAccountsByPriority
}))

const scheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')

const CONTINUATION_MESSAGE =
  'previous_response_id requires an OpenAI API-key account for HTTP requests'

const apiKeyData = { id: 'key-1', name: 'test-key' }

const oauthCandidate = {
  id: 'oauth-1',
  accountId: 'oauth-1',
  name: 'oauth-account',
  accountType: 'openai',
  priority: 10,
  lastUsedAt: '0',
  createdAt: '2026-01-01T00:00:00.000Z'
}

const apiKeyCandidate = {
  id: 'resp-1',
  accountId: 'resp-1',
  name: 'responses-account',
  accountType: 'openai-responses',
  priority: 90,
  lastUsedAt: '0',
  createdAt: '2026-01-01T00:00:00.000Z'
}

describe('unifiedOpenAIScheduler previous_response_id 续链约束', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(scheduler, 'updateAccountLastUsed').mockResolvedValue(undefined)
    jest.spyOn(scheduler, '_setSessionMapping').mockResolvedValue(undefined)
    jest.spyOn(scheduler, '_getSessionMapping').mockResolvedValue(null)
    jest.spyOn(scheduler, '_extendSessionMappingTTL').mockResolvedValue(undefined)
    jest.spyOn(scheduler, '_deleteSessionMapping').mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('续链请求跳过 OAuth 账号，选中 API key 上游', async () => {
    jest
      .spyOn(scheduler, '_getAllAvailableAccounts')
      .mockResolvedValue([oauthCandidate, apiKeyCandidate])

    const result = await scheduler.selectAccountForApiKey(apiKeyData, null, 'gpt-5', {
      requireApiKeyUpstream: true
    })

    expect(result).toEqual({
      accountId: 'resp-1',
      accountType: 'openai-responses'
    })
  })

  test('续链请求在只有 OAuth 账号时返回 400，而不是降级发给 OAuth', async () => {
    jest.spyOn(scheduler, '_getAllAvailableAccounts').mockResolvedValue([oauthCandidate])

    await expect(
      scheduler.selectAccountForApiKey(apiKeyData, null, 'gpt-5', {
        requireApiKeyUpstream: true
      })
    ).rejects.toMatchObject({
      message: CONTINUATION_MESSAGE,
      statusCode: 400
    })
  })

  test('非续链请求保持原有优先级行为，仍可选中 OAuth 账号', async () => {
    jest
      .spyOn(scheduler, '_getAllAvailableAccounts')
      .mockResolvedValue([oauthCandidate, apiKeyCandidate])

    const result = await scheduler.selectAccountForApiKey(apiKeyData, null, 'gpt-5')

    expect(result).toEqual({
      accountId: 'oauth-1',
      accountType: 'openai'
    })
  })

  test('续链请求绕开 OAuth 粘性映射，但不删除该映射', async () => {
    scheduler._getSessionMapping.mockResolvedValue({
      accountId: 'oauth-1',
      accountType: 'openai'
    })
    jest.spyOn(scheduler, '_getAllAvailableAccounts').mockResolvedValue([apiKeyCandidate])

    const result = await scheduler.selectAccountForApiKey(apiKeyData, 'session-hash', 'gpt-5', {
      requireApiKeyUpstream: true
    })

    expect(result).toEqual({
      accountId: 'resp-1',
      accountType: 'openai-responses'
    })
    expect(scheduler._deleteSessionMapping).not.toHaveBeenCalled()
  })

  test('续链请求仍复用 API key 上游的粘性映射', async () => {
    scheduler._getSessionMapping.mockResolvedValue({
      accountId: 'resp-1',
      accountType: 'openai-responses'
    })
    jest.spyOn(scheduler, '_isAccountAvailable').mockResolvedValue(true)
    const getAll = jest.spyOn(scheduler, '_getAllAvailableAccounts')

    const result = await scheduler.selectAccountForApiKey(apiKeyData, 'session-hash', 'gpt-5', {
      requireApiKeyUpstream: true
    })

    expect(result).toEqual({
      accountId: 'resp-1',
      accountType: 'openai-responses'
    })
    expect(getAll).not.toHaveBeenCalled()
  })

  test('绑定到 OAuth 专属账号的 key 发起续链时返回 400', async () => {
    const boundKey = { id: 'key-2', name: 'bound-key', openaiAccountId: 'oauth-1' }

    await expect(
      scheduler.selectAccountForApiKey(boundKey, null, 'gpt-5', {
        requireApiKeyUpstream: true
      })
    ).rejects.toMatchObject({
      message: CONTINUATION_MESSAGE,
      statusCode: 400
    })
  })

  test('绑定到 API key 专属账号的 key 可以续链', async () => {
    const boundKey = { id: 'key-3', name: 'bound-resp-key', openaiAccountId: 'responses:resp-1' }
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'resp-1',
      name: 'responses-account',
      isActive: true,
      status: 'active',
      schedulable: true
    })

    const result = await scheduler.selectAccountForApiKey(boundKey, null, 'gpt-5', {
      requireApiKeyUpstream: true
    })

    expect(result).toEqual({
      accountId: 'resp-1',
      accountType: 'openai-responses'
    })
  })
})
