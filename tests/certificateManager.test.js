const fs = require('fs')
const os = require('os')
const path = require('path')
const forge = require('node-forge')

const cm = require('../src/utils/certificateManager')

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crs-cert-test-'))
}

function rmTmp(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

describe('certificateManager', () => {
  describe('parseSan', () => {
    it('parses IP and DNS entries and auto-derives IPv4-mapped IPv6 for each IPv4', () => {
      const altNames = cm.parseSan('IP:127.0.0.1,DNS:localhost,IP:203.0.113.10')
      // IPv4-mapped IPv6 以十六进制紧凑形式存储（node-forge 不接受点分混合形式）
      // 127.0.0.1 → ::ffff:7f00:1；203.0.113.10 → ::ffff:cb00:710a
      expect(altNames).toEqual([
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: '::ffff:7f00:1' },
        { type: 2, value: 'localhost' },
        { type: 7, ip: '203.0.113.10' },
        { type: 7, ip: '::ffff:cb00:710a' }
      ])
    })

    it('does not auto-derive for IPv6 entries', () => {
      const altNames = cm.parseSan('IP:::1,IP:2408:4005::1')
      expect(altNames).toEqual([
        { type: 7, ip: '::1' },
        { type: 7, ip: '2408:4005::1' }
      ])
    })

    it('deduplicates if user already supplied the mapped form explicitly', () => {
      const altNames = cm.parseSan('IP:127.0.0.1,IP:::ffff:7f00:1')
      expect(altNames).toEqual([
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: '::ffff:7f00:1' }
      ])
    })

    it('trims whitespace around entries and values', () => {
      const altNames = cm.parseSan(' IP: 127.0.0.1 , DNS: localhost ')
      expect(altNames).toEqual([
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: '::ffff:7f00:1' },
        { type: 2, value: 'localhost' }
      ])
    })

    it('throws InvalidSanError on empty input', () => {
      expect(() => cm.parseSan('')).toThrow(cm.InvalidSanError)
      expect(() => cm.parseSan('   ')).toThrow(cm.InvalidSanError)
      expect(() => cm.parseSan(null)).toThrow(cm.InvalidSanError)
    })

    it('throws on missing prefix', () => {
      expect(() => cm.parseSan('127.0.0.1')).toThrow(cm.InvalidSanError)
    })

    it('throws on unsupported prefix', () => {
      expect(() => cm.parseSan('URI:https://example.com')).toThrow(cm.InvalidSanError)
    })

    it('throws on empty value after prefix', () => {
      expect(() => cm.parseSan('IP:')).toThrow(cm.InvalidSanError)
    })
  })

  describe('generateCa', () => {
    it('generates a self-signed CA with CA basic constraint and expected validity', () => {
      const ca = cm.generateCa({ keyBits: 2048, validDays: 10 })
      expect(typeof ca.certPem).toBe('string')
      expect(ca.certPem).toContain('BEGIN CERTIFICATE')
      expect(ca.keyPem).toContain('PRIVATE KEY')

      const cert = forge.pki.certificateFromPem(ca.certPem)
      const bc = cert.getExtension('basicConstraints')
      expect(bc.cA).toBe(true)
      const ku = cert.getExtension('keyUsage')
      expect(ku.keyCertSign).toBe(true)
      expect(ku.cRLSign).toBe(true)

      const diffMs = cert.validity.notAfter - cert.validity.notBefore
      const approxDays = Math.round(diffMs / 86400000)
      expect(approxDays).toBe(10)
    })
  })

  describe('generateServerCert', () => {
    it('signs a server certificate with correct SAN, EKU serverAuth, not a CA', () => {
      const ca = cm.generateCa({ keyBits: 2048, validDays: 10 })
      const altNames = cm.parseSan('IP:127.0.0.1,DNS:localhost')
      const srv = cm.generateServerCert(ca.certPem, ca.keyPem, altNames, {
        keyBits: 2048,
        validDays: 5
      })
      const cert = forge.pki.certificateFromPem(srv.certPem)
      const bc = cert.getExtension('basicConstraints')
      expect(bc.cA).toBeFalsy()
      const eku = cert.getExtension('extKeyUsage')
      expect(eku.serverAuth).toBe(true)
      const sanExt = cert.getExtension('subjectAltName')
      const names = sanExt.altNames.map((a) => (a.type === 7 ? `IP:${a.ip}` : `DNS:${a.value}`))
      // parseSan 为 IPv4 自动派生 IPv4-mapped IPv6（供双栈 Node 客户端使用）
      expect(names).toEqual(['IP:127.0.0.1', 'IP:::ffff:7f00:1', 'DNS:localhost'])
      // issuer == CA subject
      const caCert = forge.pki.certificateFromPem(ca.certPem)
      expect(cert.issuer.hash).toBe(caCert.subject.hash)
    })

    it('throws if altNames is empty', () => {
      const ca = cm.generateCa({ keyBits: 2048, validDays: 10 })
      expect(() => cm.generateServerCert(ca.certPem, ca.keyPem, [], {})).toThrow(cm.InvalidSanError)
    })
  })

  describe('writeToDisk / loadFromDisk', () => {
    let dir

    beforeEach(() => {
      dir = mkTmp()
    })

    afterEach(() => {
      rmTmp(dir)
    })

    it('round-trips a full CA + server bundle and enforces private key permission 0600', () => {
      const ca = cm.generateCa({ keyBits: 2048, validDays: 10 })
      const altNames = cm.parseSan('IP:127.0.0.1')
      const srv = cm.generateServerCert(ca.certPem, ca.keyPem, altNames, {
        keyBits: 2048,
        validDays: 5
      })

      const paths = cm.writeToDisk(dir, {
        caCertPem: ca.certPem,
        caKeyPem: ca.keyPem,
        serverCertPem: srv.certPem,
        serverKeyPem: srv.keyPem
      })

      // Permissions (Linux-specific; POSIX-only check)
      if (process.platform !== 'win32') {
        expect(fs.statSync(paths.caKey).mode & 0o777).toBe(0o600)
        expect(fs.statSync(paths.serverKey).mode & 0o777).toBe(0o600)
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
      }

      const loaded = cm.loadFromDisk(dir)
      expect(loaded.caCertPem).toBe(ca.certPem)
      expect(loaded.serverCertPem).toBe(srv.certPem)
      expect(loaded.caCert.subject.hash).toBeTruthy()
      expect(loaded.serverCert.subject.hash).toBeTruthy()
    })

    it('throws MissingCaError if ca files are absent', () => {
      expect(() => cm.loadFromDisk(dir)).toThrow(cm.MissingCaError)
    })

    it('throws MissingServerError if server files are absent but CA exists', () => {
      const ca = cm.generateCa({ keyBits: 2048, validDays: 10 })
      cm.writeToDisk(dir, { caCertPem: ca.certPem, caKeyPem: ca.keyPem })
      expect(() => cm.loadFromDisk(dir)).toThrow(cm.MissingServerError)
    })

    it('throws InvalidPemError on corrupted cert', () => {
      const ca = cm.generateCa({ keyBits: 2048, validDays: 10 })
      cm.writeToDisk(dir, { caCertPem: ca.certPem, caKeyPem: ca.keyPem })
      // Corrupt server.crt
      const paths = cm.certPaths(dir)
      fs.writeFileSync(paths.serverCert, 'NOT A REAL PEM')
      fs.writeFileSync(paths.serverKey, 'NOT A REAL KEY')
      expect(() => cm.loadFromDisk(dir)).toThrow(cm.InvalidPemError)
    })
  })

  describe('describeCert', () => {
    it('returns subject, issuer, SAN list, and daysRemaining', () => {
      const ca = cm.generateCa({ keyBits: 2048, validDays: 10 })
      const altNames = cm.parseSan('IP:127.0.0.1,DNS:localhost')
      const srv = cm.generateServerCert(ca.certPem, ca.keyPem, altNames, {
        keyBits: 2048,
        validDays: 5
      })
      const desc = cm.describeCert(srv.certPem)
      expect(desc.issuer).toContain('Relay Service')
      expect(desc.sanList).toEqual(['IP:127.0.0.1', 'IP:::ffff:7f00:1', 'DNS:localhost'])
      expect(desc.daysRemaining).toBeGreaterThanOrEqual(4)
      expect(desc.daysRemaining).toBeLessThanOrEqual(5)
      expect(typeof desc.serialNumber).toBe('string')
    })
  })
})
