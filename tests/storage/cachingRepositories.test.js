'use strict'

// Caching decorator contract tests: verify the decorator is transparent
// w.r.t. the inner repository (save/find/delete round-trip identical)
// and that cache keys are properly invalidated on writes/deletes.

const Database = require('better-sqlite3')
const { initSchema } = require('../../src/storage/schema')

const SqliteApiKeyRepository = require('../../src/storage/repositories/SqliteApiKeyRepository')
const SqliteAccountRepository = require('../../src/storage/repositories/SqliteAccountRepository')
const CachingApiKeyRepository = require('../../src/storage/repositories/CachingApiKeyRepository')
const CachingAccountRepository = require('../../src/storage/repositories/CachingAccountRepository')

function makeMockRedis() {
  const store = new Map()
  return {
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setex: jest.fn(async (k, _ttl, v) => {
      store.set(k, v)
    }),
    del: jest.fn(async (...keys) => {
      let n = 0
      for (const k of keys) {
        if (store.delete(k)) {
          n += 1
        }
      }
      return n
    }),
    _store: store
  }
}

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

describe('CachingApiKeyRepository', () => {
  let db
  let inner
  let redisMock
  let repo

  beforeEach(() => {
    db = makeDb()
    inner = new SqliteApiKeyRepository(db)
    redisMock = makeMockRedis()
    repo = new CachingApiKeyRepository(inner, redisMock)
  })

  afterEach(() => {
    db.close()
  })

  test('findByHash populates cache on miss and serves from cache on hit', async () => {
    await inner.save('k1', { name: 'n' }, 'hash-1')
    expect(redisMock._store.size).toBe(0)

    const first = await repo.findByHash('hash-1')
    expect(first.id).toBe('k1')
    expect(redisMock.setex).toHaveBeenCalledTimes(1)
    expect(redisMock._store.has('apikey:cache:hash:hash-1')).toBe(true)

    // Second call should hit the cache — inner.findByHash should NOT be invoked again
    const spy = jest.spyOn(inner, 'findByHash')
    const second = await repo.findByHash('hash-1')
    expect(second.id).toBe('k1')
    expect(spy).not.toHaveBeenCalled()
  })

  test('findById uses separate cache key', async () => {
    await inner.save('k2', { name: 'n' }, 'h2')
    const got = await repo.findById('k2')
    expect(got.id).toBe('k2')
    expect(redisMock._store.has('apikey:cache:id:k2')).toBe(true)
  })

  test('save invalidates both id-cache and hash-cache', async () => {
    await inner.save('k3', { name: 'n' }, 'h3')
    await repo.findByHash('h3')
    await repo.findById('k3')
    expect(redisMock._store.size).toBe(2)

    await repo.save('k3', { name: 'renamed' })
    expect(redisMock._store.has('apikey:cache:id:k3')).toBe(false)
    expect(redisMock._store.has('apikey:cache:hash:h3')).toBe(false)
  })

  test('save with new hashedKey invalidates the old hash cache', async () => {
    await inner.save('k4', { name: 'n' }, 'old-hash')
    await repo.findByHash('old-hash')
    expect(redisMock._store.has('apikey:cache:hash:old-hash')).toBe(true)

    await repo.save('k4', { name: 'n' }, 'new-hash')
    expect(redisMock._store.has('apikey:cache:hash:old-hash')).toBe(false)
  })

  test('delete invalidates both id-cache and hash-cache', async () => {
    await inner.save('k5', { name: 'n' }, 'h5')
    await repo.findByHash('h5')
    await repo.findById('k5')
    expect(redisMock._store.size).toBe(2)

    const count = await repo.delete('k5')
    expect(count).toBe(1)
    expect(redisMock._store.size).toBe(0)
  })

  test('getAll / scanIds bypass the cache entirely', async () => {
    await inner.save('a', { name: 'a' }, 'ha')
    await inner.save('b', { name: 'b' }, 'hb')
    const all = await repo.getAll()
    const ids = await repo.scanIds()
    expect(all.length).toBe(2)
    expect(ids.sort()).toEqual(['a', 'b'])
    expect(redisMock.setex).not.toHaveBeenCalled()
  })

  test('corrupt cache payload falls through to inner', async () => {
    await inner.save('k6', { name: 'n' }, 'h6')
    redisMock._store.set('apikey:cache:hash:h6', '{not-json')
    const got = await repo.findByHash('h6')
    expect(got.id).toBe('k6')
  })
})

describe('CachingAccountRepository', () => {
  let db
  let inner
  let redisMock
  let repo

  beforeEach(() => {
    db = makeDb()
    inner = new SqliteAccountRepository(db)
    redisMock = makeMockRedis()
    repo = new CachingAccountRepository(inner, redisMock)
  })

  afterEach(() => {
    db.close()
  })

  test('findById populates and serves from cache', async () => {
    await inner.save('claude', 'a', { name: 'n' })
    await repo.findById('claude', 'a')
    expect(redisMock._store.has('account:cache:claude:a')).toBe(true)

    const spy = jest.spyOn(inner, 'findById')
    await repo.findById('claude', 'a')
    expect(spy).not.toHaveBeenCalled()
  })

  test('save invalidates (platform, id) cache', async () => {
    await inner.save('claude', 'a', { name: 'n' })
    await repo.findById('claude', 'a')
    await repo.save('claude', 'a', { name: 'renamed' })
    expect(redisMock._store.has('account:cache:claude:a')).toBe(false)
  })

  test('delete invalidates the cache key', async () => {
    await inner.save('gemini', 'g1', { name: 'n' })
    await repo.findById('gemini', 'g1')
    expect(await repo.delete('gemini', 'g1')).toBe(1)
    expect(redisMock._store.size).toBe(0)
  })
})
