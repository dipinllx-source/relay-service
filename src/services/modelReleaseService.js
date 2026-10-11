/**
 * 官方模型发布日期服务
 *
 * LiteLLM 价格表（4000+ 条）混有大量第三方渠道（bedrock/azure/vertex/openrouter…）条目，
 * 且没有发布日期字段。管理台价格列表只展示「官方模型」并按发布日期倒序：
 *   - 官方模型清单与发布日期来自 models.dev（sst/models.dev，按厂商维护的开源模型目录）
 *   - 价格仍取自计费实际使用的 pricingService.pricingData，保证展示即计费
 *
 * 数据来源优先级：data/model_release_dates.json（远程拉取缓存）> resources 内置快照。
 * 刷新策略：懒加载 + 后台刷新（24h 成功节流 / 30min 失败节流），带 ETag 条件请求。
 */

const fs = require('fs')
const path = require('path')
const axios = require('axios')
const logger = require('../utils/logger')
const { hasTokenPricing } = require('../utils/litellmPricing')

const SOURCE_URL = process.env.MODEL_RELEASE_SOURCE_URL || 'https://models.dev/api.json'
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
const FAILURE_RETRY_MS = 30 * 60 * 1000

const BUNDLED_FILE = path.join(
  __dirname,
  '..',
  '..',
  'resources',
  'model-pricing',
  'model_release_dates.json'
)

// 官方厂商：models.dev 中的 provider key → 展示信息 & 价格表中该厂商官方条目的键前缀
// 价格查找顺序：裸 id（计费时客户端传的就是裸 id）→ 厂商前缀 id（LiteLLM 官方渠道条目）
const OFFICIAL_PROVIDERS = {
  anthropic: { label: 'Anthropic', platform: 'claude', pricingPrefixes: ['anthropic/'] },
  openai: { label: 'OpenAI', platform: 'openai', pricingPrefixes: ['openai/'] },
  google: { label: 'Google', platform: 'gemini', pricingPrefixes: ['gemini/'] },
  xai: { label: 'xAI', platform: 'other', pricingPrefixes: ['xai/'] },
  deepseek: { label: 'DeepSeek', platform: 'other', pricingPrefixes: ['deepseek/'] },
  moonshotai: { label: 'Moonshot', platform: 'other', pricingPrefixes: ['moonshot/'] },
  zai: { label: 'Z.AI', platform: 'other', pricingPrefixes: ['zai/'] },
  minimax: { label: 'MiniMax', platform: 'other', pricingPrefixes: ['minimax/'] }
}

const PROVIDER_ORDER = Object.keys(OFFICIAL_PROVIDERS)

// 带日期快照后缀的模型 id：claude-opus-4-5-20251101 / gpt-5.5-2026-04-23
const SNAPSHOT_SUFFIX = /^(.+)-(\d{8}|\d{4}-\d{2}-\d{2})$/

function toPerMillion(value) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num * 1e6 : null
}

/**
 * 从 models.dev api.json 中抽取官方厂商的模型发布日期
 * @returns {Array<{provider: string, id: string, name: string, releaseDate: string}>}
 */
function extractReleaseEntries(apiJson) {
  const entries = []
  if (!apiJson || typeof apiJson !== 'object') {
    return entries
  }
  for (const providerKey of PROVIDER_ORDER) {
    const models = apiJson[providerKey]?.models
    if (!models || typeof models !== 'object') {
      continue
    }
    for (const model of Object.values(models)) {
      if (!model || !model.id || !model.release_date) {
        continue
      }
      entries.push({
        provider: providerKey,
        id: String(model.id),
        name: model.name ? String(model.name) : String(model.id),
        releaseDate: String(model.release_date)
      })
    }
  }
  return entries
}

