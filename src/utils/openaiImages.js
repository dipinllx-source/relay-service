/**
 * OpenAI Images（gpt-image-*）转发辅助
 *
 * 上游为 ChatGPT Codex 后端的 Images 接口，与 Codex CLI 内置 image_gen 工具同款
 * （openai/codex: codex-rs/codex-api/src/endpoint/images.rs）：
 *   POST https://chatgpt.com/backend-api/codex/images/generations  JSON
 *   POST https://chatgpt.com/backend-api/codex/images/edits        JSON，images 为 data URL / file_id
 *
 * 客户端侧兼容 OpenAI 官方 Images API：
 *   - generations：JSON
 *   - edits：JSON（images 数组）或 multipart（image / image[] 文件，转换为 data URL）
 */
const fs = require('fs')

const CODEX_IMAGES_BASE_URL = 'https://chatgpt.com/backend-api/codex/images'
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
const MAX_IMAGES_PER_REQUEST = 4
const MAX_EDIT_INPUT_IMAGES = 5
const MAX_EDIT_IMAGE_BYTES = 25 * 1024 * 1024

// 只透传上游已知字段；response_format / user / style 等官方 API 字段上游不认，直接丢弃
const PASSTHROUGH_FIELDS = [
  'prompt',
  'model',
  'n',
  'size',
  'quality',
  'background',
  'output_format',
  'output_compression',
  'moderation'
]
const INTEGER_FIELDS = ['n', 'output_compression']
const MULTIPART_IMAGE_FIELDS = ['image', 'image[]', 'images', 'images[]']

class ImageRequestError extends Error {
  constructor(message, statusCode = 400, code = 'invalid_request_error') {
    super(message)
    this.name = 'ImageRequestError'
    this.statusCode = statusCode
    this.code = code
  }
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function normalizeImageReference(ref) {
  const entry = typeof ref === 'string' ? { image_url: ref } : ref
  if (!entry || typeof entry !== 'object') {
    throw new ImageRequestError('Each entry in `images` must provide `image_url` or `file_id`')
  }
  if (typeof entry.image_url === 'string' && entry.image_url) {
    return { image_url: entry.image_url }
  }
  if (entry.image_url && typeof entry.image_url.url === 'string' && entry.image_url.url) {
    return { image_url: entry.image_url.url }
  }
  if (typeof entry.file_id === 'string' && entry.file_id) {
    return { file_id: entry.file_id }
  }
  throw new ImageRequestError('Each entry in `images` must provide `image_url` or `file_id`')
}

/**
 * 校验并规整客户端请求体，返回发往上游的 JSON。
 * @param {object} raw 客户端请求体（JSON 或由 multipart 转换而来）
 * @param {{kind: 'generations'|'edits'}} options
 */
function normalizeImageRequest(raw, { kind } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ImageRequestError('Request body must be a JSON object')
  }
  if (raw.stream === true || raw.stream === 'true') {
    throw new ImageRequestError('Streaming image generation is not supported')
  }
  if (raw.mask !== undefined && raw.mask !== null && raw.mask !== '') {
    throw new ImageRequestError('`mask` is not supported by this endpoint')
  }

  const body = {}
  for (const field of PASSTHROUGH_FIELDS) {
    const value = firstValue(raw[field])
    if (value === undefined || value === null || value === '') {
      continue
    }
    body[field] = value
  }

  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    throw new ImageRequestError('`prompt` is required')
  }

  body.model =
    typeof body.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_IMAGE_MODEL
  if (!/^gpt-image-/i.test(body.model)) {
    throw new ImageRequestError(`Unsupported image model: ${body.model}`)
  }

  for (const field of INTEGER_FIELDS) {
    if (body[field] === undefined) {
      continue
    }
    const parsed = Number(body[field])
    if (!Number.isInteger(parsed)) {
      throw new ImageRequestError(`\`${field}\` must be an integer`)
    }
    body[field] = parsed
  }
  if (body.n !== undefined && (body.n < 1 || body.n > MAX_IMAGES_PER_REQUEST)) {
    throw new ImageRequestError(`\`n\` must be between 1 and ${MAX_IMAGES_PER_REQUEST}`)
  }

  if (kind === 'edits') {
    let { images } = raw
    if (images === undefined && raw.image !== undefined) {
      images = Array.isArray(raw.image) ? raw.image : [raw.image]
    }
    if (!Array.isArray(images) || images.length === 0) {
      throw new ImageRequestError('`images` is required for image edits')
    }
    if (images.length > MAX_EDIT_INPUT_IMAGES) {
      throw new ImageRequestError(`At most ${MAX_EDIT_INPUT_IMAGES} input images are supported`)
    }
    body.images = images.map(normalizeImageReference)
  }

  return body
}

function listFiles(files, names) {
  const out = []
  for (const name of names) {
    const value = files ? files[name] : undefined
    if (!value) {
      continue
    }
    out.push(...(Array.isArray(value) ? value : [value]))
  }
  return out
}

function allFiles(files) {
  if (!files || typeof files !== 'object') {
    return []
  }
  return Object.values(files).flatMap((value) => (Array.isArray(value) ? value : [value]))
}

/**
 * 把 multipart 解析结果转换为 edits 的 JSON 请求体（文件 → data URL）。
 * readFile 可注入，便于测试。
 */
