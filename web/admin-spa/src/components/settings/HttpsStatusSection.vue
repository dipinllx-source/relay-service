<template>
  <div>
    <!-- 加载态 -->
    <div v-if="loading" class="py-12 text-center">
      <i class="fas fa-spinner fa-spin mb-4 text-2xl text-blue-500" />
      <p class="text-gray-500 dark:text-gray-400">正在加载 HTTPS 状态...</p>
    </div>

    <!-- HTTPS 未启用 -->
    <div
      v-else-if="!status || status.enabled === false"
      class="rounded-xl border border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100 p-6 dark:border-gray-700 dark:from-gray-800/40 dark:to-gray-900/40"
    >
      <div class="flex items-start gap-4">
        <div
          class="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-300/30 text-gray-500 dark:bg-gray-700/40 dark:text-gray-300"
        >
          <i class="fas fa-lock-open text-xl" />
        </div>
        <div class="space-y-2">
          <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100">HTTPS 未启用</h4>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            当前服务以 HTTP 监听。要启用 HTTPS：在
            <code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700">.env</code>
            中设置
            <code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700"
              >HTTPS_ENABLED=true</code
            >
            与
            <code class="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700"
              >HTTPS_SAN=IP:&lt;你的IP&gt;,DNS:localhost,IP:127.0.0.1</code
            >
            ，然后重启服务。
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-500">
            此页面为只读状态——启停仅能通过重启服务生效。
          </p>
        </div>
      </div>
    </div>

    <!-- HTTPS 已启用 -->
    <div v-else class="space-y-6">
      <!-- 状态概览卡 -->
      <div
        class="rounded-xl border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-900/40 dark:from-green-900/20 dark:to-emerald-900/20"
      >
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400"
            >
              <i class="fas fa-lock text-xl" />
            </div>
            <div>
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
                HTTPS 正在监听 <span class="font-bold">:{{ status.port }}</span>
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                最低 TLS 版本: {{ status.minTlsVersion }}
                <span v-if="status.hstsEnabled" class="ml-2">· HSTS: 已启用</span>
              </p>
            </div>
          </div>
          <button
            :class="[
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition',
              downloading
                ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                : 'bg-green-500 text-white hover:bg-green-600 hover:shadow-md'
            ]"
            :disabled="downloading"
            @click="handleDownloadCa"
          >
            <i :class="['fas', downloading ? 'fa-spinner fa-spin' : 'fa-download']" />
            {{ downloading ? '下载中...' : '下载 ca.crt' }}
          </button>
        </div>
      </div>

      <!-- 警告提示 -->
      <div
        v-if="status.warning"
        class="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/20"
      >
        <div class="flex items-start gap-3">
          <i class="fas fa-exclamation-triangle mt-0.5 text-amber-500" />
          <p class="text-sm text-amber-700 dark:text-amber-300">{{ status.warning }}</p>
        </div>
      </div>

      <!-- Server 证书详情 -->
      <div class="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div class="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
            <i class="fas fa-certificate mr-2 text-blue-500" />Server 证书
          </h4>
        </div>
        <dl class="divide-y divide-gray-100 dark:divide-gray-700">
          <DetailRow label="Subject" :value="status.certSubject" />
          <DetailRow label="Issuer" :value="status.certIssuer" />
          <DetailRow label="SAN">
            <ul class="space-y-1">
              <li
                v-for="item in status.certSan"
                :key="item"
                class="inline-block rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              >
                {{ item }}
              </li>
            </ul>
          </DetailRow>
          <DetailRow label="Serial Number" mono :value="status.certSerialNumber" />
          <DetailRow label="Not Before" :value="formatDate(status.certNotBefore)" />
          <DetailRow label="Not After" :value="formatDate(status.certNotAfter)" />
          <DetailRow label="剩余天数">
            <span :class="daysRemainingClass(status.certDaysRemaining, CERT_WARN_DAYS)">
              {{ status.certDaysRemaining }} 天
            </span>
          </DetailRow>
        </dl>
      </div>

      <!-- Root CA 详情 -->
      <div class="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div class="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h4 class="text-sm font-semibold text-gray-900 dark:text-gray-100">
            <i class="fas fa-shield-alt mr-2 text-purple-500" />Root CA
          </h4>
        </div>
        <dl class="divide-y divide-gray-100 dark:divide-gray-700">
          <DetailRow label="Subject" :value="status.caSubject" />
          <DetailRow label="Serial Number" mono :value="status.caSerialNumber" />
          <DetailRow label="Not Before" :value="formatDate(status.caNotBefore)" />
          <DetailRow label="Not After" :value="formatDate(status.caNotAfter)" />
          <DetailRow label="剩余天数">
            <span :class="daysRemainingClass(status.caDaysRemaining, CA_WARN_DAYS)">
              {{ status.caDaysRemaining }} 天
            </span>
          </DetailRow>
        </dl>
      </div>

      <!-- 客户端信任操作提示 -->
      <div
        class="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-900/20"
      >
        <h4 class="mb-2 text-sm font-semibold text-blue-800 dark:text-blue-200">
          <i class="fas fa-info-circle mr-1" />客户端信任配置
        </h4>
        <ul class="space-y-1 text-xs text-blue-700 dark:text-blue-300">
          <li><strong>macOS：</strong>双击 ca.crt → 钥匙串添加到"系统" → 信任"始终信任"</li>
          <li><strong>Windows：</strong>certmgr.msc → 受信任的根证书颁发机构 → 导入 ca.crt</li>
          <li>
            <strong>Linux：</strong
            ><code class="rounded bg-blue-100 px-1 dark:bg-blue-900/40"
              >sudo cp ca.crt /usr/local/share/ca-certificates/relay-ca.crt && sudo
              update-ca-certificates</code
            >
          </li>
          <li>
            <strong>Node.js 客户端：</strong
            ><code class="rounded bg-blue-100 px-1 dark:bg-blue-900/40"
              >NODE_EXTRA_CA_CERTS=/path/to/ca.crt</code
            >
          </li>
          <li>
            <strong>Python (requests/httpx)：</strong
            ><code class="rounded bg-blue-100 px-1 dark:bg-blue-900/40"
              >REQUESTS_CA_BUNDLE=/path/to/ca.crt</code
            >
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, h, onMounted } from 'vue'
import { getHttpsStatusApi, downloadCaCertApi } from '@/utils/http_apis'
import { showToast } from '@/utils/tools'

