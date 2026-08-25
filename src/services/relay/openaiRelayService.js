/**
 * OpenAI (ChatGPT / Codex OAuth) 中继服务 —— 账户连通性测试
 *
 * 为什么需要这个文件：Codex 账户的出站请求逻辑原本内联写死在 openaiRoutes.js
 * 里，没有像 claude 那样抽成 relay service。本模块把"准备账户凭据 + 构造 Codex
 * 出站请求"收口为可复用方法，供手动连通性测试使用，并为未来的定时测试留好
 * seam（届时只需新增 testAccountConnectionSync）。
 *
 * 与 claudeRelayService 的三处关键差异（照抄 claude 会踩坑）：
 *   1. openaiAccountService 没有 getValidAccessToken，需自行
 *      getAccount → isTokenExpired → refreshAccountToken → 重新 getAccount
 *   2. openaiAccountService.getAccount() **不解密** accessToken，必须显式 decrypt
 *   3. 代理用 ProxyHelper.createProxyAgent，不是 claude 的 _getProxyAgent
 */

const axios = require('axios')
const logger = require('../../utils/logger')
const ProxyHelper = require('../../utils/proxyHelper')
const openaiAccountService = require('../account/openaiAccountService')
const modelsConfig = require('../../../config/models')
const { createOpenAITestPayload, extractErrorMessage } = require('../../utils/testPayloadHelper')

const CODEX_RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
const TEST_TIMEOUT_MS = 30000
const TEST_MAX_OUTPUT_TOKENS = 16

// 上游限流的错误类型（与 openaiRoutes.js 的业务链路保持一致）
const RATE_LIMIT_ERROR_TYPES = new Set([
  'rate_limit_error',
  'usage_limit_reached',
  'rate_limit_exceeded'
])

// 默认测试模型取自模型清单首项（该清单最新在前），避免在此处再硬编码一份
function getDefaultTestModel() {
  const first = modelsConfig.OPENAI_MODELS && modelsConfig.OPENAI_MODELS[0]
  return (first && first.value) || 'gpt-5.6-sol'
}

function formatResetDuration(seconds) {
  if (!seconds || Number.isNaN(seconds)) {
    return null
  }
  const total = Math.ceil(seconds)
  if (total < 60) {
    return `${total} 秒`
  }
  const minutes = Math.ceil(total / 60)
  if (minutes < 60) {
    return `${minutes} 分钟`
  }
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes > 0 ? `${hours} 小时 ${remainMinutes} 分钟` : `${hours} 小时`
}

class OpenAIRelayService {
  /**
   * 准备测试所需的账户信息、access token 与代理
   * @returns {Promise<{account: object, accessToken: string, proxyAgent: object|null}>}
   */
  async _prepareAccountForTest(accountId) {
    let account = await openaiAccountService.getAccount(accountId)
    if (!account) {
      throw new Error('Account not found')
    }

    // openaiAccountService 无 getValidAccessToken，沿用既有的过期判断 + 刷新模式
    if (openaiAccountService.isTokenExpired(account)) {
      logger.info(`🔄 Access token expired, refreshing before test: ${accountId}`)
      await openaiAccountService.refreshAccountToken(accountId)
      account = await openaiAccountService.getAccount(accountId)
      if (!account) {
        throw new Error('Account not found after token refresh')
      }
    }

    // ⚠️ getAccount 不解密 accessToken（与 claude 不同），必须显式解密
    let accessToken = null
    if (account.accessToken) {
      try {
        accessToken = openaiAccountService.decrypt(account.accessToken)
      } catch (error) {
        throw new Error(`Failed to decrypt access token: ${error.message}`)
      }
    }
    if (!accessToken) {
      throw new Error('Failed to get valid access token')
    }

    let proxyAgent = null
    if (account.proxy) {
      try {
        const proxy = typeof account.proxy === 'string' ? JSON.parse(account.proxy) : account.proxy
        proxyAgent = ProxyHelper.createProxyAgent(proxy)
      } catch (error) {
        logger.warn(`⚠️ Failed to build proxy agent for account ${accountId}: ${error.message}`)
      }
    }

    return { account, accessToken, proxyAgent }
  }

