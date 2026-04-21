'use strict'

// 覆盖 SqliteApiKeyRepository 与 SqliteTagRepository 的核心契约。
// 使用 :memory: 数据库，不依赖文件系统；schema 通过 initSchema 注入。

const Database = require('better-sqlite3')
const { initSchema } = require('../../src/storage/schema')
const SqliteApiKeyRepository = require('../../src/storage/repositories/SqliteApiKeyRepository')
const SqliteTagRepository = require('../../src/storage/repositories/SqliteTagRepository')

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

describe('SqliteApiKeyRepository', () => {
  let db
  let repo

  beforeEach(() => {
    db = makeDb()
    repo = new SqliteApiKeyRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  test('save then findById roundtrips core + data fields', async () => {
    await repo.save(
      'k1',
      {
        name: 'team-a',
        ownerUserId: 'u1',
        status: 'active',
        tokenLimit: '1000000',
        isActive: 'true',
        tags: '["prod","a"]'
      },
      'hash-abc'
    )
    const got = await repo.findById('k1')
    expect(got.id).toBe('k1')
    expect(got.apiKey).toBe('hash-abc')
    expect(got.name).toBe('team-a')
    expect(got.ownerUserId).toBe('u1')
    expect(got.status).toBe('active')
    expect(got.tokenLimit).toBe('1000000')
    expect(got.tags).toBe('["prod","a"]')
  })

  test('findById on missing id returns {} (Redis hgetall parity)', async () => {
    const got = await repo.findById('missing')
    expect(got).toEqual({})
  })

  test('findByHash hits the UNIQUE index', async () => {
    await repo.save('k2', { name: 'x' }, 'hash-xyz')
    const got = await repo.findByHash('hash-xyz')
    expect(got).not.toBeNull()
    expect(got.id).toBe('k2')
  })

  test('findByHash returns null when no match', async () => {
    const got = await repo.findByHash('nope')
    expect(got).toBeNull()
  })

  test('save merges data JSON on re-save, preserving untouched fields', async () => {
    await repo.save('k3', { name: 'n', tokenLimit: '100', concurrencyLimit: '5' }, 'h')
    await repo.save('k3', { tokenLimit: '200' })
    const got = await repo.findById('k3')
    expect(got.tokenLimit).toBe('200')
    expect(got.concurrencyLimit).toBe('5')
  })

  test('save throws when first-time insert lacks hashedKey', async () => {
    await expect(repo.save('k4', { name: 'n' })).rejects.toThrow(/hashedKey/)
  })

  test('save without hashedKey works on update (uses existing hash)', async () => {
    await repo.save('k5', { name: 'n' }, 'h5')
    await repo.save('k5', { name: 'renamed' })
    const got = await repo.findById('k5')
    expect(got.apiKey).toBe('h5')
    expect(got.name).toBe('renamed')
  })

  test('delete removes the row and returns changes count', async () => {
    await repo.save('k6', { name: 'n' }, 'h6')
    const n = await repo.delete('k6')
    expect(n).toBe(1)
    expect(await repo.findById('k6')).toEqual({})
  })

  test('delete non-existent returns 0', async () => {
    expect(await repo.delete('none')).toBe(0)
  })

  test('getAll returns all rows sorted by created_at DESC', async () => {
    await repo.save('a', { name: 'first' }, 'h-a')
    await new Promise((r) => setTimeout(r, 2))
    await repo.save('b', { name: 'second' }, 'h-b')
    const all = await repo.getAll()
    expect(all.map((x) => x.id)).toEqual(['b', 'a'])
  })

  test('scanIds returns all ids (unordered OK)', async () => {
    await repo.save('x', { name: 'x' }, 'hx')
    await repo.save('y', { name: 'y' }, 'hy')
    const ids = await repo.scanIds()
    expect(ids.sort()).toEqual(['x', 'y'])
  })
})

describe('SqliteTagRepository', () => {
  let db
  let repo

  beforeEach(() => {
    db = makeDb()
    repo = new SqliteTagRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  test('addTag / listTags / removeTag round trip', async () => {
    await repo.addTag('prod')
    await repo.addTag('dev')
    await repo.addTag('prod') // idempotent
    let tags = await repo.listTags()
    expect(tags.sort()).toEqual(['dev', 'prod'])
    await repo.removeTag('dev')
    tags = await repo.listTags()
    expect(tags).toEqual(['prod'])
  })
})

describe('SqliteApiKeyRepository cascade tag cleanup', () => {
  test('deleting an api key cascades api_key_tags rows', async () => {
    const db = makeDb()
    const repo = new SqliteApiKeyRepository(db)
    const tagRepo = new SqliteTagRepository(db)
    await repo.save('k', { name: 'n' }, 'h')
    await tagRepo.addTag('prod')
    db.prepare('INSERT INTO api_key_tags (api_key_id, tag_name) VALUES (?, ?)').run('k', 'prod')
    expect(db.prepare('SELECT COUNT(*) AS c FROM api_key_tags').get().c).toBe(1)
    await repo.delete('k')
    expect(db.prepare('SELECT COUNT(*) AS c FROM api_key_tags').get().c).toBe(0)
    db.close()
  })
})
