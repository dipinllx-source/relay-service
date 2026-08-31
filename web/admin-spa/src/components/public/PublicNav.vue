<template>
  <!--
    对外页共用顶栏。原先 LandingView / StartView / TutorialLandingView 各自
    维护一份结构几乎相同的 nav 与两个下拉面板，scoped 样式各 33~37 条重复规则。
    三页差异只有两处，已收为 props：首页链接形态（落地页自身用锚点）
    与哪个下拉项高亮。
  -->
  <div>
    <nav class="apple-nav" :class="{ 'apple-nav--scrolled': scrolled }">
      <div class="apple-nav__inner">
        <component
          :is="homeAsAnchor ? 'a' : 'router-link'"
          class="apple-nav__brand"
          v-bind="homeAsAnchor ? { href: '#top' } : { to: '/' }"
        >
          <svg
            aria-hidden="true"
            class="apple-nav__logo"
            fill="none"
            viewBox="0 0 512 512"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient
                id="pubNavBg"
                gradientUnits="userSpaceOnUse"
                x1="96"
                x2="416"
                y1="64"
                y2="448"
              >
                <stop stop-color="#1C1C1E" />
                <stop offset="1" stop-color="#0F0F10" />
              </linearGradient>
              <linearGradient
                id="pubNavGloss"
                gradientUnits="userSpaceOnUse"
                x1="128"
                x2="384"
                y1="96"
                y2="416"
              >
                <stop stop-color="white" stop-opacity="0.16" />
                <stop offset="1" stop-color="white" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <rect fill="url(#pubNavBg)" height="336" rx="80" width="336" x="88" y="88" />
            <rect
              height="334"
              rx="79"
              stroke="white"
              stroke-opacity="0.08"
              stroke-width="2"
              width="334"
              x="89"
              y="89"
            />
            <path
              d="M214 170C171.03 170 136 205.03 136 248C136 290.97 171.03 326 214 326H251V296H216C189.49 296 168 274.51 168 248C168 221.49 189.49 200 216 200H251V170H214Z"
              fill="#F5F5F7"
            />
            <rect fill="#FFFFFF" height="224" rx="15" width="30" x="240" y="144" />
            <path
              d="M270 170H298C340.97 170 376 205.03 376 248C376 290.97 340.97 326 298 326H270V296H296C322.51 296 344 274.51 344 248C344 221.49 322.51 200 296 200H270V170Z"
              fill="#D1D5DB"
            />
            <path
              d="M126 136C126 124.954 134.954 116 146 116H366C377.046 116 386 124.954 386 136V142C386 130.954 377.046 122 366 122H146C134.954 122 126 130.954 126 142V136Z"
              fill="url(#pubNavGloss)"
            />
            <rect fill="white" fill-opacity="0.10" height="190" rx="7" width="14" x="248" y="158" />
          </svg>
          <span>Relay</span>
        </component>

        <div class="apple-nav__links">
          <component
            :is="homeAsAnchor ? 'a' : 'router-link'"
            v-bind="homeAsAnchor ? { href: '#top' } : { to: '/' }"
            >首页</component
          >
          <a
            class="apple-nav__dropdown-trigger"
            :class="{ 'apple-nav__link--active': active === 'start' }"
            href="#"
            @click.prevent="toggleDropdown('start')"
            @mouseenter="openDropdown('start')"
          >
            开始使用
            <svg
              aria-hidden="true"
              class="apple-nav__caret"
              :class="{ 'apple-nav__caret--open': activeDropdown === 'start' }"
              viewBox="0 0 10 6"
            >
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </a>
          <a
            class="apple-nav__dropdown-trigger"
            :class="{ 'apple-nav__link--active': active === 'tutorial' }"
            href="#"
            @click.prevent="toggleDropdown('tutorial')"
            @mouseenter="openDropdown('tutorial')"
          >
            使用教程
            <svg
              aria-hidden="true"
              class="apple-nav__caret"
              :class="{ 'apple-nav__caret--open': activeDropdown === 'tutorial' }"
              viewBox="0 0 10 6"
            >
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </a>
        </div>

        <div class="apple-nav__cta">
          <router-link to="/login">控制台 →</router-link>
        </div>
      </div>
    </nav>

    <div
      class="dropdown-backdrop"
      :class="{ 'dropdown-backdrop--open': !!activeDropdown }"
      @click="closeDropdown"
    ></div>

    <div
      class="dropdown-panel"
      :class="{ 'dropdown-panel--open': activeDropdown === 'start' }"
      @mouseleave="closeDropdown"
    >
      <div class="dropdown-panel__inner">
        <div class="dropdown-panel__section">
          <div class="dropdown-panel__label">开始使用</div>
          <router-link class="dropdown-panel__link" to="/start" @click="closeDropdown">
            <i class="fas fa-rocket" />
            <span>快速开始</span>
          </router-link>
          <router-link class="dropdown-panel__link" to="/api-stats" @click="closeDropdown">
            <i class="fas fa-chart-bar" />
            <span>实时数据</span>
          </router-link>
        </div>
      </div>
    </div>

    <div
      class="dropdown-panel"
      :class="{ 'dropdown-panel--open': activeDropdown === 'tutorial' }"
      @mouseleave="closeDropdown"
    >
      <div class="dropdown-panel__inner">
        <div class="dropdown-panel__section">
          <div class="dropdown-panel__label">使用教程</div>
          <router-link
            v-for="tool in cliTools"
            :key="tool.key"
            class="dropdown-panel__link"
            :to="{ path: '/tutorial', query: { tool: tool.key } }"
            @click="closeDropdown"
          >
            <i :class="tool.icon" />
            <span>{{ tool.name }}</span>
          </router-link>
        </div>
        <div class="dropdown-panel__section dropdown-panel__section--aside">
          <div class="dropdown-panel__label">快捷入口</div>
          <router-link class="dropdown-panel__link" to="/tutorial" @click="closeDropdown">
            <i class="fas fa-book-open" />
            <span>全部教程</span>
          </router-link>
          <router-link class="dropdown-panel__link" to="/api-stats" @click="closeDropdown">
            <i class="fas fa-chart-bar" />
            <span>实时数据</span>
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

