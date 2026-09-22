<template>
  <div
    class="mb-6 rounded-xl border border-gray-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4 dark:border-gray-700 dark:from-emerald-900/20 dark:to-teal-900/20"
  >
    <div class="mb-3 flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-4">
        <div
          class="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
        >
          <i class="fas fa-list-ul text-xl" />
        </div>
        <div>
          <p class="text-sm font-medium text-gray-700 dark:text-gray-300">上游模型清单</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            全局每天自动拉取一次，需要立即生效时点右侧按钮
          </p>
        </div>
      </div>
      <button
        :class="[
          'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition',
          refreshing
            ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
            : 'bg-emerald-500 text-white hover:bg-emerald-600 hover:shadow-md'
        ]"
        :disabled="refreshing"
        @click="handleRefresh"
      >
        <i :class="['fas', refreshing ? 'fa-spinner fa-spin' : 'fa-sync-alt']" />
        {{ refreshing ? '更新中...' : '立即更新' }}
      </button>
    </div>

    <div v-if="loading" class="py-6 text-center">
      <i class="fas fa-spinner fa-spin text-xl text-emerald-500" />
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2">
      <div
        v-for="segment in segments"
        :key="segment.key"
        class="rounded-lg border border-gray-200 bg-white/70 p-3 dark:border-gray-700 dark:bg-gray-800/50"
      >
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {{ segment.label }}
          </span>
          <span
            :class="[
              'rounded-full px-2 py-0.5 text-xs font-medium',
              segment.data.source === 'upstream'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
            ]"
          >
            {{ segment.data.source === 'upstream' ? '上游' : '静态兜底' }}
          </span>
        </div>

        <p class="text-xs text-gray-500 dark:text-gray-400">
          模型数：
          <span class="font-bold text-gray-700 dark:text-gray-200">{{ segment.data.count }}</span>
          <span v-if="!segment.data.fresh && segment.data.count > 0" class="ml-2 text-amber-600">
            (已过期，下次请求会触发刷新)
          </span>
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          更新时间：{{ formatTime(segment.data.fetchedAt) }}
        </p>
        <p v-if="segment.data.lastError" class="mt-1 break-all text-xs text-red-500">
          <i class="fas fa-triangle-exclamation mr-1" />
          上次拉取失败：{{ segment.data.lastError }}
        </p>
      </div>
    </div>

    <p v-if="!loading" class="mt-3 text-right text-xs text-gray-400 dark:text-gray-500">
      日限流 {{ formatHours(status.successTtlMs) }} / 失败重试间隔
      {{ formatMinutes(status.failureRetryMs) }}
    </p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { getModelCatalogStatusApi, refreshModelCatalogApi } from '@/utils/http_apis'
import { showToast } from '@/utils/tools'

const loading = ref(false)
const refreshing = ref(false)
const status = ref({})

const emptySegment = {
  count: 0,
  source: 'fallback',
  fetchedAt: null,
  fresh: false,
  lastError: null
}

const segments = computed(() => [
  { key: 'claude', label: 'Claude', data: status.value.claude || emptySegment },
  { key: 'openai', label: 'Codex / OpenAI', data: status.value.openai || emptySegment }
])

const formatTime = (value) => {
  if (!value) {
    return '从未成功'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '从未成功' : date.toLocaleString()
}

const formatHours = (ms) => (ms ? `${Math.round(ms / (60 * 60 * 1000))} 小时` : '-')
const formatMinutes = (ms) => (ms ? `${Math.round(ms / (60 * 1000))} 分钟` : '-')

const loadData = async () => {
  loading.value = true
  const result = await getModelCatalogStatusApi()
  if (result.success) {
    status.value = result.data
  } else {
    showToast(result.message || '获取模型清单状态失败', 'error')
  }
  loading.value = false
}

const handleRefresh = async () => {
  refreshing.value = true
  const result = await refreshModelCatalogApi()
  if (result.success) {
    status.value = result.data?.status || status.value
    const updated = Object.values(result.data?.results || {}).filter((r) => r.updated).length
    showToast(updated > 0 ? `模型清单已更新（${updated} 段）` : '清单已是最新', 'success')
  } else {
    showToast(result.message || '更新失败', 'error')
  }
  refreshing.value = false
}

onMounted(loadData)
</script>
