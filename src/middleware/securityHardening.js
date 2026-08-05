/**
 * 🛡️ Security Hardening Middleware
 *
 * 集中实现安全评估报告（report_final.pdf）中 P0~P2 修复所需的中间件：
 *   - isTrustedMonitoring: 判定请求是否可信（有效 admin 会话 或 IP 白名单 或 回环地址）
 *   - loginRateLimit / penalizeLogin / clearLoginLimit: 登录端点 IP 限流 + 失败锁定
 *   - apiStatsRateLimit: /apiStats/* 公开端点 IP 限流（防枚举/滥用，不破坏公开页面）
 *   - apiKeyBruteforceGuard: 对 API Key 端点的失败尝试做 IP 限流（防 key 枚举/爆破）
 *   - normalizeBody: 将非对象/数组的原始类型 body 归一化为 {}，避免下游处理器抛异常
 *
 * 仅依赖已安装的 rate-limiter-flexible（内存限流，单实例部署足够）。
 */

const { RateLimiterMemory } = require('rate-limiter-flexible')
const redis = require('../models/redis')
const logger = require('../utils/logger')

// ── 可信监控访问判定 ─────────────────────────────────────────────
// 允许的监控来源 IP（逗号分隔），例如 "10.0.0.5,127.0.0.1"。回环地址始终允许。
function parseAllowedIps() {
  const raw = process.env.MONITORING_ALLOWED_IPS || ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeIp(ip) {
  if (!ip) {
    return ''
  }
  // 去掉 IPv6 映射前缀 ::ffff:
  return ip.replace(/^::ffff:/, '')
}

function isLoopback(ip) {
  const n = normalizeIp(ip)
  return n === '127.0.0.1' || n === '::1' || n === 'localhost'
}

/**
 * 判定请求是否来自可信来源（用于 /metrics、/health 等敏感监控端点是否返回详情）。
 * 可信条件（满足其一）：
 *   1. 携带有效的 admin 会话 token（Authorization: Bearer / x-admin-token）
 *   2. 客户端 IP 属于 MONITORING_ALLOWED_IPS 白名单
 *   3. 回环地址（本机 curl / 探针）
 */
async function isTrustedMonitoring(req) {
  const clientIp = normalizeIp(req.ip || req.connection?.remoteAddress || '')

  if (isLoopback(clientIp)) {
    return true
  }

  const allowed = parseAllowedIps().map(normalizeIp)
  if (allowed.includes(clientIp)) {
    return true
  }

  // 校验 admin 会话 token
  try {
    let token = null
    const authHeader = req.headers.authorization || req.headers.Authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }
    if (!token) {
      token = req.headers['x-admin-token'] || req.headers['x-admin-key'] || null
    }
    if (token) {
      const sessionData = await redis.getSession(token)
      if (sessionData && sessionData.username && sessionData.loginTime) {
        return true
      }
    }
  } catch (error) {
    logger.debug(`isTrustedMonitoring token check failed: ${error.message}`)
  }

  return false
}

// ── 登录限流（IP 维度，失败计数 + 锁定）────────────────────────────
// 报告 P1：同一 IP 15 分钟内最多 N 次失败，超过后锁定并返回 429。
const LOGIN_MAX_FAILURES = parseInt(process.env.LOGIN_MAX_FAILURES || '10', 10)
const LOGIN_WINDOW_SECONDS = parseInt(process.env.LOGIN_WINDOW_SECONDS || '900', 10) // 15 分钟
const LOGIN_BLOCK_SECONDS = parseInt(process.env.LOGIN_BLOCK_SECONDS || '900', 10)

const loginLimiter = new RateLimiterMemory({
  keyPrefix: 'login_fail',
  points: LOGIN_MAX_FAILURES,
  duration: LOGIN_WINDOW_SECONDS,
  blockDuration: LOGIN_BLOCK_SECONDS
})

function loginKey(req) {
  return normalizeIp(req.ip || req.connection?.remoteAddress || 'unknown')
}

/**
 * 登录前置中间件：若该 IP 已被锁定（失败次数超限），直接返回 429，不进入密码校验。
 */
