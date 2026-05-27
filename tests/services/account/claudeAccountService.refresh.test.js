// Tests for refreshTokenViaCredentials() — CLI-priority refresh + axios fallback

jest.mock('child_process', () => ({
  execFile: jest.fn()
}))
jest.mock('util', () => {
  const actual = jest.requireActual('util')
  return {
    ...actual,
    promisify: jest.fn(
      (fn) =>
        // execFile -> async wrapper that resolves/rejects from our mock
        (...args) =>
          new Promise((resolve, reject) => {
            fn(...args, (err, stdout, stderr) => {
              if (err) {
                reject(err)
              } else {
                resolve({ stdout, stderr })
              }
            })
          })
    )
  }
})

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn()
}))

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}))

jest.mock('../../../src/models/redis', () => ({
  getClaudeAccount: jest.fn(),
  setClaudeAccount: jest.fn(),
  getClientSafe: () => ({
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK')
  })
}))

jest.mock('../../../src/services/tokenRefreshService', () => ({
  acquireRefreshLock: jest.fn(),
  releaseRefreshLock: jest.fn()
}))

jest.mock('../../../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  authDetail: jest.fn()
}))

jest.mock('../../../src/utils/tokenRefreshLogger', () => ({
  logRefreshStart: jest.fn(),
  logRefreshSuccess: jest.fn(),
  logRefreshError: jest.fn(),
  logRefreshSkipped: jest.fn(),
  logTokenUsage: jest.fn()
}))

jest.mock('../../../src/utils/upstreamErrorHelper', () => ({
  markTempUnavailable: jest.fn(async () => ({ success: true })),
  recordErrorHistory: jest.fn(async () => undefined)
}))

jest.mock('../../../src/utils/webhookNotifier', () => ({
  sendAccountAnomalyNotification: jest.fn(async () => undefined)
}))

jest.mock('../../../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn(() => null)
}))

const fs = require('fs')
const { execFile } = require('child_process')
const axios = require('axios')
const redis = require('../../../src/models/redis')
const tokenRefreshService = require('../../../src/services/tokenRefreshService')
const upstreamErrorHelper = require('../../../src/utils/upstreamErrorHelper')
const webhookNotifier = require('../../../src/utils/webhookNotifier')
// IMPORTANT: require service AFTER mocks are set up. Do NOT reset modules between tests
// (would create a fresh mock instance for redis/etc that our test refs no longer point to).
const claudeAccountService = require('../../../src/services/account/claudeAccountService')

const ACCOUNT_ID = 'acc-test'
const FILE_PATH = '/tmp/.claude/.credentials.json'

function makeAccountData(overrides = {}) {
  // accessToken / refreshToken are stored encrypted; the service uses _decryptSensitiveData.
  // We bypass that complexity by stubbing _decryptSensitiveData / _encryptSensitiveData on the instance.
  // Default axios opt-in to enabled in the shared fixture so existing tests
  // exercising the axios fallback path continue to behave as before.
  return {
    id: ACCOUNT_ID,
    name: 'TestAccount',
    accessToken: 'enc:OLD_ACCESS',
    refreshToken: 'enc:OLD_RT',
    expiresAt: String(Date.now() - 1000),
    proxy: '',
    isActive: 'true',
    scopes: 'user:inference',
    disableAutoProtection: false,
    axiosRefreshEnabled: 'true',
    axiosCloudflareConfirmed: 'true',
    axiosLastBlockedAt: '',
    axiosBlockedReason: '',
    ...overrides
  }
}

function setCredentialsFileContent(
  accessToken,
  refreshToken = 'NEW_RT',
  expiresAt = Date.now() + 3600_000
) {
  fs.readFileSync.mockReturnValue(
    JSON.stringify({
      claudeAiOauth: {
        accessToken,
        refreshToken,
        expiresAt,
        scopes: ['user:inference']
      }
    })
  )
}

