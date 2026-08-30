<template>
  <div class="api-input-wide-card mb-6 rounded-2xl p-5">
    <!-- 标题区域 -->
    <div class="wide-card-title mb-4">
      <h2 class="mb-1 text-lg font-bold text-gray-900 dark:text-gray-200 sm:text-xl">
        <i class="fas fa-chart-line mr-2" />
        使用统计查询
      </h2>
      <p class="text-sm text-gray-600 dark:text-gray-400">查询您的 API Key 使用情况和统计数据</p>
    </div>

    <!-- 输入区域 -->
    <div class="mx-auto max-w-4xl">
      <!-- 控制栏 -->
      <div class="control-bar mb-4 flex flex-wrap items-center justify-between gap-3">
        <!-- API Key 标签 -->
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
          <i class="fas fa-key mr-2" />
          {{ multiKeyMode ? '输入您的 API Keys（每行一个或用逗号分隔）' : '输入您的 API Key' }}
        </label>

        <!-- 模式切换和查询按钮组 -->
        <div class="button-group flex items-center gap-2">
          <!-- 模式切换 -->
          <div class="seg bg-gray-100 dark:bg-gray-800">
            <button
              class="seg-item"
              :class="
                !multiKeyMode
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
              "
              title="单一模式"
              @click="multiKeyMode = false"
            >
              <i class="fas fa-key" />
              <span class="hidden sm:inline">单一</span>
            </button>
            <button
              class="seg-item"
              :class="
                multiKeyMode
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
              "
              title="聚合模式"
              @click="multiKeyMode = true"
            >
              <i class="fas fa-layer-group" />
              <span class="hidden sm:inline">聚合</span>
              <span
                v-if="multiKeyMode && parsedApiKeys.length > 0"
                class="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-xs font-semibold"
              >
                {{ parsedApiKeys.length }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div class="api-input-grid grid grid-cols-1 gap-4 lg:grid-cols-4">
        <!-- API Key 输入 -->
        <div class="lg:col-span-3">
          <!-- 单 Key 模式输入框 -->
          <div v-if="!multiKeyMode" class="relative">
            <input
              v-model="apiKey"
              class="wide-card-input w-full pr-10"
              :disabled="loading"
              placeholder="请输入您的 API Key (cr_...)"
              :type="showPassword ? 'text' : 'password'"
              @keyup.enter="queryStats"
            />
            <button
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              type="button"
              @click="showPassword = !showPassword"
            >
              <i :class="showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'" />
            </button>
          </div>

          <!-- 多 Key 模式输入框 -->
          <div v-else class="relative">
            <textarea
              v-model="apiKey"
              class="wide-card-input w-full resize-y"
              :disabled="loading"
              placeholder="请输入您的 API Keys，支持以下格式：&#10;cr_xxx&#10;cr_yyy&#10;或&#10;cr_xxx, cr_yyy"
              rows="4"
              @keyup.ctrl.enter="queryStats"
            />
            <button
              v-if="apiKey && !loading"
              class="absolute right-2 top-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              title="清空输入"
              @click="clearInput"
            >
              <i class="fas fa-times-circle" />
            </button>
          </div>
        </div>

        <!-- 查询按钮 -->
        <div class="lg:col-span-1">
          <button
            class="btn-md w-full bg-gradient-to-r from-blue-500 to-blue-600 font-medium text-white shadow-sm transition-all duration-200 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="loading || !hasValidInput"
            @click="queryStats"
          >
            <i v-if="loading" class="fas fa-spinner loading-spinner" />
            <i v-else class="fas fa-search" />
            {{ loading ? '查询中...' : '查询统计' }}
          </button>
        </div>
      </div>

      <!-- 安全提示 -->
      <div class="security-notice mt-4">
        <i class="fas fa-shield-alt mr-2" />
        {{
          multiKeyMode
            ? '您的 API Keys 仅用于查询统计数据，不会被存储。聚合模式下部分个体化信息将不显示。'
            : '您的 API Key 仅用于查询自己的统计数据，不会被存储或用于其他用途'
        }}
      </div>

      <!-- 多 Key 模式额外提示 -->
      <div
        v-if="multiKeyMode"
        class="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
      >
        <i class="fas fa-lightbulb mr-2" />
        <span>提示：最多支持同时查询 30 个 API Keys。使用 Ctrl+Enter 快速查询。</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useApiStatsStore } from '@/stores/apistats'

const apiStatsStore = useApiStatsStore()
const { apiKey, loading, multiKeyMode } = storeToRefs(apiStatsStore)
const { queryStats, clearInput } = apiStatsStore

const showPassword = ref(false)

// 解析输入的 API Keys
const parsedApiKeys = computed(() => {
  if (!multiKeyMode.value || !apiKey.value) return []

  // 支持逗号和换行符分隔
  const keys = apiKey.value
    .split(/[,\n]+/)
    .map((key) => key.trim())
    .filter((key) => key.length > 0)

  // 去重并限制最多30个
  const uniqueKeys = [...new Set(keys)]
  return uniqueKeys.slice(0, 30)
})

