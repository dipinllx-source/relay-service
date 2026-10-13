const {
  extractImageGenUsageHeaders,
  buildImageGenUsageSnapshot
} = require('../src/utils/imageGenUsage')

const NOW = Date.parse('2026-10-13T08:00:00Z')
// Fields observed in the actual successful ChatGPT Images response.
const HEADERS = {
  'x-codex-active-limit': 'imagegen_premium',
  'x-codex-primary-used-percent': '0',
  'x-codex-primary-window-minutes': '1440',
  'x-codex-primary-reset-after-seconds': '86400',
  'x-codex-primary-reset-at': String(NOW / 1000 + 86400),
  'x-codex-secondary-used-percent': '0',
  'x-codex-secondary-window-minutes': '0',
  'x-codex-secondary-reset-after-seconds': '0'
}

describe('image generation quota snapshots', () => {
  it('accepts real image quota headers, preserving zero percent and ignoring nonexistent secondary', () => {
    const x = extractImageGenUsageHeaders(HEADERS, NOW)
    expect(x.primary).toEqual({
      usedPercent: 0,
      windowMinutes: 1440,
      resetAfterSeconds: 86400,
      resetAt: '2026-10-14T08:00:00.000Z'
    })
    expect(x.secondary).toBeNull()
    expect(x.updatedAt).toBe('2026-10-13T08:00:00.000Z')
  })
  it('does not treat ordinary chat response headers as image quotas', () => {
    expect(
      extractImageGenUsageHeaders({ ...HEADERS, 'x-codex-active-limit': 'codex' }, NOW)
    ).toBeNull()
    const { 'x-codex-active-limit': _, ...rest } = HEADERS
    expect(extractImageGenUsageHeaders(rest, NOW)).toBeNull()
  })
  it('handles uppercase headers and missing reset-at without inventing usage', () => {
    const x = extractImageGenUsageHeaders(
      {
        'X-Codex-Active-Limit': 'imagegen_premium',
        'X-Codex-Primary-Used-Percent': '',
        'X-Codex-Primary-Window-Minutes': '1440',
        'X-Codex-Primary-Reset-After-Seconds': '30'
      },
      NOW
    )
    expect(x.primary.usedPercent).toBeNull()
    expect(x.primary.resetAt).toBe('2026-10-13T08:00:30.000Z')
  })
  it('keeps real secondary limits when present', () => {
    const x = extractImageGenUsageHeaders(
      {
        ...HEADERS,
        'x-codex-secondary-window-minutes': '10080',
        'x-codex-secondary-used-percent': '20'
      },
      NOW
    )
    expect(x.secondary.usedPercent).toBe(20)
  })
  it('returns null for missing/corrupt data and calculates countdown without changing saved percentage', () => {
    expect(buildImageGenUsageSnapshot('bad', NOW)).toBeNull()
    expect(buildImageGenUsageSnapshot(null, NOW)).toBeNull()
    expect(buildImageGenUsageSnapshot({ activeLimit: 'codex' }, NOW)).toBeNull()
    const saved = extractImageGenUsageHeaders(
      { ...HEADERS, 'x-codex-primary-used-percent': '25' },
      NOW
    )
    expect(
      buildImageGenUsageSnapshot(JSON.stringify(saved), NOW + 60000).primary.remainingSeconds
    ).toBe(86340)
    const expired = buildImageGenUsageSnapshot(saved, NOW + 86401000)
    expect(expired.primary.remainingSeconds).toBe(0)
    expect(expired.primary.usedPercent).toBe(25)
  })
})
