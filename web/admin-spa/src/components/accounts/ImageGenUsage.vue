<template>
  <div class="space-y-2" :title="snapshotTitle">
    <div
      v-for="window in displayWindows"
      :key="window.name"
      class="rounded-lg bg-gray-50 p-2 dark:bg-gray-700/70"
    >
      <div class="flex items-center gap-2">
        <span
          class="inline-flex min-w-[32px] justify-center rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-600 dark:bg-purple-500/20 dark:text-purple-300"
          :title="`GPT-Image-2 · ${window.label}`"
        >
          image-2
        </span>
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <div class="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
              <div
                class="h-2 rounded-full transition-all duration-300"
                :class="
                  window.stale
                    ? 'bg-gray-400'
                    : window.percent >= 90
                      ? 'bg-gradient-to-r from-red-500 to-red-600'
                      : window.percent >= 60
                        ? 'bg-gradient-to-r from-yellow-500 to-orange-500'
                        : 'bg-gradient-to-r from-blue-500 to-indigo-600'
                "
                :style="{
                  width: `${window.percent === null ? 0 : Math.min(100, window.percent)}%`
                }"
              />
            </div>
            <span
              class="w-12 text-right text-xs font-semibold"
              :class="
                window.stale
                  ? 'text-gray-400 dark:text-gray-500'
                  : 'text-gray-800 dark:text-gray-100'
              "
              >{{
                window.stale ? '已重置' : window.percent === null ? '未知' : `${window.percent}%`
              }}</span
            >
          </div>
        </div>
      </div>
      <div class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{{ window.resetLabel }}</div>
      <div v-if="window.lastSnapshotLabel" class="text-[11px] text-gray-400 dark:text-gray-500">
        {{ window.lastSnapshotLabel }}
      </div>
    </div>
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
    ? `生图额度快照：${new Date(props.usage.updatedAt).toLocaleString()}。仅生图请求返回后更新，与聊天额度独立；额度窗口按上游固定周期重置，不随每次生图重新计时。`
    : '暂无生图额度快照；下一次生图请求返回后更新。'
)

const pad = (value) => String(value).padStart(2, '0')
// 过期快照只作为历史参考展示，标注采集时间，避免被误读为当前额度。
const formatSnapshotTime = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

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
    const lastPercent =
      typeof value.usedPercent === 'number' && Number.isFinite(value.usedPercent)
        ? `${Math.max(0, value.usedPercent)}%`
        : '未知'
    // 窗口重置后旧百分比不再代表当前额度，但保留为“上次快照”供参考。
    const lastSnapshotLabel = stale
      ? `上次快照：${lastPercent} · ${formatSnapshotTime(props.usage?.updatedAt)} 更新`
      : ''
    let resetLabel = '重置时间未知'
    if (stale) resetLabel = '上一配额窗口已重置，下次生图后刷新'
    else if (Number.isFinite(resetMs)) {
      const seconds = Math.max(0, Math.floor((resetMs - now.value) / 1000))
      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      const remaining =
        days > 0
          ? `${days}天${hours > 0 ? `${hours}小时` : ''}`
          : hours > 0
            ? `${hours}小时${minutes > 0 ? `${minutes}分钟` : ''}`
            : minutes > 0
              ? `${minutes}分钟`
              : '不足1分钟'
      resetLabel = `重置剩余 ${remaining}`
    }
    return [{ name, label, percent, stale, resetLabel, lastSnapshotLabel }]
  })
)
// 无快照时保持同样的额度卡片布局，不能把未知用量展示成 0%。
const displayWindows = computed(() =>
  windows.value.length
    ? windows.value
    : [
        {
          name: 'pending',
          label: '额度',
          percent: null,
          stale: false,
          resetLabel: '待生图更新',
          lastSnapshotLabel: ''
        }
      ]
)
</script>
