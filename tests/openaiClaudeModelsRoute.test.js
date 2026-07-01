// Tests for GET /v1/models in openaiClaudeRoutes — 动态 Claude 列表 + 静态兜底 + 权限/黑名单

const registeredRoutes = { get: {}, post: {} }
const mockRouter = {
  get: jest.fn((path, ...handlers) => {
    registeredRoutes.get[path] = handlers[handlers.length - 1]
  }),
  post: jest.fn((path, ...handlers) => {
    registeredRoutes.post[path] = handlers[handlers.length - 1]
  })
}
mockRouter.use = jest.fn()

const mockExpress = () => ({ Router: () => mockRouter })
mockExpress.Router = () => mockRouter
jest.mock('express', () => mockExpress)

jest.mock('../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn(),
  api: jest.fn()
}))
jest.mock('../src/middleware/auth', () => ({ authenticateApiKey: jest.fn() }))
jest.mock('../src/services/relay/claudeRelayService', () => ({}))
jest.mock('../src/services/relay/claudeConsoleRelayService', () => ({}))
jest.mock('../src/services/openaiToClaude', () => ({}))
jest.mock('../src/services/apiKeyService', () => ({
  hasPermission: jest.fn()
}))
jest.mock('../src/services/scheduler/unifiedClaudeScheduler', () => ({}))
jest.mock('../src/services/claudeCodeHeadersService', () => ({}))
jest.mock('../src/utils/errorSanitizer', () => ({ getSafeMessage: jest.fn((e) => e?.message) }))
jest.mock('../src/utils/sessionHelper', () => ({}))
jest.mock('../src/utils/rateLimitHelper', () => ({ updateRateLimitCounters: jest.fn() }))
jest.mock('../src/services/pricingService', () => ({}))
jest.mock('../src/utils/modelHelper', () => ({ getEffectiveModel: jest.fn() }))
jest.mock('../src/utils/requestDetailHelper', () => ({ createRequestDetailMeta: jest.fn() }))

jest.mock('../src/services/account/claudeAccountService', () => ({
  fetchAvailableModels: jest.fn()
}))
jest.mock('../src/services/modelService', () => ({
  getModelsByProvider: jest.fn()
}))

const apiKeyService = require('../src/services/apiKeyService')
const claudeAccountService = require('../src/services/account/claudeAccountService')
const modelService = require('../src/services/modelService')
require('../src/routes/openaiClaudeRoutes')

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
    })
  }
  return res
}

const handler = () => registeredRoutes.get['/v1/models']
const STATIC_FALLBACK = [
  { id: 'claude-fable-5', object: 'model', created: 1, owned_by: 'anthropic' },
  { id: 'claude-opus-4-8', object: 'model', created: 1, owned_by: 'anthropic' }
]

beforeEach(() => {
  apiKeyService.hasPermission.mockReset().mockReturnValue(true)
  claudeAccountService.fetchAvailableModels.mockReset()
  modelService.getModelsByProvider.mockReset().mockReturnValue(STATIC_FALLBACK)
})

describe('GET /v1/models (openai-compatible)', () => {
  test('动态可用：返回上游列表（不再仅两个老模型）', async () => {
    claudeAccountService.fetchAvailableModels.mockResolvedValue([
      { id: 'claude-fable-5', object: 'model', created: 2, owned_by: 'anthropic' },
      { id: 'claude-opus-4-8', object: 'model', created: 2, owned_by: 'anthropic' }
    ])

    const res = createResponse()
    await handler()({ apiKey: { permissions: ['claude'] } }, res)

    const ids = res.body.data.map((m) => m.id)
    expect(ids).toContain('claude-fable-5')
    expect(ids).not.toContain('claude-opus-4-20250514')
    expect(res.body.object).toBe('list')
  })

  test('动态不可用：回落静态 Claude 列表（非原两条）', async () => {
    claudeAccountService.fetchAvailableModels.mockResolvedValue(null)

    const res = createResponse()
    await handler()({ apiKey: { permissions: ['claude'] } }, res)

    expect(res.body.data.map((m) => m.id)).toEqual(['claude-fable-5', 'claude-opus-4-8'])
    expect(modelService.getModelsByProvider).toHaveBeenCalledWith('anthropic')
  })

  test('权限不足返回 403', async () => {
    apiKeyService.hasPermission.mockReturnValue(false)

    const res = createResponse()
    await handler()({ apiKey: { permissions: [] } }, res)

    expect(res.statusCode).toBe(403)
    expect(claudeAccountService.fetchAvailableModels).not.toHaveBeenCalled()
  })

  test('黑名单过滤掉受限模型', async () => {
    claudeAccountService.fetchAvailableModels.mockResolvedValue([
      { id: 'claude-fable-5', object: 'model', created: 2, owned_by: 'anthropic' },
      { id: 'claude-opus-4-8', object: 'model', created: 2, owned_by: 'anthropic' }
    ])

    const res = createResponse()
    await handler()(
      {
        apiKey: {
          permissions: ['claude'],
          enableModelRestriction: true,
          restrictedModels: ['claude-fable-5']
        }
      },
      res
    )

    const ids = res.body.data.map((m) => m.id)
    expect(ids).not.toContain('claude-fable-5')
    expect(ids).toContain('claude-opus-4-8')
  })
})
