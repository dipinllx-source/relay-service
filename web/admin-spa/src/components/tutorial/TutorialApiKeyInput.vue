<template>
  <div
    class="mb-4 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-blue-50 p-4 dark:border-indigo-500/40 dark:from-indigo-950/30 dark:to-blue-950/30 sm:p-6"
  >
    <div v-if="$slots.default" class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:text-base">
      <slot />
    </div>
    <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
      你的 API Key（可选，仅用于在本页生成脚本，不会上传）
    </label>
    <input
      v-model.trim="apiKey"
      autocomplete="off"
      class="form-input-md mb-2 w-full"
      placeholder="cr_xxxxxxxxxxxxxxxxxx"
      spellcheck="false"
      type="password"
    />
    <p class="text-xs text-gray-600 dark:text-gray-400">
      💡 不填写时脚本中显示为「{{ placeholder }}」，执行前请替换为在 "API Keys"
      中创建的实际密钥。所有教程共用这一个输入框，切换教程无需重新填写。
    </p>
    <slot name="extra" />
  </div>
</template>

<script setup>
import { tutorialApiKey } from '@/utils/useTutorialShared'

defineProps({
  placeholder: { type: String, default: 'YOUR_API_KEY' }
})

const apiKey = tutorialApiKey
</script>
