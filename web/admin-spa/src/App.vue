<template>
  <div id="app">
    <router-view />

    <!-- 全局组件 -->
    <ToastNotification ref="toastRef" />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import ToastNotification from '@/components/common/ToastNotification.vue'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const toastRef = ref()

onMounted(() => {
  // 初始化主题：应用根层是唯一的主题初始化点。
  // initTheme 内部已调用 watchSystemTheme，此处不可重复调用，
  // 否则会重复注册 matchMedia 监听且无从清理
  themeStore.initTheme()

  // 检查本地存储的认证状态
  authStore.checkAuth()

  // 加载OEM设置（包括网站图标）
  authStore.loadOemSettings()
})
</script>

<style scoped>
#app {
  min-height: 100vh;
}
</style>
