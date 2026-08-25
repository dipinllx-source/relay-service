/**
 * 启动期 ENCRYPTION_KEY 一致性自检（缺陷 D5）
 *
 * 背景：备份文件里的账户凭据是密文，与导出机的 `ENCRYPTION_KEY` 硬绑定。
 * 换机迁移时若目标机不沿用源机的该值，导入会「成功」、账户在管理台「可见」，
 * 但每一次上游调用都会 401，而后台只显示「账号异常」，全链路没有一处指向密钥。
 * 本服务的唯一职责是让这种错配**不能安静地存在**：抽样试解已有密文，判定当前
 * 密钥能否解开库里的东西，然后写一条日志。
 *
 * 三条硬约束：
 *   1. 只读。MUST NOT 写任何 key，MUST NOT 改任何字段。取 id 用 `smembers` 而不是
 *      `redisClient.getAllIdsByIndex()`——后者在索引为空时会 `setex <index>:empty`、
 *      在 SCAN 回退时会 `sadd` 索引，都是写操作。启动序列里本服务排在
 *      `accountIndexService.checkAndRebuild()` 之后，索引此时已是权威，直接读即可。
 *   2. 不阻断启动。一次配置失手不该升级为服务不可用——库里可能只有一部分账户属于
 *      错配密钥，阻断会把局部故障放大成全局故障。
 *   3. 判据落在**返回值**上，MUST NOT 写成 `try { decrypt(x) } catch { 判失配 }`。
 *      `commonHelper.js` 的 `decrypt` 解不开时 `return text`（原文），
 *      `claudeAccountService._decryptSensitiveData` 解不开时 `return encryptedData`，
 *      两条路径都不抛错，catch 永远进不去。唯一的例外是 bedrock 的
 *      `_decryptAwsCredentials`，它确实抛错（见 BEDROCK 探针注释）。
 *
 * 本服务 MUST NOT 改动任何加解密实现：各平台的 salt / 派生方式各不相同（11 个平台
 * 11 套），所以探针一律调用各平台**自己**的解密入口，而不在这里重新派生密钥。
 */

const crypto = require('crypto')
const config = require('../../config/config')
const redis = require('../models/redis')
const logger = require('../utils/logger')

// 每平台第一轮抽样的账户数上限。启动路径上的解密都是 CPU 密集的 scrypt + AES，
// 故 MUST NOT 全量解密、MUST NOT 全库 SCAN。
const SAMPLE_LIMIT = 3
// 第一轮只拿到「1 次失败、0 次成功」时的追加抽样上限（宁可漏报不可误报）。
const EXTENDED_LIMIT = 8

// 指纹派生参数。备份导出侧（D14）会把派生结果写进 metadata 供跨机核对，因此这个
// salt 与截断长度一旦变更，历史备份里声明的指纹就全部对不上本机的新指纹 ——
// 改它等于让所有存量备份看起来都「来自另一把密钥」。
const FINGERPRINT_SALT = 'relay-key-check-fingerprint'
const FINGERPRINT_HEX_LEN = 12
// 可对外展示的派生方式描述（不含密钥本身，可安全写进备份文件与接口响应）
const FINGERPRINT_ALGORITHM = `scrypt(ENCRYPTION_KEY, "${FINGERPRINT_SALT}", 16) 取前 ${FINGERPRINT_HEX_LEN} 位 hex`

// scheme A/B：`iv(16 字节 hex):密文 hex`
const CIPHER_RE = /^[0-9a-f]{32}:[0-9a-f]+$/i
// scheme C（legacy `createDecipher`）：裸 hex、无 `iv:` 前缀。
// 该形态在 Node 17+ 上无论密钥对不对都解不开，故 MUST 排除在一致性判定之外。
const LEGACY_RE = /^[0-9a-f]{32,}$/i
const PRINTABLE_RE = /^[\x20-\x7e\t\r\n]+$/

/**
 * 探针表。`decrypt` 用 thunk 延迟 require：某个平台的服务加载失败时只跳过它，
 * 不至于把整个自检拖垮；且这些服务在 app.js 里本就已加载，thunk 拿到的是同一个
 * 单例，不会多派生一次密钥、也不会多起一个定时器。
 *
 * fields 顺序即探测顺序：聚合型 JSON 字段优先（AES-256-CBC 没有 MAC，错误密钥仍有
 * 约 1/256 的概率通过 padding 校验而产出乱码明文，JSON 探针能把这条漏网概率再压几个量级）。
 */
