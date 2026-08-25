const express = require('express')
const fs = require('fs')
const os = require('os')
const path = require('path')
const axios = require('axios')
const claudeCodeHeadersService = require('../../services/claudeCodeHeadersService')
const claudeAccountService = require('../../services/account/claudeAccountService')
const openaiAccountService = require('../../services/account/openaiAccountService')
const codexClientVersion = require('../../utils/codexClientVersion')
const redis = require('../../models/redis')
const { authenticateAdmin } = require('../../middleware/auth')
const logger = require('../../utils/logger')
const config = require('../../../config/config')
const upgradeService = require('../../services/upgradeService')

const router = express.Router()

// ==================== Claude Code Headers 管理 ====================

// 获取所有 Claude Code headers
router.get('/claude-code-headers', authenticateAdmin, async (req, res) => {
  try {
    const allHeaders = await claudeCodeHeadersService.getAllAccountHeaders()

    // 获取所有 Claude 账号信息
    const accounts = await claudeAccountService.getAllAccounts()
    const accountMap = {}
    accounts.forEach((account) => {
      accountMap[account.id] = account.name
    })

    // 格式化输出
    const formattedData = Object.entries(allHeaders).map(([accountId, data]) => ({
      accountId,
      accountName: accountMap[accountId] || 'Unknown',
      version: data.version,
      userAgent: data.headers['user-agent'],
      updatedAt: data.updatedAt,
      headers: data.headers
    }))

    return res.json({
      success: true,
      data: formattedData
    })
  } catch (error) {
    logger.error('❌ Failed to get Claude Code headers:', error)
    return res
      .status(500)
      .json({ error: 'Failed to get Claude Code headers', message: error.message })
  }
})

// 🗑️ 清除指定账号的 Claude Code headers
router.delete('/claude-code-headers/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    await claudeCodeHeadersService.clearAccountHeaders(accountId)

    return res.json({
      success: true,
      message: `Claude Code headers cleared for account ${accountId}`
    })
  } catch (error) {
    logger.error('❌ Failed to clear Claude Code headers:', error)
    return res
      .status(500)
      .json({ error: 'Failed to clear Claude Code headers', message: error.message })
  }
})

// ==================== 系统更新检查 ====================

// ==================== 系统更新检查 ====================
// 版本感知实现见 src/services/upgradeService.js
// （OpenSpec: release-version-awareness）
//   - 感知源为 git ls-remote --tags origin（零凭据，不请求 GitHub API）
//   - tag 为发布契约，一律使用全限定 refs/tags/*
//   - semver 比较含 prerelease 优先级；prerelease 默认不提示
// 旧实现的 compareVersions 已移除：它按 '.' 分割后 Number('3-alpha') → NaN，
// 会把 1.2.3-alpha 误判为等于 1.2.3。

router.get('/check-updates', authenticateAdmin, async (req, res) => {
  try {
    const data = await upgradeService.checkForUpdates({
      allowPrerelease: req.query.allowPrerelease === 'true'
    })
    return res.json({ success: true, data })
  } catch (error) {
    // 远端不可达等异常不应阻塞管理台加载
    logger.warn(`⚠️ check-updates failed: ${error.message}`)
    return res.json({
      success: true,
      data: {
        current: upgradeService.getCurrentVersion(),
        latest: upgradeService.getCurrentVersion(),
        hasUpdate: false,
        error: error.message
      }
    })
  }
})

// ==================== OEM 设置管理 ====================

// 获取OEM设置（公开接口，用于显示）
// 注意：这个端点没有 authenticateAdmin 中间件，因为前端登录页也需要访问
router.get('/oem-settings', async (req, res) => {
  try {
    const client = redis.getClient()
    const oemSettings = await client.get('oem:settings')

    // 默认设置
    const defaultSettings = {
      siteName: 'Relay Service',
      siteIcon: '',
      siteIconData: '', // Base64编码的图标数据
      showAdminButton: true, // 是否显示管理后台按钮
      apiStatsNotice: {
        enabled: false,
        title: '',
        content: ''
      },
      updatedAt: new Date().toISOString()
    }

    let settings = defaultSettings
    if (oemSettings) {
      try {
        settings = { ...defaultSettings, ...JSON.parse(oemSettings) }
      } catch (err) {
        logger.warn('⚠️ Failed to parse OEM settings, using defaults:', err.message)
      }
    }

    // 添加 LDAP 启用状态到响应中
    return res.json({
      success: true,
      data: {
        ...settings,
        ldapEnabled: config.ldap && config.ldap.enabled === true
      }
    })
  } catch (error) {
    logger.error('❌ Failed to get OEM settings:', error)
    return res.status(500).json({ error: 'Failed to get OEM settings', message: error.message })
  }
})