async function loginRateLimit(req, res, next) {
  const key = loginKey(req)
  try {
    const rlRes = await loginLimiter.get(key)
    if (rlRes && rlRes.consumedPoints >= LOGIN_MAX_FAILURES) {
      const retryAfter = Math.ceil((rlRes.msBeforeNext || LOGIN_BLOCK_SECONDS * 1000) / 1000)
      logger.security(`🚦 Login rate limit: IP ${key} blocked (${rlRes.consumedPoints} failures)`)
      res.set('Retry-After', String(retryAfter))
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Too many failed login attempts. Please try again in ${Math.ceil(retryAfter / 60)} minutes.`
      })
    }
  } catch (error) {
    logger.debug(`loginRateLimit get failed: ${error.message}`)
  }
  return next()
}

// 登录失败时调用：累加失败计数
async function penalizeLogin(req) {
  const key = loginKey(req)
  try {
    await loginLimiter.consume(key, 1)
  } catch (rejRes) {
    // 已达上限，消费被拒绝——无需处理，下次 loginRateLimit 会拦截
  }
}

// 登录成功时调用：清除该 IP 的失败计数
async function clearLoginLimit(req) {
  const key = loginKey(req)
  try {
    await loginLimiter.delete(key)
  } catch (error) {
    logger.debug(`clearLoginLimit failed: ${error.message}`)
  }
}

// ── /apiStats/* 公开端点限流（IP 维度）──────────────────────────
// 报告 P2：apiStats 端点公开但存在枚举/滥用面，加 IP 限流而非强制鉴权（避免破坏公开统计页）。
const APISTATS_POINTS = parseInt(process.env.APISTATS_RATE_POINTS || '120', 10) // 每窗口最多 120 次
const APISTATS_WINDOW = parseInt(process.env.APISTATS_RATE_WINDOW || '60', 10) // 60 秒

const apiStatsLimiter = new RateLimiterMemory({
  keyPrefix: 'apistats',
  points: APISTATS_POINTS,
  duration: APISTATS_WINDOW
})

async function apiStatsRateLimit(req, res, next) {
  const key = normalizeIp(req.ip || req.connection?.remoteAddress || 'unknown')
  try {
    await apiStatsLimiter.consume(key, 1)
    return next()
  } catch (rejRes) {
    const retryAfter = Math.ceil((rejRes.msBeforeNext || APISTATS_WINDOW * 1000) / 1000)
    logger.security(`🚦 apiStats rate limit exceeded for IP ${key}`)
    res.set('Retry-After', String(retryAfter))
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many requests to statistics endpoints. Please slow down.'
    })
  }
}

// ── API Key 爆破防护（对失败的 key 认证做 IP 限流）──────────────────
// 报告 P1/P2：/api/v1/chat/completions 等对无效 key 无限速，利于 key 枚举。
// 仅惩罚认证失败（401/403），不影响携带有效 key 的正常请求。
const APIKEY_FAIL_MAX = parseInt(process.env.APIKEY_FAIL_MAX || '20', 10)
const APIKEY_FAIL_WINDOW = parseInt(process.env.APIKEY_FAIL_WINDOW || '300', 10) // 5 分钟
const APIKEY_FAIL_BLOCK = parseInt(process.env.APIKEY_FAIL_BLOCK || '300', 10)

const apiKeyFailLimiter = new RateLimiterMemory({
  keyPrefix: 'apikey_fail',
  points: APIKEY_FAIL_MAX,
  duration: APIKEY_FAIL_WINDOW,
  blockDuration: APIKEY_FAIL_BLOCK
})

// 仅对这些路径的 key 认证失败进行统计（chat/completions、messages、responses）
const GUARDED_PATH_RE = /(chat\/completions|\/v1\/messages|\/responses)/i

async function apiKeyBruteforceGuard(req, res, next) {
  if (!GUARDED_PATH_RE.test(req.path) && !GUARDED_PATH_RE.test(req.originalUrl || '')) {
    return next()
  }

  const key = normalizeIp(req.ip || req.connection?.remoteAddress || 'unknown')

  // 若该 IP 已因大量失败被锁定，直接 429
  try {
    const rlRes = await apiKeyFailLimiter.get(key)
    if (rlRes && rlRes.consumedPoints >= APIKEY_FAIL_MAX) {
      const retryAfter = Math.ceil((rlRes.msBeforeNext || APIKEY_FAIL_BLOCK * 1000) / 1000)
      logger.security(`🚦 API key bruteforce guard: IP ${key} blocked`)
      res.set('Retry-After', String(retryAfter))
      return res.status(429).json({
        error: { message: 'Too many invalid API key attempts. Please try again later.', type: 'rate_limit_error' }
      })
    }
  } catch (error) {
    logger.debug(`apiKeyBruteforceGuard get failed: ${error.message}`)
  }

  // 请求结束后，若为认证失败（401/403），累加该 IP 的失败计数
  res.on('finish', () => {
    if (res.statusCode === 401 || res.statusCode === 403) {
      apiKeyFailLimiter.consume(key, 1).catch(() => {})
    }
  })

  return next()
}

// ── body 归一化 ─────────────────────────────────────────────────
// 报告 P1：非对象/数组的原始 JSON body（string/number/boolean/null）会导致下游处理器
// 抛未捕获异常并返回 500。此处统一归一化为 {}，使下游走正常的参数校验（返回 400）。
function normalizeBody(req, res, next) {
  if (
    req.body !== null &&
    req.body !== undefined &&
    (typeof req.body !== 'object' || req.body instanceof Buffer)
  ) {
    req.body = {}
  }
  return next()
}

module.exports = {
  isTrustedMonitoring,
  loginRateLimit,
  penalizeLogin,
  clearLoginLimit,
  apiStatsRateLimit,
  apiKeyBruteforceGuard,
  normalizeBody
}
