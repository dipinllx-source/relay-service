// Codex 客户端识别口径：codex_cli_rs / codex_exec / codex_vscode / Codex Desktop
// 覆盖 utils/codexClientIdentity、codexClientVersion 的 UA 版本学习与 semver 比较、CodexCliValidator

jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))
jest.mock('axios', () => ({ get: jest.fn() }))

const mockRedisClient = {
  get: jest.fn(),
  setex: jest.fn(),
  expire: jest.fn()
}
jest.mock('../src/models/redis', () => ({ client: mockRedisClient }))

const {
  parseCodexUserAgent,
  detectCodexClient,
  isCodexOriginator
} = require('../src/utils/codexClientIdentity')
const codexClientVersion = require('../src/utils/codexClientVersion')
const CodexCliValidator = require('../src/validators/clients/codexCliValidator')

const DESKTOP_UA =
  'Codex Desktop/0.162.0-alpha.17.2 (Mac OS 26.5.2; arm64) unknown (Codex Desktop; 26.1007.21159)'
const CLI_UA = 'codex_cli_rs/0.162.0 (Mac OS 26.5.2; arm64) xterm-256color'

describe('codexClientIdentity', () => {
  test('解析 Codex Desktop UA（含预发布版本号）', () => {
    expect(parseCodexUserAgent(DESKTOP_UA)).toEqual({
      clientType: 'codex desktop',
      version: '0.162.0-alpha.17.2'
    })
  })

  test('保持原有 CLI/exec/vscode UA 识别', () => {
    expect(parseCodexUserAgent(CLI_UA)).toEqual({ clientType: 'codex_cli_rs', version: '0.162.0' })
    expect(parseCodexUserAgent('codex_exec/0.144.5 (Mac OS 26.2.0; arm64)')).toEqual({
      clientType: 'codex_exec',
      version: '0.144.5'
    })
    expect(
      parseCodexUserAgent(
        'codex_vscode/0.35.0 (Windows 10.0.26100; x86_64) unknown (Cursor; 0.4.10)'
      )
    ).toEqual({ clientType: 'codex_vscode', version: '0.35.0' })
  })

  test('非 Codex UA 或无版本号的 UA 不识别', () => {
    expect(parseCodexUserAgent('curl/8.7.1')).toBeNull()
    expect(parseCodexUserAgent('Mozilla/5.0 (Macintosh) Codex Desktop/0.162.0')).toBeNull()
    expect(parseCodexUserAgent('Codex Desktop')).toBeNull()
    expect(parseCodexUserAgent('Codex Desktop/unknown')).toBeNull()
    expect(parseCodexUserAgent(undefined)).toBeNull()
  })

  test('originator 头识别（大小写/空白不敏感），未知值不识别', () => {
    for (const value of [
      'Codex Desktop',
      'codex desktop ',
      'codex_cli_rs',
      'codex_exec',
      'codex_vscode'
    ]) {
      expect(isCodexOriginator(value)).toBe(true)
    }
    expect(isCodexOriginator('codex_tui_fake')).toBe(false)
    expect(isCodexOriginator('')).toBe(false)
    expect(isCodexOriginator(undefined)).toBe(false)
  })

  test('detectCodexClient：UA 优先，UA 被改写时回退到 originator', () => {
    expect(detectCodexClient({ 'user-agent': DESKTOP_UA, originator: 'Codex Desktop' })).toEqual({
      clientType: 'codex desktop',
      version: '0.162.0-alpha.17.2',
      source: 'user-agent'
    })
    expect(
      detectCodexClient({ 'user-agent': 'node-fetch/1.0', originator: 'Codex Desktop' })
    ).toEqual({ clientType: 'codex desktop', version: null, source: 'originator' })
    expect(detectCodexClient({ 'user-agent': 'curl/8.7.1' })).toBeNull()
    expect(detectCodexClient(undefined)).toBeNull()
  })
})

