// Mock logger，避免测试输出污染控制台
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))

const converter = require('../src/services/claudeToOpenai')

// 解析合成的 Anthropic SSE 文本为 [{event, data}]
const parseSSE = (text) => {
  const events = []
  for (const block of text.split('\n\n')) {
    if (!block.trim()) {
      continue
    }
    const lines = block.split('\n')
    let event = null
    let data = null
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        event = line.slice(7)
      } else if (line.startsWith('data: ')) {
        data = JSON.parse(line.slice(6))
      }
    }
    events.push({ event, data })
  }
  return events
}

describe('ClaudeToOpenAIConverter.resolveTargetModel', () => {
  test('头部覆盖优先级最高', () => {
    const model = converter.resolveTargetModel({
      headerModel: 'gpt-4o',
      clientModel: 'claude-3-5-haiku-20241022',
      account: { modelMapping: { 'claude-3-5-haiku-20241022': 'gpt-3.5' }, defaultModel: 'gpt-x' }
    })
    expect(model).toBe('gpt-4o')
  })

  test('命中账号映射表（精确）', () => {
    const model = converter.resolveTargetModel({
      clientModel: 'claude-3-5-haiku-20241022',
      account: { modelMapping: { 'claude-3-5-haiku-20241022': 'gpt-4o-mini' } }
    })
    expect(model).toBe('gpt-4o-mini')
  })

  test('命中账号映射表（前缀通配）', () => {
    const model = converter.resolveTargetModel({
      clientModel: 'claude-sonnet-4-5-20250101',
      account: { modelMapping: { 'claude-sonnet-*': 'gpt-4o' } }
    })
    expect(model).toBe('gpt-4o')
  })

  test('无覆盖无映射时回退账号默认模型', () => {
    const model = converter.resolveTargetModel({
      clientModel: 'claude-3-opus',
      account: { defaultModel: 'gpt-4-turbo' }
    })
    expect(model).toBe('gpt-4-turbo')
  })

  test('claude-* 永不透传：无任何配置时也返回 gpt 模型', () => {
    const model = converter.resolveTargetModel({ clientModel: 'claude-3-5-haiku' })
    expect(model.startsWith('claude')).toBe(false)
    expect(model).toBe('gpt-4o-mini')
  })
})

describe('ClaudeToOpenAIConverter.convertRequest', () => {
  test('system 数组合并并剔除 cache_control', () => {
    const out = converter.convertRequest(
      {
        system: [{ type: 'text', text: '你是助手', cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: '你好' }],
        max_tokens: 100
      },
      'gpt-4o'
    )
    expect(out.messages[0]).toEqual({ role: 'system', content: '你是助手' })
    expect(out.messages[1]).toEqual({ role: 'user', content: '你好' })
    expect(out.model).toBe('gpt-4o')
    expect(out.max_tokens).toBe(100)
  })

  test('流式注入 stream_options.include_usage', () => {
    const out = converter.convertRequest(
      { messages: [{ role: 'user', content: 'hi' }], stream: true },
      'gpt-4o'
    )
    expect(out.stream).toBe(true)
    expect(out.stream_options).toEqual({ include_usage: true })
  })

  test('采样参数与 stop_sequences 映射', () => {
    const out = converter.convertRequest(
      {
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.5,
        top_p: 0.9,
        stop_sequences: ['END']
      },
      'gpt-4o'
    )
    expect(out.temperature).toBe(0.5)
    expect(out.top_p).toBe(0.9)
    expect(out.stop).toEqual(['END'])
  })

  test('工具定义与 tool_choice 映射', () => {
    const out = converter.convertRequest(
      {
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'get_weather', description: '查天气', input_schema: { type: 'object' } }],
        tool_choice: { type: 'auto' }
      },
      'gpt-4o'
    )
    expect(out.tools[0]).toEqual({
      type: 'function',
      function: { name: 'get_weather', description: '查天气', parameters: { type: 'object' } }
    })
    expect(out.tool_choice).toBe('auto')
  })

  test('历史 tool_result 转为 role:tool 消息', () => {
    const out = converter.convertRequest(
      {
        messages: [
          { role: 'user', content: '查天气' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'X', name: 'get_weather', input: { city: 'hz' } }]
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'X', content: '25°C' }]
          }
        ]
      },
      'gpt-4o'
    )
    const assistant = out.messages.find((m) => m.role === 'assistant')
    expect(assistant.tool_calls[0]).toEqual({
      id: 'X',
      type: 'function',
      function: { name: 'get_weather', arguments: JSON.stringify({ city: 'hz' }) }
    })
    const toolMsg = out.messages.find((m) => m.role === 'tool')
    expect(toolMsg).toEqual({ role: 'tool', tool_call_id: 'X', content: '25°C' })
  })

  test('base64 图片转为 data URL', () => {
    const out = converter.convertRequest(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '看图' },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'AAAA' }
              }
            ]
          }
        ]
      },
      'gpt-4o'
    )
    const userMsg = out.messages[out.messages.length - 1]
    expect(Array.isArray(userMsg.content)).toBe(true)
    expect(userMsg.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAA' }
    })
  })
})

