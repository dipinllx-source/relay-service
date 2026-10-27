jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  api: jest.fn(),
  security: jest.fn()
}))

jest.mock('../config/config', () => ({
  claude: {
    apiUrl: 'https://api.anthropic.com/v1/messages?beta=true',
    apiVersion: '2023-06-01',
    betaHeader: 'claude-code-20250219',
    systemPrompt: '',
    overloadHandling: { enabled: 0 }
  },
  system: { timezoneOffset: 8 },
  proxy: {},
  requestTimeout: 600000
}))

jest.mock('../src/utils/proxyHelper', () => ({ createProxyAgent: jest.fn() }))
jest.mock('../src/services/account/claudeAccountService', () => ({
  getAccount: jest.fn(async () => ({ id: 'acc-1', name: 'new-dedicated' })),
  markAccountOpusRateLimited: jest.fn(async () => ({ success: true }))
}))
jest.mock('../src/services/scheduler/unifiedClaudeScheduler', () => ({
  markAccountRateLimited: jest.fn(async () => ({ success: true })),
  clearSessionMapping: jest.fn(async () => {})
}))
jest.mock('../src/utils/sessionHelper', () => ({}))
jest.mock('../src/services/claudeCodeHeadersService', () => ({}))
jest.mock('../src/models/redis', () => ({}))
jest.mock('../src/services/requestIdentityService', () => ({
  transform: jest.fn(({ body, headers }) => ({ body, headers }))
}))
jest.mock('../src/utils/testPayloadHelper', () => ({ createClaudeTestPayload: jest.fn() }))
jest.mock('../src/services/userMessageQueueService', () => ({}))
jest.mock('../src/utils/streamHelper', () => ({ isStreamWritable: jest.fn(() => true) }))
jest.mock('../src/utils/upstreamErrorHelper', () => ({
  parseRetryAfter: jest.fn(() => null),
  markTempUnavailable: jest.fn(async () => {})
}))
jest.mock('../src/utils/performanceOptimizer', () => ({
  getHttpsAgentForStream: jest.fn(),
  getHttpsAgentForNonStream: jest.fn(),
  getPricingData: jest.fn(() => null)
}))

const https = require('https')
const { EventEmitter } = require('events')
const claudeRelayService = require('../src/services/relay/claudeRelayService')
const claudeAccountService = require('../src/services/account/claudeAccountService')
const unifiedClaudeScheduler = require('../src/services/scheduler/unifiedClaudeScheduler')

const UPSTREAM_429 = JSON.stringify({
  type: 'error',
  error: { type: 'rate_limit_error', message: 'Error' }
})

function mockUpstream(statusCode, headers, bodyText) {
  return jest.spyOn(https, 'request').mockImplementation((options, callback) => {
    const req = new EventEmitter()
    req.write = jest.fn()
    req.destroy = jest.fn()
    req.setTimeout = jest.fn()
    req.end = () => {
      const res = new EventEmitter()
      res.statusCode = statusCode
      res.headers = headers
      res.resume = jest.fn()
      callback(res)
      setImmediate(() => {
        res.emit('data', Buffer.from(bodyText))
        res.emit('end')
      })
    }
    return req
  })
}

function makeClientStream() {
  const stream = new EventEmitter()
  stream.headersSent = false
  stream.statusCode = 200
  stream.status = jest.fn((code) => {
    stream.statusCode = code
    return stream
  })
  stream.setHeader = jest.fn()
  stream.write = jest.fn()
  stream.end = jest.fn(() => {
    stream.headersSent = true
  })
  return stream
}

function run(model, isDedicated, responseStream) {
  return claudeRelayService._makeClaudeStreamRequestWithUsageCapture(
    { model, messages: [{ role: 'user', content: 'hello' }], stream: true },
    'token',
    null,
    {},
    responseStream,
    jest.fn(),
    'acc-1',
    'claude-official',
    'session-hash',
    null,
    {},
    isDedicated
  )
}

const written = (stream) => stream.write.mock.calls.map(([chunk]) => String(chunk)).join('')

describe('claudeRelayService stream 429 handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    claudeRelayService.claudeApiUrl = 'https://api.anthropic.com/v1/messages?beta=true'
    jest.spyOn(claudeRelayService, '_prepareRequestHeadersAndPayload').mockResolvedValue({
      bodyString: '{}',
      headers: {},
      isRealClaudeCode: false,
      emulationApplied: true,
      toolNameMap: null
    })
  })

  it('dedicated Opus 429 without unified reset header passes the real upstream 429 through', async () => {
    mockUpstream(429, {}, UPSTREAM_429)
    const client = makeClientStream()

    await expect(run('claude-opus-5-5', true, client)).rejects.toThrow('Claude API error: 429')

    expect(client.statusCode).toBe(429)
    expect(written(client)).not.toContain('opus_weekly_limit')
    expect(JSON.parse(written(client))).toEqual({
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Error' }
    })
    expect(claudeAccountService.markAccountOpusRateLimited).not.toHaveBeenCalled()
  })

  it('dedicated Opus 429 with unified reset header still reports opus_weekly_limit with reset time', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600
    mockUpstream(429, { 'anthropic-ratelimit-unified-reset': String(reset) }, UPSTREAM_429)
    const client = makeClientStream()

    await run('claude-opus-5-5', true, client)

    expect(client.statusCode).toBe(403)
    const payload = JSON.parse(written(client))
    expect(payload.error).toBe('opus_weekly_limit')
    expect(payload.message).toContain('自动恢复')
    expect(claudeAccountService.markAccountOpusRateLimited).toHaveBeenCalledWith('acc-1', reset)
  })

  it('shared non-Opus 429 keeps rate-limit marking and returns HTTP 429 in Anthropic format', async () => {
    mockUpstream(429, {}, UPSTREAM_429)
    const client = makeClientStream()

    await expect(run('claude-sonnet-4-6', false, client)).rejects.toThrow('Claude API error: 429')

    expect(unifiedClaudeScheduler.markAccountRateLimited).toHaveBeenCalled()
    expect(client.statusCode).toBe(429)
    expect(JSON.parse(written(client)).error.type).toBe('rate_limit_error')
  })
})
