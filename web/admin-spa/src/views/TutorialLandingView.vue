<template>
  <div class="apple-landing tutorial-page">
    <!-- Primary nav (same as Landing) -->
    <PublicNav active="tutorial" />

    <!-- Page hero -->
    <section class="tut-hero">
      <div class="tut-hero__inner">
        <p class="tut-hero__eyebrow">{{ currentToolTitle }}</p>
        <h1 class="tut-hero__title">在几分钟内，完成接入。</h1>
        <p class="tut-hero__sub">选择你的操作系统，按步骤在本地完成安装与认证。</p>

        <!-- OS selector：Apple「Explore the lineup」式分段控件，选中胶囊平滑滑动 -->
        <div
          ref="osMenuRef"
          aria-label="选择操作系统"
          class="os-menu"
          :class="{ 'os-menu--ready': osIndicatorReady }"
          role="tablist"
        >
          <span aria-hidden="true" class="os-menu__indicator" :style="osIndicatorStyle"></span>
          <button
            v-for="system in tutorialSystems"
            :key="system.key"
            :aria-selected="activeTutorialSystem === system.key"
            class="os-menu__item"
            :class="{ 'os-menu__item--active': activeTutorialSystem === system.key }"
            :data-os="system.key"
            role="tab"
            type="button"
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
      <div ref="demoFrameRef" class="demo__frame">
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
        <div class="demo__layout">
          <!-- Finder-style sidebar TOC -->
          <aside class="finder-sidebar">
            <template v-for="(group, groupIndex) in tocGroups" :key="group.title">
              <div v-if="groupIndex > 0" class="finder-sidebar__divider"></div>
              <p class="finder-sidebar__heading">{{ group.title }}</p>
              <button
                v-for="step in group.items"
                :key="step.id"
                class="finder-sidebar__item"
                :class="{ 'finder-sidebar__item--active': activeStepId === step.id }"
                @click="scrollToStep(step.id)"
              >
                <i class="finder-sidebar__icon" :class="step.icon" />
                <span class="finder-sidebar__label">{{ step.label }}</span>
              </button>
            </template>
          </aside>
          <!-- Scrollable tutorial content -->
          <div
            :key="activeCliTool + '-' + activeTutorialSystem"
            ref="demoBodyRef"
            class="demo__body"
            :class="`tutorial-platform--${activeTutorialSystem}`"
          >
            <component :is="currentTutorialComponent" :platform="activeTutorialSystem" />
          </div>
        </div>
      </div>
    </section>

    <PublicFooter />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import PublicFooter from '@/components/public/PublicFooter.vue'
import PublicNav from '@/components/public/PublicNav.vue'
import { cliTools, cliToolSteps } from '@/constants/cliTools'
import { useRoute } from 'vue-router'
import { enhanceTutorialCommandBoxes } from '@/utils/tutorialCommandCopy'

const route = useRoute()

const demoBodyRef = ref(null)
const demoFrameRef = ref(null)

const activeTutorialSystem = ref('windows')
const activeCliTool = ref('claude-code')
const activeStepId = ref('')

