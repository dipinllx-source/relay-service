<template>
  <div>
    <!-- 加载态 -->
    <div v-if="loading && !status" class="py-12 text-center">
      <i class="fas fa-spinner fa-spin mb-4 text-2xl text-blue-500" />
      <p class="text-gray-500 dark:text-gray-400">正在加载存储健康状态...</p>
    </div>

    <!-- 主面板 -->
    <div v-else-if="status" class="space-y-6">
      <!-- Backend 概览 -->
      <div
        class="rounded-xl border border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 dark:border-gray-700 dark:from-blue-900/20 dark:to-indigo-900/20"
      >
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-xl"
              :class="backendBadgeClass"
            >
              <i class="fas fa-database text-xl" />
            </div>
            <div>
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                元数据后端：<span class="font-bold">{{ status.backend }}</span>
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ backendDescription }}
              </p>
            </div>
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            采样时间：{{ formatTime(status.collectedAt) }}
          </div>
        </div>
      </div>

      <!-- Redis 面板 -->
      <div
        class="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/50"
      >
        <h4
          class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          <i class="fas fa-bolt text-amber-500" />
          Redis
        </h4>
        <div class="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">连接</p>
            <p
              :class="
                status.redis?.connected ? 'text-green-600 dark:text-green-400' : 'text-red-500'
              "
            >
              {{ status.redis?.connected ? '正常' : '异常' }}
            </p>
          </div>
          <div v-if="status.redis?.usedMemoryBytes != null">
            <p class="text-xs text-gray-500 dark:text-gray-400">已用内存</p>
            <p class="text-gray-700 dark:text-gray-300">
              {{ formatBytes(status.redis.usedMemoryBytes) }}
            </p>
          </div>
          <div v-if="status.redis?.dbSize != null">
            <p class="text-xs text-gray-500 dark:text-gray-400">Key 总数</p>
            <p class="text-gray-700 dark:text-gray-300">
              {{ status.redis.dbSize.toLocaleString() }}
            </p>
          </div>
          <div v-if="status.redis?.lastSaveAt">
            <p class="text-xs text-gray-500 dark:text-gray-400">上次 RDB save</p>
            <p class="text-gray-700 dark:text-gray-300">
              {{ formatTime(status.redis.lastSaveAt) }}
            </p>
          </div>
        </div>
      </div>

      <!-- SQLite 面板（仅 backend=sqlite 时展示） -->
      <div
        v-if="status.sqlite"
        class="rounded-xl border p-4"
        :class="
          integrityOk
            ? 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50'
            : 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-900/20'
        "
      >
        <h4
          class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          <i class="fas fa-hdd text-indigo-500" />
          SQLite
          <span
            class="ml-auto rounded-full px-2 py-0.5 text-xs"
            :class="
              integrityOk
                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
            "
          >
            integrity: {{ status.sqlite.integrityCheck }}
          </span>
        </h4>
        <div class="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">文件大小</p>
            <p class="text-gray-700 dark:text-gray-300">
              {{ formatBytes(status.sqlite.fileSizeBytes) }}
            </p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">WAL 大小</p>
            <p class="text-gray-700 dark:text-gray-300">
              {{ formatBytes(status.sqlite.walSizeBytes) }}
            </p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">journal mode</p>
            <p class="text-gray-700 dark:text-gray-300">{{ status.sqlite.journalMode }}</p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">文件路径</p>
            <p
              class="truncate text-xs text-gray-600 dark:text-gray-400"
              :title="status.sqlite.path"
            >
              {{ status.sqlite.path }}
            </p>
          </div>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div
            v-for="(v, k) in status.sqlite.rowCounts"
            :key="k"
            class="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40"
          >
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ rowCountLabel(k) }}</p>
            <p class="font-semibold text-gray-700 dark:text-gray-300">{{ v.toLocaleString() }}</p>
          </div>
        </div>
      </div>

      <!-- Flusher 面板 -->
      <div
        v-if="status.flusher"
        class="rounded-xl border p-4"
        :class="
          flusherHealthy
            ? 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50'
            : 'border-yellow-300 bg-yellow-50 dark:border-yellow-900/60 dark:bg-yellow-900/20'
        "
      >
        <h4
          class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          <i
            class="fas fa-sync-alt"
            :class="flusherHealthy ? 'text-blue-500' : 'text-yellow-500'"
          />
          API Key 统计 flusher
        </h4>
        <div class="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">上次成功</p>
            <p class="text-gray-700 dark:text-gray-300">
              {{ formatTime(status.flusher.lastSuccessAt) }}
            </p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">上次失败</p>
            <p
              :class="
                status.flusher.lastErrorAt ? 'text-red-600 dark:text-red-400' : 'text-gray-400'
              "
            >
              {{ formatTime(status.flusher.lastErrorAt) }}
            </p>
          </div>
          <div v-if="status.flusher.pendingRuntimeKeyCount != null">
            <p class="text-xs text-gray-500 dark:text-gray-400">待 flush key 数</p>
            <p class="text-gray-700 dark:text-gray-300">
              {{ status.flusher.pendingRuntimeKeyCount }}
            </p>
          </div>
          <div v-if="status.flusher.intervalSec != null">
            <p class="text-xs text-gray-500 dark:text-gray-400">flush 间隔</p>
            <p class="text-gray-700 dark:text-gray-300">{{ status.flusher.intervalSec }}s</p>
          </div>
        </div>
        <p
          v-if="status.flusher.lastErrorMessage"
          class="mt-3 text-xs text-red-600 dark:text-red-400"
          :title="status.flusher.lastErrorMessage"
        >
          最近错误：{{ truncate(status.flusher.lastErrorMessage, 120) }}
        </p>
      </div>

      <!-- 备份面板 -->
      <div
        v-if="status.backup"
        class="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/50"
      >
        <h4
          class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          <i class="fas fa-archive text-gray-500" />
          备份
        </h4>
        <div class="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">上次备份</p>
            <p class="text-gray-700 dark:text-gray-300">
              {{ status.backup.lastBackupAt ? formatTime(status.backup.lastBackupAt) : '尚未生成' }}
            </p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">备份文件数</p>
            <p class="text-gray-700 dark:text-gray-300">{{ status.backup.backupCount ?? 0 }}</p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">最近文件大小</p>
            <p class="text-gray-700 dark:text-gray-300">
              {{
                status.backup.lastBackupSizeBytes
                  ? formatBytes(status.backup.lastBackupSizeBytes)
                  : '-'
              }}
            </p>
          </div>
        </div>
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
          运行
          <code class="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">npm run data:backup</code>
          生成新备份（支持热备份，不影响服务运行）
        </p>
      </div>

      <!-- 🗄️ 备份导出 / 导入 -->
      <div
        class="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/40"
        data-secharden-backup
      >
        <div class="mb-3 flex items-center gap-2">
          <i class="fas fa-file-export text-indigo-500" />
          <h4 class="text-sm font-semibold text-gray-800 dark:text-gray-200">备份导出 / 导入</h4>
        </div>
        <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
          导出包含 API
          Keys、各类账户与管理员凭据，敏感字段以加密形态保留。导入采用「跳过冲突」策略，
          不会覆盖已存在的条目。
        </p>

        <div
          class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200"
        >
          <p class="mb-1 flex items-center gap-1 font-semibold">
            <i class="fas fa-exclamation-triangle" />
            备份文件请按机密文件保管
          </p>
          <p class="leading-5">
            文件内含可解密的账户凭据与明文管理员凭据，不要提交代码仓库，也不要放进公开的对象存储桶。
          </p>
          <p class="mt-1 leading-5">
            恢复到另一台服务器要求该机沿用同一
            <code class="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900/40"
              >ENCRYPTION_KEY</code
            >
            ，且必须在该机建立任何数据之前就设好。密钥不一致时导入会「成功」、账户在列表里也照常可见，
            但每次上游调用都是 401。
          </p>
          <p v-if="keyFingerprint" class="mt-1 leading-5" data-secharden-key-fingerprint>
            本机密钥指纹
            <code class="rounded bg-amber-100 px-1 py-0.5 font-mono dark:bg-amber-900/40">{{
              keyFingerprint
            }}</code>
            —— 导出的备份会声明它。目标机指纹与之不同时：账户凭据解不开（上游
            401，可在目标机重新授权或重新录入）；已发放的 API Key 连哈希都算不出来，在中转入口就
            401，且无法恢复、只能重新发放。
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
            :disabled="busy"
            @click="doExport"
          >
            <i class="fas" :class="busy === 'export' ? 'fa-spinner fa-spin' : 'fa-download'" />
            导出备份
          </button>

          <button
            class="inline-flex items-center gap-2 rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-900/20"
            :disabled="busy"
            @click="triggerImport"
          >
            <i class="fas" :class="busy === 'import' ? 'fa-spinner fa-spin' : 'fa-upload'" />
            导入备份
          </button>

          <input
            ref="fileInput"
            accept="application/json,.json"
            class="hidden"
            type="file"
            @change="onFileChange"
          />
        </div>

        <!-- 结果提示 -->
        <div
          v-if="backupMsg"
          class="mt-3 rounded-lg px-3 py-2 text-xs"
          :class="
            backupMsgType === 'error'
              ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
              : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
          "
        >
          <i
            class="fas mr-1"
            :class="backupMsgType === 'error' ? 'fa-exclamation-triangle' : 'fa-check-circle'"
          />
          {{ backupMsg }}
        </div>

        <!-- 导入结果明细：四桶汇总 + 分组 / 索引 / 鉴权映射 + 告警（D11） -->
        <div v-if="importResult" class="mt-3 space-y-2">
          <div
            class="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-300"
          >
            <i class="fas fa-check-circle mr-1" />
            {{ importSummary }}
          </div>

          <div
            v-if="importDetailLines.length"
            class="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300"
          >
            <p v-for="(line, i) in importDetailLines" :key="i" class="leading-5">{{ line }}</p>
          </div>

          <!-- 告警不能折进「成功」提示里：这几条都改动了数据，需要被看见 -->
          <div
            v-if="importWarnings.length"
            class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700/60 dark:bg-amber-900/20"
          >
            <p
              class="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-800 dark:text-amber-300"
            >
              <i class="fas fa-exclamation-triangle" />
              有 {{ importWarnings.length }} 处需要留意的处理（不是失败，但改动了写入的数据）
            </p>
            <ul
              class="list-disc space-y-1 pl-5 text-xs text-amber-800 dark:text-amber-200"
              data-secharden-import-warnings
            >
              <li v-for="(w, i) in importWarnings" :key="i" class="leading-5">
                {{ w.message || w.type }}
                <span v-if="w.type" class="ml-1 font-mono opacity-60">[{{ w.type }}]</span>
              </li>
            </ul>
          </div>
        </div>

        <p class="mt-2 text-xs text-gray-400 dark:text-gray-500">
          提示：也可使用 CLI
          <code class="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">npm run data:export</code>
          /
          <code class="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-700">data:import</code>
          进行等价操作。
        </p>
      </div>
    </div>

    <!-- 错误态 -->
    <div
      v-else-if="error"
      class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300"
    >
      <i class="fas fa-exclamation-triangle mr-2" />
      加载存储健康状态失败：{{ error }}
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { getStorageStatus, exportBackupApi, importBackupApi } from '@/utils/http_apis'

