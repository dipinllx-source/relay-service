// Verified against real CLI 2.1.326 upstream captures (43.110:/root/claude-proxy/capture,
// 6 个 /v1/messages 轮次：cli main ×3、cli auxiliary ×1、sdk-cli main ×2)。
//
// ⚠️ 身份四元组必须自洽：真实 CLI 的 UA 后缀(entrypoint)、system[1] 身份句、
// billing header 的 cc_entrypoint、anthropic-beta 的排列顺序是严格绑定的。
//   cli     → "You are Claude Code, Anthropic's official CLI for Claude."（57 字符）
//             beta 18 个，以 claude-code-20250219 打头
//   sdk-cli → "You are a Claude agent, built on Anthropic's Claude Agent SDK."（62 字符）
//             beta 15 个，以 oauth-2025-04-20 打头，claude-code-20250219 排在第 5 位；
//             无 dangerous-tool-use / thinking-display-updates / afk-mode
//   cli auxiliary（x-claude-code-request-class: auxiliary）→ beta 18 个，
//             在 effort 之后插入 server-side-fallback + fallback-credit，
//             去掉 afk-mode 与 extended-cache-ttl（其 cache_control 也确实不带 ttl）
const VERSION = '2.1.326'
const ENTRYPOINT = 'sdk-cli'
const USER_AGENT = `claude-cli/${VERSION} (external, ${ENTRYPOINT})`
const DEFAULT_HEADERS = Object.freeze({
  'user-agent': USER_AGENT,
  'x-stainless-arch': 'x64',
  'x-stainless-lang': 'js',
  'x-stainless-os': 'Linux',
  'x-stainless-package-version': '0.128.0',
  'x-stainless-retry-count': '0',
  'x-stainless-runtime': 'node',
  'x-stainless-runtime-version': 'v26.12.1',
  'x-stainless-timeout': '600',
  'anthropic-dangerous-direct-browser-access': 'true',
  'x-app': 'cli'
})

// 完整 beta 列表，逐字取自真实抓包的 anthropic-beta header（顺序即上线顺序）。
const CLI_MAIN_BETAS = Object.freeze([
  'claude-code-20250219',
  'oauth-2025-04-20',
  'interleaved-thinking-2025-05-14',
  'context-management-2025-06-27',
  'prompt-caching-scope-2026-01-05',
  'per-turn-control-2026-07-01',
  'mid-conversation-tool-changes-2026-07-01',
  'tool-provenance-2026-10-26',
  'thinking-token-count-2026-05-13',
  'advanced-tool-use-2025-11-20',
  'mid-conversation-system-clear-at-2026-08-21',
  'effort-2025-11-24',
  'dangerous-tool-use-2026-09-03',
  'thinking-binding-controls-2026-08-01',
  'thinking-display-updates-2026-08-18',
  'afk-mode-2026-01-31',
  'extended-cache-ttl-2025-04-11',
  'cache-diagnosis-2026-04-07'
])

const SDK_CLI_MAIN_BETAS = Object.freeze([
  'oauth-2025-04-20',
  'interleaved-thinking-2025-05-14',
  'context-management-2025-06-27',
  'prompt-caching-scope-2026-01-05',
  'claude-code-20250219',
  'per-turn-control-2026-07-01',
  'mid-conversation-tool-changes-2026-07-01',
  'tool-provenance-2026-10-26',
  'thinking-token-count-2026-05-13',
  'advanced-tool-use-2025-11-20',
  'mid-conversation-system-clear-at-2026-08-21',
  'effort-2025-11-24',
  'thinking-binding-controls-2026-08-01',
  'extended-cache-ttl-2025-04-11',
  'cache-diagnosis-2026-04-07'
])