const PLATFORMS = [
  {
    platform: 'claude',
    indexKey: 'claude:account:index',
    keyOf: (id) => `claude:account:${id}`,
    storage: 'hash',
    decrypt: () => {
      const s = require('./account/claudeAccountService')
      return (text) => s._decryptSensitiveData(text)
    },
    fields: [
      { name: 'claudeAiOauth', kind: 'json' },
      { name: 'accessToken', kind: 'value' },
      { name: 'refreshToken', kind: 'value' }
    ]
  },
  {
    platform: 'claudeConsole',
    indexKey: 'claude_console_account:index',
    keyOf: (id) => `claude_console_account:${id}`,
    storage: 'hash',
    decrypt: () => {
      const s = require('./account/claudeConsoleAccountService')
      return (text) => s._decryptSensitiveData(text)
    },
    fields: [{ name: 'apiKey', kind: 'value' }]
  },
  {
    platform: 'gemini',
    indexKey: 'gemini_account:index',
    keyOf: (id) => `gemini_account:${id}`,
    storage: 'hash',
    decrypt: () => require('./account/geminiAccountService').decrypt,
    fields: [
      { name: 'geminiOauth', kind: 'json' },
      { name: 'accessToken', kind: 'value' },
      { name: 'refreshToken', kind: 'value' }
    ]
  },
  {
    platform: 'geminiApi',
    indexKey: 'gemini_api_account:index',
    keyOf: (id) => `gemini_api_account:${id}`,
    storage: 'hash',
    decrypt: () => {
      const s = require('./account/geminiApiAccountService')
      return (text) => s._decryptSensitiveData(text)
    },
    fields: [{ name: 'apiKey', kind: 'value' }]
  },
  {
    platform: 'openai',
    indexKey: 'openai:account:index',
    keyOf: (id) => `openai:account:${id}`,
    storage: 'hash',
    decrypt: () => require('./account/openaiAccountService').decrypt,
    fields: [
      { name: 'openaiOauth', kind: 'json' },
      { name: 'accessToken', kind: 'value' },
      { name: 'refreshToken', kind: 'value' }
    ]
  },
  {
    platform: 'openaiResponses',
    indexKey: 'openai_responses_account:index',
    keyOf: (id) => `openai_responses_account:${id}`,
    storage: 'hash',
    decrypt: () => {
      const s = require('./account/openaiResponsesAccountService')
      return (text) => s._decryptSensitiveData(text)
    },
    fields: [{ name: 'apiKey', kind: 'value' }]
  },
  {
    platform: 'openaiCompatible',
    indexKey: 'openai_compatible_account:index',
    keyOf: (id) => `openai_compatible_account:${id}`,
    storage: 'hash',
    decrypt: () => {
      const s = require('./account/openaiCompatibleAccountService')
      return (text) => s._decryptSensitiveData(text)
    },
    fields: [{ name: 'apiKey', kind: 'value' }]
  },
  {
    platform: 'azureOpenai',
    indexKey: 'azure_openai:account:index',
    keyOf: (id) => `azure_openai:account:${id}`,
    storage: 'hash',
    decrypt: () => require('./account/azureOpenaiAccountService').decrypt,
    fields: [{ name: 'apiKey', kind: 'value' }]
  },
  {
    platform: 'ccr',
    indexKey: 'ccr_account:index',
    keyOf: (id) => `ccr_account:${id}`,
    storage: 'hash',
    decrypt: () => {
      const s = require('./account/ccrAccountService')
      return (text) => s._decryptSensitiveData(text)
    },
    fields: [{ name: 'apiKey', kind: 'value' }]
  },
  {
    platform: 'droid',
    indexKey: 'droid:account:index',
    keyOf: (id) => `droid:account:${id}`,
    storage: 'hash',
    decrypt: () => {
      const s = require('./account/droidAccountService')
      return (text) => s._decryptSensitiveData(text)
    },
    fields: [
      { name: 'accessToken', kind: 'value' },
      { name: 'refreshToken', kind: 'value' }
    ]
  },
  {
    // bedrock 的实体是一整个 JSON 字符串，密文藏在 `awsCredentials.{encrypted,iv}` 里；
    // 且 `_decryptAwsCredentials` 是全服唯一**会抛错**的解密入口（失败时 throw
    // 'Credentials decryption failed'），故这里的判据是「抛错 = 失败」而非比对返回值。
    // 这不是 D12 描述的那个坑——它不返回密文原文，catch 是真的进得去。
    platform: 'bedrock',
    indexKey: 'bedrock_account:index',
    keyOf: (id) => `bedrock_account:${id}`,
    storage: 'string',
    decrypt: () => {
      const s = require('./account/bedrockAccountService')
      return (payload) => s._decryptAwsCredentials(payload)
    },
    fields: [
      { name: 'awsCredentials', kind: 'bedrock' },
      { name: 'bearerToken', kind: 'bedrock' }
    ]
  }
]

