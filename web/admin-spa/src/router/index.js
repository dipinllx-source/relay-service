import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUserStore } from '@/stores/user'
import { APP_CONFIG, showToast } from '@/utils/tools'

// 路由懒加载
const LandingView = () => import('@/views/LandingView.vue')
const TutorialLandingView = () => import('@/views/TutorialLandingView.vue')
const StartView = () => import('@/views/StartView.vue')
const LoginView = () => import('@/views/LoginView.vue')
const UserLoginView = () => import('@/views/UserLoginView.vue')
const UserDashboardView = () => import('@/views/UserDashboardView.vue')
const UserManagementView = () => import('@/views/UserManagementView.vue')
const MainLayout = () => import('@/components/layout/MainLayout.vue')
const DashboardView = () => import('@/views/DashboardView.vue')
const ApiKeysView = () => import('@/views/ApiKeysView.vue')
const ApiKeyUsageRecordsView = () => import('@/views/ApiKeyUsageRecordsView.vue')
const AccountsView = () => import('@/views/AccountsView.vue')
const AccountUsageRecordsView = () => import('@/views/AccountUsageRecordsView.vue')
const SettingsView = () => import('@/views/SettingsView.vue')
const ApiStatsView = () => import('@/views/ApiStatsView.vue')

const RequestDetailsView = () => import('@/views/RequestDetailsView.vue')
const NotFoundView = () => import('@/views/NotFoundView.vue')

const routes = [
  {
    path: '/',
    name: 'Landing',
    component: LandingView,
    meta: { requiresAuth: false }
  },
  {
    path: '/tutorial',
    name: 'Tutorial',
    component: TutorialLandingView,
    meta: { requiresAuth: false }
  },
  {
    path: '/start',
    name: 'Start',
    component: StartView,
    meta: { requiresAuth: false }
  },
  {
    path: '/login',
    name: 'Login',
    component: LoginView,
    meta: { requiresAuth: false }
  },
  {
    path: '/admin-login',
    redirect: '/login'
  },
  {
    path: '/user-login',
    name: 'UserLogin',
    component: UserLoginView,
    meta: { requiresAuth: false, userAuth: true }
  },
  {
    path: '/user-dashboard',
    name: 'UserDashboard',
    component: UserDashboardView,
    meta: { requiresUserAuth: true }
  },
  {
    path: '/api-stats',
    name: 'ApiStats',
    component: ApiStatsView,
    meta: { requiresAuth: false }
  },
  {
    path: '/dashboard',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: DashboardView
      }
    ]
  },
  {
    path: '/api-keys',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'ApiKeys',
        component: ApiKeysView
      },
      {
        path: 'deleted',
        name: 'ApiKeysDeleted',
        component: ApiKeysView
      }
    ]
  },
  {
    path: '/api-keys/:keyId/usage-records',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'ApiKeyUsageRecords',
        component: ApiKeyUsageRecordsView
      }
    ]
  },
  {
    path: '/accounts',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Accounts',
        component: AccountsView
      }
    ]
  },
  {
    path: '/accounts/:accountId/usage-records',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'AccountUsageRecords',
        component: AccountUsageRecordsView
      }
    ]
  },
  {
    path: '/settings',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Settings',
        component: SettingsView
      },
      {
        path: 'webhook',
        name: 'SettingsWebhook',
        component: SettingsView
      },
      {
        path: 'claude',
        name: 'SettingsClaude',
        component: SettingsView
      },
      {
        path: 'service-rates',
        name: 'SettingsServiceRates',
        component: SettingsView
      },
      {
        path: 'model-pricing',
        name: 'SettingsModelPricing',
        component: SettingsView
      },
      {
        path: 'https',
        name: 'SettingsHttps',
        component: SettingsView
      },
      {
        path: 'storage',
        name: 'SettingsStorage',
        component: SettingsView
      }
    ]
  },
  {
    path: '/user-management',
    component: MainLayout,
    // requiresLdap 与顶栏导航注入引用同一个 authStore.oemSettings.ldapEnabled，
    // 用户体系未启用时由守卫拦截，使该页不可达
    meta: { requiresAuth: true, requiresLdap: true },
    children: [
      {
        path: '',
        name: 'UserManagement',
        component: UserManagementView
      }
    ]
  },
  {
    path: '/request-details',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'RequestDetails',
        component: RequestDetailsView
      }
    ]
  },
  {
    path: '/not-found',
    name: 'NotFound',
    component: NotFoundView,
    meta: { requiresAuth: false }
  },
  // 捕获所有未匹配的路由
  {
    path: '/:pathMatch(.*)*',
    redirect: '/api-stats'
  }
]

const router = createRouter({
  history: createWebHistory(APP_CONFIG.basePath),
  routes,
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, behavior: 'smooth' }
    return { top: 0 }
  }
})

// 路由守卫
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()
  const userStore = useUserStore()

  console.log('路由导航:', {
    to: to.path,
    from: from.path,
    fullPath: to.fullPath,
    requiresAuth: to.meta.requiresAuth,
    requiresUserAuth: to.meta.requiresUserAuth,
    isAuthenticated: authStore.isAuthenticated,
    isUserAuthenticated: userStore.isAuthenticated
  })

  // 防止重定向循环：如果已经在目标路径，直接放行
  if (to.path === from.path && to.fullPath === from.fullPath) {
    return next()
  }

  // 检查用户认证状态
  if (to.meta.requiresUserAuth) {
    if (!userStore.isAuthenticated) {
      // 尝试检查本地存储的认证信息
      try {
        const isUserLoggedIn = await userStore.checkAuth()
        if (!isUserLoggedIn) {
          return next('/user-login')
        }
      } catch (error) {
        // If the error is about disabled account, redirect to login with error
        if (error.message && error.message.includes('disabled')) {
          showToast(error.message, 'error')
        }
        return next('/user-login')
      }
    }
    return next()
  }

  // API Stats 页面不需要认证，直接放行
  if (to.path === '/api-stats' || to.path.startsWith('/api-stats')) {
    next()
  } else if (to.path === '/user-login') {
    // 如果已经是用户登录状态，重定向到用户仪表板
    if (userStore.isAuthenticated) {
      next('/user-dashboard')
    } else {
      next()
    }
  } else if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next('/login')
  } else if (to.path === '/login' && authStore.isAuthenticated) {
    next('/dashboard')
  } else if (to.meta.requiresLdap) {
    // 特性门禁：必须先确保 OEM 设置已取回再判定，否则首屏 ldapEnabled 尚为默认值，
    // 会把已启用用户体系的部署误判为未启用
    try {
      await authStore.ensureOemSettings()
    } catch (error) {
      console.error('校验用户体系开关失败:', error)
    }
    if (authStore.oemSettings?.ldapEnabled) {
      next()
    } else {
      next({ path: '/not-found', query: { reason: 'feature-disabled' }, replace: true })
    }
  } else {
    next()
  }
})

export default router