// 判断是否有有效输入
const hasValidInput = computed(() => {
  if (multiKeyMode.value) {
    return parsedApiKeys.value.length > 0
  }
  return apiKey.value && apiKey.value.trim().length > 0
})
</script>

<style scoped>
/* 宽卡片样式 - 使用CSS变量 */
/*
 * 归统到管理台卡片观感：16px 圆角（模板上的 rounded-2xl）+ 常规边框 + 轻阴影。
 * 原先是 rounded-3xl 配 50px 扩散阴影与 hover 位移，与看板/账户等页的 .card 完全两套。
 */
.api-input-wide-card {
  background: var(--surface-color);
  border: 1px solid var(--border-color);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  transition: box-shadow 0.2s ease;
}

/* 标题样式：去掉 text-shadow，与其余管理页标题一致 */
.dark .wide-card-title h2 {
  color: #f9fafb;
}

.wide-card-title p {
  color: #6b7280;
}

.dark .wide-card-title p {
  color: #9ca3af;
}

.wide-card-title .fas.fa-chart-line {
  color: #3b82f6;
}

/* 网格布局 */
.api-input-grid {
  align-items: end;
  gap: 1rem;
}

/* 输入框样式 - 使用CSS变量 */
/*
 * 输入框收到 32px / r8px 基线：原为 2px 边框 + 12px 圆角 + 16px 字号 + 14px 内距，
 * 比同页分段控件高一大截。单行 input 固定 32px；textarea 是多行，只统一
 * 边框/圆角/字号，高度仍由 rows 决定。
 */
.wide-card-input {
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--ctl-radius);
  padding: 0 var(--ctl-px-md);
  font-size: var(--ctl-fs-md);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
  color: var(--text-primary);
  box-sizing: border-box;
}

input.wide-card-input {
  height: var(--ctl-h-md);
  line-height: 1;
}

textarea.wide-card-input {
  padding: 8px var(--ctl-px-md);
  line-height: 1.5;
}

.dark .wide-card-input {
  color: #e5e7eb;
}

.wide-card-input::placeholder {
  color: #9ca3af;
}

.dark .wide-card-input::placeholder {
  color: #64748b;
}

.wide-card-input:focus {
  outline: none;
  border-color: #60a5fa;
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.2);
  background: white;
  color: #1f2937;
}

.dark .wide-card-input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.15);
  background: var(--glass-strong-color);
  color: #f3f4f6;
}

/*
 * 查询按钮改用全局 .btn-md（32px / r8px），本地不再重复定义 .btn / .btn-primary，
 * 避免与 global.css 的按钮基线冲突（原先是 14px 内距 + 16px 字号 = 52px 高）。
 */
/* 安全提示样式 */
.security-notice {
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  padding: 12px 16px;
  color: #374151;
  font-size: 0.875rem;
  transition: all 0.3s ease;
}

.dark .security-notice {
  background: var(--glass-strong-color) !important;
  border: 1px solid var(--border-color) !important;
  color: #d1d5db !important;
}

.security-notice:hover {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.5);
  color: #1f2937;
}

.dark .security-notice:hover {
  background: var(--glass-strong-color) !important;
  border-color: var(--border-color) !important;
  color: #e5e7eb !important;
}

.security-notice .fas.fa-shield-alt {
  color: #10b981;
  text-shadow: 0 1px 2px rgba(16, 185, 129, 0.2);
}

/* 控制栏 */
.control-bar {
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
}

.dark .control-bar {
  border-bottom-color: rgba(75, 85, 99, 0.3);
}

/* 按钮组 */
.button-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* 淡入淡出动画 */
.fade-enter-active,
.fade-leave-active {
  transition: all 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

/* 加载动画 */
.loading-spinner {
  animation: spin 1s linear infinite;
  filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.5));
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 响应式优化 */
@media (max-width: 768px) {
  .control-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .button-group {
    justify-content: center;
  }
}

@media (max-width: 768px) {
  .api-input-wide-card {
    padding: 1.25rem;
  }

  .wide-card-title {
    margin-bottom: 1.25rem;
  }

  .wide-card-title h2 {
    font-size: 1.5rem;
  }

  .wide-card-title p {
    font-size: 0.875rem;
  }

  .api-input-grid {
    gap: 1rem;
  }

  .security-notice {
    padding: 10px 14px;
    font-size: 0.8rem;
  }
}

@media (max-width: 480px) {
  .mode-toggle-btn {
    padding: 5px 8px;
  }

  .toggle-icon {
    width: 18px;
    height: 18px;
  }

  .hint-text {
    font-size: 0.7rem;
    padding: 4px 8px;
  }
}

@media (max-width: 480px) {
  .api-input-wide-card {
    padding: 1rem;
  }

  .wide-card-title h2 {
    font-size: 1.25rem;
  }

  .wide-card-title p {
    font-size: 0.8rem;
  }
}
</style>