const loading = ref(false)
const status = ref(null)
const error = ref(null)
let timer = null

// 🔑 本机 ENCRYPTION_KEY 的指纹（来自 /admin/storage/status）。老后端不返回该字段时
// 取空串，模板里那段提示直接 v-if 隐藏，不会渲染出 undefined
const keyFingerprint = computed(() => status.value?.encryption?.keyFingerprint || '')

// 🗄️ 备份导出 / 导入
const busy = ref(null)
const backupMsg = ref('')
const backupMsgType = ref('info')
const fileInput = ref(null)
// 导入结果原样存着，展示逐段派生（老后端缺 groups / indexes / hashMap / warnings
// 时，下面的 computed 一律返回空，视图少几块而不是报错）
const importResult = ref(null)

function setBackupMsg(msg, type = 'info') {
  backupMsg.value = msg
  backupMsgType.value = type
}

function bucketText(label, bucket) {
  if (!bucket) return null
  const errors = bucket.errors ? ` / 失败 ${bucket.errors}` : ''
  return `${label} +${bucket.imported ?? 0} / 跳过 ${bucket.skipped ?? 0}${errors}`
}

const importSummary = computed(() => {
  const st = importResult.value
  if (!st) return ''
  const parts = [
    bucketText('API Keys', st.apiKeys),
    bucketText('账户', st.accounts),
    bucketText('标签', st.tags),
    bucketText('管理员', st.admins)
  ].filter(Boolean)
  return parts.length ? `导入完成：${parts.join('；')}` : '导入完成'
})

