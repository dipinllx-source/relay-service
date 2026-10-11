const { randomUUID } = require('crypto')
const { errorMonitor } = require('events')

const EVENT_TYPES = new Set([
  'message_start',
  'message_delta',
  'message_stop',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'ping',
  'error'
])
const ERROR_TYPES = new Set([
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'not_found_error',
  'request_too_large',
  'rate_limit_error',
  'api_error',
  'overloaded_error'
])
const TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE',
  'Z_DATA_ERROR',
  'Z_BUF_ERROR'
])

module.exports = function createClaudeSseDiagnostics(logger, accountId) {
  const state = {
    diagnosticId: randomUUID(),
    accountId:
      typeof accountId === 'string' && /^[a-f0-9-]{36}$/i.test(accountId) ? accountId : 'omitted',
    events: {},
    errors: {},
    transport: {},
    parseFailures: 0,
    messageStart: false,
    messageDelta: false,
    messageStop: false,
    outputUsageSeen: false,
    outputUsageZero: false,
    ended: false,
    usageOutputDefaulted: false
  }
  const emitted = new Set()
  const increment = (counts, key) => {
    counts[key] = Math.min((counts[key] || 0) + 1, Number.MAX_SAFE_INTEGER)
  }
  // Fixed labels and allowlists bound both log volume and cardinality. Never read error.message.
  const report = (phase, buffer = '') => {
    if (emitted.has(phase)) {
      return
    }
    emitted.add(phase)
    const complete =
      state.ended &&
      state.messageStart &&
      state.messageDelta &&
      state.messageStop &&
      state.outputUsageSeen &&
      !state.events.error &&
      !state.parseFailures &&
      !Object.keys(state.transport).length &&
      !buffer.trim()
    try {
      logger[complete || phase === 'start' ? 'info' : 'warn'](
        `[Claude SSE diagnostic] ${JSON.stringify({
          ...state,
          phase,
          complete,
          tailBytes: Buffer.byteLength(buffer),
          errorSummary: state.events.error ? 'upstream_error_message_omitted' : 'none'
        })}`
      )
    } catch {
      // Diagnostics must not affect forwarding, accounting or stream lifecycle.
    }
  }
  report('start')
  return {
    event(data) {
      const type = EVENT_TYPES.has(data?.type) ? data.type : 'other'
      increment(state.events, type)
      if (type === 'message_start') {
        state.messageStart = true
      }
      if (type === 'message_delta') {
        state.messageDelta = true
        if (data.usage?.output_tokens !== undefined) {
          state.outputUsageSeen = true
          state.outputUsageZero = data.usage.output_tokens === 0
        }
      }
      if (type === 'message_stop') {
        state.messageStop = true
      }
      if (type === 'error') {
        const category = ERROR_TYPES.has(data.error?.type) ? data.error.type : 'unknown'
        increment(state.errors, category)
      }
    },
    parseFailure() {
      state.parseFailures = Math.min(state.parseFailures + 1, Number.MAX_SAFE_INTEGER)
    },
    end(buffer, usageOutputDefaulted) {
      state.ended = true
      state.usageOutputDefaulted = usageOutputDefaulted
      report('end', buffer)
    },
    watch(res, source, req, client, getBuffer) {
      const failure = (label, error) => {
        state.transport[label] = TRANSPORT_CODES.has(error?.code) ? error.code : 'unknown'
        report(label, getBuffer())
      }
      // errorMonitor observes errors without changing EventEmitter error handling semantics.
      res.once(errorMonitor, (error) => failure('upstream_error', error))
      req.once(errorMonitor, (error) => failure('request_error', error))
      res.once('aborted', () => failure('upstream_aborted'))
      res.once('close', () => {
        if (!res.complete) {
          failure('upstream_close_incomplete')
        }
      })
      if (source !== res) {
        source.once(errorMonitor, (error) => failure('decoder_error', error))
      }
      source.once('close', () => {
        if (!state.ended) {
          failure('source_close_before_end')
        }
      })
      client.once('close', () => {
        if (!state.ended) {
          failure('client_close_before_end')
        }
      })
    }
  }
}
