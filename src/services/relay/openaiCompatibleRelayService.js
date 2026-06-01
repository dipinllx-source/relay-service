/**
 * OpenAI-Compatible 转发服务
 * 把已转换为 OpenAI Chat Completions 形态的请求转发到兼容上游，
 * 并把上游响应（流式/非流式）经 claudeToOpenai 转回 Anthropic 格式返回客户端。
 * 转发/代理/错误处理模式对齐 openaiResponsesRelayService.js
 */

const axios = require('axios')
const ProxyHelper = require('../../utils/proxyHelper')
const logger = require('../../utils/logger')
const claudeToOpenai = require('../claudeToOpenai')
const openaiCompatibleAccountService = require('../account/openaiCompatibleAccountService')
const apiKeyService = require('../apiKeyService')

const DEFAULT_TIMEOUT = 600000

class OpenAICompatibleRelayService {
  /**
   * @param {Object} req - Express 请求
   * @param {Object} res - Express 响应
   * @param {Object} account - 调度选中的账号（至少含 id）
   * @param {Object} apiKeyData - 认证后的 API Key 数据
   * @param {Object} ctx - { openaiBody, requestModel, targetModel, stream }
   */
  async handleRequest(req, res, account, apiKeyData, ctx) {
    const { openaiBody, requestModel, targetModel, stream } = ctx

    const fullAccount = await openaiCompatibleAccountService.getAccount(account.id)
    if (!fullAccount) {
      return this._sendError(res, 502, 'api_error', 'Selected account not found')
    }

    const targetUrl = `${fullAccount.baseUrl}/v1/chat/completions`
    const headers = {
      Authorization: `Bearer ${fullAccount.apiKey}`,
      'Content-Type': 'application/json'
    }

    const abortController = new AbortController()
    req.on('close', () => abortController.abort())

    const requestOptions = {
      method: 'POST',
      url: targetUrl,
      headers,
      data: openaiBody,
      timeout: DEFAULT_TIMEOUT,
      responseType: stream ? 'stream' : 'json',
      validateStatus: () => true,
      signal: abortController.signal
    }
    if (fullAccount.proxy) {
      const agent = ProxyHelper.createProxyAgent(fullAccount.proxy)
      requestOptions.httpAgent = agent
      requestOptions.httpsAgent = agent
    }

    let response
    try {
      response = await axios(requestOptions)
    } catch (error) {
      logger.error('OpenAI-Compatible upstream request failed:', error.message)
      return this._sendError(res, 502, 'api_error', `Upstream request failed: ${error.message}`)
    }

    if (response.status >= 400) {
      return this._handleUpstreamError(res, response, account, stream)
    }

    if (stream) {
      return this._handleStream(res, response, account, apiKeyData, requestModel, targetModel)
    }
    return this._handleJson(res, response, account, apiKeyData, requestModel, targetModel)
  }

  _handleJson(res, response, account, apiKeyData, requestModel, targetModel) {
    const anthropic = claudeToOpenai.convertResponse(response.data, requestModel)
    this._recordUsage(apiKeyData, anthropic.usage, targetModel, account.id)
    openaiCompatibleAccountService.updateAccountUsage(account.id).catch(() => {})
    res.status(200).json(anthropic)
  }

  _handleStream(res, response, account, apiKeyData, requestModel, targetModel) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const state = claudeToOpenai.createStreamState()
    let buffer = ''

    response.data.on('data', (chunk) => {
      buffer += chunk.toString()
      const idx = buffer.lastIndexOf('\n')
      if (idx === -1) {
        return
      }
      const ready = buffer.slice(0, idx + 1)
      buffer = buffer.slice(idx + 1)
      const sse = claudeToOpenai.convertStreamChunk(ready, state, requestModel)
      if (sse) {
        res.write(sse)
      }
    })

    response.data.on('end', () => {
      if (buffer.trim()) {
        const sse = claudeToOpenai.convertStreamChunk(buffer, state, requestModel)
        if (sse) {
          res.write(sse)
        }
      }
      const tail = claudeToOpenai.finalizeStream(state)
      if (tail) {
        res.write(tail)
      }
      res.end()

      this._recordUsage(
        apiKeyData,
        { input_tokens: state.inputTokens, output_tokens: state.outputTokens },
        targetModel,
        account.id
      )
      openaiCompatibleAccountService.updateAccountUsage(account.id).catch(() => {})
    })

    response.data.on('error', (error) => {
      logger.error('OpenAI-Compatible upstream stream error:', error.message)
      if (!res.headersSent) {
        this._sendError(res, 502, 'api_error', 'Upstream stream error')
      } else {
        res.end()
      }
    })
  }

  async _handleUpstreamError(res, response, account, stream) {
    let bodyText = ''
    try {
      bodyText = stream ? await this._streamToString(response.data) : JSON.stringify(response.data)
    } catch (e) {
      bodyText = ''
    }

    const { status } = response
    if (status === 429) {
      openaiCompatibleAccountService.markAccountRateLimited(account.id).catch(() => {})
      return this._sendError(res, 429, 'rate_limit_error', `Upstream rate limited: ${bodyText}`)
    }
    if (status === 401 || status === 403) {
      return this._sendError(res, 403, 'permission_error', `Upstream auth failed: ${bodyText}`)
    }
    return this._sendError(res, 502, 'api_error', `Upstream error ${status}: ${bodyText}`)
  }

  _recordUsage(apiKeyData, usage, model, accountId) {
    try {
      apiKeyService
        .recordUsage(
          apiKeyData.id,
          (usage && usage.input_tokens) || 0,
          (usage && usage.output_tokens) || 0,
          0,
          0,
          model,
          accountId,
          'openai-compatible',
          null,
          null
        )
        .catch((e) => logger.warn('recordUsage failed:', e.message))
    } catch (e) {
      logger.warn('recordUsage threw:', e.message)
    }
  }

  _streamToString(stream) {
    return new Promise((resolve, reject) => {
      let data = ''
      stream.on('data', (c) => {
        data += c.toString()
      })
      stream.on('end', () => resolve(data))
      stream.on('error', reject)
    })
  }

  _sendError(res, status, type, message) {
    if (res.headersSent) {
      return res.end()
    }
    return res.status(status).json({
      type: 'error',
      error: { type, message }
    })
  }
}

module.exports = new OpenAICompatibleRelayService()
