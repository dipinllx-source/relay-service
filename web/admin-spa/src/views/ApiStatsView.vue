<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <!-- 与首页 / 快速开始 / 使用教程 共用同一个对外页顶栏。
         本页同为免登录公开页，此前自造了一套只有「管理后台」出口的顶栏，
         未登录进来无法导航回任何公开页。 -->
    <PublicNav />

    <div class="stats-body">
      <!-- 统计内容。原先此处有「统计查询 / 使用教程」页内 Tab，
           与顶栏 PublicNav 的「使用教程」重复；教程完整版在 /tutorial，故移除 -->
      <div class="tab-content">
        <!-- 公共概览：查询前后都展示。
             原为 !hasQueried，查询成功后整块消失 —— 而倍率恰恰是看懂费用的前提 -->
        <div
          v-if="platformRates.length"
          class="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="mb-3 flex items-baseline justify-between gap-3">
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              可接入平台与计费倍率
            </p>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              共 {{ platformRates.length }} 个平台
            </span>
          </div>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="item in platformRates"
              :key="item.key"
              class="flex items-baseline gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40"
            >
              <span class="text-xs text-gray-600 dark:text-gray-300">{{ item.label }}</span>
              <span class="text-sm font-bold tabular-nums text-blue-600 dark:text-blue-400">
                ×{{ item.rate }}
              </span>
            </div>
          </div>
        </div>

        <!-- API Key 输入区域 -->
        <ApiKeyInput />

        <!-- 错误提示 -->
        <div v-if="error" class="mb-4 sm:mb-6 md:mb-8">
          <div
            class="rounded-xl border border-red-500/30 bg-red-500/20 p-3 text-sm text-red-800 backdrop-blur-sm dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200 md:p-4 md:text-base"
          >
            <i class="fas fa-exclamation-triangle mr-2" />
            {{ error }}
          </div>
        </div>

        <!-- 统计数据展示区域 -->
        <div v-if="statsData" class="fade-in">
          <div
            class="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-4 md:p-6"
          >
            <!-- 时间范围选择器 -->
            <div
              class="mb-3 border-b border-gray-200 pb-3 dark:border-gray-700 sm:mb-4 sm:pb-4 md:mb-6 md:pb-6"
            >
              <div
                class="flex flex-col items-start justify-between gap-2 sm:gap-3 md:flex-row md:items-center md:gap-4"
              >
                <div class="flex items-center gap-2 md:gap-3">
                  <i class="fas fa-clock text-base text-blue-500 md:text-lg" />
                  <span class="text-base font-medium text-gray-700 dark:text-gray-200 md:text-lg"
                    >统计时间范围</span
                  >
                </div>
                <div class="flex w-full items-center gap-2 md:w-auto">
                  <button
                    class="flex flex-1 items-center justify-center gap-1.5 md:flex-none"
                    :class="['period-btn', { active: statsPeriod === 'daily' }]"
                    :disabled="loading"
                    @click="switchPeriod('daily')"
                  >
                    <i class="fas fa-calendar-day" />
                    今日
                  </button>
                  <button
                    class="flex flex-1 items-center justify-center gap-1.5 md:flex-none"
                    :class="['period-btn', { active: statsPeriod === 'monthly' }]"
                    :disabled="loading"
                    @click="switchPeriod('monthly')"
                  >
                    <i class="fas fa-calendar-alt" />
                    本月
                  </button>
                  <button
                    class="flex flex-1 items-center justify-center gap-1.5 md:flex-none"
                    :class="['period-btn', { active: statsPeriod === 'alltime' }]"
                    :disabled="loading"
                    @click="switchPeriod('alltime')"
                  >
                    <i class="fas fa-infinity" />
                    全部
                  </button>
                  <!-- 测试按钮下拉菜单 - 仅在单Key模式下显示 -->
                  <div v-if="!multiKeyMode" class="relative">
                    <button
                      :class="[
                        'test-btn flex items-center justify-center gap-1.5',
                        !hasAnyTestPermission ? 'cursor-not-allowed opacity-50' : ''
                      ]"
                      :disabled="loading || !hasAnyTestPermission"
                      :title="
                        hasAnyTestPermission
                          ? '测试 API'
                          : `当前 Key 可用服务: ${availableServicesText}`
                      "
                      @click="toggleTestMenu"
                    >
                      <i class="fas fa-vial" />
                      测试
                      <i class="fas fa-chevron-down text-xs opacity-60" />
                    </button>
                    <!-- 下拉菜单 -->
                    <div
                      v-if="showTestMenu"
                      class="absolute right-0 top-full z-50 mt-1 min-w-[140px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
                    >
                      <button
                        v-if="canTestClaude"
                        class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                        @click="openTestModal('claude')"
                      >
                        <i class="fas fa-robot text-orange-500" />
                        Claude
                      </button>
                      <button
                        v-if="canTestGemini"
                        class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                        @click="openTestModal('gemini')"
                      >
                        <i class="fas fa-gem text-blue-500" />
                        Gemini
                      </button>
                      <button
                        v-if="canTestOpenAI"
                        class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                        @click="openTestModal('openai')"
                      >
                        <i class="fas fa-code text-green-500" />
                        Codex
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 基本信息和统计概览 -->
            <StatsOverview />

            <!-- Token 分布和限制配置 -->
            <div
              class="mb-4 mt-4 grid grid-cols-1 gap-3 sm:mb-6 sm:mt-6 sm:gap-4 md:mb-8 md:mt-8 md:gap-6 xl:grid-cols-2 xl:items-stretch"
            >
              <TokenDistribution class="h-full" />
              <template v-if="multiKeyMode">
                <AggregatedStatsCard class="h-full" />
              </template>
              <template v-else>
                <LimitConfig class="h-full" />
              </template>
            </div>

            <!-- 服务费用统计卡片 -->
            <ServiceCostCards class="mb-4 sm:mb-6" />

            <!-- 模型使用统计 - 三个时间段 -->
            <div class="space-y-4 sm:space-y-6">
              <ModelUsageStats period="daily" />
              <ModelUsageStats period="monthly" />
              <ModelUsageStats period="alltime" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- API Key 测试弹窗 -->
    <UnifiedTestModal
      :api-key-name="statsData?.name || ''"
      :api-key-value="apiKey"
      mode="apikey"
      :service-type="testServiceType"
      :show="showTestModal"
      @close="closeTestModal"
    />

    <!-- API Stats 通知弹框 -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="showNotice"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          @click.self="dismissNotice"
        >
          <div
            class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800"
            @click.stop
          >
            <div class="mb-4 flex items-center gap-3">
              <div
                class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white"
              >
                <i class="fas fa-bell" />
              </div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {{ oemSettings.apiStatsNotice?.title || '通知' }}
              </h3>
            </div>
            <p
              class="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-gray-300"
            >
              {{ oemSettings.apiStatsNotice?.content }}
            </p>
            <label class="mb-4 flex cursor-pointer items-center gap-2">
              <input
                v-model="dontShowAgain"
                class="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                type="checkbox"
              />
              <span class="text-sm text-gray-600 dark:text-gray-400">本次会话不再显示</span>
            </label>
            <button
              class="btn-md w-full bg-gradient-to-r from-blue-500 to-blue-600 font-medium text-white transition-all hover:from-blue-600 hover:to-blue-700"
              @click="dismissNotice"
            >
              知道了
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useApiStatsStore } from '@/stores/apistats'