// 更新OEM设置
router.put('/oem-settings', authenticateAdmin, async (req, res) => {
  try {
    const { siteName, siteIcon, siteIconData, showAdminButton, apiStatsNotice } = req.body

    // 验证输入
    if (!siteName || typeof siteName !== 'string' || siteName.trim().length === 0) {
      return res.status(400).json({ error: 'Site name is required' })
    }

    if (siteName.length > 100) {
      return res.status(400).json({ error: 'Site name must be less than 100 characters' })
    }

    // 验证图标数据大小（如果是base64）
    if (siteIconData && siteIconData.length > 500000) {
      // 约375KB
      return res.status(400).json({ error: 'Icon file must be less than 350KB' })
    }

    // 验证图标URL（如果提供）
    if (siteIcon && !siteIconData) {
      // 简单验证URL格式
      try {
        new URL(siteIcon)
      } catch (err) {
        return res.status(400).json({ error: 'Invalid icon URL format' })
      }
    }

    const settings = {
      siteName: siteName.trim(),
      siteIcon: (siteIcon || '').trim(),
      siteIconData: (siteIconData || '').trim(), // Base64数据
      showAdminButton: showAdminButton !== false, // 默认为true
      apiStatsNotice: {
        enabled: apiStatsNotice?.enabled === true,
        title: (apiStatsNotice?.title || '').trim().slice(0, 100),
        content: (apiStatsNotice?.content || '').trim().slice(0, 2000)
      },
      updatedAt: new Date().toISOString()
    }

    const client = redis.getClient()
    await client.set('oem:settings', JSON.stringify(settings))

    logger.info(`✅ OEM settings updated: ${siteName}`)

    return res.json({
      success: true,
      message: 'OEM settings updated successfully',
      data: settings
    })
  } catch (error) {
    logger.error('❌ Failed to update OEM settings:', error)
    return res.status(500).json({ error: 'Failed to update OEM settings', message: error.message })
  }
})

// ==================== Claude Code 版本管理 ====================

router.get('/claude-code-version', authenticateAdmin, async (req, res) => {
  try {
    const CACHE_KEY = 'claude_code_user_agent:daily'

    // 获取缓存的统一User-Agent
    const unifiedUserAgent = await redis.client.get(CACHE_KEY)
    const ttl = unifiedUserAgent ? await redis.client.ttl(CACHE_KEY) : 0

    res.json({
      success: true,
      userAgent: unifiedUserAgent,
      isActive: !!unifiedUserAgent,
      ttlSeconds: ttl,
      lastUpdated: unifiedUserAgent ? new Date().toISOString() : null
    })
  } catch (error) {
    logger.error('❌ Get unified Claude Code User-Agent error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to get User-Agent information',
      error: error.message
    })
  }
})

// 🗑️ 清除统一Claude Code User-Agent缓存
router.post('/claude-code-version/clear', authenticateAdmin, async (req, res) => {
  try {
    const CACHE_KEY = 'claude_code_user_agent:daily'

    // 删除缓存的统一User-Agent
    await redis.client.del(CACHE_KEY)

    logger.info(`🗑️ Admin manually cleared unified Claude Code User-Agent cache`)

    res.json({
      success: true,
      message: 'Unified User-Agent cache cleared successfully'
    })
  } catch (error) {
    logger.error('❌ Clear unified User-Agent cache error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to clear cache',
      error: error.message
    })
  }
})

// ==================== 模型价格管理 ====================

const pricingService = require('../../services/pricingService')