const importDetailLines = computed(() => {
  const st = importResult.value
  if (!st) return []
  const lines = []

  if (st.groups) {
    const def = bucketText('定义', st.groups.definitions) || '定义 +0 / 跳过 0'
    lines.push(
      `账户分组：${def}，成员 +${st.groups.members?.added ?? 0}，反向索引 +${st.groups.reverse?.added ?? 0}`
    )
  }

  const idx = st.indexes
  if (idx && Object.keys(idx).length > 0) {
    const items = Object.entries(idx)
      .map(([key, count]) => `${key} +${count}`)
      .join('，')
    lines.push(`索引补写：${items}`)
  }

  const hm = st.hashMap
  if (hm) {
    const extra = []
    if (hm.skippedDeleted) extra.push(`已删除故未写回 ${hm.skippedDeleted}`)
    if (hm.errors) extra.push(`失败 ${hm.errors}`)
    lines.push(
      `API Key 鉴权映射：+${hm.imported ?? 0} / 跳过 ${hm.skipped ?? 0}${
        extra.length ? ` / ${extra.join(' / ')}` : ''
      }`
    )
  }

  return lines
})

const importWarnings = computed(() => {
  const list = importResult.value?.warnings
  return Array.isArray(list) ? list : []
})

async function doExport() {
  if (busy.value) return
  busy.value = 'export'
  setBackupMsg('')
  importResult.value = null
  try {
    const resp = await exportBackupApi()
    const blob = new Blob([resp.data], { type: 'application/json' })
    let filename = 'relay-backup.json'
    const cd =
      resp.headers && (resp.headers['content-disposition'] || resp.headers['Content-Disposition'])
    if (cd) {
      const m = /filename="?([^"]+)"?/.exec(cd)
      if (m) filename = m[1]
    }
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
    const fp =
      resp.headers &&
      (resp.headers['x-backup-key-fingerprint'] || resp.headers['X-Backup-Key-Fingerprint'])
    setBackupMsg(
      fp
        ? `备份已导出并开始下载（密钥指纹 ${fp}）。恢复到指纹不同的机器上：账户凭据解不开，API Key 只能重新发放。`
        : '备份已导出并开始下载',
      'info'
    )
  } catch (err) {
    setBackupMsg(
      '导出失败：' + (err?.response?.data?.message || err.message || String(err)),
      'error'
    )
  } finally {
    busy.value = null
  }
}

