import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './assets/fonts/inter/inter.css'
import App from './App.vue'
import router from './router'
import { useUserStore } from './stores/user'
import './assets/styles/main.css'
import './assets/styles/global.css'
import { installAppleAccordion } from './utils/appleAccordion'

// 创建Vue应用
const app = createApp(App)

// 使用Pinia状态管理
const pinia = createPinia()
app.use(pinia)

// 使用路由
app.use(router)

// 使用Element Plus
app.use(ElementPlus, {
  locale: zhCn
})

// 设置axios拦截器
const userStore = useUserStore()
userStore.setupAxiosInterceptors()

// Apple 风格折叠动画（教程常见问题等 details.apple-accordion）
installAppleAccordion()

// 挂载应用
app.mount('#app')
