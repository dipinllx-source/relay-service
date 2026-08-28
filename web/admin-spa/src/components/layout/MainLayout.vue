<template>
  <div class="admin-shell">
    <!-- Apple-style sticky nav -->
    <nav class="admin-nav" :class="{ 'admin-nav--scrolled': scrolled }">
      <div class="admin-nav__inner">
        <router-link class="admin-nav__brand" to="/">
          <img
            alt="Logo"
            class="admin-nav__logo"
            :src="oemSettings.siteIconData || oemSettings.siteIcon || faviconUrl"
          />
          <span>{{ oemSettings.siteName || 'Relay' }}</span>
        </router-link>

        <!-- Nav links (flat, 管理 expanded) -->
        <div class="admin-nav__links">
          <router-link class="admin-nav__link" to="/"> 首页 </router-link>
          <button
            class="admin-nav__link"
            :class="{ 'admin-nav__link--active': activeTab === 'dashboard' }"
            @click="handleTabChange('dashboard')"
          >
            看板
          </button>
          <template v-for="tab in manageTabs" :key="tab.key">
            <!-- API Keys with Apple-style full-width dropdown -->
            <a
              v-if="tab.key === 'apiKeys'"
              class="admin-nav__link admin-nav__dropdown-trigger"
              :class="{ 'admin-nav__link--active': activeTab === 'apiKeys' }"
              href="#"
              @click.prevent="toggleDropdown('apiKeys')"
              @mouseenter="openDropdown('apiKeys')"
            >
              API Keys
              <svg
                aria-hidden="true"
                class="admin-nav__caret"
                :class="{ 'admin-nav__caret--open': activeDropdown === 'apiKeys' }"
                viewBox="0 0 10 6"
              >
                <path
                  d="M1 1l4 4 4-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.4"
                />
              </svg>
            </a>
            <button
              v-else
              class="admin-nav__link"
              :class="{ 'admin-nav__link--active': activeTab === tab.key }"
              @click="handleTabChange(tab.key)"
            >
              {{ tab.name }}
            </button>
          </template>
          <a
            class="admin-nav__link admin-nav__dropdown-trigger"
            :class="{ 'admin-nav__link--active': activeTab === 'settings' }"
            href="#"
            @click.prevent="toggleDropdown('settings')"
            @mouseenter="openDropdown('settings')"
          >
            设置
            <svg
              aria-hidden="true"
              class="admin-nav__caret"
              :class="{ 'admin-nav__caret--open': activeDropdown === 'settings' }"
              viewBox="0 0 10 6"
            >
              <path
                d="M1 1l4 4 4-4"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.4"
              />
            </svg>
          </a>
        </div>

        <div class="admin-nav__right">
          <ThemeToggle mode="dropdown" />
          <button class="admin-nav__user-btn" @click="toggleDropdown('user')">
            <i class="fas fa-user-circle" />
            <span class="admin-nav__user-name">{{ currentUser.username || 'Admin' }}</span>
            <svg
              aria-hidden="true"
              class="admin-nav__caret"
              :class="{ 'admin-nav__caret--open': activeDropdown === 'user' }"
              viewBox="0 0 10 6"
            >
              <path
                d="M1 1l4 4 4-4"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.4"
              />
            </svg>
          </button>
        </div>
      </div>
    </nav>

    <!-- API Keys dropdown panel (Apple-style full-width) -->
    <div
      class="admin-dropdown"
      :class="{ 'admin-dropdown--open': activeDropdown === 'apiKeys' }"
      @mouseleave="closeDropdown"
    >
      <div class="admin-dropdown__inner">
        <div class="admin-dropdown__section">
          <div class="admin-dropdown__label">API Keys</div>
          <router-link class="admin-dropdown__link" to="/api-keys" @click="closeDropdown">
            <i class="fas fa-key" />
            <span>活跃 API Keys</span>
          </router-link>
          <router-link class="admin-dropdown__link" to="/api-keys/deleted" @click="closeDropdown">
            <i class="fas fa-trash-alt" />
            <span>已删除 API Keys</span>
          </router-link>
        </div>
      </div>
    </div>

    <!-- Settings dropdown panel (Apple-style full-width) -->
    <div
      class="admin-dropdown"
      :class="{ 'admin-dropdown--open': activeDropdown === 'settings' }"
      @mouseleave="closeDropdown"
    >
      <div class="admin-dropdown__inner">
        <div class="admin-dropdown__section">
          <div class="admin-dropdown__label">系统设置</div>
          <router-link class="admin-dropdown__link" to="/settings" @click="closeDropdown">
            <i class="fas fa-palette" />
            <span>品牌设置</span>
          </router-link>
          <router-link class="admin-dropdown__link" to="/settings/webhook" @click="closeDropdown">
            <i class="fas fa-bell" />
            <span>通知设置</span>
          </router-link>
          <router-link class="admin-dropdown__link" to="/settings/claude" @click="closeDropdown">
            <i class="fas fa-robot" />
            <span>Claude 转发</span>
          </router-link>
          <router-link
            class="admin-dropdown__link"
            to="/settings/service-rates"
            @click="closeDropdown"
          >
            <i class="fas fa-balance-scale" />
            <span>服务倍率</span>
          </router-link>
          <router-link
            class="admin-dropdown__link"
            to="/settings/model-pricing"
            @click="closeDropdown"
          >
            <i class="fas fa-coins" />
            <span>模型价格</span>
          </router-link>
          <router-link class="admin-dropdown__link" to="/settings/https" @click="closeDropdown">
            <i class="fas fa-lock" />
            <span>HTTPS 状态</span>
          </router-link>
          <router-link class="admin-dropdown__link" to="/settings/storage" @click="closeDropdown">
            <i class="fas fa-database" />
            <span>存储健康</span>
          </router-link>
        </div>
      </div>
    </div>

    <!-- User dropdown panel -->
    <div
      class="admin-dropdown admin-dropdown--narrow"
      :class="{ 'admin-dropdown--open': activeDropdown === 'user' }"
      @mouseleave="closeDropdown"
    >
      <div class="admin-dropdown__inner admin-dropdown__inner--right">
        <div class="admin-dropdown__section">
          <div class="admin-dropdown__user-head">
            <span class="admin-dropdown__user-name">{{ currentUser.username || 'Admin' }}</span>
            <span class="admin-dropdown__user-ver"
              >v{{ versionInfo.current || '...'
              }}<span
                v-if="versionInfo.hasUpdate"
                class="admin-dropdown__user-ver-dot"
                title="有新版本"
              ></span
            ></span>
          </div>
          <button class="admin-dropdown__link" @click="doAndClose(openChangePasswordModal)">
            <i class="fas fa-key" />
            <span>修改账户信息</span>
          </button>
          <button class="admin-dropdown__link" @click="doAndClose(openUpgradeModal)">
            <i class="fas fa-cloud-download-alt" />
            <span>{{ versionInfo.checkingUpdate ? '检查中…' : '检查更新' }}</span>
            <span v-if="versionInfo.hasUpdate" class="admin-dropdown__badge">新</span>
          </button>
          <div class="admin-dropdown__divider"></div>
          <button
            class="admin-dropdown__link admin-dropdown__link--danger"
            @click="doAndClose(logout)"
          >
            <i class="fas fa-sign-out-alt" />
            <span>退出登录</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Backdrop -->
    <div
      class="admin-backdrop"
      :class="{ 'admin-backdrop--open': !!activeDropdown }"
      @click="closeDropdown"
    ></div>

    <!-- Content area -->
    <main class="admin-content">
      <router-view />
    </main>

    <!-- Change password modal -->
    <div
      v-if="showChangePasswordModal"
      class="admin-modal-overlay"
      @click.self="closeChangePasswordModal"
    >
      <div class="admin-modal">
        <div class="admin-modal__header">
          <h3>修改账户信息</h3>
          <button class="admin-modal__close" @click="closeChangePasswordModal">
            <i class="fas fa-times" />
          </button>
        </div>
        <form class="admin-modal__body" @submit.prevent="changePassword">
          <div class="admin-field">
            <label>当前用户名</label>
            <input disabled type="text" :value="currentUser.username || 'Admin'" />
          </div>
          <div class="admin-field">
            <label>新用户名</label>
            <input
              v-model="changePasswordForm.newUsername"
              placeholder="留空保持不变"
              type="text"
            />
          </div>
          <div class="admin-field">
            <label>当前密码</label>
            <input
              v-model="changePasswordForm.currentPassword"
              placeholder="请输入当前密码"
              required
              type="password"
            />
          </div>
          <div class="admin-field">
            <label>新密码</label>
            <input
              v-model="changePasswordForm.newPassword"
              placeholder="请输入新密码（至少8位）"
              required
              type="password"
            />
          </div>
          <div class="admin-field">
            <label>确认新密码</label>
            <input
              v-model="changePasswordForm.confirmPassword"
              placeholder="请再次输入新密码"
              required
              type="password"
            />
          </div>
          <div class="admin-modal__actions">
            <button
              class="admin-btn admin-btn--ghost"
              type="button"
              @click="closeChangePasswordModal"
            >
              取消
            </button>
            <button
              class="admin-btn admin-btn--primary"
              :disabled="changePasswordLoading"
              type="submit"
            >
              {{ changePasswordLoading ? '保存中...' : '保存修改' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ⬆️ 升级弹窗（L3：版本对比 + 变更清单 + 影响面 + 步骤计划）-->
    <div v-if="upgradeModal.open" class="admin-modal-overlay" @click.self="closeUpgradeModal">
      <div class="admin-modal upgrade-modal">
        <div class="admin-modal__header">
          <span>系统更新</span>
          <button class="admin-modal__close" @click="closeUpgradeModal">
            <i class="fas fa-times" />
          </button>
        </div>
        <div class="admin-modal__body">
          <!-- 版本对比 -->
          <div class="upgrade-ver">
            <span class="upgrade-ver__cur">当前 v{{ versionInfo.current }}</span>
            <i v-if="versionInfo.hasUpdate" class="fas fa-arrow-right upgrade-ver__arrow" />
            <span v-if="versionInfo.hasUpdate" class="upgrade-ver__new"
              >v{{ versionInfo.latest }}</span
            >
            <span v-else class="upgrade-ver__latest"
              ><i class="fas fa-check-circle" /> 已是最新版本</span
            >
          </div>

          <div v-if="versionInfo.error" class="upgrade-note upgrade-note--warn">
            <i class="fas fa-exclamation-triangle" /> {{ versionInfo.error }}
          </div>

          <template v-if="versionInfo.hasUpdate && upgradeModal.phase === 'idle'">
            <!-- 变更清单 -->
            <div v-if="flattenedChangelog.length" class="upgrade-block">
              <div class="upgrade-block__title">本次变更</div>
              <ul class="upgrade-changelog">
                <li v-for="(c, i) in flattenedChangelog" :key="i">
                  <span class="upgrade-tag" :class="'upgrade-tag--' + c.type">{{
                    c.typeLabel
                  }}</span>
                  {{ c.subject }}
                </li>
              </ul>
            </div>

            <!-- 影响面 -->
            <div v-if="versionInfo.impact" class="upgrade-impact">
              影响面：{{ versionInfo.impact.fileCount }} 个文件 · +{{
                versionInfo.impact.insertions
              }}
              / -{{ versionInfo.impact.deletions }}
            </div>

            <!-- 步骤计划 -->
            <div v-if="versionInfo.plannedSteps" class="upgrade-block">
              <div class="upgrade-block__title">升级将执行</div>
              <ul class="upgrade-steps">
                <li
                  v-for="st in versionInfo.plannedSteps"
                  :key="st.name"
                  :class="{ 'is-skip': !st.needed }"
                >
                  <i class="fas" :class="st.needed ? 'fa-check-square' : 'fa-square'" />
                  {{ st.label }}
                  <span class="upgrade-steps__reason">{{ st.reason }}</span>
                  <span v-if="st.needed && st.warning" class="upgrade-steps__warn"
                    ><i class="fas fa-exclamation-triangle" /> {{ st.warning }}</span
                  >
                </li>
              </ul>
            </div>
          </template>

          <!-- 升级进行中 / 完成 / 失败 -->
          <div
            v-if="upgradeModal.phase !== 'idle'"
            class="upgrade-progress"
            :class="'upgrade-progress--' + upgradeModal.phase"
          >
            <i
              class="fas"
              :class="{
                'fa-spinner fa-spin':
                  upgradeModal.phase === 'upgrading' || upgradeModal.phase === 'polling',
                'fa-check-circle': upgradeModal.phase === 'done',
                'fa-times-circle': upgradeModal.phase === 'failed'
              }"
            />
            <span>{{ upgradeModal.message }}</span>
          </div>

          <!-- 预检判定明细（噪音自愈 / 阻断都展示）-->
          <ul v-if="preflightFindings.length" class="upgrade-findings">
            <li
              v-for="f in preflightFindings"
              :key="f.path"
              :class="'is-' + (f.verdict || 'blocking')"
            >
              <i
                class="fas"
                :class="{
                  'fa-recycle': f.verdict === 'noise',
                  'fa-exclamation-triangle': f.verdict !== 'noise'
                }"
              />
              <code class="upgrade-findings__path">{{ f.path }}</code>
              <span class="upgrade-findings__verdict">{{
                f.verdict === 'noise' ? '可自愈噪音' : '需人介入'
              }}</span>
              <span class="upgrade-findings__reason">{{ f.reason }}</span>
              <span
                v-if="f.verdict === 'noise' && (f.stashRef || preflightStashRef)"
                class="upgrade-findings__stash"
                >已 stash {{ (f.stashRef || preflightStashRef).slice(0, 12) }}</span
              >
            </li>
          </ul>

          <!-- 执行步骤明细（进行中/结束后展示）-->
          <ul
            v-if="
              upgradeModal.lastRun &&
              upgradeModal.lastRun.steps &&
              upgradeModal.lastRun.steps.length
            "
            class="upgrade-runsteps"
          >
            <li v-for="st in upgradeModal.lastRun.steps" :key="st.name" :class="'is-' + st.status">
              <i
                class="fas"
                :class="{
                  'fa-check': st.status === 'success',
                  'fa-minus': st.status === 'skipped',
                  'fa-times': st.status === 'failed',
                  'fa-undo': st.status === 'reverted',
                  'fa-clock': st.status === 'pending_restart'
                }"
              />
              {{ st.label || st.name }}
              <span class="upgrade-runsteps__status">{{ st.status }}</span>
              <code v-if="st.status === 'failed' && st.tailLog" class="upgrade-runsteps__tail">{{
                st.tailLog.slice(-400)
              }}</code>
            </li>
          </ul>

          <div class="admin-modal__actions">
            <button class="admin-btn admin-btn--ghost" type="button" @click="closeUpgradeModal">
              关闭
            </button>
            <button
              v-if="
                versionInfo.hasUpdate &&
                (upgradeModal.phase === 'idle' || upgradeModal.phase === 'failed')
              "
              class="admin-btn admin-btn--primary"
              type="button"
              @click="confirmUpgrade"
            >
              {{ upgradeModal.phase === 'failed' ? '重试升级' : '立即升级' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :cancel-text="confirmModalConfig.cancelText"
      :confirm-text="confirmModalConfig.confirmText"
      :message="confirmModalConfig.message"
      :show="showConfirmModal"
      :title="confirmModalConfig.title"
      :type="confirmModalConfig.type"
      @cancel="handleCancelModal"
      @confirm="handleConfirmModal"
    />
  </div>
</template>

<script setup>
import { ref, reactive, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { showToast } from '@/utils/tools'
import {
  checkUpdatesApi,
  changePasswordApi,
  triggerUpgradeApi,
  getUpgradeStatusApi
} from '@/utils/http_apis'
import ThemeToggle from '@/components/common/ThemeToggle.vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const scrolled = ref(false)
const activeDropdown = ref(null)
const faviconUrl = `${import.meta.env.BASE_URL}favicon.svg`
const openDropdown = (name) => {
  activeDropdown.value = name
}
const toggleDropdown = (name) => {
  activeDropdown.value = activeDropdown.value === name ? null : name
}
const closeDropdown = () => {
  activeDropdown.value = null
}
const doAndClose = (fn) => {
  fn()
  closeDropdown()
}

// Current user & OEM
const currentUser = computed(() => authStore.user || { username: 'Admin' })
const oemSettings = computed(() => authStore.oemSettings || {})

// Tabs
const tabs = computed(() => {
  const baseTabs = [
    { key: 'dashboard', name: '看板', shortName: '看板', icon: 'fas fa-tachometer-alt' },
    { key: 'apiKeys', name: 'API Keys', shortName: 'API', icon: 'fas fa-key' },
    { key: 'accounts', name: '账户管理', shortName: '账户', icon: 'fas fa-user-circle' },
    { key: 'requestDetails', name: '请求明细', shortName: '明细', icon: 'fas fa-table' }
  ]
  if (authStore.oemSettings?.ldapEnabled) {
    baseTabs.push({
      key: 'userManagement',
      name: '用户管理',
      shortName: '用户',
      icon: 'fas fa-users'
    })
  }
  baseTabs.push({ key: 'settings', name: '系统设置', shortName: '设置', icon: 'fas fa-cogs' })
  return baseTabs
})

const manageTabs = computed(() => {
  return tabs.value.filter((t) => t.key !== 'dashboard' && t.key !== 'settings')
})

// Active tab from route
const activeTab = ref('dashboard')
const tabRouteMap = computed(() => {
  const m = {
    dashboard: '/dashboard',
    apiKeys: '/api-keys',
    accounts: '/accounts',
    requestDetails: '/request-details',

    settings: '/settings'
  }
  if (authStore.oemSettings?.ldapEnabled) m.userManagement = '/user-management'
  return m
})

const initActiveTab = () => {
  const p = route.path
  // 优先精确匹配；否则按前缀匹配子路径（如 /api-keys/deleted → apiKeys）
  let k = Object.keys(tabRouteMap.value).find((key) => tabRouteMap.value[key] === p)
  if (!k) {
    k = Object.keys(tabRouteMap.value).find(
      (key) => p === tabRouteMap.value[key] || p.startsWith(tabRouteMap.value[key] + '/')
    )
  }
  // 无匹配项时必须清空：否则停留在没有导航项的页面时，
  // 会继续高亮上一次的导航项（或初始默认值 dashboard）
  activeTab.value = k || ''
}
initActiveTab()

watch(
  // tabRouteMap 需一并监听：用户体系开关来自异步取数，映射表在取数返回后才
  // 补上用户管理项，而此时 route.path 并未变化，仅监听路径会漏掉这次重算
  [() => route.path, () => tabRouteMap.value],
  () => initActiveTab()
)

const handleTabChange = async (tabKey) => {
  // 映射表随特性开关变化，键可能不存在；否则会 push(undefined) 抛错
  const target = tabRouteMap.value[tabKey]
  if (!target || target === route.path) return
  activeTab.value = tabKey
  try {
    await router.push(target)
    await nextTick()
  } catch (err) {
    if (err.name !== 'NavigationDuplicated') initActiveTab()
  }
}

// Override emit to handle routing
defineExpose({ handleTabChange })

// Version
const versionInfo = ref({
  current: '...',
  latest: '',
  hasUpdate: false,
  checkingUpdate: false,
  releaseInfo: null,
  changelog: null,
  impact: null,
  plannedSteps: null,
  latestTag: null,
  error: null
})

// ⬆️ 升级 UI 状态
const upgradeModal = ref({
  open: false,
  phase: 'idle', // idle | upgrading | polling | done | failed
  message: '',
  lastRun: null
})
let upgradePollTimer = null

const flattenedChangelog = computed(() => {
  const cl = versionInfo.value.changelog
  if (!cl || !cl.groups) return []
  const order = ['feat', 'fix', 'security', 'perf', 'refactor', 'other']
  const label = {
    feat: '新功能',
    fix: '修复',
    security: '安全',
    perf: '性能',
    refactor: '重构',
    chore: '杂项',
    docs: '文档',
    other: '其他'
  }
  const out = []
  const keys = Object.keys(cl.groups).sort(
    (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)
  )
  for (const k of keys) {
    for (const item of cl.groups[k]) {
      out.push({ type: k, typeLabel: label[k] || k, sha: item.sha, subject: item.subject })
    }
  }
  return out
})

// ⬆️ 预检判定明细（旧记录无 preflightFindings 字段时安全退化为空）
const preflightFindings = computed(() => {
  const pf = upgradeModal.value.lastRun && upgradeModal.value.lastRun.preflightFindings
  return pf && Array.isArray(pf.files) ? pf.files : []
})
const preflightStashRef = computed(() => {
  const pf = upgradeModal.value.lastRun && upgradeModal.value.lastRun.preflightFindings
  return (pf && pf.stashRef) || ''
})

// 拉取最新一次升级记录（预检被拒时用于展示逐文件判定结果）
const refreshLastRun = async () => {
  try {
    const s = await getUpgradeStatusApi()
    if (s.success && s.data) {
      upgradeModal.value.lastRun = s.data.lastRun || null
    }
  } catch (_e) {
    /* 查询失败不影响主流程提示 */
  }
}

const openUpgradeModal = () => {
  upgradeModal.value = { open: true, phase: 'idle', message: '', lastRun: null }
}
const closeUpgradeModal = () => {
  upgradeModal.value.open = false
  if (upgradePollTimer) {
    clearInterval(upgradePollTimer)
    upgradePollTimer = null
  }
}

// 升级完成判定：轮询 check-updates，current 等于目标版本即完成（基于鉴权端点，非 /health）
const pollUntilUpgraded = (targetVersion) => {
  upgradeModal.value.phase = 'polling'
  upgradeModal.value.message = '服务正在重启，等待新版本生效…'
  let tries = 0
  if (upgradePollTimer) clearInterval(upgradePollTimer)
  upgradePollTimer = setInterval(async () => {
    tries++
    try {
      const r = await checkUpdatesApi()
      if (r.success && r.data && r.data.current === targetVersion) {
        clearInterval(upgradePollTimer)
        upgradePollTimer = null
        upgradeModal.value.phase = 'done'
        upgradeModal.value.message = '已升级至 v' + targetVersion
        versionInfo.value.current = r.data.current
        versionInfo.value.hasUpdate = false
        return
      }
    } catch (_e) {
      /* 重启窗口内请求失败属正常 */
    }
    // 同时刷新升级状态记录（跨重启可查）
    try {
      const s = await getUpgradeStatusApi()
      if (s.success && s.data) {
        upgradeModal.value.lastRun = s.data.lastRun
        if (s.data.lastRun && s.data.lastRun.status === 'failed') {
          clearInterval(upgradePollTimer)
          upgradePollTimer = null
          upgradeModal.value.phase = 'failed'
          upgradeModal.value.message =
            '升级失败：' + (s.data.lastRun.error || '未知错误') + '（服务仍运行旧版本）'
        }
      }
    } catch (_e) {
      /* ignore */
    }
    if (tries > 40) {
      clearInterval(upgradePollTimer)
      upgradePollTimer = null
      upgradeModal.value.phase = 'failed'
      upgradeModal.value.message = '等待超时，请检查服务状态或稍后刷新查看升级记录'
    }
  }, 3000)
}

const confirmUpgrade = async () => {
  const target = (versionInfo.value.latest || '').trim()
  if (!target) return
  upgradeModal.value.phase = 'upgrading'
  upgradeModal.value.message = '正在执行升级步骤…'
  try {
    const r = await triggerUpgradeApi(versionInfo.value.latestTag || undefined)
    if (r.success) {
      upgradeModal.value.lastRun = { steps: (r.data && r.data.steps) || [], status: 'success' }
      if (r.data && r.data.restarting) {
        pollUntilUpgraded(target)
      } else {
        upgradeModal.value.phase = 'done'
        upgradeModal.value.message = r.data ? r.data.message : '升级完成'
        versionInfo.value.current = target
        versionInfo.value.hasUpdate = false
        await refreshLastRun()
      }
    } else {
      upgradeModal.value.phase = 'failed'
      upgradeModal.value.message = r.message || '升级失败（服务仍运行旧版本）'
      await refreshLastRun()
    }
  } catch (e) {
    // 若因重启导致连接中断，转入轮询确认（可能已成功）
    if (e && (e.code === 'ECONNABORTED' || !e.response)) {
      pollUntilUpgraded(target)
    } else {
      upgradeModal.value.phase = 'failed'
      upgradeModal.value.message =
        (e.response && e.response.data && e.response.data.message) ||
        e.message ||
        '升级失败（服务仍运行旧版本）'
      await refreshLastRun()
    }
  }
}
const checkForUpdates = async () => {
  if (versionInfo.value.checkingUpdate) return
  versionInfo.value.checkingUpdate = true
  try {
    const result = await checkUpdatesApi()
    if (result.success) {
      const d = result.data
      versionInfo.value = {
        ...versionInfo.value,
        current: d.current,
        latest: d.latest,
        hasUpdate: d.hasUpdate,
        releaseInfo: d.releaseInfo,
        changelog: d.changelog,
        impact: d.impact,
        plannedSteps: d.plannedSteps,
        latestTag: d.latestTag,
        error: d.error
      }
    }
  } catch (_e) {
    const cached = localStorage.getItem('versionInfo')
    if (cached) {
      const c = JSON.parse(cached)
      versionInfo.value.current = c.current || versionInfo.value.current
    }
  } finally {
    versionInfo.value.checkingUpdate = false
  }
}

// Password modal
const showChangePasswordModal = ref(false)
const changePasswordLoading = ref(false)
const changePasswordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  newUsername: ''
})
const openChangePasswordModal = () => {
  Object.assign(changePasswordForm, {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    newUsername: ''
  })
  showChangePasswordModal.value = true
  closeDropdown()
}
const closeChangePasswordModal = () => {
  showChangePasswordModal.value = false
}
const changePassword = async () => {
  if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
    showToast('两次输入的密码不一致', 'error')
    return
  }
  if (changePasswordForm.newPassword.length < 8) {
    showToast('新密码长度至少8位', 'error')
    return
  }
  changePasswordLoading.value = true
  try {
    const data = await changePasswordApi({
      currentPassword: changePasswordForm.currentPassword,
      newPassword: changePasswordForm.newPassword,
      newUsername: changePasswordForm.newUsername || undefined
    })
    if (data.success) {
      showToast(
        changePasswordForm.newUsername
          ? '账户信息修改成功，请重新登录'
          : '密码修改成功，请重新登录',
        'success'
      )
      closeChangePasswordModal()
      setTimeout(() => {
        authStore.logout()
        router.push('/login')
      }, 1500)
    } else {
      showToast(data.message || '修改失败', 'error')
    }
  } catch (_e) {
    showToast('修改密码失败', 'error')
  } finally {
    changePasswordLoading.value = false
  }
}