import PublicNav from '@/components/public/PublicNav.vue'
import ApiKeyInput from '@/components/apistats/ApiKeyInput.vue'
import StatsOverview from '@/components/apistats/StatsOverview.vue'
import TokenDistribution from '@/components/apistats/TokenDistribution.vue'
import LimitConfig from '@/components/apistats/LimitConfig.vue'
import AggregatedStatsCard from '@/components/apistats/AggregatedStatsCard.vue'
import ModelUsageStats from '@/components/apistats/ModelUsageStats.vue'
import ServiceCostCards from '@/components/apistats/ServiceCostCards.vue'
import UnifiedTestModal from '@/components/common/UnifiedTestModal.vue'

const route = useRoute()
const apiStatsStore = useApiStatsStore()

const {
  apiKey,
  apiId,
  loading,
  error,
  statsPeriod,
  statsData,
  oemSettings,
  multiKeyMode,
  serviceRates
} = storeToRefs(apiStatsStore)

/*
 * 查询前的公共概览：本页未认证即可访问，因此只能取公开数据。
 * 刻意不展示全站用量总额——那会把整个部署的调用量与成本泄露给任何访客。
 * 这里用已加载的服务倍率（/apiStats/service-rates 为公开接口）推导可接入平台。
 */
const platformRates = computed(() => {
  const rates = serviceRates.value?.rates || {}
  const labels = {
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini',
    droid: 'Droid',
    bedrock: 'Bedrock',
    azure: 'Azure',
    ccr: 'CCR'
  }
  return Object.entries(rates).map(([key, rate]) => ({
    key,
    label: labels[key] || key,
    rate: Number(rate)
  }))
})

