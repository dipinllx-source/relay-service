const fs = require('fs')
const path = require('path')
const https = require('https')
const crypto = require('crypto')
const pricingSource = require('../../config/pricingSource')
const logger = require('../utils/logger')
const {
  CLAUDE_CACHE_MULTIPLIERS,
  resolveTokenRates,
  hasTokenPricing
} = require('../utils/litellmPricing')

// 补充价格：LiteLLM 原版缺失的模型（仅在上游没有该模型时补入，不覆盖上游价格）
const SUPPLEMENTS_FILE = path.join(
  __dirname,
  '..',
  '..',
  'resources',
  'model-pricing',
  'model_pricing_supplements.json'
)

// 模糊匹配时跳过的条目：带供应商前缀的键（如 chatgpt/xxx、azure_ai/xxx）
// 以及 Bedrock 风格前缀（如 anthropic.xxx、us.anthropic.xxx），避免误用第三方售价或无价条目
const PROVIDER_PREFIXED_KEY = /^[a-z_-]+\./i

class PricingService {
  constructor() {
    this.dataDir = path.join(process.cwd(), 'data')
    this.pricingFile = path.join(this.dataDir, 'model_pricing.json')
    this.pricingUrl = pricingSource.pricingUrl
    this.hashUrl = pricingSource.hashUrl
    this.fallbackFile = path.join(
      process.cwd(),
      'resources',
      'model-pricing',
      'model_prices_and_context_window.json'
    )
    this.localHashFile = path.join(this.dataDir, 'model_pricing.sha256')
    this.localEtagFile = path.join(this.dataDir, 'model_pricing.etag')
    // 本地覆盖价格（可选，运维手工维护）：按模型逐字段覆盖上游价格，优先级最高
    this.overridesFile = path.join(this.dataDir, 'model_pricing_overrides.json')
    this.pricingData = null
    this.lastUpdated = null
    this.lookupCache = new Map() // 模型名 -> 价格键 的查找缓存
    this.lookupCacheSource = null // 缓存对应的 pricingData 引用，数据替换后自动失效
    this.updateInterval = 24 * 60 * 60 * 1000 // 24小时
    this.hashCheckInterval = 10 * 60 * 1000 // 10分钟哈希校验
    this.fileWatcher = null // 文件监听器
    this.reloadDebounceTimer = null // 防抖定时器
    this.hashCheckTimer = null // 哈希轮询定时器
    this.updateTimer = null // 定时更新任务句柄
    this.hashSyncInProgress = false // 哈希同步状态

    // Claude Prompt Caching 官方倍率（基于输入价格）— 仅作为 model_pricing.json 缺失字段时的兜底
    this.claudeCacheMultipliers = { ...CLAUDE_CACHE_MULTIPLIERS }

    // Claude 扩展计费特性
    this.claudeFeatureFlags = {
      context1mBeta: 'context-1m-2025-08-07',
      fastModeBeta: 'fast-mode-2026-02-01',
      fastModeSpeed: 'fast'
    }
  }