// auxiliary（summary-extraction 等辅助轮）：effort 之后插入两个 fallback flag，
// 去掉 afk-mode 与 extended-cache-ttl。抓包中该轮的 cache_control 也确实不带 ttl。
const CLI_AUXILIARY_BETAS = Object.freeze([
  'claude-code-20250219',
  'oauth-2025-04-20',
  'interleaved-thinking-2025-05-14',
  'context-management-2025-06-27',
  'prompt-caching-scope-2026-01-05',
  'per-turn-control-2026-07-01',
  'mid-conversation-tool-changes-2026-07-01',
  'tool-provenance-2026-10-26',
  'thinking-token-count-2026-05-13',
  'advanced-tool-use-2025-11-20',
  'mid-conversation-system-clear-at-2026-08-21',
  'effort-2025-11-24',
  'server-side-fallback-2026-06-01',
  'fallback-credit-2026-06-01',
  'dangerous-tool-use-2026-09-03',
  'thinking-binding-controls-2026-08-01',
  'thinking-display-updates-2026-08-18',
  'cache-diagnosis-2026-04-07'
])

// 回退档：只保留本服务实际用到的 7 个授权 flag（相对顺序仍按 entrypoint 取自完整列表）。
// 通过环境变量 CLAUDE_CODE_BETA_PROFILE=base 启用，用于上游拒绝新增 flag 时的运维回退，
// 无需改代码或重新部署。默认 full。
const BASE_BETA_FLAGS = Object.freeze([
  'claude-code-20250219',
  'oauth-2025-04-20',
  'interleaved-thinking-2025-05-14',
  'context-management-2025-06-27',
  'prompt-caching-scope-2026-01-05',
  'effort-2025-11-24',
  'extended-cache-ttl-2025-04-11'
])

const BETA_PROFILE_MODE = String(process.env.CLAUDE_CODE_BETA_PROFILE || 'full').toLowerCase()

const toBaseOrder = (fullOrder) => fullOrder.filter((flag) => BASE_BETA_FLAGS.includes(flag))

// 各 entrypoint 的身份句、beta 顺序与 thinking.display。
// thinkingDisplay：cli 抓包为 "updates"，sdk-cli 抓包为 "omitted"。
// ⚠️ sdk-cli 这里刻意置 null（不注入 display）而非照抄 "omitted"：
// "omitted" 语义上可能让上游省略 thinking 内容，而 relay 的 emulation 面向任意第三方客户端，
// 它们大多依赖 thinking 输出。抓包中三轮的 thinking_text 均为空，无法证实/证伪该语义，
// 因此对 sdk-cli 保持现状（只发 {type:"adaptive"}），不冒功能回归的风险。
const ENTRYPOINT_PROFILES = Object.freeze({
  cli: Object.freeze({
    entrypoint: 'cli',
    systemIdentity: "You are Claude Code, Anthropic's official CLI for Claude.",
    thinkingDisplay: 'updates',
    betaOrder: BETA_PROFILE_MODE === 'base' ? toBaseOrder(CLI_MAIN_BETAS) : CLI_MAIN_BETAS,
    auxiliaryBetaOrder:
      BETA_PROFILE_MODE === 'base' ? toBaseOrder(CLI_AUXILIARY_BETAS) : CLI_AUXILIARY_BETAS,
    fullBetaOrder: CLI_MAIN_BETAS
  }),
  'sdk-cli': Object.freeze({
    entrypoint: 'sdk-cli',
    systemIdentity: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
    thinkingDisplay: null,
    betaOrder: BETA_PROFILE_MODE === 'base' ? toBaseOrder(SDK_CLI_MAIN_BETAS) : SDK_CLI_MAIN_BETAS,
    auxiliaryBetaOrder:
      BETA_PROFILE_MODE === 'base' ? toBaseOrder(SDK_CLI_MAIN_BETAS) : SDK_CLI_MAIN_BETAS,
    fullBetaOrder: SDK_CLI_MAIN_BETAS
  })
})

/**
 * 从 user-agent 解析 entrypoint。
 * 兼容 `claude-cli/2.1.326 (external, cli)` 与 `claude-cli/2.1.326 (cli)` 两种写法。
 * @returns {string|null}
 */