/**
 * 密文形态分类。MUST 在解密之前做：legacy 形态解不开与密钥无关，
 * 若先解密再判定，会把它误算成密钥失配的证据（7.7）。
 */
function classifyCipher(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return 'empty'
  }
  if (CIPHER_RE.test(raw)) {
    return 'cipher'
  }
  if (LEGACY_RE.test(raw)) {
    return 'legacy'
  }
  // 明文或其它形态（历史未加密数据）：不构成任何一侧的证据
  return 'plaintext'
}

/**
 * 明文合理性判定。返回 'ok' | 'fail'。
 * 第一条 `plain === cipher` 是全函数的重点：两条解密路径失败时都原样返回入参。
 */
function judgePlain(cipher, plain, kind) {
  if (typeof plain !== 'string' || plain.length === 0) {
    return 'fail'
  }
  if (plain === cipher) {
    return 'fail'
  }
  if (kind === 'json') {
    try {
      const parsed = JSON.parse(plain)
      return parsed && typeof parsed === 'object' ? 'ok' : 'fail'
    } catch (e) {
      return 'fail'
    }
  }
  return PRINTABLE_RE.test(plain) ? 'ok' : 'fail'
}

/** 取实体字段值：hash 直接读字段，string 型（bedrock）先 parse 整块 JSON */
async function readEntityFields(client, entityKey, storage) {
  if (storage === 'string') {
    const raw = await client.get(entityKey)
    if (!raw) {
      return null
    }
    try {
      return JSON.parse(raw)
    } catch (e) {
      return null
    }
  }
  const hash = await client.hgetall(entityKey)
  return hash && Object.keys(hash).length > 0 ? hash : null
}

/**
 * 抽一个账户上的探针。返回 { verdict, field } | null（该账户无可用探针）
 */
function probeAccount(entity, spec, decryptFn, legacyHits) {
  for (const field of spec.fields) {
    const raw = entity[field.name]

    if (field.kind === 'bedrock') {
      // `{ encrypted, iv }` 形态才是密文；纯文本凭据（历史数据）不作为证据
      if (!raw || typeof raw !== 'object' || !raw.encrypted || !raw.iv) {
        continue
      }
      try {
        const plain = decryptFn(raw)
        if (plain && typeof plain === 'object') {
          return { verdict: 'ok', field: field.name }
        }
        return { verdict: 'fail', field: field.name }
      } catch (e) {
        return { verdict: 'fail', field: field.name }
      }
    }

    const shape = classifyCipher(raw)
    if (shape === 'legacy') {
      legacyHits.push({ platform: spec.platform, field: field.name })
      continue
    }
    if (shape !== 'cipher') {
      continue
    }
    // 解密自身抛错不作为判据（见文件头第 3 条），但也不能让它掀翻自检
    let plain
    try {
      plain = decryptFn(raw)
    } catch (e) {
      return { verdict: 'fail', field: field.name }
    }
    return { verdict: judgePlain(raw, plain, field.kind), field: field.name }
  }
  return null
}

