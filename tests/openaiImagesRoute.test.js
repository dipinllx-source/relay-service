// POST /openai/images/generations 与 /openai/images/edits 路由（真实 express + formidable）

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
jest.mock('../config/config', () => ({ requestTimeout: 1000 }))
jest.mock('../src/middleware/auth', () => ({ authenticateApiKey: jest.fn() }))
jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
  selectAccountForApiKey: jest.fn()
}))
jest.mock('../src/services/account/openaiAccountService', () => ({
  getAccount: jest.fn(),
  isTokenExpired: jest.fn(() => false),
  decrypt: jest.fn(() => 'decrypted-access-token')
}))
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn()
}))
jest.mock('../src/services/relay/openaiResponsesRelayService', () => ({}))
jest.mock('../src/services/apiKeyService', () => ({
  hasPermission: jest.fn((permissions, service) => {
    if (!permissions || permissions === 'all') {
      return true
    }
    const list = Array.isArray(permissions) ? permissions : [permissions]
    return list.length === 0 || list.includes(service)
  }),
  recordUsage: jest.fn(async () => ({ realCost: 0.0155, ratedCost: 0.0155 }))
}))
jest.mock('../src/models/redis', () => ({}))
jest.mock('../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn(() => null),
  getProxyDescription: jest.fn(() => 'none')
}))
jest.mock('../src/utils/codexClientVersion', () => ({
  compareSemanticVersions: jest.requireActual('../src/utils/codexClientVersion')
    .compareSemanticVersions,
  captureClientVersionFromUserAgent: jest.fn(async () => null)
}))
jest.mock('../src/utils/rateLimitHelper', () => ({
  updateRateLimitCounters: jest.fn(async () => ({ totalTokens: 0, totalCost: 0 }))
}))
jest.mock('../src/utils/sseParser', () => ({ IncrementalSSEParser: jest.fn() }))
jest.mock('../src/utils/errorSanitizer', () => ({ getSafeMessage: jest.fn((e) => e?.message) }))
jest.mock('../src/utils/requestDetailHelper', () => ({
  createRequestDetailMeta: jest.fn((req, overrides) => ({ ...overrides })),
  extractOpenAICacheReadTokens: jest.fn()
}))
jest.mock('../src/services/modelCatalogService', () => ({ getCodexModels: jest.fn() }))
jest.mock('../src/utils/costCalculator', () => ({
  calculateImageGenerationCost: jest.fn(() => ({ costs: { total: 0.0155 } }))
}))

const request = require('supertest')
const axios = require('axios')
const scheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
const openaiAccountService = require('../src/services/account/openaiAccountService')
const apiKeyService = require('../src/services/apiKeyService')
const CostCalculator = require('../src/utils/costCalculator')
require('../src/routes/openaiRoutes')

const UPSTREAM_OK = {
  status: 200,
  headers: { 'x-codex-imagegen-request-id': 'imgreq-1' },
  data: {
    created: 1,
    data: [{ b64_json: 'aW1hZ2U=', generation_id: 'gen-1' }],
    usage: {
      input_tokens: 19,
      input_tokens_details: { image_tokens: 0, text_tokens: 19 },
      output_tokens: 515,
      output_tokens_details: { image_tokens: 515, text_tokens: 0 }
    }
  }
}

let currentApiKey

function buildApp() {
  const realExpress = jest.requireActual('express')
  const app = realExpress()
  app.use(realExpress.json({ limit: '10mb' }))
  app.use((req, res, next) => {
    req.apiKey = currentApiKey
    next()
  })
  for (const path of [
    '/images/generations',
    '/v1/images/generations',
    '/images/edits',
    '/v1/images/edits'
  ]) {
    app.post(`/openai${path}`, registeredRoutes.post[path])
  }
  return app
}

