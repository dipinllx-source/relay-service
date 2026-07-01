// Tests for GET /apiStats/models — Claude 段动态化与静态兜底

const registeredRoutes = { get: {}, post: {} }
const mockRouter = {
  get: jest.fn((path, ...handlers) => {
    registeredRoutes.get[path] = handlers[handlers.length - 1]
  }),
  post: jest.fn((path, ...handlers) => {
    registeredRoutes.post[path] = handlers[handlers.length - 1]
  })
}

jest.mock('express', () => ({ Router: () => mockRouter }))

jest.mock('../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn()
}))

jest.mock('../src/models/redis', () => ({}))
jest.mock('../src/services/apiKeyService', () => ({}))
jest.mock('../src/utils/costCalculator', () => ({}))
jest.mock('../src/services/account/claudeAccountService', () => ({
  fetchAvailableModels: jest.fn()
}))
jest.mock('../src/services/account/openaiAccountService', () => ({}))
jest.mock('../src/services/serviceRatesService', () => ({}))
jest.mock('../src/utils/testPayloadHelper', () => ({
  createClaudeTestPayload: jest.fn(),
  extractErrorMessage: jest.fn(),
  sanitizeErrorMsg: jest.fn()
}))
jest.mock('../src/utils/errorSanitizer', () => ({
  getSafeMessage: jest.fn((e) => e?.message || 'error')
}))

const claudeAccountService = require('../src/services/account/claudeAccountService')
const { CLAUDE_MODELS } = require('../config/models')
require('../src/routes/apiStats')

function createResponse() {
  const res = {
    statusCode: 200,
    body: null,
    json: jest.fn((payload) => {
      res.body = payload
      return res
    }),
    status: jest.fn((code) => {
      res.statusCode = code
      return res
    }),
    redirect: jest.fn()
  }
  return res
}

const handler = () => registeredRoutes.get['/models']

beforeEach(() => {
  claudeAccountService.fetchAvailableModels.mockReset()
})

describe('GET /apiStats/models', () => {
  test('动态数据可用时 Claude 段使用上游列表（含 platforms.claude）', async () => {
    claudeAccountService.fetchAvailableModels.mockResolvedValue([
      { id: 'claude-fable-5', display_name: 'Claude Fable 5' }
    ])

    const res = createResponse()
    await handler()({ query: {} }, res)

    const expected = [{ value: 'claude-fable-5', label: 'Claude Fable 5' }]
    expect(res.body.data.claude).toEqual(expected)
    expect(res.body.data.platforms.claude).toEqual(expected)
    expect(res.body.data.claudeSource).toBe('upstream')
    expect(res.body.data.all[0]).toEqual(expected[0])
  })

  test('动态数据不可用时降级为静态列表，行为与变更前一致', async () => {
    claudeAccountService.fetchAvailableModels.mockResolvedValue(null)

    const res = createResponse()
    await handler()({ query: {} }, res)

    expect(res.body.data.claude).toEqual(CLAUDE_MODELS)
    expect(res.body.data.platforms.claude).toEqual(CLAUDE_MODELS)
    expect(res.body.data.claudeSource).toBe('fallback')
  })

  test('fetchAvailableModels 抛异常时仍返回静态列表', async () => {
    claudeAccountService.fetchAvailableModels.mockRejectedValue(new Error('boom'))

    const res = createResponse()
    await handler()({ query: {} }, res)

    expect(res.body.data.claude).toEqual(CLAUDE_MODELS)
    expect(res.body.data.claudeSource).toBe('fallback')
  })

  test('?service=claude 分支优先动态列表', async () => {
    claudeAccountService.fetchAvailableModels.mockResolvedValue([{ id: 'claude-fable-5' }])

    const res = createResponse()
    await handler()({ query: { service: 'claude' } }, res)

    expect(res.body.data).toEqual([{ value: 'claude-fable-5', label: 'claude-fable-5' }])
  })

  test('?service=gemini 分支不受动态 Claude 影响', async () => {
    claudeAccountService.fetchAvailableModels.mockResolvedValue([{ id: 'claude-fable-5' }])

    const res = createResponse()
    await handler()({ query: { service: 'gemini' } }, res)

    expect(res.body.data.every((m) => !m.value.startsWith('claude'))).toBe(true)
  })
})
