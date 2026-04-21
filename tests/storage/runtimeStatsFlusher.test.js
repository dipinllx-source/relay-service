'use strict'

const Database = require('better-sqlite3')
const { initSchema } = require('../../src/storage/schema')
const SqliteApiKeyRepository = require('../../src/storage/repositories/SqliteApiKeyRepository')
const RuntimeStatsFlusher = require('../../src/storage/runtimeStatsFlusher')

// In-memory Redis mock that implements just enough of ioredis surface for flusher.
function makeMockRedis() {
  const hashes = new Map() // key -> Map(field, value)
  return {
    _hashes: hashes,
    async scan(cursor, _match, pattern, _count, _n) {
      // ignore cursor; return everything in one shot for deterministic tests
      if (cursor !== '0') {
        return ['0', []]
      }
      const prefix = pattern.replace(/\*$/, '')
      const keys = [...hashes.keys()].filter((k) => k.startsWith(prefix))
      return ['0', keys]
    },
    async hincrby(key, field, amount) {
      if (!hashes.has(key)) {
        hashes.set(key, new Map())
      }
      const h = hashes.get(key)
      const cur = Number.parseInt(h.get(field) || '0', 10)
      const next = cur + amount
      h.set(field, String(next))
      return next
    },
    async hincrbyfloat(key, field, amount) {
      if (!hashes.has(key)) {
        hashes.set(key, new Map())
      }
      const h = hashes.get(key)
      const cur = Number.parseFloat(h.get(field) || '0')
      const next = cur + amount
      h.set(field, String(next))
      return String(next)
    },
    async hset(key, fields) {
      if (!hashes.has(key)) {
        hashes.set(key, new Map())
      }
      const h = hashes.get(key)
      for (const [f, v] of Object.entries(fields)) {
        h.set(f, String(v))
      }
    },
    pipeline() {
      const ops = []
      const self = this
      const pipe = {
        hgetall(key) {
          ops.push(['hgetall', key])
          return pipe
        },
        hincrby(key, field, amount) {
          ops.push(['hincrby', key, field, amount])
          return pipe
        },
        hincrbyfloat(key, field, amount) {
          ops.push(['hincrbyfloat', key, field, amount])
          return pipe
        },
        async exec() {
          const out = []
          for (const op of ops) {
            const [cmd, ...args] = op
            if (cmd === 'hgetall') {
              const h = hashes.get(args[0])
              out.push([null, h ? Object.fromEntries(h) : {}])
            } else if (cmd === 'hincrby') {
              const v = await self.hincrby(...args)
              out.push([null, v])
            } else if (cmd === 'hincrbyfloat') {
              const v = await self.hincrbyfloat(...args)
              out.push([null, v])
            }
          }
          return out
        }
      }
      return pipe
    }
  }
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

async function seedKey(repo, id, hash) {
  await repo.save(id, { name: id }, hash)
}

describe('RuntimeStatsFlusher', () => {
  let db
  let apiKeyRepo
  let redisMock
  let flusher

  beforeEach(async () => {
    db = makeDb()
    apiKeyRepo = new SqliteApiKeyRepository(db)
    redisMock = makeMockRedis()
    flusher = new RuntimeStatsFlusher({
      db,
      redisClient: redisMock,
      logger: silentLogger,
      intervalSec: 30
    })
    await seedKey(apiKeyRepo, 'k1', 'h1')
    await seedKey(apiKeyRepo, 'k2', 'h2')
  })

  afterEach(() => {
    flusher.stop()
    db.close()
  })

  test('flushOnce with no runtime keys does nothing', async () => {
    const res = await flusher.flushOnce()
    expect(res.flushed).toBe(0)
  })

  test('flushOnce applies Redis deltas to SQLite and decrements Redis', async () => {
    await redisMock.hset('apikey:runtime:k1', {
      request_count: '5',
      total_cost: '0.12',
      last_used_at: '1700000000000'
    })
    await redisMock.hset('apikey:runtime:k2', {
      request_count: '2',
      total_cost: '0.01'
    })

    const res = await flusher.flushOnce()
    expect(res.flushed).toBe(2)

    const k1 = await apiKeyRepo.findById('k1')
    expect(k1.requestCount).toBe(5)
    expect(k1.totalCost).toBeCloseTo(0.12, 5)
    expect(k1.lastUsedAt).toBe(1700000000000)

    const k2 = await apiKeyRepo.findById('k2')
    expect(k2.requestCount).toBe(2)
    expect(k2.totalCost).toBeCloseTo(0.01, 5)

    // Redis deltas have been decremented back
    const rt1 = Object.fromEntries(redisMock._hashes.get('apikey:runtime:k1'))
    expect(Number.parseInt(rt1.request_count, 10)).toBe(0)
    expect(Number.parseFloat(rt1.total_cost)).toBeCloseTo(0, 5)
  })

  test('subsequent flushes correctly accumulate', async () => {
    await redisMock.hset('apikey:runtime:k1', {
      request_count: '3',
      total_cost: '0.05',
      last_used_at: '1700000000000'
    })
    await flusher.flushOnce()
    expect((await apiKeyRepo.findById('k1')).requestCount).toBe(3)

    // New deltas arrive after first flush
    await redisMock.hincrby('apikey:runtime:k1', 'request_count', 4)
    await redisMock.hincrbyfloat('apikey:runtime:k1', 'total_cost', 0.07)
    await redisMock.hset('apikey:runtime:k1', { last_used_at: '1700000100000' })

    await flusher.flushOnce()
    const k1 = await apiKeyRepo.findById('k1')
    expect(k1.requestCount).toBe(7)
    expect(k1.totalCost).toBeCloseTo(0.12, 5)
    expect(k1.lastUsedAt).toBe(1700000100000)
  })

  test('last_used_at only moves forward (never decreases)', async () => {
    await redisMock.hset('apikey:runtime:k1', {
      request_count: '1',
      last_used_at: '2000000000000'
    })
    await flusher.flushOnce()
    expect((await apiKeyRepo.findById('k1')).lastUsedAt).toBe(2000000000000)

    await redisMock.hset('apikey:runtime:k1', {
      request_count: '1',
      last_used_at: '1000000000000' // earlier timestamp
    })
    await flusher.flushOnce()
    expect((await apiKeyRepo.findById('k1')).lastUsedAt).toBe(2000000000000)
  })

  test('start/stop honors intervalSec=0 (disabled)', () => {
    const f = new RuntimeStatsFlusher({
      db,
      redisClient: redisMock,
      logger: silentLogger,
      intervalSec: 0
    })
    f.start()
    expect(f.timer).toBeNull()
    f.stop()
  })

  test('status snapshot reflects lastSuccessAt after a flush', async () => {
    expect(flusher.status().lastSuccessAt).toBeNull()
    await flusher.flushOnce()
    expect(flusher.status().lastSuccessAt).not.toBeNull()
  })
})