const {
  queryStats,
  switchPeriod,
  loadStatsWithApiId,
  loadOemSettings,
  loadServiceRates,
  loadApiKeyFromStorage,
  reset
} = apiStatsStore

// 测试弹窗状态
const showTestModal = ref(false)
const showTestMenu = ref(false)
const testServiceType = ref('claude')

// 通知弹框状态
const showNotice = ref(false)
const dontShowAgain = ref(false)
const NOTICE_STORAGE_KEY = 'apiStatsNoticeRead'

// 解析 permissions（可能是 JSON 字符串或数组）
const parsePermissions = (permissions) => {
  if (!permissions) return []
  if (Array.isArray(permissions)) return permissions
  if (typeof permissions === 'string') {
    if (permissions === 'all') return []
    try {
      const parsed = JSON.parse(permissions)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

// 检查是否可以测试 Claude（权限包含 claude 或全部）
const canTestClaude = computed(() => {
  const permissions = parsePermissions(statsData.value?.permissions)
  if (permissions.length === 0) return true
  return permissions.includes('claude')
})

// 检查是否可以测试 Gemini
const canTestGemini = computed(() => {
  const permissions = parsePermissions(statsData.value?.permissions)
  if (permissions.length === 0) return true
  return permissions.includes('gemini')
})

// 检查是否可以测试 OpenAI
const canTestOpenAI = computed(() => {
  const permissions = parsePermissions(statsData.value?.permissions)
  if (permissions.length === 0) return true
  return permissions.includes('openai')
})

// 检查是否有任何测试权限
const hasAnyTestPermission = computed(() => {
  return canTestClaude.value || canTestGemini.value || canTestOpenAI.value
})

// 可用服务文本
const availableServicesText = computed(() => {
  const permissions = parsePermissions(statsData.value?.permissions)
  if (permissions.length === 0) return '全部服务'
  const serviceNames = {
    claude: 'Claude',
    gemini: 'Gemini',
    openai: 'OpenAI',
    droid: 'Droid'
  }
  return permissions.map((s) => serviceNames[s] || s).join(', ')
})

// 切换测试菜单
const toggleTestMenu = () => {
  showTestMenu.value = !showTestMenu.value
}

// 打开测试弹窗
const openTestModal = (serviceType = 'claude') => {
  testServiceType.value = serviceType
  showTestMenu.value = false
  showTestModal.value = true
}

// 关闭测试弹窗
const closeTestModal = () => {
  showTestModal.value = false
}

// 关闭通知弹框
const dismissNotice = () => {
  showNotice.value = false
  if (dontShowAgain.value) {
    sessionStorage.setItem(NOTICE_STORAGE_KEY, '1')
  }
}

// 检查是否显示通知
const checkNotice = () => {
  const notice = oemSettings.value?.apiStatsNotice
  if (notice?.enabled && notice?.content && !sessionStorage.getItem(NOTICE_STORAGE_KEY)) {
    showNotice.value = true
  }
}

// 点击外部关闭菜单
const handleClickOutside = (event) => {
  if (showTestMenu.value && !event.target.closest('.relative')) {
    showTestMenu.value = false
  }
}

// 处理键盘快捷键
const handleKeyDown = (event) => {
  // Ctrl/Cmd + Enter 查询
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    if (!loading.value && apiKey.value.trim()) {
      queryStats()
    }
    event.preventDefault()
  }

  // ESC 清除数据
  if (event.key === 'Escape') {
    reset()
  }
}

// 初始化
onMounted(async () => {
  // API Stats Page loaded

  // 加载 OEM 设置和服务倍率
  await Promise.all([loadOemSettings(), loadServiceRates()])
  checkNotice()

  // 检查 URL 参数
  const urlApiId = route.query.apiId
  const urlApiKey = route.query.apiKey

  if (
    urlApiId &&
    urlApiId.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)
  ) {
    // 如果 URL 中有 apiId，直接使用 apiId 加载数据
    apiId.value = urlApiId
    // 同时从 localStorage 填充 API Key 到输入框
    const savedApiKey = loadApiKeyFromStorage()
    if (savedApiKey) {
      apiKey.value = savedApiKey
    }
    loadStatsWithApiId()
  } else if (urlApiKey && urlApiKey.length > 10) {
    // 向后兼容，支持 apiKey 参数
    apiKey.value = urlApiKey
  } else {
    // 没有 URL 参数，检查 localStorage
    const savedApiKey = loadApiKeyFromStorage()
    if (savedApiKey && savedApiKey.length > 10) {
      apiKey.value = savedApiKey
      queryStats()
    }
  }

  // 添加键盘事件监听
  document.addEventListener('keydown', handleKeyDown)
  // 添加点击外部关闭菜单监听
  document.addEventListener('click', handleClickOutside)
})

// 清理
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('click', handleClickOutside)
})

