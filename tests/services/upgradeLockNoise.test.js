jest.mock('child_process', () => ({
  execFile: jest.fn()
}))

jest.mock('../../src/utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  success: jest.fn(),
  database: jest.fn(),
  api: jest.fn(),
  security: jest.fn()
}))

const path = require('path')
const fs = require('fs')

const ROOT_DIR = path.join(__dirname, '..', '..')
const LOCK_PATH = path.join(ROOT_DIR, 'package-lock.json')
const PKG_VERSION = require('../../package.json').version

/** 构造一份最小 lock 结构（只保留判定关心的字段）。 */
function makeLock(version, extra = {}) {
  return {
    name: 'claude-relay-service',
    lockfileVersion: 3,
    requires: true,
    version,
    packages: {
      '': { name: 'claude-relay-service', version, dependencies: { express: '^4.18.2' } },
      'node_modules/express': { version: '4.18.2' }
    },
    ...extra
  }
}

describe('upgradeService.isLockVersionOnlyChange', () => {
  let upgradeService
  let execFile
  let readFileSyncSpy
  /** ref:path → 内容字符串；值为 null 表示 git show 失败 */
  let headFiles
  /** 绝对路径 → 内容字符串；值为 null 表示读文件抛错 */
  let workFiles

  beforeEach(() => {
    jest.resetModules()
    headFiles = {}
    workFiles = {}

    // eslint-disable-next-line global-require
    execFile = require('child_process').execFile
    execFile.mockImplementation((cmd, args, _opts, cb) => {
      if (cmd !== 'git' || args[0] !== 'show') {
        return cb(new Error(`unexpected command: ${cmd} ${args.join(' ')}`), '', 'boom')
      }
      const key = args[1]
      if (!Object.prototype.hasOwnProperty.call(headFiles, key) || headFiles[key] === null) {
        return cb(new Error('fatal: path does not exist'), '', `fatal: ${key} does not exist`)
      }
      return cb(null, headFiles[key], '')
    })

    const realReadFileSync = fs.readFileSync
    readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockImplementation((p, enc) => {
      if (typeof p === 'string' && Object.prototype.hasOwnProperty.call(workFiles, p)) {
        if (workFiles[p] === null) {
          throw new Error('ENOENT: no such file')
        }
        return workFiles[p]
      }
      return realReadFileSync(p, enc)
    })

    // eslint-disable-next-line global-require
    upgradeService = require('../../src/services/upgradeService')
  })

  afterEach(() => {
    readFileSyncSpy.mockRestore()
    jest.clearAllMocks()
  })

  test('白名单只含两个 lock 文件，且预检不得放行白名单外路径', async () => {
    expect(upgradeService.LOCK_NOISE_PATHS).toEqual([
      'package-lock.json',
      'web/admin-spa/package-lock.json'
    ])

    const r = await upgradeService.isLockVersionOnlyChange('src/services/upgradeRunner.js')
    expect(r).toEqual({ noise: false, reason: 'path-not-whitelisted' })
    // 白名单判定应短路，不触发任何 git 调用
    expect(execFile).not.toHaveBeenCalled()
  })

  test('HEAD 侧读不到文件 → parse-failed（失败闭合）', async () => {
    headFiles['HEAD:package-lock.json'] = null
    workFiles[LOCK_PATH] = JSON.stringify(makeLock(PKG_VERSION))

    const r = await upgradeService.isLockVersionOnlyChange('package-lock.json')
    expect(r).toEqual({ noise: false, reason: 'parse-failed' })
  })

  test('工作区侧读文件抛错 → parse-failed', async () => {
    headFiles['HEAD:package-lock.json'] = JSON.stringify(makeLock('1.0.0'))
    workFiles[LOCK_PATH] = null

    const r = await upgradeService.isLockVersionOnlyChange('package-lock.json')
    expect(r).toEqual({ noise: false, reason: 'parse-failed' })
  })

  test('JSON 非法 → parse-failed', async () => {
    headFiles['HEAD:package-lock.json'] = JSON.stringify(makeLock('1.0.0'))
    workFiles[LOCK_PATH] = '{ "version": "1.3.1", '

    const r = await upgradeService.isLockVersionOnlyChange('package-lock.json')
    expect(r).toEqual({ noise: false, reason: 'parse-failed' })
  })

  test('缺少 version 字段 → missing-version-field', async () => {
    const head = makeLock('1.0.0')
    delete head.packages[''].version
    headFiles['HEAD:package-lock.json'] = JSON.stringify(head)
    workFiles[LOCK_PATH] = JSON.stringify(makeLock(PKG_VERSION))

    const r = await upgradeService.isLockVersionOnlyChange('package-lock.json')
    expect(r).toEqual({ noise: false, reason: 'missing-version-field' })
  })

  test('依赖树等其他字段有差异 → other-fields-differ', async () => {
    headFiles['HEAD:package-lock.json'] = JSON.stringify(makeLock('1.0.0'))
    const work = makeLock(PKG_VERSION)
    work.packages['node_modules/lodash'] = { version: '4.17.21' }
    workFiles[LOCK_PATH] = JSON.stringify(work)

    const r = await upgradeService.isLockVersionOnlyChange('package-lock.json')
    expect(r).toEqual({ noise: false, reason: 'other-fields-differ' })
  })

  test('lock 版本与 package.json 不一致 → version-mismatch-package-json（D2）', async () => {
    headFiles['HEAD:package-lock.json'] = JSON.stringify(makeLock('1.0.0'))
    workFiles[LOCK_PATH] = JSON.stringify(makeLock('9.9.9'))

    const r = await upgradeService.isLockVersionOnlyChange('package-lock.json')
    expect(r).toEqual({ noise: false, reason: 'version-mismatch-package-json' })
  })

  test('两处 version 只对齐了一处 → version-mismatch-package-json', async () => {
    headFiles['HEAD:package-lock.json'] = JSON.stringify(makeLock('1.0.0'))
    const work = makeLock(PKG_VERSION)
    work.packages[''].version = '1.0.0'
    workFiles[LOCK_PATH] = JSON.stringify(work)

    const r = await upgradeService.isLockVersionOnlyChange('package-lock.json')
    expect(r).toEqual({ noise: false, reason: 'version-mismatch-package-json' })
  })

  test('仅两处 version 对齐到 package.json → noise: lock-version-alignment', async () => {
    headFiles['HEAD:package-lock.json'] = JSON.stringify(makeLock('1.0.0'))
    workFiles[LOCK_PATH] = JSON.stringify(makeLock(PKG_VERSION))

    const r = await upgradeService.isLockVersionOnlyChange('package-lock.json')
    expect(r).toEqual({ noise: true, reason: 'lock-version-alignment' })
  })

  test('深比较不受键序影响（JSON.stringify 顺序不同仍判 noise）', async () => {
    headFiles['HEAD:package-lock.json'] = JSON.stringify({
      packages: {
        'node_modules/express': { version: '4.18.2' },
        '': { version: '1.0.0', dependencies: { express: '^4.18.2' }, name: 'claude-relay-service' }
      },
      requires: true,
      version: '1.0.0',
      lockfileVersion: 3,
      name: 'claude-relay-service'
    })
    workFiles[LOCK_PATH] = JSON.stringify(makeLock(PKG_VERSION))

    const r = await upgradeService.isLockVersionOnlyChange('package-lock.json')
    expect(r).toEqual({ noise: true, reason: 'lock-version-alignment' })
  })

  test('headRef 可指定；readFileAtRef 读不到时返回 null 而非抛错', async () => {
    headFiles['ORIG_HEAD:package-lock.json'] = JSON.stringify(makeLock('1.0.0'))
    workFiles[LOCK_PATH] = JSON.stringify(makeLock(PKG_VERSION))

    const r = await upgradeService.isLockVersionOnlyChange('package-lock.json', {
      headRef: 'ORIG_HEAD'
    })
    expect(r).toEqual({ noise: true, reason: 'lock-version-alignment' })

    await expect(upgradeService.readFileAtRef('HEAD', 'no/such/file')).resolves.toBeNull()
  })
})