// 获取所有模型价格数据
router.get('/models/pricing', authenticateAdmin, async (req, res) => {
  try {
    if (!pricingService.pricingData || Object.keys(pricingService.pricingData).length === 0) {
      await pricingService.loadPricingData()
    }
    const data = pricingService.pricingData
    res.json({
      success: true,
      data: data || {}
    })
  } catch (error) {
    logger.error('Failed to get model pricing:', error)
    res.status(500).json({ error: 'Failed to get model pricing', message: error.message })
  }
})

// 获取价格服务状态
router.get('/models/pricing/status', authenticateAdmin, async (req, res) => {
  try {
    const status = pricingService.getStatus()
    res.json({ success: true, data: status })
  } catch (error) {
    logger.error('Failed to get pricing status:', error)
    res.status(500).json({ error: 'Failed to get pricing status', message: error.message })
  }
})

// 强制刷新价格数据
router.post('/models/pricing/refresh', authenticateAdmin, async (req, res) => {
  try {
    const result = await pricingService.forceUpdate()
    res.json({ success: result.success, message: result.message })
  } catch (error) {
    logger.error('Failed to refresh pricing:', error)
    res.status(500).json({ error: 'Failed to refresh pricing', message: error.message })
  }
})

// ==================== 网络端点发现 ====================
// 返回本机可用于复制到客户端的 IPv4 / IPv6 裸 host；IPv6 缺省时用 ::ffff:<ipv4> 合成。
// 仅返回 host 部分，前端拼 protocol + port（按浏览器当前连接推算）。

function pickNetworkEndpoints() {
  const ifaces = os.networkInterfaces()
  let ipv4 = null
  let ipv6 = null
  for (const addrs of Object.values(ifaces)) {
    if (!addrs) {
      continue
    }
    for (const addr of addrs) {
      if (addr.internal) {
        continue
      }
      if (addr.family === 'IPv4' && !ipv4) {
        // 跳过 link-local (169.254/16)
        if (!addr.address.startsWith('169.254.')) {
          ipv4 = addr.address
        }
      } else if (addr.family === 'IPv6' && !ipv6) {
        // 跳过 link-local (fe80::/10)、loopback (::1)
        const lower = addr.address.toLowerCase()
        if (!lower.startsWith('fe80:') && lower !== '::1') {
          // 部分系统会带 %scope 后缀，剥掉
          ipv6 = addr.address.replace(/%.*$/, '')
        }
      }
    }
  }
  let synthesizedIpv6 = false
  if (!ipv6 && ipv4) {
    ipv6 = `::ffff:${ipv4}`
    synthesizedIpv6 = true
  }
  return { ipv4, ipv6, synthesizedIpv6 }
}

router.get('/network-endpoints', authenticateAdmin, async (req, res) => {
  try {
    const { ipv4, ipv6, synthesizedIpv6 } = pickNetworkEndpoints()
    res.json({ success: true, ipv4, ipv6, synthesizedIpv6 })
  } catch (error) {
    logger.error('Failed to pick network endpoints:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== Codex 客户端版本管理 ====================
// client_version 是上游模型清单接口的能力门控参数，由「流量学习 + npm latest +
// floor 常量」三源取最大值自动解析。这里提供只读查看与清缓存入口，便于排查
// 「清单条数偏少」是否由版本解析过低导致。

router.get('/codex-client-version', authenticateAdmin, async (req, res) => {
  try {
    const diagnostics = await codexClientVersion.getVersionDiagnostics()
    const modelsCache = openaiAccountService.getModelsCacheInfo()
    res.json({ success: true, ...diagnostics, modelsCache })
  } catch (error) {
    logger.error('❌ Get Codex client version error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to get Codex client version information',
      error: error.message
    })
  }
})

router.post('/codex-client-version/clear', authenticateAdmin, async (req, res) => {
  try {
    await codexClientVersion.clearVersionCache()
    openaiAccountService.clearModelsCache()
    logger.info('🗑️ Admin cleared Codex client version and models cache')
    res.json({ success: true, message: 'Codex client version and models cache cleared' })
  } catch (error) {
    logger.error('❌ Clear Codex client version cache error:', error)
    res.status(500).json({ success: false, message: 'Failed to clear cache', error: error.message })
  }
})

module.exports = router