// 监听 API Key 变化
watch(apiKey, (newValue) => {
  if (!newValue) {
    apiStatsStore.clearData()
  }
})
</script>

<style scoped>
/* 顶栏由 PublicNav 提供（.apple-nav 为 fixed，需为其留出 48px 顶部空间），
   与首页 / 快速开始 / 使用教程 完全一致 */
.stats-body {
  max-width: 1400px;
  margin: 0 auto;
  padding: 68px 20px 40px;
}
@media (max-width: 640px) {
  .stats-body {
    padding: 60px 12px 24px;
  }
}

/* 渐变背景 */

/* 暗色模式的渐变背景 */

/* 暗色模式的背景覆盖 */

/* 玻璃态效果 - 使用CSS变量 */
.glass-strong {
  background: var(--glass-strong-color);
  backdrop-filter: blur(25px);
  border: 1px solid var(--border-color);
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.25),
    0 0 0 1px rgba(255, 255, 255, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  position: relative;
  z-index: 1;
}

/* 暗色模式的玻璃态效果 */
.dark .glass-strong {
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.7),
    0 0 0 1px rgba(55, 65, 81, 0.3),
    inset 0 1px 0 rgba(75, 85, 99, 0.2);
}

/* 用户登录按钮 */
.user-login-button {
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  color: #374151;
  text-decoration: none;
  position: relative;
  overflow: hidden;
  font-weight: 600;
}

/* 暗色模式下的用户登录按钮 */
.dark .user-login-button {
  background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
  border: 1px solid rgba(52, 211, 153, 0.4);
  color: white;
  box-shadow:
    0 4px 12px rgba(52, 211, 153, 0.3),
    inset 0 1px 1px rgba(255, 255, 255, 0.1);
}

