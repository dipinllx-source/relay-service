/**
 * Claude → OpenAI 路由
 * 接受 Anthropic Messages API 格式（Claude Code），后端转发到 OpenAI Chat Completions 兼容上游（GPT）
 * 对称于 openaiClaudeRoutes.js（OpenAI 客户端 → Claude 后端）
 */

const express = require('express')
const router = express.Router()
const logger = require('../utils/logger')
const { authenticateApiKey } = require('../middleware/auth')
const apiKeyService = require('../services/apiKeyService')
const claudeToOpenai = require('../services/claudeToOpenai')
const openaiCompatibleAccountService = require('../services/account/openaiCompatibleAccountService')
const openaiCompatibleRelayService = require('../services/relay/openaiCompatibleRelayService')
const unifiedOpenAIScheduler = require('../services/scheduler/unifiedOpenAIScheduler')
const sessionHelper = require('../utils/sessionHelper')

function checkPermissions(apiKeyData, requiredPermission = 'openai') {
  return apiKeyService.hasPermission(apiKeyData?.permissions, requiredPermission)
}

function anthropicError(res, status, type, message) {
  return res.status(status).json({ type: 'error', error: { type, message } })
}

router.post('/v1/messages', authenticateApiKey, async (req, res) => {
  try {
    const apiKeyData = req.apiKey

    if (!checkPermissions(apiKeyData, 'openai')) {
      return anthropicError(
        res,
        403,
        'permission_error',
        'This API key does not have permission to access OpenAI'
      )
    }

    const anthropicRequest = req.body
    if (!anthropicRequest || !Array.isArray(anthropicRequest.messages)) {
      return anthropicError(res, 400, 'invalid_request_error', 'messages is required')
    }

    // 粘性会话选号（隔离实现，仅在 openai-compatible 账号间选择）
    const sessionHash = sessionHelper.generateSessionHash(anthropicRequest)
    const selection = await unifiedOpenAIScheduler.selectCompatibleAccountForApiKey(
      apiKeyData,
      sessionHash
    )
    if (!selection) {
      return anthropicError(res, 503, 'overloaded_error', 'No available openai-compatible account')
    }
    const account = await openaiCompatibleAccountService.getAccount(selection.accountId)
    if (!account) {
      return anthropicError(res, 503, 'overloaded_error', 'Selected account unavailable')
    }

    const headerModel = req.headers['x-target-model'] || anthropicRequest.target_model
    const targetModel = claudeToOpenai.resolveTargetModel({
      headerModel,
      clientModel: anthropicRequest.model,
      account
    })

    const stream = anthropicRequest.stream === true
    const openaiBody = claudeToOpenai.convertRequest(anthropicRequest, targetModel)

    logger.info(
      `🔀 Claude→OpenAI relay: model ${anthropicRequest.model} → ${targetModel} (account ${account.name}, stream=${stream})`
    )

    return await openaiCompatibleRelayService.handleRequest(req, res, account, apiKeyData, {
      openaiBody,
      requestModel: anthropicRequest.model,
      targetModel,
      stream
    })
  } catch (error) {
    logger.error('Claude→OpenAI route error:', error)
    if (!res.headersSent) {
      return anthropicError(res, 500, 'api_error', error.message)
    }
    return res.end()
  }
})

module.exports = router
