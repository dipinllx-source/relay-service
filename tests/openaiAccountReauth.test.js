/**
 * OpenAI 账号「更新 Token / 重新授权」后端行为回归测试
 *
 * 覆盖设计决策：
 * - 先校验后写入：校验失败时账号凭据从未被改动，响应不得声称已回滚
 * - 写入的必须是校验返回的 tokens（OpenAI 可能轮换 refresh token）
 * - 状态一次性恢复：status/schedulable/errorMessage 同批写入，不清 unauthorizedCount
 * - 历史保全：更新对象不得携带 totalUsage / createdAt 等历史字段（hset 局部合并才能保住它们）
 * - 写入失败时明确告知凭据可能已轮换
 */

const mockRouter = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }

jest.mock('express', () => ({ Router: () => mockRouter }), { virtual: true })

jest.mock('../src/middleware/auth', () => ({
  authenticateAdmin: jest.fn((_req, _res, next) => next())
}))

jest.mock('../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn()
}))

jest.mock('../config/config', () => ({ claude: {}, proxy: {}, requestTimeout: 600000 }))

const mockService = {
  getAccount: jest.fn(),
  updateAccount: jest.fn(),
  validateRefreshToken: jest.fn(),
  refreshAccountToken: jest.fn(),
  deleteAccount: jest.fn()
}
jest.mock('../src/services/account/openaiAccountService', () => mockService)
jest.mock('../src/services/relay/openaiRelayService', () => ({}))
jest.mock('../src/services/accountGroupService', () => ({
  removeAccountFromAllGroups: jest.fn(),
  setAccountGroups: jest.fn(),
  addAccountToGroup: jest.fn()
}))
jest.mock('../src/services/apiKeyService', () => ({ unbindAccountFromAllKeys: jest.fn() }))
jest.mock('../src/models/redis', () => ({ getClient: jest.fn(), scanKeys: jest.fn() }))
jest.mock('../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn(),
  getProxyDescription: jest.fn(() => 'proxy')
}))
jest.mock('../src/utils/webhookNotifier', () => ({ sendAccountAnomalyNotification: jest.fn() }))

const mockUpstreamErrorHelper = { clearTempUnavailable: jest.fn(async () => {}) }
jest.mock('../src/utils/upstreamErrorHelper', () => mockUpstreamErrorHelper)

// mapExpiryField 的真实行为是浅拷贝 + expiresAt→subscriptionExpiresAt 映射；
// 本测试不传 expiresAt，故浅拷贝即等价。pruneDanglingGroupRefs 与凭据路径无关。
jest.mock('../src/routes/admin/utils', () => ({
  formatAccountExpiry: jest.fn(),
  mapExpiryField: (updates) => ({ ...updates }),
  pruneDanglingGroupRefs: jest.fn(async () => [])
}))

require('../src/routes/admin/openaiAccounts')

const putHandler = mockRouter.put.mock.calls.find((c) => c[0] === '/:id')[2]

function createResponse() {
  const res = {
    statusCode: 200,
    body: null,
    json: jest.fn((payload) => {
      res.body = payload
      return res
    }),
    status: jest.fn((code) => {
      res.statusCode = code
      return res
    })
  }
  return res
}

const ACCOUNT = {
  id: 'acc-openai-1',
  name: 'codex-main',
  platform: 'openai',
  status: 'unauthorized',
  schedulable: 'false',
  errorMessage: '401 unauthorized',
  unauthorizedCount: '3',
  unauthorizedAt: '2026-11-01T00:00:00.000Z',
  totalUsage: '123456',
  createdAt: '2026-01-01T00:00:00.000Z',
  accountId: 'chatgpt-acct-A',
  chatgptUserId: 'user-A',
  proxy: { protocol: 'http', host: '1.2.3.4', port: 8080 }
}

const INPUT_REFRESH = 'rt-input-original'
const ROTATED_REFRESH = 'rt-rotated-by-openai'

function mockValidationOk() {
  mockService.validateRefreshToken.mockResolvedValue({
    access_token: 'at-new',
    id_token: 'id-new',
    refresh_token: ROTATED_REFRESH,
    expires_in: 3600,
    expiry_date: Date.now() + 3600000
  })
}

function req(body) {
  return { params: { id: ACCOUNT.id }, body }
}

const REAUTH_BODY = {
  openaiOauth: { accessToken: 'at-input', refreshToken: INPUT_REFRESH, expires_in: 3600 },
  needsImmediateRefresh: true,
  requireRefreshSuccess: true
}