  /**
   * 构造 Codex 出站测试请求（最小合规 Responses 请求体 + 必要请求头）
   */
  _buildTestRequest({ account, accessToken, proxyAgent, accountId, model }) {
    // 最小 payload：不带 instructions / tools（那是 Codex CLI 的行为，非上游硬性要求）
    const payload = createOpenAITestPayload(model, {
      stream: true,
      maxTokens: TEST_MAX_OUTPUT_TOKENS
    })
    // ⚠️ 实测：Codex backend 明确拒绝 max_output_tokens
    //   → HTTP 400 {"detail":"Unsupported parameter: max_output_tokens"}
    // 该参数在公开 Responses API 可用，但在 /backend-api/codex/responses 上不被接受。
    // 若保留会导致"账户其实正常却报测试失败"的假阳性，故必须剔除。
    delete payload.max_output_tokens
    // 与业务链路一致：Codex responses 端点强制不落存储
    payload.store = false

    const headers = {
      authorization: `Bearer ${accessToken}`,
      'chatgpt-account-id': account.accountId || account.chatgptUserId || accountId,
      host: 'chatgpt.com',
      accept: 'text/event-stream',
      'content-type': 'application/json'
    }

    const axiosConfig = {
      headers,
      timeout: TEST_TIMEOUT_MS,
      responseType: 'stream',
      validateStatus: () => true
    }

    if (proxyAgent) {
      axiosConfig.httpAgent = proxyAgent
      axiosConfig.httpsAgent = proxyAgent
      axiosConfig.proxy = false
    }

    return { payload, axiosConfig }
  }

  /**
   * 🧪 测试账户连通性（SSE 流式，供 Admin API 使用）
   *
   * 输出事件契约与前端 useTestState 对齐：
   *   {type:'test_start'} / {type:'content', text} / {type:'test_complete', success, error}
   */
  async testAccountConnection(accountId, res, model) {
    const testModel = model || getDefaultTestModel()
    const startTime = Date.now()

    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
    }

    const write = (event) => {
      try {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      } catch {
        // 客户端已断开，忽略写入错误
      }
    }
    const finish = () => {
      try {
        if (!res.writableEnded) {
          res.end()
        }
      } catch {
        // 忽略
      }
    }

