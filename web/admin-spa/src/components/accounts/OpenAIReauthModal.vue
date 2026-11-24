<template>
  <Teleport to="body">
    <div v-if="show" class="modal fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        class="fixed inset-0 bg-gray-900 bg-opacity-50 backdrop-blur-sm"
        @click="$emit('close')"
      />

      <div class="modal-content relative mx-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto p-8">
        <!-- 头部 -->
        <div class="mb-6 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600"
            >
              <i class="fas fa-key text-white" />
            </div>
            <div>
              <h3 class="text-xl font-bold text-gray-900 dark:text-gray-100">
                更新 Token / 重新授权
              </h3>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                {{ account.name || 'OpenAI 账户' }}
              </p>
            </div>
          </div>
          <button
            class="text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            @click="$emit('close')"
          >
            <i class="fas fa-times text-xl" />
          </button>
        </div>

        <!-- 步骤指示 -->
        <div class="mb-6 flex items-center gap-2 text-xs font-medium">
          <span
            v-for="s in stepLabels"
            :key="s.n"
            :class="[
              'rounded-full px-3 py-1',
              step === s.n
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                : step > s.n
                  ? 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  : 'bg-gray-50 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
            ]"
          >
            {{ s.n }}. {{ s.label }}
          </span>
        </div>

        <!-- 步骤 1：确认目标账号与代理 -->
        <div v-if="step === 1" class="space-y-5">
          <div
            class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-900/30"
          >
            <p class="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              <i class="fas fa-shield-alt mr-2" />本操作保留该账号的历史用量与统计
            </p>
            <p class="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
              只替换这张账号的 OAuth 凭据，<strong>不会新建账号、不会删除账号</strong>，账号 ID
              保持不变，因此用量、成本统计与 API Key 绑定关系全部保留。
            </p>
          </div>

          <div
            class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-700/50"
          >
            <p class="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">当前账号</p>
            <dl class="space-y-1 text-sm text-gray-800 dark:text-gray-200">
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">状态</dt>
                <dd>
                  <span
                    :class="
                      account.status === 'unauthorized'
                        ? 'font-semibold text-red-600 dark:text-red-400'
                        : ''
                    "
                    >{{ statusLabel }}</span
                  >
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">ChatGPT 主体</dt>
                <dd class="truncate font-mono text-xs">{{ account.accountId || '—' }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">登录用户</dt>
                <dd class="truncate font-mono text-xs">{{ account.chatgptUserId || '—' }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">累计用量</dt>
                <dd>{{ account.totalUsage ?? '—' }}</dd>
              </div>
            </dl>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              授权与 token 交换所用代理
            </label>
            <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
              默认沿用该账号现有代理。出口 IP /
              区域变化可能影响后续刷新与业务请求，如无必要请勿修改。
            </p>
            <textarea
              v-model="proxyText"
              class="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs text-gray-800 focus:border-emerald-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              placeholder="留空表示不使用代理；否则填写代理配置 JSON"
              rows="3"
            />
            <p v-if="proxyError" class="mt-1 text-xs text-red-600 dark:text-red-400">
              {{ proxyError }}
            </p>
          </div>

          <div class="flex justify-end gap-3">
            <button
              class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              @click="$emit('close')"
            >
              取消
            </button>
            <button
              class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
              @click="goOAuth"
            >
              开始授权<i class="fas fa-arrow-right ml-2" />
            </button>
          </div>
        </div>

        <!-- 步骤 2：复用既有 OAuthFlow（会话过期可在其内部「重新生成」，不丢账号上下文） -->
        <div v-else-if="step === 2">
          <OAuthFlow
            platform="openai"
            :proxy="effectiveProxy"
            @back="step = 1"
            @success="onOAuthSuccess"
          />
        </div>

        <!-- 步骤 3：身份守卫与提交 -->
        <div v-else-if="step === 3" class="space-y-5">
          <div
            v-if="identityDiff.level === 'same'"
            class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
          >
            <i class="fas fa-check-circle mr-2" />新授权主体与本账号一致，可直接提交。
          </div>

          <div
            v-else
            :class="[
              'rounded-lg border p-4',
              identityDiff.level === 'subject'
                ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/30'
                : 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30'
            ]"
          >
            <p
              :class="[
                'text-sm font-semibold',
                identityDiff.level === 'subject'
                  ? 'text-red-900 dark:text-red-200'
                  : 'text-amber-900 dark:text-amber-200'
              ]"
            >
              <i class="fas fa-exclamation-triangle mr-2" />{{ identityDiff.title }}
            </p>
            <p
              :class="[
                'mt-1 text-xs',
                identityDiff.level === 'subject'
                  ? 'text-red-800 dark:text-red-300'
                  : 'text-amber-800 dark:text-amber-300'
              ]"
            >
              {{ identityDiff.hint }}
            </p>

            <table class="mt-3 w-full text-xs">
              <thead>
                <tr class="text-gray-500 dark:text-gray-400">
                  <th class="py-1 text-left font-medium">字段</th>
                  <th class="py-1 text-left font-medium">本账号现值</th>
                  <th class="py-1 text-left font-medium">新授权</th>
                </tr>
              </thead>
              <tbody class="font-mono text-gray-800 dark:text-gray-200">
                <tr v-for="row in identityDiff.rows" :key="row.key">
                  <td class="py-1 pr-2 font-sans text-gray-500 dark:text-gray-400">
                    {{ row.label }}
                  </td>
                  <td class="break-all py-1 pr-2">{{ row.before || '—' }}</td>
                  <td :class="['break-all py-1', row.changed ? 'font-semibold' : '']">
                    {{ row.after || '—' }}
                  </td>
                </tr>
              </tbody>
            </table>

            <label class="mt-3 flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
              <input v-model="confirmed" class="mt-0.5" type="checkbox" />
              <span>{{ identityDiff.confirmText }}</span>
            </label>
          </div>

          <div
            class="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-700/50 dark:text-gray-400"
          >
            提交后后端会<strong>先校验新凭据、校验通过才写入</strong>；校验失败时账号凭据保持原样。校验可能轮换
            Refresh Token，因此保存的是校验返回的新凭据。
          </div>

          <div
            v-if="submitError"
            class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-700 dark:bg-red-900/30"
          >
            <p class="font-semibold text-red-900 dark:text-red-200">{{ submitErrorTitle }}</p>
            <p class="mt-1 text-xs text-red-800 dark:text-red-300">{{ submitError }}</p>
            <p v-if="submitSuggestion" class="mt-1 text-xs text-red-700 dark:text-red-400">
              {{ submitSuggestion }}
            </p>
          </div>

          <div class="flex justify-end gap-3">
            <button
              class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              @click="step = 2"
            >
              返回授权
            </button>
            <button
              :class="[
                'rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors',
                canSubmit
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'cursor-not-allowed bg-gray-300 dark:bg-gray-600'
              ]"
              :disabled="!canSubmit"
              @click="submit"
            >
              <i v-if="submitting" class="fas fa-spinner fa-spin mr-2" />
              {{ submitting ? '校验并保存中…' : '校验并保存' }}
            </button>
          </div>
        </div>

        <!-- 步骤 4：完成 -->
        <div v-else class="space-y-5">
          <div
            class="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-700 dark:bg-emerald-900/30"
          >
            <i class="fas fa-check-circle text-3xl text-emerald-600 dark:text-emerald-400" />
            <p class="mt-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              重新授权成功，账号已恢复可调度
            </p>
            <p class="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
              账号 ID 未变，历史用量与统计已保留。
            </p>
          </div>

          <dl class="space-y-1 text-sm text-gray-800 dark:text-gray-200">
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">新凭据（掩码）</dt>
              <dd class="font-mono text-xs">…{{ result.refreshTail }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">过期时间</dt>
              <dd class="text-xs">{{ result.expiresAt || '—' }}</dd>
            </div>
          </dl>

          <div class="flex justify-end">
            <button
              class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
              @click="$emit('close')"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import OAuthFlow from './OAuthFlow.vue'
import { useAccountsStore } from '@/stores/accounts'

const props = defineProps({
  show: { type: Boolean, required: true },
  account: { type: Object, required: true }
})

const emit = defineEmits(['close', 'success'])

const accountsStore = useAccountsStore()

const stepLabels = [
  { n: 1, label: '确认账号' },
  { n: 2, label: 'OAuth 授权' },
  { n: 3, label: '校验提交' },
  { n: 4, label: '完成' }
]

const step = ref(1)
const proxyText = ref('')
const proxyError = ref('')
const tokenInfo = ref(null)
const confirmed = ref(false)
const submitting = ref(false)
const submitError = ref('')
const submitSuggestion = ref('')
const errorKind = ref('')
const result = ref({ refreshTail: '', expiresAt: '' })

// 每次打开重置全部状态，确认勾选 MUST NOT 跨账号复用
watch(
  () => props.show,
  (v) => {
    if (!v) return
    step.value = 1
    proxyError.value = ''
    tokenInfo.value = null
    confirmed.value = false
    submitting.value = false
    submitError.value = ''
    submitSuggestion.value = ''
    errorKind.value = ''
    result.value = { refreshTail: '', expiresAt: '' }
    proxyText.value = props.account?.proxy ? JSON.stringify(props.account.proxy, null, 2) : ''
  },
  { immediate: true }
)

const statusLabel = computed(() => {
  const s = props.account?.status
  if (s === 'unauthorized') return '授权失效（unauthorized）'
  if (s === 'blocked') return '已封锁'
  if (s === 'temp_error') return '临时异常'
  if (s === 'active') return '正常'
  return s || '—'
})

const effectiveProxy = computed(() => {
  const raw = proxyText.value.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
})

function goOAuth() {
  const raw = proxyText.value.trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
    } catch {
      proxyError.value = '代理配置不是合法 JSON，请修正或留空'
      return
    }
  }
  proxyError.value = ''
  step.value = 2
}