import { cliToolsMeta as cliTools } from '@/constants/cliTools'

defineProps({
  // 落地页自身即首页，首页入口用锚点滚动而非路由跳转
  homeAsAnchor: { type: Boolean, default: false },
  // 当前高亮的下拉项：'start' | 'tutorial' | ''
  active: { type: String, default: '' }
})

const scrolled = ref(false)
const activeDropdown = ref(null)

const openDropdown = (name) => {
  activeDropdown.value = name
}
const toggleDropdown = (name) => {
  activeDropdown.value = activeDropdown.value === name ? null : name
}
const closeDropdown = () => {
  activeDropdown.value = null
}

let onScroll
onMounted(() => {
  onScroll = () => {
    scrolled.value = window.scrollY > 8
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
})
</script>

<style scoped>
/* Nav */
.apple-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  height: 48px;
  transition:
    background 0.4s ease,
    backdrop-filter 0.4s ease;
}
.apple-nav--scrolled {
  background: rgba(251, 251, 253, 0.72);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.apple-nav__inner {
  max-width: 1024px;
  margin: 0 auto;
  height: 100%;
  padding: 0 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
}
.apple-nav__brand {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #1d1d1f;
  text-decoration: none;
  font-weight: 600;
}
.apple-nav__logo {
  width: 26px;
  height: 26px;
  display: block;
}
.apple-nav__links {
  display: flex;
  gap: 28px;
}
.apple-nav__links a {
  color: #1d1d1f;
  text-decoration: none;
  opacity: 0.85;
  transition: opacity 0.2s;
}
.apple-nav__links a:hover {
  opacity: 1;
}
.apple-nav__link--active {
  opacity: 1;
  font-weight: 600;
}
.apple-nav__cta a {
  color: #0071e3;
  text-decoration: none;
  font-weight: 500;
}
/* Dropdown trigger */
.apple-nav__dropdown-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #1d1d1f;
  text-decoration: none;
  opacity: 0.85;
  transition: opacity 0.2s;
  cursor: pointer;
}
.apple-nav__dropdown-trigger:hover {
  opacity: 1;
}
.apple-nav__caret {
  width: 10px;
  height: 6px;
  transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  opacity: 0.5;
}
.apple-nav__caret--open {
  transform: rotate(180deg);
}
/* Dropdown panel */
.dropdown-panel {
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
.dropdown-panel--open {
  transform: scaleY(1);
  opacity: 1;
  visibility: visible;
  transition:
    transform 0.42s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.22s ease,
    visibility 0s 0s;
}
.dropdown-panel__inner {
  max-width: 980px;
  margin: 0 auto;
  padding: 36px 22px 44px;
  display: flex;
  gap: 60px;
}
.dropdown-panel__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 220px;
}
.dropdown-panel__section--aside {
  padding-left: 60px;
  border-left: 1px solid rgba(0, 0, 0, 0.06);
}
.dropdown-panel__label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #86868b;
  padding: 0 0 12px;
  opacity: 0;
  transform: translateY(6px);
  will-change: transform, opacity;
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
  transition-delay: 0s;
}
.dropdown-panel--open .dropdown-panel__label {
  opacity: 1;
  transform: translateY(0);
  transition-delay: 0.06s;
}
.dropdown-panel__link {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 0;
  text-decoration: none;
  color: #424245;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.015em;
  opacity: 0;
  transform: translateY(8px);
  will-change: transform, opacity;
  transition:
    color 0.15s ease,
    opacity 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
  transition-delay: 0s;
}
.dropdown-panel--open .dropdown-panel__link:nth-child(2) {
  transition-delay: 0.05s;
}
.dropdown-panel--open .dropdown-panel__link:nth-child(3) {
  transition-delay: 0.1s;
}
.dropdown-panel--open .dropdown-panel__link:nth-child(4) {
  transition-delay: 0.15s;
}
.dropdown-panel--open .dropdown-panel__link:nth-child(5) {
  transition-delay: 0.2s;
}
.dropdown-panel--open .dropdown-panel__link {
  opacity: 1;
  transform: translateY(0);
}
.dropdown-panel__link:hover {
  color: #0071e3;
}
.dropdown-panel__link i {
  width: 28px;
  font-size: 20px;
  color: #86868b;
  transition: color 0.15s ease;
}
.dropdown-panel__link:hover i {
  color: #0071e3;
}
.dropdown-panel__section--aside .dropdown-panel__link {
  font-size: 17px;
  font-weight: 500;
  color: #6e6e73;
}
.dropdown-panel__section--aside .dropdown-panel__link:hover {
  color: #0071e3;
}
.dropdown-panel__section--aside .dropdown-panel__link i {
  font-size: 16px;
  width: 22px;
}
.dropdown-panel__inner {
  flex-direction: column;
  gap: 24px;
  padding: 24px 22px 32px;
}
.dropdown-panel__section--aside {
  padding-left: 0;
  border-left: none;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding-top: 16px;
}
.dropdown-panel__link {
  font-size: 20px;
}

.dark .apple-nav--scrolled {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.dark .apple-nav__brand,
.dark .apple-nav__links a,
.dark .apple-nav__dropdown-trigger {
  color: #e5e7eb;
}
.dark .dropdown-panel {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.dark .dropdown-panel__label,
.dark .dropdown-panel__link i,
.dark .dropdown-panel__section--aside .dropdown-panel__link {
  color: #9ca3af;
}
.dark .dropdown-panel__section--aside {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.dropdown-backdrop {
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
.dropdown-backdrop--open {
  opacity: 1;
  visibility: visible;
  transition:
    opacity 0.3s ease,
    visibility 0s 0s;
}
@media (max-width: 720px) {
  .apple-nav__links {
    display: none;
  }
  .dropdown-panel__inner {
    flex-direction: column;
    gap: 24px;
    padding: 24px 22px 32px;
  }
}
</style>