const tutorialSystems = [
  { key: 'windows', name: 'Windows', icon: 'fab fa-windows' },
  { key: 'macos', name: 'macOS', icon: 'fab fa-apple' },
  { key: 'linux', name: 'Linux / WSL2', icon: 'fab fa-linux' }
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

const currentSteps = computed(() => {
  const all = cliToolSteps[activeCliTool.value] || []
  return all.filter((s) => !s.platform || s.platform === activeTutorialSystem.value)
})

const tocGroups = computed(() => {
  const steps = currentSteps.value
  const groups = []
  const stepItems = steps.filter((s) => s.group !== 'more')
  const moreItems = steps.filter((s) => s.group === 'more')
  if (stepItems.length) groups.push({ title: '教程步骤', items: stepItems })
  if (moreItems.length) groups.push({ title: '更多', items: moreItems })
  return groups
})

/* ---- OS 分段控件：选中胶囊跟随定位 ---- */
const osMenuRef = ref(null)
const osIndicatorStyle = ref({ opacity: 0 })
const osIndicatorReady = ref(false)

const updateOsIndicator = () => {
  const menu = osMenuRef.value
  if (!menu) return
  const btn = menu.querySelector(`[data-os="${activeTutorialSystem.value}"]`)
  if (!btn) return
  osIndicatorStyle.value = {
    width: `${btn.offsetWidth}px`,
    transform: `translateX(${btn.offsetLeft}px)`,
    opacity: 1
  }
}

watch(activeTutorialSystem, () => nextTick(updateOsIndicator))

/* ---- Scroll tracking via IntersectionObserver ---- */
let observer = null

const setupObserver = () => {
  cleanupObserver()
  nextTick(() => {
    const root = demoBodyRef.value
    if (!root) return
    const ids = currentSteps.value.map((s) => s.id)
    const els = ids.map((id) => root.querySelector(`#${id}`)).filter(Boolean)
    if (!els.length) return
    // Default to first step
    activeStepId.value = ids[0]

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            activeStepId.value = entry.target.id
          }
        }
      },
      {
        root,
        rootMargin: '-10% 0px -60% 0px',
        threshold: 0
      }
    )
    els.forEach((el) => observer.observe(el))
  })
}

const cleanupObserver = () => {
  if (observer) {
    observer.disconnect()
    observer = null
  }
}

const scrollToStep = (id) => {
  const root = demoBodyRef.value
  const frame = demoFrameRef.value
  if (!root) return
  const el = root.querySelector(`#${id}`)
  if (!el) return
  activeStepId.value = id

  // 1. Scroll the page so the demo frame is centred in the viewport
  if (frame) {
    const frameRect = frame.getBoundingClientRect()
    const viewH = window.innerHeight
    const offset = frameRect.top + window.scrollY - Math.max(0, (viewH - frameRect.height) / 2)
    window.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' })
  }

  // 2. Scroll the content area to the target step
  const elRect = el.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  const scrollTop = root.scrollTop + (elRect.top - rootRect.top) - 16
  root.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' })
}

const applyToolFromQuery = () => {
  const q = route.query.tool
  if (q && cliTools.some((t) => t.key === q)) {
    activeCliTool.value = q
  }
}

const refreshCommandCopyButtons = () => {
  nextTick(() => {
    enhanceTutorialCommandBoxes(demoBodyRef.value)
  })
}

watch(() => route.query.tool, applyToolFromQuery)
watch([activeCliTool, activeTutorialSystem], () => {
  refreshCommandCopyButtons()
  setupObserver()
})

