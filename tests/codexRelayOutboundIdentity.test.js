// relay 自发请求的 Codex 客户端身份：originator 与 UA 首段必须一致，且能被本项目的识别逻辑认出

const {
  buildRelayOutboundIdentityHeaders,
  parseCodexUserAgent,
  RELAY_OUTBOUND_ORIGINATOR
} = require('../src/utils/codexClientIdentity')

describe('buildRelayOutboundIdentityHeaders', () => {
  test('originator 为 codex_cli_rs，UA 首段与之配套并带上版本', () => {
    const headers = buildRelayOutboundIdentityHeaders('0.164.0')

    expect(headers.originator).toBe(RELAY_OUTBOUND_ORIGINATOR)
    expect(RELAY_OUTBOUND_ORIGINATOR).toBe('codex_cli_rs')
    expect(headers['user-agent']).toMatch(/^codex_cli_rs\/0\.164\.0 \([^;]+; [^)]+\) unknown$/)
    expect(parseCodexUserAgent(headers['user-agent'])).toEqual({
      clientType: 'codex_cli_rs',
      version: '0.164.0'
    })
  })

  test('预发布版本原样保留', () => {
    const headers = buildRelayOutboundIdentityHeaders('0.165.0-alpha.3')
    expect(parseCodexUserAgent(headers['user-agent']).version).toBe('0.165.0-alpha.3')
  })

  test('缺少版本时使用占位版本，仍保持格式合法', () => {
    const headers = buildRelayOutboundIdentityHeaders(undefined)
    expect(parseCodexUserAgent(headers['user-agent'])).toEqual({
      clientType: 'codex_cli_rs',
      version: '0.0.0'
    })
  })
})