function triggerImport() {
  if (busy.value) return
  setBackupMsg('')
  if (fileInput.value) fileInput.value.click()
}

async function onFileChange(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  busy.value = 'import'
  setBackupMsg('')
  importResult.value = null
  try {
    const text = await file.text()
    let backup
    try {
      backup = JSON.parse(text)
    } catch (_e) {
      throw new Error('文件不是有效的 JSON')
    }
    if (!backup || !backup.metadata || !backup.data) {
      throw new Error('备份文件格式无效（缺少 metadata/data）')
    }
    if (!window.confirm('确认导入该备份？将以「跳过冲突」方式恢复，不覆盖已存在条目。')) {
      busy.value = null
      return
    }
    const { data } = await importBackupApi(backup)
    importResult.value = data || {}
    setBackupMsg('')
    refresh()
  } catch (err) {
    importResult.value = null
    setBackupMsg(
      '导入失败：' + (err?.response?.data?.message || err.message || String(err)),
      'error'
    )
  } finally {
    busy.value = null
    if (fileInput.value) fileInput.value.value = ''
  }
}

const backendDescription = computed(() => {
  if (!status.value) return ''
  return status.value.backend === 'sqlite'
    ? '账号与 API Key 源数据存于本地 SQLite，Redis 仅作缓存与热状态'
    : '所有元数据与热状态均存于 Redis（默认模式）'
})

const backendBadgeClass = computed(() => {
  return status.value?.backend === 'sqlite'
    ? 'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400'
    : 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400'
})

const integrityOk = computed(() => {
  return status.value?.sqlite?.integrityCheck === 'ok'
})

const flusherHealthy = computed(() => {
  const f = status.value?.flusher
  if (!f) return true
  // 有错误但也有成功，并且最近一次是成功 → healthy
  if (!f.lastErrorAt) return true
  if (!f.lastSuccessAt) return false
  return f.lastSuccessAt >= f.lastErrorAt
})

function rowCountLabel(k) {
  switch (k) {
    case 'apiKeys':
      return 'API Keys'
    case 'accounts':
      return 'Accounts'
    case 'tags':
      return 'Tags'
    case 'usageDaily':
      return 'Usage (日)'
    default:
      return k
  }
}

function formatBytes(n) {
  if (n == null) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTime(ts) {
  if (!ts) return '-'
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch (_err) {
    return String(ts)
  }
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n)}...` : s
}

async function refresh() {
  try {
    loading.value = true
    const { data } = await getStorageStatus()
    status.value = data
    error.value = null
  } catch (err) {
    error.value = err?.response?.data?.message || err.message || String(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  refresh()
  timer = setInterval(refresh, 10000)
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>