describe('ClaudeToOpenAIConverter.convertResponse', () => {
  test('普通文本响应', () => {
    const out = converter.convertResponse(
      {
        choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      },
      'claude-sonnet-4'
    )
    expect(out.type).toBe('message')
    expect(out.role).toBe('assistant')
    expect(out.model).toBe('claude-sonnet-4')
    expect(out.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(out.stop_reason).toBe('end_turn')
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 5 })
  })

  test('length → max_tokens', () => {
    const out = converter.convertResponse(
      { choices: [{ message: { content: 'x' }, finish_reason: 'length' }] },
      'm'
    )
    expect(out.stop_reason).toBe('max_tokens')
  })

  test('tool_calls 还原为 tool_use 块', () => {
    const out = converter.convertResponse(
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: 'c1', function: { name: 'f', arguments: '{"a":1}' } }]
            },
            finish_reason: 'tool_calls'
          }
        ]
      },
      'm'
    )
    expect(out.stop_reason).toBe('tool_use')
    const toolUse = out.content.find((b) => b.type === 'tool_use')
    expect(toolUse).toEqual({ type: 'tool_use', id: 'c1', name: 'f', input: { a: 1 } })
  })
})

describe('ClaudeToOpenAIConverter streaming', () => {
  test('文本流合成完整 Anthropic 事件序列', () => {
    const state = converter.createStreamState()
    let sse = ''
    sse += converter.convertStreamChunk(
      'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n',
      state,
      'claude-x'
    )
    sse += converter.convertStreamChunk(
      'data: {"choices":[{"delta":{"content":"He"},"finish_reason":null}]}\n',
      state,
      'claude-x'
    )
    sse += converter.convertStreamChunk(
      'data: {"choices":[{"delta":{"content":"llo"},"finish_reason":null}]}\n',
      state,
      'claude-x'
    )
    sse += converter.convertStreamChunk(
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
      state,
      'claude-x'
    )
    sse += converter.convertStreamChunk(
      'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":3}}\n',
      state,
      'claude-x'
    )
    sse += converter.convertStreamChunk('data: [DONE]\n', state, 'claude-x')

    const events = parseSSE(sse)
    const types = events.map((e) => e.event)
    expect(types).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop'
    ])
    // 文本拼接
    const deltas = events.filter((e) => e.event === 'content_block_delta')
    expect(deltas.map((e) => e.data.delta.text).join('')).toBe('Hello')
    // usage 落入 message_delta
    const msgDelta = events.find((e) => e.event === 'message_delta')
    expect(msgDelta.data.usage.output_tokens).toBe(3)
    expect(msgDelta.data.delta.stop_reason).toBe('end_turn')
  })

  test('工具调用流式：content_block_start(tool_use) + input_json_delta', () => {
    const state = converter.createStreamState()
    let sse = ''
    sse += converter.convertStreamChunk(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"f","arguments":""}}]},"finish_reason":null}]}\n',
      state,
      'claude-x'
    )
    sse += converter.convertStreamChunk(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"a\\":1}"}}]},"finish_reason":null}]}\n',
      state,
      'claude-x'
    )
    sse += converter.convertStreamChunk(
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
      state,
      'claude-x'
    )
    sse += converter.convertStreamChunk('data: [DONE]\n', state, 'claude-x')

    const events = parseSSE(sse)
    const start = events.find((e) => e.event === 'content_block_start')
    expect(start.data.content_block).toEqual({ type: 'tool_use', id: 't1', name: 'f', input: {} })
    const jsonDelta = events.find(
      (e) => e.event === 'content_block_delta' && e.data.delta.type === 'input_json_delta'
    )
    expect(jsonDelta.data.delta.partial_json).toBe('{"a":1}')
    const msgDelta = events.find((e) => e.event === 'message_delta')
    expect(msgDelta.data.delta.stop_reason).toBe('tool_use')
  })

  test('finalizeStream 幂等，无 [DONE] 时也能收尾', () => {
    const state = converter.createStreamState()
    let sse = converter.convertStreamChunk(
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n',
      state,
      'claude-x'
    )
    sse += converter.finalizeStream(state)
    const again = converter.finalizeStream(state) // 第二次应为空
    expect(again).toBe('')
    const events = parseSSE(sse)
    expect(events.map((e) => e.event)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop'
    ])
  })
})
