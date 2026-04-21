const fs = require('fs')
const os = require('os')
const path = require('path')

const mockRouter = {
  get: jest.fn(),
  post: jest.fn()
}

jest.mock(
  'express',
  () => ({
    Router: () => mockRouter
  }),
  { virtual: true }
)

jest.mock('../src/middleware/auth', () => ({
  authenticateAdmin: jest.fn((_req, _res, next) => next())
}))

jest.mock('../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  start: jest.fn()
}))

// Make config.https dynamically mutable via the mocked module (reassigned in each test)
const mockConfig = {
  https: {
    enabled: false,
    port: 3443,
    minTlsVersion: 'TLSv1.2',
    hstsEnabled: false,
    certDir: ''
  }
}
jest.mock('../../config/config', () => mockConfig, { virtual: true })
jest.mock('../config/config', () => mockConfig, { virtual: true })

const certificateManager = require('../src/utils/certificateManager')
require('../src/routes/admin/https')

function createResponse() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    json: jest.fn((payload) => {
      res.body = payload
      return res
    }),
    status: jest.fn((code) => {
      res.statusCode = code
      return res
    }),
    setHeader: jest.fn((k, v) => {
      res.headers[k] = v
    }),
    send: jest.fn((body) => {
      res.body = body
      return res
    })
  }
  return res
}

function findGetHandler(routePath) {
  const route = mockRouter.get.mock.calls.find((call) => call[0] === routePath)
  return route && route[route.length - 1]
}

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crs-https-route-'))
}

describe('admin https routes', () => {
  describe('GET /https/status', () => {
    test('when https is disabled, returns { enabled: false } only', async () => {
      mockConfig.https.enabled = false
      const handler = findGetHandler('/https/status')
      const res = createResponse()
      await handler({}, res)
      expect(res.body).toEqual({ success: true, data: { enabled: false } })
      expect(res.statusCode).toBe(200)
    })

    test('when https is enabled but certs missing, returns warning', async () => {
      const dir = mkTmpDir()
      try {
        mockConfig.https.enabled = true
        mockConfig.https.certDir = dir
        const handler = findGetHandler('/https/status')
        const res = createResponse()
        await handler({}, res)
        expect(res.body.success).toBe(true)
        expect(res.body.data.enabled).toBe(true)
        expect(res.body.data.warning).toMatch(/missing/i)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
        mockConfig.https.enabled = false
      }
    })

    test('when https is enabled with fresh certs, returns full metadata', async () => {
      const dir = mkTmpDir()
      try {
        const ca = certificateManager.generateCa({ keyBits: 2048, validDays: 365 })
        const altNames = certificateManager.parseSan('IP:127.0.0.1,DNS:localhost')
        const srv = certificateManager.generateServerCert(ca.certPem, ca.keyPem, altNames, {
          keyBits: 2048,
          validDays: 180
        })
        certificateManager.writeToDisk(dir, {
          caCertPem: ca.certPem,
          caKeyPem: ca.keyPem,
          serverCertPem: srv.certPem,
          serverKeyPem: srv.keyPem
        })

        mockConfig.https.enabled = true
        mockConfig.https.certDir = dir
        const handler = findGetHandler('/https/status')
        const res = createResponse()
        await handler({}, res)
        expect(res.body.success).toBe(true)
        expect(res.body.data.enabled).toBe(true)
        expect(res.body.data.port).toBe(3443)
        // parseSan 为 IPv4 自动派生 IPv4-mapped IPv6 SAN
        expect(res.body.data.certSan).toEqual(['IP:127.0.0.1', 'IP:::ffff:7f00:1', 'DNS:localhost'])
        expect(res.body.data.caSubject).toContain('Relay Service')
        expect(typeof res.body.data.certDaysRemaining).toBe('number')
        expect(res.body.data.certDaysRemaining).toBeGreaterThan(0)
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
        mockConfig.https.enabled = false
      }
    })
  })

  describe('GET /https/ca', () => {
    test('returns 404 when https is disabled', async () => {
      mockConfig.https.enabled = false
      const handler = findGetHandler('/https/ca')
      const res = createResponse()
      await handler({}, res)
      expect(res.statusCode).toBe(404)
    })

    test('serves ca.crt with correct MIME and Content-Disposition', async () => {
      const dir = mkTmpDir()
      try {
        const ca = certificateManager.generateCa({ keyBits: 2048, validDays: 365 })
        certificateManager.writeToDisk(dir, {
          caCertPem: ca.certPem,
          caKeyPem: ca.keyPem
        })

        mockConfig.https.enabled = true
        mockConfig.https.certDir = dir
        const handler = findGetHandler('/https/ca')
        const res = createResponse()
        await handler({}, res)
        expect(res.statusCode).toBe(200)
        expect(res.headers['Content-Type']).toBe('application/x-x509-ca-cert')
        expect(res.headers['Content-Disposition']).toBe('attachment; filename="ca.crt"')
        expect(res.body).toContain('BEGIN CERTIFICATE')
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
        mockConfig.https.enabled = false
      }
    })

    test('SECURITY: handler never references private key filenames in its output path', () => {
      // Read the source file and assert the handler doesn't reference any .key
      // or allow dynamic filename construction via req.params/query
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'src/routes/admin/https.js'),
        'utf8'
      )
      // No .key file reads in the download handler
      expect(source).not.toMatch(/['"][^'"]*\.key['"]/)
      // ca.crt is a hard-coded string literal, not built from user input
      expect(source).toMatch(/['"]ca\.crt['"]/)
      // req.params and req.query must not flow into fs.readFile/readFileSync or path.join
      expect(source).not.toMatch(/path\.join\([^)]*req\.(params|query|body)/)
      expect(source).not.toMatch(/readFileSync\([^)]*req\.(params|query|body)/)
    })
  })
})
