/**
 * 证书管理器（Certificate Manager）
 *
 * 用途：
 *   为 HTTPS 监听提供私有 CA 与 server 证书的生成、加载、元数据解析能力。
 *   本模块为纯函数集合，不持有状态、不读取 config，由调用方传入参数。
 *
 * 安全边界：
 *   - 私钥文件（*.key）权限必须为 0600，目录必须为 0700。
 *   - 本模块仅在进程内处理密钥；切勿将 ca.key 经由任何 HTTP 路径返回。
 */

const fs = require('fs')
const path = require('path')
const forge = require('node-forge')

// ---------------------------------------------------------------------------
// 可识别错误类型：便于调用方精细处理不同失败分支
// ---------------------------------------------------------------------------

class MissingCaError extends Error {
  constructor(message) {
    super(message || 'CA certificate or key file is missing')
    this.name = 'MissingCaError'
    this.code = 'MISSING_CA'
  }
}

class MissingServerError extends Error {
  constructor(message) {
    super(message || 'Server certificate or key file is missing')
    this.name = 'MissingServerError'
    this.code = 'MISSING_SERVER'
  }
}

class InvalidPemError extends Error {
  constructor(filePath, cause) {
    super(
      `Failed to parse PEM file: ${filePath} (${cause && cause.message ? cause.message : cause})`
    )
    this.name = 'InvalidPemError'
    this.code = 'INVALID_PEM'
    this.filePath = filePath
    if (cause) {
      this.cause = cause
    }
  }
}

class ExpiredCertError extends Error {
  constructor(filePath, notAfter) {
    super(
      `Certificate expired at ${notAfter && notAfter.toISOString ? notAfter.toISOString() : notAfter}: ${filePath}`
    )
    this.name = 'ExpiredCertError'
    this.code = 'EXPIRED_CERT'
    this.filePath = filePath
    this.notAfter = notAfter
  }
}

class InvalidSanError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InvalidSanError'
    this.code = 'INVALID_SAN'
  }
}

// ---------------------------------------------------------------------------
// parseSan：解析 SAN 字符串到 node-forge 的 altNames 数组
// 格式：IP:<addr>,DNS:<name>,...；无前缀 / 空条目 / 前缀非法抛 InvalidSanError
//
// 自动派生：每条 IPv4 条目自动附加其 IPv4-mapped IPv6 形式（::ffff:a.b.c.d）。
// 原因：双栈 Node 客户端可能以 ::ffff:a.b.c.d 形式发起连接（RFC 4291），
// 若证书 SAN 仅含裸 IPv4 会触发 ERR_TLS_CERT_ALTNAME_INVALID。
// ---------------------------------------------------------------------------

const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/

// 将 IPv4 点分形式（a.b.c.d）转为 IPv4-mapped IPv6 的十六进制形式（::ffff:XXXX:XXXX）
// node-forge 要求纯十六进制 IPv6，不接受 ::ffff:a.b.c.d 的点分混合形式；
// 底层 16 字节与点分形式完全一致，TLS 握手中的字节比对同样匹配客户端 ::ffff:a.b.c.d 连接。
function ipv4ToMappedIpv6Hex(ipv4) {
  const parts = ipv4.split('.').map((p) => parseInt(p, 10))
  const hi = ((parts[0] << 8) | parts[1]).toString(16)
  const lo = ((parts[2] << 8) | parts[3]).toString(16)
  return `::ffff:${hi}:${lo}`
}

