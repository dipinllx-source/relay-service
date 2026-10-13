<template>
  <div class="rounded-lg bg-gray-50 p-2 dark:bg-gray-700/70" :title="snapshotTitle">
    <div class="flex items-center gap-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-300">
      <i aria-hidden="true" class="far fa-image" />
      <span>GPT-Image-2</span>
    </div>
    <template v-if="windows.length">
      <div v-for="window in windows" :key="window.name" class="mt-1.5">
        <div class="flex items-center gap-2">
          <span class="min-w-[32px] text-[11px] text-gray-500 dark:text-gray-400">{{
            window.label
          }}</span>
          <div
            class="h-2 min-w-[40px] flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600"
          >
            <div
              class="h-2 rounded-full"
              :class="
                window.stale ? 'bg-gray-400' : window.percent >= 90 ? 'bg-red-500' : 'bg-blue-500'
              "
              :style="{ width: `${window.percent === null ? 0 : Math.min(100, window.percent)}%` }"
            />
          </div>
          <span class="w-12 text-right text-xs font-semibold text-gray-800 dark:text-gray-100">{{
            window.percent === null ? '未知' : `${window.percent}%`
          }}</span>
        </div>
        <div class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{{ window.resetLabel }}</div>
      </div>
    </template>
    <div v-else class="mt-1 text-[11px] text-gray-400">待生图更新</div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({ usage: { type: Object, default: null } })
const now = ref(Date.now())
let timer
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 30000)
})
onUnmounted(() => clearInterval(timer))

const snapshotTitle = computed(() =>
  props.usage?.updatedAt
    ? `生图额度快照：${new Date(props.usage.updatedAt).toLocaleString()}。仅生图请求返回后更新，与聊天额度独立。`
    : '暂无生图额度快照；下一次生图请求返回后更新。'
)

const windows = computed(() =>
  ['primary', 'secondary'].flatMap((name) => {
    const value = props.usage?.[name]
    if (!value) return []
    const resetMs = Date.parse(value.resetAt)
    const stale = Number.isFinite(resetMs) && resetMs <= now.value
    const percent =
      !stale && typeof value.usedPercent === 'number' && Number.isFinite(value.usedPercent)
        ? Math.max(0, value.usedPercent)
        : null
    const minutes = value.windowMinutes
    const label =
      minutes >= 1440 && minutes % 1440 === 0
        ? `${minutes / 1440}天`
        : minutes >= 60 && minutes % 60 === 0
          ? `${minutes / 60}h`
          : minutes > 0
            ? `${minutes}m`
            : '额度'
    let resetLabel = '重置时间未知'
    if (stale) resetLabel = '快照已过期，待生图更新'
    else if (Number.isFinite(resetMs)) {
      const remainingMinutes = Math.ceil((resetMs - now.value) / 60000)
      const hours = Math.floor(remainingMinutes / 60)
      resetLabel = `重置剩余 ${hours ? `${hours}h ` : ''}${remainingMinutes % 60}m`
    }
    return [{ name, label, percent, stale, resetLabel }]
  })
)
</script>
