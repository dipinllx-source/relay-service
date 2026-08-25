/**
 * 🗄️ Backup Service
 *
 * 为「存储健康」页面提供备份的 Web 端导出/导入能力。
 * 范围：API Keys + 各类账户 + tags + 管理员凭据。
 * 密钥策略：保留加密形态（原样导出/导入，与当前 encryptionKey 绑定，同环境可直接恢复）。
 * 密钥指纹（v2.3）：metadata.encryption 声明本机密钥指纹与可读提示，导入时比对并在
 *   不一致时登记告警（只提示不拦，D14/D15）；写进文件的只有指纹，绝不含密钥本身。
 * 导入策略：跳过冲突（已存在的 key 不覆盖）。
 *
 * 实体类型（v2.1）：账户实体按 storageType 分流——
 *   - hash（10 类）：hgetall 导出为 { __key, ...fields }，导入 hset 写回
 *   - string（bedrock）：get 导出为 { __key, __type: 'string', value }，导入 set 写回
 * storageType 表与 src/storage/metadataSync.js 的 ACCOUNT_GROUPS 保持一致。
 * 单实体读写失败被隔离（warn + errors 计数），不会使整个导出/导入失败。
 *
 * SQLite 贯通：METADATA_BACKEND=sqlite 时导入完成后同步触发一次
 * metadataSync.reconcileAll()，使还原数据立即落入 SQLite；随后清理各索引
 * 的 :empty 空标记与 read-through 缓存键（account:cache:* / apikey:cache:*）。
 */

const fs = require('fs')
const path = require('path')
const redis = require('../models/redis')
const logger = require('../utils/logger')
const config = require('../../config/config')
// 分组子系统的 key 形状复用 accountGroupService 单例上的常量（GROUPS_KEY /
// GROUP_PREFIX / GROUP_MEMBERS_PREFIX / REVERSE_INDEX_PREFIX /
// REVERSE_INDEX_MIGRATED_KEY），MUST NOT 在此另抄字面量 —— 一旦两边漂移，
// 备份会静默漏掉一类 key。
const accountGroupService = require('./accountGroupService')
// 密钥指纹（D14）MUST 复用自检服务的派生函数，MUST NOT 在此另写一份 —— salt 一漂移，
// 备份里声明的指纹就与启动自检日志里那行不相等，运维会据此误判「密钥被换过」。
const encryptionKeyCheckService = require('./encryptionKeyCheckService')

// 2.2 起备份含 data.groups（分组定义 / 索引 / 成员 / 反向索引）。
// 2.3 起 metadata 含 encryption 段（密钥指纹 + 派生方式 + 可读提示，D14）。
// 旧代码读 2.3 备份时会忽略这两段，等价于其当前行为，因此回滚是安全的。
const BACKUP_VERSION = '2.3'

// 导出提示（写进 metadata.encryption.notice）。
// MUST 把两类凭据分开讲：ENCRYPTION_KEY 既是账户凭据的可逆加密密钥，又是 API Key 的
// 哈希盐（sha256(明文 + KEY)，明文从不落库），密钥不一致时二者的补救办法完全不同。
// 只写「需要同一 ENCRYPTION_KEY」会让人以为把密钥改回去就万事大吉 —— 改得回去当然
// 可以，改不回去（目标机已在别的密钥下建了数据）时这两类的下场是不一样的。
const KEY_NOTICE =
  '本备份中的账户凭据是用导出实例的 ENCRYPTION_KEY 加密的，API Key 则以 ' +
  'sha256(明文 + ENCRYPTION_KEY) 存储。目标实例的密钥指纹与上面的 keyFingerprint 不一致时：' +
  '① 账户凭据解不开，表现为上游调用 401（可在目标实例重新授权或重新录入凭据）；' +
  '② 已发放的 API Key 算出的哈希也不同，在中转入口就会 401，而明文既不在备份里也不在库里，' +
  '无法恢复，只能重新发放。唯一支持的迁移方式是在目标实例建立任何数据之前，' +
  '把 ENCRYPTION_KEY 设为源实例的值，然后再导入本备份；本服务不提供跨密钥重加密。'

// 导入侧指纹不一致时的告警文案，口径与 KEY_NOTICE 一致（同样分开讲两类凭据）
const KEY_MISMATCH_MESSAGE =
  '备份声明的 ENCRYPTION_KEY 指纹与本实例不一致：备份中的账户凭据在本实例解不开' +
  '（表现为上游调用 401，需在本实例重新授权或重新录入），备份中已发放的 API Key 哈希也算不出来，' +
  '在中转入口就会 401 且无法恢复、只能重新发放。若本实例尚未建立数据，' +
  '正确做法是把 ENCRYPTION_KEY 改为源实例的值后重新导入。本次导入已照常完成，未因此拦截。'