// Confirm modal
const showConfirmModal = ref(false)
const confirmModalConfig = ref({
  title: '',
  message: '',
  type: 'primary',
  confirmText: '确认',
  cancelText: '取消'
})
const confirmResolve = ref(null)
const showConfirm = (
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  type = 'primary'
) => {
  return new Promise((resolve) => {
    confirmModalConfig.value = { title, message, confirmText, cancelText, type }
    confirmResolve.value = resolve
    showConfirmModal.value = true
  })
}
const handleConfirmModal = () => {
  showConfirmModal.value = false
  confirmResolve.value?.(true)
}
const handleCancelModal = () => {
  showConfirmModal.value = false
  confirmResolve.value?.(false)
}

// Logout
const logout = async () => {
  const confirmed = await showConfirm(
    '退出登录',
    '确定要退出登录吗？',
    '确定退出',
    '取消',
    'warning'
  )
  if (confirmed) {
    authStore.logout()
    router.push('/login')
    showToast('已安全退出', 'success')
  }
  closeDropdown()
}

// Scroll listener
let onScrollFn
const handleClickOutside = (e) => {
  if (!e.target.closest('.admin-nav') && !e.target.closest('.admin-dropdown')) closeDropdown()
}

onMounted(() => {
  onScrollFn = () => {
    scrolled.value = window.scrollY > 8
  }
  window.addEventListener('scroll', onScrollFn, { passive: true })
  document.addEventListener('click', handleClickOutside)
  onScrollFn()
  checkForUpdates()
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScrollFn)
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.admin-shell {
  font-family:
    -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue',
    'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
  background: #f5f5f7;
  min-height: 100vh;
}
:root.dark .admin-shell {
  background: #1d1d1f;
}

/* ---------- Nav ---------- */
.admin-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  height: 48px;
  background: rgba(245, 245, 247, 0.8);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  transition: box-shadow 0.3s ease;
}
.admin-nav--scrolled {
  box-shadow: 0 4px 12px -4px rgba(0, 0, 0, 0.08);
}
:root.dark .admin-nav {
  background: rgba(29, 29, 31, 0.85);
  border-bottom-color: rgba(255, 255, 255, 0.06);
}
:root.dark .admin-nav--scrolled {
  box-shadow: 0 4px 12px -4px rgba(0, 0, 0, 0.3);
}
.admin-nav__inner {
  max-width: 1400px;
  margin: 0 auto;
  height: 100%;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.admin-nav__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: #1d1d1f;
  font-weight: 600;
  font-size: 15px;
  white-space: nowrap;
  flex-shrink: 0;
}
:root.dark .admin-nav__brand {
  color: #f5f5f7;
}
.admin-nav__logo {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  object-fit: contain;
}
.admin-nav__logo-icon {
  font-size: 20px;
  color: #6e6e73;
}

