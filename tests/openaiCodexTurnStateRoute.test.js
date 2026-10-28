// handleResponses 的 x-codex-turn-state 处理：上游下发时回传给客户端并记录签发账号；
// 客户端带回时只在仍落在同一账号时转发给上游，换号或查不到记录时丢弃。

const crypto = require('crypto')

const mockRouter = {
  get: jest.fn(),
  post: jest.fn(),
  use: jest.fn()
}

const mockRedisClient = {
  store: new Map(),
  get: jest.fn(async (key) =>
    mockRedisClient.store.has(key) ? mockRedisClient.store.get(key) : null
  ),
  set: jest.fn(async (key, value) => {
    mockRedisClient.store.set(key, value)
    return 'OK'
  }),
  expire: jest.fn(async () => 1)
}
const mockRedis = { getClientSafe: jest.fn(() => mockRedisClient) }

jest.mock('express', () => ({ Router: () => mockRouter }))
jest.mock('axios', () => ({ post: jest.fn() }))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  security: jest.fn(),
  api: jest.fn()
}))
jest.mock('../config/config', () => ({}))
jest.mock('../src/middleware/auth', () => ({ authenticateApiKey: jest.fn() }))
jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
  selectAccountForApiKey: jest.fn(),
  isAccountRateLimited: jest.fn(async () => false),
  removeAccountRateLimit: jest.fn()
}))
jest.mock('../src/services/account/openaiAccountService', () => ({
  getAccount: jest.fn(),
  isTokenExpired: jest.fn(() => false),
  decrypt: jest.fn(() => 'access-token'),
  updateCodexUsageSnapshot: jest.fn()
}))
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn()
}))
jest.mock('../src/services/relay/openaiResponsesRelayService', () => ({ handleRequest: jest.fn() }))
jest.mock('../src/services/apiKeyService', () => ({
  hasPermission: jest.fn(() => true),
  recordUsage: jest.fn()
}))
jest.mock('../src/services/modelCatalogService', () => ({}))
jest.mock('../src/models/redis', () => mockRedis)
jest.mock('../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn(() => null),
  getProxyDescription: jest.fn()
}))
jest.mock('../src/utils/codexClientVersion', () => ({
  captureClientVersionFromUserAgent: jest.fn(async () => null)
}))
jest.mock('../src/utils/rateLimitHelper', () => ({ updateRateLimitCounters: jest.fn() }))
jest.mock('../src/utils/sseParser', () => ({ IncrementalSSEParser: jest.fn() }))
jest.mock('../src/utils/errorSanitizer', () => ({ getSafeMessage: jest.fn((e) => e?.message) }))
jest.mock('../src/utils/requestDetailHelper', () => ({
  createRequestDetailMeta: jest.fn(),
  extractOpenAICacheReadTokens: jest.fn(() => 0)
}))

const axios = require('axios')
const logger = require('../src/utils/logger')
const unifiedOpenAIScheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
const openaiAccountService = require('../src/services/account/openaiAccountService')
const { OWNER_KEY_PREFIX } = require('../src/utils/codexTurnState')
const { handleResponses } = require('../src/routes/openaiRoutes')

const DESKTOP_UA =
  'Codex Desktop/0.164.0-alpha.11.1 (Mac OS 26.5.2; arm64) unknown (Codex Desktop; 26.1016.51333)'

function ownerKey(turnState) {
  return `${OWNER_KEY_PREFIX}${crypto.createHash('sha256').update(turnState).digest('hex')}`
}

function createReq(extraHeaders = {}, bodyExtra = {}) {
  return {
    apiKey: { id: 'key-1', name: 'test-key', permissions: 'all' },
    headers: { 'user-agent': DESKTOP_UA, originator: 'Codex Desktop', ...extraHeaders },
    path: '/responses',
    originalUrl: '/openai/responses',
    body: {
      model: 'gpt-6.1-sol',
      stream: false,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      ...bodyExtra
    },
    on: jest.fn()
  }
}