// 需要备份的「账户类」实体前缀（与各账户服务 ACCOUNT_KEY_PREFIX 保持一致）
// storageType 与 src/storage/metadataSync.js 逐字对齐：
//   hash   → 实体为 Redis hash（hgetall / hset）
//   string → 实体为 JSON 字符串（get / set），目前仅 bedrock
const ACCOUNT_GROUPS = [
  { name: 'claude', prefix: 'claude:account:', storageType: 'hash' },
  { name: 'claudeConsole', prefix: 'claude_console_account:', storageType: 'hash' },
  { name: 'gemini', prefix: 'gemini_account:', storageType: 'hash' },
  { name: 'geminiApi', prefix: 'gemini_api_account:', storageType: 'hash' },
  { name: 'openai', prefix: 'openai:account:', storageType: 'hash' },
  { name: 'openaiResponses', prefix: 'openai_responses_account:', storageType: 'hash' },
  { name: 'openaiCompatible', prefix: 'openai_compatible_account:', storageType: 'hash' },
  { name: 'azureOpenai', prefix: 'azure_openai:account:', storageType: 'hash' },
  { name: 'ccr', prefix: 'ccr_account:', storageType: 'hash' },
  { name: 'bedrock', prefix: 'bedrock_account:', storageType: 'string' },
  { name: 'droid', prefix: 'droid:account:', storageType: 'hash' }
]

// 判断某个 key 是否为「实体 key」而非派生/索引/运行时 key。
// 实体 key 形如 `${prefix}${uuid}`，去掉前缀后不应再包含冒号，且不是 index/empty 等保留名。
function isEntityKey(fullKey, prefix) {
  const rest = fullKey.slice(prefix.length)
  if (!rest) {
    return false
  }
  if (rest.includes(':')) {
    return false
  }
  if (rest === 'index' || rest === 'empty' || rest === 'hash_map') {
    return false
  }
  return true
}

async function scanEntityKeys(client, prefix) {
  const all = await client.keys(`${prefix}*`)
  return all.filter((k) => isEntityKey(k, prefix))
}

