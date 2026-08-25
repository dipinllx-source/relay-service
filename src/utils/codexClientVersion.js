/**
 * Codex 客户端版本解析器
 *
 * 背景：上游 `GET https://chatgpt.com/backend-api/codex/models` 的必填参数
 * `client_version` 是一个**能力门控**——版本越新解锁越多模型，版本落后时上游
 * 返回空数组或不完整清单，且**不报错**。因此该值不能写死：
 *   实测 0.99.0 → 3 个模型；0.139.0 → 5 个；0.144.5 及以上 → 8 个（全量）。
 * 写死一个常量（例如 1.0.0）今天可用，仅因真实 Codex CLI 仍停留在 0.x；
 * 一旦 CLI 进入 1.x，写死值就会变成"降级"并静默截断清单。
 *
 * 策略：三个来源取语义版本最大值，且结果单调不降。
 *   ① 流量学习：从真实 Codex 请求的 User-Agent 提取版本（主源，零外网依赖）
 *   ② npm registry：@openai/codex 的 latest（覆盖"本地客户端落后"的情况）
 *   ③ floor 兜底常量：保证冷启动无流量、无外网时仍可拉取
 *
 * 不上报虚构的超高版本（如 9.9.9）来规避门控——那会让上游返回该版本实际
 * 并不支持的模型能力。
 */

const axios = require('axios')
const redis = require('../models/redis')
const logger = require('./logger')

// Redis 键
const LEARNED_KEY = 'codex_client_version:learned'
const NPM_KEY = 'codex_client_version:npm'

// 流量学习值 TTL：25 小时（与 claude_code_user_agent:daily 一致，
// 保证每天有流量即可续期；长期无 Codex 流量则自然回落到其余来源）
const LEARNED_TTL_SECONDS = 90000

// npm latest 缓存 TTL：24 小时
const NPM_TTL_SECONDS = 86400

// floor 兜底常量：已实测该版本可取得完整清单（8 个模型）
const FLOOR_VERSION = process.env.CODEX_CLIENT_VERSION_FLOOR || '0.144.5'

const NPM_LATEST_URL = 'https://registry.npmjs.org/@openai/codex/latest'
const NPM_TIMEOUT_MS = 8000

// Codex 客户端 UA 形如：
//   codex_exec/0.144.5 (Mac OS 26.2.0; arm64) xterm-256color
//   codex_cli_rs/0.38.0 (Ubuntu 22.4.0; x86_64) WindowsTerminal
//   codex_vscode/0.35.0 (Windows 10.0.26100; x86_64) unknown
const CODEX_UA_PATTERN = /^(?:codex_vscode|codex_cli_rs|codex_exec)\/([\w.-]+)/i

function getRedisClient() {
  try {
    if (redis.client) {
      return redis.client
    }
    if (typeof redis.getClientSafe === 'function') {
      return redis.getClientSafe()
    }
  } catch {
    // Redis 不可用时按"无学习值"处理，不阻塞主流程
  }
  return null
}

/**
 * 比较语义版本号
 * @returns {number} 1 表示 v1 > v2，-1 表示 v1 < v2，0 表示相等
 */
function compareSemanticVersions(version1, version2) {
  if (version1 === version2) {
    return 0
  }
  const arr1 = String(version1 || '').split('.')
  const arr2 = String(version2 || '').split('.')
  const len = Math.max(arr1.length, arr2.length)

  for (let i = 0; i < len; i++) {
    // parseInt 会忽略预发布后缀（如 "0-alpha" → 0），足以满足门控比较需求
    const n1 = parseInt(arr1[i], 10) || 0
    const n2 = parseInt(arr2[i], 10) || 0
    if (n1 > n2) {
      return 1
    }
    if (n1 < n2) {
      return -1
    }
  }
  return 0
}

/**
 * 从 User-Agent 中提取 Codex 客户端版本
 * @returns {string|null}
 */
function extractCodexVersionFromUserAgent(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') {
    return null
  }
  const match = userAgent.match(CODEX_UA_PATTERN)
  return match ? match[1] : null
}

/**
 * 从真实流量学习客户端版本（单调不降）
 *
 * 仅当观测到的版本语义上高于已记录值时才覆盖，否则只续期 TTL——否则新旧
 * 客户端混跑时，清单会随流量抖动反复缩水。
 *
 * @param {string} userAgent 客户端 User-Agent
 * @returns {Promise<string|null>} 当前记录值
 */
