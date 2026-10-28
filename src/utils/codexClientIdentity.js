/**
 * Codex 官方客户端识别
 *
 * Codex 各形态客户端（codex-rs 内核）发出的请求满足：
 *   User-Agent = `{originator}/{version} (...)`，同时带 `originator: {originator}` 头。
 * 已知 originator：
 *   codex_cli_rs   交互式 CLI
 *   codex_exec     非交互式/脚本模式
 *   codex_vscode   IDE 插件（VS Code / Cursor 等）
 *   Codex Desktop  ChatGPT.app 内置的 Codex App，例如：
 *                  Codex Desktop/0.162.0-alpha.17.2 (Mac OS 26.5.2; arm64) unknown (Codex Desktop; 26.1007.21159)
 *
 * 所有"是否为 Codex 客户端"的判断都应走这里，避免各处正则口径不一致。
 * relay 自己发起的请求（连通性测试、空闲用量探测）用的客户端身份也在这里构造。
 */

const os = require('os')

const CODEX_ORIGINATORS = ['codex_cli_rs', 'codex_exec', 'codex_vscode', 'Codex Desktop']

// UA 前缀 = originator + "/" + 版本（版本可能带预发布后缀，如 0.162.0-alpha.17.2）
const CODEX_UA_PATTERN = /^(codex_vscode|codex_cli_rs|codex_exec|Codex Desktop)\/(\d[\w.-]*)/i

const KNOWN_ORIGINATORS = new Set(CODEX_ORIGINATORS.map((value) => value.toLowerCase()))

function headerValue(value) {
  if (Array.isArray(value)) {
    return headerValue(value[0])
  }
  return typeof value === 'string' ? value : ''
}

/**
 * 归一化 originator（小写、去首尾空白），便于与 UA 中的客户端类型比较
 * @returns {string}
 */
function normalizeOriginator(originator) {
  return headerValue(originator).trim().toLowerCase()
}

/**
 * 解析 Codex 客户端 User-Agent
 * @returns {{clientType: string, version: string}|null} clientType 为小写 originator
 */
function parseCodexUserAgent(userAgent) {
  const match = headerValue(userAgent).match(CODEX_UA_PATTERN)
  if (!match) {
    return null
  }
  return { clientType: match[1].toLowerCase(), version: match[2] }
}

/**
 * originator 是否为已知 Codex 客户端
 */
function isCodexOriginator(originator) {
  return KNOWN_ORIGINATORS.has(normalizeOriginator(originator))
}

// relay 自发请求使用的 originator：交互式 CLI 是上游最常见、最稳定的身份
const RELAY_OUTBOUND_ORIGINATOR = 'codex_cli_rs'

function platformLabel() {
  const type = os.type()
  if (type === 'Darwin') {
    return 'Mac OS'
  }
  if (type === 'Windows_NT') {
    return 'Windows'
  }
  return type || 'Linux'
}

function archLabel() {
  const arch = os.arch()
  return arch === 'x64' ? 'x86_64' : arch
}

/**
 * 构造 relay 自发请求的客户端身份头。
 * originator 必须与 UA 首段一致，格式对齐官方客户端：`{originator}/{version} ({os}; {arch}) {terminal}`；
 * 平台和架构取 relay 所在机器的真实值。
 * @param {string} version Codex 客户端版本（通常取流量学习到的版本）
 * @returns {{originator: string, 'user-agent': string}}
 */
function buildRelayOutboundIdentityHeaders(version) {
  const safeVersion = typeof version === 'string' && version.trim() ? version.trim() : '0.0.0'
  return {
    originator: RELAY_OUTBOUND_ORIGINATOR,
    'user-agent': `${RELAY_OUTBOUND_ORIGINATOR}/${safeVersion} (${platformLabel()}; ${archLabel()}) unknown`
  }
}

/**
 * 根据请求头识别 Codex 官方客户端：优先 User-Agent，其次 originator 头
 * （部分代理/网关会改写 UA，但保留 originator）。
 * @param {Object} headers Express 请求头（键为小写）
 * @returns {{clientType: string, version: string|null, source: string}|null}
 */
function detectCodexClient(headers = {}) {
  const safeHeaders = headers && typeof headers === 'object' ? headers : {}

  const fromUserAgent = parseCodexUserAgent(safeHeaders['user-agent'])
  if (fromUserAgent) {
    return { ...fromUserAgent, source: 'user-agent' }
  }

  if (isCodexOriginator(safeHeaders['originator'])) {
    return {
      clientType: normalizeOriginator(safeHeaders['originator']),
      version: null,
      source: 'originator'
    }
  }

  return null
}

module.exports = {
  CODEX_ORIGINATORS,
  CODEX_UA_PATTERN,
  normalizeOriginator,
  parseCodexUserAgent,
  isCodexOriginator,
  detectCodexClient,
  RELAY_OUTBOUND_ORIGINATOR,
  buildRelayOutboundIdentityHeaders
}
