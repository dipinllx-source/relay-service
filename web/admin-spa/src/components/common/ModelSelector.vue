<template>
  <div class="flex items-center gap-2">
    <!-- 下拉选择模式：与列表筛选器统一使用 CustomDropdown -->
    <div
      v-if="!customMode"
      class="min-w-0 flex-1"
      :class="disabled && 'pointer-events-none opacity-60'"
    >
      <CustomDropdown
        icon="fa-cube"
        icon-color="text-blue-500"
        :model-value="modelValue"
        :options="dropdownOptions"
        placeholder="选择模型"
        @update:model-value="handleSelect"
      />
    </div>

    <!-- 自定义输入模式 -->
    <template v-else>
      <input
        class="h-8 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-700 placeholder-gray-400 shadow-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-500"
        :disabled="disabled"
        :placeholder="placeholder"
        type="text"
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
      />
      <button
        class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm transition hover:shadow-md dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400"
        :disabled="disabled"
        title="返回列表"
        type="button"
        @click="exitCustomMode"
      >
        <i class="fas fa-list text-xs" />
      </button>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import CustomDropdown from '@/components/common/CustomDropdown.vue'

const CUSTOM_VALUE = '__custom__'

const props = defineProps({
  modelValue: { type: String, default: '' },
  models: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '输入模型 ID...' }
})

const emit = defineEmits(['update:modelValue'])

const customMode = ref(false)

const dropdownOptions = computed(() => [
  ...props.models.map((m) => ({ value: m.value, label: m.label, icon: m.icon })),
  { value: CUSTOM_VALUE, label: '自定义模型...', icon: 'fa-pen' }
])

const handleSelect = (value) => {
  if (value === CUSTOM_VALUE) {
    customMode.value = true
    emit('update:modelValue', '')
  } else {
    emit('update:modelValue', value)
  }
}

const exitCustomMode = () => {
  customMode.value = false
  // 切回列表时选中第一个预设模型
  if (props.models.length > 0) {
    emit('update:modelValue', props.models[0].value)
  }
}
</script>
