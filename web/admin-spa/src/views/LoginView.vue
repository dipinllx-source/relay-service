<template>
  <div class="apple-login">
    <!-- Top nav (fixed) -->
    <nav class="apple-nav">
      <div class="apple-nav__inner">
        <router-link class="apple-nav__brand" to="/">
          <svg
            aria-hidden="true"
            class="apple-nav__logo"
            fill="none"
            viewBox="0 0 512 512"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient
                id="loginBg"
                gradientUnits="userSpaceOnUse"
                x1="96"
                x2="416"
                y1="64"
                y2="448"
              >
                <stop stop-color="#1C1C1E" />
                <stop offset="1" stop-color="#0F0F10" />
              </linearGradient>
            </defs>
            <rect fill="url(#loginBg)" height="336" rx="80" width="336" x="88" y="88" />
            <path
              d="M214 170C171.03 170 136 205.03 136 248C136 290.97 171.03 326 214 326H251V296H216C189.49 296 168 274.51 168 248C168 221.49 189.49 200 216 200H251V170H214Z"
              fill="#F5F5F7"
            />
            <rect fill="#FFFFFF" height="224" rx="15" width="30" x="240" y="144" />
            <path
              d="M270 170H298C340.97 170 376 205.03 376 248C376 290.97 340.97 326 298 326H270V296H296C322.51 296 344 274.51 344 248C344 221.49 322.51 200 296 200H270V170Z"
              fill="#D1D5DB"
            />
          </svg>
          <span>Relay</span>
        </router-link>
      </div>
    </nav>

    <!-- Main -->
    <main class="al-main">
      <div class="al-card">
        <!-- Avatar icon -->
        <div class="al-avatar">
          <svg fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" fill="none" r="23.5" stroke="#d2d2d7" />
            <circle cx="24" cy="19" fill="#86868b" r="7" />
            <path
              d="M10 40c2.5-6.5 8-10 14-10s11.5 3.5 14 10"
              fill="none"
              stroke="#86868b"
              stroke-linecap="round"
              stroke-width="3"
            />
          </svg>
        </div>

        <!-- Heading -->
        <h1 class="al-title">登录</h1>
        <p class="al-sub">{{ authStore.oemSettings.siteName || 'Relay Service' }} 管理后台</p>

        <!-- Form -->
        <form class="al-form" @submit.prevent="handleLogin">
          <div
            class="al-field"
            :class="{ 'al-field--focus': userFocus, 'al-field--filled': loginForm.username }"
          >
            <label class="al-field__label" for="username">用户名</label>
            <input
              id="username"
              v-model="loginForm.username"
              autocomplete="username"
              class="al-field__input"
              name="username"
              required
              type="text"
              @blur="userFocus = false"
              @focus="userFocus = true"
            />
          </div>

          <div
            class="al-field"
            :class="{ 'al-field--focus': passFocus, 'al-field--filled': loginForm.password }"
          >
            <label class="al-field__label" for="password">密码</label>
            <div class="al-field__row">
              <input
                id="password"
                v-model="loginForm.password"
                autocomplete="current-password"
                class="al-field__input"
                name="password"
                required
                :type="showPassword ? 'text' : 'password'"
                @blur="passFocus = false"
                @focus="passFocus = true"
              />
              <button
                class="al-field__toggle"
                tabindex="-1"
                type="button"
                @click="showPassword = !showPassword"
              >
                <i :class="showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'" />
              </button>
              <!-- Arrow submit inside field -->
              <button
                aria-label="登录"
                class="al-field__arrow"
                :class="{ 'al-field__arrow--enabled': loginForm.username && loginForm.password }"
                :disabled="authStore.loginLoading || !loginForm.username || !loginForm.password"
                type="submit"
              >
                <svg v-if="!authStore.loginLoading" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M5 12h14M13 6l6 6-6 6"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                  />
                </svg>
                <svg v-else class="al-spinner" viewBox="0 0 24 24">
                  <circle
                    cx="12"
                    cy="12"
                    fill="none"
                    r="10"
                    stroke="currentColor"
                    stroke-width="3"
                  />
                </svg>
              </button>
            </div>
          </div>

          <!-- Remember + Error -->
          <div class="al-remember">
            <label class="al-remember__check">
              <input v-model="remember" type="checkbox" />
              <span class="al-remember__box"><i class="fas fa-check"></i></span>
              <span class="al-remember__text">记住我</span>
            </label>
          </div>

          <Transition name="al-shake">
            <div v-if="authStore.loginError" class="al-error">
              <i class="fas fa-exclamation-circle" />
              <span>{{ authStore.loginError }}</span>
            </div>
          </Transition>
        </form>

        <!-- Helper links -->
        <div class="al-links">
          <router-link class="al-link" to="/">返回首页</router-link>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="al-footer">
      <div class="al-footer__inner">
        <span>版权所有 © {{ new Date().getFullYear() }} Relay Service · 保留所有权利</span>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'

const authStore = useAuthStore()
const themeStore = useThemeStore()

const loginForm = ref({ username: '', password: '' })
const userFocus = ref(false)
const passFocus = ref(false)
const showPassword = ref(false)
const remember = ref(true)

onMounted(() => {
  themeStore.initTheme()
  authStore.loadOemSettings()
})

const handleLogin = async () => {
  await authStore.login(loginForm.value)
}
</script>