async function buildEditBodyFromMultipart(
  fields = {},
  files = {},
  readFile = fs.promises.readFile
) {
  if (listFiles(files, ['mask', 'mask[]']).length > 0) {
    throw new ImageRequestError('`mask` is not supported by this endpoint')
  }
  const imageFiles = listFiles(files, MULTIPART_IMAGE_FIELDS)
  if (imageFiles.length === 0) {
    throw new ImageRequestError('At least one `image` file is required for image edits')
  }
  if (imageFiles.length > MAX_EDIT_INPUT_IMAGES) {
    throw new ImageRequestError(`At most ${MAX_EDIT_INPUT_IMAGES} input images are supported`)
  }

  const images = []
  for (const file of imageFiles) {
    const mimeType = String(file.mimetype || file.type || 'image/png').toLowerCase()
    if (!mimeType.startsWith('image/')) {
      throw new ImageRequestError(`Unsupported file type for image edit: ${mimeType}`)
    }
    const buffer = await readFile(file.filepath || file.path)
    images.push({ image_url: `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}` })
  }

  const plainFields = {}
  for (const [key, value] of Object.entries(fields || {})) {
    plainFields[key] = firstValue(value)
  }
  return { ...plainFields, images }
}

/** 解析 multipart/form-data 的 edits 请求，结束后清理临时文件 */
function parseMultipartEditRequest(req, options = {}) {
  const formidable = require('formidable')
  const form = formidable({
    multiples: true,
    maxFiles: MAX_EDIT_INPUT_IMAGES + 1,
    maxFileSize: options.maxFileSize || MAX_EDIT_IMAGE_BYTES,
    allowEmptyFiles: false
  })

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      const cleanup = () => {
        for (const file of allFiles(files)) {
          const filePath = file && (file.filepath || file.path)
          if (filePath) {
            fs.promises.unlink(filePath).catch(() => {})
          }
        }
      }
      if (err) {
        cleanup()
        const status =
          err.httpCode && err.httpCode >= 400 && err.httpCode < 500 ? err.httpCode : 400
        reject(new ImageRequestError(`Invalid multipart body: ${err.message}`, status))
        return
      }
      buildEditBodyFromMultipart(fields, files).then(resolve, reject).finally(cleanup)
    })
  })
}

function toNonNegativeInt(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0
}

/** 从上游响应提取用量，区分文本 / 图像 token；无 usage 返回 null */
function extractImageUsage(data) {
  const usage = data && data.usage
  if (!usage || typeof usage !== 'object') {
    return null
  }
  const inputTokens = toNonNegativeInt(usage.input_tokens)
  const outputTokens = toNonNegativeInt(usage.output_tokens)
  const inputDetails = usage.input_tokens_details || {}
  const outputDetails = usage.output_tokens_details || {}

  const inputImageTokens = toNonNegativeInt(inputDetails.image_tokens)
  const inputTextTokens =
    inputDetails.text_tokens !== undefined
      ? toNonNegativeInt(inputDetails.text_tokens)
      : Math.max(0, inputTokens - inputImageTokens)
  // 图片接口的输出默认都是图像 token
  const outputImageTokens =
    outputDetails.image_tokens !== undefined
      ? toNonNegativeInt(outputDetails.image_tokens)
      : outputTokens
  const outputTextTokens =
    outputDetails.text_tokens !== undefined
      ? toNonNegativeInt(outputDetails.text_tokens)
      : Math.max(0, outputTokens - outputImageTokens)

  return {
    inputTokens,
    outputTokens,
    inputTextTokens,
    inputImageTokens,
    outputTextTokens,
    outputImageTokens
  }
}

/** 记录到请求明细的摘要：不含 prompt 原文与图片数据 */
function summarizeImageRequest(body = {}, kind = 'generations') {
  return {
    endpoint: `images/${kind}`,
    model: body.model,
    size: body.size,
    quality: body.quality,
    n: body.n,
    background: body.background,
    output_format: body.output_format,
    promptChars: typeof body.prompt === 'string' ? body.prompt.length : 0,
    imageCount: Array.isArray(body.images) ? body.images.length : 0
  }
}

/** 把上游错误（常见为 {"detail": "..."}）转换为 OpenAI 风格错误体 */
function toOpenAIErrorBody(status, data) {
  let message = null
  if (data && typeof data === 'object') {
    if (data.error && typeof data.error === 'object' && data.error.message) {
      ;({ message } = data.error)
    } else if (typeof data.detail === 'string') {
      message = data.detail
    } else if (data.detail) {
      message = JSON.stringify(data.detail)
    } else if (typeof data.message === 'string') {
      ;({ message } = data)
    }
  } else if (typeof data === 'string' && data.trim()) {
    message = data.trim().slice(0, 500)
  }

  let type = 'upstream_error'
  if (status === 400 || status === 422) {
    type = 'invalid_request_error'
  } else if (status === 401 || status === 403) {
    type = 'authentication_error'
  } else if (status === 429) {
    type = 'rate_limit_error'
  }

  return {
    error: {
      message: String(message || `Upstream image request failed (${status})`),
      type,
      code:
        (data && typeof data === 'object' && data.error && data.error.code) ||
        (data && typeof data === 'object' && typeof data.code === 'string' && data.code) ||
        null
    }
  }
}

module.exports = {
  CODEX_IMAGES_BASE_URL,
  DEFAULT_IMAGE_MODEL,
  MAX_IMAGES_PER_REQUEST,
  MAX_EDIT_INPUT_IMAGES,
  ImageRequestError,
  normalizeImageRequest,
  buildEditBodyFromMultipart,
  parseMultipartEditRequest,
  extractImageUsage,
  summarizeImageRequest,
  toOpenAIErrorBody
}
