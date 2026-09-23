/**
 * Claude Code emulation 版本一致性回归测试
 *
 * 验证目标（对齐真实 CLI v2.1.280）：
 *   1. claudeCodeHeadersService.defaultHeaders 的 user-agent 声明版本 = 2.1.280
 *   2. claudeRelayService 导出的 CLAUDE_CODE_EMULATION_VERSION = 2.1.280，
 *      且与 defaultHeaders 的 UA 版本严格一致（避免 x-stainless / UA / cc_version 错位）
 *   3. _injectDynamicBillingHeader 注入的 system[0] 形如
 *      `x-anthropic-billing-header: cc_version=2.1.280.<3位hex>; cc_entrypoint=cli;`
 *      且不带 cch= 字段
 *   4. cc_version 指纹后缀随首条 user 文本变化、同文本下稳定
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
  claude: {
    apiVersion: '2023-06-01',
    betaHeader:
      'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
    systemPrompt: ''
  },
  proxy: {},
  requestTimeout: 600000
}))

jest.mock('../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn()
}))

jest.mock('../src/services/account/claudeAccountService', () => ({}))
jest.mock('../src/services/scheduler/unifiedClaudeScheduler', () => ({}))
jest.mock('../src/utils/sessionHelper', () => ({}))
jest.mock('../src/models/redis', () => ({
  getClient: jest.fn(),
  scanKeys: jest.fn()
}))
jest.mock('../src/services/requestIdentityService', () => ({
  transform: jest.fn(({ body, headers }) => ({ body, headers }))
}))
jest.mock('../src/utils/testPayloadHelper', () => ({
  createClaudeTestPayload: jest.fn()
}))
jest.mock('../src/services/userMessageQueueService', () => ({}))
jest.mock('../src/utils/streamHelper', () => ({
  isStreamWritable: jest.fn(() => true)
}))
jest.mock('../src/utils/upstreamErrorHelper', () => ({
  parseRetryAfter: jest.fn()
}))
jest.mock('../src/utils/performanceOptimizer', () => ({
  getHttpsAgentForStream: jest.fn(),
  getHttpsAgentForNonStream: jest.fn(),
  getPricingData: jest.fn(() => null),
  getCachedConfig: jest.fn(() => null),
  setCachedConfig: jest.fn(),
  deleteCachedConfig: jest.fn()
}))

const claudeRelayService = require('../src/services/relay/claudeRelayService')
const claudeCodeHeadersService = require('../src/services/claudeCodeHeadersService')

const EXPECTED_VERSION = '2.1.280'
const BILLING_RE =
  /^x-anthropic-billing-header: cc_version=(\d+\.\d+\.\d+)\.([0-9a-f]{3}); cc_entrypoint=cli;$/

const buildBody = (firstUserText) => ({
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: [{ type: 'text', text: firstUserText }] }],
  system: [{ type: 'text', text: 'existing system block' }]
})

describe('Claude Code emulation version (v2.1.280)', () => {
  it('defaultHeaders user-agent declares claude-cli/2.1.280', () => {
    const ua = claudeCodeHeadersService.defaultHeaders['user-agent']
    expect(ua).toBe(`claude-cli/${EXPECTED_VERSION} (external, cli)`)
    expect(claudeCodeHeadersService.extractVersionFromUserAgent(ua)).toBe(EXPECTED_VERSION)
  })

  it('relay service emulation version equals headers service declared version', () => {
    expect(claudeRelayService.CLAUDE_CODE_EMULATION_VERSION).toBe(EXPECTED_VERSION)
    const declared = claudeCodeHeadersService.extractVersionFromUserAgent(
      claudeCodeHeadersService.defaultHeaders['user-agent']
    )
    expect(
      claudeCodeHeadersService.compareVersions(
        claudeRelayService.CLAUDE_CODE_EMULATION_VERSION,
        declared
      )
    ).toBe(0)
  })

  it('injects a 2.1.280 dynamic billing header as system[0] without cch field', () => {
    const body = buildBody('hello from a regression test payload')

    claudeRelayService._injectDynamicBillingHeader(body)

    expect(Array.isArray(body.system)).toBe(true)
    expect(body.system).toHaveLength(2)
    expect(body.system[0].type).toBe('text')
    const match = body.system[0].text.match(BILLING_RE)
    expect(match).not.toBeNull()
    expect(match[1]).toBe(EXPECTED_VERSION)
    expect(body.system[0].text).not.toContain('cch=')
    expect(body.system[1]).toEqual({ type: 'text', text: 'existing system block' })
  })

  it('wraps a string system prompt with the billing header first', () => {
    const body = { messages: [{ role: 'user', content: 'plain string content' }], system: 'sys' }

    claudeRelayService._injectDynamicBillingHeader(body)

    expect(body.system).toHaveLength(2)
    expect(body.system[0].text).toMatch(BILLING_RE)
    expect(body.system[0].text).toContain(`cc_version=${EXPECTED_VERSION}.`)
    expect(body.system[1]).toEqual({ type: 'text', text: 'sys' })
  })

  it('cc_version fingerprint is stable per first user text and differs across texts', () => {
    const a1 = claudeRelayService._computeCcFingerprint(
      buildBody('alpha message body text'),
      EXPECTED_VERSION
    )
    const a2 = claudeRelayService._computeCcFingerprint(
      buildBody('alpha message body text'),
      EXPECTED_VERSION
    )
    const b = claudeRelayService._computeCcFingerprint(
      buildBody('bravo different content here'),
      EXPECTED_VERSION
    )

    expect(a1).toEqual(a2)
    expect(a1.fp).toMatch(/^[0-9a-f]{3}$/)
    expect(a1.fp).not.toBe(b.fp)
    // 版本参与哈希：同文本换版本应产生不同指纹
    const prev = claudeRelayService._computeCcFingerprint(
      buildBody('alpha message body text'),
      '2.1.259'
    )
    expect(prev.fp === a1.fp && prev.cch === a1.cch).toBe(false)
  })
})