/* ---------- Nav links ---------- */
.admin-nav__links {
  display: flex;
  align-items: center;
  gap: 24px;
  flex: 1;
  justify-content: center;
}
.admin-nav__link {
  font-size: 14px;
  font-weight: 400;
  color: #1d1d1f;
  text-decoration: none;
  opacity: 0.85;
  border: none;
  background: none;
  cursor: pointer;
  font-family: inherit;
  padding: 0;
  transition: opacity 0.2s;
}
:root.dark .admin-nav__link {
  color: #f5f5f7;
}
.admin-nav__link:hover {
  opacity: 1;
}
.admin-nav__link--active {
  opacity: 1;
  font-weight: 600;
}
.admin-nav__dropdown-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.admin-nav__caret {
  width: 10px;
  height: 6px;
  opacity: 0.5;
  transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.admin-nav__caret--open {
  transform: rotate(180deg);
}
@media (max-width: 720px) {
  .admin-nav__links {
    display: none;
  }
}

/* ---------- Nav right ---------- */
.admin-nav__right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.admin-nav__user-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: none;
  background: transparent;
  border-radius: 980px;
  font-size: 13px;
  font-weight: 500;
  color: #1d1d1f;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.2s;
}
:root.dark .admin-nav__user-btn {
  color: #f5f5f7;
}
.admin-nav__user-btn:hover {
  background: rgba(0, 0, 0, 0.05);
}
:root.dark .admin-nav__user-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}
.admin-nav__user-name {
  display: none;
}
@media (min-width: 768px) {
  .admin-nav__user-name {
    display: inline;
  }
}

