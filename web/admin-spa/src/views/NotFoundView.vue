<template>
  <div class="flex min-h-[60vh] items-center justify-center px-4">
    <div class="card w-full max-w-md p-8 text-center">
      <div
        class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-700"
      >
        <i class="fas fa-unlink text-xl text-gray-400 dark:text-gray-500" />
      </div>

      <h1 class="mb-2 text-xl font-bold text-gray-900 dark:text-gray-100">页面不存在</h1>
      <p class="mb-6 text-sm text-gray-600 dark:text-gray-400">
        {{ reasonText }}
      </p>

      <div class="flex flex-wrap items-center justify-center gap-2">
        <button
          class="btn-md bg-gradient-to-r from-blue-500 to-blue-600 font-medium text-white shadow-sm transition-all duration-200 hover:shadow-md"
          @click="goHome"
        >
          <i class="fas fa-arrow-left" />
          返回{{ isAdmin ? '看板' : '首页' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const isAdmin = computed(() => authStore.isAuthenticated)

// 守卫在拦截未启用特性的页面时会带上 reason，用于区分「地址不存在」与
// 「该功能未启用」两种落地原因，避免管理员误以为是系统故障
const reasonText = computed(() =>
  route.query.reason === 'feature-disabled'
    ? '该功能当前未启用，因此对应页面不可访问。'
    : '你访问的地址不存在或已被移除。'
)

const goHome = () => {
  router.replace(isAdmin.value ? '/dashboard' : '/')
}
</script>
