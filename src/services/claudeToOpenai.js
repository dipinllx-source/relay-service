/**
 * Claude 到 OpenAI 格式转换服务
 * 处理 Anthropic Messages API 格式与 OpenAI Chat Completions 格式之间的转换
 * 方向与 openaiToClaude.js 相反：Claude Code（Anthropic）客户端 → GPT（OpenAI Chat Completions）后端
 */

const logger = require('../utils/logger')

class ClaudeToOpenAIConverter {
  constructor() {
    // OpenAI finish_reason → Anthropic stop_reason
    this.stopReasonMapping = {
      stop: 'end_turn',
      length: 'max_tokens',
      tool_calls: 'tool_use',
      function_call: 'tool_use',
      content_filter: 'end_turn'
    }

    // 出厂默认 claude→gpt 映射（账号配置可覆盖）；最后一条为兜底，保证不会把 claude-* 透传上游
    this.defaultModelMapping = [
      { match: /haiku/i, model: 'gpt-4o-mini' },
      { match: /sonnet/i, model: 'gpt-4o' },
      { match: /opus/i, model: 'gpt-4o' },
      { match: /.*/, model: 'gpt-4o-mini' }
    ]
  }

  /**
   * 解析实际调用的目标 GPT 模型
   * 顺序：头部/参数覆盖 → 账号 modelMapping（精确/前缀）→ 出厂默认映射 → 账号默认模型
   * @param {Object} opts
   * @param {String} [opts.headerModel] - 显式覆盖（如 x-target-model）
   * @param {String} [opts.clientModel] - 客户端发来的 claude-* 模型名
   * @param {Object} [opts.account] - 选中的 openai-compatible 账号（含 modelMapping/defaultModel）
   * @returns {String} 目标 GPT 模型名
   */
  resolveTargetModel({ headerModel, clientModel, account } = {}) {
    if (headerModel) {
      return headerModel
    }

    const mapping = account && account.modelMapping
    if (mapping && clientModel) {
      if (mapping[clientModel]) {
        return mapping[clientModel]
      }
      for (const key of Object.keys(mapping)) {
        const prefix = key.endsWith('*') ? key.slice(0, -1) : key
        if (prefix && clientModel.startsWith(prefix)) {
          return mapping[key]
        }
      }
    }

    for (const rule of this.defaultModelMapping) {
      if (rule.match.test(clientModel || '')) {
        return account && account.defaultModel ? account.defaultModel : rule.model
      }
    }

    return (account && account.defaultModel) || 'gpt-4o-mini'
  }

  /**
   * 将 Anthropic Messages 请求转换为 OpenAI Chat Completions 请求
   * @param {Object} anthropicRequest - Anthropic 格式请求
   * @param {String} targetModel - 已解析的目标 GPT 模型
   * @returns {Object} OpenAI 格式请求
   */
  convertRequest(anthropicRequest, targetModel) {
    const messages = []

    // system：字符串或数组 → 单条 system 消息（剔除 cache_control）
    const systemText = this._extractSystemText(anthropicRequest.system)
    if (systemText) {
      messages.push({ role: 'system', content: systemText })
    }

    for (const msg of anthropicRequest.messages || []) {
      this._appendConvertedMessage(messages, msg)
    }

    const openaiRequest = {
      model: targetModel || anthropicRequest.model,
      messages,
      stream: anthropicRequest.stream || false
    }

    if (typeof anthropicRequest.max_tokens === 'number') {
      openaiRequest.max_tokens = anthropicRequest.max_tokens
    }
    if (typeof anthropicRequest.temperature === 'number') {
      openaiRequest.temperature = anthropicRequest.temperature
    }
    if (typeof anthropicRequest.top_p === 'number') {
      openaiRequest.top_p = anthropicRequest.top_p
    }
    if (anthropicRequest.stop_sequences) {
      openaiRequest.stop = anthropicRequest.stop_sequences
    }

    // 流式必须注入 include_usage，否则上游不返回 usage，无法填 message_delta
    if (openaiRequest.stream) {
      openaiRequest.stream_options = { include_usage: true }
    }

    if (anthropicRequest.tools) {
      openaiRequest.tools = this._convertTools(anthropicRequest.tools)
      if (anthropicRequest.tool_choice) {
        openaiRequest.tool_choice = this._convertToolChoice(anthropicRequest.tool_choice)
      }
    }

    // 无对应特性（thinking、metadata 等）在此被忽略，不报错
    logger.debug('📝 Converted Claude request to OpenAI format:', {
      model: openaiRequest.model,
      messageCount: openaiRequest.messages.length,
      hasTools: !!openaiRequest.tools,
      stream: openaiRequest.stream
    })

    return openaiRequest
  }

