// 集成测试：/claude/openai/v1/messages 路由 → 转发服务 →（mock axios）→ 转回 Anthropic
// 使用真实的 claudeToOpenai 转换器与 openaiCompatibleRelayService，仅 mock 外部依赖

jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  api: jest.fn()
}))

jest.mock('axios')

// 认证中间件：注入带 openai 权限的 apiKey
jest.mock('../src/middleware/auth', () => ({
  authenticateApiKey: (req, _res, next) => {
    req.apiKey = { id: 'key-1', name: 'test', permissions: ['openai'] }
    next()
  }
}))

jest.mock('../src/services/apiKeyService', () => ({
  hasPermission: jest.fn().mockReturnValue(true),
  recordUsage: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('../src/services/account/openaiCompatibleAccountService', () => ({
  getAccount: jest.fn().mockResolvedValue({
    id: 'acc-1',
    name: 'gpt-account',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test',
    defaultModel: 'gpt-4o-mini',
    modelMapping: { 'claude-sonnet-*': 'gpt-4o' },
    proxy: null
  }),
  getAllAccounts: jest.fn().mockResolvedValue([]),
  updateAccountUsage: jest.fn().mockResolvedValue(undefined),
  markAccountRateLimited: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
  selectCompatibleAccountForApiKey: jest
    .fn()
    .mockResolvedValue({ accountId: 'acc-1', accountType: 'openai-compatible' })
}))

jest.mock('../src/utils/sessionHelper', () => ({
  generateSessionHash: () => 'session-hash'
}))

const express = require('express')
const request = require('supertest')
const axios = require('axios')
const apiKeyService = require('../src/services/apiKeyService')
const claudeOpenaiRoutes = require('../src/routes/claudeOpenaiRoutes')

const buildApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/claude/openai', claudeOpenaiRoutes)
  return app
}

describe('POST /claude/openai/v1/messages (non-stream)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('Anthropic 请求 → 上游收到 Chat Completions → 返回 Anthropic 信封', async () => {
    axios.mockResolvedValue({
      status: 200,
      data: {
        choices: [{ message: { content: '你好' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 4 }
      }
    })

    const res = await request(buildApp())
      .post('/claude/openai/v1/messages')
      .send({
        model: 'claude-sonnet-4-5-20250101',
        max_tokens: 100,
        messages: [{ role: 'user', content: '在吗' }]
      })

    expect(res.status).toBe(200)
    // 返回 Anthropic message 信封
    expect(res.body.type).toBe('message')
    expect(res.body.role).toBe('assistant')
    expect(res.body.content).toEqual([{ type: 'text', text: '你好' }])
    expect(res.body.stop_reason).toBe('end_turn')
    expect(res.body.usage).toEqual({ input_tokens: 12, output_tokens: 4 })
    // 客户端看到的 model 回写为原始 claude 名
    expect(res.body.model).toBe('claude-sonnet-4-5-20250101')

    // 上游收到的是转换后的 Chat Completions 请求
    expect(axios).toHaveBeenCalledTimes(1)
    const sentOptions = axios.mock.calls[0][0]
    expect(sentOptions.url).toBe('https://api.example.com/v1/chat/completions')
    expect(sentOptions.headers.Authorization).toBe('Bearer sk-test')
    // claude-sonnet-* 命中账号映射 → gpt-4o；claude-* 不透传
    expect(sentOptions.data.model).toBe('gpt-4o')
    expect(sentOptions.data.messages).toEqual([{ role: 'user', content: '在吗' }])

    // usage 记录使用目标 GPT 模型与 openai-compatible 账号类型
    expect(apiKeyService.recordUsage).toHaveBeenCalledWith(
      'key-1',
      12,
      4,
      0,
      0,
      'gpt-4o',
      'acc-1',
      'openai-compatible',
      null,
      null
    )
  })

  test('x-target-model 头部覆盖优先于映射表', async () => {
    axios.mockResolvedValue({
      status: 200,
      data: { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }], usage: {} }
    })

    await request(buildApp())
      .post('/claude/openai/v1/messages')
      .set('x-target-model', 'gpt-4-turbo')
      .send({
        model: 'claude-sonnet-4',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }]
      })

    expect(axios.mock.calls[0][0].data.model).toBe('gpt-4-turbo')
  })

  test('缺少 openai 权限返回 403 Anthropic 错误信封', async () => {
    apiKeyService.hasPermission.mockReturnValueOnce(false)

    const res = await request(buildApp())
      .post('/claude/openai/v1/messages')
      .send({ model: 'claude-sonnet-4', messages: [{ role: 'user', content: 'hi' }] })

    expect(res.status).toBe(403)
    expect(res.body.type).toBe('error')
    expect(res.body.error.type).toBe('permission_error')
  })

  test('上游 429 → 客户端 429', async () => {
    axios.mockResolvedValue({ status: 429, data: { error: 'rate limited' } })

    const res = await request(buildApp())
      .post('/claude/openai/v1/messages')
      .send({
        model: 'claude-sonnet-4',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }]
      })

    expect(res.status).toBe(429)
    expect(res.body.error.type).toBe('rate_limit_error')
  })
})