describe('OpenAI 重新授权：先校验后写入', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockService.getAccount.mockResolvedValue({ ...ACCOUNT })
    mockService.updateAccount.mockImplementation(async (_id, updates) => ({
      ...ACCOUNT,
      ...updates
    }))
    mockUpstreamErrorHelper.clearTempUnavailable.mockResolvedValue(undefined)
  })

  it('校验失败时不写库，且响应标明账号未改动、不声称回滚', async () => {
    const err = new Error('Refresh Token 无效或已过期，请重新授权')
    err.status = 400
    err.details = { error: 'invalid_grant' }
    mockService.validateRefreshToken.mockRejectedValue(err)

    const res = createResponse()
    await putHandler(req(REAUTH_BODY), res)

    expect(res.statusCode).toBe(400)
    expect(res.body.accountUnchanged).toBe(true)
    expect(res.body.errorCode).toBe(400)
    expect(res.body.suggestion).toContain('OAuth')
    expect(mockService.updateAccount).not.toHaveBeenCalled()
    expect(JSON.stringify(res.body)).not.toContain('回滚')
  })

  it('校验成功但拿不到 id_token 时不写库，并提示凭据可能已被消费', async () => {
    mockService.validateRefreshToken.mockResolvedValue({
      access_token: 'at-new',
      id_token: '',
      refresh_token: ROTATED_REFRESH,
      expiry_date: Date.now() + 3600000
    })

    const res = createResponse()
    await putHandler(req(REAUTH_BODY), res)

    expect(res.statusCode).toBe(400)
    expect(res.body.accountUnchanged).toBe(true)
    expect(res.body.suggestion).toContain('重新通过 OAuth')
    expect(mockService.updateAccount).not.toHaveBeenCalled()
  })

  it('写入的是校验返回的 tokens，而非请求体里的原始 refresh token', async () => {
    mockValidationOk()

    const res = createResponse()
    await putHandler(req(REAUTH_BODY), res)

    expect(res.statusCode).toBe(200)
    expect(mockService.updateAccount).toHaveBeenCalledTimes(1)
    const updates = mockService.updateAccount.mock.calls[0][1]
    expect(updates.refreshToken).toBe(ROTATED_REFRESH)
    expect(updates.refreshToken).not.toBe(INPUT_REFRESH)
    expect(updates.accessToken).toBe('at-new')
    expect(updates.idToken).toBe('id-new')
    expect(typeof updates.expiresAt).toBe('string')
  })

  it('状态一次性恢复，且不清 unauthorizedCount / unauthorizedAt', async () => {
    mockValidationOk()

    const res = createResponse()
    await putHandler(req(REAUTH_BODY), res)

    const updates = mockService.updateAccount.mock.calls[0][1]
    expect(updates.status).toBe('active')
    expect(updates.schedulable).toBe('true')
    expect(updates.errorMessage).toBeNull()
    expect(updates).not.toHaveProperty('unauthorizedCount')
    expect(updates).not.toHaveProperty('unauthorizedAt')
    expect(mockUpstreamErrorHelper.clearTempUnavailable).toHaveBeenCalledWith(ACCOUNT.id, 'openai')
    // 不需要调用方再发一次 reset-status
    expect(mockService.refreshAccountToken).not.toHaveBeenCalled()
  })

  it('更新对象不携带历史字段，保证 hset 局部合并保住用量与创建时间', async () => {
    mockValidationOk()

    const res = createResponse()
    await putHandler(req(REAUTH_BODY), res)

    const updates = mockService.updateAccount.mock.calls[0][1]
    for (const field of [
      'totalUsage',
      'createdAt',
      'lastUsedAt',
      'codexUsageSnapshot',
      'imageGenUsageSnapshot',
      'accountType',
      'groupId'
    ]) {
      expect(updates).not.toHaveProperty(field)
    }
    // 也不得走删除/重建
    expect(mockService.deleteAccount).not.toHaveBeenCalled()
  })

  it('openaiOauth 快照与实际凭据字段保持一致', async () => {
    mockValidationOk()

    const res = createResponse()
    await putHandler(req(REAUTH_BODY), res)

    const updates = mockService.updateAccount.mock.calls[0][1]
    expect(updates.openaiOauth.refreshToken).toBe(ROTATED_REFRESH)
    expect(updates.openaiOauth.accessToken).toBe('at-new')
    expect(updates.openaiOauth.idToken).toBe('id-new')
  })

  it('校验通过但写入失败时返回 credentialRotated，且不声称已回滚', async () => {
    mockValidationOk()
    mockService.updateAccount.mockRejectedValue(new Error('Redis 写入失败'))

    const res = createResponse()
    await putHandler(req(REAUTH_BODY), res)

    expect(res.statusCode).toBe(500)
    expect(res.body.credentialRotated).toBe(true)
    expect(res.body.suggestion).toContain('重新通过 OAuth')
    expect(JSON.stringify(res.body)).not.toContain('回滚')
  })

  it('代理：显式传入优先，否则沿用账号现有代理', async () => {
    mockValidationOk()
    const res = createResponse()
    await putHandler(req(REAUTH_BODY), res)
    expect(mockService.validateRefreshToken).toHaveBeenCalledWith(INPUT_REFRESH, ACCOUNT.proxy)

    jest.clearAllMocks()
    mockService.getAccount.mockResolvedValue({ ...ACCOUNT })
    mockService.updateAccount.mockImplementation(async (_id, u) => ({ ...ACCOUNT, ...u }))
    mockValidationOk()
    const explicit = { protocol: 'socks5', host: '9.9.9.9', port: 1080 }
    const res2 = createResponse()
    await putHandler(req({ ...REAUTH_BODY, proxy: explicit }), res2)
    expect(mockService.validateRefreshToken).toHaveBeenCalledWith(INPUT_REFRESH, explicit)
  })

  it('账号代理为 JSON 字符串时会被解析后传给校验', async () => {
    mockService.getAccount.mockResolvedValue({
      ...ACCOUNT,
      proxy: JSON.stringify(ACCOUNT.proxy)
    })
    mockValidationOk()
    const res = createResponse()
    await putHandler(req(REAUTH_BODY), res)
    expect(mockService.validateRefreshToken).toHaveBeenCalledWith(INPUT_REFRESH, ACCOUNT.proxy)
  })

  it('未更新 refresh token 时不触发校验，走普通更新路径', async () => {
    const res = createResponse()
    await putHandler(req({ name: 'renamed' }), res)
    expect(res.statusCode).toBe(200)
    expect(mockService.validateRefreshToken).not.toHaveBeenCalled()
    const updates = mockService.updateAccount.mock.calls[0][1]
    expect(updates).not.toHaveProperty('status')
    expect(mockUpstreamErrorHelper.clearTempUnavailable).not.toHaveBeenCalled()
  })
})
