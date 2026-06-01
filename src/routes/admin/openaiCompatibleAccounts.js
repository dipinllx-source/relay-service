/**
 * Admin Routes - OpenAI-Compatible 账户管理
 * 处理「通用 OpenAI Chat Completions 兼容」账户的增删改查与状态切换
 * 用于 Claude Code（Anthropic）→ GPT（Chat Completions）适配链路
 */

const express = require('express')
const openaiCompatibleAccountService = require('../../services/account/openaiCompatibleAccountService')
const apiKeyService = require('../../services/apiKeyService')
const { authenticateAdmin } = require('../../middleware/auth')
const logger = require('../../utils/logger')

const router = express.Router()

// 将 modelMapping 规范化为对象（前端可能传 JSON 字符串）
function normalizeModelMapping(value) {
  if (value === undefined) {
    return undefined
  }
  if (value === null || value === '') {
    return null
  }
  if (typeof value === 'object') {
    return value
  }
  try {
    return JSON.parse(value)
  } catch (e) {
    throw new Error('modelMapping 必须是合法 JSON 对象')
  }
}

// 获取所有 OpenAI-Compatible 账户
router.get('/openai-compatible-accounts', authenticateAdmin, async (req, res) => {
  try {
    const accounts = await openaiCompatibleAccountService.getAllAccounts(true)

    // 统计每个账号被直连绑定的 API Key 数量
    const allApiKeys = await apiKeyService.getAllApiKeysLite()
    const bindingCountMap = new Map()
    for (const key of allApiKeys) {
      const binding = key.openaiAccountId
      if (!binding) {
        continue
      }
      const accountId = binding.startsWith('compatible:') ? binding.substring(11) : binding
      bindingCountMap.set(accountId, (bindingCountMap.get(accountId) || 0) + 1)
    }

    const data = accounts.map((account) => ({
      ...account,
      boundApiKeysCount: bindingCountMap.get(account.id) || 0
    }))

    return res.json({ success: true, data })
  } catch (error) {
    logger.error('Failed to list openai-compatible accounts:', error)
    return res.status(500).json({ success: false, message: error.message })
  }
})

// 创建账户
router.post('/openai-compatible-accounts', authenticateAdmin, async (req, res) => {
  try {
    const options = { ...req.body }
    const mapping = normalizeModelMapping(options.modelMapping)
    if (mapping !== undefined) {
      options.modelMapping = mapping
    }
    const account = await openaiCompatibleAccountService.createAccount(options)
    return res.json({ success: true, data: account })
  } catch (error) {
    logger.error('Failed to create openai-compatible account:', error)
    return res.status(400).json({ success: false, message: error.message })
  }
})

// 更新账户
router.put('/openai-compatible-accounts/:id', authenticateAdmin, async (req, res) => {
  try {
    const updates = { ...req.body }
    // 空 apiKey 表示不更新
    if (updates.apiKey === '' || updates.apiKey === undefined) {
      delete updates.apiKey
    }
    const mapping = normalizeModelMapping(updates.modelMapping)
    if (mapping !== undefined) {
      updates.modelMapping = mapping
    }
    await openaiCompatibleAccountService.updateAccount(req.params.id, updates)
    return res.json({ success: true })
  } catch (error) {
    logger.error('Failed to update openai-compatible account:', error)
    return res.status(400).json({ success: false, message: error.message })
  }
})

// 删除账户
router.delete('/openai-compatible-accounts/:id', authenticateAdmin, async (req, res) => {
  try {
    await openaiCompatibleAccountService.deleteAccount(req.params.id)
    return res.json({ success: true })
  } catch (error) {
    logger.error('Failed to delete openai-compatible account:', error)
    return res.status(500).json({ success: false, message: error.message })
  }
})

// 切换启用状态
router.put('/openai-compatible-accounts/:id/toggle', authenticateAdmin, async (req, res) => {
  try {
    const account = await openaiCompatibleAccountService.getAccount(req.params.id)
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' })
    }
    const nextActive = !(account.isActive === true || account.isActive === 'true')
    await openaiCompatibleAccountService.updateAccount(req.params.id, {
      isActive: nextActive.toString()
    })
    return res.json({ success: true, data: { isActive: nextActive } })
  } catch (error) {
    logger.error('Failed to toggle openai-compatible account:', error)
    return res.status(500).json({ success: false, message: error.message })
  }
})

// 切换可调度状态
router.put(
  '/openai-compatible-accounts/:id/toggle-schedulable',
  authenticateAdmin,
  async (req, res) => {
    try {
      const account = await openaiCompatibleAccountService.getAccount(req.params.id)
      if (!account) {
        return res.status(404).json({ success: false, message: 'Account not found' })
      }
      const nextSchedulable = !(account.schedulable === true || account.schedulable === 'true')
      await openaiCompatibleAccountService.updateAccount(req.params.id, {
        schedulable: nextSchedulable.toString()
      })
      return res.json({ success: true, data: { schedulable: nextSchedulable } })
    } catch (error) {
      logger.error('Failed to toggle-schedulable openai-compatible account:', error)
      return res.status(500).json({ success: false, message: error.message })
    }
  }
)

module.exports = router