class ModelReleaseService {
  constructor() {
    this.dataDir = path.join(process.cwd(), 'data')
    this.dataFile = path.join(this.dataDir, 'model_release_dates.json')
    this.catalog = null // { source, etag, fetchedAt, checkedAt, models }
    this.lastAttemptAt = 0
    this.lastError = null
    this._inFlight = null
    this._lowerIndexCache = new WeakMap()
  }

  _readJson(file) {
    try {
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
      }
    } catch (error) {
      logger.warn(`⚠️ Failed to read model release dates from ${file}: ${error.message}`)
    }
    return null
  }

  _isValidCatalog(catalog) {
    return !!catalog && Array.isArray(catalog.models) && catalog.models.length > 0
  }

  /**
   * 当前发布日期目录（同步，不触发网络）
   */
  getCatalog() {
    if (this._isValidCatalog(this.catalog)) {
      return this.catalog
    }
    const cached = this._readJson(this.dataFile)
    if (this._isValidCatalog(cached)) {
      this.catalog = { ...cached, origin: 'remote' }
      return this.catalog
    }
    const bundled = this._readJson(BUNDLED_FILE)
    if (this._isValidCatalog(bundled)) {
      this.catalog = { ...bundled, origin: 'bundled', etag: null, checkedAt: null }
      return this.catalog
    }
    this.catalog = { models: [], origin: 'none' }
    return this.catalog
  }

  _isFresh() {
    const catalog = this.getCatalog()
    if (catalog.origin !== 'remote') {
      return false
    }
    const checkedAt = new Date(catalog.checkedAt || catalog.fetchedAt || 0).getTime()
    return Date.now() - checkedAt < SUCCESS_TTL_MS
  }

  /**
   * 过期则后台刷新，不阻塞调用方
   */
  refreshInBackground() {
    if (this._isFresh() || this._inFlight) {
      return
    }
    if (this.lastError && Date.now() - this.lastAttemptAt < FAILURE_RETRY_MS) {
      return
    }
    this.refresh().catch(() => {})
  }

  /**
   * 从 models.dev 拉取并落盘
   * @param {object} [options]
   * @param {boolean} [options.force] - 忽略 ETag，强制完整下载
   */
  refresh({ force = false } = {}) {
    if (this._inFlight) {
      return this._inFlight
    }
    this._inFlight = this._doRefresh({ force }).finally(() => {
      this._inFlight = null
    })
    return this._inFlight
  }

  async _doRefresh({ force }) {
    this.lastAttemptAt = Date.now()
    const current = this.getCatalog()
    const headers = { Accept: 'application/json' }
    if (!force && current.origin === 'remote' && current.etag) {
      headers['If-None-Match'] = current.etag
    }

    try {
      const response = await axios.get(SOURCE_URL, {
        headers,
        timeout: 30000,
        maxContentLength: 100 * 1024 * 1024,
        validateStatus: (status) => status === 200 || status === 304
      })
      const now = new Date().toISOString()

      if (response.status === 304) {
        this._persist({ ...current, checkedAt: now })
        this.lastError = null
        return { updated: false, count: current.models.length }
      }

      const models = extractReleaseEntries(response.data)
      if (models.length === 0) {
        throw new Error('no official models found in release source')
      }
      this._persist({
        source: SOURCE_URL,
        etag: response.headers?.etag || null,
        fetchedAt: now,
        checkedAt: now,
        models
      })
      this.lastError = null
      logger.info(`📅 Model release dates updated: ${models.length} official models`)
      return { updated: true, count: models.length }
    } catch (error) {
      this.lastError = error.message || String(error)
      logger.warn(
        `⚠️ Failed to refresh model release dates: ${this.lastError}; using ${current.origin} data`
      )
      throw error
    }
  }

  _persist(catalog) {
    const data = { ...catalog }
    delete data.origin
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true })
      }
      fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2))
    } catch (error) {
      logger.warn(`⚠️ Failed to persist model release dates: ${error.message}`)
    }
    this.catalog = { ...data, origin: 'remote' }
  }

  _lowerIndex(pricingData) {
    let index = this._lowerIndexCache.get(pricingData)
    if (!index) {
      index = new Map()
      for (const key of Object.keys(pricingData)) {
        const lower = key.toLowerCase()
        if (!index.has(lower)) {
          index.set(lower, key)
        }
      }
      this._lowerIndexCache.set(pricingData, index)
    }
    return index
  }

  _findPricing(pricingData, entry) {
    const provider = OFFICIAL_PROVIDERS[entry.provider]
    const candidates = [entry.id, ...provider.pricingPrefixes.map((prefix) => prefix + entry.id)]
    const index = this._lowerIndex(pricingData)
    for (const candidate of candidates) {
      const key = pricingData[candidate] ? candidate : index.get(candidate.toLowerCase())
      if (key && hasTokenPricing(pricingData[key])) {
        return { key, pricing: pricingData[key] }
      }
    }
    return null
  }

  /**
   * 生成官方模型价格列表：只保留有 token 单价的官方模型，日期快照并入同价同日的别名，
   * 按发布日期倒序
   * @param {object} pricingData - pricingService.pricingData
   */
  buildOfficialPriceList(pricingData, catalog = this.getCatalog()) {
    if (!pricingData || typeof pricingData !== 'object') {
      return []
    }

    const items = []
    const seen = new Set()
    for (const entry of catalog.models || []) {
      const provider = OFFICIAL_PROVIDERS[entry.provider]
      const dedupeKey = `${entry.provider}:${entry.id}`
      if (!provider || seen.has(dedupeKey)) {
        continue
      }
      seen.add(dedupeKey)

      const match = this._findPricing(pricingData, entry)
      if (!match) {
        continue
      }
      const { pricing } = match
      items.push({
        id: entry.id,
        name: entry.name,
        provider: entry.provider,
        providerLabel: provider.label,
        platform: provider.platform,
        releaseDate: entry.releaseDate,
        pricingKey: match.key,
        aliases: [],
        inputCost: toPerMillion(pricing.input_cost_per_token),
        outputCost: toPerMillion(pricing.output_cost_per_token),
        cacheCreateCost: toPerMillion(pricing.cache_creation_input_token_cost),
        cacheReadCost: toPerMillion(pricing.cache_read_input_token_cost),
        contextWindow: Number(pricing.max_input_tokens) || Number(pricing.max_tokens) || null
      })
    }

    // 日期快照（claude-opus-4-5-20251101）与别名（claude-opus-4-5）同日同价时合并为一行
    const byId = new Map(items.map((item) => [`${item.provider}:${item.id}`, item]))
    const merged = items.filter((item) => {
      const match = SNAPSHOT_SUFFIX.exec(item.id)
      if (!match) {
        return true
      }
      const base = byId.get(`${item.provider}:${match[1]}`)
      if (
        base &&
        base.releaseDate === item.releaseDate &&
        base.inputCost === item.inputCost &&
        base.outputCost === item.outputCost
      ) {
        base.aliases.push(item.id)
        return false
      }
      return true
    })

    merged.sort(
      (a, b) =>
        b.releaseDate.localeCompare(a.releaseDate) ||
        PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider) ||
        a.id.localeCompare(b.id)
    )
    return merged
  }

  getStatus() {
    const catalog = this.getCatalog()
    return {
      source: catalog.source || SOURCE_URL,
      origin: catalog.origin,
      count: catalog.models.length,
      fetchedAt: catalog.fetchedAt || null,
      checkedAt: catalog.checkedAt || null,
      lastError: this.lastError
    }
  }
}

const modelReleaseService = new ModelReleaseService()
modelReleaseService.ModelReleaseService = ModelReleaseService
modelReleaseService.extractReleaseEntries = extractReleaseEntries
modelReleaseService.OFFICIAL_PROVIDERS = OFFICIAL_PROVIDERS

module.exports = modelReleaseService
