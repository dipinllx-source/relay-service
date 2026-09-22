// modelListFilter — 权限分段 / 账号裁剪 / restrictedModels 黑名单

let mockEnforcePermissionFilter = true

jest.mock('../config/config', () => ({
  get models() {
    return { enforcePermissionFilter: mockEnforcePermissionFilter }
  }
}))

jest.mock('../src/services/apiKeyService', () => ({
  hasPermission: jest.fn()
}))

const apiKeyService = require('../src/services/apiKeyService')
const {
  filterByPermission,
  filterByAccountScope,
  filterByRestriction,
  filterModelsForApiKey,
  getAllowedOwners
} = require('../src/utils/modelListFilter')

const MODELS = [
  { id: 'claude-opus-5', owned_by: 'anthropic' },
  { id: 'gpt-5.6-sol', owned_by: 'openai' },
  { id: 'gemini-3-pro-preview', owned_by: 'google' },
  { id: 'future-model', owned_by: 'someone-new' }
]

// 还原真实的 hasPermission 语义：空 permissions = 全部服务
function realHasPermission(permissions, service) {
  const perms = Array.isArray(permissions) ? permissions : []
  return perms.length === 0 || perms.includes(service)
}

beforeEach(() => {
  mockEnforcePermissionFilter = true
  apiKeyService.hasPermission.mockReset().mockImplementation(realHasPermission)
})

describe('权限分段过滤', () => {
  test('空 permissions 视为全部服务，存量 Key 不受影响', () => {
    const result = filterByPermission(MODELS, { permissions: [] })
    expect(result.denied).toBe(false)
    expect(result.models).toHaveLength(4)
  })

  test('只有 claude 权限时只返回 anthropic 段', () => {
    const result = filterByPermission(MODELS, { permissions: ['claude'] })
    expect(result.denied).toBe(false)
    expect(result.models.map((m) => m.id)).toEqual(['claude-opus-5', 'future-model'])
  })

  test('只有 gemini 权限时只返回 google 段', () => {
    const result = filterByPermission(MODELS, { permissions: ['gemini'] })
    expect(result.models.map((m) => m.id)).toEqual(['gemini-3-pro-preview', 'future-model'])
  })

  test('三段全无权限时 denied=true，由调用方返回 403', () => {
    const result = filterByPermission(MODELS, { permissions: ['droid'] })
    expect(result.denied).toBe(true)
    expect(result.models).toEqual([])
  })

  test('未知 owned_by 默认放行，避免新 provider 被静默吞掉', () => {
    const result = filterByPermission(MODELS, { permissions: ['claude'] })
    expect(result.models.map((m) => m.id)).toContain('future-model')
  })

  test('开关关闭时完全不过滤', () => {
    mockEnforcePermissionFilter = false
    const result = filterByPermission(MODELS, { permissions: ['droid'] })
    expect(result.denied).toBe(false)
    expect(result.models).toHaveLength(4)
  })

  test('getAllowedOwners 按三段映射服务名', () => {
    expect([...getAllowedOwners(['openai'])]).toEqual(['openai'])
    expect([...getAllowedOwners([])].sort()).toEqual(['anthropic', 'google', 'openai'])
  })
})

describe('账号级裁剪', () => {
  test('scope 为 null 时不裁剪', () => {
    expect(filterByAccountScope(MODELS, null)).toHaveLength(4)
  })

  test('scope 非空时取交集', () => {
    const scope = new Set(['claude-opus-5'])
    expect(filterByAccountScope(MODELS, scope).map((m) => m.id)).toEqual(['claude-opus-5'])
  })
})

describe('restrictedModels 黑名单', () => {
  test('未开启限制时不过滤', () => {
    const result = filterByRestriction(MODELS, { restrictedModels: ['claude-opus-5'] })
    expect(result).toHaveLength(4)
  })

  test('开启后过滤掉受限模型（黑名单语义）', () => {
    const result = filterByRestriction(MODELS, {
      enableModelRestriction: true,
      restrictedModels: ['claude-opus-5']
    })
    expect(result.map((m) => m.id)).not.toContain('claude-opus-5')
    expect(result).toHaveLength(3)
  })
})

describe('组合入口', () => {
  test('三层依次生效', () => {
    const { models, denied } = filterModelsForApiKey(MODELS, {
      permissions: ['claude'],
      enableModelRestriction: true,
      restrictedModels: ['future-model']
    })
    expect(denied).toBe(false)
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5'])
  })

  test('skipPermissionFilter 时跳过权限层（端点入口已校验）', () => {
    const { models } = filterModelsForApiKey(MODELS, {
      permissions: ['droid']
    }, { skipPermissionFilter: true })
    expect(models).toHaveLength(4)
  })

  test('denied 时返回空数组', () => {
    const { models, denied } = filterModelsForApiKey(MODELS, { permissions: ['droid'] })
    expect(denied).toBe(true)
    expect(models).toEqual([])
  })

  test('非数组输入安全降级为空列表', () => {
    const { models } = filterModelsForApiKey(null, { permissions: [] })
    expect(models).toEqual([])
  })
})