/* ---------- Full-width dropdown (Apple style) ---------- */
.admin-dropdown {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  z-index: 48;
  background: rgba(251, 251, 253, 0.98);
  backdrop-filter: saturate(180%) blur(40px);
  -webkit-backdrop-filter: saturate(180%) blur(40px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  transform: scaleY(0);
  transform-origin: top center;
  opacity: 0;
  visibility: hidden;
  will-change: transform, opacity;
  transition:
    transform 0.38s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.28s ease,
    visibility 0s 0.38s;
}
:root.dark .admin-dropdown {
  background: rgba(44, 44, 46, 0.98);
  border-bottom-color: rgba(255, 255, 255, 0.06);
}
.admin-dropdown--open {
  transform: scaleY(1);
  opacity: 1;
  visibility: visible;
  transition:
    transform 0.42s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.22s ease,
    visibility 0s 0s;
}
.admin-dropdown--narrow {
  left: auto;
  right: 0;
  width: 280px;
  border-radius: 0 0 0 16px;
  transform-origin: top right;
}
.admin-dropdown__inner {
  max-width: 980px;
  margin: 0 auto;
  padding: 32px 22px 36px;
  display: flex;
  gap: 48px;
}
.admin-dropdown__inner--right {
  max-width: none;
  padding: 16px;
}
.admin-dropdown__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
}
.admin-dropdown__label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #86868b;
  padding: 0 0 10px;
  opacity: 0;
  transform: translateY(6px);
  will-change: transform, opacity;
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
  transition-delay: 0s;
}
.admin-dropdown--open .admin-dropdown__label {
  opacity: 1;
  transform: translateY(0);
  transition-delay: 0.06s;
}
.admin-dropdown__link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border: none;
  background: transparent;
  text-decoration: none;
  color: #424245;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.015em;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  width: 100%;
  opacity: 0;
  transform: translateY(8px);
  will-change: transform, opacity;
  transition:
    color 0.15s ease,
    opacity 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
  transition-delay: 0s;
}
:root.dark .admin-dropdown__link {
  color: #d1d1d6;
}
.admin-dropdown--open .admin-dropdown__link:nth-child(2) {
  transition-delay: 0.05s;
}
.admin-dropdown--open .admin-dropdown__link:nth-child(3) {
  transition-delay: 0.1s;
}
.admin-dropdown--open .admin-dropdown__link:nth-child(4) {
  transition-delay: 0.15s;
}
.admin-dropdown--open .admin-dropdown__link:nth-child(5) {
  transition-delay: 0.2s;
}
.admin-dropdown--open .admin-dropdown__link:nth-child(6) {
  transition-delay: 0.25s;
}
.admin-dropdown--open .admin-dropdown__link {
  opacity: 1;
  transform: translateY(0);
}
.admin-dropdown__link:hover {
  color: #0071e3;
}
:root.dark .admin-dropdown__link:hover {
  color: #0a84ff;
}
.admin-dropdown__link--active {
  color: #0071e3;
}
:root.dark .admin-dropdown__link--active {
  color: #0a84ff;
}
.admin-dropdown__link i {
  width: 24px;
  font-size: 17px;
  color: #86868b;
  transition: color 0.15s;
}
.admin-dropdown__link:hover i,
.admin-dropdown__link--active i {
  color: #0071e3;
}
:root.dark .admin-dropdown__link:hover i,
:root.dark .admin-dropdown__link--active i {
  color: #0a84ff;
}