.user-login-button::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, #10b981 0%, #34d399 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.user-login-button:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow:
    0 8px 20px rgba(52, 211, 153, 0.35),
    inset 0 1px 1px rgba(255, 255, 255, 0.3);
  border-color: rgba(255, 255, 255, 0.4);
}

.user-login-button:hover::before {
  opacity: 1;
}

/* 暗色模式下的悬停效果 */
.dark .user-login-button:hover {
  box-shadow:
    0 8px 20px rgba(52, 211, 153, 0.4),
    inset 0 1px 1px rgba(255, 255, 255, 0.2);
  border-color: rgba(52, 211, 153, 0.5);
}

.user-login-button:active {
  transform: translateY(-1px) scale(1);
}

/* 确保图标和文字在所有模式下都清晰可见 */
.user-login-button i,
.user-login-button span {
  position: relative;
  z-index: 1;
}

/* 管理后台按钮 - 精致版本 */
.admin-button-refined {
  /* 品牌紫保留为主按钮实色，不再做渐变+外发光胶囊 */
  background: var(--primary-color);
  border: 1px solid var(--primary-color);
  color: white;
  text-decoration: none;
  position: relative;
  overflow: hidden;
  font-weight: 600;
}

/* 暗色模式下的管理后台按钮 */
.dark .admin-button-refined {
  background: rgba(55, 65, 81, 0.8);
  border: 1px solid rgba(107, 114, 128, 0.4);
  color: #f3f4f6;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.3),
    inset 0 1px 1px rgba(255, 255, 255, 0.05);
}

.admin-button-refined::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, var(--secondary-color) 0%, var(--primary-color) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.admin-button-refined:hover {
  transform: translateY(-2px) scale(1.02);
  background: linear-gradient(135deg, var(--secondary-color) 0%, var(--primary-color) 100%);
  box-shadow:
    0 8px 20px rgba(var(--secondary-rgb), 0.35),
    inset 0 1px 1px rgba(255, 255, 255, 0.3);
  border-color: rgba(255, 255, 255, 0.4);
  color: white;
}

.admin-button-refined:hover::before {
  opacity: 1;
}

/* 暗色模式下的悬停效果 */
.dark .admin-button-refined:hover {
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
  border-color: rgba(var(--secondary-rgb), 0.4);
  box-shadow:
    0 8px 20px rgba(var(--primary-rgb), 0.3),
    inset 0 1px 1px rgba(255, 255, 255, 0.1);
  color: white;
}

.admin-button-refined:active {
  transform: translateY(-1px) scale(1);
}

/* 确保图标和文字在所有模式下都清晰可见 */
.admin-button-refined i,
.admin-button-refined span {
  position: relative;
  z-index: 1;
}

/* 时间范围与测试按钮：归到管理台控件基线
   32px(--ctl-h-md) / r8px(--ctl-radius)，取消渐变、外发光与 hover 位移 */
.period-btn,
.test-btn {
  height: var(--ctl-h-md);
  padding: 0 12px;
  border-radius: var(--ctl-radius);
  font-size: var(--ctl-fs-sm);
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.period-btn.active {
  background: var(--primary-color);
  border: 1px solid var(--primary-color);
  color: #fff;
}

.period-btn:not(.active),
.test-btn {
  color: #374151;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
}

.period-btn:not(.active):hover:not(:disabled),
.test-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.04);
}

:global(html.dark) .period-btn:not(.active),
:global(html.dark) .test-btn {
  color: #e5e7eb;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}

:global(html.dark) .period-btn:not(.active):hover:not(:disabled),
:global(html.dark) .test-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Tab 内容切换动画 */
.tab-content {
  animation: tabFadeIn 0.4s ease-out;
}

@keyframes tabFadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 动画效果 */
.fade-in {
  animation: fadeIn 0.6s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 通知弹框动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
