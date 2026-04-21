'use strict'

const Database = require('better-sqlite3')
const { initSchema } = require('../../src/storage/schema')
const UsageArchiveService = require('../../src/services/usageArchiveService')

function makeMockRedis() {
  const hashes = new Map()
  const sets = new Map()
  const api = {
    _hashes: hashes,
    _sets: sets,
    async smembers(k) {
      const s = sets.get(k)
      return s ? [...s] : []
    },
    async sadd(k, ...members) {
      if (!sets.has(k)) {
        sets.set(k, new Set())
      }
      for (const m of members) {
        sets.get(k).add(m)
      }
    },
    async hset(k, fields) {
      if (!hashes.has(k)) {
        hashes.set(k, new Map())
      }
      const h = hashes.get(k)
      for (const [f, v] of Object.entries(fields)) {
        h.set(f, String(v))
      }
    },
    pipeline() {
      const ops = []
      const pipe = {
        hgetall(key) {
          ops.push(['hgetall', key])
          return pipe
        },
        async exec() {
          const out = []
          for (const [cmd, key] of ops) {
            if (cmd === 'hgetall') {
              const h = hashes.get(key)
              out.push([null, h ? Object.fromEntries(h) : {}])
            }
          }
          return out
        }
      }
      return pipe
    }
  }
  return api
}

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

async function seedDay(redis, date, keyId, model, h) {
  await redis.sadd(`usage:keymodel:daily:index:${date}`, `${keyId}:${model}`)
  await redis.hset(`usage:${keyId}:model:daily:${date}:${model}`, h)
}

function usageRows(db) {
  return db.prepare('SELECT * FROM usage_daily ORDER BY id, model, date').all()
}

describe('UsageArchiveService.archiveDate', () => {
  let db
  let redis
  let svc

  beforeEach(() => {
    db = makeDb()
    redis = makeMockRedis()
    svc = new UsageArchiveService({ db, redisClient: redis, logger: silentLogger })
  })

  afterEach(() => {
    db.close()
  })

  test('archives a single (key, model) pair for the given date', async () => {
    await seedDay(redis, '2026-04-21', 'k1', 'claude-sonnet-4', {
      requests: '7',
      inputTokens: '100',
      outputTokens: '200',
      realCostMicro: '1234567'
    })
    const res = await svc.archiveDate('2026-04-21')
    expect(res).toEqual({ date: '2026-04-21', archived: 1 })

    const rows = usageRows(db)
    expect(rows).toHaveLength(1)
    const [r] = rows
    expect(r.scope).toBe('apikey')
    expect(r.id).toBe('k1')
    expect(r.model).toBe('claude-sonnet-4')
    expect(r.request_count).toBe(7)
    expect(r.input_tokens).toBe(100)
    expect(r.output_tokens).toBe(200)
    expect(r.cost).toBeCloseTo(1.234567, 6)
  })

  test('falls back to ratedCostMicro when realCost is zero', async () => {
    await seedDay(redis, '2026-04-21', 'k1', 'm', {
      requests: '1',
      ratedCostMicro: '500000'
    })
    await svc.archiveDate('2026-04-21')
    expect(usageRows(db)[0].cost).toBeCloseTo(0.5, 5)
  })

  test('empty index → archived 0, no rows', async () => {
    const res = await svc.archiveDate('2026-04-20')
    expect(res).toEqual({ date: '2026-04-20', archived: 0 })
    expect(usageRows(db)).toHaveLength(0)
  })

  test('multiple (key, model) pairs archive together', async () => {
    await seedDay(redis, '2026-04-21', 'k1', 'modelA', { requests: '1' })
    await seedDay(redis, '2026-04-21', 'k1', 'modelB', { requests: '2' })
    await seedDay(redis, '2026-04-21', 'k2', 'modelA', { requests: '3' })
    const res = await svc.archiveDate('2026-04-21')
    expect(res.archived).toBe(3)
    expect(usageRows(db)).toHaveLength(3)
  })

  test('model names containing colon survive splitting', async () => {
    await seedDay(redis, '2026-04-21', 'k1', 'vendor:family:size', {
      requests: '1'
    })
    await svc.archiveDate('2026-04-21')
    const [r] = usageRows(db)
    expect(r.model).toBe('vendor:family:size')
  })

  test('re-run on the same date is idempotent (INSERT OR REPLACE)', async () => {
    await seedDay(redis, '2026-04-21', 'k1', 'm', {
      requests: '1',
      realCostMicro: '100000'
    })
    await svc.archiveDate('2026-04-21')
    await seedDay(redis, '2026-04-21', 'k1', 'm', {
      requests: '5',
      realCostMicro: '500000'
    })
    await svc.archiveDate('2026-04-21')
    const [r] = usageRows(db)
    expect(r.request_count).toBe(5)
    expect(r.cost).toBeCloseTo(0.5, 5)
    expect(usageRows(db)).toHaveLength(1)
  })

  test('rejects bad date format', async () => {
    await expect(svc.archiveDate('not-a-date')).rejects.toThrow(/YYYY-MM-DD/)
  })
})

describe('UsageArchiveService.archivePastDays', () => {
  let db
  let redis
  let svc

  beforeEach(() => {
    db = makeDb()
    redis = makeMockRedis()
    svc = new UsageArchiveService({ db, redisClient: redis, logger: silentLogger })
  })

  afterEach(() => {
    db.close()
  })

  test('archives N past days relative to referenceDate', async () => {
    await seedDay(redis, '2026-04-20', 'k1', 'm', { requests: '1' })
    await seedDay(redis, '2026-04-19', 'k1', 'm', { requests: '2' })
    const res = await svc.archivePastDays(2, '2026-04-21')
    expect(res.map((r) => r.date).sort()).toEqual(['2026-04-19', '2026-04-20'])
    expect(usageRows(db)).toHaveLength(2)
  })
})