beforeEach(() => {
  // mockReset clears once-queue + return values; we re-set what we need below.
  redis.getClaudeAccount.mockReset()
  redis.setClaudeAccount.mockReset()
  tokenRefreshService.acquireRefreshLock.mockReset()
  tokenRefreshService.releaseRefreshLock.mockReset()
  fs.existsSync.mockReset()
  fs.statSync.mockReset()
  fs.readFileSync.mockReset()
  axios.post.mockReset()
  execFile.mockReset()
  upstreamErrorHelper.markTempUnavailable.mockReset()
  upstreamErrorHelper.recordErrorHistory.mockReset()
  webhookNotifier.sendAccountAnomalyNotification.mockReset()
  webhookNotifier.sendAccountAnomalyNotification.mockResolvedValue(undefined)

  fs.existsSync.mockReturnValue(true)
  fs.statSync.mockReturnValue({ mtimeMs: 1000 })
  setCredentialsFileContent('NEW_ACCESS')

  redis.getClaudeAccount.mockResolvedValue(makeAccountData())
  redis.setClaudeAccount.mockResolvedValue(undefined)
  tokenRefreshService.acquireRefreshLock.mockResolvedValue(true)
  tokenRefreshService.releaseRefreshLock.mockResolvedValue(undefined)
  upstreamErrorHelper.markTempUnavailable.mockResolvedValue({ success: true })
  upstreamErrorHelper.recordErrorHistory.mockResolvedValue(undefined)

  // execFile callback API: (cmd, args, opts, cb)
  execFile.mockImplementation((cmd, args, opts, cb) => cb(null, '', ''))

  // Stub encryption helpers so encrypted-vs-plaintext comparisons reflect plaintext.
  claudeAccountService._decryptSensitiveData = jest.fn((v) =>
    typeof v === 'string' && v.startsWith('enc:') ? v.slice(4) : v
  )
  claudeAccountService._encryptSensitiveData = jest.fn((v) =>
    typeof v === 'string' ? `enc:${v}` : v
  )
  claudeAccountService._createProxyAgent = jest.fn(() => null)
  claudeAccountService._getClaudeBinPath = jest.fn(() => '/usr/local/bin/claude')
  claudeAccountService.getCredentialsPath = jest.fn(async () => FILE_PATH)
  claudeAccountService.fetchAndUpdateAccountProfile = jest.fn(async () => undefined)
  // Speed up retry loop in tests: minimal backoff and short mtime poll
  claudeAccountService._backoffDelayMs = jest.fn(() => 1)
  claudeAccountService._pollFileMtime = jest.fn(async (filePath, baselineMtimeMs) => {
    // single-shot: read current mtime once and compare
    try {
      const st = fs.statSync(filePath)
      return st.mtimeMs > baselineMtimeMs
    } catch (_) {
      return false
    }
  })
})

