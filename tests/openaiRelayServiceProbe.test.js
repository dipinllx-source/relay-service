// openaiRelayService.probeAccountUsage 单元测试
// 覆盖：成功流写回额度头、429 视为可达并标记限流、上游 401 不可达、连通性测试也会记录额度头、
// 测试请求带上配套的 Codex 客户端身份（originator + UA）

const { PassThrough } = require('stream')

jest.mock('axios', () => ({ post: jest.fn() }))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))
jest.mock('../src/utils/proxyHelper', () => ({ createProxyAgent: jest.fn(() => null) }))
jest.mock('../src/services/account/openaiAccountService', () => ({
  getAccount: jest.fn(),
  isTokenExpired: jest.fn(() => false),
  refreshAccountToken: jest.fn(),
  decrypt: jest.fn(() => 'access-token'),
  updateCodexUsageSnapshot: jest.fn()
}))
const mockScheduler = { markAccountRateLimited: jest.fn() }
jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => mockScheduler)
jest.mock('../src/utils/codexClientVersion', () => ({
  getLearnedClientVersion: jest.fn(async () => '0.164.0'),
  FLOOR_VERSION: '0.144.5'
}))

const axios = require('axios')
const openaiAccountService = require('../src/services/account/openaiAccountService')
const codexClientVersion = require('../src/utils/codexClientVersion')
const relay = require('../src/services/relay/openaiRelayService')

const USAGE_HEADERS = {
  'x-codex-primary-used-percent': '41',
  'x-codex-primary-window-minutes': '10080',
  'x-codex-primary-reset-after-seconds': '3600'
}

function sseStream(events) {
  const stream = new PassThrough()
  process.nextTick(() => {
    for (const event of events) {
      stream.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    stream.end()
  })
  return stream
}

function bodyStream(text) {
  const stream = new PassThrough()
  process.nextTick(() => stream.end(text))
  return stream
}

beforeEach(() => {
  jest.clearAllMocks()
  openaiAccountService.getAccount.mockResolvedValue({
    id: 'acc1',
    name: 'acc1',
    accessToken: 'encrypted',
    accountId: 'chatgpt-acc'
  })
  openaiAccountService.updateCodexUsageSnapshot.mockResolvedValue()
  codexClientVersion.getLearnedClientVersion.mockResolvedValue('0.164.0')
})

test('测试请求带上 codex_cli_rs 身份，UA 版本取流量学习到的版本', async () => {
  axios.post.mockResolvedValue({
    status: 200,
    headers: {},
    data: sseStream([{ type: 'response.output_text.delta', delta: 'hi' }])
  })

  await relay.probeAccountUsage('acc1')

  const { headers } = axios.post.mock.calls[0][2]
  expect(headers.originator).toBe('codex_cli_rs')
  expect(headers['user-agent']).toMatch(/^codex_cli_rs\/0\.164\.0 \(/)
  expect(headers['chatgpt-account-id']).toBe('chatgpt-acc')
})

test('没有学习到版本时，UA 使用保底版本', async () => {
  codexClientVersion.getLearnedClientVersion.mockResolvedValue(null)
  axios.post.mockResolvedValue({
    status: 200,
    headers: {},
    data: sseStream([{ type: 'response.output_text.delta', delta: 'hi' }])
  })

  await relay.probeAccountUsage('acc1')

  const { headers } = axios.post.mock.calls[0][2]
  expect(headers['user-agent']).toMatch(/^codex_cli_rs\/0\.144\.5 \(/)
})

test('成功响应：写回 codexUsage 快照并返回可达', async () => {
  axios.post.mockResolvedValue({
    status: 200,
    headers: USAGE_HEADERS,
    data: sseStream([
      { type: 'response.output_text.delta', delta: 'hi' },
      { type: 'response.completed', response: { model: 'gpt-test' } }
    ])
  })

  const result = await relay.probeAccountUsage('acc1')

  expect(result).toEqual({
    success: true,
    rateLimited: false,
    reachable: true,
    usageUpdated: true,
    error: null
  })
  expect(openaiAccountService.updateCodexUsageSnapshot).toHaveBeenCalledWith(
    'acc1',
    expect.objectContaining({ primaryUsedPercent: 41, primaryWindowMinutes: 10080 })
  )
})

test('HTTP 429：视为可达，标记限流，仍写回额度头', async () => {
  axios.post.mockResolvedValue({
    status: 429,
    headers: { ...USAGE_HEADERS, 'x-codex-primary-used-percent': '100' },
    data: bodyStream(JSON.stringify({ error: { resets_in_seconds: 120 } }))
  })

  const result = await relay.probeAccountUsage('acc1')

  expect(result.success).toBe(false)
  expect(result.rateLimited).toBe(true)
  expect(result.reachable).toBe(true)
  expect(result.usageUpdated).toBe(true)
  expect(mockScheduler.markAccountRateLimited).toHaveBeenCalledWith('acc1', 'openai', null, 120)
})

test('HTTP 401：不可达，返回错误信息', async () => {
  axios.post.mockResolvedValue({
    status: 401,
    headers: {},
    data: bodyStream(JSON.stringify({ error: { message: 'invalid token' } }))
  })

  const result = await relay.probeAccountUsage('acc1')

  expect(result.reachable).toBe(false)
  expect(result.usageUpdated).toBe(false)
  expect(result.error).toContain('HTTP 401')
})

test('账户不存在：不可达', async () => {
  openaiAccountService.getAccount.mockResolvedValue(null)
  const result = await relay.probeAccountUsage('missing')
  expect(result.reachable).toBe(false)
  expect(result.error).toBe('Account not found')
  expect(axios.post).not.toHaveBeenCalled()
})

test('SSE 连通性测试同样记录额度头，并正常结束响应', async () => {
  axios.post.mockResolvedValue({
    status: 200,
    headers: USAGE_HEADERS,
    data: sseStream([{ type: 'response.output_text.delta', delta: 'ok' }])
  })
  const chunks = []
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead: jest.fn(),
    write: jest.fn((chunk) => chunks.push(chunk)),
    end: jest.fn(function end() {
      this.writableEnded = true
    })
  }

  await relay.testAccountConnection('acc1', res)

  expect(openaiAccountService.updateCodexUsageSnapshot).toHaveBeenCalledTimes(1)
  expect(res.end).toHaveBeenCalledTimes(1)
  const events = chunks.map((c) => JSON.parse(c.replace(/^data: /, '')))
  expect(events[0].type).toBe('test_start')
  expect(events[events.length - 1]).toEqual(
    expect.objectContaining({ type: 'test_complete', success: true })
  )
})