/* User dropdown items (smaller) */
.admin-dropdown--narrow .admin-dropdown__link {
  font-size: 15px;
  font-weight: 500;
  padding: 8px 10px;
  border-radius: 8px;
}
.admin-dropdown--narrow .admin-dropdown__link:hover {
  background: rgba(0, 0, 0, 0.04);
}
:root.dark .admin-dropdown--narrow .admin-dropdown__link:hover {
  background: rgba(255, 255, 255, 0.06);
}
.admin-dropdown--narrow .admin-dropdown__link i {
  width: 20px;
  font-size: 14px;
}
.admin-dropdown__link--danger {
  color: #ff3b30 !important;
}
.admin-dropdown__link--danger i {
  color: #ff3b30 !important;
}
.admin-dropdown__user-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  margin-bottom: 4px;
}
:root.dark .admin-dropdown__user-head {
  border-color: rgba(255, 255, 255, 0.08);
}
.admin-dropdown__user-name {
  font-size: 14px;
  font-weight: 600;
  color: #1d1d1f;
}
:root.dark .admin-dropdown__user-name {
  color: #f5f5f7;
}
.admin-dropdown__badge {
  margin-left: auto;
  background: #ff3b30;
  color: #fff;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
}
.admin-dropdown__user-ver-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-left: 6px;
  background: #ff3b30;
  border-radius: 50%;
  vertical-align: middle;
}
.upgrade-modal {
  max-width: 560px;
}
.upgrade-ver {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  margin-bottom: 12px;
}
.upgrade-ver__cur {
  color: #86868b;
}
.upgrade-ver__arrow {
  color: #86868b;
  font-size: 12px;
}
.upgrade-ver__new {
  font-weight: 700;
  color: #0071e3;
}
.upgrade-ver__latest {
  color: #34c759;
}
.upgrade-block {
  margin: 12px 0;
}
.upgrade-block__title {
  font-size: 12px;
  color: #86868b;
  margin-bottom: 6px;
}
.upgrade-changelog {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.upgrade-changelog li {
  font-size: 13px;
}
.upgrade-tag {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 6px;
  margin-right: 6px;
  background: #f0f0f0;
  color: #333;
}
.upgrade-tag--feat {
  background: #e3f6e8;
  color: #1a7f37;
}
.upgrade-tag--fix {
  background: #fff4e0;
  color: #b25e00;
}
.upgrade-tag--security {
  background: #ffe3e3;
  color: #c0392b;
}
.upgrade-impact {
  font-size: 12px;
  color: #86868b;
  margin: 8px 0;
}
.upgrade-steps {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.upgrade-steps li {
  font-size: 13px;
}
.upgrade-steps li.is-skip {
  color: #b0b0b5;
}
.upgrade-steps__reason {
  font-size: 11px;
  color: #86868b;
  margin-left: 6px;
}
.upgrade-steps__warn {
  color: #ff9500;
  margin-left: 8px;
  font-size: 12px;
}
.upgrade-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  margin: 12px 0;
  background: #f5f5f7;
  font-size: 13px;
}
.upgrade-progress--done {
  background: #e3f6e8;
  color: #1a7f37;
}
.upgrade-progress--failed {
  background: #ffe3e3;
  color: #c0392b;
}
.upgrade-findings {
  list-style: none;
  padding: 0;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.upgrade-findings li.is-noise {
  color: #1a7f37;
}
.upgrade-findings li.is-blocking {
  color: #c0392b;
}
.upgrade-findings__path {
  margin-left: 4px;
  word-break: break-all;
}
.upgrade-findings__verdict {
  margin-left: 6px;
}
.upgrade-findings__reason {
  color: #86868b;
  margin-left: 6px;
}
.upgrade-findings__stash {
  color: #86868b;
  margin-left: 6px;
}
.upgrade-runsteps {
  list-style: none;
  padding: 0;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.upgrade-runsteps__status {
  color: #86868b;
  margin-left: 6px;
}
.upgrade-runsteps__tail {
  display: block;
  margin-top: 4px;
  padding: 6px;
  background: #1d1d1f;
  color: #ff8a80;
  font-size: 11px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
}
.upgrade-note--warn {
  color: #b25e00;
  font-size: 12px;
  margin: 8px 0;
}
.admin-dropdown__user-ver {
  font-size: 12px;
  color: #86868b;
  font-family: 'SF Mono', monospace;
}
.admin-dropdown__divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  margin: 4px 8px;
}
:root.dark .admin-dropdown__divider {
  background: rgba(255, 255, 255, 0.08);
}

/* ---------- Backdrop ---------- */
.admin-backdrop {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 47;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  opacity: 0;
  visibility: hidden;
  will-change: opacity;
  transition:
    opacity 0.35s ease,
    visibility 0s 0.35s;
}
.admin-backdrop--open {
  opacity: 1;
  visibility: visible;
  transition:
    opacity 0.3s ease,
    visibility 0s 0s;
}

@media (max-width: 720px) {
  .admin-dropdown__inner {
    flex-direction: column;
    gap: 20px;
    padding: 20px 22px 28px;
  }
  .admin-dropdown__link {
    font-size: 18px;
  }
  .admin-dropdown--narrow {
    width: 100%;
    border-radius: 0;
  }
}

/* ---------- Content ---------- */
.admin-content {
  max-width: 1400px;
  margin: 0 auto;
  padding: 64px 20px 40px;
}
@media (max-width: 900px) {
  .admin-content {
    padding-top: 108px;
  }
}

/* ---------- Modal ---------- */
.admin-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.admin-modal {
  width: 100%;
  max-width: 440px;
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 40px 80px -20px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
:root.dark .admin-modal {
  background: #2c2c2e;
}
.admin-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
:root.dark .admin-modal__header {
  border-color: rgba(255, 255, 255, 0.08);
}
.admin-modal__header h3 {
  font-size: 18px;
  font-weight: 600;
  color: #1d1d1f;
  margin: 0;
}
:root.dark .admin-modal__header h3 {
  color: #f5f5f7;
}
.admin-modal__close {
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 50%;
  cursor: pointer;
  color: #86868b;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}
.admin-modal__close:hover {
  background: rgba(0, 0, 0, 0.1);
}
.admin-modal__body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.admin-modal__actions {
  display: flex;
  gap: 10px;
  padding-top: 8px;
}

/* Fields */
.admin-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.admin-field label {
  font-size: 13px;
  font-weight: 600;
  color: #1d1d1f;
}
:root.dark .admin-field label {
  color: #f5f5f7;
}
.admin-field input {
  padding: 10px 14px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 10px;
  font-size: 15px;
  font-family: inherit;
  background: #fff;
  color: #1d1d1f;
  transition: border-color 0.2s;
}
:root.dark .admin-field input {
  background: #1d1d1f;
  color: #f5f5f7;
  border-color: rgba(255, 255, 255, 0.12);
}
.admin-field input:focus {
  outline: none;
  border-color: #0071e3;
  box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.15);
}
.admin-field input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Buttons */
.admin-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 980px;
  font-size: 15px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  flex: 1;
  text-align: center;
}
.admin-btn--primary {
  background: #0071e3;
  color: #fff;
}
.admin-btn--primary:hover {
  background: #0077ed;
}
.admin-btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.admin-btn--ghost {
  background: rgba(0, 0, 0, 0.05);
  color: #1d1d1f;
}
:root.dark .admin-btn--ghost {
  background: rgba(255, 255, 255, 0.1);
  color: #f5f5f7;
}
.admin-btn--ghost:hover {
  background: rgba(0, 0, 0, 0.1);
}
</style>