/**
 * 当前密钥的指纹。MUST NOT 用 `sha256(ENCRYPTION_KEY)`——那正是
 * `bedrockAccountService.js:668` 的 `_encryptionKeyCache`，即 bedrock 实际使用的
 * AES-256 密钥，把它写进日志等于把一把可用密钥写进日志（D12）。
 * 这里用独立 salt 派生 16 字节后再截断，既不等于任何平台的密钥，也够用来区分两台机器。
 */
let _fingerprintCache = null
function keyFingerprint() {
  // 记忆化：`ENCRYPTION_KEY` 在进程运行期不会变，而 scryptSync 是 CPU 密集的，
  // 存储健康面板又会按定时轮询取这个值（D14），每次现算等于给面板加一份固定开销。
  // 失败结果（'unavailable'）**不缓存** —— 那通常意味着配置有问题，修好后不该还要重启。
  if (_fingerprintCache) {
    return _fingerprintCache
  }
  try {
    _fingerprintCache = crypto
      .scryptSync(config.security.encryptionKey, FINGERPRINT_SALT, 16)
      .toString('hex')
      .slice(0, FINGERPRINT_HEX_LEN)
    return _fingerprintCache
  } catch (e) {
    return 'unavailable'
  }
}

/**
 * 抽样试解并判定。只读，不抛错（内部异常一律降级为 inconclusive）。
 * @returns {Promise<Object>} 判定结果摘要（便于测试与将来的接口复用）
 */
