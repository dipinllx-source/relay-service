// Codex Images 额度独立于聊天额度，绝不能写入 codexUsage。
// Header 名称来自真实 Images API 响应；百分比仅表示额度占比，不推算剩余张数。
function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function extractImageGenUsageHeaders(headers = {}, nowMs = Date.now()) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  )
  const activeLimit = normalized['x-codex-active-limit']
  // 同名 x-codex-primary-* 可能代表聊天额度，只接受明确属于 imagegen 的响应。
  if (typeof activeLimit !== 'string' || !/^imagegen(?:_|$)/i.test(activeLimit)) {
    return null
  }

  const window = (name) => {
    const prefix = `x-codex-${name}-`
    const usedPercent = numberOrNull(normalized[`${prefix}used-percent`])
    const windowMinutes = numberOrNull(normalized[`${prefix}window-minutes`])
    const resetAfterSeconds = numberOrNull(normalized[`${prefix}reset-after-seconds`])
    const resetAtSeconds = numberOrNull(normalized[`${prefix}reset-at`])
    // 某些套餐没有 secondary_window；上游用全零表示不存在，不能显示为真实 0% 额度。
    if (windowMinutes === 0) {
      return null
    }
    if (
      usedPercent === null &&
      windowMinutes === null &&
      resetAfterSeconds === null &&
      resetAtSeconds === null
    ) {
      return null
    }
    const resetMs =
      resetAtSeconds !== null
        ? resetAtSeconds * 1000
        : resetAfterSeconds !== null
          ? nowMs + resetAfterSeconds * 1000
          : null
    const validReset =
      resetMs !== null && Number.isFinite(resetMs) && !Number.isNaN(new Date(resetMs).getTime())
    return {
      usedPercent,
      windowMinutes,
      resetAfterSeconds,
      resetAt: validReset ? new Date(resetMs).toISOString() : null
    }
  }
  const primary = window('primary')
  const secondary = window('secondary')
  if (!primary && !secondary) {
    return null
  }
  return { activeLimit, updatedAt: new Date(nowMs).toISOString(), primary, secondary }
}

function buildImageGenUsageSnapshot(raw, nowMs = Date.now()) {
  if (!raw) {
    return null
  }
  let snapshot
  try {
    snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !/^imagegen(?:_|$)/i.test(snapshot.activeLimit || '') ||
    !Number.isFinite(Date.parse(snapshot.updatedAt))
  ) {
    return null
  }
  const withRemaining = (window) => {
    if (!window || typeof window !== 'object') {
      return null
    }
    const resetMs = Date.parse(window.resetAt)
    return {
      ...window,
      remainingSeconds: Number.isFinite(resetMs)
        ? Math.max(0, Math.ceil((resetMs - nowMs) / 1000))
        : null
    }
  }
  return {
    ...snapshot,
    primary: withRemaining(snapshot.primary),
    secondary: withRemaining(snapshot.secondary)
  }
}

module.exports = { extractImageGenUsageHeaders, buildImageGenUsageSnapshot }