const CERT_WARN_DAYS = 30
const CA_WARN_DAYS = 90

const loading = ref(true)
const downloading = ref(false)
const status = ref(null)

const loadStatus = async () => {
  loading.value = true
  const res = await getHttpsStatusApi()
  loading.value = false
  if (res && res.success) {
    status.value = res.data
  } else {
    status.value = { enabled: false }
    showToast(res?.message || '加载 HTTPS 状态失败', 'error')
  }
}

const handleDownloadCa = async () => {
  downloading.value = true
  try {
    const blob = await downloadCaCertApi()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ca.crt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('ca.crt 下载已开始', 'success')
  } catch (err) {
    showToast(err?.message || '下载失败', 'error')
  } finally {
    downloading.value = false
  }
}

const formatDate = (iso) => {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

const daysRemainingClass = (days, warnThreshold) => {
  if (days == null) return 'text-gray-500'
  if (days < 0) return 'font-bold text-red-600 dark:text-red-400'
  if (days < warnThreshold) return 'font-semibold text-amber-600 dark:text-amber-400'
  return 'font-medium text-green-600 dark:text-green-400'
}

// 简单内联的 DetailRow 组件（避免新增文件）
const DetailRow = (props, { slots }) => {
  return h('div', { class: 'flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4' }, [
    h(
      'dt',
      { class: 'w-32 flex-shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400' },
      props.label
    ),
    h(
      'dd',
      {
        class: [
          'flex-1 text-sm text-gray-900 dark:text-gray-100',
          props.mono ? 'font-mono break-all' : ''
        ]
      },
      slots.default ? slots.default() : props.value || '-'
    )
  ])
}
DetailRow.props = { label: String, value: [String, Number, Date], mono: Boolean }

onMounted(() => {
  loadStatus()
})
</script>