describe('OpenAI images routes', () => {
  let app

  beforeEach(() => {
    jest.clearAllMocks()
    currentApiKey = { id: 'key-1', name: 'test-key', permissions: 'all' }
    scheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'acc-1',
      accountType: 'openai'
    })
    openaiAccountService.getAccount.mockResolvedValue({
      name: 'Test-Account',
      accessToken: 'encrypted',
      accountId: 'chatgpt-account-1',
      proxy: null
    })
    axios.post.mockResolvedValue(UPSTREAM_OK)
    app = buildApp()
  })

  it('registers generations and edits under both /images and /v1/images', () => {
    for (const path of [
      '/images/generations',
      '/v1/images/generations',
      '/images/edits',
      '/v1/images/edits'
    ]) {
      expect(typeof registeredRoutes.post[path]).toBe('function')
    }
  })

  it('forwards generations to the Codex images backend with account OAuth and records usage', async () => {
    const res = await request(app)
      .post('/openai/v1/images/generations')
      .set('user-agent', 'curl/8.7.1')
      .send({ prompt: 'a blue circle', size: '1024x1024', response_format: 'b64_json' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual(UPSTREAM_OK.data)
    expect(res.headers['x-request-id']).toBe('imgreq-1')

    expect(axios.post).toHaveBeenCalledTimes(1)
    const [url, body, axiosConfig] = axios.post.mock.calls[0]
    expect(url).toBe('https://chatgpt.com/backend-api/codex/images/generations')
    expect(body).toEqual({ prompt: 'a blue circle', size: '1024x1024', model: 'gpt-image-2' })
    expect(axiosConfig.headers).toMatchObject({
      authorization: 'Bearer decrypted-access-token',
      'chatgpt-account-id': 'chatgpt-account-1',
      'content-type': 'application/json',
      originator: 'codex_exec',
      'user-agent': 'codex_exec/0.162.0'
    })
    expect(axiosConfig.headers['x-codex-image-turn-id']).toMatch(/^relay-/)
    expect(scheduler.selectAccountForApiKey).toHaveBeenCalledWith(
      currentApiKey,
      null,
      'gpt-image-2',
      expect.any(Object)
    )

    expect(CostCalculator.calculateImageGenerationCost).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 19, outputTokens: 515, outputImageTokens: 515 }),
      'gpt-image-2'
    )
    expect(apiKeyService.recordUsage).toHaveBeenCalledWith(
      'key-1',
      19,
      515,
      0,
      0,
      'gpt-image-2',
      'acc-1',
      'openai',
      null,
      expect.objectContaining({
        requestBody: expect.objectContaining({ model: 'gpt-image-2', promptChars: 13 }),
        stream: false,
        statusCode: 200
      }),
      { costInfo: { costs: { total: 0.0155 } } }
    )
  })

  it('converts multipart edits (image[] files) into the JSON body the upstream expects', async () => {
    const res = await request(app)
      .post('/openai/images/edits')
      .field('prompt', 'add a red hat')
      .field('quality', 'low')
      .attach('image[]', Buffer.from('PNGDATA'), { filename: 'a.png', contentType: 'image/png' })
      .attach('image[]', Buffer.from('JPEGDATA'), { filename: 'b.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(200)
    const [url, body] = axios.post.mock.calls[0]
    expect(url).toBe('https://chatgpt.com/backend-api/codex/images/edits')
    expect(body).toEqual({
      prompt: 'add a red hat',
      quality: 'low',
      model: 'gpt-image-2',
      images: [
        { image_url: `data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}` },
        { image_url: `data:image/jpeg;base64,${Buffer.from('JPEGDATA').toString('base64')}` }
      ]
    })
  })

  it('accepts JSON edits with images references', async () => {
    const res = await request(app)
      .post('/openai/v1/images/edits')
      .send({ prompt: 'remove background', images: [{ image_url: 'data:image/png;base64,AA' }] })

    expect(res.status).toBe(200)
    expect(axios.post.mock.calls[0][1].images).toEqual([{ image_url: 'data:image/png;base64,AA' }])
  })

  it('rejects masks and invalid bodies before touching the upstream', async () => {
    const maskRes = await request(app)
      .post('/openai/images/edits')
      .field('prompt', 'x')
      .attach('image', Buffer.from('PNG'), { filename: 'a.png', contentType: 'image/png' })
      .attach('mask', Buffer.from('MASK'), { filename: 'm.png', contentType: 'image/png' })
    expect(maskRes.status).toBe(400)
    expect(maskRes.body.error.message).toBe('`mask` is not supported by this endpoint')

    const promptRes = await request(app).post('/openai/images/generations').send({ size: 'auto' })
    expect(promptRes.status).toBe(400)
    expect(promptRes.body.error.message).toBe('`prompt` is required')

    expect(axios.post).not.toHaveBeenCalled()
    expect(scheduler.selectAccountForApiKey).not.toHaveBeenCalled()
  })

  it('passes upstream errors through in OpenAI error shape without recording usage', async () => {
    axios.post.mockResolvedValue({
      status: 429,
      headers: {},
      data: { detail: 'Image generation limit reached' }
    })
    const res = await request(app).post('/openai/images/generations').send({ prompt: 'x' })

    expect(res.status).toBe(429)
    expect(res.body).toEqual({
      error: { message: 'Image generation limit reached', type: 'rate_limit_error', code: null }
    })
    expect(apiKeyService.recordUsage).not.toHaveBeenCalled()
  })

  it('denies keys without OpenAI permission and API-key upstream accounts', async () => {
    currentApiKey = { id: 'key-2', permissions: ['claude'] }
    const denied = await request(app).post('/openai/images/generations').send({ prompt: 'x' })
    expect(denied.status).toBe(403)

    currentApiKey = { id: 'key-3', permissions: 'all' }
    scheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'resp-1',
      accountType: 'openai-responses'
    })
    const { getAccount } = require('../src/services/account/openaiResponsesAccountService')
    getAccount.mockResolvedValue({ name: 'Responses', apiKey: 'sk-test' })
    const unsupported = await request(app).post('/openai/images/generations').send({ prompt: 'x' })
    expect(unsupported.status).toBe(501)
    expect(unsupported.body.error.type).toBe('not_supported')
    expect(axios.post).not.toHaveBeenCalled()
  })
})