function parseSan(sanString) {
  if (!sanString || typeof sanString !== 'string' || sanString.trim().length === 0) {
    throw new InvalidSanError(
      'HTTPS_SAN is empty. Provide at least one entry, e.g. "IP:203.0.113.10,DNS:localhost,IP:127.0.0.1"'
    )
  }

  const entries = sanString
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  if (entries.length === 0) {
    throw new InvalidSanError('HTTPS_SAN contains no valid entries after trimming')
  }

  const altNames = []
  const seenIps = new Set()
  const pushIp = (ip) => {
    if (seenIps.has(ip)) {
      return
    }
    seenIps.add(ip)
    altNames.push({ type: 7, ip })
  }

  for (const entry of entries) {
    const colonIdx = entry.indexOf(':')
    if (colonIdx <= 0) {
      throw new InvalidSanError(
        `SAN entry "${entry}" is missing type prefix. Use "IP:<addr>" or "DNS:<name>"`
      )
    }
    const type = entry.slice(0, colonIdx).trim().toUpperCase()
    const value = entry.slice(colonIdx + 1).trim()
    if (value.length === 0) {
      throw new InvalidSanError(`SAN entry "${entry}" has empty value`)
    }
    if (type === 'IP') {
      // node-forge altNames: { type: 7, ip: '...' }
      pushIp(value)
      if (IPV4_REGEX.test(value)) {
        pushIp(ipv4ToMappedIpv6Hex(value))
      }
    } else if (type === 'DNS') {
      // node-forge altNames: { type: 2, value: '...' }
      altNames.push({ type: 2, value })
    } else {
      throw new InvalidSanError(
        `SAN entry "${entry}" has unsupported type "${type}". Only "IP:" and "DNS:" are supported`
      )
    }
  }
  return altNames
}

// ---------------------------------------------------------------------------
// 内部辅助：生成时间偏移 / 序列号 / 将 altNames 还原为可读字符串
// ---------------------------------------------------------------------------

function generateSerialHex() {
  // 16 字节随机正整数序列号（首位强制 0 以避免被解读为负数）
  const bytes = forge.random.getBytesSync(16)
  let hex = forge.util.bytesToHex(bytes)
  if (parseInt(hex[0], 16) >= 8) {
    hex = `0${hex.slice(1)}`
  }
  return hex
}

function formatSanEntry(altName) {
  if (altName.type === 7) {
    return `IP:${altName.ip}`
  }
  if (altName.type === 2) {
    return `DNS:${altName.value}`
  }
  return `TYPE${altName.type}:${altName.value || altName.ip || ''}`
}

function toPlainAttrs(forgeAttrs) {
  if (!forgeAttrs || !forgeAttrs.length) {
    return {}
  }
  const out = {}
  for (const attr of forgeAttrs) {
    if (attr.shortName) {
      out[attr.shortName] = attr.value
    }
  }
  return out
}

function describeSubject(cert) {
  const attrs = toPlainAttrs(cert.subject.attributes)
  return attrs.CN || attrs.O || cert.subject.hash || ''
}

function describeIssuer(cert) {
  const attrs = toPlainAttrs(cert.issuer.attributes)
  return attrs.CN || attrs.O || cert.issuer.hash || ''
}

function diffDays(from, to) {
  const ms = to.getTime() - from.getTime()
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

// ---------------------------------------------------------------------------
// generateCa：生成自签名根 CA
// options: { commonName?, organization?, validDays?, keyBits? }
// 返回：{ certPem, keyPem, notBefore, notAfter }
// ---------------------------------------------------------------------------

function generateCa(options = {}) {
  const keyBits = options.keyBits || 2048
  const validDays = options.validDays || 3650
  const commonName = options.commonName || 'Relay Service Private CA'
  const organization = options.organization || 'Relay Service'

  const keys = forge.pki.rsa.generateKeyPair(keyBits)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = generateSerialHex()

  const now = new Date()
  const notBefore = new Date(now.getTime() - 60 * 1000) // 向前 1 分钟，避免时钟漂移
  const notAfter = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000)
  cert.validity.notBefore = notBefore
  cert.validity.notAfter = notAfter

  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: organization }
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)

  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    {
      name: 'keyUsage',
      keyCertSign: true,
      cRLSign: true,
      digitalSignature: true,
      critical: true
    },
    { name: 'subjectKeyIdentifier' }
  ])

  cert.sign(keys.privateKey, forge.md.sha256.create())

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    notBefore,
    notAfter
  }
}

