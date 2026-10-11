const fs = require('fs')
const { EventEmitter, errorMonitor } = require('events')
const { PassThrough } = require('stream')
const createClaudeSseDiagnostics = require('../src/utils/claudeSseDiagnostics')

const serviceSource = fs.readFileSync(
  require.resolve('../src/services/relay/claudeRelayService'),
  'utf8'
)
// Execute the production data/end handlers, without loading DB, accounts or network clients.
const start = serviceSource.indexOf(
  "        let buffer = ''",
  serviceSource.indexOf('const maxRetries = 2')
)
const stop = serviceSource.indexOf('          // 提取5小时会话窗口状态', start)
const install = new Function(
  'createClaudeSseDiagnostics',
  'logger',
  'res',
  'req',
  'responseStream',
  'usageCallback',
  'isStreamWritable',
  'body',
  'requestOptions',
  'accountId',
  'account',
  'toolNameStreamTransformer',
  `${serviceSource.slice(start, stop)}\n        })`
)

function setup(compressed = false) {
  const logger = Object.fromEntries(['info', 'warn', 'debug', 'error'].map((k) => [k, jest.fn()]))
  const res = new EventEmitter()
  res.headers = {}
  res.complete = true
  const req = new EventEmitter()
  const client = new EventEmitter()
  client.write = jest.fn()
  client.end = jest.fn()
  const usage = jest.fn()
  const decoder = compressed ? new PassThrough() : null
  res.pipe = () => decoder
  install.call(
    { _createAdaptiveDecompressStream: () => decoder },
    createClaudeSseDiagnostics,
    logger,
    res,
    req,
    client,
    usage,
    () => true,
    { model: 'test-model' },
    {},
    '00000000-0000-0000-0000-000000000000',
    {},
    null
  )
  const records = () =>
    [...logger.info.mock.calls, ...logger.warn.mock.calls]
      .filter(([text]) => text.startsWith('[Claude SSE diagnostic] '))
      .map(([text]) => JSON.parse(text.slice('[Claude SSE diagnostic] '.length)))
  return { logger, res, source: decoder || res, req, client, usage, records }
}
const line = (value) => `data: ${JSON.stringify(value)}\n\n`
const begin = {
  type: 'message_start',
  message: { usage: { input_tokens: 5 }, model: 'test-model' }
}
const delta = (n) => ({ type: 'message_delta', usage: { output_tokens: n } })
const finish = { type: 'message_stop' }

it('keeps fragmented forwarding and usage unchanged, records complete lifecycle once', async () => {
  const h = setup()
  const wire = [begin, delta(7), finish].map(line).join('')
  for (let i = 0; i < wire.length; i += 3) {
    h.source.emit('data', Buffer.from(wire.slice(i, i + 3)))
  }
  await h.source.listeners('end')[0]()
  h.res.emit('close')
  h.client.emit('close')
  expect(h.client.write.mock.calls.map(([s]) => s).join('')).toBe(wire)
  expect(h.usage).toHaveBeenCalledTimes(1)
  expect(h.usage.mock.calls[0][0]).toMatchObject({ input_tokens: 5, output_tokens: 7 })
  expect(h.records()).toHaveLength(2)
  expect(h.records()[1]).toMatchObject({ complete: true, messageStop: true, outputUsageSeen: true })
  expect(h.records()[0].diagnosticId).toBe(h.records()[1].diagnosticId)
})

it('diagnoses HTTP-success SSE error and missing delta without changing zero fallback', async () => {
  const h = setup()
  h.source.emit(
    'data',
    Buffer.from(
      line(begin) +
        line({
          type: 'error',
          error: {
            type: 'overloaded_error',
            message: 'PRIVATE_INPUT bearer secret-value'
          }
        })
    )
  )
  await h.source.listeners('end')[0]()
  expect(h.usage.mock.calls[0][0].output_tokens).toBe(0)
  expect(h.records()[1]).toMatchObject({
    complete: false,
    usageOutputDefaulted: true,
    messageStart: true,
    messageDelta: false,
    messageStop: false,
    errors: { overloaded_error: 1 },
    errorSummary: 'upstream_error_message_omitted'
  })
  expect(JSON.stringify(h.records())).not.toMatch(/PRIVATE_INPUT|secret-value/)
})

