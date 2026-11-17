/**
 * ⑧ 限流窗口判定 / ⑩ 会话中 system 轮与 tool_addition 的回归测试
 *
 * ⑧：真实 CLI 2.1.326 的响应头是 unified 家族，`unified-reset` 镜像的是
 *    representative-claim 指向的窗口。抓包 0011 实测 unified-reset == 5h-reset == 1794892200，
 *    而 7d-reset == 1795341600（差约 5 天）。旧实现只读 unified-reset 就把 Opus 请求标成
 *    周限额 → 撞 5 小时窗口的账号被冷却 5 天，专属账号还会收到 opus_weekly_limit 403。
 *
 * ⑩：CLI 2.1.326 每条请求的 messages[1] 都是 role:"system"（text + tool_addition[]），
 *    且会发 content 为**字符串**的 user 轮（抓包 0010/0011 的 messages[3]）。
 *    旧 _patchOrphanedToolUse 用 !Array.isArray(content) 提前 continue，导致 string user 轮
 *    不消费 pending tool_use，合成结果被推迟成独立的第二个 user 轮 → tool_result 不在
 *    紧随 assistant tool_use 的 user 轮首位 → 上游 400。
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
jest.mock('../src/utils/performanceOptimizer', () => ({
  getHttpsAgentForStream: jest.fn(),
  getHttpsAgentForNonStream: jest.fn(),
  getPricingData: jest.fn(() => null),
  getCachedConfig: jest.fn(() => null),
  setCachedConfig: jest.fn(),
  deleteCachedConfig: jest.fn()
}))

const claudeRelayService = require('../src/services/relay/claudeRelayService')

// 抓包 0011 的真实响应头
const CAPTURE_5H_HEADERS = {
  'anthropic-ratelimit-unified-representative-claim': 'five_hour',
  'anthropic-ratelimit-unified-status': 'allowed',
  'anthropic-ratelimit-unified-reset': '1794892200',
  'anthropic-ratelimit-unified-5h-status': 'allowed',
  'anthropic-ratelimit-unified-5h-reset': '1794892200',
  'anthropic-ratelimit-unified-5h-utilization': '0.01',
  'anthropic-ratelimit-unified-7d-status': 'allowed',
  'anthropic-ratelimit-unified-7d-reset': '1795341600',
  'anthropic-ratelimit-unified-7d-utilization': '0.05',
  'anthropic-ratelimit-unified-overage-status': 'rejected',
  'anthropic-ratelimit-unified-overage-disabled-reason': 'org_level_disabled',
  'anthropic-ratelimit-unified-fallback-percentage': '0.5'
}

describe('rate limit window classification', () => {
  it('classifies the real capture as five_hour, not the Opus weekly window', () => {
    const w = claudeRelayService._classifyRateLimitWindow(CAPTURE_5H_HEADERS)
    expect(w.window).toBe('five_hour')
    expect(w.claim).toBe('five_hour')
    expect(w.resetTimestamp).toBe(1794892200)
    expect(w.reset7d).toBe(1795341600)
    expect(w.resetTimestamp).not.toBe(w.reset7d)
  })

  it('classifies seven_day claim and prefers the 7d reset', () => {
    const w = claudeRelayService._classifyRateLimitWindow({
      ...CAPTURE_5H_HEADERS,
      'anthropic-ratelimit-unified-representative-claim': 'seven_day',
      'anthropic-ratelimit-unified-reset': '1795341600',
      'anthropic-ratelimit-unified-7d-status': 'rejected'
    })
    expect(w.window).toBe('seven_day')
    expect(w.resetTimestamp).toBe(1795341600)
  })

  it('infers the window from reset equality when the claim header is absent', () => {
    const noClaim = { ...CAPTURE_5H_HEADERS }
    delete noClaim['anthropic-ratelimit-unified-representative-claim']
    expect(claudeRelayService._classifyRateLimitWindow(noClaim).window).toBe('five_hour')
    expect(
      claudeRelayService._classifyRateLimitWindow({
        'anthropic-ratelimit-unified-reset': '1795341600',
        'anthropic-ratelimit-unified-5h-reset': '1794892200',
        'anthropic-ratelimit-unified-7d-reset': '1795341600'
      }).window
    ).toBe('seven_day')
  })

  it('falls back to per-window status when neither claim nor reset equality is available', () => {
    expect(
      claudeRelayService._classifyRateLimitWindow({
        'anthropic-ratelimit-unified-reset': '1795341600',
        'anthropic-ratelimit-unified-7d-status': 'rejected',
        'anthropic-ratelimit-unified-5h-status': 'allowed'
      }).window
    ).toBe('seven_day')
    expect(
      claudeRelayService._classifyRateLimitWindow({
        'anthropic-ratelimit-unified-reset': '1794892200',
        'anthropic-ratelimit-unified-7d-status': 'allowed',
        'anthropic-ratelimit-unified-5h-status': 'rejected'
      }).window
    ).toBe('five_hour')
  })

  it('returns unknown when the window cannot be determined, still exposing the reset', () => {
    const w = claudeRelayService._classifyRateLimitWindow({
      'anthropic-ratelimit-unified-reset': '1794892200'
    })
    expect(w.window).toBe('unknown')
    expect(w.resetTimestamp).toBe(1794892200)
  })

  it('handles missing, malformed and mixed-case headers', () => {
    expect(claudeRelayService._classifyRateLimitWindow(null).window).toBe('unknown')
    expect(claudeRelayService._classifyRateLimitWindow(null).resetTimestamp).toBeNull()
    expect(claudeRelayService._classifyRateLimitWindow({}).window).toBe('unknown')
    expect(
      claudeRelayService._classifyRateLimitWindow({
        'anthropic-ratelimit-unified-reset': 'not-a-number'
      }).resetTimestamp
    ).toBeNull()
    expect(
      claudeRelayService._classifyRateLimitWindow({ 'anthropic-ratelimit-unified-reset': '0' })
        .resetTimestamp
    ).toBeNull()
    expect(
      claudeRelayService._classifyRateLimitWindow({
        'Anthropic-Ratelimit-Unified-Representative-Claim': 'SEVEN_DAY',
        'Anthropic-Ratelimit-Unified-Reset': '1795341600'
      }).window
    ).toBe('seven_day')
  })

  it('gates every weekly-marking call site on the window classifier (five_hour downgrades)', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(
      path.join(__dirname, '../src/services/relay/claudeRelayService.js'),
      'utf8'
    )
    const weeklyCalls = (source.match(/markAccountOpusRateLimited\(accountId/g) || []).length
    expect(weeklyCalls).toBe(3)
    expect((source.match(/if \(isOpusWeeklyLimit\)/g) || []).length).toBe(weeklyCalls)
    expect((source.match(/this\._classifyRateLimitWindow\(/g) || []).length).toBe(weeklyCalls)
    // 门控是「确证 five_hour 才降级」，unknown 保留旧行为，避免上游只发 unified-reset 时漏标周限额
    expect((source.match(/limitWindow\.window !== 'five_hour'/g) || []).length).toBe(weeklyCalls)
    // 不得再有任何绕过分类器、直接读 unified-reset 就判周限额的路径
    expect(source).not.toMatch(/headers\['anthropic-ratelimit-unified-reset'\]/)
  })
})

const SYNTHETIC = '[tool_result missing; tool execution interrupted]'
const userText = (t) => ({ role: 'user', content: [{ type: 'text', text: t }] })
const systemTurn = () => ({
  role: 'system',
  content: [
    { type: 'text', text: '# Environment\nYou have been invoked in the following environment:' },
    {
      type: 'tool_addition',
      tool: { name: 'mcp__x__batch', description: 'd', input_schema: { type: 'object' } }
    },
    {
      type: 'tool_addition',
      tool: { name: 'mcp__x__guide', description: 'd', input_schema: { type: 'object' } },
      cache_control: { type: 'ephemeral' }
    }
  ]
})
const assistantToolUse = (id) => ({
  role: 'assistant',
  content: [{ type: 'tool_use', id, name: 'Bash', input: {} }]
})
const userToolResult = (id) => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'ok' }] }]
})
const clone = (o) => JSON.parse(JSON.stringify(o))
const patch = (ms) => claudeRelayService._patchOrphanedToolUse(clone(ms))
const hasSynthetic = (m) => JSON.stringify(m).includes(SYNTHETIC)

describe('emulation session isolation', () => {
  it('does not derive independent sessions from identical first-turn text', () => {
    const first = { messages: [{ role: 'user', content: 'hello' }] }
    const second = { messages: [{ role: 'user', content: 'hello' }] }
    const firstId = claudeRelayService._resolveCanonicalSessionId(first, { accountId: 'a' })
    const secondId = claudeRelayService._resolveCanonicalSessionId(second, { accountId: 'a' })

    expect(firstId).toMatch(/^[0-9a-f-]{36}$/)
    expect(secondId).toMatch(/^[0-9a-f-]{36}$/)
    expect(secondId).not.toBe(firstId)
  })

  it('reuses a client session from the body before generating a new id', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111'
    const body = {
      metadata: {
        user_id: JSON.stringify({
          device_id: 'device',
          account_uuid: 'account',
          session_id: sessionId
        })
      }
    }
    expect(claudeRelayService._resolveCanonicalSessionId(body, { accountId: 'a' })).toBe(sessionId)
  })

  it('rejects non-v4 body sessions and generates a v4 UUID', () => {
    const body = {
      metadata: {
        user_id: JSON.stringify({
          device_id: 'device',
          account_uuid: 'account',
          session_id: 'not-a-uuid'
        })
      }
    }
    const sessionId = claudeRelayService._resolveCanonicalSessionId(body, { accountId: 'a' })
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it('accepts only UUID v4 values for a client session', () => {
    expect(claudeRelayService._isUuidV4('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(claudeRelayService._isUuidV4('11111111-1111-3111-8111-111111111111')).toBe(false)
    expect(claudeRelayService._isUuidV4('not-a-uuid')).toBe(false)
  })
})

describe('mid-conversation system turns', () => {
  it('leaves the real CLI 2.1.326 message shape untouched', () => {
    const messages = [
      userText('q'),
      systemTurn(),
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      { role: 'user', content: 'next question' }
    ]
    expect(patch(messages)).toEqual(messages)
  })

  it('does not treat a system turn between tool_use and tool_result as an orphan', () => {
    const messages = [userText('q'), assistantToolUse('X'), systemTurn(), userToolResult('X')]
    const out = patch(messages)
    expect(out).toEqual(messages)
    expect(hasSynthetic(out)).toBe(false)
  })

  it('never injects a synthetic tool_result into a system turn', () => {
    const out = patch([
      userText('q'),
      assistantToolUse('X'),
      systemTurn(),
      { role: 'assistant', content: [{ type: 'text', text: 'next' }] }
    ])
    const sys = out.find((m) => m.role === 'system')
    expect(hasSynthetic(sys)).toBe(false)
    expect(sys.content.filter((b) => b.type === 'tool_addition')).toHaveLength(2)
  })

  it('still synthesizes for a genuine orphan and for a trailing unresolved tool_use', () => {
    const orphan = patch([
      userText('q'),
      assistantToolUse('X'),
      { role: 'assistant', content: [{ type: 'text', text: 'next' }] }
    ])
    expect(orphan).toHaveLength(4)
    expect(orphan[2].role).toBe('user')
    expect(orphan[2].content[0].tool_use_id).toBe('X')

    const trailing = patch([userText('q'), assistantToolUse('X'), systemTurn()])
    expect(trailing).toHaveLength(4)
    expect(trailing[2].role).toBe('system')
    expect(trailing[3].role).toBe('user')
    expect(hasSynthetic(trailing[3])).toBe(true)
  })
})

describe('string-content user turns resolve pending tool_use in place', () => {
  it('prepends the synthetic result into the SAME user turn instead of appending a second one', () => {
    const out = patch([
      userText('q'),
      assistantToolUse('X'),
      { role: 'user', content: 'interrupt with a new question' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }
    ])
    expect(out).toHaveLength(4)
    expect(out[2].role).toBe('user')
    expect(out[2].content[0].type).toBe('tool_result')
    expect(out[2].content[0].tool_use_id).toBe('X')
    expect(out[2].content[1]).toEqual({ type: 'text', text: 'interrupt with a new question' })
    // 不得出现连续两个 user 轮（tool_result 必须在紧随 tool_use 的那一轮首位）
    out.forEach((m, i) => {
      if (i > 0 && m.role === 'user') {
        expect(out[i - 1].role).not.toBe('user')
      }
    })
  })

  it('handles a trailing string-content user turn', () => {
    const out = patch([
      userText('q'),
      assistantToolUse('X'),
      { role: 'user', content: 'interrupt' }
    ])
    expect(out).toHaveLength(3)
    expect(out[2].content[0].type).toBe('tool_result')
    expect(out[2].content[1].text).toBe('interrupt')
  })

  it('handles an empty string content', () => {
    const out = patch([userText('q'), assistantToolUse('X'), { role: 'user', content: '' }])
    expect(out).toHaveLength(3)
    expect(out[2].content).toHaveLength(1)
    expect(out[2].content[0].type).toBe('tool_result')
  })

  it('keeps the legacy array-content behavior unchanged', () => {
    const out = patch([
      userText('q'),
      assistantToolUse('X'),
      { role: 'user', content: [{ type: 'text', text: 'interrupt' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }
    ])
    expect(out).toHaveLength(4)
    expect(out[2].content[0].type).toBe('tool_result')
    expect(out[2].content[1].text).toBe('interrupt')
  })

  it('only synthesizes the tool_results that are actually missing', () => {
    const out = patch([
      userText('q'),
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'X', name: 'Bash', input: {} },
          { type: 'tool_use', id: 'Y', name: 'Read', input: {} }
        ]
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'X', content: [] }] }
    ])
    expect(out).toHaveLength(3)
    expect(out[2].content).toHaveLength(2)
    expect(out[2].content[0].tool_use_id).toBe('Y')
    expect(out[2].content[1].tool_use_id).toBe('X')
  })
})

describe('cache anchors and tool_addition', () => {
  it('does not place a cache anchor on a mid-conversation system turn', () => {
    const sys = systemTurn()
    const before = JSON.stringify(sys)
    expect(claudeRelayService._tryAddCacheControlToLastTextContent(sys)).toBeNull()
    expect(JSON.stringify(sys)).toBe(before)
  })

  it('still anchors user turns and still skips thinking-bearing assistant turns', () => {
    expect(
      claudeRelayService._tryAddCacheControlToLastTextContent({
        role: 'user',
        content: [{ type: 'text', text: 'hi' }]
      })
    ).toBe('content[0]')
    expect(
      claudeRelayService._tryAddCacheControlToLastTextContent({ role: 'user', content: 'hi' })
    ).toBe('content[0]')
    expect(
      claudeRelayService._tryAddCacheControlToLastTextContent({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 't', signature: 's' },
          { type: 'text', text: 'x' }
        ]
      })
    ).toBeNull()
  })

  it('renames tool_addition tool names with the same map as tools[]', () => {
    const forwardMap = new Map([
      ['mcp__x__batch', 'cc_fake_batch'],
      ['Bash', 'cc_fake_bash']
    ])
    jest
      .spyOn(claudeRelayService, '_buildToolNameRewrite')
      .mockReturnValue({ forwardMap, reverseMap: new Map() })
    jest.spyOn(claudeRelayService, '_shouldMimicToolName').mockReturnValue(true)

    const body = {
      tools: [{ name: 'mcp__x__batch' }, { name: 'Bash' }, { name: 'Untouched' }],
      tool_choice: { type: 'tool', name: 'Bash' },
      messages: [userText('q'), systemTurn()]
    }
    claudeRelayService._transformToolNamesInRequestBody(body, {})

    expect(body.tools[0].name).toBe('cc_fake_batch')
    expect(body.tools[1].name).toBe('cc_fake_bash')
    expect(body.tools[2].name).toBe('Untouched')
    expect(body.tool_choice.name).toBe('cc_fake_bash')
    expect(body.messages[1].content[1].tool.name).toBe('cc_fake_batch')
    // 不在 map 里的 tool_addition 保持原名，且其 cache_control 不被破坏
    expect(body.messages[1].content[2].tool.name).toBe('mcp__x__guide')
    expect(body.messages[1].content[2].cache_control).toEqual({ type: 'ephemeral' })

    jest.restoreAllMocks()
  })
})