function onOAuthSuccess(info) {
  tokenInfo.value = info
  confirmed.value = false
  submitError.value = ''
  submitSuggestion.value = ''
  errorKind.value = ''
  step.value = 3
}

// 身份一致性守卫：三级（一致 / 工作区变化 / 登录主体变化）
const identityDiff = computed(() => {
  const info = tokenInfo.value?.accountInfo || {}
  const cur = props.account || {}
  const cmp = (a, b) => !a || !b || a === b
  const rows = [
    {
      key: 'accountId',
      label: 'ChatGPT 主体',
      before: cur.accountId,
      after: info.accountId,
      changed: !cmp(info.accountId, cur.accountId)
    },
    {
      key: 'chatgptUserId',
      label: '登录用户',
      before: cur.chatgptUserId,
      after: info.chatgptUserId,
      changed: !cmp(info.chatgptUserId, cur.chatgptUserId)
    },
    {
      key: 'email',
      label: '邮箱',
      before: cur.email,
      after: info.email,
      changed: !cmp(info.email, cur.email)
    }
  ]
  const sameUser = cmp(info.chatgptUserId, cur.chatgptUserId) && cmp(info.email, cur.email)
  const sameAccount = cmp(info.accountId, cur.accountId)

  if (sameUser && sameAccount) {
    return { level: 'same', rows }
  }
  if (sameUser) {
    return {
      level: 'workspace',
      rows,
      title: '检测到工作区 / 组织变化',
      hint: '登录主体相同，但 ChatGPT 主体 ID 不同。继续将把新工作区的凭据用于本账号。',
      confirmText: '我已核对上述差异，确认把新工作区凭据用于本账号'
    }
  }
  return {
    level: 'subject',
    rows,
    title: '这是另一个登录主体',
    hint: '新授权的登录用户或邮箱与本账号不同。若确为不同账号，请改为「新建账号」，否则本账号的历史用量与成本会归属到错误的主体。',
    confirmText: '我理解历史数据将归属到新主体，仍要继续'
  }
})