<style scoped>
.apple-login {
  min-height: 100vh;
  background: #ffffff;
  font-family:
    -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue',
    'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  display: flex;
  flex-direction: column;
  color: #1d1d1f;
}

/* ---------- Nav (minimal) ---------- */
.apple-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  height: 48px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.apple-nav__inner {
  max-width: 1024px;
  margin: 0 auto;
  height: 100%;
  padding: 0 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.apple-nav__brand {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #1d1d1f;
  text-decoration: none;
  font-weight: 600;
  font-size: 14px;
}
.apple-nav__logo {
  width: 24px;
  height: 24px;
  display: block;
}

/* ---------- Main ---------- */
.al-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px 40px;
}

/* ---------- Card (no bg, just content) ---------- */
.al-card {
  width: 100%;
  max-width: 360px;
  text-align: center;
}

/* Avatar */
.al-avatar {
  width: 56px;
  height: 56px;
  margin: 0 auto 24px;
}
.al-avatar svg {
  width: 100%;
  height: 100%;
}

/* Heading */
.al-title {
  font-size: 32px;
  font-weight: 600;
  color: #1d1d1f;
  letter-spacing: -0.02em;
  margin: 0 0 8px;
  line-height: 1.15;
}
.al-sub {
  font-size: 17px;
  color: #6e6e73;
  margin: 0 0 28px;
  font-weight: 400;
  line-height: 1.4;
}

/* ---------- Form ---------- */
.al-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  text-align: left;
}

/* Input field (Apple pill with arrow submit) */
.al-field {
  position: relative;
  border: 1px solid #d2d2d7;
  border-radius: 12px;
  background: #fff;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
  min-height: 56px;
}
.al-field:hover {
  border-color: #86868b;
}
.al-field--focus {
  border-color: #0071e3;
  box-shadow:
    0 0 0 4px rgba(0, 113, 227, 0.15),
    0 0 0 1px #0071e3;
}
.al-field__label {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 17px;
  color: #86868b;
  pointer-events: none;
  transition:
    top 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    font-size 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  transform-origin: left center;
}
.al-field--focus .al-field__label,
.al-field--filled .al-field__label {
  top: 12px;
  transform: translateY(0);
  font-size: 11px;
  color: #86868b;
}
.al-field__input {
  width: 100%;
  padding: 26px 56px 10px 16px;
  border: none;
  background: transparent;
  font-size: 17px;
  font-family: inherit;
  color: #1d1d1f;
  outline: none;
  line-height: 1.25;
  border-radius: 12px;
}
.al-field__row {
  display: flex;
  align-items: center;
}
.al-field__row .al-field__input {
  flex: 1;
  padding-right: 88px;
}
.al-field__toggle {
  position: absolute;
  right: 52px;
  top: 50%;
  transform: translateY(-50%);
  padding: 8px;
  border: none;
  background: transparent;
  color: #86868b;
  cursor: pointer;
  font-size: 14px;
  transition: color 0.15s;
}
.al-field__toggle:hover {
  color: #1d1d1f;
}

/* Arrow submit button inside password field */
.al-field__arrow {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: #e8e8ed;
  color: #86868b;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    transform 0.15s ease;
}
.al-field__arrow svg {
  width: 16px;
  height: 16px;
}
.al-field__arrow--enabled {
  background: #0071e3;
  color: #fff;
}
.al-field__arrow--enabled:hover {
  background: #0077ed;
}
.al-field__arrow:active {
  transform: translateY(-50%) scale(0.92);
}
.al-field__arrow:disabled {
  cursor: not-allowed;
}
.al-spinner {
  animation: spin 0.8s linear infinite;
}
.al-spinner circle {
  stroke-dasharray: 50;
  stroke-dashoffset: 35;
  stroke-linecap: round;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---------- Remember me ---------- */
.al-remember {
  display: flex;
  align-items: center;
  padding-left: 4px;
  margin-top: 4px;
}
.al-remember__check {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.al-remember__check input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.al-remember__box {
  width: 16px;
  height: 16px;
  border: 1px solid #86868b;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.al-remember__box i {
  font-size: 9px;
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s;
}
.al-remember__check input:checked + .al-remember__box {
  background: #0071e3;
  border-color: #0071e3;
}
.al-remember__check input:checked + .al-remember__box i {
  opacity: 1;
}
.al-remember__text {
  font-size: 13px;
  color: #1d1d1f;
}

/* ---------- Error ---------- */
.al-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  background: #fef2f2;
  border-radius: 10px;
  color: #dc2626;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.4;
}
.al-error i {
  flex-shrink: 0;
  font-size: 13px;
  margin-top: 2px;
}
.al-shake-enter-active {
  animation: shake 0.45s ease-in-out;
}
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-6px);
  }
  40% {
    transform: translateX(6px);
  }
  60% {
    transform: translateX(-3px);
  }
  80% {
    transform: translateX(3px);
  }
}

/* ---------- Helper links ---------- */
.al-links {
  margin-top: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.al-link {
  color: #0071e3;
  text-decoration: none;
  font-size: 14px;
  font-weight: 400;
}
.al-link:hover {
  text-decoration: underline;
}

/* ---------- Footer ---------- */
.al-footer {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: #f5f5f7;
  padding: 20px 22px;
}
.al-footer__inner {
  max-width: 1024px;
  margin: 0 auto;
  font-size: 12px;
  color: #86868b;
  text-align: center;
}
</style>
