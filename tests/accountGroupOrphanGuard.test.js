jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

const mockStore = {
  sets: {},
  hashes: {}
}

jest.mock('../src/models/redis', () => ({
  getClientSafe: () => ({
    smembers: async (key) => [...(mockStore.sets[key] || [])],
    sismember: async (key, member) => ((mockStore.sets[key] || []).includes(member) ? 1 : 0),
    scard: async (key) => (mockStore.sets[key] || []).length,
    hgetall: async (key) => mockStore.hashes[key] || {}
  }),
  scanApiKeyIds: async () =>
    Object.keys(mockStore.hashes)
      .filter((k) => k.startsWith('apikey:'))
      .map((k) => k.slice('apikey:'.length))
}))

const accountGroupService = require('../src/services/accountGroupService')

function seed({ members, keys }) {
  mockStore.sets = {
    account_groups: ['g1'],
    'account_group_members:g1': members
  }
  mockStore.hashes = {
    'account_group:g1': { id: 'g1', name: 'Dipin', platform: 'claude', createdAt: '2026-01-01' }
  }
  for (const [id, data] of Object.entries(keys)) {
    mockStore.hashes[`apikey:${id}`] = data
  }
}

describe('accountGroupService group-orphan guard', () => {
  it('getApiKeysUsingGroup reads apikey:<id> hashes and skips deleted keys', async () => {
    seed({
      members: ['acc-1'],
      keys: {
        k1: { name: 'dipin-Claude', claudeAccountId: 'group:g1' },
        k2: { name: 'old', claudeAccountId: 'group:g1', isDeleted: 'true' },
        k3: { name: 'yuyu', claudeAccountId: 'acc-1' }
      }
    })
    const keys = await accountGroupService.getApiKeysUsingGroup('g1')
    expect(keys).toEqual([{ id: 'k1', name: 'dipin-Claude' }])
  })

  it('reports a group that would be emptied while keys are still bound to it', async () => {
    seed({
      members: ['acc-1'],
      keys: { k1: { name: 'dipin-Claude', claudeAccountId: 'group:g1' } }
    })
    const orphaned = await accountGroupService.getGroupsOrphanedByAccountRemoval('acc-1', [])
    expect(orphaned).toHaveLength(1)
    expect(orphaned[0].groupName).toBe('Dipin')
    expect(orphaned[0].apiKeys.map((k) => k.name)).toEqual(['dipin-Claude'])
  })

  it('allows the change when the group keeps another member, the group is kept, or no key binds it', async () => {
    seed({
      members: ['acc-1', 'acc-2'],
      keys: { k1: { name: 'dipin-Claude', claudeAccountId: 'group:g1' } }
    })
    expect(await accountGroupService.getGroupsOrphanedByAccountRemoval('acc-1', [])).toEqual([])

    seed({
      members: ['acc-1'],
      keys: { k1: { name: 'dipin-Claude', claudeAccountId: 'group:g1' } }
    })
    expect(await accountGroupService.getGroupsOrphanedByAccountRemoval('acc-1', ['g1'])).toEqual([])

    seed({ members: ['acc-1'], keys: { k3: { name: 'yuyu', claudeAccountId: 'acc-1' } } })
    expect(await accountGroupService.getGroupsOrphanedByAccountRemoval('acc-1', [])).toEqual([])
  })
})