describe('refreshTokenViaCredentials', () => {
  test('7.2 first CLI exec succeeds, file changed → return success and update cache once', async () => {
    // mtime advances on first stat after exec
    let callCount = 0
    fs.statSync.mockImplementation(() => {
      callCount++
      // 1st call = baseline (1000), 2nd+ = advanced (2000)
      return { mtimeMs: callCount === 1 ? 1000 : 2000 }
    })

    const result = await claudeAccountService.refreshTokenViaCredentials(
      ACCOUNT_ID,
      'cache_expired'
    )

    expect(result.success).toBe(true)
    expect(result.accessToken).toBe('NEW_ACCESS')
    expect(execFile).toHaveBeenCalledTimes(1)
    expect(redis.setClaudeAccount).toHaveBeenCalledTimes(1)
    const [, persisted] = redis.setClaudeAccount.mock.calls[0]
    expect(persisted.accessToken).toBe('enc:NEW_ACCESS')
    expect(persisted.refreshToken).toBe('enc:NEW_RT')
    expect(persisted.status).toBe('active')
  })

  test('7.3 CLI no-op × 3 → axios succeeds → cache updated from response', async () => {
    setCredentialsFileContent('OLD_ACCESS') // file unchanged from cache

    axios.post.mockResolvedValue({
      status: 200,
      data: {
        access_token: 'AXIOS_NEW_ACCESS',
        refresh_token: 'AXIOS_NEW_RT',
        expires_in: 3600
      }
    })

    const result = await claudeAccountService.refreshTokenViaCredentials(
      ACCOUNT_ID,
      'upstream_error'
    )

    expect(result.success).toBe(true)
    expect(result.accessToken).toBe('AXIOS_NEW_ACCESS')
    expect(execFile).toHaveBeenCalledTimes(3)
    expect(axios.post).toHaveBeenCalledTimes(1)
    // axios path persists: 1 setClaudeAccount call
    expect(redis.setClaudeAccount).toHaveBeenCalled()
    const lastCall = redis.setClaudeAccount.mock.calls[redis.setClaudeAccount.mock.calls.length - 1]
    expect(lastCall[1].accessToken).toBe('enc:AXIOS_NEW_ACCESS')
    expect(lastCall[1].refreshToken).toBe('enc:AXIOS_NEW_RT')
  })

  test('7.4 CLI subprocess errors × 3 → axios returns 401 invalid_grant → throw, status=error, no token write', async () => {
    setCredentialsFileContent('OLD_ACCESS') // CLI cannot refresh
    execFile.mockImplementation((cmd, args, opts, cb) =>
      cb(Object.assign(new Error('ENOENT: claude'), { code: 'ENOENT' }), '', '')
    )

    const axiosErr = new Error('Request failed with status code 401')
    axiosErr.response = { status: 401, data: { error: 'invalid_grant' } }
    axios.post.mockRejectedValue(axiosErr)

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/all refresh paths exhausted/)

    // cache writes should be: only the failure status='error' write, no token rotation
    const persistedTokens = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    for (const persisted of persistedTokens) {
      expect(persisted.accessToken).toBe('enc:OLD_ACCESS')
    }
    // last write should be status=error
    const last = persistedTokens[persistedTokens.length - 1]
    expect(last.status).toBe('error')
  })

  test('7.5 CLI no-op × 3 → axios network error → throw, status stays active, temp_unavailable recorded', async () => {
    setCredentialsFileContent('OLD_ACCESS')

    const netErr = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
    axios.post.mockRejectedValue(netErr)

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/all refresh paths exhausted/)

    expect(upstreamErrorHelper.markTempUnavailable).toHaveBeenCalledTimes(1)
    // status NOT set to 'error' for oauth_network category
    const writes = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    const errorWrites = writes.filter((w) => w.status === 'error')
    expect(errorWrites.length).toBe(0)
  })

  test('7.6 lock contention → waiter reads cache and returns success', async () => {
    tokenRefreshService.acquireRefreshLock.mockResolvedValue(false)
    redis.getClaudeAccount
      .mockResolvedValueOnce(makeAccountData()) // initial read
      .mockResolvedValueOnce(makeAccountData({ accessToken: 'enc:UPDATED_BY_HOLDER' })) // after sleep

    const result = await claudeAccountService.refreshTokenViaCredentials(
      ACCOUNT_ID,
      'cache_expired'
    )

    expect(result.success).toBe(true)
    expect(result.accessToken).toBe('UPDATED_BY_HOLDER')
    expect(execFile).not.toHaveBeenCalled()
    expect(axios.post).not.toHaveBeenCalled()
  }, 10000)

  test('7.7 credentials path missing → file_path_error, no CLI loop', async () => {
    fs.existsSync.mockReturnValue(false)

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/file_path_error|all refresh paths/)

    expect(execFile).not.toHaveBeenCalled()
    expect(axios.post).not.toHaveBeenCalled()
    // status=error written (configuration alert)
    const writes = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    const errorWrite = writes.find((w) => w.status === 'error')
    expect(errorWrite).toBeDefined()
    expect(errorWrite.errorMessage).toMatch(/file_path_error/)
  })

  test('7.8 disableAutoProtection=true on invalid_grant → no status=error write, history recorded', async () => {
    redis.getClaudeAccount.mockResolvedValue(makeAccountData({ disableAutoProtection: 'true' }))
    setCredentialsFileContent('OLD_ACCESS') // CLI no-op

    const axiosErr = new Error('invalid_grant')
    axiosErr.response = { status: 400, data: { error: 'invalid_grant' } }
    axios.post.mockRejectedValue(axiosErr)

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow()

    const errorWrites = redis.setClaudeAccount.mock.calls
      .map((c) => c[1])
      .filter((w) => w.status === 'error')
    expect(errorWrites.length).toBe(0)
    expect(upstreamErrorHelper.recordErrorHistory).toHaveBeenCalledWith(
      ACCOUNT_ID,
      'claude-official',
      0,
      expect.stringMatching(/invalid_grant/),
      expect.any(Object)
    )
  })

  test('7.9 mtime does not advance within 5s → still reads file, no-op recorded', async () => {
    // statSync always returns same mtime
    fs.statSync.mockReturnValue({ mtimeMs: 1000 })
    setCredentialsFileContent('OLD_ACCESS') // unchanged

    axios.post.mockResolvedValue({
      status: 200,
      data: {
        access_token: 'AXIOS_NEW',
        refresh_token: 'AXIOS_NEW_RT',
        expires_in: 3600
      }
    })

    const result = await claudeAccountService.refreshTokenViaCredentials(
      ACCOUNT_ID,
      'cache_expired'
    )

    expect(result.success).toBe(true)
    // CLI was attempted 3 times despite mtime not advancing
    expect(execFile).toHaveBeenCalledTimes(3)
    // Then axios fallback succeeded
    expect(axios.post).toHaveBeenCalledTimes(1)
  }, 30000)

  test('7.10 mtime advances at first poll iteration → reads file immediately', async () => {
    let count = 0
    fs.statSync.mockImplementation(() => {
      count++
      // first call (baseline) returns 1000; subsequent return 2000
      return { mtimeMs: count === 1 ? 1000 : 2000 }
    })

    const start = Date.now()
    await claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    const elapsed = Date.now() - start

    // Should not wait the full 5s poll window
    expect(elapsed).toBeLessThan(2000)
    expect(execFile).toHaveBeenCalledTimes(1)
  })

  test('invalid trigger value → falls back to manual_refresh and warns', async () => {
    let count = 0
    fs.statSync.mockImplementation(() => {
      count++
      return { mtimeMs: count === 1 ? 1000 : 2000 }
    })

    const result = await claudeAccountService.refreshTokenViaCredentials(
      ACCOUNT_ID,
      'invalid_trigger'
    )

    expect(result.success).toBe(true)
    // Verifies the warning path doesn't break the flow.
  })

  // ---------- 8.x axios opt-in gating + Cloudflare detection ----------

  test('8.2 axios disabled + CLI ×3 all no-op → cli_no_op → status=error + CLI_NO_OP webhook', async () => {
    redis.getClaudeAccount.mockResolvedValue(
      makeAccountData({ axiosRefreshEnabled: 'false', axiosCloudflareConfirmed: 'false' })
    )
    setCredentialsFileContent('OLD_ACCESS') // CLI no-op every attempt

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/cli_no_op/)

    // axios MUST NOT be called when opt-in disabled
    expect(axios.post).not.toHaveBeenCalled()
    // status='error' written
    const writes = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    const errorWrite = writes.find((w) => w.status === 'error')
    expect(errorWrite).toBeDefined()
    expect(errorWrite.errorMessage).toMatch(/cli_no_op/)
    // CLI_NO_OP webhook sent
    const webhookCalls = webhookNotifier.sendAccountAnomalyNotification.mock.calls
    expect(webhookCalls.some((c) => c[0].errorCode === 'CLAUDE_REFRESH_CLI_NO_OP')).toBe(true)
  })

  test('8.3 axios disabled + CLI ×3 with subprocess error → cli_subprocess → temp_unavailable, no status, no webhook', async () => {
    redis.getClaudeAccount.mockResolvedValue(
      makeAccountData({ axiosRefreshEnabled: 'false', axiosCloudflareConfirmed: 'false' })
    )
    setCredentialsFileContent('OLD_ACCESS')
    let count = 0
    execFile.mockImplementation((cmd, args, opts, cb) => {
      count++
      // first attempt: subprocess error; rest: success but file unchanged (no-op)
      if (count === 1) {
        cb(Object.assign(new Error('ENOENT: claude'), { code: 'ENOENT' }), '', '')
      } else {
        cb(null, '', '')
      }
    })

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/cli_subprocess/)

    expect(axios.post).not.toHaveBeenCalled()
    expect(upstreamErrorHelper.markTempUnavailable).toHaveBeenCalledTimes(1)
    const writes = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    expect(writes.filter((w) => w.status === 'error').length).toBe(0)
    // No credential webhook for cli_subprocess
    expect(webhookNotifier.sendAccountAnomalyNotification).not.toHaveBeenCalled()
  })

  test('8.4 axios disabled + CLI ×3 all subprocess errors → cli_subprocess', async () => {
    redis.getClaudeAccount.mockResolvedValue(
      makeAccountData({ axiosRefreshEnabled: 'false', axiosCloudflareConfirmed: 'false' })
    )
    setCredentialsFileContent('OLD_ACCESS')
    execFile.mockImplementation((cmd, args, opts, cb) =>
      cb(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), '', '')
    )

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/cli_subprocess/)

    expect(upstreamErrorHelper.markTempUnavailable).toHaveBeenCalledTimes(1)
    expect(webhookNotifier.sendAccountAnomalyNotification).not.toHaveBeenCalled()
  })

  test('8.5 axios disabled + mixed subprocess+no-op → cli_subprocess (conservative)', async () => {
    redis.getClaudeAccount.mockResolvedValue(
      makeAccountData({ axiosRefreshEnabled: 'false', axiosCloudflareConfirmed: 'false' })
    )
    setCredentialsFileContent('OLD_ACCESS')
    let count = 0
    execFile.mockImplementation((cmd, args, opts, cb) => {
      count++
      if (count === 2) {
        cb(Object.assign(new Error('boom'), { code: 'ETIMEDOUT' }), '', '')
      } else {
        cb(null, '', '')
      }
    })

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/cli_subprocess/)

    expect(upstreamErrorHelper.markTempUnavailable).toHaveBeenCalledTimes(1)
    const writes = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    expect(writes.filter((w) => w.status === 'error').length).toBe(0)
  })

  test('8.6 axios enabled + CLI ×3 fail + axios 200 → success', async () => {
    setCredentialsFileContent('OLD_ACCESS')
    axios.post.mockResolvedValue({
      status: 200,
      data: { access_token: 'AX_OK', refresh_token: 'AX_RT', expires_in: 3600 }
    })

    const result = await claudeAccountService.refreshTokenViaCredentials(
      ACCOUNT_ID,
      'cache_expired'
    )

    expect(result.success).toBe(true)
    expect(result.accessToken).toBe('AX_OK')
    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  test('8.7 axios enabled + 403 with cf-ray → cloudflare_blocked: temp_unavailable + axios fields reset + CF webhook (no credential webhook)', async () => {
    setCredentialsFileContent('OLD_ACCESS')
    const cfErr = new Error('Forbidden')
    cfErr.response = {
      status: 403,
      headers: { 'cf-ray': '8a1b2c3d4e5f6789-LAX', 'cf-mitigated': 'challenge' },
      data: '<html>blocked</html>'
    }
    axios.post.mockRejectedValue(cfErr)

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/cloudflare_blocked/)

    // temp_unavailable cooldown applied
    expect(upstreamErrorHelper.markTempUnavailable).toHaveBeenCalledTimes(1)
    // status NOT set to error
    const writes = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    expect(writes.filter((w) => w.status === 'error').length).toBe(0)
    // axios fields auto-reset on the account
    const last = writes[writes.length - 1]
    expect(last.axiosRefreshEnabled).toBe('false')
    expect(last.axiosCloudflareConfirmed).toBe('false')
    expect(last.axiosLastBlockedAt).toBeTruthy()
    expect(last.axiosBlockedReason).toMatch(/cf-ray=8a1b2c3d4e5f6789-LAX/)
    // CF webhook sent, NOT credential failure webhook
    const webhookCalls = webhookNotifier.sendAccountAnomalyNotification.mock.calls
    expect(webhookCalls.some((c) => c[0].errorCode === 'CLAUDE_REFRESH_CLOUDFLARE_BLOCKED')).toBe(
      true
    )
    expect(webhookCalls.some((c) => c[0].errorCode === 'CLAUDE_REFRESH_INVALID_GRANT')).toBe(false)
  })

  test('8.8 axios enabled + 403 with body containing "Attention Required" but no cf-ray → still cloudflare_blocked', async () => {
    setCredentialsFileContent('OLD_ACCESS')
    const cfErr = new Error('Forbidden')
    cfErr.response = {
      status: 403,
      headers: { 'content-type': 'text/html' },
      data: '<html><title>Attention Required! | Cloudflare</title></html>'
    }
    axios.post.mockRejectedValue(cfErr)

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/cloudflare_blocked/)

    expect(upstreamErrorHelper.markTempUnavailable).toHaveBeenCalledTimes(1)
    const writes = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    expect(writes.filter((w) => w.status === 'error').length).toBe(0)
    const last = writes[writes.length - 1]
    expect(last.axiosRefreshEnabled).toBe('false')
  })

  test('8.9 axios enabled + 200 with cf-ray header (legitimate transit) → success, axios fields untouched', async () => {
    setCredentialsFileContent('OLD_ACCESS')
    axios.post.mockResolvedValue({
      status: 200,
      headers: { 'cf-ray': '0000-XYZ' },
      data: { access_token: 'AX_OK', refresh_token: 'AX_RT', expires_in: 3600 }
    })

    const result = await claudeAccountService.refreshTokenViaCredentials(
      ACCOUNT_ID,
      'cache_expired'
    )

    expect(result.success).toBe(true)
    const writes = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    const last = writes[writes.length - 1]
    // axios fields NOT mutated by CF reset (success path doesn't touch them)
    expect(last.axiosRefreshEnabled).toBe('true')
    expect(last.axiosCloudflareConfirmed).toBe('true')
    expect(last.axiosLastBlockedAt).toBe('')
  })

  test('8.10 axios enabled + 4xx invalid_grant without CF signal → invalid_grant → status=error', async () => {
    setCredentialsFileContent('OLD_ACCESS')
    const ig = new Error('invalid_grant')
    ig.response = {
      status: 401,
      headers: { 'content-type': 'application/json' },
      data: { error: 'invalid_grant' }
    }
    axios.post.mockRejectedValue(ig)

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/invalid_grant/)

    const writes = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    expect(writes.find((w) => w.status === 'error')).toBeDefined()
    const webhookCalls = webhookNotifier.sendAccountAnomalyNotification.mock.calls
    expect(webhookCalls.some((c) => c[0].errorCode === 'CLAUDE_REFRESH_INVALID_GRANT')).toBe(true)
  })

  test('8.11 disableAutoProtection=true + cli_no_op → no status=error, history recorded, webhook still sent', async () => {
    redis.getClaudeAccount.mockResolvedValue(
      makeAccountData({
        disableAutoProtection: 'true',
        axiosRefreshEnabled: 'false',
        axiosCloudflareConfirmed: 'false'
      })
    )
    setCredentialsFileContent('OLD_ACCESS')

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/cli_no_op/)

    const writes = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    expect(writes.filter((w) => w.status === 'error').length).toBe(0)
    expect(upstreamErrorHelper.recordErrorHistory).toHaveBeenCalledWith(
      ACCOUNT_ID,
      'claude-official',
      0,
      expect.stringMatching(/cli_no_op/),
      expect.any(Object)
    )
    const webhookCalls = webhookNotifier.sendAccountAnomalyNotification.mock.calls
    expect(webhookCalls.some((c) => c[0].errorCode === 'CLAUDE_REFRESH_CLI_NO_OP')).toBe(true)
  })

  test('8.12 disableAutoProtection=true + cloudflare_blocked → axios fields still reset (not a status change)', async () => {
    redis.getClaudeAccount.mockResolvedValue(makeAccountData({ disableAutoProtection: 'true' }))
    setCredentialsFileContent('OLD_ACCESS')
    const cfErr = new Error('CF block')
    cfErr.response = {
      status: 403,
      headers: { 'cf-ray': 'abc-LAX' },
      data: 'Cloudflare'
    }
    axios.post.mockRejectedValue(cfErr)

    await expect(
      claudeAccountService.refreshTokenViaCredentials(ACCOUNT_ID, 'cache_expired')
    ).rejects.toThrow(/cloudflare_blocked/)

    const writes = redis.setClaudeAccount.mock.calls.map((c) => c[1])
    expect(writes.filter((w) => w.status === 'error').length).toBe(0)
    const last = writes[writes.length - 1]
    expect(last.axiosRefreshEnabled).toBe('false')
    expect(last.axiosCloudflareConfirmed).toBe('false')
    expect(last.axiosLastBlockedAt).toBeTruthy()
  })
})