    try {
      const { account, accessToken, proxyAgent } = await this._prepareAccountForTest(accountId)

      logger.info(
        `🧪 Testing OpenAI (Codex) account connection: ${account.name} (${accountId}), model: ${testModel}`
      )
      write({ type: 'test_start', model: testModel })

      const { payload, axiosConfig } = this._buildTestRequest({
        account,
        accessToken,
        proxyAgent,
        accountId,
        model: testModel
      })

      const upstream = await axios.post(CODEX_RESPONSES_ENDPOINT, payload, axiosConfig)

      // 429：账户可达但配额已耗尽 —— 与"连接失败"是两回事
      if (upstream.status === 429) {
        await this._handleRateLimited({ upstream, accountId, account, write })
        finish()
        return
      }

      if (upstream.status >= 400) {
        const errorBody = await this._collectStreamBody(upstream.data)
        let parsed = null
        try {
          parsed = JSON.parse(errorBody)
        } catch {
          parsed = null
        }
        const message = extractErrorMessage(parsed, errorBody || `HTTP ${upstream.status}`)
        logger.error(
          `❌ OpenAI (Codex) account test failed: ${account.name} (${accountId}), status ${upstream.status}`
        )
        write({
          type: 'test_complete',
          success: false,
          error: `上游返回 HTTP ${upstream.status}：${message}`,
          latency: Date.now() - startTime
        })
        finish()
        return
      }

      await this._pipeTestStream({ upstream, write, accountId, account, startTime, testModel })
      finish()
    } catch (error) {
      // 真实连接失败（token 失效 / 代理不通 / DNS 等）：如实报错，且不标记限流
      logger.error(`❌ OpenAI (Codex) account test error: ${accountId}`, error.message)
      write({
        type: 'test_complete',
        success: false,
        error: error.message || '测试失败',
        latency: Date.now() - startTime
      })
      finish()
    }
  }

  /**
   * 处理上游 429：结果语义为"可达但已限流"，同时按业务同规则标记账户限流
   */
  async _handleRateLimited({ upstream, accountId, account, write }) {
    const body = await this._collectStreamBody(upstream.data)
    let resetsInSeconds = null
    try {
      const parsed = JSON.parse(body)
      if (parsed && parsed.error && parsed.error.resets_in_seconds) {
        resetsInSeconds = parsed.error.resets_in_seconds
      }
    } catch {
      // 解析失败时仍按限流处理，只是拿不到重置时间
    }

    const resetText = formatResetDuration(resetsInSeconds)

    // 测试消耗的是与业务请求同一份 Codex 周期配额，故该限流对调度器同样成立，
    // 必须计入账户状态，否则调度会继续把请求投给一张已限流的账户。
    let marked = false
    try {
      const unifiedOpenAIScheduler = require('../scheduler/unifiedOpenAIScheduler')
      await unifiedOpenAIScheduler.markAccountRateLimited(
        accountId,
        'openai',
        null,
        resetsInSeconds
      )
      marked = true
    } catch (error) {
      logger.error(`⚠️ Failed to mark OpenAI account rate limited after test: ${error.message}`)
    }

    logger.warn(
      `🚫 OpenAI (Codex) account test hit rate limit: ${account.name} (${accountId})` +
        (resetText ? `, resets in ${resetText}` : '')
    )

    write({
      type: 'content',
      text:
        `账户可达：上游已正常响应鉴权，但当前 Codex 周期配额已用尽（HTTP 429）。` +
        (resetText ? `预计 ${resetText}后重置。` : '') +
        (marked ? '已按业务同规则将该账户标记为限流。' : '')
    })
    write({
      type: 'test_complete',
      success: false,
      error:
        `账户可达但已被限流${resetText ? `，约 ${resetText}后重置` : ''}` +
        (marked ? '；已标记该账户限流' : '')
    })
  }

  /**
   * 解析上游 Responses SSE，转成前端期望的事件
   */
  async _pipeTestStream({ upstream, write, accountId, account, startTime, testModel }) {
    return new Promise((resolve) => {
      let buffer = ''
      let gotContent = false
      let actualModel = testModel
      let failed = false
      let errorMessage = ''
      let rateLimited = false
      let resetsInSeconds = null

      const handleEvent = (json) => {
        let data
        try {
          data = JSON.parse(json)
        } catch {
          return
        }
        if (!data || typeof data !== 'object') {
          return
        }

        // 文本增量
        if (data.type === 'response.output_text.delta' && data.delta) {
          gotContent = true
          write({ type: 'content', text: data.delta })
          return
        }

        // 完成事件：取实际模型
        if (data.type === 'response.completed' && data.response) {
          if (data.response.model) {
            actualModel = data.response.model
          }
          return
        }

        // 错误事件
        if (data.type === 'error' || data.error) {
          const err = data.error || data
          failed = true
          errorMessage = err.message || err.type || '上游返回错误'
          if (err.type && RATE_LIMIT_ERROR_TYPES.has(err.type)) {
            rateLimited = true
            resetsInSeconds = err.resets_in_seconds || null
          }
        }
      }

      const processLine = (line) => {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) {
          return
        }
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') {
          return
        }
        handleEvent(payload)
      }

      const onEnd = async () => {
        if (buffer.trim()) {
          processLine(buffer)
        }

        const latency = Date.now() - startTime

        if (rateLimited) {
          // 流内出现限流错误：与 HTTP 429 同样处理（计入限流状态）
          let marked = false
          try {
            const unifiedOpenAIScheduler = require('../scheduler/unifiedOpenAIScheduler')
            await unifiedOpenAIScheduler.markAccountRateLimited(
              accountId,
              'openai',
              null,
              resetsInSeconds
            )
            marked = true
          } catch (error) {
            logger.error(`⚠️ Failed to mark rate limited from stream: ${error.message}`)
          }
          const resetText = formatResetDuration(resetsInSeconds)
          logger.warn(`🚫 OpenAI (Codex) test rate limited (stream): ${accountId}`)
          write({
            type: 'test_complete',
            success: false,
            error:
              `账户可达但已被限流${resetText ? `，约 ${resetText}后重置` : ''}` +
              (marked ? '；已标记该账户限流' : ''),
            latency
          })
          return resolve()
        }

        if (failed) {
          logger.error(`❌ OpenAI (Codex) test stream error: ${accountId} - ${errorMessage}`)
          write({ type: 'test_complete', success: false, error: errorMessage, latency })
          return resolve()
        }

        if (!gotContent) {
          logger.warn(`⚠️ OpenAI (Codex) test produced no content: ${accountId}`)
          write({
            type: 'test_complete',
            success: false,
            error: '上游未返回任何内容，无法确认连通性',
            latency
          })
          return resolve()
        }

        logger.success(
          `✅ OpenAI (Codex) account test passed: ${account.name} (${accountId}), model: ${actualModel}, latency: ${latency}ms`
        )
        write({ type: 'message_stop' })
        write({ type: 'test_complete', success: true, model: actualModel, latency })
        return resolve()
      }

      upstream.data.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          processLine(line)
        }
      })
      upstream.data.on('end', () => {
        onEnd().catch(() => resolve())
      })
      upstream.data.on('error', (error) => {
        logger.error(`❌ OpenAI (Codex) test stream aborted: ${accountId}`, error.message)
        write({
          type: 'test_complete',
          success: false,
          error: error.message || '上游流中断',
          latency: Date.now() - startTime
        })
        resolve()
      })
    })
  }

  /**
   * 收集流式响应体（用于错误分支）
   */
  async _collectStreamBody(stream) {
    if (!stream) {
      return ''
    }
    if (typeof stream === 'string') {
      return stream
    }
    if (typeof stream.on !== 'function') {
      try {
        return JSON.stringify(stream)
      } catch {
        return ''
      }
    }
    return new Promise((resolve) => {
      const chunks = []
      let settled = false
      const done = () => {
        if (settled) {
          return
        }
        settled = true
        resolve(Buffer.concat(chunks).toString())
      }
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      stream.on('end', done)
      stream.on('error', done)
      setTimeout(done, 5000)
    })
  }
}

module.exports = new OpenAIRelayService()
