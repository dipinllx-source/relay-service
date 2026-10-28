/**
 * Codex 粘性路由令牌 x-codex-turn-state 的回传与归属校验
 *
 * 官方客户端的约定（codex-rs core/src/client.rs 的 `turn_state` 字段）：服务端在一轮（turn）
 * 开始时通过响应头 `x-codex-turn-state` 下发令牌，客户端在同一轮的后续请求里原样带回，
 * 用于保持粘性路由。走 HTTP 时，客户端只会从响应头里读取这个令牌（codex-api
 * sse/responses.rs）。relay 以前没有回传这个头，客户端拿不到令牌，同一轮里的每个请求都
 * 会被上游当作新请求重新路由。
 *
 * 令牌由签发它的上游账号持有。同一轮的后续请求如果被调度到了另一个账号（粘性映射过期、
 * 账号被暂停、分组重新选号等），把旧令牌带给新账号没有意义，应当丢弃。因此回传令牌时，
 * 同时在 Redis 里记录它由哪个账号签发，后续请求只在仍落在同一账号时才继续转发。
 * 找不到签发记录或 Redis 不可用时一律丢弃：最坏情况等同于改动前不带令牌的行为。
 */

const crypto = require('crypto')

const TURN_STATE_HEADER = 'x-codex-turn-state'
const OWNER_KEY_PREFIX = 'codex_turn_state_owner:'
// 一轮可能持续数小时（长任务、多次工具调用）；记录很小，TTL 宁长勿短
const OWNER_TTL_SECONDS = 24 * 60 * 60

function pickValue(value) {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first.trim() !== '' ? first : null
}

function ownerKey(turnState) {
  return `${OWNER_KEY_PREFIX}${crypto.createHash('sha256').update(turnState).digest('hex')}`
}

/**
 * 读取客户端带来的令牌：优先请求头，其次 body.client_metadata（官方客户端走 WebSocket 时
 * 放在这里，HTTP 一般不会出现，这里一并处理以免漏转给错误的账号）
 * @returns {string|null}
 */
function readIncomingTurnState(headers, body) {
  const fromHeader = pickValue(headers && headers[TURN_STATE_HEADER])
  if (fromHeader) {
    return fromHeader
  }
  const metadata = body && body.client_metadata
  if (metadata && typeof metadata === 'object') {
    return pickValue(metadata[TURN_STATE_HEADER])
  }
  return null
}

/**
 * 从即将发往上游的请求头和请求体中移除令牌
 */
function stripTurnState(headers, body) {
  if (headers) {
    delete headers[TURN_STATE_HEADER]
  }
  const metadata = body && body.client_metadata
  if (metadata && typeof metadata === 'object') {
    delete metadata[TURN_STATE_HEADER]
  }
}

/**
 * 判断客户端带来的令牌能否继续发给本次选中的账号
 * @returns {Promise<{forward: boolean, reason: string}>}
 *   reason: same_account | account_changed | unknown_owner | no_store | lookup_failed
 */
async function shouldForwardTurnState(redisClient, turnState, accountId) {
  if (!turnState || !accountId || !redisClient) {
    return { forward: false, reason: 'no_store' }
  }
  try {
    const key = ownerKey(turnState)
    const owner = await redisClient.get(key)
    if (!owner) {
      return { forward: false, reason: 'unknown_owner' }
    }
    if (owner !== String(accountId)) {
      return { forward: false, reason: 'account_changed' }
    }
    // 同一轮仍在进行，顺延记录的有效期；失败不影响本次转发
    try {
      await redisClient.expire(key, OWNER_TTL_SECONDS)
    } catch (_) {
      // ignore
    }
    return { forward: true, reason: 'same_account' }
  } catch (_) {
    return { forward: false, reason: 'lookup_failed' }
  }
}

/**
 * 读取上游响应头中的令牌
 * @returns {string|null}
 */
function readUpstreamTurnState(upstreamHeaders) {
  return pickValue(upstreamHeaders && upstreamHeaders[TURN_STATE_HEADER])
}

/**
 * 记录令牌由哪个账号签发
 * @returns {Promise<boolean>} 是否写入成功
 */
async function rememberTurnStateOwner(redisClient, turnState, accountId) {
  if (!turnState || !accountId || !redisClient) {
    return false
  }
  try {
    await redisClient.set(ownerKey(turnState), String(accountId), 'EX', OWNER_TTL_SECONDS)
    return true
  } catch (_) {
    return false
  }
}

module.exports = {
  TURN_STATE_HEADER,
  OWNER_KEY_PREFIX,
  OWNER_TTL_SECONDS,
  readIncomingTurnState,
  stripTurnState,
  shouldForwardTurnState,
  readUpstreamTurnState,
  rememberTurnStateOwner
}
