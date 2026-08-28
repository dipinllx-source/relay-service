<template>
  <div class="apple-landing tutorial-page">
    <!-- Primary nav (same as Landing) -->
    <nav class="apple-nav" :class="{ 'apple-nav--scrolled': scrolled }">
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
                id="relayBg2"
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
                id="relayGloss2"
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
            <rect fill="url(#relayBg2)" height="336" rx="80" width="336" x="88" y="88" />
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
              fill="url(#relayGloss2)"
            />
            <rect fill="white" fill-opacity="0.10" height="190" rx="7" width="14" x="248" y="158" />
          </svg>
          <span>Relay</span>
        </router-link>
        <div class="apple-nav__links">
          <router-link to="/">首页</router-link>
          <a
            class="apple-nav__dropdown-trigger"
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
          <a
            class="apple-nav__dropdown-trigger apple-nav__link--active"
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
        <div class="apple-nav__cta">
          <router-link to="/login">控制台 →</router-link>
        </div>
      </div>
    </nav>

    <!-- Full-width dropdown panel (Apple-style, GPU-only) -->
    <div
      class="dropdown-panel"
      :class="{ 'dropdown-panel--open': activeDropdown === 'tutorial' }"
      @mouseleave="closeDropdown"
    >
      <div class="dropdown-panel__inner">
        <div class="dropdown-panel__section">
          <div class="dropdown-panel__label">使用教程</div>
          <button
            v-for="tool in cliTools"
            :key="tool.key"
            class="dropdown-panel__link"
            :class="{ 'dropdown-panel__link--active': activeCliTool === tool.key }"
            @click="selectTool(tool.key)"
          >
            <i :class="tool.icon" />
            <span>{{ tool.name }}</span>
          </button>
        </div>
        <div class="dropdown-panel__section dropdown-panel__section--aside">
          <div class="dropdown-panel__label">快捷入口</div>
          <router-link class="dropdown-panel__link" to="/" @click="closeDropdown">
            <i class="fas fa-home" />
            <span>首页</span>
          </router-link>
          <router-link class="dropdown-panel__link" to="/api-stats" @click="closeDropdown">
            <i class="fas fa-chart-bar" />
            <span>实时数据</span>
          </router-link>
        </div>
      </div>
    </div>
    <div
      class="dropdown-backdrop"
      :class="{ 'dropdown-backdrop--open': !!activeDropdown }"
      @click="closeDropdown"
    ></div>

    <!-- Start dropdown panel -->
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

    <!-- Page hero -->
    <section class="tut-hero">
      <div class="tut-hero__inner">
        <p class="tut-hero__eyebrow">{{ currentToolTitle }}</p>
        <h1 class="tut-hero__title">在几分钟内，完成接入。</h1>
        <p class="tut-hero__sub">选择你的操作系统，按步骤在本地完成安装与认证。</p>

        <!-- OS selector (also menu-styled) -->
        <div class="os-menu">
          <button
            v-for="system in tutorialSystems"
            :key="system.key"
            class="os-menu__item"
            :class="{ 'os-menu__item--active': activeTutorialSystem === system.key }"
            @click="activeTutorialSystem = system.key"
          >
            <i :class="system.icon" />
            <span>{{ system.name }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- Demo panel -->
    <section class="demo">
      <div class="demo__frame">
        <div class="demo__bar">
          <span class="demo__dot demo__dot--r"></span>
          <span class="demo__dot demo__dot--y"></span>
          <span class="demo__dot demo__dot--g"></span>
          <div class="demo__crumbs">
            <span>{{ currentToolTitle }}</span>
            <span class="demo__crumbs-sep">›</span>
            <span>{{ currentSystemName }}</span>
          </div>
        </div>
        <div
          :key="activeCliTool + '-' + activeTutorialSystem"
          ref="demoBodyRef"
          class="demo__body"
          :class="`tutorial-platform--${activeTutorialSystem}`"
        >
          <component :is="currentTutorialComponent" :platform="activeTutorialSystem" />
        </div>
      </div>
    </section>

    <footer class="foot">
      <div class="foot__inner">
        <span>Relay Service</span>
        <span class="foot__sep">·</span>
        <span>多平台 AI API 中转</span>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ClaudeCodeTutorial from '@/components/tutorial/ClaudeCodeTutorial.vue'
import GeminiCliTutorial from '@/components/tutorial/GeminiCliTutorial.vue'
import CodexTutorial from '@/components/tutorial/CodexTutorial.vue'
import DroidCliTutorial from '@/components/tutorial/DroidCliTutorial.vue'
import { enhanceTutorialCommandBoxes } from '@/utils/tutorialCommandCopy'

const route = useRoute()
const router = useRouter()

const scrolled = ref(false)
const activeDropdown = ref(null)
const demoBodyRef = ref(null)
const openDropdown = (name) => {
  activeDropdown.value = name
}
const toggleDropdown = (name) => {
  activeDropdown.value = activeDropdown.value === name ? null : name
}
const closeDropdown = () => {
  activeDropdown.value = null
}

const activeTutorialSystem = ref('windows')
const activeCliTool = ref('claude-code')

const tutorialSystems = [
  { key: 'windows', name: 'Windows', icon: 'fab fa-windows' },
  { key: 'macos', name: 'macOS', icon: 'fab fa-apple' },
  { key: 'linux', name: 'Linux / WSL2', icon: 'fab fa-linux' }
]

const cliTools = [
  { key: 'claude-code', name: 'Claude Code', icon: 'fas fa-robot', component: ClaudeCodeTutorial },
  { key: 'codex', name: 'Codex', icon: 'fas fa-code', component: CodexTutorial },
  { key: 'gemini-cli', name: 'Gemini CLI', icon: 'fab fa-google', component: GeminiCliTutorial },
  { key: 'droid-cli', name: 'Droid CLI', icon: 'fas fa-terminal', component: DroidCliTutorial }
]

const currentToolTitle = computed(() => {
  const t = cliTools.find((x) => x.key === activeCliTool.value)
  return t ? t.name : 'CLI 工具'
})
const currentSystemName = computed(() => {
  const s = tutorialSystems.find((x) => x.key === activeTutorialSystem.value)
  return s ? s.name : ''
})
const currentTutorialComponent = computed(() => {
  const t = cliTools.find((x) => x.key === activeCliTool.value)
  return t ? t.component : null
})

const applyToolFromQuery = () => {
  const q = route.query.tool
  if (q && cliTools.some((t) => t.key === q)) {
    activeCliTool.value = q
  }
}

const selectTool = (key) => {
  activeCliTool.value = key
  closeDropdown()
  if (route.query.tool !== key) {
    router.replace({ path: '/tutorial', query: { ...route.query, tool: key } })
  }
}

const refreshCommandCopyButtons = () => {
  nextTick(() => {
    enhanceTutorialCommandBoxes(demoBodyRef.value)
  })
}

watch(() => route.query.tool, applyToolFromQuery)
watch([activeCliTool, activeTutorialSystem], refreshCommandCopyButtons)

let onScroll
onMounted(() => {
  applyToolFromQuery()
  onScroll = () => {
    scrolled.value = window.scrollY > 8
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
  refreshCommandCopyButtons()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
})
</script>

<style scoped>
.tutorial-page {
  font-family:
    -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue',
    'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  background: #fbfbfd;
  color: #1d1d1f;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.015em;
  min-height: 100vh;
}

/* ---------- Primary nav ---------- */
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
.apple-nav__links a:hover,
.apple-nav__link--active {
  opacity: 1;
}
.apple-nav__link--active {
  font-weight: 600;
}
.apple-nav__cta a {
  color: #0071e3;
  text-decoration: none;
  font-weight: 500;
}
@media (max-width: 720px) {
  .apple-nav__links {
    display: none;
  }
}

/* ---------- Dropdown trigger ---------- */
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

/* ---------- Full-width dropdown panel (GPU-only) ---------- */
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
  border: none;
  background: transparent;
  text-decoration: none;
  color: #424245;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.015em;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
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
.dropdown-panel--open .dropdown-panel__link:nth-child(6) {
  transition-delay: 0.25s;
}
.dropdown-panel--open .dropdown-panel__link {
  opacity: 1;
  transform: translateY(0);
}
.dropdown-panel__link:hover {
  color: #0071e3;
}
.dropdown-panel__link--active {
  color: #0071e3;
}
.dropdown-panel__link i {
  width: 28px;
  font-size: 20px;
  color: #86868b;
  transition: color 0.15s ease;
}
.dropdown-panel__link:hover i,
.dropdown-panel__link--active i {
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

/* ---------- Backdrop ---------- */
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
}

/* ---------- Hero ---------- */
.tut-hero {
  padding: 110px 22px 40px;
  text-align: center;
  max-width: 980px;
  margin: 0 auto;
}
.tut-hero__eyebrow {
  font-size: 17px;
  font-weight: 500;
  color: #0071e3;
  margin: 0 0 8px;
}
.tut-hero__title {
  font-size: clamp(36px, 6vw, 64px);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.08;
  margin: 0 0 16px;
  background: linear-gradient(180deg, #1d1d1f 0%, #2d2d33 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.tut-hero__sub {
  font-size: 19px;
  color: #6e6e73;
  margin: 0 0 36px;
}

/* OS menu */
.os-menu {
  display: inline-flex;
  gap: 6px;
  padding: 6px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 980px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.os-menu__item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  border: none;
  background: transparent;
  border-radius: 980px;
  font-size: 14px;
  font-weight: 500;
  color: #1d1d1f;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
}
.os-menu__item:hover {
  background: rgba(255, 255, 255, 0.6);
}
.os-menu__item--active {
  background: #fff;
  box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.15);
  color: #0071e3;
}

/* ---------- Demo ---------- */
.demo {
  max-width: 1100px;
  margin: 0 auto;
  padding: 40px 22px 100px;
}
.demo__frame {
  background: #1d1d1f;
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 40px 80px -30px rgba(0, 0, 0, 0.25);
}
.demo__bar {
  height: 44px;
  background: linear-gradient(180deg, #3a3a3c, #2c2c2e);
  border-bottom: 1px solid rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  position: relative;
}
.demo__dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.demo__dot--r {
  background: #ff5f56;
}
.demo__dot--y {
  background: #ffbd2e;
}
.demo__dot--g {
  background: #27c93f;
}
.demo__crumbs {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  color: #a1a1a6;
  font-size: 13px;
  font-weight: 500;
}
.demo__crumbs-sep {
  color: #6e6e73;
}
.demo__body {
  background: #fbfbfd;
  padding: 32px;
  animation: demoFade 0.45s cubic-bezier(0.16, 1, 0.3, 1);
  min-height: 400px;
}
@keyframes demoFade {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 720px) {
  .demo__crumbs {
    display: none;
  }
  .demo__body {
    padding: 20px;
  }
}

/* ---------- Footer ---------- */
.foot {
  background: #f5f5f7;
  border-top: 1px solid #d2d2d7;
  padding: 28px 22px;
}
.foot__inner {
  max-width: 1100px;
  margin: 0 auto;
  font-size: 12px;
  color: #6e6e73;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.foot__sep {
  opacity: 0.5;
}

/* ---------- 暗色变体 ----------
 * 原实现把页面底色与嵌套演示区底色都硬编码为浅色，深色模式下演示区
 * 会变成大块白底压在暗色页面上。此处让这些表面随主题变化。
 * 演示区标题栏本身就是刻意的深色拟物，保持不变；品牌蓝强调色不变。
 */
.dark .tutorial-page {
  background: #0b1220;
  color: #f3f4f6;
}

.dark .demo__body {
  background: #111827;
  color: #f3f4f6;
}

.dark .demo__frame {
  box-shadow: 0 40px 80px -30px rgba(0, 0, 0, 0.6);
}

.dark .os-menu__item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.dark .os-menu__item--active {
  background: #1f2937;
  box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.5);
}

.dark .foot {
  background: #0b1220;
  border-top: 1px solid #374151;
}

/* 表面转暗后，原先硬编码的浅色模式文字色对比度不足，需一并覆盖。
 * 主标题是深色渐变裁剪到文字（color: transparent），只改 color 无效，
 * 必须反转渐变本身。 */
.dark .tut-hero__title {
  background: linear-gradient(180deg, #f9fafb 0%, #d1d5db 100%);
  -webkit-background-clip: text;
  background-clip: text;
}

.dark .tut-hero__sub {
  color: #9ca3af;
}

.dark .apple-nav__brand,
.dark .apple-nav__links a,
.dark .apple-nav__dropdown-trigger {
  color: #e5e7eb;
}

.dark .dropdown-panel__label,
.dark .dropdown-panel__link i,
.dark .dropdown-panel__section--aside .dropdown-panel__link {
  color: #9ca3af;
}

.dark .os-menu__item {
  color: #d1d5db;
}

.dark .demo__crumbs-sep {
  color: #9ca3af;
}

.dark .foot__inner {
  color: #9ca3af;
}
</style>
