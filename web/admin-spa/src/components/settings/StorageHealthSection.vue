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
import { getStorageStatus } from '@/utils/http_apis'

const loading = ref(false)
const status = ref(null)
const error = ref(null)
let timer = null

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
