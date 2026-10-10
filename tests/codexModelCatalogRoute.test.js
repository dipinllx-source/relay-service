// GET /openai/codex/models — Codex 原生模型目录（供 Codex 客户端 model_catalog_url 使用）

const registeredRoutes = { get: {}, post: {} }
const mockRouter = {
  get: jest.fn((path, ...handlers) => {
    registeredRoutes.get[path] = handlers[handlers.length - 1]
  }),
  post: jest.fn((path, ...handlers) => {
    registeredRoutes.post[path] = handlers[handlers.length - 1]
  }),
  use: jest.fn()
}

jest.mock('express', () => ({ Router: () => mockRouter }))
jest.mock('axios', () => ({}))
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
jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({}))
jest.mock('../src/services/account/openaiAccountService', () => ({}))
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({}))
jest.mock('../src/services/relay/openaiResponsesRelayService', () => ({}))
jest.mock('../src/services/apiKeyService', () => ({
  hasPermission: jest.fn((permissions, service) => {
    if (!permissions || permissions === 'all') {
      return true
    }
    const list = Array.isArray(permissions) ? permissions : [permissions]
    return list.length === 0 || list.includes(service)
  })
}))
jest.mock('../src/models/redis', () => ({}))
jest.mock('../src/utils/proxyHelper', () => ({}))
jest.mock('../src/utils/codexClientVersion', () => ({
  compareSemanticVersions: jest.requireActual('../src/utils/codexClientVersion')
    .compareSemanticVersions,
  captureClientVersionFromUserAgent: jest.fn(async () => null)
}))
jest.mock('../src/utils/rateLimitHelper', () => ({ updateRateLimitCounters: jest.fn() }))
jest.mock('../src/utils/sseParser', () => ({ IncrementalSSEParser: jest.fn() }))
jest.mock('../src/utils/errorSanitizer', () => ({ getSafeMessage: jest.fn((e) => e?.message) }))
jest.mock('../src/utils/requestDetailHelper', () => ({
  createRequestDetailMeta: jest.fn(),
  extractOpenAICacheReadTokens: jest.fn()
}))
jest.mock('../src/services/modelCatalogService', () => ({ getCodexModels: jest.fn() }))

const modelCatalogService = require('../src/services/modelCatalogService')
const codexClientVersion = require('../src/utils/codexClientVersion')
require('../src/routes/openaiRoutes')

const CATALOG = [
  {
    slug: 'gpt-6.1-sol',
    display_name: 'GPT-6.1-Sol',
    minimal_client_version: '0.153.0',
    supported_reasoning_levels: [{ effort: 'low' }],
    model_messages: { instructions_template: 'x' }
  },
  { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', minimal_client_version: '0.160.0' },
  { slug: 'codex-auto-review', visibility: 'hide' }
]

function createReq({ apiKey = { id: 'k1', permissions: 'all' }, query = {}, headers = {} } = {}) {
  return { apiKey, query, headers, originalUrl: '/openai/codex/models' }
}

function createRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader: jest.fn((k, v) => {
      res.headers[k.toLowerCase()] = v
    }),
    status: jest.fn((code) => {
      res.statusCode = code
      return res
    }),
    json: jest.fn((payload) => {
      res.body = payload
      return res
    }),
    send: jest.fn((payload) => {
      res.body = JSON.parse(payload)
      return res
    }),
    end: jest.fn(() => res)
  }
  return res
}

const handler = () => registeredRoutes.get['/codex/models']

beforeEach(() => {
  modelCatalogService.getCodexModels.mockReset()
  codexClientVersion.captureClientVersionFromUserAgent.mockClear()
})

describe('GET /openai/codex/models', () => {
  test('注册了 /codex/models 与 /v1/codex/models 两个路由', () => {
    expect(typeof registeredRoutes.get['/codex/models']).toBe('function')
    expect(registeredRoutes.get['/v1/codex/models']).toBe(registeredRoutes.get['/codex/models'])
  })

  test('原样输出上游原生条目，带 ETag', async () => {
    modelCatalogService.getCodexModels.mockResolvedValue(CATALOG)
    const res = createRes()
    await handler()(createReq(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.models.map((m) => m.slug)).toEqual([
      'gpt-6.1-sol',
      'gpt-6-astra',
      'codex-auto-review'
    ])
    // 原生字段不裁剪
    expect(res.body.models[0].model_messages).toEqual({ instructions_template: 'x' })
    expect(res.headers.etag).toMatch(/^"[0-9a-f]{32}"$/)
  })

  test('按 client_version 复刻上游门控', async () => {
    modelCatalogService.getCodexModels.mockResolvedValue(CATALOG)
    const res = createRes()
    await handler()(createReq({ query: { client_version: '0.155.1' } }), res)

    expect(res.body.models.map((m) => m.slug)).toEqual(['gpt-6.1-sol', 'codex-auto-review'])
  })

  test('restrictedModels 黑名单按 slug 过滤', async () => {
    modelCatalogService.getCodexModels.mockResolvedValue(CATALOG)
    const res = createRes()
    const apiKey = {
      id: 'k2',
      permissions: 'all',
      enableModelRestriction: true,
      restrictedModels: ['gpt-6-astra']
    }
    await handler()(createReq({ apiKey }), res)

    expect(res.body.models.map((m) => m.slug)).toEqual(['gpt-6.1-sol', 'codex-auto-review'])
  })

  test('If-None-Match 命中时返回 304', async () => {
    modelCatalogService.getCodexModels.mockResolvedValue(CATALOG)
    const first = createRes()
    await handler()(createReq(), first)

    const second = createRes()
    await handler()(createReq({ headers: { 'if-none-match': first.headers.etag } }), second)
    expect(second.statusCode).toBe(304)
    expect(second.end).toHaveBeenCalled()
    expect(second.send).not.toHaveBeenCalled()
  })

  test('无 OpenAI 权限返回 403，且不读取目录', async () => {
    const res = createRes()
    await handler()(createReq({ apiKey: { id: 'k3', permissions: ['claude'] } }), res)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('permission_denied')
    expect(modelCatalogService.getCodexModels).not.toHaveBeenCalled()
  })

  test('目录不可用返回 503', async () => {
    modelCatalogService.getCodexModels.mockResolvedValue(null)
    const res = createRes()
    await handler()(createReq(), res)

    expect(res.statusCode).toBe(503)
    expect(res.body.error.code).toBe('model_catalog_unavailable')
  })

  test('Codex UA（含 Codex Desktop）触发客户端版本学习，其他 UA 不触发', async () => {
    modelCatalogService.getCodexModels.mockResolvedValue(CATALOG)
    await handler()(
      createReq({ headers: { 'user-agent': 'codex_cli_rs/0.162.0 (Mac OS 26.5.2)' } }),
      createRes()
    )
    await handler()(
      createReq({
        headers: {
          'user-agent':
            'Codex Desktop/0.162.0-alpha.17.2 (Mac OS 26.5.2; arm64) unknown (Codex Desktop; 26.1007.21159)'
        }
      }),
      createRes()
    )
    await handler()(createReq({ headers: { 'user-agent': 'curl/8.7.1' } }), createRes())

    expect(codexClientVersion.captureClientVersionFromUserAgent).toHaveBeenCalledTimes(2)
  })
})