// ---------------------------------------------------------------------------
// generateServerCert：使用已有 CA 签发 server 证书
// caCertPem / caKeyPem: 根 CA 的 PEM；altNames: 由 parseSan 返回的数组
// options: { commonName?, validDays?, keyBits? }
// 返回：{ certPem, keyPem, notBefore, notAfter }
// ---------------------------------------------------------------------------

function generateServerCert(caCertPem, caKeyPem, altNames, options = {}) {
  if (!caCertPem || !caKeyPem) {
    throw new Error('generateServerCert requires caCertPem and caKeyPem')
  }
  if (!Array.isArray(altNames) || altNames.length === 0) {
    throw new InvalidSanError('altNames must be a non-empty array (use parseSan to build it)')
  }

  const keyBits = options.keyBits || 2048
  const validDays = options.validDays || 1825
  // server 证书 CN 使用首个 altName 的可读形式（浏览器/客户端均忽略 CN，仅便于 `openssl x509` 查看）
  const firstName =
    altNames[0].type === 7 ? altNames[0].ip : altNames[0].value || 'relay-service-server'
  const commonName = options.commonName || firstName

  const caCert = forge.pki.certificateFromPem(caCertPem)
  const caKey = forge.pki.privateKeyFromPem(caKeyPem)

  const keys = forge.pki.rsa.generateKeyPair(keyBits)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = generateSerialHex()

  const now = new Date()
  const notBefore = new Date(now.getTime() - 60 * 1000)
  const notAfter = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000)
  cert.validity.notBefore = notBefore
  cert.validity.notAfter = notAfter

  cert.setSubject([
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'Relay Service' }
  ])
  cert.setIssuer(caCert.subject.attributes)

  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
      critical: true
    },
    {
      name: 'extKeyUsage',
      serverAuth: true
    },
    { name: 'subjectAltName', altNames },
    { name: 'subjectKeyIdentifier' },
    {
      name: 'authorityKeyIdentifier',
      keyIdentifier: caCert.generateSubjectKeyIdentifier
        ? caCert.generateSubjectKeyIdentifier().getBytes()
        : undefined,
      authorityCertIssuer: true,
      serialNumber: caCert.serialNumber
    }
  ])

  cert.sign(caKey, forge.md.sha256.create())

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    notBefore,
    notAfter
  }
}

// ---------------------------------------------------------------------------
// loadFromDisk：按 certDir 读取全部四个文件；缺失 / 损坏 / 过期区分错误类型
// 返回：{ caCertPem, caKeyPem, serverCertPem, serverKeyPem, caCert, serverCert }
// ---------------------------------------------------------------------------

function loadFromDisk(certDir) {
  const paths = certPaths(certDir)

  const caCertExists = fs.existsSync(paths.caCert)
  const caKeyExists = fs.existsSync(paths.caKey)
  const serverCertExists = fs.existsSync(paths.serverCert)
  const serverKeyExists = fs.existsSync(paths.serverKey)

  if (!caCertExists || !caKeyExists) {
    throw new MissingCaError(
      `CA not found in ${certDir} (ca.crt: ${caCertExists}, ca.key: ${caKeyExists})`
    )
  }

  let caCertPem
  let caKeyPem
  let caCert
  try {
    caCertPem = fs.readFileSync(paths.caCert, 'utf8')
    caKeyPem = fs.readFileSync(paths.caKey, 'utf8')
    caCert = forge.pki.certificateFromPem(caCertPem)
    forge.pki.privateKeyFromPem(caKeyPem) // 验证可解析
  } catch (err) {
    throw new InvalidPemError(caCertExists ? paths.caCert : paths.caKey, err)
  }

  if (!serverCertExists || !serverKeyExists) {
    throw new MissingServerError(
      `Server cert not found in ${certDir} (server.crt: ${serverCertExists}, server.key: ${serverKeyExists})`
    )
  }

  let serverCertPem
  let serverKeyPem
  let serverCert
  try {
    serverCertPem = fs.readFileSync(paths.serverCert, 'utf8')
    serverKeyPem = fs.readFileSync(paths.serverKey, 'utf8')
    serverCert = forge.pki.certificateFromPem(serverCertPem)
    forge.pki.privateKeyFromPem(serverKeyPem)
  } catch (err) {
    throw new InvalidPemError(serverCertExists ? paths.serverCert : paths.serverKey, err)
  }

  const now = new Date()
  if (serverCert.validity.notAfter < now) {
    throw new ExpiredCertError(paths.serverCert, serverCert.validity.notAfter)
  }
  if (caCert.validity.notAfter < now) {
    throw new ExpiredCertError(paths.caCert, caCert.validity.notAfter)
  }

  return {
    caCertPem,
    caKeyPem,
    serverCertPem,
    serverKeyPem,
    caCert,
    serverCert,
    paths
  }
}