function parseEntrypoint(userAgent) {
  if (typeof userAgent !== 'string') {
    return null
  }
  const match = /claude-cli\/[^\s]+\s+\(\s*(?:external\s*,\s*)?([a-z0-9-]+)\s*\)/i.exec(userAgent)
  return match ? match[1].toLowerCase() : null
}

/**
 * 从 user-agent 解析版本号（与 claudeCodeHeadersService.extractVersionFromUserAgent 同规则，
 * 此处独立实现以避免 identity ↔ headersService 循环依赖）。
 * @returns {string|null}
 */
function parseVersion(userAgent) {
  if (typeof userAgent !== 'string') {
    return null
  }
  const match = userAgent.match(/claude-cli\/([\d.]+(?:[a-zA-Z0-9-]*)?)/i)
  return match ? match[1] : null
}

/**
 * 取指定 entrypoint 的身份档位；未知 entrypoint 回退到本模块声明的默认档位。
 */
function profileForEntrypoint(entrypoint) {
  return ENTRYPOINT_PROFILES[entrypoint] || ENTRYPOINT_PROFILES[ENTRYPOINT]
}

/**
 * 组装一份自洽的伪装身份。version / entrypoint / userAgent / headers 四者同源，
 * systemIdentity / betaOrder / thinkingDisplay 由 entrypoint（+ requestClass）决定。
 *
 * @param {Object} [options]
 * @param {string} [options.version]      版本号，默认本模块 VERSION
 * @param {string} [options.entrypoint]   entrypoint，默认本模块 ENTRYPOINT
 * @param {Object} [options.headers]      完整 CLI header 集合（通常来自账号真实抓包缓存）
 * @param {string} [options.requestClass] 'main'（默认）或 'auxiliary'，决定 beta 档位
 * @returns {{version:string, entrypoint:string, userAgent:string, headers:Object,
 *            systemIdentity:string, betaOrder:string[], thinkingDisplay:string|null,
 *            requestClass:string, profile:Object}}
 */
function buildIdentity(options = {}) {
  const headers =
    options.headers && typeof options.headers === 'object' ? options.headers : DEFAULT_HEADERS

  // UA 是 entrypoint 与 version 的唯一权威来源：优先从传入 headers 的 UA 反解，
  // 保证「发出去的 UA」与「system 身份句 / billing entrypoint / beta 顺序」永远一致。
  const userAgent = headers['user-agent'] || USER_AGENT
  const entrypoint = parseEntrypoint(userAgent) || options.entrypoint || ENTRYPOINT
  const version = parseVersion(userAgent) || options.version || VERSION
  const profile = profileForEntrypoint(entrypoint)
  const requestClass = options.requestClass === 'auxiliary' ? 'auxiliary' : 'main'
  const betaOrder =
    requestClass === 'auxiliary'
      ? profile.auxiliaryBetaOrder || profile.betaOrder
      : profile.betaOrder

  return {
    version,
    entrypoint: profile.entrypoint,
    userAgent,
    headers,
    systemIdentity: profile.systemIdentity,
    betaOrder,
    thinkingDisplay: profile.thinkingDisplay,
    requestClass,
    profile
  }
}

// 默认身份（无账号抓包缓存时的回退），保持自洽
const DEFAULT_IDENTITY = Object.freeze(buildIdentity())

module.exports = {
  VERSION,
  ENTRYPOINT,
  USER_AGENT,
  DEFAULT_HEADERS,
  ENTRYPOINT_PROFILES,
  DEFAULT_IDENTITY,
  CLI_MAIN_BETAS,
  SDK_CLI_MAIN_BETAS,
  CLI_AUXILIARY_BETAS,
  BASE_BETA_FLAGS,
  BETA_PROFILE_MODE,
  parseEntrypoint,
  parseVersion,
  profileForEntrypoint,
  buildIdentity
}
