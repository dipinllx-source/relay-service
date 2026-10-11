/**
 * PricingService 长上下文计费测试
 *
 * 根据 Anthropic 官方定价页面（https://platform.claude.com/docs/en/about-claude/pricing）：
 * - 所有 Claude 模型均为统一价格，无论上下文长度如何（1M token 内无额外加价）
 * - Fast Mode 倍率仍适用（Opus 4.6）
 * - 非 Claude 模型的 200K+ 分层计费逻辑仍保留
 */

// Mock logger to avoid console output during tests
jest.mock('../src/utils/logger', () => ({
  api: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn(),
  database: jest.fn(),
  security: jest.fn()
}))

// Mock fs to control pricing data
jest.mock('fs', () => {
  const actual = jest.requireActual('fs')
  return {
    ...actual,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    statSync: jest.fn(),
    watchFile: jest.fn(),
    unwatchFile: jest.fn()
  }
})

describe('PricingService - Long Context Pricing', () => {
  let pricingService
  let fs
  const path = require('path')

  // 使用随代码发布的 LiteLLM 价格快照 + 补充价格（与线上合并规则一致）
  const realFs = jest.requireActual('fs')
  const resourcesDir = path.join(process.cwd(), 'resources', 'model-pricing')
  const snapshotPath = path.join(resourcesDir, 'model_prices_and_context_window.json')
  const supplementsPath = path.join(resourcesDir, 'model_pricing_supplements.json')
  const snapshotData = JSON.parse(realFs.readFileSync(snapshotPath, 'utf8'))
  const supplementsContent = realFs.readFileSync(supplementsPath, 'utf8')

  beforeEach(() => {
    // 清除缓存的模块
    jest.resetModules()
    fs = require('fs')

    // 配置 fs mock（防止 pricingService 初始化时的文件副作用）
    // 补充价格文件返回真实内容；覆盖文件不存在
    fs.existsSync.mockImplementation((p) => !String(p).endsWith('model_pricing_overrides.json'))
    fs.readFileSync.mockImplementation((p) =>
      String(p) === supplementsPath ? supplementsContent : JSON.stringify(snapshotData)
    )
    fs.statSync.mockReturnValue({ mtime: new Date(), mtimeMs: Date.now() })
    fs.watchFile.mockImplementation(() => {})
    fs.unwatchFile.mockImplementation(() => {})

    // 重新加载 pricingService
    pricingService = require('../src/services/pricingService')

    // 直接设置真实价格数据（绕过网络初始化），经过本地补充/覆盖合并
    pricingService.setPricingData(snapshotData)
  })

  afterEach(() => {
    // 清理定时器
    if (pricingService.cleanup) {
      pricingService.cleanup()
    }
    jest.clearAllMocks()
  })

  describe('Claude 模型平坦计费（无 200K+ 加价）', () => {
    it('199999 tokens - 应使用基础价格', () => {
      const usage = {
        input_tokens: 199999,
        output_tokens: 1000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      }

      const result = pricingService.calculateCost(usage, 'claude-sonnet-4-20250514[1m]')

      expect(result.isLongContextRequest).toBe(false)
      expect(result.pricing.input).toBe(0.000003) // 基础价格
      expect(result.pricing.output).toBe(0.000015) // 基础价格
    })

    it('200001 tokens - Claude 模型应使用基础价格（无 200K+ 加价）', () => {
      const usage = {
        input_tokens: 200001,
        output_tokens: 1000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      }

      const result = pricingService.calculateCost(usage, 'claude-sonnet-4-20250514[1m]')

      // 官方定价：Claude 模型全局统一价格，超过 200K 不加价
      expect(result.isLongContextRequest).toBe(false)
      expect(result.pricing.input).toBe(0.000003) // 基础价格
      expect(result.pricing.output).toBe(0.000015) // 基础价格
    })

    it('分散在各类 token 中总计超过 200K 时 Claude 仍使用基础价格', () => {
      const usage = {
        input_tokens: 150000,
        output_tokens: 10000,
        cache_creation_input_tokens: 40000,
        cache_read_input_tokens: 20000
      }
      // Total: 150000 + 40000 + 20000 = 210000 > 200000

      const result = pricingService.calculateCost(usage, 'claude-sonnet-4-20250514[1m]')

      expect(result.isLongContextRequest).toBe(false)
      expect(result.pricing.input).toBe(0.000003) // 基础价格
      expect(result.pricing.output).toBe(0.000015) // 基础价格
      expect(result.pricing.cacheCreate).toBe(0.00000375) // 基础价格
      expect(result.pricing.cacheRead).toBeCloseTo(0.0000003, 12) // 基础价格
    })

    it('仅 cache tokens 超过 200K 时 Claude 也使用基础价格', () => {
      const usage = {
        input_tokens: 50000,
        output_tokens: 5000,
        cache_creation_input_tokens: 100000,
        cache_read_input_tokens: 60000
      }
      // Total: 50000 + 100000 + 60000 = 210000 > 200000

      const result = pricingService.calculateCost(usage, 'claude-sonnet-4-20250514[1m]')

      expect(result.isLongContextRequest).toBe(false)
      expect(result.pricing.input).toBe(0.000003) // 基础价格
    })

    it('claude-sonnet-4-5 超过 200K 时也使用基础价格', () => {
      const usage = {
        input_tokens: 300000,
        output_tokens: 5000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      }

      const result = pricingService.calculateCost(usage, 'claude-sonnet-4-5[1m]')

      expect(result.isLongContextRequest).toBe(false)
      expect(result.pricing.input).toBe(0.000003) // 基础价格 $3/MTok
      expect(result.pricing.output).toBe(0.000015) // 基础价格 $15/MTok
    })

    it('claude-sonnet-4-6 超过 200K 时也使用基础价格', () => {
      const usage = {
        input_tokens: 500000,
        output_tokens: 10000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      }

      const result = pricingService.calculateCost(usage, 'claude-sonnet-4-6[1m]')

      expect(result.isLongContextRequest).toBe(false)
      expect(result.pricing.input).toBe(0.000003) // 基础价格 $3/MTok
      expect(result.pricing.output).toBe(0.000015) // 基础价格 $15/MTok
    })
  })

  describe('详细缓存创建数据（ephemeral_5m / ephemeral_1h）', () => {
    it('超过 200K 时 Claude 缓存价格仍使用基础价格', () => {
      const usage = {
        input_tokens: 200001,
        output_tokens: 1000,
        cache_creation_input_tokens: 10000,
        cache_read_input_tokens: 0,
        cache_creation: {
          ephemeral_5m_input_tokens: 5000,
          ephemeral_1h_input_tokens: 5000
        }
      }

      const result = pricingService.calculateCost(usage, 'claude-sonnet-4-20250514[1m]')

      expect(result.isLongContextRequest).toBe(false)
      // ephemeral_5m: 5000 * 0.00000375 = 0.00001875（基础 cache_creation 价格）
      expect(result.ephemeral5mCost).toBeCloseTo(5000 * 0.00000375, 10)
      // ephemeral_1h: 5000 * 0.000006（基础 1hr cache 价格）
      expect(result.pricing.ephemeral1h).toBeCloseTo(0.000006, 10)
      expect(result.ephemeral1hCost).toBeCloseTo(5000 * 0.000006, 10)
    })
  })

  describe('context-1m beta header 不影响 Claude 计费', () => {
    it('无 [1m] 后缀但带 context-1m beta 且超过 200K，Claude 仍使用基础价格', () => {
      const usage = {
        input_tokens: 210000,
        output_tokens: 1000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        request_anthropic_beta: 'context-1m-2025-08-07'
      }

      const result = pricingService.calculateCost(usage, 'claude-sonnet-4-20250514')

      // Claude 模型统一定价，无论是否带 beta 头都不应有额外加价
      expect(result.isLongContextRequest).toBe(false)
      expect(result.pricing.input).toBe(0.000003) // 基础价格
      expect(result.pricing.output).toBe(0.000015) // 基础价格
    })
  })

  describe('Fast Mode 计费（Opus 4.6）', () => {
    it('Opus 4.6 在 fast-mode beta + speed=fast 时应用 Fast Mode 6x', () => {
      const usage = {
        input_tokens: 100000,
        output_tokens: 20000,
        cache_creation_input_tokens: 10000,
        cache_read_input_tokens: 5000,
        request_anthropic_beta: 'fast-mode-2026-02-01',
        speed: 'fast'
      }

      const result = pricingService.calculateCost(usage, 'claude-opus-4-6')

      // input: 0.000005 * 6 = 0.00003
      expect(result.pricing.input).toBeCloseTo(0.00003, 12)
      // output: 0.000025 * 6 = 0.00015
      expect(result.pricing.output).toBeCloseTo(0.00015, 12)
      // cache create/read 由 fast 后 input 推导
      expect(result.pricing.cacheCreate).toBeCloseTo(0.0000375, 12) // 0.00003 * 1.25
      expect(result.pricing.cacheRead).toBeCloseTo(0.000003, 12) // 0.00003 * 0.1
      expect(result.pricing.ephemeral1h).toBeCloseTo(0.00006, 12) // 0.00003 * 2
    })

    it('Opus 4.6 在 fast-mode + [1m] 且超过 200K 时不叠加长上下文加价', () => {
      const usage = {
        input_tokens: 210000,
        output_tokens: 1000,
        cache_creation_input_tokens: 10000,
        cache_read_input_tokens: 10000,
        request_anthropic_beta: 'fast-mode-2026-02-01,context-1m-2025-08-07',
        speed: 'fast'
      }

      const result = pricingService.calculateCost(usage, 'claude-opus-4-6[1m]')

      expect(result.isLongContextRequest).toBe(false)
      // input: 0.000005（200K+ 维持同价）-> fast 6x => 0.00003
      expect(result.pricing.input).toBeCloseTo(0.00003, 12)
      // output: 0.000025（200K+ 维持同价）-> fast 6x => 0.00015
      expect(result.pricing.output).toBeCloseTo(0.00015, 12)
    })

    it('Opus 4.6 在 [1m] 且超过 200K、未开启 fast-mode 时保持基础价格', () => {
      const usage = {
        input_tokens: 210000,
        output_tokens: 1000,
        cache_creation_input_tokens: 10000,
        cache_read_input_tokens: 10000,
        request_anthropic_beta: 'context-1m-2025-08-07'
      }

      const result = pricingService.calculateCost(usage, 'claude-opus-4-6[1m]')

      expect(result.isLongContextRequest).toBe(false)
      expect(result.pricing.input).toBeCloseTo(0.000005, 12)
      expect(result.pricing.output).toBeCloseTo(0.000025, 12)
      expect(result.pricing.cacheCreate).toBeCloseTo(0.00000625, 12)
      expect(result.pricing.cacheRead).toBeCloseTo(0.0000005, 12)
    })
  })

  describe('兼容性测试', () => {
    it('非 [1m] 模型不受影响，始终使用基础价格', () => {
      const usage = {
        input_tokens: 250000,
        output_tokens: 1000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      }

      // 不带 [1m] 后缀
      const result = pricingService.calculateCost(usage, 'claude-sonnet-4-20250514')

      expect(result.isLongContextRequest).toBe(false)
      expect(result.pricing.input).toBe(0.000003) // 基础价格
      expect(result.pricing.output).toBe(0.000015) // 基础价格
      expect(result.pricing.cacheCreate).toBe(0.00000375) // 基础价格
      expect(result.pricing.cacheRead).toBeCloseTo(0.0000003, 12) // 基础价格
    })

    it('[1m] 模型未超过 200K 时使用基础价格', () => {
      const usage = {
        input_tokens: 100000,
        output_tokens: 1000,
        cache_creation_input_tokens: 50000,
        cache_read_input_tokens: 49000
      }
      // Total: 199000 < 200000

      const result = pricingService.calculateCost(usage, 'claude-sonnet-4-20250514[1m]')

      expect(result.isLongContextRequest).toBe(false)
      expect(result.pricing.input).toBe(0.000003) // 基础价格
    })

    it('无定价数据时返回 hasPricing=false', () => {
      const usage = {
        input_tokens: 250000,
        output_tokens: 1000
      }

      const result = pricingService.calculateCost(usage, 'unknown-model[1m]')

      expect(result.hasPricing).toBe(false)
      expect(result.totalCost).toBe(0)
    })
  })

  describe('成本计算准确性（基础价格）', () => {
    it('应正确以基础价格计算超过 200K 场景下的总成本', () => {
      const usage = {
        input_tokens: 150000,
        output_tokens: 10000,
        cache_creation_input_tokens: 40000,
        cache_read_input_tokens: 20000
      }
      // Total input: 210000 > 200000，但 Claude 使用基础价格

      const result = pricingService.calculateCost(usage, 'claude-sonnet-4-20250514[1m]')

      // 手动计算预期成本（全部使用基础价格）
      const expectedInputCost = 150000 * 0.000003 // $0.45
      const expectedOutputCost = 10000 * 0.000015 // $0.15
      const expectedCacheCreateCost = 40000 * 0.00000375 // $0.15
      const expectedCacheReadCost = 20000 * 0.0000003 // $0.006
      const expectedTotal =
        expectedInputCost + expectedOutputCost + expectedCacheCreateCost + expectedCacheReadCost

      expect(result.inputCost).toBeCloseTo(expectedInputCost, 10)
      expect(result.outputCost).toBeCloseTo(expectedOutputCost, 10)
      expect(result.cacheCreateCost).toBeCloseTo(expectedCacheCreateCost, 10)
      expect(result.cacheReadCost).toBeCloseTo(expectedCacheReadCost, 10)
      expect(result.totalCost).toBeCloseTo(expectedTotal, 10)
    })
  })
  describe('服务档位计费（LiteLLM 规则，不依赖 supports_service_tier）', () => {
    const usage = {
      input_tokens: 10000,
      output_tokens: 2000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 5000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }
    }

    it('gpt-6.1-sol priority 使用档位价', () => {
      const result = pricingService.calculateCost(usage, 'gpt-6.1-sol', 'priority')

      expect(result.serviceTier).toBe('priority')
      expect(result.pricing.input).toBeCloseTo(0.000004, 12)
      expect(result.pricing.output).toBeCloseTo(0.00002, 12)
      expect(result.pricing.cacheRead).toBeCloseTo(2e-7, 14)
      expect(result.totalCost).toBeCloseTo(10000 * 0.000004 + 2000 * 0.00002 + 5000 * 2e-7, 10)
    })

    it('gpt-6.1-sol flex 使用半价', () => {
      const result = pricingService.calculateCost(usage, 'gpt-6.1-sol', 'flex')

      expect(result.pricing.input).toBeCloseTo(0.000001, 12)
      expect(result.pricing.output).toBeCloseTo(0.000005, 12)
      expect(result.pricing.cacheRead).toBeCloseTo(5e-8, 14)
    })

    it('未传档位或 auto 时使用标准价', () => {
      for (const tier of [null, 'auto', 'default']) {
        const result = pricingService.calculateCost(usage, 'gpt-6.1-sol', tier)
        expect(result.serviceTier).toBeNull()
        expect(result.pricing.input).toBeCloseTo(0.000002, 12)
        expect(result.pricing.output).toBeCloseTo(0.00001, 12)
      }
    })

    it('超过 272K + priority 使用带档位的长上下文价', () => {
      const result = pricingService.calculateCost(
        { input_tokens: 300000, output_tokens: 1000, cache_read_input_tokens: 0 },
        'gpt-6.1-sol',
        'priority'
      )

      expect(result.isLongContextRequest).toBe(true)
      expect(result.longContextThreshold).toBe('272k')
      expect(result.pricing.input).toBeCloseTo(0.000008, 12)
      expect(result.pricing.output).toBeCloseTo(0.00003, 12)
    })

    it('档位键缺失时回退标准价', () => {
      pricingService.pricingData = {
        'tierless-model': { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 }
      }
      const result = pricingService.calculateCost(
        { input_tokens: 1000, output_tokens: 1000 },
        'tierless-model',
        'priority'
      )

      expect(result.pricing.input).toBe(0.000001)
      expect(result.pricing.output).toBe(0.000002)
    })
  })

  describe('模型价格查找（模糊匹配过滤）', () => {
    it('不会模糊匹配到 chatgpt/ 等带供应商前缀或无价格的条目', () => {
      pricingService.pricingData = {
        'chatgpt/foo-model': { litellm_provider: 'chatgpt', mode: 'responses' },
        'openrouter/foo-model': { input_cost_per_token: 1, output_cost_per_token: 1 },
        'azure.foo-model': { input_cost_per_token: 2, output_cost_per_token: 2 },
        'foo-model-pro': { input_cost_per_token: 0.00003, output_cost_per_token: 0.00018 },
        'foo-model-pro-max': { input_cost_per_token: 0.00006, output_cost_per_token: 0.0003 }
      }

      const pricing = pricingService.getModelPricing('foo-model')
      // 选择包含模型名的最短有效键
      expect(pricing.input_cost_per_token).toBe(0.00003)
    })

    it('优先选择被模型名包含的最长键（带日期后缀的模型）', () => {
      const pricing = pricingService.getModelPricing('gpt-6.1-sol-2099-01-01')

      expect(pricing).toBe(pricingService.pricingData['gpt-6.1-sol'])
    })

    it('价格数据替换后查找缓存自动失效', () => {
      pricingService.pricingData = { 'bar-model-v1': { input_cost_per_token: 1 } }
      expect(pricingService.getModelPricing('bar-model').input_cost_per_token).toBe(1)

      pricingService.pricingData = { 'bar-model-v2': { input_cost_per_token: 2 } }
      expect(pricingService.getModelPricing('bar-model').input_cost_per_token).toBe(2)
    })

    it('找不到时返回 null 且不抛错', () => {
      expect(pricingService.getModelPricing('totally-unknown-xyz')).toBeNull()
    })
  })

  describe('本地补充 / 覆盖价格', () => {
    it('补充文件提供 LiteLLM 原版缺失的模型', () => {
      expect(snapshotData['claude-sonnet-4-20250514']).toBeUndefined()
      expect(pricingService.pricingData['claude-sonnet-4-20250514']).toBeDefined()
      expect(pricingService.pricingData['claude-sonnet-4-20250514'].input_cost_per_token).toBe(
        0.000003
      )
    })

    it('补充文件不覆盖上游已有模型', () => {
      fs.readFileSync.mockImplementation((p) =>
        String(p) === supplementsPath
          ? JSON.stringify({
              _comment: 'ignored',
              'gpt-6.1-sol': { input_cost_per_token: 999 },
              'only-in-supplements': { input_cost_per_token: 1 }
            })
          : '{}'
      )

      const merged = pricingService.applyLocalPricing(snapshotData)

      expect(merged['gpt-6.1-sol'].input_cost_per_token).toBe(0.000002)
      expect(merged['only-in-supplements'].input_cost_per_token).toBe(1)
      expect(merged._comment).toBeUndefined()
    })

    it('覆盖文件按字段覆盖上游，优先级最高', () => {
      fs.existsSync.mockReturnValue(true)
      fs.readFileSync.mockImplementation((p) => {
        if (String(p).endsWith('model_pricing_overrides.json')) {
          return JSON.stringify({
            _comment: 'ignored',
            'gpt-6.1-sol': { input_cost_per_token_priority: 0.00001 }
          })
        }
        return '{}'
      })

      const merged = pricingService.applyLocalPricing(snapshotData)

      expect(merged['gpt-6.1-sol'].input_cost_per_token_priority).toBe(0.00001)
      // 其他字段保持上游
      expect(merged['gpt-6.1-sol'].output_cost_per_token_priority).toBe(0.00002)
      // 不修改上游原始对象
      expect(snapshotData['gpt-6.1-sol'].input_cost_per_token_priority).toBe(0.000004)
    })

    it('补充/覆盖文件损坏时忽略并保留上游数据', () => {
      fs.existsSync.mockReturnValue(true)
      fs.readFileSync.mockReturnValue('not-json')

      const merged = pricingService.applyLocalPricing({ a: { input_cost_per_token: 1 } })

      expect(merged).toEqual({ a: { input_cost_per_token: 1 } })
    })
  })

  describe('ETag 条件请求同步', () => {
    const { EventEmitter } = require('events')
    let https

    const mockHttpsResponse = (statusCode, body = '', headers = {}) => {
      https.get.mockImplementation((url, options, callback) => {
        const req = new EventEmitter()
        req.setTimeout = jest.fn()
        req.destroy = jest.fn()
        const res = new EventEmitter()
        res.statusCode = statusCode
        res.statusMessage = String(statusCode)
        res.headers = headers
        res.resume = jest.fn()
        process.nextTick(() => {
          callback(res)
          if (body) {
            res.emit('data', Buffer.from(body))
          }
          res.emit('end')
        })
        return req
      })
    }

    beforeEach(() => {
      https = require('https')
      jest.spyOn(https, 'get')
      fs.readFileSync.mockImplementation((p) => {
        if (String(p).endsWith('model_pricing.etag')) {
          return '"etag-v1"\n'
        }
        if (String(p) === supplementsPath) {
          return supplementsContent
        }
        return JSON.stringify(snapshotData)
      })
    })

    afterEach(() => {
      https.get.mockRestore()
    })

    it('远端返回 304 时不重新下载、不写文件', async () => {
      mockHttpsResponse(304)
      const before = pricingService.pricingData

      await pricingService.syncWithRemoteEtag()

      const [, options] = https.get.mock.calls[0]
      expect(options.headers['If-None-Match']).toBe('"etag-v1"')
      expect(fs.writeFileSync).not.toHaveBeenCalled()
      expect(pricingService.pricingData).toBe(before)
    })

    it('远端返回 200 时写入原始内容与新 ETag，并合并补充价格', async () => {
      const upstream = { 'new-model': { input_cost_per_token: 0.000001 } }
      mockHttpsResponse(200, JSON.stringify(upstream), { etag: '"etag-v2"' })

      await pricingService.syncWithRemoteEtag()

      const writes = fs.writeFileSync.mock.calls.map(([file, content]) => [String(file), content])
      expect(writes).toEqual(
        expect.arrayContaining([
          [pricingService.pricingFile, JSON.stringify(upstream)],
          [pricingService.localEtagFile, '"etag-v2"\n']
        ])
      )
      expect(pricingService.pricingData['new-model']).toEqual(upstream['new-model'])
      expect(pricingService.pricingData['claude-sonnet-4-20250514']).toBeDefined()
    })

    it('远端返回非法内容时保留现有数据', async () => {
      mockHttpsResponse(200, '[]', { etag: '"etag-v3"' })
      const before = pricingService.pricingData

      await expect(pricingService.syncWithRemoteEtag()).rejects.toThrow('Invalid pricing data')
      expect(pricingService.pricingData).toBe(before)
    })
  })
})