async function check() {
  const startedAt = Date.now()
  const result = {
    verdict: 'inconclusive', // 'consistent' | 'inconsistent' | 'inconclusive'
    sampled: 0,
    okCount: 0,
    failCount: 0,
    platforms: [], // [{ platform, verdict, ok, fail, accounts, fields }]
    legacy: [],
    durationMs: 0
  }

  let client
  try {
    client = redis.getClientSafe()
  } catch (e) {
    logger.warn(`🔑 Encryption key self-check skipped: Redis unavailable (${e.message})`)
    result.durationMs = Date.now() - startedAt
    return result
  }

  const legacyHits = []

  for (const spec of PLATFORMS) {
    let decryptFn
    try {
      decryptFn = spec.decrypt()
    } catch (e) {
      logger.warn(`🔑 Encryption key self-check: cannot load ${spec.platform} decryptor`)
      continue
    }

    let ids
    try {
      // 只读：MUST NOT 用 getAllIdsByIndex（它会写 `:empty` 标记并回填索引）
      ids = await client.smembers(spec.indexKey)
    } catch (e) {
      logger.warn(`🔑 Encryption key self-check: read ${spec.indexKey} failed: ${e.message}`)
      continue
    }
    if (!ids || ids.length === 0) {
      continue
    }

    const platformStat = {
      platform: spec.platform,
      verdict: 'inconclusive',
      ok: 0,
      fail: 0,
      fields: []
    }
    // 第一轮 SAMPLE_LIMIT 个；只出现「1 次失败、0 次成功」时才追加抽样到 EXTENDED_LIMIT
    // （7.6：单次失败 MUST NOT 直接定论）
    let budget = Math.min(ids.length, SAMPLE_LIMIT)
    for (let i = 0; i < budget && i < ids.length; i++) {
      const entityKey = spec.keyOf(ids[i])
      let entity
      try {
        entity = await readEntityFields(client, entityKey, spec.storage)
      } catch (e) {
        continue
      }
      if (!entity) {
        continue
      }

      const probe = probeAccount(entity, spec, decryptFn, legacyHits)
      if (!probe) {
        continue
      }

      result.sampled++
      if (probe.verdict === 'ok') {
        platformStat.ok++
        result.okCount++
      } else {
        platformStat.fail++
        result.failCount++
        platformStat.fields.push({
          accountId: ids[i],
          accountName: typeof entity.name === 'string' ? entity.name : null,
          field: probe.field
        })
      }

      if (platformStat.ok > 0) {
        // 该平台已被证明可解，不必再抽
        break
      }
      if (platformStat.fail === 1 && budget < Math.min(ids.length, EXTENDED_LIMIT)) {
        budget = Math.min(ids.length, EXTENDED_LIMIT)
      }
    }

    if (platformStat.ok > 0) {
      platformStat.verdict = 'consistent'
    } else if (platformStat.fail >= 2) {
      platformStat.verdict = 'inconsistent'
    } else if (platformStat.fail === 1) {
      // 全平台只找到一条密文且它解不开：证据不足，宁可漏报不可误报
      platformStat.verdict = 'suspect'
    }

    if (platformStat.ok > 0 || platformStat.fail > 0) {
      result.platforms.push(platformStat)
    }
  }

  result.legacy = legacyHits
  const bad = result.platforms.filter((p) => p.verdict === 'inconsistent')
  const suspects = result.platforms.filter((p) => p.verdict === 'suspect')
  const good = result.platforms.filter((p) => p.verdict === 'consistent')

  if (bad.length > 0) {
    result.verdict = 'inconsistent'
  } else if (good.length > 0) {
    result.verdict = 'consistent'
  }
  result.durationMs = Date.now() - startedAt

  // ── 日志。MUST NOT 输出密钥明文、密文原值、解密所得明文（含片段）──────────
  if (result.verdict === 'inconsistent') {
    const detail = bad
      .map((p) => `${p.platform}(失败 ${p.fail} 条: ${p.fields.map((f) => f.field).join(',')})`)
      .join('、')
    const alsoGood =
      good.length > 0 ? ` 另有可正常解密的平台：${good.map((p) => p.platform).join('、')}。` : ''
    const alsoSuspect =
      suspects.length > 0
        ? ` 另有 ${suspects.map((p) => p.platform).join('、')} 各仅 1 条密文且同样未解出，样本不足以单独定论但指向同一结论。`
        : ''
    logger.error(
      `🔑 ENCRYPTION_KEY 与库中已有密文不匹配：${detail}。当前密钥指纹 ${keyFingerprint()}。` +
        `这些账户会表现为「可见但上游 401」。跨机迁移 MUST 在建立任何数据之前把 ` +
        `ENCRYPTION_KEY 设为源机的值，本次不支持跨密钥重加密。${alsoSuspect}${alsoGood}`
    )
  } else if (result.verdict === 'consistent') {
    logger.info(
      `🔑 ENCRYPTION_KEY self-check passed (抽样 ${result.sampled} 条，平台 ` +
        `${good.map((p) => p.platform).join('、')}，${result.durationMs}ms，指纹 ${keyFingerprint()})`
    )
  } else if (suspects.length > 0) {
    // 有失败但样本不足以定论：warn 而非 error（误报几次之后这条日志就没人看了）
    logger.warn(
      `🔑 ENCRYPTION_KEY self-check inconclusive：${suspects
        .map((p) => p.platform)
        .join('、')} 各仅有 1 条密文且未能解出合理明文，样本不足以判定密钥失配，` +
        `MUST 结合上游是否 401 人工确认`
    )
  } else {
    logger.info(
      `🔑 ENCRYPTION_KEY self-check skipped：库中暂无可抽样的密文字段（新装实例的正常状态）`
    )
  }

  if (legacyHits.length > 0) {
    const grouped = [...new Set(legacyHits.map((h) => `${h.platform}.${h.field}`))].join('、')
    logger.warn(
      `🔑 发现 ${legacyHits.length} 处 legacy 加密形态（裸 hex、无 iv 前缀）：${grouped}。` +
        `该形态在当前 Node 版本上无论密钥是否正确都解不开，已排除在密钥一致性判定之外，` +
        `MUST 通过重新录入凭据来消除`
    )
  }

  return result
}

module.exports = {
  check,
  // 正式对外出口：备份导出侧（D14）声明的密钥指纹 MUST 复用本函数。
  // 两处各写一份派生的话，salt 一漂移，备份里的指纹就与启动自检日志里那行不相等，
  // 运维会据此误判「密钥被换过」—— 一个纯由实现细节造出来的假故障。
  keyFingerprint,
  // 派生方式的可展示描述（不含密钥）。备份导出侧写进 metadata 用它，不另抄字面量。
  FINGERPRINT_ALGORITHM,
  // 导出供测试用（判定逻辑是本服务唯一容易写错的地方）
  _internal: { classifyCipher, judgePlain, keyFingerprint, PLATFORMS, SAMPLE_LIMIT, EXTENDED_LIMIT }
}