  /**
   * 将 OpenAI Chat Completions 响应转换为 Anthropic message 信封
   * @param {Object} openaiResponse - OpenAI 格式响应
   * @param {String} requestModel - 客户端原始模型名（回写给客户端）
   * @returns {Object} Anthropic 格式响应
   */
  convertResponse(openaiResponse, requestModel) {
    const choice = (openaiResponse.choices && openaiResponse.choices[0]) || {}
    const message = choice.message || {}
    const content = []

    if (typeof message.content === 'string' && message.content.length > 0) {
      content.push({ type: 'text', text: message.content })
    }

    if (Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function && tc.function.name,
          input: this._safeParseJson(tc.function && tc.function.arguments)
        })
      }
    }

    if (content.length === 0) {
      content.push({ type: 'text', text: '' })
    }

    const usage = openaiResponse.usage || {}
    return {
      id: `msg_${this._generateId()}`,
      type: 'message',
      role: 'assistant',
      model: requestModel,
      content,
      stop_reason: this._mapStopReason(choice.finish_reason),
      stop_sequence: null,
      usage: {
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0
      }
    }
  }

  /**
   * 创建一次流式请求的状态
   */
  createStreamState() {
    return {
      started: false,
      finished: false,
      messageId: `msg_${this._generateId()}`,
      openIndex: -1, // 当前打开的内容块索引（Anthropic 同一时刻仅一个块打开）
      openType: null, // 'text' | 'tool_use'
      nextIndex: 0,
      toolIndexMap: {}, // openai tool_calls index → anthropic block index
      finishReason: null,
      inputTokens: 0,
      outputTokens: 0
    }
  }

  /**
   * 处理一段 OpenAI SSE 文本，合成 Anthropic SSE 事件序列
   * 调用方负责跨网络分片的行缓冲，本方法按完整 `data:` 行处理
   * @param {String} rawChunk - OpenAI SSE 文本（可能含多行 data:）
   * @param {Object} state - createStreamState() 返回的状态（会被修改）
   * @param {String} requestModel - 客户端原始模型名
   * @returns {String} 合成的 Anthropic SSE 文本
   */
  convertStreamChunk(rawChunk, state, requestModel) {
    if (!rawChunk) {
      return ''
    }

    const out = []
    const lines = rawChunk.split('\n')

    for (const line of lines) {
      if (!line.startsWith('data:')) {
        continue
      }
      const data = line.slice(5).trim()
      if (data === '') {
        continue
      }
      if (data === '[DONE]') {
        out.push(this._finalizeStream(state))
        continue
      }

      let chunk
      try {
        chunk = JSON.parse(data)
      } catch (e) {
        continue
      }

      if (!state.started) {
        out.push(this._emitMessageStart(state, requestModel))
        state.started = true
      }

      if (chunk.usage) {
        state.inputTokens = chunk.usage.prompt_tokens || state.inputTokens
        state.outputTokens = chunk.usage.completion_tokens || state.outputTokens
      }

      const choice = (chunk.choices && chunk.choices[0]) || null
      if (!choice) {
        continue
      }

      const delta = choice.delta || {}

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        out.push(this._emitText(state, delta.content))
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          out.push(this._emitToolCall(state, tc))
        }
      }

      if (choice.finish_reason) {
        state.finishReason = choice.finish_reason
      }
    }

    return out.join('')
  }

  /**
   * 在流结束（上游连接关闭且无 [DONE]）时补齐收尾事件，幂等
   */
  finalizeStream(state) {
    return this._finalizeStream(state)
  }

  // ---------- 私有方法 ----------

  _emitMessageStart(state, requestModel) {
    return this._sse('message_start', {
      type: 'message_start',
      message: {
        id: state.messageId,
        type: 'message',
        role: 'assistant',
        model: requestModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: state.inputTokens || 0, output_tokens: 0 }
      }
    })
  }

  _emitText(state, text) {
    let prefix = ''
    if (state.openType !== 'text') {
      prefix += this._closeOpenBlock(state)
      state.openIndex = state.nextIndex
      state.nextIndex += 1
      state.openType = 'text'
      prefix += this._sse('content_block_start', {
        type: 'content_block_start',
        index: state.openIndex,
        content_block: { type: 'text', text: '' }
      })
    }
    return (
      prefix +
      this._sse('content_block_delta', {
        type: 'content_block_delta',
        index: state.openIndex,
        delta: { type: 'text_delta', text }
      })
    )
  }

  _emitToolCall(state, tc) {
    const key = typeof tc.index === 'number' ? tc.index : 0
    let prefix = ''

    if (state.toolIndexMap[key] === undefined) {
      prefix += this._closeOpenBlock(state)
      const index = state.nextIndex
      state.nextIndex += 1
      state.toolIndexMap[key] = index
      state.openIndex = index
      state.openType = 'tool_use'
      prefix += this._sse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: tc.id || `toolu_${this._generateId()}`,
          name: (tc.function && tc.function.name) || '',
          input: {}
        }
      })
    }

    const args = tc.function && tc.function.arguments
    if (args) {
      prefix += this._sse('content_block_delta', {
        type: 'content_block_delta',
        index: state.toolIndexMap[key],
        delta: { type: 'input_json_delta', partial_json: args }
      })
    }
    return prefix
  }

  _closeOpenBlock(state) {
    if (state.openIndex < 0) {
      return ''
    }
    const index = state.openIndex
    state.openIndex = -1
    state.openType = null
    return this._sse('content_block_stop', { type: 'content_block_stop', index })
  }

  _finalizeStream(state) {
    if (state.finished) {
      return ''
    }
    state.finished = true

    let out = ''
    if (!state.started) {
      out += this._emitMessageStart(state, state.model)
      state.started = true
    }
    out += this._closeOpenBlock(state)
    out += this._sse('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: this._mapStopReason(state.finishReason),
        stop_sequence: null
      },
      usage: { output_tokens: state.outputTokens || 0 }
    })
    out += this._sse('message_stop', { type: 'message_stop' })
    return out
  }

  _sse(eventType, data) {
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
  }

  _extractSystemText(system) {
    if (!system) {
      return ''
    }
    if (typeof system === 'string') {
      return system
    }
    if (Array.isArray(system)) {
      return system
        .map((block) => (typeof block === 'string' ? block : block && block.text) || '')
        .filter(Boolean)
        .join('\n\n')
    }
    return ''
  }

  _appendConvertedMessage(messages, msg) {
    const { role } = msg
    const { content } = msg

    if (typeof content === 'string') {
      messages.push({ role, content })
      return
    }

    if (!Array.isArray(content)) {
      messages.push({ role, content: JSON.stringify(content) })
      return
    }

    // tool_result 块 → 独立的 role:'tool' 消息
    const toolResults = content.filter((b) => b && b.type === 'tool_result')
    for (const tr of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: tr.tool_use_id,
        content: this._stringifyToolResultContent(tr.content)
      })
    }

    // tool_use 块（assistant）→ tool_calls
    const toolUses = content.filter((b) => b && b.type === 'tool_use')

    // 文本/图片块 → 普通内容
    const mediaParts = content
      .filter((b) => b && (b.type === 'text' || b.type === 'image'))
      .map((b) => this._convertContentBlock(b))
      .filter(Boolean)

    if (toolUses.length > 0) {
      const assistantMsg = {
        role: 'assistant',
        content: this._flattenTextParts(mediaParts),
        tool_calls: toolUses.map((tu) => ({
          id: tu.id,
          type: 'function',
          function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) }
        }))
      }
      messages.push(assistantMsg)
      return
    }

    if (mediaParts.length === 0 && toolResults.length > 0) {
      // 仅含 tool_result 的 user 消息已转为 tool 消息，无需再追加
      return
    }

    // 若仅有纯文本，OpenAI 接受字符串；含图片则用数组
    messages.push({ role, content: this._flattenTextParts(mediaParts) })
  }

  _flattenTextParts(parts) {
    if (parts.length === 0) {
      return ''
    }
    if (parts.every((p) => p.type === 'text')) {
      return parts.map((p) => p.text).join('')
    }
    return parts
  }

  _convertContentBlock(block) {
    if (block.type === 'text') {
      return { type: 'text', text: block.text }
    }
    if (block.type === 'image' && block.source) {
      if (block.source.type === 'base64') {
        return {
          type: 'image_url',
          image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` }
        }
      }
      if (block.source.type === 'url') {
        return { type: 'image_url', image_url: { url: block.source.url } }
      }
    }
    return null
  }

  _stringifyToolResultContent(content) {
    if (typeof content === 'string') {
      return content
    }
    if (Array.isArray(content)) {
      return content
        .map((b) =>
          b && b.type === 'text' ? b.text : typeof b === 'string' ? b : JSON.stringify(b)
        )
        .join('')
    }
    return content === undefined || content === null ? '' : JSON.stringify(content)
  }

  _convertTools(tools) {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema
      }
    }))
  }

  _convertToolChoice(toolChoice) {
    if (typeof toolChoice === 'string') {
      return toolChoice
    }
    if (!toolChoice || !toolChoice.type) {
      return 'auto'
    }
    if (toolChoice.type === 'auto') {
      return 'auto'
    }
    if (toolChoice.type === 'any') {
      return 'required'
    }
    if (toolChoice.type === 'none') {
      return 'none'
    }
    if (toolChoice.type === 'tool' && toolChoice.name) {
      return { type: 'function', function: { name: toolChoice.name } }
    }
    return 'auto'
  }

  _mapStopReason(openaiReason) {
    return this.stopReasonMapping[openaiReason] || 'end_turn'
  }

  _safeParseJson(str) {
    if (!str) {
      return {}
    }
    try {
      return JSON.parse(str)
    } catch (e) {
      return {}
    }
  }

  _generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }
}

module.exports = new ClaudeToOpenAIConverter()