// 读取一组实体（按 storageType 分流），单实体失败隔离。
// 返回 { items, errors }：
//   hash   → { __key, ...fields }
//   string → { __key, __type: 'string', value }
async function dumpEntityGroup(client, keys, storageType) {
  const items = []
  let errors = 0
  for (const key of keys) {
    try {
      if (storageType === 'string') {
        // eslint-disable-next-line no-await-in-loop
        const value = await client.get(key)
        if (value !== null && value !== undefined && value !== '') {
          items.push({ __key: key, __type: 'string', value })
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        const data = await client.hgetall(key)
        if (data && Object.keys(data).length > 0) {
          items.push({ __key: key, ...data })
        }
      }
    } catch (e) {
      errors++
      logger.warn(`backup export: dump ${key} (${storageType}) failed: ${e.message}`)
    }
  }
  return { items, errors }
}

/**
 * 导出全部备份数据（保留加密形态，不脱敏）。
 * @param {Object} opts { includeApiKeys, includeAccounts, includeAdmins }
 */
async function exportBackup(opts = {}) {
  const includeApiKeys = opts.includeApiKeys !== false
  const includeAccounts = opts.includeAccounts !== false
  const includeAdmins = opts.includeAdmins !== false

  const client = redis.getClient()
  if (!client) {
    throw new Error('Redis client unavailable')
  }

  const backup = {
    metadata: {
      version: BACKUP_VERSION,
      exportDate: new Date().toISOString(),
      sanitized: false,
      generatedBy: 'web',
      backend: config.metadata.backend,
      scope: { apiKeys: includeApiKeys, accounts: includeAccounts, admins: includeAdmins },
      // 🔑 密钥指纹声明（D14）：让「这份文件的密文绑在哪把密钥上」成为文件自带的、
      // 可核对的事实 —— 否则运维要核对，只能把两台机 .env 里的 32 个字符拿出来肉眼比。
      // 写进文件的只有指纹，MUST NOT 出现密钥明文或其任何未加盐摘要（尤其
      // MUST NOT 用 sha256(KEY)：那正是 bedrock 账户实际使用的 AES-256 密钥）。
      encryption: {
        keyFingerprint: encryptionKeyCheckService.keyFingerprint(),
        algorithm: encryptionKeyCheckService.FINGERPRINT_ALGORITHM,
        notice: KEY_NOTICE
      }
    },
    data: {},
    errors: { apiKeys: 0, accounts: 0, tags: 0, groups: 0 }
  }

  // API Keys（包含 apikey:hash_map 以保证哈希映射可用）
  if (includeApiKeys) {
    const allApiKeys = await client.keys('apikey:*')
    const entityKeys = allApiKeys.filter(
      (k) => k === 'apikey:hash_map' || isEntityKey(k, 'apikey:')
    )
    const { items, errors } = await dumpEntityGroup(client, entityKeys, 'hash')
    backup.data.apiKeys = items
    backup.errors.apiKeys += errors

    // tags：全局 tag 集合 + 每个 tag 的 keyId 索引集合
    const tags = { all: [], byTag: {} }
    try {
      tags.all = await client.smembers('apikey:tags:all')
      for (const tag of tags.all) {
        try {
          // eslint-disable-next-line no-await-in-loop
          tags.byTag[tag] = await client.smembers(`apikey:tag:${tag}`)
        } catch (e) {
          backup.errors.tags++
          logger.warn(`backup export: dump apikey:tag:${tag} failed: ${e.message}`)
        }
      }
    } catch (e) {
      backup.errors.tags++
      logger.warn(`backup export: dump apikey:tags:all failed: ${e.message}`)
    }
    backup.data.tags = tags
  }

  // 账户（各类型，按 storageType 分流）
  if (includeAccounts) {
    backup.data.accounts = {}
    for (const group of ACCOUNT_GROUPS) {
      // eslint-disable-next-line no-await-in-loop
      const keys = await scanEntityKeys(client, group.prefix)
      // eslint-disable-next-line no-await-in-loop
      const { items, errors } = await dumpEntityGroup(client, keys, group.storageType)
      backup.data.accounts[group.name] = items
      backup.errors.accounts += errors
    }
  }

  // 账户分组子系统（D3）：分组定义 + 分组 id 索引 + 成员集合 + 反向索引。
  // 账户实体的 groupId / groupIds 指向这里，此前备份不含本段，跨实例还原后这些
  // 引用全部悬空 —— 账户在后台一编辑保存就 500。随 includeAccounts 一同导出。
  //
  // account_groups_reverse:migrated MUST NOT 纳入备份（决策 D5）：还原该标记会让
  // 目标实例启动时跳过 ensureReverseIndexes() 的回填，一旦本次还原的反向索引不
  // 完整，就永久不再补齐。宁可让幂等的回填多跑一次。
  if (includeAccounts) {
    const groups = { index: [], definitions: [], members: {}, reverse: {} }
    try {
      groups.index = await client.smembers(accountGroupService.GROUPS_KEY)
      for (const gid of groups.index) {
        try {
          const defKey = `${accountGroupService.GROUP_PREFIX}${gid}`
          // eslint-disable-next-line no-await-in-loop
          const def = await client.hgetall(defKey)
          if (def && Object.keys(def).length > 0) {
            groups.definitions.push({ __key: defKey, ...def })
          }
          // eslint-disable-next-line no-await-in-loop
          const members = await client.smembers(`${accountGroupService.GROUP_MEMBERS_PREFIX}${gid}`)
          if (members.length > 0) {
            groups.members[gid] = members
          }
        } catch (e) {
          backup.errors.groups++
          logger.warn(`backup export: dump group ${gid} failed: ${e.message}`)
        }
      }

      // 反向索引 account_groups_reverse:<platform>:<accountId>。
      // migrated 标记只有一段、且是 string，既不该备份也不能 smembers。
      const reverseKeys = (
        await redis.scanKeys(`${accountGroupService.REVERSE_INDEX_PREFIX}*`)
      ).filter((k) => k !== accountGroupService.REVERSE_INDEX_MIGRATED_KEY)
      for (const key of reverseKeys) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const gids = await client.smembers(key)
          if (gids.length > 0) {
            groups.reverse[key] = gids
          }
        } catch (e) {
          backup.errors.groups++
          logger.warn(`backup export: dump ${key} failed: ${e.message}`)
        }
      }
    } catch (e) {
      backup.errors.groups++
      logger.warn(`backup export: dump account groups failed: ${e.message}`)
    }
    backup.data.groups = groups
  }

  // 管理员凭据：真实源为 data/init.json，运行时缓存为 session:admin_credentials
  if (includeAdmins) {
    const admins = { initJson: null, sessionCredentials: null }
    try {
      const initPath = path.join(__dirname, '../../data/init.json')
      if (fs.existsSync(initPath)) {
        admins.initJson = JSON.parse(fs.readFileSync(initPath, 'utf8'))
      }
    } catch (e) {
      logger.warn(`backup: read init.json failed: ${e.message}`)
    }
    try {
      const cred = await client.hgetall('session:admin_credentials')
      if (cred && Object.keys(cred).length > 0) {
        admins.sessionCredentials = cred
      }
    } catch (e) {
      logger.warn(`backup: read admin_credentials failed: ${e.message}`)
    }
    backup.data.admins = admins
  }

  return backup
}

/**
 * 导入备份（跳过冲突：已存在的 key/凭据不覆盖）。
 * 兼容 2.0（无 __type，全按 hash）与 2.1（string 实体带 __type）。
 * @returns {Object} 统计信息
 */