async function captureClientVersionFromUserAgent(userAgent) {
  const observed = extractCodexVersionFromUserAgent(userAgent)
  if (!observed) {
    return null
  }

  const client = getRedisClient()
  if (!client) {
    return observed
  }

  try {
    const cached = await client.get(LEARNED_KEY)
    if (!cached) {
      await client.setex(LEARNED_KEY, LEARNED_TTL_SECONDS, observed)
      logger.info(`📱 Captured Codex client version from traffic: ${observed}`)
      return observed
    }

    if (compareSemanticVersions(observed, cached) > 0) {
      await client.setex(LEARNED_KEY, LEARNED_TTL_SECONDS, observed)
      logger.info(`🔄 Updated Codex client version: ${observed} (was: ${cached})`)
      return observed
    }

    // 不比已记录值新：只续期，绝不降级
    await client.expire(LEARNED_KEY, LEARNED_TTL_SECONDS)
    return cached
  } catch (error) {
    logger.warn(`⚠️ Failed to capture Codex client version: ${error.message}`)
    return observed
  }
}

/**
 * 读取流量学习到的版本
 * @returns {Promise<string|null>}
 */
async function getLearnedClientVersion() {
  const client = getRedisClient()
  if (!client) {
    return null
  }
  try {
    return await client.get(LEARNED_KEY)
  } catch (error) {
    logger.warn(`⚠️ Failed to read learned Codex client version: ${error.message}`)
    return null
  }
}

/**
 * 从 npm registry 获取 @openai/codex 的 latest 版本（带缓存）
 *
 * 失败时静默跳过并返回 null——该源只是补充，绝不阻塞模型清单拉取。
 * @returns {Promise<string|null>}
 */
async function getNpmLatestVersion() {
  const client = getRedisClient()

  if (client) {
    try {
      const cached = await client.get(NPM_KEY)
      if (cached) {
        return cached
      }
    } catch {
      // 缓存不可用时直接回源
    }
  }

  try {
    const response = await axios.get(NPM_LATEST_URL, {
      timeout: NPM_TIMEOUT_MS,
      headers: { Accept: 'application/json' }
    })
    const version = response.data && response.data.version
    if (!version) {
      logger.warn('⚠️ npm registry returned no version for @openai/codex')
      return null
    }
    if (client) {
      try {
        await client.setex(NPM_KEY, NPM_TTL_SECONDS, version)
      } catch {
        // 写缓存失败不影响本次取值
      }
    }
    logger.info(`📦 Fetched latest Codex version from npm: ${version}`)
    return version
  } catch (error) {
    // 静默降级：内网/离线环境下这是预期情况
    logger.debug(`ℹ️ Skipped npm Codex version lookup: ${error.message}`)
    return null
  }
}

/**
 * 解析本次请求应使用的 client_version：三源取语义版本最大值
 * @returns {Promise<{version: string, source: string, candidates: object}>}
 */
async function resolveCodexClientVersion() {
  const [learned, npmLatest] = await Promise.all([getLearnedClientVersion(), getNpmLatestVersion()])

  const candidates = {
    traffic: learned || null,
    npm: npmLatest || null,
    floor: FLOOR_VERSION
  }

  let version = FLOOR_VERSION
  let source = 'floor'

  if (learned && compareSemanticVersions(learned, version) > 0) {
    version = learned
    source = 'traffic'
  }
  if (npmLatest && compareSemanticVersions(npmLatest, version) > 0) {
    version = npmLatest
    source = 'npm'
  }

  return { version, source, candidates }
}

/**
 * 版本解析诊断信息（供管理端查看）
 */
async function getVersionDiagnostics() {
  const client = getRedisClient()
  let learnedTtl = null
  let npmTtl = null

  if (client) {
    try {
      const [lt, nt] = await Promise.all([client.ttl(LEARNED_KEY), client.ttl(NPM_KEY)])
      learnedTtl = lt
      npmTtl = nt
    } catch {
      // TTL 读取失败不影响诊断主体
    }
  }

  const resolved = await resolveCodexClientVersion()

  return {
    effectiveVersion: resolved.version,
    effectiveSource: resolved.source,
    sources: {
      traffic: { version: resolved.candidates.traffic, ttlSeconds: learnedTtl },
      npm: { version: resolved.candidates.npm, ttlSeconds: npmTtl },
      floor: { version: resolved.candidates.floor }
    }
  }
}

/**
 * 清除版本缓存，强制重新解析
 */
async function clearVersionCache() {
  const client = getRedisClient()
  if (!client) {
    return false
  }
  await client.del(LEARNED_KEY)
  await client.del(NPM_KEY)
  logger.info('🗑️ Cleared Codex client version caches (traffic + npm)')
  return true
}

module.exports = {
  compareSemanticVersions,
  extractCodexVersionFromUserAgent,
  captureClientVersionFromUserAgent,
  getLearnedClientVersion,
  getNpmLatestVersion,
  resolveCodexClientVersion,
  getVersionDiagnostics,
  clearVersionCache,
  FLOOR_VERSION,
  LEARNED_KEY,
  NPM_KEY
}
