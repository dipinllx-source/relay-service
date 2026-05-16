import { computed } from 'vue'

export function useTutorialUrls() {
  const getIpv4FromHost = (host) => {
    if (!host) {
      return null
    }

    const normalizedHost = String(host).replace(/^\[/, '').replace(/\]$/, '')
    const candidate = normalizedHost.startsWith('::ffff:')
      ? normalizedHost.slice('::ffff:'.length)
      : normalizedHost
    const parts = candidate.split('.')

    if (parts.length !== 4) {
      return null
    }

    const valid = parts.every((part) => {
      if (!/^\d+$/.test(part)) {
        return false
      }
      const value = Number(part)
      return value >= 0 && value <= 255
    })

    return valid ? candidate : null
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

  const buildIpv6ExampleUrl = (path) => {
    const fallbackProtocol = window.location.protocol || 'http:'
    const fallbackIpv4 = getIpv4FromHost(window.location.hostname) || 'ipv4'
    const fallbackPort = window.location.port || 'port'

    try {
      const prefixUrl = new URL(getBaseUrlPrefix())
      const port = prefixUrl.port || 'port'
      const ipv4 = getIpv4FromHost(prefixUrl.hostname) || fallbackIpv4
      return `${prefixUrl.protocol}//[::ffff:${ipv4}]:${port}${path}`
    } catch {
      return `${fallbackProtocol}//[::ffff:${fallbackIpv4}]:${fallbackPort}${path}`
    }
  }

  const currentBaseUrl = computed(() => getBaseUrlPrefix() + '/api')
  const geminiBaseUrl = computed(() => getBaseUrlPrefix() + '/gemini')
  const openaiBaseUrl = computed(() => getBaseUrlPrefix() + '/openai')
  const droidClaudeBaseUrl = computed(() => getBaseUrlPrefix() + '/droid/claude')
  const droidOpenaiBaseUrl = computed(() => getBaseUrlPrefix() + '/droid/openai')
  const ipv6CurrentBaseUrl = computed(() => buildIpv6ExampleUrl('/api'))
  const ipv6OpenaiBaseUrl = computed(() => buildIpv6ExampleUrl('/openai'))

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
