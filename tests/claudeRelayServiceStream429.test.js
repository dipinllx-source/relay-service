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

// 真实 CLI 2.1.326 抓包（0011）的 unified 限流头家族。
// 关键：unified-reset 镜像 representative-claim 指向的窗口 —— 这里是 five_hour，
// 与 7d-reset 相差约 5 天。旧实现只读 unified-reset 就判 Opus 周限额。
const FIVE_HOUR_RESET = 1794892200
const SEVEN_DAY_RESET = 1795341600
const UNIFIED_5H_HEADERS = {
  'anthropic-ratelimit-unified-representative-claim': 'five_hour',
  'anthropic-ratelimit-unified-status': 'allowed',
  'anthropic-ratelimit-unified-reset': String(FIVE_HOUR_RESET),
  'anthropic-ratelimit-unified-5h-status': 'rejected',
  'anthropic-ratelimit-unified-5h-reset': String(FIVE_HOUR_RESET),
  'anthropic-ratelimit-unified-5h-utilization': '1.0',
  'anthropic-ratelimit-unified-7d-status': 'allowed',
  'anthropic-ratelimit-unified-7d-reset': String(SEVEN_DAY_RESET),
  'anthropic-ratelimit-unified-7d-utilization': '0.05',
  'anthropic-ratelimit-unified-overage-status': 'rejected',
  'anthropic-ratelimit-unified-overage-disabled-reason': 'org_level_disabled',
  'anthropic-ratelimit-unified-fallback-percentage': '0.5'
}

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

  it('dedicated Opus 429 on the five_hour window is NOT treated as the weekly limit', async () => {
    mockUpstream(429, UNIFIED_5H_HEADERS, UPSTREAM_429)
    const client = makeClientStream()

    await run('claude-opus-5-5', true, client)

    // 不得标周限额（否则账号被冷却到 7d-reset，比真实 5h 重置晚约 5 天）
    expect(claudeAccountService.markAccountOpusRateLimited).not.toHaveBeenCalled()
    // 专属账号走短期限流分支：403 upstream_rate_limited，而不是 opus_weekly_limit
    expect(client.statusCode).toBe(403)
    const payload = JSON.parse(written(client))
    expect(payload.error).toBe('upstream_rate_limited')
    expect(written(client)).not.toContain('opus_weekly_limit')
    // 提示是标准限流文案（恢复时间取自 5h 重置，由下面的 markAccountRateLimited 断言精确校验）
    expect(payload.message).toContain('自动恢复')
    // 按 5h 重置时间做短期限流标记
    expect(unifiedClaudeScheduler.markAccountRateLimited).toHaveBeenCalledWith(
      'acc-1',
      'claude-official',
      'session-hash',
      FIVE_HOUR_RESET
    )
  })

  it('dedicated Opus 429 on the seven_day window uses the 7d reset, not unified-reset', async () => {
    mockUpstream(
      429,
      {
        ...UNIFIED_5H_HEADERS,
        'anthropic-ratelimit-unified-representative-claim': 'seven_day',
        'anthropic-ratelimit-unified-5h-status': 'allowed',
        'anthropic-ratelimit-unified-7d-status': 'rejected',
        // 故意让 unified-reset 与 7d-reset 不同，验证取的是窗口专用头
        'anthropic-ratelimit-unified-reset': String(FIVE_HOUR_RESET)
      },
      UPSTREAM_429
    )
    const client = makeClientStream()

    await run('claude-opus-5-5', true, client)

    expect(claudeAccountService.markAccountOpusRateLimited).toHaveBeenCalledWith(
      'acc-1',
      SEVEN_DAY_RESET
    )
    expect(client.statusCode).toBe(403)
    expect(JSON.parse(written(client)).error).toBe('opus_weekly_limit')
  })

  it('shared non-Opus 429 keeps rate-limit marking and returns HTTP 429 in Anthropic format', async () => {
    mockUpstream(429, {}, UPSTREAM_429)
    const client = makeClientStream()

    await expect(run('claude-sonnet-4-6', false, client)).rejects.toThrow('Claude API error: 429')

    expect(unifiedClaudeScheduler.markAccountRateLimited).toHaveBeenCalled()
    expect(client.statusCode).toBe(429)
    expect(JSON.parse(written(client)).error.type).toBe('rate_limit_error')
  })

  it('non-Opus 429 on the five_hour window still uses the 5h reset', async () => {
    mockUpstream(429, UNIFIED_5H_HEADERS, UPSTREAM_429)
    const client = makeClientStream()

    await expect(run('claude-sonnet-4-6', false, client)).rejects.toThrow('Claude API error: 429')

    expect(claudeAccountService.markAccountOpusRateLimited).not.toHaveBeenCalled()
    expect(unifiedClaudeScheduler.markAccountRateLimited).toHaveBeenCalledWith(
      'acc-1',
      'claude-official',
      'session-hash',
      FIVE_HOUR_RESET
    )
  })
})