// ---------------------------------------------------------------------------
// writeToDisk：落盘四个文件 + 强权限（目录 0700 / 私钥 0600）
// artifacts: { caCertPem?, caKeyPem?, serverCertPem?, serverKeyPem? }
// 仅写入传入的字段，未提供的跳过（允许"仅重写 server.*"）
// ---------------------------------------------------------------------------

function writeToDisk(certDir, artifacts) {
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true, mode: 0o700 })
  } else {
    // 即使已存在也尝试修正权限（尽力而为，Windows 下会静默失败）
    try {
      fs.chmodSync(certDir, 0o700)
    } catch (_err) {
      /* ignore */
    }
  }

  const paths = certPaths(certDir)

  if (artifacts.caCertPem) {
    fs.writeFileSync(paths.caCert, artifacts.caCertPem, { mode: 0o644 })
  }
  if (artifacts.caKeyPem) {
    fs.writeFileSync(paths.caKey, artifacts.caKeyPem, { mode: 0o600 })
    try {
      fs.chmodSync(paths.caKey, 0o600)
    } catch (_err) {
      /* ignore */
    }
  }
  if (artifacts.serverCertPem) {
    fs.writeFileSync(paths.serverCert, artifacts.serverCertPem, { mode: 0o644 })
  }
  if (artifacts.serverKeyPem) {
    fs.writeFileSync(paths.serverKey, artifacts.serverKeyPem, { mode: 0o600 })
    try {
      fs.chmodSync(paths.serverKey, 0o600)
    } catch (_err) {
      /* ignore */
    }
  }

  return paths
}

// ---------------------------------------------------------------------------
// describeCert：返回供管理后台状态接口展示的元数据
// ---------------------------------------------------------------------------

function describeCert(certPemOrObject) {
  const cert =
    typeof certPemOrObject === 'string'
      ? forge.pki.certificateFromPem(certPemOrObject)
      : certPemOrObject
  const sanExt = cert.getExtension('subjectAltName')
  const sanList = sanExt && sanExt.altNames ? sanExt.altNames.map(formatSanEntry) : []
  const now = new Date()
  return {
    subject: describeSubject(cert),
    issuer: describeIssuer(cert),
    sanList,
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    daysRemaining: diffDays(now, cert.validity.notAfter),
    serialNumber: cert.serialNumber
  }
}

// ---------------------------------------------------------------------------
// 辅助：统一证书文件路径
// ---------------------------------------------------------------------------

function certPaths(certDir) {
  return {
    caCert: path.join(certDir, 'ca.crt'),
    caKey: path.join(certDir, 'ca.key'),
    serverCert: path.join(certDir, 'server.crt'),
    serverKey: path.join(certDir, 'server.key')
  }
}

module.exports = {
  parseSan,
  generateCa,
  generateServerCert,
  loadFromDisk,
  writeToDisk,
  describeCert,
  certPaths,
  MissingCaError,
  MissingServerError,
  InvalidPemError,
  ExpiredCertError,
  InvalidSanError
}
