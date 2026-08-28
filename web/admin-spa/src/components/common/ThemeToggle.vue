<template>
  <!--
    单一主题入口：一个触发器 + 一个面板，面板内同时提供配色方案与明暗模式。
    原实现在同一处并列了「色系按钮」与「明暗开关」两个控件，且另有
    compact / segmented 两个无挂载点的分支；明暗模式此前只能循环切换
    （setThemeMode 的唯一绑定在死分支 segmented 内），现可直接选定。
  -->
  <div class="theme-entry">
    <button
      class="theme-entry__trigger"
      :class="{ 'is-open': showPanel }"
      :title="triggerTooltip"
      type="button"
      @click.stop="togglePanel"
    >
      <span
        class="theme-entry__dot"
        :style="{
          background: `linear-gradient(135deg, ${themeStore.currentColorScheme.primary} 0%, ${themeStore.currentColorScheme.secondary} 100%)`
        }"
      />
      <i class="theme-entry__mode-icon" :class="currentModeOption.icon" />
      <i class="fas fa-chevron-down theme-entry__caret" />
    </button>

    <transition name="dropdown">
      <div v-if="showPanel" class="theme-panel" @click.stop>
        <div class="theme-panel__section">
          <p class="theme-panel__label">配色方案</p>
          <div class="theme-panel__schemes">
            <button
              v-for="(scheme, key) in themeStore.ColorSchemes"
              :key="key"
              class="scheme-option"
              :class="{ active: themeStore.colorScheme === key }"
              :title="scheme.name"
              type="button"
              @click="selectColorScheme(key)"
            >
              <span
                class="scheme-option__swatch"
                :style="{
                  background: `linear-gradient(135deg, ${scheme.primary} 0%, ${scheme.secondary} 100%)`
                }"
              />
              <span class="scheme-option__name">{{ scheme.name }}</span>
              <i v-if="themeStore.colorScheme === key" class="fas fa-check scheme-option__check" />
            </button>
          </div>
        </div>

        <div class="theme-panel__divider" />

        <div class="theme-panel__section">
          <p class="theme-panel__label">明暗模式</p>
          <div class="theme-panel__modes">
            <button
              v-for="option in themeOptions"
              :key="option.value"
              class="mode-option"
              :class="{ active: themeStore.themeMode === option.value }"
              :title="option.label"
              type="button"
              @click="selectTheme(option.value)"
            >
              <i :class="option.icon" />
              <span>{{ option.shortLabel }}</span>
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

const showPanel = ref(false)

const themeOptions = [
  { value: 'light', label: '浅色模式', shortLabel: '浅色', icon: 'fas fa-sun' },
  { value: 'dark', label: '深色模式', shortLabel: '深色', icon: 'fas fa-moon' },
  { value: 'auto', label: '跟随系统', shortLabel: '自动', icon: 'fas fa-circle-half-stroke' }
]

const currentModeOption = computed(
  () => themeOptions.find((opt) => opt.value === themeStore.themeMode) || themeOptions[2]
)

const triggerTooltip = computed(
  () => `主题：${themeStore.currentColorScheme.name} · ${currentModeOption.value.label}`
)

const togglePanel = () => {
  showPanel.value = !showPanel.value
}

const selectColorScheme = (scheme) => {
  themeStore.setColorScheme(scheme)
}

const selectTheme = (mode) => {
  themeStore.setThemeMode(mode)
}

const handleClickOutside = (e) => {
  if (!e.target.closest('.theme-entry')) {
    showPanel.value = false
  }
}

const handleEscape = (e) => {
  if (e.key === 'Escape') showPanel.value = false
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleEscape)
})
</script>

<style scoped>
.theme-entry {
  @apply relative inline-flex items-center;
}

.theme-entry__trigger {
  @apply inline-flex items-center gap-2;
  @apply rounded-lg border border-gray-200 bg-white px-2.5;
  @apply text-gray-600 shadow-sm;
  @apply transition-all duration-200;
  @apply hover:border-gray-300 hover:shadow-md;
  @apply dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500;
  height: var(--ctl-h-md);
  box-sizing: border-box;
  cursor: pointer;
}

.theme-entry__trigger.is-open {
  @apply border-gray-300 dark:border-gray-500;
}

.theme-entry__dot {
  @apply h-4 w-4 flex-shrink-0 rounded-full shadow-sm;
}

.theme-entry__mode-icon {
  @apply text-xs;
}

.theme-entry__caret {
  @apply text-[10px] opacity-50;
  @apply transition-transform duration-200;
}

.theme-entry__trigger.is-open .theme-entry__caret {
  transform: rotate(180deg);
}

.theme-panel {
  @apply absolute right-0 top-full z-50 mt-2;
  @apply rounded-xl border border-gray-200 bg-white shadow-xl;
  @apply dark:border-gray-700 dark:bg-gray-800;
  @apply w-56 p-2;
}

.theme-panel__section {
  @apply px-1 py-1;
}

.theme-panel__label {
  @apply mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide;
  @apply text-gray-400 dark:text-gray-500;
}

.theme-panel__divider {
  @apply my-1 border-t border-gray-100 dark:border-gray-700;
}

.theme-panel__schemes {
  @apply max-h-52 overflow-y-auto;
}

.scheme-option {
  @apply flex w-full items-center gap-2;
  @apply rounded-lg px-2 py-1.5;
  @apply text-sm text-gray-700 dark:text-gray-300;
  @apply hover:bg-gray-100 dark:hover:bg-gray-700;
  @apply transition-colors duration-150;
  cursor: pointer;
}

.scheme-option.active {
  @apply bg-gray-100 font-medium dark:bg-gray-700;
}

.scheme-option__swatch {
  @apply h-4 w-4 flex-shrink-0 rounded-full shadow-sm;
}

.scheme-option__name {
  @apply flex-1 text-left;
}

.scheme-option__check {
  @apply text-xs text-gray-400 dark:text-gray-400;
}

.theme-panel__modes {
  @apply grid grid-cols-3 gap-1;
}

.mode-option {
  @apply flex flex-col items-center justify-center gap-1;
  @apply rounded-lg px-1 py-2;
  @apply text-[11px] text-gray-600 dark:text-gray-300;
  @apply hover:bg-gray-100 dark:hover:bg-gray-700;
  @apply transition-colors duration-150;
  cursor: pointer;
}

.mode-option i {
  @apply text-sm;
}

.mode-option.active {
  @apply bg-gray-100 font-medium text-gray-900 dark:bg-gray-700 dark:text-gray-100;
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
