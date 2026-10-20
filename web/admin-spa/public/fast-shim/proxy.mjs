// stdio JSON-RPC proxy between Codex Desktop and `codex app-server`.
// Enables native image_gen for an API-key relay and preserves Fast/account UI state.
// Other JSON-RPC messages pass through unchanged; no image model rewriting is performed.
import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { constants, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [real, ...args] = process.argv.slice(2)
const LOG = join(dirname(fileURLToPath(import.meta.url)), 'shim.log')
const FROM = 'apikey'
const TO = 'personalAccessToken'

function log(msg) {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} pid=${process.pid} ${msg}\n`)
  } catch {
    // Logging is best-effort; never block the Desktop transport.
  }
}

const childEnv = { ...process.env }
const nativeImageArgs = []
let nativeImageProvider = null
if (process.env.CODEX_NATIVE_IMAGE_DISABLE !== '1') {
  try {
    const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
    const configText = readFileSync(join(codexHome, 'config.toml'), 'utf8')
    const rootConfig = configText.split(/^\s*\[/m)[0]
    let provider = rootConfig.match(/^\s*model_provider\s*=\s*["']([^"']+)["']/m)?.[1]
    for (let i = 0; i < args.length; i++) {
      let raw = null
      if ((args[i] === '-c' || args[i] === '--config') && i < args.length - 1) raw = args[++i]
      else if (args[i].startsWith('--config=')) raw = args[i].slice('--config='.length)
      const override = raw?.match(/^\s*model_provider\s*=\s*["']([^"']+)["']/)
      if (override) provider = override[1]
    }
    if (provider && /^[A-Za-z0-9_-]+$/.test(provider)) {
      const auth = JSON.parse(readFileSync(join(codexHome, 'auth.json'), 'utf8'))
      const apiKey = auth.OPENAI_API_KEY
      if (typeof apiKey === 'string' && apiKey.trim()) {
        nativeImageProvider = provider
        childEnv.CODEX_NATIVE_RELAY_KEY = apiKey.trim()
        nativeImageArgs.push(
          '-c',
          `model_providers.${provider}.requires_openai_auth=false`,
          '-c',
          `model_providers.${provider}.env_key="CODEX_NATIVE_RELAY_KEY"`,
          '-c',
          `model_providers.${provider}.http_headers.x-openai-actor-authorization="local-relay"`
        )
        log(`native image_gen enabled provider=${provider}; model unchanged`)
      } else {
        log('native image_gen overrides skipped: no API key in auth.json')
      }
    } else {
      log('native image_gen overrides skipped: unsupported provider name')
    }
  } catch {
    log('native image_gen overrides skipped: local configuration could not be read')
  }
}
const child = spawn(real, [...nativeImageArgs, ...args], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: childEnv
})
const nativeImageEnabled = nativeImageArgs.length > 0
function nativeRelayKeyStillCurrent() {
  if (!nativeImageEnabled) return false
  try {
    const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
    const auth = JSON.parse(readFileSync(join(codexHome, 'auth.json'), 'utf8'))
    return (
      typeof auth.OPENAI_API_KEY === 'string' &&
      auth.OPENAI_API_KEY.trim() === childEnv.CODEX_NATIVE_RELAY_KEY
    )
  } catch {
    return false
  }
}
const pending = new Map() // JSON-encoded ids -> non-secret account status method

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function withNativeThreadConfig(msg) {
  if (
    !nativeRelayKeyStillCurrent() ||
    !['thread/start', 'thread/resume', 'thread/fork'].includes(msg.method) ||
    !isRecord(msg.params)
  )
    return null
  if (msg.params.config != null && !isRecord(msg.params.config)) return null
  const config = msg.params.config || {}
  const selectedProvider = msg.params.modelProvider || config.model_provider || nativeImageProvider
  if (selectedProvider !== nativeImageProvider) return null
  const providerKeys = Object.keys(config).filter(
    (k) => k === 'model_providers' || k.startsWith('model_providers.')
  )
  const providers = Object.create(null)
  for (const key of providerKeys.sort(
    (a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b)
  )) {
    const value = JSON.parse(JSON.stringify(config[key]))
    if (key === 'model_providers') {
      if (!isRecord(value) || Object.keys(value).length === 0) return null
      if (
        Object.keys(value).some(
          (name) => name.includes('.') || ['__proto__', 'constructor', 'prototype'].includes(name)
        )
      )
        return null
      Object.assign(providers, value)
      continue
    }
    const segments = key.slice('model_providers.'.length).split('.')
    if (segments.some((segment) => ['__proto__', 'constructor', 'prototype'].includes(segment)))
      return null
    let table = providers
    for (const segment of segments.slice(0, -1)) {
      if (!Object.hasOwn(table, segment) || !isRecord(table[segment])) {
        table[segment] = Object.create(null)
      }
      table = table[segment]
    }
    table[segments[segments.length - 1]] = value
  }
  if (Object.hasOwn(providers, nativeImageProvider) && !isRecord(providers[nativeImageProvider]))
    return null
  if (!Object.hasOwn(providers, nativeImageProvider)) {
    providers[nativeImageProvider] = Object.create(null)
  }
  const relay = providers[nativeImageProvider]
  if (Object.keys(relay).some((field) => field.includes('.'))) return null
  const hasHeaderTable = Object.hasOwn(relay, 'http_headers')
  if (hasHeaderTable && !isRecord(relay.http_headers)) return null
  relay.requires_openai_auth = false
  relay.env_key = 'CODEX_NATIVE_RELAY_KEY'
  if (hasHeaderTable) {
    for (const name of Object.keys(relay.http_headers)) {
      if (name.toLowerCase() === 'x-openai-actor-authorization') delete relay.http_headers[name]
    }
    relay.http_headers['x-openai-actor-authorization'] = 'local-relay'
  }
  const forwardedConfig = { ...config }
  for (const key of providerKeys) delete forwardedConfig[key]
  for (const [name, fields] of Object.entries(providers)) {
    if (name !== nativeImageProvider) {
      forwardedConfig[`model_providers.${name}`] = fields
      continue
    }
    for (const [field, value] of Object.entries(fields)) {
      forwardedConfig[`model_providers.${name}.${field}`] = value
    }
  }
  if (!hasHeaderTable) {
    forwardedConfig[
      `model_providers.${nativeImageProvider}.http_headers.x-openai-actor-authorization`
    ] = 'local-relay'
  }
  log(
    `native thread provider adapted method=${msg.method} provider=${nativeImageProvider} providerOverrideKeys=${providerKeys.length}`
  )
  return { ...msg, params: { ...msg.params, config: forwardedConfig } }
}

// Splits a byte stream into newline-terminated lines and calls onLine(buf) for each (without "\n").
function lineSplitter(onLine) {
  let carry = null
  return (chunk) => {
    let buf = carry ? Buffer.concat([carry, chunk]) : chunk
    let start = 0,
      nl
    while ((nl = buf.indexOf(0x0a, start)) !== -1) {
      onLine(buf.subarray(start, nl))
      start = nl + 1
    }
    carry = start < buf.length ? Buffer.from(buf.subarray(start)) : null
  }
}

const NL = Buffer.from('\n')

// client -> server: adapt thread provider config and track account status requests.
process.stdin.on(
  'data',
  lineSplitter((line) => {
    let out = line
    if (
      nativeImageEnabled &&
      ['thread/start', 'thread/resume', 'thread/fork'].some((m) => line.includes(m))
    ) {
      try {
        const adapted = withNativeThreadConfig(JSON.parse(line))
        if (adapted) out = Buffer.from(JSON.stringify(adapted))
      } catch {
        log('native thread provider adaptation skipped: invalid request config')
      }
    }
    if (line.includes('getAuthStatus') || (nativeImageEnabled && line.includes('account/read'))) {
      try {
        const msg = JSON.parse(line)
        if (
          msg.id != null &&
          ((msg.method === 'getAuthStatus' && msg.params?.includeToken !== true) ||
            (nativeImageEnabled && msg.method === 'account/read'))
        ) {
          pending.set(JSON.stringify(msg.id), msg.method)
        }
      } catch {
        // Ignore unrelated malformed status lines and preserve passthrough.
      }
    }
    if (!child.stdin.write(Buffer.concat([out, NL]))) {
      process.stdin.pause()
      child.stdin.once('drain', () => process.stdin.resume())
    }
  })
)
process.stdin.on('end', () => child.stdin.end())
child.stdin.on('error', () => {})

// server -> client: preserve the API-key account facade under actor mode.
child.stdout.on(
  'data',
  lineSplitter((line) => {
    let out = line
    if (pending.size > 0) {
      try {
        const msg = JSON.parse(line)
        const key = msg?.id != null ? JSON.stringify(msg.id) : null
        if (key && pending.has(key)) {
          const method = pending.get(key)
          pending.delete(key)
          if (
            method === 'getAuthStatus' &&
            msg.result &&
            (msg.result.authMethod === FROM ||
              (nativeRelayKeyStillCurrent() &&
                msg.result.authMethod == null &&
                msg.result.requiresOpenaiAuth === false))
          ) {
            msg.result.authMethod = TO
            if (nativeImageEnabled) msg.result.requiresOpenaiAuth = true
            out = Buffer.from(JSON.stringify(msg))
            log(`rewrote getAuthStatus id=${key} for Fast UI`)
          } else if (
            method === 'account/read' &&
            nativeRelayKeyStillCurrent() &&
            msg.result &&
            msg.result.account == null &&
            msg.result.requiresOpenaiAuth === false
          ) {
            msg.result.account = { type: 'apiKey' }
            msg.result.requiresOpenaiAuth = true
            out = Buffer.from(JSON.stringify(msg))
            log(`restored API-key account status id=${key}`)
          }
        }
      } catch {
        // Preserve the original app-server response when it cannot be decoded.
      }
    }
    if (!process.stdout.write(Buffer.concat([out, NL]))) {
      child.stdout.pause()
      process.stdout.once('drain', () => child.stdout.resume())
    }
  })
)
child.stdout.on('end', () => process.stdout.end())
process.stdout.on('error', () => {})

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    try {
      child.kill(sig)
    } catch {
      // The child may already have exited.
    }
  })
}
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 128 + (constants.signals[signal] ?? 0) : (code ?? 0)
  // Exit once stdout has been flushed; force exit shortly after in case the client never closes.
  process.stdout.end(() => process.exit())
  setTimeout(() => process.exit(), 2000).unref()
})
child.on('error', (e) => {
  log(`spawn error: ${e.message}`)
  process.exit(127)
})
// Never log CLI argument values; callers may supply credentials in -c overrides.
log(
  `started real=${real} argCount=${args.length} nativeImageOverrides=${nativeImageArgs.length > 0}`
)
