import { computed } from 'vue'

export function useTutorialUrls() {
  const getIpv4Host = (host) => {
    if (!host) {
      return null
    }

    const normalizedHost = String(host).replace(/^\[/, '').replace(/\]$/, '')
    const ipv4Host = normalizedHost.startsWith('::ffff:') ? normalizedHost.slice(7) : normalizedHost
    const parts = ipv4Host.split('.')

    if (parts.length !== 4) {
      return null
    }

    const isIpv4 = parts.every((part) => {
      if (!/^\d+$/.test(part)) {
        return false
      }

      const value = Number(part)
      return value >= 0 && value <= 255
    })

    return isIpv4 ? ipv4Host : null
  }

  const getBaseUrlPrefix = () => {
    const customPrefix = import.meta.env.VITE_API_BASE_PREFIX
    if (customPrefix) {
      return customPrefix.replace(/\/$/, '')
    }

    let origin = ''
    if (window.location.origin) {
      origin = window.location.origin
    } else {
      const protocol = window.location.protocol
      const hostname = window.location.hostname
      const port = window.location.port
      origin = protocol + '//' + hostname
      if (
        port &&
        ((protocol === 'http:' && port !== '80') || (protocol === 'https:' && port !== '443'))
      ) {
        origin += ':' + port
      }
    }

    if (!origin) {
      const currentUrl = window.location.href
      const pathStart = currentUrl.indexOf('/', 8)
      if (pathStart !== -1) {
        origin = currentUrl.substring(0, pathStart)
      } else {
        return ''
      }
    }

    return origin
  }

  const getIpv6MappedUrl = (path) => {
    const fallbackProtocol = window.location.protocol || 'http:'
    const fallbackHost = getIpv4Host(window.location.hostname) || 'ipv4'
    const fallbackPort = window.location.port || 'port'

    try {
      const baseUrl = new URL(getBaseUrlPrefix())
      const host = getIpv4Host(baseUrl.hostname) || fallbackHost
      const port = baseUrl.port || 'port'
      return `${baseUrl.protocol}//[::ffff:${host}]:${port}${path}`
    } catch {
      return `${fallbackProtocol}//[::ffff:${fallbackHost}]:${fallbackPort}${path}`
    }
  }

  const currentBaseUrl = computed(() => getBaseUrlPrefix() + '/api')
  const geminiBaseUrl = computed(() => getBaseUrlPrefix() + '/gemini')
  const openaiBaseUrl = computed(() => getBaseUrlPrefix() + '/openai')
  const droidClaudeBaseUrl = computed(() => getBaseUrlPrefix() + '/droid/claude')
  const droidOpenaiBaseUrl = computed(() => getBaseUrlPrefix() + '/droid/openai')
  const ipv6CurrentBaseUrl = computed(() => getIpv6MappedUrl('/api'))
  const ipv6OpenaiBaseUrl = computed(() => getIpv6MappedUrl('/openai'))

  return {
    currentBaseUrl,
    geminiBaseUrl,
    openaiBaseUrl,
    droidClaudeBaseUrl,
    droidOpenaiBaseUrl,
    ipv6CurrentBaseUrl,
    ipv6OpenaiBaseUrl
  }
}
