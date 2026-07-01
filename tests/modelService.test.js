const modelService = require('../src/services/modelService')

describe('modelService.getAllModels', () => {
  it('默认返回静态列表（含 claude/openai/gemini 段）', () => {
    const models = modelService.getAllModels()
    const owners = new Set(models.map((m) => m.owned_by))

    expect(owners).toEqual(new Set(['anthropic', 'openai', 'google']))
    expect(models.some((m) => m.id === 'claude-sonnet-4-5-20250929')).toBe(true)
  })

  it('传入动态 Claude 列表时替换 claude 段，openai/gemini 段不变', () => {
    const dynamic = [
      { id: 'claude-fable-5', object: 'model', created: 1, owned_by: 'anthropic' },
      { id: 'claude-opus-4-8', object: 'model', created: 1, owned_by: 'anthropic' }
    ]
    const staticModels = modelService.getAllModels()
    const models = modelService.getAllModels({ claudeModels: dynamic })

    const claudeSection = models.filter((m) => m.owned_by === 'anthropic')
    expect(claudeSection.map((m) => m.id).sort()).toEqual(['claude-fable-5', 'claude-opus-4-8'])

    expect(models.some((m) => m.id === 'claude-3-haiku-20240307')).toBe(false)

    const nonClaude = (list) => list.filter((m) => m.owned_by !== 'anthropic').map((m) => m.id)
    expect(nonClaude(models)).toEqual(nonClaude(staticModels))
  })

  it('claudeModels 为 null / 空数组时与纯静态行为一致（降级）', () => {
    const staticIds = modelService.getAllModels().map((m) => m.id)

    expect(modelService.getAllModels({ claudeModels: null }).map((m) => m.id)).toEqual(staticIds)
    expect(modelService.getAllModels({ claudeModels: [] }).map((m) => m.id)).toEqual(staticIds)
  })

  it('黑名单过滤语义可作用于动态条目（与路由层 filter 一致）', () => {
    const dynamic = [{ id: 'claude-fable-5', object: 'model', created: 1, owned_by: 'anthropic' }]
    const models = modelService.getAllModels({ claudeModels: dynamic })
    const restrictedModels = ['claude-fable-5']

    const filtered = models.filter((m) => !restrictedModels.includes(m.id))
    expect(filtered.some((m) => m.id === 'claude-fable-5')).toBe(false)
  })

  it('getModelsByProvider("anthropic") 含补齐的当代模型（OpenAI 兼容端点兜底用）', () => {
    const claude = modelService.getModelsByProvider('anthropic')
    expect(claude.some((m) => m.id === 'claude-fable-5')).toBe(true)
    expect(claude.every((m) => m.owned_by === 'anthropic')).toBe(true)
  })
})