function createRes() {
  const res = { statusCode: 200, headersSent: false, headers: {} }
  res.status = jest.fn((code) => {
    res.statusCode = code
    return res
  })
  res.setHeader = jest.fn((key, value) => {
    res.headers[key.toLowerCase()] = value
  })
  res.json = jest.fn(() => res)
  return res
}

function upstreamResponse(headers = {}) {
  return { status: 200, headers, data: { model: 'gpt-6.1-sol', output: [] } }
}

function forwardedHeaders() {
  expect(axios.post).toHaveBeenCalledTimes(1)
  return axios.post.mock.calls[0][2].headers
}

describe('handleResponses x-codex-turn-state', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRedisClient.store.clear()
    mockRedis.getClientSafe.mockImplementation(() => mockRedisClient)
    unifiedOpenAIScheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'oauth-1',
      accountType: 'openai'
    })
    openaiAccountService.getAccount.mockResolvedValue({
      id: 'oauth-1',
      name: 'oauth-account',
      accessToken: 'encrypted',
      accountId: 'chatgpt-acc'
    })
  })

  test('上游下发令牌：回传给客户端，并记录签发账号', async () => {
    axios.post.mockResolvedValue(upstreamResponse({ 'x-codex-turn-state': 'ts-new' }))
    const res = createRes()

    await handleResponses(createReq(), res)

    expect(res.headers['x-codex-turn-state']).toBe('ts-new')
    expect(mockRedisClient.store.get(ownerKey('ts-new'))).toBe('oauth-1')
    expect(res.json).toHaveBeenCalled()
  })

  test('上游未下发令牌：不设置响应头', async () => {
    axios.post.mockResolvedValue(upstreamResponse())
    const res = createRes()

    await handleResponses(createReq(), res)

    expect(res.headers['x-codex-turn-state']).toBeUndefined()
    expect(mockRedisClient.set).not.toHaveBeenCalled()
  })

  test('同一账号：令牌原样转发给上游', async () => {
    mockRedisClient.store.set(ownerKey('ts-1'), 'oauth-1')
    axios.post.mockResolvedValue(upstreamResponse())

    await handleResponses(createReq({ 'x-codex-turn-state': 'ts-1' }), createRes())

    expect(forwardedHeaders()['x-codex-turn-state']).toBe('ts-1')
  })

  test('换号：丢弃令牌（请求头和 body.client_metadata），其余 Codex 头照常转发', async () => {
    mockRedisClient.store.set(ownerKey('ts-1'), 'oauth-2')
    axios.post.mockResolvedValue(upstreamResponse())
    const req = createReq(
      { 'x-codex-turn-state': 'ts-1', 'x-codex-window-id': 'w1' },
      { client_metadata: { 'x-codex-turn-state': 'ts-1', thread_id: 't1' } }
    )

    await handleResponses(req, createRes())

    const headers = forwardedHeaders()
    expect(headers['x-codex-turn-state']).toBeUndefined()
    expect(headers['x-codex-window-id']).toBe('w1')
    expect(axios.post.mock.calls[0][1].client_metadata).toEqual({ thread_id: 't1' })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('account_changed'))
  })

  test('查不到签发记录：丢弃令牌', async () => {
    axios.post.mockResolvedValue(upstreamResponse())

    await handleResponses(createReq({ 'x-codex-turn-state': 'ts-unknown' }), createRes())

    expect(forwardedHeaders()['x-codex-turn-state']).toBeUndefined()
  })

  test('Redis 未连接：丢弃令牌，请求照常完成', async () => {
    mockRedis.getClientSafe.mockImplementation(() => {
      throw new Error('Redis client is not connected')
    })
    axios.post.mockResolvedValue(upstreamResponse({ 'x-codex-turn-state': 'ts-new' }))
    const res = createRes()

    await handleResponses(createReq({ 'x-codex-turn-state': 'ts-1' }), res)

    expect(forwardedHeaders()['x-codex-turn-state']).toBeUndefined()
    // 仍回传上游的新令牌（客户端需要它），只是无法记录签发账号
    expect(res.headers['x-codex-turn-state']).toBe('ts-new')
    expect(res.json).toHaveBeenCalled()
  })
})
