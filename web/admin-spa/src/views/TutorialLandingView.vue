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

    <PublicFooter />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import PublicFooter from '@/components/public/PublicFooter.vue'
import PublicNav from '@/components/public/PublicNav.vue'
import { cliTools } from '@/constants/cliTools'
import { useRoute } from 'vue-router'
import { enhanceTutorialCommandBoxes } from '@/utils/tutorialCommandCopy'

const route = useRoute()

const demoBodyRef = ref(null)

const activeTutorialSystem = ref('windows')
const activeCliTool = ref('claude-code')

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
watch([activeCliTool, activeTutorialSystem], refreshCommandCopyButtons)

onMounted(() => {
  applyToolFromQuery()
  refreshCommandCopyButtons()
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

.dark .os-menu__item {
  color: #d1d5db;
}

.dark .demo__crumbs-sep {
  color: #9ca3af;
}
</style>
