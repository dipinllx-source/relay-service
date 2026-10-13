// OpenAI Images（gpt-image-*）转发辅助与计价

jest.mock('../src/services/pricingService', () => ({
  calculateCost: jest.fn(),
  getModelPricing: jest.fn()
}))

jest.mock('../src/utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn(),
  database: jest.fn(),
  api: jest.fn(),
  security: jest.fn()
}))

const openaiImages = require('../src/utils/openaiImages')

// 价格取自 LiteLLM 原版 gpt-image-2 条目
const GPT_IMAGE_2_PRICING = {
  input_cost_per_token: 0.000005,
  input_cost_per_image_token: 0.000008,
  output_cost_per_image_token: 0.00003,
  cache_read_input_token_cost: 0.00000125,
  litellm_provider: 'openai',
  mode: 'image_generation'
}

describe('normalizeImageRequest', () => {
  it('defaults the model to gpt-image-2 and drops fields the upstream does not accept', () => {
    const body = openaiImages.normalizeImageRequest(
      {
        prompt: 'a red fox',
        size: '1024x1024',
        quality: 'low',
        response_format: 'b64_json',
        user: 'u-1',
        style: 'vivid'
      },
      { kind: 'generations' }
    )
    expect(body).toEqual({
      prompt: 'a red fox',
      size: '1024x1024',
      quality: 'low',
      model: 'gpt-image-2'
    })
  })

  it('coerces integer fields coming from multipart strings', () => {
    const body = openaiImages.normalizeImageRequest(
      { prompt: 'x', n: '2', output_compression: '80', model: 'gpt-image-1.5' },
      { kind: 'generations' }
    )
    expect(body).toMatchObject({ n: 2, output_compression: 80, model: 'gpt-image-1.5' })
  })

  it.each([
    [{}, '`prompt` is required'],
    [{ prompt: '   ' }, '`prompt` is required'],
    [{ prompt: 'x', model: 'gpt-6.1-sol' }, 'Unsupported image model: gpt-6.1-sol'],
    [{ prompt: 'x', n: 5 }, '`n` must be between 1 and 4'],
    [{ prompt: 'x', n: 'two' }, '`n` must be an integer'],
    [{ prompt: 'x', stream: true }, 'Streaming image generation is not supported'],
    [{ prompt: 'x', mask: 'data:image/png;base64,AA' }, '`mask` is not supported by this endpoint']
  ])('rejects invalid input %j', (raw, message) => {
    expect(() => openaiImages.normalizeImageRequest(raw, { kind: 'generations' })).toThrow(message)
  })

  it('normalizes edit image references and enforces the count limit', () => {
    const body = openaiImages.normalizeImageRequest(
      {
        prompt: 'add a hat',
        images: [
          'data:image/png;base64,AA',
          { image_url: { url: 'https://example.com/a.png' } },
          { file_id: 'file-1' }
        ]
      },
      { kind: 'edits' }
    )
    expect(body.images).toEqual([
      { image_url: 'data:image/png;base64,AA' },
      { image_url: 'https://example.com/a.png' },
      { file_id: 'file-1' }
    ])

    expect(() => openaiImages.normalizeImageRequest({ prompt: 'x' }, { kind: 'edits' })).toThrow(
      '`images` is required for image edits'
    )
    expect(() =>
      openaiImages.normalizeImageRequest(
        { prompt: 'x', images: new Array(6).fill('data:image/png;base64,AA') },
        { kind: 'edits' }
      )
    ).toThrow('At most 5 input images are supported')
  })
})