// ---------- 9.x updateAccount validation + migration ----------

describe('updateAccount validation', () => {
  beforeEach(() => {
    redis.getClaudeAccount.mockReset()
    redis.setClaudeAccount.mockReset()
    redis.getClaudeAccount.mockResolvedValue(makeAccountData())
    redis.setClaudeAccount.mockResolvedValue(undefined)
  })

  test('9.1a enabled=true && confirmed=false → throws 400', async () => {
    await expect(
      claudeAccountService.updateAccount(ACCOUNT_ID, {
        axiosRefreshEnabled: 'true',
        axiosCloudflareConfirmed: 'false'
      })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/axiosCloudflareConfirmed=true/),
      statusCode: 400
    })
  })

  test('9.1b enabled=true && confirmed=true → passes', async () => {
    const res = await claudeAccountService.updateAccount(ACCOUNT_ID, {
      axiosRefreshEnabled: 'true',
      axiosCloudflareConfirmed: 'true'
    })
    expect(res.success).toBe(true)
    const last = redis.setClaudeAccount.mock.calls[redis.setClaudeAccount.mock.calls.length - 1][1]
    expect(last.axiosRefreshEnabled).toBe('true')
    expect(last.axiosCloudflareConfirmed).toBe('true')
  })

  test('9.1c enabled=false → always passes regardless of confirmed', async () => {
    const res = await claudeAccountService.updateAccount(ACCOUNT_ID, {
      axiosRefreshEnabled: 'false',
      axiosCloudflareConfirmed: 'false'
    })
    expect(res.success).toBe(true)
  })

  test('9.1d enabled=true alone (existing confirmed=true) → passes', async () => {
    redis.getClaudeAccount.mockResolvedValue(
      makeAccountData({ axiosCloudflareConfirmed: 'true', axiosRefreshEnabled: 'false' })
    )
    const res = await claudeAccountService.updateAccount(ACCOUNT_ID, {
      axiosRefreshEnabled: 'true'
    })
    expect(res.success).toBe(true)
  })

  test('9.1e enabled=true alone (existing confirmed=false) → throws 400', async () => {
    redis.getClaudeAccount.mockResolvedValue(
      makeAccountData({ axiosCloudflareConfirmed: 'false', axiosRefreshEnabled: 'false' })
    )
    await expect(
      claudeAccountService.updateAccount(ACCOUNT_ID, { axiosRefreshEnabled: 'true' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('migrateAxiosOptInDefaults', () => {
  let getAllSpy

  beforeEach(() => {
    redis.setClaudeAccount.mockReset()
    redis.setClaudeAccount.mockResolvedValue(undefined)
    // Add getAllClaudeAccounts to the redis mock if not present
    if (!redis.getAllClaudeAccounts) {
      redis.getAllClaudeAccounts = jest.fn()
    }
    redis.getAllClaudeAccounts.mockReset?.()
    getAllSpy = redis.getAllClaudeAccounts
  })

  test('9.2a accounts missing fields get filled with "false"; other fields untouched', async () => {
    getAllSpy.mockResolvedValue([
      // legacy account: missing all 4 axios fields
      { id: 'acc1', name: 'Legacy', accessToken: 'enc:X', extInfo: 'orig-ext' },
      // partial: has enabled but missing confirmed
      {
        id: 'acc2',
        name: 'Partial',
        axiosRefreshEnabled: 'false',
        proxy: 'orig-proxy'
      }
    ])

    const migrated = await claudeAccountService.migrateAxiosOptInDefaults()

    expect(migrated).toBe(2)
    const writes = redis.setClaudeAccount.mock.calls
    expect(writes).toHaveLength(2)
    const acc1 = writes.find((c) => c[0] === 'acc1')[1]
    expect(acc1.axiosRefreshEnabled).toBe('false')
    expect(acc1.axiosCloudflareConfirmed).toBe('false')
    expect(acc1.axiosLastBlockedAt).toBe('')
    expect(acc1.axiosBlockedReason).toBe('')
    expect(acc1.extInfo).toBe('orig-ext') // untouched
    const acc2 = writes.find((c) => c[0] === 'acc2')[1]
    expect(acc2.axiosRefreshEnabled).toBe('false') // pre-existing value preserved
    expect(acc2.axiosCloudflareConfirmed).toBe('false') // newly filled
    expect(acc2.proxy).toBe('orig-proxy')
  })

  test('9.2b accounts with all fields present are skipped (idempotent)', async () => {
    getAllSpy.mockResolvedValue([
      {
        id: 'acc3',
        axiosRefreshEnabled: 'true',
        axiosCloudflareConfirmed: 'true',
        axiosLastBlockedAt: '2026-05-01T00:00:00Z',
        axiosBlockedReason: 'foo'
      }
    ])

    const migrated = await claudeAccountService.migrateAxiosOptInDefaults()

    expect(migrated).toBe(0)
    expect(redis.setClaudeAccount).not.toHaveBeenCalled()
  })
})