const needsConfirm = computed(() => identityDiff.value.level !== 'same')
const canSubmit = computed(
  () => !!tokenInfo.value && !submitting.value && (!needsConfirm.value || confirmed.value)
)

const submitErrorTitle = computed(() => {
  if (errorKind.value === 'write') return '凭据校验已通过，但保存失败'
  if (errorKind.value === 'validation') return '校验失败，账号凭据未改动'
  return '更新失败'
})

function tail(v) {
  const s = String(v || '')
  return s.length >= 4 ? s.slice(-4) : '****'
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = ''
  submitSuggestion.value = ''
  errorKind.value = ''
  try {
    const t = tokenInfo.value?.tokens || {}
    const payload = {
      openaiOauth: {
        accessToken: t.accessToken || '',
        refreshToken: t.refreshToken || '',
        expires_in: t.expires_in
      },
      // 触发后端「先校验后写入」分支
      needsImmediateRefresh: true,
      requireRefreshSuccess: true
    }
    if (tokenInfo.value?.accountInfo) payload.accountInfo = tokenInfo.value.accountInfo
    if (effectiveProxy.value) payload.proxy = effectiveProxy.value

    const res = await accountsStore.updateOpenAIAccount(props.account.id, payload)
    if (res && res.success === false) {
      throw Object.assign(new Error(res.message || '更新失败'), { response: { data: res } })
    }
    const updated = res?.data || {}
    result.value = {
      refreshTail: tail(t.refreshToken),
      expiresAt: updated.expiresAt || ''
    }
    step.value = 4
    emit('success', updated)
  } catch (e) {
    const data = e?.response?.data || {}
    if (data.credentialRotated) errorKind.value = 'write'
    else if (data.accountUnchanged) errorKind.value = 'validation'
    else errorKind.value = 'unknown'
    submitError.value = data.message || data.error || e?.message || '更新失败'
    submitSuggestion.value = data.suggestion || ''
  } finally {
    submitting.value = false
  }
}
</script>
