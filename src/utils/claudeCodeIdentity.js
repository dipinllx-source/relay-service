// Verified against npm @anthropic-ai/claude-code@stable, Linux x64 offline capture.
const VERSION = '2.1.285'
const ENTRYPOINT = 'sdk-cli'
const USER_AGENT = `claude-cli/${VERSION} (external, ${ENTRYPOINT})`
const DEFAULT_HEADERS = Object.freeze({
  'user-agent': USER_AGENT,
  'x-stainless-arch': 'x64',
  'x-stainless-lang': 'js',
  'x-stainless-os': 'Linux',
  'x-stainless-package-version': '0.127.0',
  'x-stainless-retry-count': '0',
  'x-stainless-runtime': 'node',
  'x-stainless-runtime-version': 'v26.3.0',
  'x-stainless-timeout': '600',
  'anthropic-dangerous-direct-browser-access': 'true',
  'x-app': 'cli'
})

module.exports = { VERSION, ENTRYPOINT, USER_AGENT, DEFAULT_HEADERS }
