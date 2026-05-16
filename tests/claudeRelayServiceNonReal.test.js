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
jest.mock('../src/services/claudeCodeHeadersService', () => ({}))
jest.mock('../src/models/redis', () => ({}))
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
  getPricingData: jest.fn(() => null)
}))

const claudeRelayService = require('../src/services/relay/claudeRelayService')
const metadataUserIdHelper = require('../src/utils/metadataUserIdHelper')

describe('claudeRelayService non-real Claude Code normalization', () => {
  it('uses Claude Code system array shape without moving custom system text into messages', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      system: 'Custom system instructions'
    }

    const result = claudeRelayService._processRequestBody(body, null, false)

    expect(result.system).toEqual([
      { type: 'text', text: claudeRelayService.claudeCodeSystemPrompt },
      { type: 'text', text: 'Custom system instructions' }
    ])
    expect(result.messages).toEqual(body.messages)
    expect(result.max_tokens).toBe(32000)
    expect(result.temperature).toBe(1)
    expect(metadataUserIdHelper.isValid(result.metadata.user_id)).toBe(true)
  })

  it('preserves a captured Claude Code prompt block and removes billing markers', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      system: [
        { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.140;' },
        {
          type: 'text',
          text: claudeRelayService.claudeCodeSystemPrompt,
          cache_control: { type: 'ephemeral' }
        },
        { type: 'text', text: 'Generate a concise title.' }
      ],
      max_tokens: 1024,
      temperature: 0.2
    }

    const result = claudeRelayService._processRequestBody(body, null, false)

    expect(result.system).toEqual([
      {
        type: 'text',
        text: claudeRelayService.claudeCodeSystemPrompt,
        cache_control: { type: 'ephemeral' }
      },
      { type: 'text', text: 'Generate a concise title.' }
    ])
    expect(result.max_tokens).toBe(1024)
    expect(result.temperature).toBe(0.2)
  })

  it('rewrites the canonical OpenCode identity sentence before forwarding', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      system: 'You are OpenCode, the best coding agent on the planet.'
    }

    const result = claudeRelayService._processRequestBody(body, null, false)

    expect(result.system).toEqual([
      {
        type: 'text',
        text: claudeRelayService.claudeCodeSystemPrompt
      }
    ])
  })

  it('cleans fixed descriptions from known non-real Claude Code tools', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [
        {
          name: 'edit',
          description:
            'Modify existing files (REPLACES apply_patch). Requires a prior Read in this session; ensure oldString uniquely matches.',
          input_schema: {}
        },
        {
          type: 'custom',
          name: 'webfetch',
          custom: {
            description:
              'OpenCode webfetch tool. Always set format to text | markdown | html; read-only; short cache window.',
            input_schema: {}
          }
        },
        {
          name: 'bash',
          description: 'OpenClaw/QwenPaw shell tool. Run commands without a workdir parameter.',
          input_schema: {}
        },
        {
          name: 'read',
          description: 'CoPaw file reader. Reads files from the current workspace.',
          input_schema: {}
        },
        {
          name: 'business_tool',
          description: 'Call the internal business workflow.',
          input_schema: {}
        }
      ]
    }

    const result = claudeRelayService._processRequestBody(body, null, false)

    expect(result.tools[0].description).toBe('Modify existing files by replacing exact text.')
    expect(result.tools[1].custom.description).toBe('Fetch content from a URL.')
    expect(result.tools[2].description).toBe('Run shell commands in the user environment.')
    expect(result.tools[3].description).toBe('Read file contents.')
    expect(result.tools[4].description).toBe('Call the internal business workflow.')
  })

  it('does not clean fixed tool descriptions for actual Claude Code requests', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      system: claudeRelayService.claudeCodeSystemPrompt,
      tools: [
        {
          name: 'edit',
          description:
            'Modify existing files (REPLACES apply_patch). Requires a prior Read in this session.',
          input_schema: {}
        }
      ]
    }

    const result = claudeRelayService._processRequestBody(body, null, true)

    expect(result.tools[0].description).toBe(
      'Modify existing files (REPLACES apply_patch). Requires a prior Read in this session.'
    )
  })

  it('applies sub2api-style static tool-name mimicry without rewriting history', () => {
    const body = {
      tools: [
        { name: 'sessions_list', input_schema: {} },
        { name: 'session_get', input_schema: {} },
        { type: 'web_search_20250305', name: 'web_search' }
      ],
      tool_choice: { type: 'tool', name: 'sessions_list' },
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'sessions_list', input: {} }]
        }
      ]
    }

    const map = claudeRelayService._transformToolNamesInRequestBody(body)

    expect(body.tools[0].name).toBe('cc_sess_list')
    expect(body.tools[1].name).toBe('cc_ses_get')
    expect(body.tools[2].name).toBe('web_search')
    expect(body.tool_choice.name).toBe('cc_sess_list')
    expect(body.messages[0].content[0].name).toBe('sessions_list')
    expect(map.get('cc_sess_list')).toBe('sessions_list')
    expect(map.get('cc_ses_get')).toBe('session_get')
  })

  it('uses stable dynamic tool-name mimicry only above the sub2api threshold', () => {
    const buildBody = () => ({
      tools: ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].map((name) => ({
        name,
        input_schema: {}
      }))
    })
    const first = buildBody()
    const second = buildBody()

    const firstMap = claudeRelayService._transformToolNamesInRequestBody(first)
    const secondMap = claudeRelayService._transformToolNamesInRequestBody(second)

    expect(first.tools.map((tool) => tool.name)).toEqual(second.tools.map((tool) => tool.name))
    expect(first.tools.map((tool) => tool.name)).not.toEqual([
      'alpha',
      'bravo',
      'charlie',
      'delta',
      'echo',
      'foxtrot'
    ])
    expect(firstMap.size).toBe(6)
    expect(secondMap.size).toBe(6)
    first.tools.forEach((tool) => {
      expect(tool.name).toMatch(/^[a-z]+_[a-z0-9]{1,3}\d{2}$/)
    })
  })

  it('restores mimicry names in response bytes, including static names without a map', () => {
    const body = {
      tools: [{ name: 'sessions_list', input_schema: {} }]
    }
    const map = claudeRelayService._transformToolNamesInRequestBody(body)

    const dynamicRestored = claudeRelayService._restoreToolNamesInResponseBody(
      '{"content":[{"type":"tool_use","name":"cc_sess_list"}]}',
      map
    )
    const staticRestored = claudeRelayService._restoreToolNamesInResponseBody(
      '{"content":[{"type":"tool_use","name":"cc_ses_get"}]}',
      null
    )

    expect(dynamicRestored).toContain('"name":"sessions_list"')
    expect(staticRestored).toContain('"name":"session_get"')
  })

  it('restores static mimicry names in streaming text when enabled', () => {
    const transform = claudeRelayService._createToolNameStripperStreamTransformer(null, null, true)

    const restored = transform(
      'event: content_block_start\ndata: {"content_block":{"type":"tool_use","name":"cc_ses_get"}}\n\n'
    )

    expect(restored).toContain('"name":"session_get"')
  })
})