describe('codexClientVersion 对 Codex Desktop 流量的版本学习', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('extractCodexVersionFromUserAgent 支持 Desktop UA', () => {
    expect(codexClientVersion.extractCodexVersionFromUserAgent(DESKTOP_UA)).toBe(
      '0.162.0-alpha.17.2'
    )
    expect(codexClientVersion.extractCodexVersionFromUserAgent(CLI_UA)).toBe('0.162.0')
    expect(codexClientVersion.extractCodexVersionFromUserAgent('curl/8.7.1')).toBeNull()
  })

  test('compareSemanticVersions 按 semver 处理预发布后缀', () => {
    const cmp = codexClientVersion.compareSemanticVersions
    expect(cmp('0.162.0-alpha.17.2', '0.162.0')).toBe(-1)
    expect(cmp('0.162.0', '0.162.0-alpha.17.2')).toBe(1)
    expect(cmp('0.162.0-alpha.17.2', '0.161.9')).toBe(1)
    expect(cmp('0.162.0-alpha.17.2', '0.162.0-alpha.18')).toBe(-1)
    expect(cmp('0.162.0-alpha.17.2', '0.162.0-alpha.17.1')).toBe(1)
    expect(cmp('0.162.0-alpha.17', '0.162.0-alpha.17.2')).toBe(-1)
    expect(cmp('0.162.0-alpha.1', '0.162.0-beta.1')).toBe(-1)
    expect(cmp('0.162.0-1', '0.162.0-alpha')).toBe(-1)
    // 既有行为保持
    expect(cmp('0.162', '0.162.0')).toBe(0)
    expect(cmp('0.144.5', '0.99.0')).toBe(1)
    expect(cmp('1.0.0', '0.200.0')).toBe(1)
  })

  test('首次观测 Desktop 流量即写入学习值', async () => {
    mockRedisClient.get.mockResolvedValue(null)

    await expect(codexClientVersion.captureClientVersionFromUserAgent(DESKTOP_UA)).resolves.toBe(
      '0.162.0-alpha.17.2'
    )
    expect(mockRedisClient.setex).toHaveBeenCalledWith(
      codexClientVersion.LEARNED_KEY,
      expect.any(Number),
      '0.162.0-alpha.17.2'
    )
  })

  test('学习到 alpha 后，同号正式版仍能覆盖（不被当成降级）', async () => {
    mockRedisClient.get.mockResolvedValue('0.162.0-alpha.17.2')

    await expect(codexClientVersion.captureClientVersionFromUserAgent(CLI_UA)).resolves.toBe(
      '0.162.0'
    )
    expect(mockRedisClient.setex).toHaveBeenCalledWith(
      codexClientVersion.LEARNED_KEY,
      expect.any(Number),
      '0.162.0'
    )
  })

  test('已记录正式版时，同号 alpha 不会降级覆盖', async () => {
    mockRedisClient.get.mockResolvedValue('0.162.0')

    await expect(codexClientVersion.captureClientVersionFromUserAgent(DESKTOP_UA)).resolves.toBe(
      '0.162.0'
    )
    expect(mockRedisClient.setex).not.toHaveBeenCalled()
    expect(mockRedisClient.expire).toHaveBeenCalled()
  })
})

describe('CodexCliValidator 与 handleResponses 口径一致', () => {
  const longSessionId = '01234567-89ab-cdef-0123-456789abcdef'

  test('非严格路径：Codex Desktop UA 视为 Codex 客户端', () => {
    expect(
      CodexCliValidator.validate({ path: '/v1/responses', headers: { 'user-agent': DESKTOP_UA } })
    ).toBe(true)
  })

  test('严格路径：originator 为 "Codex Desktop" 时与 UA 类型匹配', () => {
    const req = {
      path: '/openai/responses',
      headers: {
        'user-agent': DESKTOP_UA,
        originator: 'Codex Desktop',
        session_id: longSessionId
      },
      body: {
        instructions:
          'You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user computer.'
      }
    }
    expect(CodexCliValidator.validate(req)).toBe(true)
  })

  test('严格路径：originator 与 UA 类型不符仍拒绝', () => {
    const req = {
      path: '/openai/responses',
      headers: {
        'user-agent': DESKTOP_UA,
        originator: 'codex_cli_rs',
        session_id: longSessionId
      },
      body: {
        instructions:
          'You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI'
      }
    }
    expect(CodexCliValidator.validate(req)).toBe(false)
  })

  test('非 Codex UA 仍拒绝', () => {
    expect(
      CodexCliValidator.validate({ path: '/v1/responses', headers: { 'user-agent': 'curl/8.7.1' } })
    ).toBe(false)
  })
})