it('distinguishes explicit zero from synthesized zero', async () => {
  const h = setup()
  h.source.emit('data', Buffer.from([begin, delta(0), finish].map(line).join('')))
  await h.source.listeners('end')[0]()
  expect(h.records()[1]).toMatchObject({
    complete: true,
    outputUsageZero: true,
    outputUsageSeen: true,
    usageOutputDefaulted: false
  })
})

it('does not parse the tail, change forwarding, or expose malformed lines', async () => {
  const h = setup()
  const tail = `data: ${JSON.stringify(finish)}`
  const wire = `${line(begin)}data: PRIVATE_INPUT\n\n${tail}`
  h.source.emit('data', Buffer.from(wire))
  await h.source.listeners('end')[0]()
  expect(h.client.write.mock.calls.map(([s]) => s).join('')).toBe(wire)
  expect(h.records()[1]).toMatchObject({
    complete: false,
    messageStop: false,
    parseFailures: 1,
    tailBytes: Buffer.byteLength(tail),
    usageOutputDefaulted: true
  })
  expect(JSON.stringify(h.logger)).not.toContain('PRIVATE_INPUT')
})

it('bounds unknown event/error categories and omits all arbitrary messages', async () => {
  const h = setup()
  for (let i = 0; i < 1000; i++) {
    h.source.emit(
      'data',
      Buffer.from(
        line({ type: `PRIVATE_${i}` }) +
          line({
            type: 'error',
            error: { type: `PRIVATE_${i}`, message: 'PRIVATE_INPUT' }
          })
      )
    )
  }
  await h.source.listeners('end')[0]()
  expect(h.records()).toHaveLength(2)
  expect(h.records()[1].events).toEqual({ other: 1000, error: 1000 })
  expect(h.records()[1].errors).toEqual({ unknown: 1000 })
  expect(JSON.stringify(h.records())).not.toContain('PRIVATE')
})

it('observes transport failures without installing an error handler or consuming errors', () => {
  const h = setup()
  expect(h.res.listenerCount('error')).toBe(0)
  expect(h.res.listenerCount(errorMonitor)).toBe(1)
  const error = Object.assign(new Error('PRIVATE_INPUT'), { code: 'ECONNRESET' })
  expect(() => h.res.emit('error', error)).toThrow(/PRIVATE_INPUT/)
  h.res.complete = false
  h.res.emit('aborted')
  h.res.emit('aborted')
  h.res.emit('close')
  h.client.emit('close')
  expect(h.records().filter((r) => r.phase === 'upstream_aborted')).toHaveLength(1)
  expect(h.records().find((r) => r.phase === 'upstream_error').transport).toEqual({
    upstream_error: 'ECONNRESET'
  })
  expect(h.records().some((r) => r.phase === 'source_close_before_end')).toBe(true)
  expect(JSON.stringify(h.records())).not.toContain('PRIVATE_INPUT')
})

it('captures decoder and request errors with safe codes, preserves error listener behavior', () => {
  const h = setup(true)
  h.source.emit('error', Object.assign(new Error('PRIVATE_INPUT'), { code: 'Z_DATA_ERROR' }))
  h.req.on('error', () => {})
  h.req.emit('error', Object.assign(new Error('PRIVATE_INPUT'), { code: 'PRIVATE_CODE' }))
  expect(h.records().find((r) => r.phase === 'decoder_error').transport.decoder_error).toBe(
    'Z_DATA_ERROR'
  )
  expect(h.records().find((r) => r.phase === 'request_error').transport.request_error).toBe(
    'unknown'
  )
  expect(JSON.stringify(h.records())).not.toContain('PRIVATE')
})

it('does not propagate logger failures', () => {
  const logger = {
    info: () => {
      throw new Error('logger unavailable')
    },
    warn: () => {
      throw new Error('logger unavailable')
    }
  }
  expect(() => {
    const diag = createClaudeSseDiagnostics(logger, 'untrusted-name')
    diag.event(null)
    diag.end('', false)
  }).not.toThrow()
})

it('does not declare a stopped message complete when final output usage is absent', async () => {
  const h = setup()
  h.source.emit('data', Buffer.from([begin, { type: 'message_delta' }, finish].map(line).join('')))
  await h.source.listeners('end')[0]()
  expect(h.records()[1]).toMatchObject({
    complete: false,
    messageStop: true,
    outputUsageSeen: false,
    usageOutputDefaulted: true
  })
})
