/**
 * 模型价格表来源配置
 *
 * 默认：直接使用 LiteLLM 官方价格表（BerriAI/litellm main 分支），通过 HTTP ETag 判断是否更新，
 *       不再依赖单独的 .sha256 哈希文件。
 * 自定义镜像：设置 PRICE_MIRROR_REPO / PRICE_MIRROR_BRANCH / PRICE_MIRROR_BASE_URL 任一项时，
 *       按旧镜像格式拉取 <base>/<file>.json，并使用 <base>/<file>.sha256 做哈希校验。
 * PRICE_MIRROR_JSON_URL / PRICE_MIRROR_HASH_URL 可直接指定完整地址（优先级最高）；
 *       未配置哈希地址时自动使用 ETag 轮询。
 */
const LITELLM_PRICING_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

const pricingFileName = process.env.PRICE_MIRROR_FILENAME || 'model_prices_and_context_window.json'
const hashFileName =
  process.env.PRICE_MIRROR_HASH_FILENAME || 'model_prices_and_context_window.sha256'

const useCustomMirror = !!(
  process.env.PRICE_MIRROR_REPO ||
  process.env.PRICE_MIRROR_BRANCH ||
  process.env.PRICE_MIRROR_BASE_URL
)

let pricingUrl = LITELLM_PRICING_URL
let hashUrl = null

if (useCustomMirror) {
  const repository = process.env.PRICE_MIRROR_REPO || 'Wei-Shaw/claude-relay-service'
  const branch = process.env.PRICE_MIRROR_BRANCH || 'price-mirror'
  const baseUrl = process.env.PRICE_MIRROR_BASE_URL
    ? process.env.PRICE_MIRROR_BASE_URL.replace(/\/$/, '')
    : `https://raw.githubusercontent.com/${repository}/${branch}`

  pricingUrl = `${baseUrl}/${pricingFileName}`
  hashUrl = `${baseUrl}/${hashFileName}`
}

module.exports = {
  LITELLM_PRICING_URL,
  pricingFileName,
  hashFileName,
  useCustomMirror,
  pricingUrl: process.env.PRICE_MIRROR_JSON_URL || pricingUrl,
  hashUrl: process.env.PRICE_MIRROR_HASH_URL || hashUrl
}
