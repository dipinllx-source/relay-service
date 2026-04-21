/**
 * Admin Routes - HTTPS 只读状态与 CA 下载
 *
 * 安全边界：
 *   本模块只返回 CA 公钥证书（ca.crt）。任何私钥（ca.key / server.key）文件
 *   **绝不**通过任何 HTTP 路径暴露：下载处理器 hardcode 文件名为 `ca.crt`，
 *   不接受任何文件名参数，从而杜绝 path traversal 与文件名注入攻击面。
 */

const express = require('express')
const fs = require('fs')
const path = require('path')

const { authenticateAdmin } = require('../../middleware/auth')
const logger = require('../../utils/logger')
const config = require('../../../config/config')
const certificateManager = require('../../utils/certificateManager')

const router = express.Router()

// 告警阈值：到期前若干天开始在 status 响应中附加 warning
const CERT_WARN_DAYS = 30
const CA_WARN_DAYS = 90

// ==================== HTTPS 状态 ====================

router.get('/https/status', authenticateAdmin, async (req, res) => {
  try {
    if (!config.https.enabled) {
      return res.json({
        success: true,
        data: {
          enabled: false
        }
      })
    }

    const paths = certificateManager.certPaths(config.https.certDir)
    if (!fs.existsSync(paths.serverCert) || !fs.existsSync(paths.caCert)) {
      return res.json({
        success: true,
        data: {
          enabled: true,
          port: config.https.port,
          minTlsVersion: config.https.minTlsVersion,
          warning: 'HTTPS is enabled but certificate files are missing from disk'
        }
      })
    }

    const serverPem = fs.readFileSync(paths.serverCert, 'utf8')
    const caPem = fs.readFileSync(paths.caCert, 'utf8')
    const serverInfo = certificateManager.describeCert(serverPem)
    const caInfo = certificateManager.describeCert(caPem)

    const warnings = []
    if (serverInfo.daysRemaining < CERT_WARN_DAYS) {
      warnings.push(
        `Server certificate expires in ${serverInfo.daysRemaining} day(s). Delete server.crt/server.key and restart to re-sign with existing CA.`
      )
    }
    if (caInfo.daysRemaining < CA_WARN_DAYS) {
      warnings.push(
        `Root CA expires in ${caInfo.daysRemaining} day(s). Renewing CA requires re-distributing ca.crt to every client.`
      )
    }

    return res.json({
      success: true,
      data: {
        enabled: true,
        port: config.https.port,
        minTlsVersion: config.https.minTlsVersion,
        hstsEnabled: config.https.hstsEnabled,
        certSubject: serverInfo.subject,
        certIssuer: serverInfo.issuer,
        certSan: serverInfo.sanList,
        certNotBefore: serverInfo.notBefore,
        certNotAfter: serverInfo.notAfter,
        certDaysRemaining: serverInfo.daysRemaining,
        certSerialNumber: serverInfo.serialNumber,
        caSubject: caInfo.subject,
        caNotBefore: caInfo.notBefore,
        caNotAfter: caInfo.notAfter,
        caDaysRemaining: caInfo.daysRemaining,
        caSerialNumber: caInfo.serialNumber,
        warning: warnings.length > 0 ? warnings.join(' ') : undefined
      }
    })
  } catch (error) {
    logger.error('❌ Failed to build HTTPS status response:', error)
    return res.status(500).json({
      error: 'Failed to get HTTPS status',
      message: error.message
    })
  }
})

// ==================== CA 公钥下载 ====================
// 仅允许下载 ca.crt；hardcode 文件名（不接收路径 / 参数），防止任何 path traversal

router.get('/https/ca', authenticateAdmin, async (req, res) => {
  try {
    if (!config.https.enabled) {
      return res.status(404).json({
        error: 'HTTPS not enabled',
        message: 'HTTPS is currently disabled; no CA certificate to download'
      })
    }

    // 路径 hardcode 为 certDir + 'ca.crt'，禁止任何动态拼接
    const caCertPath = path.join(config.https.certDir, 'ca.crt')
    if (!fs.existsSync(caCertPath)) {
      return res.status(404).json({
        error: 'CA certificate not found',
        message: 'HTTPS is enabled but ca.crt does not exist on disk yet'
      })
    }

    const caPem = fs.readFileSync(caCertPath, 'utf8')
    // 防御式自检：确保内容是 PEM 证书，而非任何其他内容
    if (!caPem.includes('BEGIN CERTIFICATE')) {
      logger.error(
        `🔒 SECURITY: ${caCertPath} does not contain a PEM CERTIFICATE block. Refusing to serve.`
      )
      return res.status(500).json({
        error: 'CA file format error'
      })
    }

    res.setHeader('Content-Type', 'application/x-x509-ca-cert')
    res.setHeader('Content-Disposition', 'attachment; filename="ca.crt"')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(caPem)
  } catch (error) {
    logger.error('❌ Failed to serve CA certificate:', error)
    return res.status(500).json({
      error: 'Failed to serve CA certificate',
      message: error.message
    })
  }
})

module.exports = router