describe('buildEditBodyFromMultipart', () => {
  const readFile = jest.fn(async (filePath) => Buffer.from(`bytes:${filePath}`))

  it('converts uploaded files to data URLs and flattens fields', async () => {
    const body = await openaiImages.buildEditBodyFromMultipart(
      { prompt: ['add a hat'], size: ['1024x1024'] },
      {
        'image[]': [
          { filepath: '/tmp/a', mimetype: 'image/png' },
          { filepath: '/tmp/b', mimetype: 'image/jpeg' }
        ]
      },
      readFile
    )
    expect(body).toEqual({
      prompt: 'add a hat',
      size: '1024x1024',
      images: [
        { image_url: `data:image/png;base64,${Buffer.from('bytes:/tmp/a').toString('base64')}` },
        { image_url: `data:image/jpeg;base64,${Buffer.from('bytes:/tmp/b').toString('base64')}` }
      ]
    })
  })

  it('rejects masks, missing images and non-image files', async () => {
    await expect(
      openaiImages.buildEditBodyFromMultipart(
        { prompt: 'x' },
        { image: { filepath: '/tmp/a', mimetype: 'image/png' }, mask: { filepath: '/tmp/m' } },
        readFile
      )
    ).rejects.toThrow('`mask` is not supported by this endpoint')
    await expect(
      openaiImages.buildEditBodyFromMultipart({ prompt: 'x' }, {}, readFile)
    ).rejects.toThrow('At least one `image` file is required for image edits')
    await expect(
      openaiImages.buildEditBodyFromMultipart(
        { prompt: 'x' },
        { image: { filepath: '/tmp/a', mimetype: 'application/pdf' } },
        readFile
      )
    ).rejects.toThrow('Unsupported file type for image edit: application/pdf')
  })
})

describe('extractImageUsage', () => {
  it('splits text and image tokens from the upstream usage block', () => {
    expect(
      openaiImages.extractImageUsage({
        usage: {
          input_tokens: 19,
          input_tokens_details: { image_tokens: 0, text_tokens: 19 },
          output_tokens: 515,
          output_tokens_details: { image_tokens: 515, text_tokens: 0 }
        }
      })
    ).toEqual({
      inputTokens: 19,
      outputTokens: 515,
      inputTextTokens: 19,
      inputImageTokens: 0,
      outputTextTokens: 0,
      outputImageTokens: 515
    })
  })

  it('treats output as image tokens when details are missing and returns null without usage', () => {
    expect(
      openaiImages.extractImageUsage({ usage: { input_tokens: 10, output_tokens: 20 } })
    ).toMatchObject({ inputTextTokens: 10, outputImageTokens: 20, outputTextTokens: 0 })
    expect(openaiImages.extractImageUsage({ data: [] })).toBeNull()
  })
})

describe('toOpenAIErrorBody', () => {
  it('maps upstream detail errors to OpenAI error shape', () => {
    expect(
      openaiImages.toOpenAIErrorBody(429, { detail: 'Image generation limit reached' })
    ).toEqual({
      error: { message: 'Image generation limit reached', type: 'rate_limit_error', code: null }
    })
    expect(openaiImages.toOpenAIErrorBody(401, {}).error).toMatchObject({
      type: 'authentication_error',
      message: 'Upstream image request failed (401)'
    })
  })
})

describe('CostCalculator.calculateImageGenerationCost', () => {
  let CostCalculator
  let pricingService

  beforeEach(() => {
    jest.resetModules()
    pricingService = require('../src/services/pricingService')
    CostCalculator = require('../src/utils/costCalculator')
    pricingService.getModelPricing.mockReset()
  })

  it('prices text input, image input and image output separately (LiteLLM rules)', () => {
    pricingService.getModelPricing.mockReturnValue(GPT_IMAGE_2_PRICING)
    const result = CostCalculator.calculateImageGenerationCost(
      {
        inputTokens: 1019,
        outputTokens: 515,
        inputTextTokens: 19,
        inputImageTokens: 1000,
        outputTextTokens: 0,
        outputImageTokens: 515
      },
      'gpt-image-2'
    )
    expect(pricingService.getModelPricing).toHaveBeenCalledWith('gpt-image-2')
    expect(result.costs.input).toBeCloseTo(19 * 0.000005 + 1000 * 0.000008, 12)
    expect(result.costs.output).toBeCloseTo(515 * 0.00003, 12)
    expect(result.costs.total).toBeCloseTo(19 * 0.000005 + 1000 * 0.000008 + 515 * 0.00003, 12)
    expect(result.usage).toMatchObject({ inputTokens: 1019, outputTokens: 515, totalTokens: 1534 })
    expect(result.pricing).toMatchObject({ input: 5, inputImage: 8, output: 30 })
  })

  it('records zero cost (and warns) when the model has no pricing data', () => {
    pricingService.getModelPricing.mockReturnValue(null)
    const result = CostCalculator.calculateImageGenerationCost(
      { inputTokens: 10, outputTokens: 10, inputTextTokens: 10, outputImageTokens: 10 },
      'gpt-image-9'
    )
    expect(result.costs.total).toBe(0)
    expect(result.debug.usedFallbackPricing).toBe(true)
  })
})