  // 初始化价格服务
  async initialize() {
    try {
      // 确保data目录存在
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true })
        logger.info('📁 Created data directory')
      }

      // 检查是否需要下载或更新价格数据
      await this.checkAndUpdatePricing()

      // 初次启动时执行一次哈希校验，确保与远端保持一致
      await this.syncWithRemoteHash()

      // 设置定时更新
      if (this.updateTimer) {
        clearInterval(this.updateTimer)
      }
      this.updateTimer = setInterval(() => {
        this.checkAndUpdatePricing()
      }, this.updateInterval)

      // 设置哈希轮询
      this.setupHashCheck()

      // 设置文件监听器
      this.setupFileWatcher()

      logger.success('Pricing service initialized successfully')
    } catch (error) {
      logger.error('❌ Failed to initialize pricing service:', error)
    }
  }

  // 检查并更新价格数据
  async checkAndUpdatePricing() {
    try {
      const needsUpdate = this.needsUpdate()

      if (needsUpdate) {
        logger.info('🔄 Updating model pricing data...')
        await this.downloadPricingData()
      } else {
        // 如果不需要更新，加载现有数据
        await this.loadPricingData()
      }
    } catch (error) {
      logger.error('❌ Failed to check/update pricing:', error)
      // 如果更新失败，尝试使用fallback
      await this.useFallbackPricing()
    }
  }

  // 检查是否需要更新
  needsUpdate() {
    if (!fs.existsSync(this.pricingFile)) {
      logger.info('📋 Pricing file not found, will download')
      return true
    }

    const stats = fs.statSync(this.pricingFile)
    const fileAge = Date.now() - stats.mtime.getTime()

    if (fileAge > this.updateInterval) {
      logger.info(
        `📋 Pricing file is ${Math.round(fileAge / (60 * 60 * 1000))} hours old, will update`
      )
      return true
    }

    return false
  }

  // 下载价格数据
  async downloadPricingData() {
    try {
      await this._downloadFromRemote()
    } catch (downloadError) {
      logger.warn(`⚠️  Failed to download pricing data: ${downloadError.message}`)
      logger.info('📋 Using local fallback pricing data...')
      await this.useFallbackPricing()
    }
  }

  // 哈希轮询设置
  setupHashCheck() {
    if (this.hashCheckTimer) {
      clearInterval(this.hashCheckTimer)
    }

    this.hashCheckTimer = setInterval(() => {
      this.syncWithRemoteHash()
    }, this.hashCheckInterval)

    logger.info(
      this.hashUrl
        ? '🕒 已启用价格文件哈希轮询（每10分钟校验一次）'
        : '🕒 已启用价格文件 ETag 轮询（每10分钟条件请求一次）'
    )
  }

  // 与远端哈希对比（未配置哈希文件地址时改用 ETag 条件请求，如 LiteLLM 原版仓库）
  async syncWithRemoteHash() {
    if (this.hashSyncInProgress) {
      return
    }

    this.hashSyncInProgress = true
    try {
      if (!this.hashUrl) {
        await this.syncWithRemoteEtag()
        return
      }

      const remoteHash = await this.fetchRemoteHash()

      if (!remoteHash) {
        return
      }

      const localHash = this.computeLocalHash()

      if (!localHash) {
        logger.info('📄 本地价格文件缺失，尝试下载最新版本')
        await this.downloadPricingData()
        return
      }

      if (remoteHash !== localHash) {
        logger.info('🔁 检测到远端价格文件更新，开始下载最新数据')
        await this.downloadPricingData()
      }
    } catch (error) {
      logger.warn(`⚠️  哈希校验失败：${error.message}`)
    } finally {
      this.hashSyncInProgress = false
    }
  }

  // 通过 ETag 条件请求检测远端更新：未变化时远端返回 304，不重复下载
  async syncWithRemoteEtag() {
    if (!fs.existsSync(this.pricingFile)) {
      logger.info('📄 本地价格文件缺失，尝试下载最新版本')
      await this.downloadPricingData()
      return
    }

    const result = await this._downloadFromRemote({
      ifNoneMatch: this.readLocalEtag(),
      skipIfUnchanged: true
    })

    if (result && result.notModified) {
      logger.debug('💰 远端价格文件未变化（ETag 校验）')
    } else {
      logger.info('🔁 检测到远端价格文件更新，已下载最新数据')
    }
  }

  readLocalEtag() {
    try {
      if (fs.existsSync(this.localEtagFile)) {
        const etag = fs.readFileSync(this.localEtagFile, 'utf8').trim()
        return etag || null
      }
    } catch (error) {
      logger.debug(`💰 读取本地 ETag 失败：${error.message}`)
    }
    return null
  }

  persistLocalEtag(etag) {
    try {
      if (etag) {
        fs.writeFileSync(this.localEtagFile, `${etag}\n`)
      }
    } catch (error) {
      logger.debug(`💰 写入本地 ETag 失败：${error.message}`)
    }
  }

  clearLocalEtag() {
    try {
      if (fs.existsSync(this.localEtagFile)) {
        fs.unlinkSync(this.localEtagFile)
      }
    } catch (error) {
      logger.debug(`💰 清除本地 ETag 失败：${error.message}`)
    }
  }

  // 获取远端哈希值
  fetchRemoteHash() {
    return new Promise((resolve, reject) => {
      const request = https.get(this.hashUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`哈希文件获取失败：HTTP ${response.statusCode}`))
          return
        }

        let data = ''
        response.on('data', (chunk) => {
          data += chunk
        })

        response.on('end', () => {
          const hash = data.trim().split(/\s+/)[0]

          if (!hash) {
            reject(new Error('哈希文件内容为空'))
            return
          }

          resolve(hash)
        })
      })

      request.on('error', (error) => {
        reject(new Error(`网络错误：${error.message}`))
      })

      request.setTimeout(30000, () => {
        request.destroy()
        reject(new Error('获取哈希超时（30秒）'))
      })
    })
  }

  // 计算本地文件哈希
  computeLocalHash() {
    if (!fs.existsSync(this.pricingFile)) {
      return null
    }

    if (fs.existsSync(this.localHashFile)) {
      const cached = fs.readFileSync(this.localHashFile, 'utf8').trim()
      if (cached) {
        return cached
      }
    }

    const fileBuffer = fs.readFileSync(this.pricingFile)
    return this.persistLocalHash(fileBuffer)
  }

  // 写入本地哈希文件
  persistLocalHash(content) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    fs.writeFileSync(this.localHashFile, `${hash}\n`)
    return hash
  }

  // 实际的下载逻辑
  // options.ifNoneMatch：上次下载的 ETag，远端未变化时返回 304
  // options.skipIfUnchanged：内容与本地一致时不重写文件（避免触发文件监听重载）
  _downloadFromRemote(options = {}) {
    const { ifNoneMatch = null, skipIfUnchanged = false } = options
    return new Promise((resolve, reject) => {
      const requestOptions = ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {}
      const request = https.get(this.pricingUrl, requestOptions, (response) => {
        if (response.statusCode === 304 && ifNoneMatch) {
          response.resume()
          resolve({ notModified: true })
          return
        }

        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`))
          return
        }

        const etag = response.headers ? response.headers.etag : null
        const chunks = []
        response.on('data', (chunk) => {
          const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          chunks.push(bufferChunk)
        })

        response.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks)
            const rawContent = buffer.toString('utf8')
            const jsonData = JSON.parse(rawContent)

            if (
              !jsonData ||
              typeof jsonData !== 'object' ||
              Array.isArray(jsonData) ||
              Object.keys(jsonData).length === 0
            ) {
              throw new Error('Invalid pricing data structure')
            }

            if (skipIfUnchanged && fs.existsSync(this.pricingFile)) {
              const remoteHash = crypto.createHash('sha256').update(buffer).digest('hex')
              if (remoteHash === this.computeLocalHash()) {
                this.persistLocalEtag(etag)
                resolve({ notModified: true })
                return
              }
            }

            // 保存到文件并更新哈希（文件保存上游原始内容，本地补充/覆盖只在内存中合并）
            fs.writeFileSync(this.pricingFile, rawContent)
            this.persistLocalHash(buffer)
            this.persistLocalEtag(etag)

            // 更新内存中的数据
            this.setPricingData(jsonData)

            logger.success(`Downloaded pricing data for ${Object.keys(jsonData).length} models`)

            // 设置或重新设置文件监听器
            this.setupFileWatcher()

            resolve({ notModified: false })
          } catch (error) {
            reject(new Error(`Failed to parse pricing data: ${error.message}`))
          }
        })
      })

      request.on('error', (error) => {
        reject(new Error(`Network error: ${error.message}`))
      })

      request.setTimeout(30000, () => {
        request.destroy()
        reject(new Error('Download timeout after 30 seconds'))
      })
    })
  }

  // 读取补充价格（LiteLLM 原版缺失的模型，随代码发布）
  loadSupplements() {
    try {
      const data = JSON.parse(fs.readFileSync(SUPPLEMENTS_FILE, 'utf8'))
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn(`⚠️  Failed to load pricing supplements: ${error.message}`)
      }
      return {}
    }
  }

  // 读取本地覆盖价格（可选）：data/model_pricing_overrides.json
  loadOverrides() {
    try {
      if (!fs.existsSync(this.overridesFile)) {
        return {}
      }
      const data = JSON.parse(fs.readFileSync(this.overridesFile, 'utf8'))
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    } catch (error) {
      logger.warn(`⚠️  Failed to load pricing overrides (${this.overridesFile}): ${error.message}`)
      return {}
    }
  }

  // 在上游价格表上合并本地数据：补充（仅补缺失模型） < 上游 < 覆盖（逐字段覆盖）
  applyLocalPricing(upstreamData) {
    const merged = { ...(upstreamData || {}) }
    let supplemented = 0
    let overridden = 0

    for (const [model, entry] of Object.entries(this.loadSupplements())) {
      if (model.startsWith('_') || !entry || typeof entry !== 'object') {
        continue
      }
      if (!Object.prototype.hasOwnProperty.call(merged, model)) {
        merged[model] = entry
        supplemented++
      }
    }

    for (const [model, entry] of Object.entries(this.loadOverrides())) {
      if (model.startsWith('_') || !entry || typeof entry !== 'object') {
        continue
      }
      const base = merged[model] && typeof merged[model] === 'object' ? merged[model] : {}
      merged[model] = { ...base, ...entry }
      overridden++
    }

    if (supplemented > 0 || overridden > 0) {
      logger.debug(
        `💰 Applied local pricing: ${supplemented} supplemented model(s), ${overridden} overridden model(s)`
      )
    }

    return merged
  }

  // 设置内存中的价格数据（统一入口，保证本地补充/覆盖始终生效）
  setPricingData(upstreamData) {
    this.pricingData = this.applyLocalPricing(upstreamData)
    this.lastUpdated = new Date()
    this.lookupCache.clear()
    this.lookupCacheSource = this.pricingData
  }

  // 加载本地价格数据
  async loadPricingData() {
    try {
      if (fs.existsSync(this.pricingFile)) {
        const data = fs.readFileSync(this.pricingFile, 'utf8')
        this.setPricingData(JSON.parse(data))

        const stats = fs.statSync(this.pricingFile)
        this.lastUpdated = stats.mtime

        logger.info(
          `💰 Loaded pricing data for ${Object.keys(this.pricingData).length} models from cache`
        )
      } else {
        logger.warn('💰 No pricing data file found, will use fallback')
        await this.useFallbackPricing()
      }
    } catch (error) {
      logger.error('❌ Failed to load pricing data:', error)
      await this.useFallbackPricing()
    }
  }

  // 使用fallback价格数据
  async useFallbackPricing() {
    try {
      if (fs.existsSync(this.fallbackFile)) {
        logger.info('📋 Copying fallback pricing data to data directory...')

        // 读取fallback文件
        const fallbackData = fs.readFileSync(this.fallbackFile, 'utf8')
        const jsonData = JSON.parse(fallbackData)

        const formattedJson = JSON.stringify(jsonData, null, 2)

        // 保存到data目录
        fs.writeFileSync(this.pricingFile, formattedJson)
        this.persistLocalHash(formattedJson)
        // 本地文件已不是远端版本，清除 ETag，下次轮询强制完整下载
        this.clearLocalEtag()

        // 更新内存中的数据
        this.setPricingData(jsonData)

        // 设置或重新设置文件监听器
        this.setupFileWatcher()

        logger.warn(`⚠️  Using fallback pricing data for ${Object.keys(jsonData).length} models`)
        logger.info(
          '💡 Note: This fallback data may be outdated. The system will try to update from the remote source on next check.'
        )
      } else {
        logger.error('❌ Fallback pricing file not found at:', this.fallbackFile)
        logger.error(
          '❌ Please ensure the resources/model-pricing directory exists with the pricing file'
        )
        this.pricingData = {}
      }
    } catch (error) {
      logger.error('❌ Failed to use fallback pricing data:', error)
      this.pricingData = {}
    }
  }

  // 获取模型价格信息
  getModelPricing(modelName) {
    if (!this.pricingData || !modelName) {
      return null
    }

    // 尝试直接匹配
    if (this.pricingData[modelName]) {
      logger.debug(`💰 Found exact pricing match for ${modelName}`)
      return this.pricingData[modelName]
    }

    // 特殊处理：gpt-5-codex 回退到 gpt-5
    if (modelName === 'gpt-5-codex' && !this.pricingData['gpt-5-codex']) {
      const fallbackPricing = this.pricingData['gpt-5']
      if (fallbackPricing) {
        logger.info(`💰 Using gpt-5 pricing as fallback for ${modelName}`)
        return fallbackPricing
      }
    }

    // 对于Bedrock区域前缀模型（如 us.anthropic.claude-sonnet-4-20250514-v1:0），
    // 尝试去掉区域前缀进行匹配
    if (modelName.includes('.anthropic.') || modelName.includes('.claude')) {
      // 提取不带区域前缀的模型名
      const withoutRegion = modelName.replace(/^(us|eu|apac)\./, '')
      if (this.pricingData[withoutRegion]) {
        logger.debug(
          `💰 Found pricing for ${modelName} by removing region prefix: ${withoutRegion}`
        )
        return this.pricingData[withoutRegion]
      }
    }

    // 尝试模糊匹配（处理版本号等变化）
    const fuzzyMatch = this.findFuzzyPricing(modelName)
    if (fuzzyMatch) {
      logger.debug(`💰 Found pricing for ${modelName} using fuzzy match: ${fuzzyMatch.key}`)
      return fuzzyMatch.value
    }

    // 对于Bedrock模型，尝试更智能的匹配
    if (modelName.includes('anthropic.claude')) {
      // 提取核心模型名部分（去掉区域和前缀）
      const coreModel = modelName.replace(/^(us|eu|apac)\./, '').replace('anthropic.', '')

      for (const [key, value] of Object.entries(this.pricingData)) {
        if (key.includes(coreModel) || key.replace('anthropic.', '').includes(coreModel)) {
          logger.debug(`💰 Found pricing for ${modelName} using Bedrock core model match: ${key}`)
          return value
        }
      }
    }

    logger.debug(`💰 No pricing found for model: ${modelName}`)
    return null
  }

  // 模糊匹配候选：排除带供应商前缀的条目（如 chatgpt/xxx、openrouter/xxx、vertex_ai/xxx、
  // azure.xxx 等，这些是第三方渠道价格或无价格字段）以及没有 token 单价的条目
  isFuzzyCandidate(key, value) {
    return (
      key !== 'sample_spec' &&
      !key.includes('/') &&
      !PROVIDER_PREFIXED_KEY.test(key) &&
      hasTokenPricing(value)
    )
  }

  // 模糊匹配：优先选择被模型名包含的最长键（如 gpt-5.4-2026xxxx → gpt-5.4），
  // 其次选择包含模型名的最短键；结果按 pricingData 实例缓存
  findFuzzyPricing(modelName) {
    if (this.lookupCacheSource !== this.pricingData) {
      this.lookupCache.clear()
      this.lookupCacheSource = this.pricingData
    }

    if (this.lookupCache.has(modelName)) {
      return this.lookupCache.get(modelName)
    }

    const normalize = (value) => value.toLowerCase().replace(/[_-]/g, '')
    const normalizedModel = normalize(modelName)
    let containedBest = null
    let containingBest = null

    if (normalizedModel) {
      for (const [key, value] of Object.entries(this.pricingData)) {
        if (!this.isFuzzyCandidate(key, value)) {
          continue
        }
        const normalizedKey = normalize(key)
        if (!normalizedKey) {
          continue
        }
        if (normalizedModel.includes(normalizedKey)) {
          if (!containedBest || normalizedKey.length > containedBest.length) {
            containedBest = { key, value, length: normalizedKey.length }
          }
        } else if (normalizedKey.includes(normalizedModel)) {
          if (!containingBest || normalizedKey.length < containingBest.length) {
            containingBest = { key, value, length: normalizedKey.length }
          }
        }
      }
    }

    const best = containedBest || containingBest
    const result = best ? { key: best.key, value: best.value } : null
    this.lookupCache.set(modelName, result)
    return result
  }

  // 确保价格对象包含缓存价格
  ensureCachePricing(pricing) {
    if (!pricing) {
      return pricing
    }

    // 如果缺少缓存价格，根据输入价格计算（缓存创建价格通常是输入价格的1.25倍，缓存读取是0.1倍）
    if (!pricing.cache_creation_input_token_cost && pricing.input_cost_per_token) {
      pricing.cache_creation_input_token_cost = pricing.input_cost_per_token * 1.25
    }
    if (!pricing.cache_read_input_token_cost && pricing.input_cost_per_token) {
      pricing.cache_read_input_token_cost = pricing.input_cost_per_token * 0.1
    }
    return pricing
  }

  // 从 usage 对象中提取 beta 特性列表（小写）
  extractBetaFeatures(usage) {
    const features = new Set()
    if (!usage || typeof usage !== 'object') {
      return features
    }

    const requestHeaders = usage.request_headers || usage.requestHeaders || null
    const headerBeta =
      requestHeaders && typeof requestHeaders === 'object'
        ? requestHeaders['anthropic-beta'] ||
          requestHeaders['Anthropic-Beta'] ||
          requestHeaders['ANTHROPIC-BETA']
        : null

    const candidates = [
      usage.anthropic_beta,
      usage.anthropicBeta,
      usage.request_anthropic_beta,
      usage.requestAnthropicBeta,
      usage.beta_header,
      usage.betaHeader,
      usage.beta_features,
      headerBeta
    ]

    const addFeature = (value) => {
      if (!value || typeof value !== 'string') {
        return
      }
      value
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .forEach((item) => features.add(item))
    }

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        candidate.forEach(addFeature)
      } else {
        addFeature(candidate)
      }
    }

    return features
  }

  // 提取请求/响应中的 speed 字段（小写）
  extractSpeedSignal(usage) {
    if (!usage || typeof usage !== 'object') {
      return { responseSpeed: '', requestSpeed: '' }
    }

    const normalize = (value) =>
      typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : ''

    return {
      responseSpeed: normalize(usage.speed),
      requestSpeed: normalize(usage.request_speed || usage.requestSpeed)
    }
  }

  // 去掉模型名中的 [1m] 后缀，便于价格查找
  stripLongContextSuffix(modelName) {
    if (typeof modelName !== 'string') {
      return modelName
    }
    return modelName.replace(/\[1m\]/gi, '').trim()
  }

  // 计算使用费用
  // serviceTier：请求实际生效的服务档位（flex/priority/fast/ultrafast），按 LiteLLM 规则选择档位价格
  calculateCost(usage, modelName, serviceTier = null) {
    const normalizedModelName = this.stripLongContextSuffix(modelName)

    // 检查是否为 1M 上下文模型（用户通过 [1m] 后缀主动选择长上下文模式）
    const isLongContextModel = typeof modelName === 'string' && modelName.includes('[1m]')
    let isLongContextRequest = false

    // 计算总输入 tokens（用于判断长上下文阈值）
    const inputTokens = usage.input_tokens || 0
    const cacheCreationTokens = usage.cache_creation_input_tokens || 0
    const cacheReadTokens = usage.cache_read_input_tokens || 0
    const totalInputTokens = inputTokens + cacheCreationTokens + cacheReadTokens

    // 识别 Claude 特性标识
    const betaFeatures = this.extractBetaFeatures(usage)
    const hasContext1mBeta = betaFeatures.has(this.claudeFeatureFlags.context1mBeta)
    const hasFastModeBeta = betaFeatures.has(this.claudeFeatureFlags.fastModeBeta)
    const { responseSpeed, requestSpeed } = this.extractSpeedSignal(usage)
    const hasFastSpeedSignal =
      responseSpeed === this.claudeFeatureFlags.fastModeSpeed ||
      requestSpeed === this.claudeFeatureFlags.fastModeSpeed
    const isFastModeRequest = hasFastModeBeta && hasFastSpeedSignal
    const pricing = this.getModelPricing(normalizedModelName)
    const isLongContextModeEnabled = isLongContextModel || hasContext1mBeta

    if (!pricing) {
      return {
        inputCost: 0,
        outputCost: 0,
        cacheCreateCost: 0,
        cacheReadCost: 0,
        ephemeral5mCost: 0,
        ephemeral1hCost: 0,
        totalCost: 0,
        hasPricing: false,
        isLongContextRequest: false
      }
    }

    // Fast Mode 倍率：优先从 provider_specific_entry.fast 读取，默认 6 倍
    const fastMultiplier = isFastModeRequest ? pricing?.provider_specific_entry?.fast || 6 : 1

    // 单价解析（LiteLLM 规则）：
    // - 档位价格键（*_priority / *_flex / *_ultrafast）存在就用，缺失回退标准价
    // - 非 Claude 模型按 input_cost_per_token_above_<N>k_tokens 阈值选择长上下文价格（优先带档位的阈值键）
    // - Claude 官方为统一价格（https://platform.claude.com/docs/en/about-claude/pricing），不套用阈值
    // - 缓存价格缺失：Claude 按官方倍率从输入价推导，其他模型按输入价计
    const rates = resolveTokenRates(pricing, {
      modelName: normalizedModelName,
      promptTokens: totalInputTokens,
      serviceTier
    })

    if (rates.longContextThreshold) {
      isLongContextRequest = true
      logger.info(
        `💰 Using above-${rates.longContextThreshold} pricing for ${modelName}: total input tokens = ${totalInputTokens.toLocaleString()}`
      )
    } else if (rates.isClaude && isLongContextModeEnabled && totalInputTokens > 200000) {
      logger.info(
        `💰 Skipping 200K+ pricing for ${modelName}: Claude models use flat pricing regardless of context length`
      )
    }

    if (isFastModeRequest && fastMultiplier > 1) {
      logger.info(
        `🚀 Fast mode ${fastMultiplier}x multiplier applied for ${normalizedModelName} (from provider_specific_entry)`
      )
    } else if (isFastModeRequest) {
      logger.warn(
        `⚠️ Fast mode request detected but no fast pricing found for ${normalizedModelName}; fallback to standard profile`
      )
    }

    let actualInputPrice = rates.input
    let actualOutputPrice = rates.output
    let actualCacheCreatePrice = rates.cacheCreate
    let actualCacheReadPrice = rates.cacheRead
    let actualEphemeral1hPrice = rates.ephemeral1h

    // Fast Mode 倍率：统一一次性应用于所有价格
    if (fastMultiplier > 1) {
      actualInputPrice *= fastMultiplier
      actualOutputPrice *= fastMultiplier
      actualCacheCreatePrice *= fastMultiplier
      actualCacheReadPrice *= fastMultiplier
      actualEphemeral1hPrice *= fastMultiplier
    }

    // 计算各项费用
    const inputCost = inputTokens * actualInputPrice
    const outputCost = (usage.output_tokens || 0) * actualOutputPrice

    // 处理缓存费用
    let ephemeral5mCost = 0
    let ephemeral1hCost = 0
    let cacheCreateCost = 0
    let cacheReadCost = 0

    if (usage.cache_creation && typeof usage.cache_creation === 'object') {
      // 有详细的缓存创建数据
      const ephemeral5mTokens = usage.cache_creation.ephemeral_5m_input_tokens || 0
      const ephemeral1hTokens = usage.cache_creation.ephemeral_1h_input_tokens || 0

      // 5分钟缓存使用 cache_creation 价格
      ephemeral5mCost = ephemeral5mTokens * actualCacheCreatePrice

      // 1小时缓存使用 ephemeral_1h 价格
      ephemeral1hCost = ephemeral1hTokens * actualEphemeral1hPrice

      // 总的缓存创建费用
      cacheCreateCost = ephemeral5mCost + ephemeral1hCost
    } else if (cacheCreationTokens) {
      // 旧格式，所有缓存创建 tokens 都按 5 分钟价格计算（向后兼容）
      cacheCreateCost = cacheCreationTokens * actualCacheCreatePrice
      ephemeral5mCost = cacheCreateCost
    }

    // 缓存读取费用
    cacheReadCost = cacheReadTokens * actualCacheReadPrice

    return {
      inputCost,
      outputCost,
      cacheCreateCost,
      cacheReadCost,
      ephemeral5mCost,
      ephemeral1hCost,
      totalCost: inputCost + outputCost + cacheCreateCost + cacheReadCost,
      hasPricing: true,
      isLongContextRequest,
      serviceTier: rates.serviceTier,
      longContextThreshold: rates.longContextThreshold,
      pricing: {
        input: actualInputPrice,
        output: actualOutputPrice,
        cacheCreate: actualCacheCreatePrice,
        cacheRead: actualCacheReadPrice,
        ephemeral1h: actualEphemeral1hPrice
      }
    }
  }

  // 格式化价格显示
  formatCost(cost) {
    if (cost === 0) {
      return '$0.000000'
    }
    if (cost < 0.000001) {
      return `$${cost.toExponential(2)}`
    }
    if (cost < 0.01) {
      return `$${cost.toFixed(6)}`
    }
    if (cost < 1) {
      return `$${cost.toFixed(4)}`
    }
    return `$${cost.toFixed(2)}`
  }

  // 获取服务状态
  getStatus() {
    return {
      initialized: this.pricingData !== null,
      lastUpdated: this.lastUpdated,
      modelCount: this.pricingData ? Object.keys(this.pricingData).length : 0,
      nextUpdate: this.lastUpdated
        ? new Date(this.lastUpdated.getTime() + this.updateInterval)
        : null
    }
  }

  // 强制更新价格数据
  async forceUpdate() {
    try {
      await this._downloadFromRemote()
      return { success: true, message: 'Pricing data updated successfully' }
    } catch (error) {
      logger.error('❌ Force update failed:', error)
      logger.info('📋 Force update failed, using fallback pricing data...')
      await this.useFallbackPricing()
      return {
        success: false,
        message: `Download failed: ${error.message}. Using fallback pricing data instead.`
      }
    }
  }

  // 设置文件监听器
  setupFileWatcher() {
    try {
      // 如果已有监听器，先关闭
      if (this.fileWatcher) {
        this.fileWatcher.close()
        this.fileWatcher = null
      }

      // 只有文件存在时才设置监听器
      if (!fs.existsSync(this.pricingFile)) {
        logger.debug('💰 Pricing file does not exist yet, skipping file watcher setup')
        return
      }

      // 使用 fs.watchFile 作为更可靠的文件监听方式
      // 它使用轮询，虽然性能稍差，但更可靠
      const watchOptions = {
        persistent: true,
        interval: 60000 // 每60秒检查一次
      }

      // 记录初始的修改时间
      let lastMtime = fs.statSync(this.pricingFile).mtimeMs

      fs.watchFile(this.pricingFile, watchOptions, (curr, _prev) => {
        // 检查文件是否真的被修改了（不仅仅是访问）
        if (curr.mtimeMs !== lastMtime) {
          lastMtime = curr.mtimeMs
          logger.debug(
            `💰 Detected change in pricing file (mtime: ${new Date(curr.mtime).toISOString()})`
          )
          this.handleFileChange()
        }
      })

      // 保存引用以便清理
      this.fileWatcher = {
        close: () => fs.unwatchFile(this.pricingFile)
      }

      logger.info('👁️  File watcher set up for model_pricing.json (polling every 60s)')
    } catch (error) {
      logger.error('❌ Failed to setup file watcher:', error)
    }
  }

  // 处理文件变化（带防抖）
  handleFileChange() {
    // 清除之前的定时器
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer)
    }

    // 设置新的定时器（防抖500ms）
    this.reloadDebounceTimer = setTimeout(async () => {
      logger.info('🔄 Reloading pricing data due to file change...')
      await this.reloadPricingData()
    }, 500)
  }

  // 重新加载价格数据
  async reloadPricingData() {
    try {
      // 验证文件是否存在
      if (!fs.existsSync(this.pricingFile)) {
        logger.warn('💰 Pricing file was deleted, using fallback')
        await this.useFallbackPricing()
        // 重新设置文件监听器（fallback会创建新文件）
        this.setupFileWatcher()
        return
      }

      // 读取文件内容
      const data = fs.readFileSync(this.pricingFile, 'utf8')

      // 尝试解析JSON
      const jsonData = JSON.parse(data)

      // 验证数据结构
      if (typeof jsonData !== 'object' || Object.keys(jsonData).length === 0) {
        throw new Error('Invalid pricing data structure')
      }

      // 更新内存中的数据
      this.setPricingData(jsonData)

      const modelCount = Object.keys(this.pricingData).length
      logger.success(`Reloaded pricing data for ${modelCount} models from file`)

      // 显示一些统计信息
      const claudeModels = Object.keys(jsonData).filter((k) => k.includes('claude')).length
      const gptModels = Object.keys(jsonData).filter((k) => k.includes('gpt')).length
      const geminiModels = Object.keys(jsonData).filter((k) => k.includes('gemini')).length

      logger.debug(
        `💰 Model breakdown: Claude=${claudeModels}, GPT=${gptModels}, Gemini=${geminiModels}`
      )
    } catch (error) {
      logger.error('❌ Failed to reload pricing data:', error)
      logger.warn('💰 Keeping existing pricing data in memory')
    }
  }

  // 清理资源
  cleanup() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
      logger.debug('💰 Pricing update timer cleared')
    }
    if (this.fileWatcher) {
      this.fileWatcher.close()
      this.fileWatcher = null
      logger.debug('💰 File watcher closed')
    }
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer)
      this.reloadDebounceTimer = null
    }
    if (this.hashCheckTimer) {
      clearInterval(this.hashCheckTimer)
      this.hashCheckTimer = null
      logger.debug('💰 Hash check timer cleared')
    }
  }
}

module.exports = new PricingService()