onMounted(() => {
  nextTick(() => {
    updateOsIndicator()
    // 首帧定位完成后再开启过渡，避免初次渲染时胶囊从左侧滑入
    requestAnimationFrame(() => (osIndicatorReady.value = true))
  })
  document.fonts?.ready?.then(updateOsIndicator)
  window.addEventListener('resize', updateOsIndicator)
  applyToolFromQuery()
  refreshCommandCopyButtons()
  setupObserver()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateOsIndicator)
  cleanupObserver()
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

/* Two-column layout: sidebar + content */
.demo__layout {
  display: flex;
  min-height: 500px;
}
.demo__body {
  flex: 1;
  min-width: 0;
  background: #fbfbfd;
  padding: 32px;
  overflow-y: auto;
  max-height: 80vh;
  scroll-behavior: smooth;
  animation: demoFade 0.45s cubic-bezier(0.16, 1, 0.3, 1);
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

/* ---------- Finder-style sidebar ---------- */
.finder-sidebar {
  width: 200px;
  min-width: 200px;
  background: #f2f1f0;
  border-right: 1px solid rgba(0, 0, 0, 0.08);
  padding: 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  max-height: 80vh;
}
.finder-sidebar__heading {
  font-size: 11px;
  font-weight: 600;
  color: #86868b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 6px 10px 4px;
  margin: 0;
  user-select: none;
}
.finder-sidebar__divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
  margin: 8px 10px;
}
.finder-sidebar__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 400;
  color: #1d1d1f;
  cursor: pointer;
  transition: background 0.15s ease;
  text-align: left;
  width: 100%;
  font-family: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.finder-sidebar__item:hover {
  background: rgba(0, 0, 0, 0.06);
}
.finder-sidebar__item--active {
  background: #0071e3;
  color: #fff;
}
.finder-sidebar__item--active:hover {
  background: #0077ed;
}
.finder-sidebar__icon {
  width: 18px;
  text-align: center;
  font-size: 14px;
  flex-shrink: 0;
  opacity: 0.7;
}
.finder-sidebar__item--active .finder-sidebar__icon {
  opacity: 1;
}
.finder-sidebar__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- Responsive ---------- */
@media (max-width: 720px) {
  .demo__crumbs {
    display: none;
  }
  .demo__body {
    padding: 20px;
  }
  .demo__layout {
    flex-direction: column;
  }
  .finder-sidebar {
    width: 100%;
    min-width: unset;
    max-height: unset;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
    padding: 10px 12px;
    border-right: none;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }
  .finder-sidebar__heading {
    width: 100%;
    padding: 2px 6px;
  }
  .finder-sidebar__divider {
    width: 100%;
    margin: 4px 0;
  }
  .finder-sidebar__item {
    padding: 6px 12px;
    font-size: 12px;
    width: auto;
    border-radius: 980px;
  }
}

/* ---------- 暗色变体 ---------- */
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

.dark .tut-hero__title {
  background: linear-gradient(180deg, #f9fafb 0%, #d1d5db 100%);
  -webkit-background-clip: text;
  background-clip: text;
}

.dark .tut-hero__sub {
  color: #9ca3af;
}

.dark .demo__crumbs-sep {
  color: #9ca3af;
}

.dark .finder-sidebar {
  background: #1a1f2e;
  border-right-color: rgba(255, 255, 255, 0.06);
}

.dark .finder-sidebar__heading {
  color: #6b7280;
}

.dark .finder-sidebar__divider {
  background: rgba(255, 255, 255, 0.06);
}

.dark .finder-sidebar__item {
  color: #d1d5db;
}

.dark .finder-sidebar__item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.dark .finder-sidebar__item--active {
  background: #0071e3;
  color: #fff;
}

/* ---------- OS 分段控件（参考 apple.com/mac「Explore the lineup」） ---------- */
.os-menu {
  position: relative;
  display: inline-flex;
  gap: 4px;
  padding: 6px;
  background: #e8e8ed;
  border-radius: 980px;
  isolation: isolate;
}
.os-menu__indicator {
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: 0;
  z-index: 0;
  border-radius: 980px;
  background: #1d1d1f;
  box-shadow: 0 6px 16px -8px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  will-change: transform, width;
}
.os-menu--ready .os-menu__indicator {
  transition:
    transform 0.5s cubic-bezier(0.32, 0.72, 0, 1),
    width 0.5s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.2s ease;
}
.os-menu__item {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 26px;
  border: none;
  background: transparent;
  border-radius: 980px;
  font-family: inherit;
  font-size: 17px;
  font-weight: 400;
  letter-spacing: -0.022em;
  color: #1d1d1f;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    color 0.4s cubic-bezier(0.32, 0.72, 0, 1),
    transform 0.2s ease;
}
.os-menu__item i {
  font-size: 15px;
  opacity: 0.85;
}
.os-menu__item:not(.os-menu__item--active):hover {
  color: #000;
}
.os-menu__item:active {
  transform: scale(0.97);
}
.os-menu__item--active {
  color: #fff;
}
.os-menu__item--active i {
  opacity: 1;
}
.os-menu__item:focus-visible {
  outline: 2px solid #0071e3;
  outline-offset: 2px;
}
@media (max-width: 720px) {
  .os-menu__item {
    padding: 10px 16px;
    font-size: 15px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .os-menu--ready .os-menu__indicator,
  .os-menu__item {
    transition: none;
  }
}
.dark .os-menu {
  background: rgba(255, 255, 255, 0.1);
}
.dark .os-menu__indicator {
  background: #f5f5f7;
}
.dark .os-menu__item {
  color: #d1d5db;
}
.dark .os-menu__item:not(.os-menu__item--active):hover {
  color: #fff;
}
.dark .os-menu__item--active {
  color: #1d1d1f;
}
</style>
