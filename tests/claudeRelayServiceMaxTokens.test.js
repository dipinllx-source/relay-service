/**
 * max_tokens 校验 / 限幅的回归测试
 *
 * 背景 bug：`_validateAndLimitMaxTokens` 用 `path.join(__dirname, '../../data/model_pricing.json')`，
 * 但本文件位于 src/services/relay/，到仓库根需要三级 ../。旧值解析成
 * src/data/model_pricing.json（不存在）→ getPricingData 恒返回 null →
 * 每个请求都打印 "Model pricing file not found" 并静默跳过校验与限幅。
 * 线上日志一天 336 次该警告，重启后的 3 条真实请求全部命中。
 *
 * 这里既校验路径深度（防止再次照抄浅一层文件的 '../../data' 写法），
 * 也校验限幅行为本身。
 */

jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  api: jest.fn()
}))

jest.mock('../config/config', () => ({
  claude: { apiVersion: '2023-06-01', betaHeader: 'claude-code-20250219', systemPrompt: '' },
  proxy: {},
  requestTimeout: 600000
}))

jest.mock('../src/utils/proxyHelper', () => ({ createProxyAgent: jest.fn() }))
jest.mock('../src/services/account/claudeAccountService', () => ({}))
jest.mock('../src/services/scheduler/unifiedClaudeScheduler', () => ({}))
jest.mock('../src/utils/sessionHelper', () => ({}))
jest.mock('../src/models/redis', () => ({ getClient: jest.fn(), scanKeys: jest.fn() }))
jest.mock('../src/services/requestIdentityService', () => ({
  transform: jest.fn(({ body, headers }) => ({ body, headers }))
}))
jest.mock('../src/utils/testPayloadHelper', () => ({ createClaudeTestPayload: jest.fn() }))
jest.mock('../src/services/userMessageQueueService', () => ({}))
jest.mock('../src/utils/streamHelper', () => ({ isStreamWritable: jest.fn(() => true) }))
jest.mock('../src/utils/upstreamErrorHelper', () => ({ parseRetryAfter: jest.fn() }))

const mockGetPricingData = jest.fn()
jest.mock('../src/utils/performanceOptimizer', () => ({
  getHttpsAgentForStream: jest.fn(),
  getHttpsAgentForNonStream: jest.fn(),
  getPricingData: (...args) => mockGetPricingData(...args),
  getCachedConfig: jest.fn(() => null),
  setCachedConfig: jest.fn(),
  deleteCachedConfig: jest.fn()
}))

const fs = require('fs')
const path = require('path')
const claudeRelayService = require('../src/services/relay/claudeRelayService')

const PRICING = {
  'claude-fable-5-2': { max_tokens: 64000 },
  'claude-opus-5-5': { max_output_tokens: 128000 },
  'claude-no-limit': { input_cost_per_token: 0.000003 }
}

describe('max_tokens validation pricing file path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetPricingData.mockReturnValue(PRICING)
  })

  it('resolves the pricing file to a path that actually exists in the repo', () => {
    claudeRelayService._validateAndLimitMaxTokens({
      model: 'claude-fable-5-2',
      max_tokens: 1000
    })

    expect(mockGetPricingData).toHaveBeenCalledTimes(1)
    const requestedPath = mockGetPricingData.mock.calls[0][0]
    // 相对路径必须基于源文件目录解析后真实存在 —— 直接守住「层级写错」这类回归
    const resolved = path.resolve(__dirname, '../src/services/relay', requestedPath)
    expect(fs.existsSync(resolved)).toBe(true)
    expect(resolved.endsWith(path.join('data', 'model_pricing.json'))).toBe(true)
    // 不得落在 src/data 下（旧 bug 的解析结果）
    expect(resolved).not.toContain(`${path.sep}src${path.sep}data${path.sep}`)
  })

  it('does not warn about a missing pricing file for a normal request', () => {
    const logger = require('../src/utils/logger')
    claudeRelayService._validateAndLimitMaxTokens({
      model: 'claude-fable-5-2',
      max_tokens: 1000
    })
    const warnedMissing = logger.warn.mock.calls.some(([msg]) =>
      String(msg).includes('Model pricing file not found')
    )
    expect(warnedMissing).toBe(false)
  })
})

describe('max_tokens clamping behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetPricingData.mockReturnValue(PRICING)
  })

  it('clamps max_tokens down to the model limit (max_tokens field)', () => {
    const body = { model: 'claude-fable-5-2', max_tokens: 200000 }
    claudeRelayService._validateAndLimitMaxTokens(body)
    expect(body.max_tokens).toBe(64000)
  })

  it('clamps using max_output_tokens when max_tokens is absent', () => {
    const body = { model: 'claude-opus-5-5', max_tokens: 999999 }
    claudeRelayService._validateAndLimitMaxTokens(body)
    expect(body.max_tokens).toBe(128000)
  })

  it('leaves a within-limit value untouched', () => {
    const body = { model: 'claude-fable-5-2', max_tokens: 32000 }
    claudeRelayService._validateAndLimitMaxTokens(body)
    expect(body.max_tokens).toBe(32000)
  })

  it('passes through when the model has no limit field', () => {
    const body = { model: 'claude-no-limit', max_tokens: 500000 }
    claudeRelayService._validateAndLimitMaxTokens(body)
    expect(body.max_tokens).toBe(500000)
  })

  it('passes through when the model is unknown to the pricing file', () => {
    const body = { model: 'claude-unknown-9', max_tokens: 500000 }
    claudeRelayService._validateAndLimitMaxTokens(body)
    expect(body.max_tokens).toBe(500000)
  })

  it('passes through without throwing when pricing data is unavailable', () => {
    mockGetPricingData.mockReturnValue(null)
    const body = { model: 'claude-fable-5-2', max_tokens: 500000 }
    expect(() => claudeRelayService._validateAndLimitMaxTokens(body)).not.toThrow()
    expect(body.max_tokens).toBe(500000)
  })

  it('does not load pricing data at all when max_tokens is absent', () => {
    claudeRelayService._validateAndLimitMaxTokens({ model: 'claude-fable-5-2' })
    expect(mockGetPricingData).not.toHaveBeenCalled()
  })

  it('clamps inside the full _processRequestBody pipeline', () => {
    const body = {
      model: 'claude-fable-5-2',
      max_tokens: 200000,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    }
    const out = claudeRelayService._processRequestBody(body, null, true)
    expect(out.max_tokens).toBe(64000)
  })
})
