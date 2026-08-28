<template>
  <Teleport to="body">
    <div v-if="show" class="modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="modal-content mx-auto w-full max-w-sm p-6">
        <div class="mb-5 text-center">
          <div
            :class="[
              'mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full',
              type === 'danger'
                ? 'bg-red-50 dark:bg-red-900/20'
                : type === 'warning'
                  ? 'bg-yellow-50 dark:bg-yellow-900/20'
                  : 'bg-blue-50 dark:bg-blue-900/20'
            ]"
          >
            <i
              :class="[
                'text-lg',
                type === 'danger'
                  ? 'fas fa-trash-alt text-red-500'
                  : type === 'warning'
                    ? 'fas fa-exclamation-triangle text-yellow-500'
                    : 'fas fa-question-circle text-blue-500'
              ]"
            />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
            {{ title }}
          </h3>
          <p class="whitespace-pre-line text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {{ message }}
          </p>
        </div>

        <div class="flex gap-3">
          <button class="confirm-btn confirm-btn--ghost flex-1" @click="$emit('cancel')">
            {{ cancelText }}
          </button>
          <button
            :class="[
              'confirm-btn flex-1',
              type === 'danger'
                ? 'confirm-btn--danger'
                : type === 'warning'
                  ? 'confirm-btn--warning'
                  : 'confirm-btn--primary'
            ]"
            @click="$emit('confirm')"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
defineProps({
  show: {
    type: Boolean,
    required: true
  },
  title: {
    type: String,
    default: ''
  },
  message: {
    type: String,
    default: ''
  },
  confirmText: {
    type: String,
    default: '继续'
  },
  cancelText: {
    type: String,
    default: '取消'
  },
  type: {
    type: String,
    default: 'primary',
    validator: (value) => ['primary', 'warning', 'danger'].includes(value)
  }
})

defineEmits(['confirm', 'cancel'])
</script>

<style scoped>
.confirm-btn {
  padding: 10px 16px;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.2s ease,
    transform 0.1s ease;
}
.confirm-btn:active {
  transform: scale(0.97);
}
.confirm-btn--ghost {
  background: rgba(0, 0, 0, 0.05);
  color: #1d1d1f;
}
.dark .confirm-btn--ghost {
  background: rgba(255, 255, 255, 0.1);
  color: #f5f5f7;
}
.confirm-btn--ghost:hover {
  background: rgba(0, 0, 0, 0.08);
}
.confirm-btn--primary {
  background: #0071e3;
  color: #fff;
}
.confirm-btn--primary:hover {
  background: #0077ed;
}
.confirm-btn--danger {
  background: #ff3b30;
  color: #fff;
}
.confirm-btn--danger:hover {
  background: #e0342b;
}
.confirm-btn--warning {
  background: #ff9500;
  color: #fff;
}
.confirm-btn--warning:hover {
  background: #e68600;
}
</style>
