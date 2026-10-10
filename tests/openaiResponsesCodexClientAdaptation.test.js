// handleResponses 的 Codex 客户端识别：Codex 客户端原样转发，非 Codex 客户端做 Codex CLI 适配
// 背景：Codex Desktop（ChatGPT.app 内置 Codex）的 UA 为 "Codex Desktop/<ver> ..."，
// 曾因不匹配旧正则被当作非 Codex 客户端，instructions 被替换、service_tier 被删除。

const mockRouter = {
  get: jest.fn(),
  post: jest.fn(),
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
jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
  selectAccountForApiKey: jest.fn()
}))
jest.mock('../src/services/account/openaiAccountService', () => ({}))
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn()
}))
jest.mock('../src/services/relay/openaiResponsesRelayService', () => ({
  handleRequest: jest.fn()
}))
jest.mock('../src/services/apiKeyService', () => ({ hasPermission: jest.fn(() => true) }))
jest.mock('../src/services/modelCatalogService', () => ({}))
jest.mock('../src/models/redis', () => ({}))
jest.mock('../src/utils/proxyHelper', () => ({}))
jest.mock('../src/utils/codexClientVersion', () => ({
  captureClientVersionFromUserAgent: jest.fn(async () => null)
}))
jest.mock('../src/utils/rateLimitHelper', () => ({ updateRateLimitCounters: jest.fn() }))
jest.mock('../src/utils/sseParser', () => ({ IncrementalSSEParser: jest.fn() }))
jest.mock('../src/utils/errorSanitizer', () => ({ getSafeMessage: jest.fn((e) => e?.message) }))
jest.mock('../src/utils/requestDetailHelper', () => ({
  createRequestDetailMeta: jest.fn(),
  extractOpenAICacheReadTokens: jest.fn()
}))

const unifiedOpenAIScheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const openaiResponsesRelayService = require('../src/services/relay/openaiResponsesRelayService')
const codexClientVersion = require('../src/utils/codexClientVersion')
const { handleResponses, CODEX_CLI_INSTRUCTIONS } = require('../src/routes/openaiRoutes')

const DESKTOP_UA =
  'Codex Desktop/0.162.0-alpha.17.2 (Mac OS 26.5.2; arm64) unknown (Codex Desktop; 26.1007.21159)'
const CLI_UA = 'codex_cli_rs/0.162.0 (Mac OS 26.5.2; arm64) xterm-256color'
const CLIENT_INSTRUCTIONS = 'You are Codex, a coding agent running in the Codex app.'

function createReq(headers) {
  return {
    apiKey: { id: 'key-1', name: 'test-key', permissions: 'all' },
    headers,
    path: '/responses',
    originalUrl: '/openai/responses',
    body: {
      model: 'gpt-5.5',
      stream: true,
      instructions: CLIENT_INSTRUCTIONS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      service_tier: 'priority',
      text: { verbosity: 'low' },
      truncation: 'auto'
    }
  }
}

function createRes() {
  const res = { statusCode: 200, headersSent: false }
  res.status = jest.fn((code) => {
    res.statusCode = code
    return res
  })
  res.json = jest.fn(() => res)
  return res
}

async function runHandleResponses(headers) {
  const req = createReq(headers)
  const res = createRes()
  await handleResponses(req, res)
  expect(openaiResponsesRelayService.handleRequest).toHaveBeenCalledTimes(1)
  // 转发给上游中继服务时的请求体，即适配后的最终结果
  const [forwardedReq] = openaiResponsesRelayService.handleRequest.mock.calls[0]
  return { req, forwardedBody: forwardedReq.body }
}

describe('handleResponses Codex 客户端识别', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    unifiedOpenAIScheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'resp-1',
      accountType: 'openai-responses'
    })
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'resp-1',
      name: 'responses-account',
      apiKey: 'test-upstream-key'
    })
    openaiResponsesRelayService.handleRequest.mockResolvedValue(undefined)
  })

  test('Codex Desktop UA：保留 instructions 与 service_tier 等字段', async () => {
    const { req, forwardedBody } = await runHandleResponses({
      'user-agent': DESKTOP_UA,
      originator: 'Codex Desktop'
    })

    expect(forwardedBody.instructions).toBe(CLIENT_INSTRUCTIONS)
    expect(forwardedBody.service_tier).toBe('priority')
    expect(forwardedBody.text).toEqual({ verbosity: 'low' })
    expect(forwardedBody.truncation).toBe('auto')
    expect(req._serviceTier).toBe('priority')
  })

  test('Codex Desktop 流量参与客户端版本学习', async () => {
    await runHandleResponses({ 'user-agent': DESKTOP_UA, originator: 'Codex Desktop' })

    expect(codexClientVersion.captureClientVersionFromUserAgent).toHaveBeenCalledWith(DESKTOP_UA)
  })

  test('UA 被改写但 originator 为 Codex Desktop：仍按 Codex 客户端原样转发', async () => {
    const { forwardedBody } = await runHandleResponses({
      'user-agent': 'node-fetch/1.0',
      originator: 'Codex Desktop'
    })

    expect(forwardedBody.instructions).toBe(CLIENT_INSTRUCTIONS)
    expect(forwardedBody.service_tier).toBe('priority')
    // UA 不含版本号时没有可学习的版本
    expect(codexClientVersion.captureClientVersionFromUserAgent).not.toHaveBeenCalled()
  })

  test('codex_cli_rs UA：维持原样转发（回归）', async () => {
    const { forwardedBody } = await runHandleResponses({
      'user-agent': CLI_UA,
      originator: 'codex_cli_rs'
    })

    expect(forwardedBody.instructions).toBe(CLIENT_INSTRUCTIONS)
    expect(forwardedBody.service_tier).toBe('priority')
    expect(codexClientVersion.captureClientVersionFromUserAgent).toHaveBeenCalledWith(CLI_UA)
  })

  test('非 Codex UA：维持现有适配（删字段 + 注入 CODEX_CLI_INSTRUCTIONS）', async () => {
    const { req, forwardedBody } = await runHandleResponses({ 'user-agent': 'curl/8.7.1' })

    expect(forwardedBody.instructions).toBe(CODEX_CLI_INSTRUCTIONS)
    expect(forwardedBody).not.toHaveProperty('service_tier')
    expect(forwardedBody).not.toHaveProperty('text')
    expect(forwardedBody).not.toHaveProperty('truncation')
    // 计费用的 service_tier 在删除前已保存
    expect(req._serviceTier).toBe('priority')
    expect(codexClientVersion.captureClientVersionFromUserAgent).not.toHaveBeenCalled()
  })

  test('非 Codex UA + 未知 originator：仍做适配', async () => {
    const { forwardedBody } = await runHandleResponses({
      'user-agent': 'Mozilla/5.0',
      originator: 'some_other_tool'
    })

    expect(forwardedBody.instructions).toBe(CODEX_CLI_INSTRUCTIONS)
    expect(forwardedBody).not.toHaveProperty('service_tier')
  })
})
