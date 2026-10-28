// codexTurnState 单元测试：x-codex-turn-state 的读取、剥离与签发账号校验

const crypto = require('crypto')
const codexTurnState = require('../src/utils/codexTurnState')

function ownerKey(turnState) {
  return `${codexTurnState.OWNER_KEY_PREFIX}${crypto.createHash('sha256').update(turnState).digest('hex')}`
}

function createFakeRedis() {
  const store = new Map()
  return {
    store,
    get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key, value) => {
      store.set(key, value)
      return 'OK'
    }),
    expire: jest.fn(async () => 1)
  }
}

describe('codexTurnState', () => {
  test('readIncomingTurnState：优先读请求头，其次 body.client_metadata', () => {
    const header = { 'x-codex-turn-state': 'from-header' }
    const body = { client_metadata: { 'x-codex-turn-state': 'from-body' } }
    expect(codexTurnState.readIncomingTurnState(header, body)).toBe('from-header')
    expect(codexTurnState.readIncomingTurnState({}, body)).toBe('from-body')
    expect(codexTurnState.readIncomingTurnState({ 'x-codex-turn-state': '  ' }, {})).toBeNull()
    expect(codexTurnState.readIncomingTurnState({}, undefined)).toBeNull()
  })

  test('stripTurnState：同时移除请求头和 body.client_metadata 中的令牌，不动其他字段', () => {
    const headers = { 'x-codex-turn-state': 'ts', 'x-codex-window-id': 'w1' }
    const body = { client_metadata: { 'x-codex-turn-state': 'ts', thread_id: 't1' } }
    codexTurnState.stripTurnState(headers, body)
    expect(headers).toEqual({ 'x-codex-window-id': 'w1' })
    expect(body.client_metadata).toEqual({ thread_id: 't1' })
  })

  test('签发后同一账号继续转发，并顺延有效期', async () => {
    const redis = createFakeRedis()
    await expect(codexTurnState.rememberTurnStateOwner(redis, 'ts-1', 'acc-a')).resolves.toBe(true)
    expect(redis.set).toHaveBeenCalledWith(
      ownerKey('ts-1'),
      'acc-a',
      'EX',
      codexTurnState.OWNER_TTL_SECONDS
    )

    await expect(codexTurnState.shouldForwardTurnState(redis, 'ts-1', 'acc-a')).resolves.toEqual({
      forward: true,
      reason: 'same_account'
    })
    expect(redis.expire).toHaveBeenCalledWith(ownerKey('ts-1'), codexTurnState.OWNER_TTL_SECONDS)
  })

  test('换号后不转发', async () => {
    const redis = createFakeRedis()
    await codexTurnState.rememberTurnStateOwner(redis, 'ts-1', 'acc-a')
    await expect(codexTurnState.shouldForwardTurnState(redis, 'ts-1', 'acc-b')).resolves.toEqual({
      forward: false,
      reason: 'account_changed'
    })
  })

  test('查不到签发记录、Redis 不可用或读取失败时一律不转发', async () => {
    const redis = createFakeRedis()
    await expect(codexTurnState.shouldForwardTurnState(redis, 'ts-x', 'acc-a')).resolves.toEqual({
      forward: false,
      reason: 'unknown_owner'
    })
    await expect(codexTurnState.shouldForwardTurnState(null, 'ts-x', 'acc-a')).resolves.toEqual({
      forward: false,
      reason: 'no_store'
    })
    redis.get.mockRejectedValueOnce(new Error('down'))
    await expect(codexTurnState.shouldForwardTurnState(redis, 'ts-x', 'acc-a')).resolves.toEqual({
      forward: false,
      reason: 'lookup_failed'
    })
  })

  test('Redis 写入失败不抛错', async () => {
    const redis = createFakeRedis()
    redis.set.mockRejectedValueOnce(new Error('down'))
    await expect(codexTurnState.rememberTurnStateOwner(redis, 'ts-1', 'acc-a')).resolves.toBe(false)
    await expect(codexTurnState.rememberTurnStateOwner(null, 'ts-1', 'acc-a')).resolves.toBe(false)
  })

  test('readUpstreamTurnState：读取上游响应头', () => {
    expect(codexTurnState.readUpstreamTurnState({ 'x-codex-turn-state': 'ts-up' })).toBe('ts-up')
    expect(codexTurnState.readUpstreamTurnState({})).toBeNull()
    expect(codexTurnState.readUpstreamTurnState(undefined)).toBeNull()
  })
})