async function importBackup(backup, _opts = {}) {
  if (!backup || typeof backup !== 'object' || !backup.metadata || !backup.data) {
    throw new Error('Invalid backup file format')
  }
  if (backup.metadata.sanitized) {
    throw new Error('Backup is sanitized (secrets redacted); cannot be used to restore')
  }

  const client = redis.getClient()
  if (!client) {
    throw new Error('Redis client unavailable')
  }

  const stats = {
    apiKeys: { imported: 0, skipped: 0, errors: 0 },
    accounts: { imported: 0, skipped: 0, errors: 0 },
    tags: { imported: 0, skipped: 0, errors: 0 },
    admins: { imported: 0, skipped: 0, errors: 0 },
    // ── 以下为本次新增（D11）；旧读取路径缺这些字段不报错 ──────────────
    groups: {
      definitions: { imported: 0, skipped: 0, errors: 0 },
      members: { added: 0 },
      reverse: { added: 0 }
    },
    indexes: {}, // { '<前缀>index': <补写条数>, 'apikey:idx': <登记进 apikey 索引族的条数> }
    hashMap: { imported: 0, skipped: 0, skippedDeleted: 0, errors: 0 },
    warnings: [] // [{ type, message, ...上下文 }]
  }

  // 统一的告警登记口，避免各处自行拼结构
  function addWarning(type, message, context = {}) {
    stats.warnings.push({ type, message, ...context })
  }

  // 🔑 密钥指纹比对（D14 / D15）：**只提示不拦**。
  //
  // 判据 MUST 是「备份是否声明了可用指纹」，MUST NOT 由 metadata.version 推断 ——
  // keyFingerprint() 在派生失败时返回 'unavailable'，那时最新版本的产物同样没有可比对的指纹。
  //
  // 为什么不拦：明知密钥不同、只想捞回 tags / 分组结构 / 管理员凭据，是正当操作，
  // 闸门会把它一起堵死（前置闸门方案已在 design「否决二」被否，边界见 D15）。
  // 为什么一致时一条日志都不打：正常迁移是主流路径，主流路径上多一条告警，
  // 几次之后告警就整体失效了（与自检同一条噪音控制原则）。
  const localKeyFingerprint = encryptionKeyCheckService.keyFingerprint()
  const backupKeyFingerprint = backup.metadata.encryption?.keyFingerprint
  if (
    !backupKeyFingerprint ||
    backupKeyFingerprint === 'unavailable' ||
    localKeyFingerprint === 'unavailable'
  ) {
    logger.info(
      `🔑 backup import: 跳过密钥指纹比对（备份未声明指纹或指纹不可用；${
        backup.metadata.version || '未知'
      } 格式的备份本就没有这一段，属正常情况）`
    )
  } else if (backupKeyFingerprint !== localKeyFingerprint) {
    addWarning('encryption-key-fingerprint-mismatch', KEY_MISMATCH_MESSAGE, {
      backupKeyFingerprint,
      localKeyFingerprint
    })
    logger.warn(
      `🔑 backup import: 备份声明的密钥指纹 ${backupKeyFingerprint} 与本实例 ${localKeyFingerprint} 不一致 —— ` +
        '备份中的账户凭据在本实例解不开（上游 401），已发放的 API Key 也无法鉴权且只能重新发放。' +
        '导入未被拦截，仍照常写入。'
    )
  }

  // 本次导入中索引写入失败的条数（收尾据此决定是否删 apikey:index:version 兜底）
  let indexErrorCount = 0

  // 通用：写回一组实体（跳过已存在；按 __type 分流写入方式）
  //
  // opts（可选，不传时行为与旧版逐字节一致——tags / admins 通道不受影响）：
  //   prefix       实体 key 前缀，用于从 Redis key 提取 id
  //   indexWriter  async (id, item) => void，把该实体登记进它所属的索引
  //                （D1：导入路径此前只写实体不写索引）。各通道索引形状不同：
  //                账户侧是 `<前缀>index` 单个集合，API Key 侧是 apikey:idx:* /
  //                apikey:set:* 索引族，故由调用方给出写法而非在此硬编码。
  //   indexLabel   索引补写的计数标签，累加进 indexStats[indexLabel]
  //   indexStats   计数容器
  //   sanitize     (item) => item，写入前净化实体字段（D3b 的悬空 groupId 剥离）。
  //                MUST 返回新对象而不是原地改 item——备份对象在导入后仍会被
  //                summarize 等读取路径复用。
  async function restoreEntityItems(items, bucket, opts = {}) {
    if (!Array.isArray(items)) {
      return
    }
    const { prefix, indexWriter, indexLabel, indexStats, sanitize } = opts
    for (const rawItem of items) {
      const key = rawItem && rawItem.__key
      if (!key || typeof key !== 'string') {
        bucket.errors++
        continue
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const exists = await client.exists(key)
        if (exists) {
          bucket.skipped++
          continue
        }
        // 净化排在 exists 之后：被跳过的实体不会被写入，也就无需（更不该）
        // 为它报一条「已解除绑定」的告警。
        const item = sanitize ? sanitize(rawItem) : rawItem
        if (item.__type === 'string') {
          // string 实体（bedrock）：value 必须是 JSON 字符串，set 原样写回
          if (typeof item.value !== 'string' || !item.value) {
            bucket.errors++
            logger.warn(`backup import: string entity ${key} has invalid value`)
            continue
          }
          // eslint-disable-next-line no-await-in-loop
          await client.set(key, item.value)
        } else {
          const fields = {}
          for (const [k, v] of Object.entries(item)) {
            if (k === '__key' || k === '__type') {
              continue
            }
            fields[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v
          }
          if (Object.keys(fields).length === 0) {
            bucket.skipped++
            continue
          }
          // eslint-disable-next-line no-await-in-loop
          await client.hset(key, fields)
        }
        bucket.imported++

        // ── 索引补写（D1）─────────────────────────────────────────────
        // 正常创建路径写 hset + 索引登记，导入路径此前只写了 hset，
        // 于是导入的实体成为库里的孤儿键：数据在 Redis，管理台看不见。
        // id MUST 从 Redis key 提取（与 metadataSync 的「以 Redis key 为权威 id」一致），
        // MUST NOT 读实体内的 id 字段——备份中两者不一致时会把索引写错。
        if (indexWriter && prefix && key.startsWith(prefix)) {
          const id = key.slice(prefix.length)
          if (id) {
            try {
              // eslint-disable-next-line no-await-in-loop
              await indexWriter(id, item)
              if (indexStats && indexLabel) {
                indexStats[indexLabel] = (indexStats[indexLabel] || 0) + 1
              }
            } catch (e) {
              // 索引写入失败会精确重建本次缺陷的形态，MUST NOT 降级为 warn（D2）。
              // 不回滚实体：实体在索引不在可由启动重建自愈，实体丢失不可自愈。
              bucket.errors++
              indexErrorCount++
              logger.error(`backup import: index write failed for ${key}: ${e.message}`)
            }
          }
        }
      } catch (e) {
        logger.error(`backup import: failed for ${key}: ${e.message}`)
        bucket.errors++
      }
    }
  }

  // ── apikey:hash_map 字段级合并（D2 / D7）────────────────────────────
  // 导出侧把它当实体收在 data.apiKeys 里，导入侧若也走实体通道，
  // exists('apikey:hash_map') 就决定整张映射表的命运——目标实例只要曾创建过
  // 任何一个 API Key 这个 key 就必然存在，于是全部 hash → keyId 映射被丢弃，
  // 还原的 key 直到下次重启（rebuildHashMap 回填）之前一律 401。
  //
  // 本函数的调用点 MUST 在 API Key 实体写回之后（见下方注释）：它逐条复核
  // `exists(apikey:<keyId>)`，实体还没写就等于把每条映射都判成「实体不存在」。
  async function restoreHashMap(item) {
    for (const [hash, keyId] of Object.entries(item)) {
      if (hash === '__key' || hash === '__type') {
        continue
      }
      if (typeof keyId !== 'string' || !keyId) {
        stats.hashMap.errors++
        continue
      }
      try {
        // 已存在的字段 MUST NOT 覆盖：同一 hash 指向不同 keyId 意味着两个实例上
        // 同一把明文 key 对应不同记录，覆盖会把鉴权指向错误的配额与权限。
        // eslint-disable-next-line no-await-in-loop
        const already = await client.hexists('apikey:hash_map', hash)
        if (already) {
          stats.hashMap.skipped++
          continue
        }
        // eslint-disable-next-line no-await-in-loop
        const entityExists = await client.exists(`apikey:${keyId}`)
        if (!entityExists) {
          stats.hashMap.skipped++
          addWarning(
            'hashmap-entity-missing',
            `哈希映射指向的 API Key 实体 ${keyId} 不存在，已跳过该映射`,
            { keyId }
          )
          continue
        }
        // 已软删除的 key MUST NOT 重新获得可鉴权映射（与 E1 的不变式对接）
        // eslint-disable-next-line no-await-in-loop
        const isDeleted = await client.hget(`apikey:${keyId}`, 'isDeleted')
        if (isDeleted === 'true') {
          stats.hashMap.skippedDeleted++
          addWarning(
            'hashmap-skipped-deleted',
            `API Key ${keyId} 已被删除，备份中的哈希映射未写回`,
            { keyId }
          )
          continue
        }
        // eslint-disable-next-line no-await-in-loop
        await client.hset('apikey:hash_map', hash, keyId)
        stats.hashMap.imported++
      } catch (e) {
        stats.hashMap.errors++
        logger.error(`backup import: hash_map field for ${keyId} failed: ${e.message}`)
      }
    }
  }

  // ── 分组子系统还原（D3 / D6）─────────────────────────────────────────
  // MUST 排在账户之前：账户实体的 groupId 指向这里，先还原分组才能让这些引用
  // 落地时就是有效的（也是 D8「剥离判据只看备份是否含 groups 段」的前提）。
  //
  // 三类 key 的冲突策略不同：分组定义是实体（跳过冲突，不覆盖目标实例可能已改过
  // 名/策略的定义）；分组 id 索引、成员集合、反向索引都是集合（按成员合并，跳过
  // 会导致「分组存在但没成员」这种更糟的半残状态）。
  const hasGroups = !!(backup.data.groups && typeof backup.data.groups === 'object')
  if (hasGroups) {
    const g = backup.data.groups

    // 分组定义写回前先记下哪些 gid 在目标实例已存在 —— 定义会被 exists 跳过，
    // 但其成员集合仍会合并，这个不对称必须能报出来（5.9 / D6）。
    const preExistingGids = new Set()
    const definitions = Array.isArray(g.definitions) ? g.definitions : []
    for (const item of definitions) {
      const key = item && item.__key
      if (typeof key !== 'string' || !key.startsWith(accountGroupService.GROUP_PREFIX)) {
        continue
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        if (await client.exists(key)) {
          preExistingGids.add(key.slice(accountGroupService.GROUP_PREFIX.length))
        }
      } catch (e) {
        logger.warn(`backup import: probe ${key} failed: ${e.message}`)
      }
    }

    // 分组 id 索引：成员合并
    if (Array.isArray(g.index) && g.index.length > 0) {
      try {
        await client.sadd(accountGroupService.GROUPS_KEY, g.index)
      } catch (e) {
        stats.groups.definitions.errors++
        logger.error(`backup import: merge ${accountGroupService.GROUPS_KEY} failed: ${e.message}`)
      }
    }

    // 分组定义：实体语义，跳过冲突（无索引需登记）
    await restoreEntityItems(definitions, stats.groups.definitions)

    // 成员集合：成员合并
    if (g.members && typeof g.members === 'object') {
      for (const [gid, members] of Object.entries(g.members)) {
        if (!Array.isArray(members) || members.length === 0) {
          continue
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          const added = await client.sadd(
            `${accountGroupService.GROUP_MEMBERS_PREFIX}${gid}`,
            members
          )
          stats.groups.members.added += added
          if (added > 0 && preExistingGids.has(gid)) {
            addWarning(
              'group-members-merged-into-existing',
              `分组 ${gid} 在本实例已存在（定义未覆盖），但备份中的 ${added} 个成员已被合并进该分组`,
              { groupId: gid, added }
            )
          }
        } catch (e) {
          stats.groups.definitions.errors++
          logger.error(`backup import: merge members of ${gid} failed: ${e.message}`)
        }
      }
    }

    // 反向索引：成员合并。migrated 标记即使出现在旧备份里也 MUST NOT 写回（D5）
    if (g.reverse && typeof g.reverse === 'object') {
      for (const [key, gids] of Object.entries(g.reverse)) {
        if (key === accountGroupService.REVERSE_INDEX_MIGRATED_KEY) {
          continue
        }
        if (!Array.isArray(gids) || gids.length === 0) {
          continue
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          const added = await client.sadd(key, gids)
          stats.groups.reverse.added += added
        } catch (e) {
          stats.groups.definitions.errors++
          logger.error(`backup import: merge ${key} failed: ${e.message}`)
        }
      }
    }
  }

  // ── 悬空 groupId 剥离（D3b / D3c）────────────────────────────────────
  // 2.0 / 2.1 备份不含分组数据，但账户实体里仍带着 groupId / groupIds，指向的
  // 分组在目标实例根本不存在。留着它，账户会被调度到一个空分组，且后台编辑保存
  // 时 accountGroupService.updateGroup() 抛「分组不存在」冒泡成 500。
  //
  // 判据 MUST 是「备份是否含 groups 段」，MUST NOT 是「该分组当前是否存在」：
  // 分组先于账户写回（D8），用后者判会把刚刚还原的分组认成"存在"，于是真正的
  // 悬空引用一个都发现不了。
  const GROUP_REF_FIELDS = ['groupId', 'groupIds']

  function describeGroupRef(source) {
    const ref = {}
    for (const f of GROUP_REF_FIELDS) {
      if (source[f] !== undefined && source[f] !== null && source[f] !== '') {
        ref[f] = source[f]
      }
    }
    return ref
  }

  function stripDanglingGroupRefs(item) {
    const key = item.__key

    // string 实体（bedrock）：分组引用在 JSON 里，parse 失败就原样放过
    // （宁可留下一个悬空引用，也不能把一个存不进去的坏 JSON 写回 Redis）
    if (item.__type === 'string') {
      let parsed
      try {
        parsed = JSON.parse(item.value)
      } catch (e) {
        logger.warn(`backup import: cannot parse ${key} to strip group refs: ${e.message}`)
        return item
      }
      if (!parsed || typeof parsed !== 'object') {
        return item
      }
      const ref = describeGroupRef(parsed)
      if (Object.keys(ref).length === 0) {
        return item
      }
      const cleanedValue = { ...parsed }
      for (const f of GROUP_REF_FIELDS) {
        delete cleanedValue[f]
      }
      addWarning(
        'dangling-group-stripped',
        `账户 ${parsed.name || key} 的分组引用已解除绑定（备份为 ${backup.metadata.version} 格式，不含分组数据，该分组在本实例不存在）`,
        { accountKey: key, accountName: parsed.name || null, ...ref }
      )
      return { ...item, value: JSON.stringify(cleanedValue) }
    }

    const ref = describeGroupRef(item)
    if (Object.keys(ref).length === 0) {
      return item
    }
    const cleaned = { ...item }
    for (const f of GROUP_REF_FIELDS) {
      delete cleaned[f]
    }
    addWarning(
      'dangling-group-stripped',
      `账户 ${item.name || key} 的分组引用已解除绑定（备份为 ${backup.metadata.version} 格式，不含分组数据，该分组在本实例不存在）`,
      { accountKey: key, accountName: item.name || null, ...ref }
    )
    return cleaned
  }

  // 账户（索引 key 由 ACCOUNT_GROUPS 的 prefix 派生，MUST NOT 另行硬编码）
  // 排在分组之后、API Key 之前（D8）。
  if (backup.data.accounts && typeof backup.data.accounts === 'object') {
    for (const group of ACCOUNT_GROUPS) {
      const indexKey = `${group.prefix}index`
      // eslint-disable-next-line no-await-in-loop
      await restoreEntityItems(backup.data.accounts[group.name], stats.accounts, {
        prefix: group.prefix,
        indexLabel: indexKey,
        indexStats: stats.indexes,
        // redisClient.addToIndex 内含 sadd <前缀>index + del <前缀>index:empty
        indexWriter: (id) => redis.addToIndex(indexKey, id),
        // 含 groups 段的 2.2 备份 MUST NOT 剥离——分组已随备份一并还原
        sanitize: hasGroups ? undefined : stripDanglingGroupRefs
      })
    }
  }

  // API Keys（hash_map 先摘出，其余走实体通道并登记进 apikey 索引族）
  if (backup.data.apiKeys) {
    const apiKeyItems = Array.isArray(backup.data.apiKeys) ? backup.data.apiKeys : []
    const hashMapItems = apiKeyItems.filter((x) => x && x.__key === 'apikey:hash_map')
    const entityItems = apiKeyItems.filter((x) => !x || x.__key !== 'apikey:hash_map')
    // API Key 侧没有 `<前缀>index` 那样的单一索引集合——真正在维护的是
    // apikey:idx:createdAt / lastUsedAt / name、apikey:idx:all 与
    // apikey:set:active / apikey:set:deleted 这一族，统一由 addToIndex 写入，
    // 并按实体的 isDeleted / isActive 自动分入活跃桶或回收站桶。
    // eslint-disable-next-line global-require
    const apiKeyIndexService = require('./apiKeyIndexService')
    const parseTags = (raw) => {
      if (Array.isArray(raw)) {
        return raw
      }
      if (typeof raw !== 'string' || !raw) {
        return []
      }
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }

    await restoreEntityItems(entityItems, stats.apiKeys, {
      prefix: 'apikey:',
      indexLabel: 'apikey:idx',
      indexStats: stats.indexes,
      indexWriter: async (id, item) => {
        await apiKeyIndexService.addToIndex({
          id,
          name: item.name,
          createdAt: item.createdAt,
          lastUsedAt: item.lastUsedAt,
          isActive: item.isActive,
          isDeleted: item.isDeleted,
          tags: parseTags(item.tags)
        })
        // addToIndex 内部把异常吞成 logger.error 而不抛，直接返回就无从判断成败；
        // 这里显式复核成员，否则索引写失败会被计成成功——正是本次要消灭的形态。
        const indexed = await client.sismember(apiKeyIndexService.INDEX_KEYS.ALL_SET, id)
        if (!indexed) {
          throw new Error(`${apiKeyIndexService.INDEX_KEYS.ALL_SET} missing ${id} after addToIndex`)
        }
      }
    })

    // ── hash_map 字段合并 MUST 排在实体写回之后 ──────────────────────────
    // 同一份备份里映射与实体成对出现。若先合并映射，restoreHashMap 的
    // `exists(apikey:<keyId>)` 复核对每一条都为假，全部映射被当成「实体不存在」
    // 跳过 —— 还原的 key 直到下次重启（rebuildHashMap 回填）之前一律 401，
    // 正是本次要修的 D2 症状。顺序颠倒不会报错，只会静默退化，故写死在这里。
    for (const item of hashMapItems) {
      await restoreHashMap(item)
    }
  }

  // tags：set 天然幂等，按成员合并写回（已在集合中的成员计 skipped）
  if (backup.data.tags && typeof backup.data.tags === 'object') {
    const { all, byTag } = backup.data.tags
    if (Array.isArray(all)) {
      for (const tag of all) {
        if (typeof tag !== 'string' || !tag) {
          stats.tags.errors++
          continue
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          const added = await client.sadd('apikey:tags:all', tag)
          if (added > 0) {
            stats.tags.imported++
          } else {
            stats.tags.skipped++
          }
          const members = byTag && Array.isArray(byTag[tag]) ? byTag[tag] : []
          if (members.length > 0) {
            // eslint-disable-next-line no-await-in-loop
            await client.sadd(`apikey:tag:${tag}`, members)
          }
        } catch (e) {
          stats.tags.errors++
          logger.error(`backup import: tag ${tag} failed: ${e.message}`)
        }
      }
    }
  }

  // 管理员：跳过冲突——仅当当前无管理员凭据时才恢复
  if (backup.data.admins) {
    try {
      const existing = await client.hgetall('session:admin_credentials')
      const hasExisting = existing && Object.keys(existing).length > 0
      const initPath = path.join(__dirname, '../../data/init.json')
      const initExists = fs.existsSync(initPath)

      if (hasExisting || initExists) {
        // 已存在管理员 → 跳过（不覆盖）
        stats.admins.skipped++
      } else {
        if (backup.data.admins.initJson) {
          fs.writeFileSync(initPath, JSON.stringify(backup.data.admins.initJson, null, 2), {
            mode: 0o600
          })
        }
        if (backup.data.admins.sessionCredentials) {
          await client.hset('session:admin_credentials', backup.data.admins.sessionCredentials)
        }
        stats.admins.imported++
      }
    } catch (e) {
      logger.error(`backup import: admin restore failed: ${e.message}`)
      stats.admins.errors++
    }
  }

  // ── SQLite 贯通 + 索引/缓存清理 ─────────────────────────────────────
  // backend=sqlite 时立即对账落库；失败必须显式抛出（数据未落 SQLite 不能静默成功）。
  // reconcileAll 在定时轮正在运行时返回 null（互斥），短暂等待重试。
  if (config.metadata.backend === 'sqlite') {
    // eslint-disable-next-line global-require
    const metadataSync = require('../storage/metadataSync')
    let result = null
    for (let attempt = 1; attempt <= 3 && !result; attempt++) {
      result = await metadataSync.reconcileAll()
      if (!result && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
    if (!result) {
      throw new Error(
        'backup import: metadataSync.reconcileAll() did not complete (SQLite may be out of sync); ' +
          'data is in Redis and will be reconciled by the periodic sync'
      )
    }
    logger.info('📥 backup import: metadataSync.reconcileAll() completed (SQLite in sync)')
  }

  // 清理索引空标记（还原前可能被 getAllIdsByIndex 打上 <index>:empty，TTL 1h）
  // addToIndex 已逐个清过对应标记，此处为兜底，重复删除无害。
  try {
    const emptyMarkers = ACCOUNT_GROUPS.map((g) => `${g.prefix}index:empty`)
    emptyMarkers.push('apikey:index:empty')
    emptyMarkers.push('account:index:version') // 触发 accountIndexService 下次校验时重建（D4）
    // apikey:index:version 只在索引写入出过错时才删：本次导入已逐条把 API Key
    // 登记进 apikey:idx:* 索引族，索引是完整的，保留 version 可让列表继续走
    // 索引快路径；一旦有条目登记失败，就删掉 version 让下次启动 rebuildIndexes
    // 兜底——期间 isIndexReady() 为假，查询回退全量 SCAN，结果仍正确只是变慢。
    if (indexErrorCount > 0) {
      emptyMarkers.push('apikey:index:version')
      logger.warn(
        `backup import: ${indexErrorCount} index write(s) failed, dropping apikey:index:version to force a rebuild on next start`
      )
    }
    await client.del(...emptyMarkers)
  } catch (e) {
    logger.warn(`backup import: clear index empty markers failed: ${e.message}`)
  }

  // 失效 read-through 缓存（account:cache:* / apikey:cache:*，TTL 60s，主动清理避免读旧值）
  try {
    for (const pattern of ['account:cache:*', 'apikey:cache:*']) {
      let cursor = '0'
      do {
        // eslint-disable-next-line no-await-in-loop
        const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
        cursor = next
        if (keys.length > 0) {
          // eslint-disable-next-line no-await-in-loop
          await client.del(...keys)
        }
      } while (cursor !== '0')
    }
  } catch (e) {
    logger.warn(`backup import: invalidate read-through cache failed: ${e.message}`)
  }

  return stats
}

// 统计各分组条目数（用于导出摘要 / UI 展示）
function summarize(backup) {
  const s = { apiKeys: 0, accounts: 0, tags: 0, admins: 0, groups: 0 }
  if (backup?.data?.apiKeys) {
    s.apiKeys = backup.data.apiKeys.filter((x) => x.__key !== 'apikey:hash_map').length
  }
  if (backup?.data?.accounts) {
    for (const group of ACCOUNT_GROUPS) {
      const arr = backup.data.accounts[group.name]
      if (Array.isArray(arr)) {
        s.accounts += arr.length
      }
    }
  }
  if (backup?.data?.tags && Array.isArray(backup.data.tags.all)) {
    s.tags = backup.data.tags.all.length
  }
  if (backup?.data?.groups && Array.isArray(backup.data.groups.definitions)) {
    s.groups = backup.data.groups.definitions.length
  }
  if (backup?.data?.admins) {
    s.admins = backup.data.admins.initJson || backup.data.admins.sessionCredentials ? 1 : 0
  }
  // 密钥指纹（D14）：让面板在**点导出之前**就能显示本机指纹 —— 事后核对救不了
  // 已经投错机器的那次导入。只带指纹与派生方式，长文案（notice）留在备份文件里。
  if (backup?.metadata?.encryption?.keyFingerprint) {
    s.encryption = {
      keyFingerprint: backup.metadata.encryption.keyFingerprint,
      algorithm: backup.metadata.encryption.algorithm || null
    }
  }
  return s
}

module.exports = {
  BACKUP_VERSION,
  exportBackup,
  importBackup,
  summarize
}
